import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createClient } from '@supabase/supabase-js'
import { createCloudBackend } from '~/data/cloud'
import { createEmptySnapshot } from '~/lib/seed'
import { undoAction } from '~/agent/policy'
import { createPO, onHandTotal, queueEmail, sendPO } from '~/data/commands'
import { requireMember } from '../auth'
import { readV1, writeV1 } from '../api-v1'
import { sha256 } from '../crypto'
import { admin, commit, load } from '../db'
import { deliverOrderEmails } from '../mail'
import { connect, list, pushStock, sync } from '../integrations'
import { runWorkspace, type Ask } from '../agent-run'
import { tick } from '../tick'

const url = process.env.VITE_SUPABASE_URL!
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!
const run = process.env.INT ? describe : describe.skip

/** A WooCommerce shop that lives on 127.0.0.1 for the length of the test. */
function shop() {
  const order = (id: number, status: string, qty: number) => ({ id, number: String(id), status, date_created_gmt: new Date(Date.now() - 3_600_000).toISOString().slice(0, 19), date_modified_gmt: new Date().toISOString().slice(0, 19), line_items: [{ product_id: 12, variation_id: 0, sku: 'AZ-500', name: 'Azeite Virgem 500ml', quantity: qty, price: '7.90' }] })
  const state = { stock: 30, orders: [order(900, 'processing', 2)], puts: [] as { path: string; body: any }[], hooks: [] as { headers: http.IncomingHttpHeaders; body: string }[] }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const u = new URL(req.url!, 'http://x')
      const send = (code: number, data: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(data)))
      if (u.pathname === '/sink') return (state.hooks.push({ headers: req.headers, body }), send(200, { ok: true }))
      if (req.headers.authorization !== `Basic ${Buffer.from('ck_test:cs_test').toString('base64')}`) return send(401, { message: 'Invalid signature' })
      if (req.method === 'PUT') return (state.puts.push({ path: u.pathname, body: JSON.parse(body) }), send(200, {}))
      if (u.pathname.endsWith('/system_status')) return send(200, { environment: {} })
      if (u.pathname.endsWith('/products')) return send(200, [{ id: 12, type: 'simple', name: 'Azeite Virgem 500ml', sku: 'AZ-500', price: '7.90', manage_stock: true, stock_quantity: state.stock, categories: [{ name: 'Mercearia' }] }])
      if (u.pathname.endsWith('/orders')) return send(200, state.orders)
      send(404, { message: 'no route' })
    })
  })
  return { state, order, server, listen: () => new Promise<string>((ok) => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))) }
}

