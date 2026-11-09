import { describe, expect, it } from 'vitest'
import { createDemoSnapshot } from '~/lib/seed'
import { applyChangeSet } from '~/data/changeset'
import { adjustStock, createPO, onHandAt, saveItem, newItem } from '~/data/commands'
import { materializeUndo, undoSpec } from '~/data/undo'
import { approveAction, decide, record, spentToday, undoAction, DEFAULT_POLICY } from '../policy'

const agent = { kind: 'agent' as const, name: 'Operator' }
const user = { kind: 'user' as const, name: 'Inês' }

describe('policy — what Operator may do alone', () => {
  it('lets reversible work through and holds money and outbound behind the limits', () => {
    expect(decide(DEFAULT_POLICY, { risk: 'reversible' }, 0).auto).toBe(true)
    expect(decide(DEFAULT_POLICY, { risk: 'money', impactEur: 10 }, 0).auto).toBe(false) // money asks by default
    const open = { ...DEFAULT_POLICY, money: 'auto' as const, outbound: 'auto' as const }
    expect(decide(open, { risk: 'money', impactEur: 250 }, 0).auto).toBe(true)
    expect(decide(open, { risk: 'money', impactEur: 250.01 }, 0)).toMatchObject({ auto: false })
    expect(decide(open, { risk: 'outbound', impactEur: 200 }, 600).reason).toMatch(/today/)
    expect(decide({ ...open, reversible: 'ask' }, { risk: 'reversible' }, 0).auto).toBe(false)
  })

  it('journals an automatic action with its undo, and a held one with the change still to apply', () => {
    let s = createDemoSnapshot()
    const it0 = s.items[0]
    const loc = s.locations[0]
    const before = onHandAt(s, it0.id, loc.id)
    const auto = record(s, { kind: 'adjustment', risk: 'reversible', title: 'Remove 2', lines: [], impactEur: 5, cs: adjustStock(s, { itemId: it0.id, locationId: loc.id, delta: -2, reason: 'breakage' }, agent), source: 'operator' }, agent)
    expect(auto.applied).toBe(true)
    expect(auto.action.status).toBe('applied')
    expect(auto.action.undo?.movements).toHaveLength(1)
    s = applyChangeSet(s, auto.cs)
    expect(onHandAt(s, it0.id, loc.id)).toBe(before - 2)

    const { cs: poCs } = createPO(s, { supplierId: s.suppliers[0].id, lines: [{ itemId: it0.id, qty: 10, unitCost: 3 }], status: 'sent' }, agent)
    const held = record(s, { kind: 'order', risk: 'money', title: 'Order', lines: [], impactEur: 30, cs: poCs, source: 'operator' }, agent)
    expect(held.applied).toBe(false)
    expect(held.cs.upserts?.orders).toBeUndefined() // nothing but the journal entry is written
    s = applyChangeSet(s, held.cs)
    const orders = s.orders.length
    s = applyChangeSet(s, approveAction(s, s.actions.find((a) => a.id === held.action.id)!, user))
    expect(s.orders).toHaveLength(orders + 1)
    expect(s.actions.find((a) => a.id === held.action.id)).toMatchObject({ status: 'applied', cs: {} })
    expect(spentToday(s)).toBe(0) // approved by a person: not Operator's own spending
  })

  it('counts what Operator spent today against the daily limit', () => {
    let s = createDemoSnapshot()
    s = { ...s, workspace: { ...s.workspace, settings: { ...s.workspace.settings, policy: { ...DEFAULT_POLICY, money: 'auto', perActionLimit: 100, dailyLimit: 150 } } } }
    const order = () => createPO(s, { supplierId: s.suppliers[0].id, lines: [{ itemId: s.items[0].id, qty: 1, unitCost: 90 }], status: 'sent' }, agent).cs
    const a = record(s, { kind: 'order', risk: 'money', title: 'A', lines: [], impactEur: 90, cs: order(), source: 'autopilot' }, agent)
    expect(a.applied).toBe(true)
    s = applyChangeSet(s, a.cs)
    expect(spentToday(s)).toBe(90)
    expect(record(s, { kind: 'order', risk: 'money', title: 'B', lines: [], impactEur: 90, cs: order(), source: 'autopilot' }, agent).applied).toBe(false)
  })
})

describe('undo', () => {
  it('takes back stock, restores only the fields the action touched, and removes what it created', () => {
    let s = createDemoSnapshot()
    const it0 = s.items[0]
    const loc = s.locations[0]
    const level = onHandAt(s, it0.id, loc.id)
    const created = newItem(s, { name: 'Novo artigo', sku: 'NOVO-1' })
    const cs = applyAll(saveItem(s, created, agent), { upserts: { items: [{ ...it0, price: it0.price + 1 }] } }, adjustStock(s, { itemId: it0.id, locationId: loc.id, delta: 7, reason: 'found' }, agent))
    const r = record(s, { kind: 'catalog', risk: 'reversible', title: 'Tidy', lines: [], cs, source: 'operator' }, agent)
    s = applyChangeSet(s, r.cs)
    // someone edits another field afterwards
    s = applyChangeSet(s, { upserts: { items: [{ ...s.items.find((i) => i.id === it0.id)!, name: 'Renamed by a person' }] } })
    s = applyChangeSet(s, undoAction(s, s.actions.find((a) => a.id === r.action.id)!, user))
    const back = s.items.find((i) => i.id === it0.id)!
    expect(back.price).toBe(it0.price)
    expect(back.name).toBe('Renamed by a person')
    expect(onHandAt(s, it0.id, loc.id)).toBe(level)
    expect(s.items.some((i) => i.id === created.id)).toBe(false)
    expect(s.actions.find((a) => a.id === r.action.id)?.status).toBe('undone')
    // undoing twice is harmless
    const again = materializeUndo(s, r.action.undo!, user)
    expect(onHandAt(applyChangeSet(s, again), it0.id, loc.id)).toBe(level)
  })

  it('archives a created item that has since gathered its own history', () => {
    let s = createDemoSnapshot()
    const created = newItem(s, { name: 'Com vendas', sku: 'CV-1' })
    const cs = saveItem(s, created, agent)
    const spec = undoSpec(s, cs)
    s = applyChangeSet(s, cs)
    s = applyChangeSet(s, adjustStock(s, { itemId: created.id, locationId: s.locations[0].id, delta: 3, reason: 'later' }, user))
    s = applyChangeSet(s, materializeUndo(s, spec, user))
    expect(s.items.find((i) => i.id === created.id)?.archived).toBe(true)
  })
})

function applyAll(...sets: import('~/data/changeset').ChangeSet[]) {
  return sets.reduce((a, b) => ({ ...a, upserts: { ...a.upserts, ...b.upserts, items: [...(a.upserts?.items ?? []), ...(b.upserts?.items ?? [])] }, movements: [...(a.movements ?? []), ...(b.movements ?? [])], events: [...(a.events ?? []), ...(b.events ?? [])] }), {} as import('~/data/changeset').ChangeSet)
}
