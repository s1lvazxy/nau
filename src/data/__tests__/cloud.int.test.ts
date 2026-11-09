import { beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createCloudBackend } from '../cloud'
import { createDemoSnapshot } from '~/lib/seed'
import { kpis } from '~/lib/analytics'
import { postReceipt, newReceipt, transferStock } from '../commands'
import { applyChangeSet } from '../changeset'

const url = process.env.VITE_SUPABASE_URL!
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!
const run = process.env.INT ? describe : describe.skip

run('cloud backend against local Supabase', () => {
  const email = `owner+${Date.now()}@nau.test`
  let backend: ReturnType<typeof createCloudBackend>
  let wsId = ''
  beforeAll(() => {
    backend = createCloudBackend()
  })
  it('signs up and creates the demo workspace', async () => {
    const r = await backend.signUp({ name: 'Inês Test', email, password: 'correct-horse-battery' })
    expect(r.confirm).toBe(false)
    const demo = createDemoSnapshot({ ownerName: 'Inês Test', ownerEmail: email })
    const t0 = Date.now()
    wsId = await backend.createWorkspace(demo)
    console.log('seeded in', Date.now() - t0, 'ms')
    const list = await backend.listWorkspaces()
    expect(list.map((w) => w.id)).toContain(wsId)
  }, 120000)
  it('loads an equivalent snapshot', async () => {
    const local = createDemoSnapshot()
    const s = await backend.load(wsId)
    console.log('loaded', s.items.length, 'items', s.movements.length, 'movements', s.levels.length, 'levels', s.batches.length, 'batches')
    const kc = kpis(s)
    const kl = kpis(local)
    console.log('cloud stockValue', kc.stockValue, 'local', kl.stockValue, 'health', kc.health, kl.health)
    expect(s.items.length).toBe(local.items.length)
    expect(Math.abs(kc.stockValue - kl.stockValue)).toBeLessThan(1)
    expect(typeof s.items[0].cost).toBe('number')
  }, 60000)
  it('commits receipts and transfers atomically', async () => {
    let s = await backend.load(wsId)
    const item = s.items.find((i) => i.name.startsWith('Queijo de Azeitão'))!
    const wh = s.locations.find((l) => l.isDefault)!
    const store = s.locations.find((l) => l.code === 'PRL')!
    const before = s.levels.find((l) => l.itemId === item.id && l.locationId === wh.id)?.onHand ?? 0
    const r = newReceipt(s, { supplierId: item.supplierId!, locationId: wh.id, lines: [{ id: crypto.randomUUID(), itemId: item.id, description: item.name, qty: 12, unitCost: 6.5, lot: 'LTEST1', expiresOn: '2026-12-20' }] })
    const cs1 = postReceipt(s, r, { kind: 'user', name: 'Test' })
    await backend.commit(wsId, cs1)
    const mid = applyChangeSet(s, cs1)
    const cs2 = transferStock(mid, { itemId: item.id, from: wh.id, to: store.id, qty: 5 }, { kind: 'user', name: 'Test' })
    const expected = applyChangeSet(mid, cs2)
    await backend.commit(wsId, cs2)
    await backend.commit(wsId, cs2) // idempotent retry must not double-apply
    s = await backend.load(wsId)
    const after = s.levels.find((l) => l.itemId === item.id && l.locationId === wh.id)!.onHand
    expect(after).toBeCloseTo(before + 12 - 5, 3)
    // SQL FEFO must match the TypeScript FEFO used for optimistic updates
    const lotsCloud = s.batches.filter((b) => b.itemId === item.id && b.locationId === wh.id).map((b) => `${b.code}:${b.qty}`).sort()
    const lotsLocal = expected.batches.filter((b) => b.itemId === item.id && b.locationId === wh.id).map((b) => `${b.code}:${b.qty}`).sort()
    console.log('lots cloud', lotsCloud, 'local', lotsLocal)
    expect(lotsCloud).toEqual(lotsLocal)
    expect(s.receipts.find((x) => x.id === r.id)?.status).toBe('posted')
  }, 60000)
  it('isolates tenants and enforces read-only viewers', async () => {
    const other = createClient(url, key, { auth: { persistSession: false } })
    const e2 = `intruder+${Date.now()}@nau.test`
    await other.auth.signUp({ email: e2, password: 'another-long-password' })
    const { data: items } = await other.from('items').select('id').eq('workspace_id', wsId)
    expect(items?.length ?? 0).toBe(0)
    const { error } = await other.rpc('apply_changeset', { p_workspace: wsId, p_changes: { events: [] } })
    expect(error?.message).toMatch(/write access/)
    // invite as viewer → linked on sign-up → can read but not write
    const e3 = `viewer+${Date.now()}@nau.test`
    await backend.commit(wsId, { upserts: { members: [{ id: crypto.randomUUID(), name: 'Viewer', email: e3, role: 'viewer', status: 'invited', hue: 200 }] } })
    const v = createClient(url, key, { auth: { persistSession: false } })
    await v.auth.signUp({ email: e3, password: 'viewer-long-password' })
    const { data: vi } = await v.from('items').select('id').eq('workspace_id', wsId)
    expect((vi?.length ?? 0) > 40).toBe(true)
    const { error: ve } = await v.rpc('apply_changeset', { p_workspace: wsId, p_changes: { events: [] } })
    expect(ve?.message).toMatch(/write access/)
  }, 60000)
})