run('open platform against local Supabase', () => {
  const email = `platform+${Date.now()}@nau.test`
  const woo = shop()
  let base = ''
  let wsId = ''
  let userToken = ''
  let integrationId = ''
  let apiKey = ''
  let backend: ReturnType<typeof createCloudBackend>
  const asUser = () => new Request('http://nau.test/x', { headers: { authorization: `Bearer ${userToken}` } })

  beforeAll(async () => {
    process.env.NAU_ALLOW_PRIVATE_HOSTS = '1'
    process.env.NAU_SECRET_KEY ||= crypto.randomBytes(32).toString('base64')
    base = await woo.listen()
    backend = createCloudBackend()
    await backend.signUp({ name: 'Rita Teste', email, password: 'correct-horse-battery' })
    wsId = await backend.createWorkspace(createEmptySnapshot({ workspaceName: `Plataforma ${Date.now()}`, ownerName: 'Rita Teste', ownerEmail: email, sector: 'grocery' }))
    const { supabase } = await import('~/data/supabase')
    userToken = (await supabase().auth.getSession()).data.session!.access_token
  }, 60000)
  afterAll(() => void woo.server.close())

  it('keeps server tables and the service write path out of reach of signed-in clients', async () => {
    const { supabase } = await import('~/data/supabase')
    const c = supabase()
    await admin().from('integrations').insert({ workspace_id: wsId, connector: 'api', name: 'probe', secrets: 'sealed' })
    for (const t of ['integrations', 'integration_links', 'api_keys', 'webhooks']) expect((await c.from(t).select('*')).data ?? [], t).toEqual([])
    expect((await c.from('integrations').insert({ workspace_id: wsId, connector: 'x', name: 'x' })).error).not.toBeNull()
    expect((await c.rpc('apply_changeset_service', { p_workspace: wsId, p_changes: {} })).error).not.toBeNull()
    expect((await c.rpc('_apply_changeset', { p_workspace: wsId, p_changes: {}, p_role: 'owner' })).error).not.toBeNull()
    expect((await c.from('actions').insert({ id: crypto.randomUUID(), workspace_id: wsId, kind: 'x', title: 'forged' })).error).not.toBeNull()
    await admin().from('integrations').delete().eq('workspace_id', wsId).eq('name', 'probe')
    // and the server checks membership from the database
    expect((await requireMember(asUser(), wsId, 'admin')).ok).toBe(true)
    const stranger = createClient(url, key, { auth: { persistSession: false } })
    const s = await stranger.auth.signUp({ email: `stranger+${Date.now()}@nau.test`, password: 'another-long-password' })
    const res = await requireMember(new Request('http://nau.test/x', { headers: { authorization: `Bearer ${s.data.session!.access_token}` } }), wsId, 'viewer')
    expect(res.ok).toBe(false)
    expect((await requireMember(new Request('http://nau.test/x'), wsId)).ok).toBe(false)
  }, 60000)

  it('refuses bad credentials without saving anything, then connects and seals what it stores', async () => {
    await expect(connect(wsId, crypto.randomUUID(), 'woocommerce', { url: base, consumerKey: 'ck_test', consumerSecret: 'wrong' }, 'http://nau.test')).rejects.toThrow(/refused the credentials/)
    expect(await list(wsId, 'http://nau.test')).toHaveLength(0)
    const v = await connect(wsId, crypto.randomUUID(), 'woocommerce', { url: base, consumerKey: 'ck_test', consumerSecret: 'cs_test', webhookSecret: 'whs' }, 'http://nau.test')
    integrationId = v.id
    expect(v).toMatchObject({ connector: 'woocommerce', status: 'active', hookSigned: true, canPush: true, hookUrl: `http://nau.test/api/hooks/${v.id}` })
    expect(JSON.stringify(v)).not.toMatch(/cs_test|whs/)
    const { data } = await admin().from('integrations').select('secrets, hook_secret').eq('id', v.id).single()
    expect(data!.secrets).toMatch(/^v1\./)
    expect(data!.secrets + data!.hook_secret).not.toMatch(/cs_test|whs/)
  }, 60000)

  it('first sync brings the catalogue, today’s stock and the sales history; a second changes nothing', async () => {
    const first = await sync(integrationId)
    expect(first.report).toMatchObject({ products: { created: 1 }, documents: { sales: 1 }, stockSet: 1 })
    let s = await load(wsId)
    const item = s.items.find((i) => i.sku === 'AZ-500')!
    expect(onHandTotal(s, item.id)).toBe(30) // the shop's figure is the level after the history
    expect(s.movements.filter((m) => m.type === 'sale')).toHaveLength(1)
    expect(s.actions[0]).toMatchObject({ source: 'integration', status: 'applied', risk: 'reversible' })
    const again = await sync(integrationId)
    expect(again.report.documents.skipped).toBe(1)
    s = await load(wsId)
    expect(s.movements).toHaveLength(2)
    expect(onHandTotal(s, item.id)).toBe(30)
    // a new order sells three; a later sync only applies the difference
    woo.state.orders.push(woo.order(901, 'completed', 3))
    await sync(integrationId)
    s = await load(wsId)
    expect(onHandTotal(s, item.id)).toBe(27)
    // a person undoes that sync from the app, through the ordinary client path
    const act = s.actions.find((a) => a.title.includes('1 sales'))!
    await backend.commit(wsId, undoAction(s, act, { kind: 'user', name: 'Rita Teste' }))
    s = await load(wsId)
    expect(onHandTotal(s, item.id)).toBe(30)
    expect(s.actions.find((a) => a.id === act.id)!.status).toBe('undone')
  }, 60000)

  it('applies a webhook batch through the same door and writes stock back to the shop', async () => {
    await sync(integrationId, { batch: { documents: [{ ref: 'order:950', kind: 'sale', number: '#950', date: new Date().toISOString(), lines: [{ productRef: 'p:12', name: 'Azeite', qty: 5 }] }] } })
    const s = await load(wsId)
    expect(onHandTotal(s, s.items[0].id)).toBe(25)
    const out = await pushStock(wsId, integrationId)
    expect(out).toMatchObject({ updated: 1, total: 1, failed: [] })
    expect(woo.state.puts.at(-1)).toEqual({ path: '/wp-json/wc/v3/products/12', body: { manage_stock: true, stock_quantity: 25 } })
  }, 60000)

  it('public API: read-only keys cannot write, documents apply once, and what went in can be read back', async () => {
    const ro = `nau_${crypto.randomBytes(24).toString('base64url')}`
    apiKey = `nau_${crypto.randomBytes(24).toString('base64url')}`
    await admin().from('api_keys').insert([{ workspace_id: wsId, name: 'leitura', prefix: ro.slice(0, 10), hash: sha256(ro), scopes: ['read'] }, { workspace_id: wsId, name: 'POS da loja', prefix: apiKey.slice(0, 10), hash: sha256(apiKey), scopes: ['read', 'write'] }])
    const req = (path: string, k: string | null, body?: unknown) => new Request(`http://nau.test/api/v1/${path}`, { method: body ? 'POST' : 'GET', headers: k ? { authorization: `Bearer ${k}` } : {}, body: body ? JSON.stringify(body) : undefined })
    expect((await readV1(req('items', null), 'items')).status).toBe(401)
    expect((await readV1(req('items', 'nau_' + 'x'.repeat(40)), 'items')).status).toBe(401)
    expect((await writeV1(req('documents', ro, {}), 'documents')).status).toBe(403)
    expect((await writeV1(req('documents', apiKey, { documents: [{ ref: 'x', kind: 'sale' }] }), 'documents')).status).toBe(422)
    const doc = { ref: 'TALAO-1', kind: 'sale', number: 'FS 1/1', date: '2026-11-09T10:00:00Z', lines: [{ sku: 'AZ-500', name: 'Azeite', qty: 2 }, { name: 'Pão de Mafra', qty: 1, unitPrice: 1.6 }] }
    const first = await (await writeV1(req('documents', apiKey, doc), 'documents')).json()
    expect(first.data).toMatchObject({ accepted: 1, already_known: 0, lines_applied: 2, items_created: 1 })
    const second = await (await writeV1(req('documents', apiKey, { documents: [doc] }), 'documents')).json()
    expect(second.data).toMatchObject({ accepted: 0, already_known: 1 })
    const items = (await (await readV1(req('items', ro), 'items')).json()).data as { sku: string; on_hand: number; name: string }[]
    expect(items.find((i) => i.sku === 'AZ-500')!.on_hand).toBe(23)
    expect(items.find((i) => i.name === 'Pão de Mafra')!.on_hand).toBe(-1)
    const moves = (await (await readV1(req('movements?type=sale&limit=2', ro), 'movements')).json()).data
    expect(moves).toHaveLength(2)
    const up = await (await writeV1(req('products', apiKey, { products: [{ ref: 'pao', name: 'Pão de Mafra', price: 1.8, cost: 0.9, stock: [{ qty: 12 }] }], setStock: true }), 'products')).json()
    expect(up.data).toMatchObject({ created: 0, updated: 1, stock_levels_set: 1 })
    expect((await (await readV1(req('nope', ro), 'nope')).json()).error.code).toBe('not_found')
    // a revoked key stops working at once
    await admin().from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('hash', sha256(ro))
    expect((await readV1(req('items', ro), 'items')).status).toBe(401)
  }, 60000)

  it('runs a standing rule with nobody watching: reversible work is done, money waits', async () => {
    const before = await load(wsId)
    expect(before.suppliers).toHaveLength(0)
    await backend.commit(wsId, { upserts: { rules: [{ id: crypto.randomUUID(), name: 'Azeite ao fim do dia', instruction: 'Garante que o azeite tem fornecedor e prepara a encomenda.', trigger: 'hourly', enabled: true, createdBy: 'user', createdAt: new Date().toISOString(), lastRunAt: null, lastResult: null }] } })
    // A scripted model: it sets up the supplier, tries to send an order and to widen its own policy, then reports.
    let step = 0
    const ask: Ask = async (messages) => {
      const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use' as const, id, name, input }) as never
      if (step++ === 0) return { stop_reason: 'tool_use', content: [use('t1', 'save_supplier', { name: 'Lagar do Vale', lead_time_days: 3 }), use('t2', 'prepare_purchase_order', { supplier: 'Lagar do Vale', lines: [{ item: 'AZ-500', qty: 24 }], send_on_approval: true }), use('t3', 'set_policy', { money: 'auto', per_action_limit: 9999 }), use('t4', 'prepare_transfer', { item: 'nope', from: 'a', to: 'b', qty: 1 })] }
      const results = (messages.at(-1)!.content as { content: string; is_error?: boolean }[]).map((r) => JSON.parse(r.content))
      expect(results.map((r) => r.status ?? 'error')).toEqual(['done', 'awaiting_approval', 'awaiting_approval', 'error'])
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Criei o fornecedor Lagar do Vale. A encomenda de 24 azeites e a mudança de política ficaram à tua espera.' } as never] }
    }
    const out = await runWorkspace(wsId, { ask })
    expect(out.rules).toEqual([{ name: 'Azeite ao fim do dia', report: expect.stringContaining('Lagar do Vale') }])
    const s = await load(wsId)
    expect(s.suppliers.map((x) => x.name)).toEqual(['Lagar do Vale'])
    expect(s.orders).toHaveLength(before.orders.length) // the sent order is money: it was not created
    const waiting = s.actions.filter((a) => a.status === 'pending')
    expect(waiting.map((a) => [a.kind, a.risk, a.source]).sort()).toEqual([['order', 'money', 'rule'], ['policy', 'reversible', 'rule']])
    expect(s.workspace.settings.policy?.money ?? 'ask').toBe('ask')
    expect(s.rules[0].lastResult).toMatch(/à tua espera/)
    expect(s.rules[0].lastRunAt).toBeTruthy()
    // within the hour the rule is not due again
    expect((await runWorkspace(wsId, { ask })).rules).toEqual([])
  }, 60000)

  it('tick: syncs what is due, runs the workspace, and delivers a signed webhook', async () => {
    await admin().from('integrations').update({ last_sync_at: new Date(Date.now() - 3_600_000).toISOString() }).eq('id', integrationId)
    await admin().from('workspaces').update({ agent_ran_at: null }).eq('id', wsId)
    await admin().from('webhooks').insert({ workspace_id: wsId, url: 'https://hooks.test/sink', secret: 'whsec_test', cursor: new Date(Date.now() - 60_000).toISOString() })
    woo.state.orders.push(woo.order(902, 'completed', 1))
    const real = globalThis.fetch
    vi.stubGlobal('fetch', (input: any, init?: RequestInit) => (String(input).startsWith('https://hooks.test/') ? real(`${base}/sink`, { ...init, redirect: 'follow' }) : real(input, init)))
    const out = await tick()
    vi.unstubAllGlobals()
    expect(out.synced).toBeGreaterThanOrEqual(1)
    expect(out.workspaces.some((w) => w.workspace.startsWith('Plataforma'))).toBe(true)
    expect(woo.state.hooks.length).toBeGreaterThan(0)
    const hook = woo.state.hooks.at(-1)!
    const [, t, v1] = String(hook.headers['nau-signature']).match(/^t=(\d+),v1=([0-9a-f]+)$/)!
    expect(v1).toBe(crypto.createHmac('sha256', 'whsec_test').update(`${t}.${hook.body}`).digest('hex'))
    expect(JSON.parse(hook.body)).toMatchObject({ workspace_id: wsId, type: expect.stringMatching(/^activity\./) })
    const { data: wh } = await admin().from('webhooks').select('failures, last_status').eq('workspace_id', wsId).single()
    expect(wh).toEqual({ failures: 0, last_status: 200 })
    const s = await load(wsId)
    expect(s.movements.some((m) => m.ref === '#902')).toBe(true)
  }, 90000)

  it('emails a sent order through Resend once, records why a failure failed, and leaves drafts alone', async () => {
    process.env.RESEND_API_KEY = 're_test_key'
    process.env.NAU_MAIL_FROM = 'Compras <compras@loja.test>'
    const calls: { headers: Record<string, string>; body: any }[] = []
    let answer: () => Response = () => new Response(JSON.stringify({ id: 'email_1' }), { status: 200, headers: { 'content-type': 'application/json' } })
    const real = globalThis.fetch
    vi.stubGlobal('fetch', (input: any, init?: RequestInit) => {
      if (String(input) !== 'https://api.resend.com/emails') return real(input, init)
      calls.push({ headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) })
      return Promise.resolve(answer())
    })
    try {
      let s = await load(wsId)
      const supplier = { ...s.suppliers[0], email: 'paulo@quinta.test' }
      const item = s.items[0]
      const lines = [{ itemId: item.id, qty: 6, unitCost: 4 }]
      const draft = createPO({ ...s, suppliers: [supplier] }, { supplierId: supplier.id, lines }, { kind: 'user', name: 'Rita Teste' })
      await commit(wsId, { ...draft.cs, upserts: { ...draft.cs.upserts, suppliers: [supplier] } })

      // A queued flag on a draft is not an order to send
      await commit(wsId, { upserts: { orders: [{ ...draft.po, ...queueEmail() }] } })
      expect(await deliverOrderEmails(wsId)).toEqual({ sent: 0, failed: 0 })
      expect(calls).toHaveLength(0)

      s = await load(wsId)
      await commit(wsId, sendPO(s, s.orders.find((o) => o.id === draft.po.id)!, { kind: 'user', name: 'Rita Teste' }, { email: true }))
      expect(await deliverOrderEmails(wsId, { replyTo: email })).toEqual({ sent: 1, failed: 0 })
      expect(calls).toHaveLength(1)
      expect(calls[0].headers.authorization).toBe('Bearer re_test_key')
      expect(calls[0].headers['idempotency-key']).toContain(draft.po.id)
      expect(calls[0].body).toMatchObject({ from: 'Compras <compras@loja.test>', to: ['paulo@quinta.test'], reply_to: email })
      expect(calls[0].body.subject).toContain(draft.po.number)
      expect(calls[0].body.text).toContain(item.name)
      let po = (await load(wsId)).orders.find((o) => o.id === draft.po.id)!
      expect(po).toMatchObject({ status: 'sent', emailStatus: 'sent', emailError: null })
      expect(po.emailedAt).toBeTruthy()
      // Nothing is left in the queue, so a second run sends nothing
      expect(await deliverOrderEmails(wsId)).toEqual({ sent: 0, failed: 0 })
      expect(calls).toHaveLength(1)

      // Resend refuses (domain not verified): the reason lands on the order, and a retry goes out with a new key
      answer = () => new Response(JSON.stringify({ statusCode: 403, name: 'validation_error', message: 'The loja.test domain is not verified.' }), { status: 403, headers: { 'content-type': 'application/json' } })
      await commit(wsId, { upserts: { orders: [{ ...po, ...queueEmail() }] } })
      expect(await deliverOrderEmails(wsId)).toEqual({ sent: 0, failed: 1 })
      po = (await load(wsId)).orders.find((o) => o.id === draft.po.id)!
      expect(po.emailStatus).toBe('failed')
      expect(po.emailError).toContain('not verified')
      expect(po.emailError).not.toContain('re_test_key')
      answer = () => new Response(JSON.stringify({ id: 'email_2' }), { status: 200, headers: { 'content-type': 'application/json' } })
      await new Promise((r) => setTimeout(r, 5))
      await commit(wsId, { upserts: { orders: [{ ...po, ...queueEmail() }] } })
      expect(await deliverOrderEmails(wsId)).toEqual({ sent: 1, failed: 0 })
      expect(calls.at(-1)!.headers['idempotency-key']).not.toBe(calls[0].headers['idempotency-key'])

      // Without the host's configuration nothing is ever sent
      delete process.env.RESEND_API_KEY
      await commit(wsId, { upserts: { orders: [{ ...po, ...queueEmail() }] } })
      const before = calls.length
      expect(await deliverOrderEmails(wsId)).toEqual({ sent: 0, failed: 0 })
      expect(calls).toHaveLength(before)
    } finally {
      vi.unstubAllGlobals()
      delete process.env.RESEND_API_KEY
      delete process.env.NAU_MAIL_FROM
    }
  }, 60000)
})