run('security hardening', () => {
  it('refuses direct table writes: stock only moves through the ledger, and roles are checked by the database', async () => {
    const c = createClient(url, key, { auth: { persistSession: false } })
    const email = `owner2+${Date.now()}@nau.test`
    await c.auth.signUp({ email, password: 'another-long-password' })
    const id = crypto.randomUUID()
    const { error: e0 } = await c.rpc('create_workspace', { p_id: id, p_name: 'Sec Test', p_slug: 'sec-test', p_nif: null, p_sector: 'retail', p_region: 'continente', p_settings: {}, p_owner_name: 'Owner' })
    expect(e0).toBeNull()
    // a member cannot edit the workspace row, add rows or invent stock behind the ledger's back
    await c.from('workspaces').update({ name: 'Renamed directly' }).eq('id', id)
    expect((await c.from('workspaces').select('name').eq('id', id).single()).data?.name).toBe('Sec Test')
    const { error: e1 } = await c.from('locations').insert({ id: crypto.randomUUID(), workspace_id: id, name: 'X', code: 'X', kind: 'store' })
    expect(e1).not.toBeNull()
    const { error: e2 } = await c.from('stock_levels').insert({ workspace_id: id, item_id: crypto.randomUUID(), location_id: crypto.randomUUID(), on_hand: 999 })
    expect(e2).not.toBeNull()
    // someone outside the workspace sees nothing of it and cannot write to it
    const other = createClient(url, key, { auth: { persistSession: false } })
    await other.auth.signUp({ email: `peek+${Date.now()}@nau.test`, password: 'another-long-password' })
    expect((await other.from('workspaces').select('id').eq('id', id)).data ?? []).toEqual([])
    const { error: e4 } = await other.rpc('apply_changeset', { p_workspace: id, p_changes: { upserts: { locations: [{ id: crypto.randomUUID(), name: 'Intruder', code: 'INT', kind: 'store' }] } } })
    expect(e4).not.toBeNull()
    // the app path works, with no cap on locations or items
    const locations = Array.from({ length: 6 }, (_, i) => ({ id: crypto.randomUUID(), name: `Shop ${i + 1}`, code: `S${i + 1}`, kind: 'store', is_default: i === 0 }))
    const { error: e3 } = await c.rpc('apply_changeset', { p_workspace: id, p_changes: { upserts: { locations } } })
    expect(e3).toBeNull()
    expect((await c.from('locations').select('id').eq('workspace_id', id)).data).toHaveLength(6)
  }, 60000)
})
