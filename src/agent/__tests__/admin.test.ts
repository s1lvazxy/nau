import { describe, expect, it } from 'vitest'
import { createDemoSnapshot } from '~/lib/seed'
import { applyChangeSet } from '~/data/changeset'
import { onHandTotal, runAutopilot } from '~/data/commands'
import type { Snapshot } from '~/lib/types'
import { executeTool } from '../executors'
import { autoResolve } from '../executors-admin'
import { TOOL_SCHEMAS, toolDefinitions, validateToolInput, type ToolName } from '../schema'
import { policyOf } from '../policy'

const agent = { kind: 'agent' as const, name: 'Operator' }

/** Runs a tool the way the runtime does: validate, execute, commit what it returns. */
function run(s: Snapshot, name: ToolName, input: unknown, source: 'operator' | 'autopilot' | 'rule' = 'operator') {
  const v = validateToolInput(name, input)
  if (!v.ok) throw new Error(v.error)
  const exec = executeTool(name, v.input as Record<string, unknown>, { snapshot: s, actor: agent, canWrite: true, source })
  return { exec, next: exec.apply ? applyChangeSet(s, exec.apply) : s, result: exec.result as Record<string, any> }
}

describe('Operator can run the platform', () => {
  it('describes every tool to the model with a JSON schema', () => {
    const defs = toolDefinitions()
    expect(defs.length).toBe(Object.keys(TOOL_SCHEMAS).length)
    expect(defs.length).toBeGreaterThanOrEqual(36)
    for (const d of defs) expect(d.input_schema.type).toBe('object')
  })

  it('builds a catalogue, changes it in bulk and takes it all back', () => {
    const s0 = createDemoSnapshot()
    let r = run(s0, 'create_items', { items: [{ name: 'Kombucha de Gengibre 330ml', sku: 'KOM-GEN', category: 'Bebidas Vivas', price: 3.2, cost: 1.4, supplier: 'Fermentos do Norte', opening_stock: 24 }, { name: 'Kombucha de Frutos Vermelhos 330ml', category: 'Bebidas Vivas', price: 3.2 }] })
    expect(r.result.status).toBe('done')
    expect(r.result.created).toHaveLength(2)
    let s = r.next
    const kom = s.items.find((i) => i.sku === 'KOM-GEN')!
    expect(onHandTotal(s, kom.id)).toBe(24)
    expect(s.categories.some((c) => c.name === 'Bebidas Vivas')).toBe(true)
    expect(s.suppliers.some((x) => x.name === 'Fermentos do Norte')).toBe(true)
    const created = s.actions[0]

    r = run(s, 'update_items', { category: 'Bebidas Vivas', set: { price_change_pct: 10, safety_days: 5, add_tags: ['novidade'] } })
    s = r.next
    expect(s.items.find((i) => i.id === kom.id)).toMatchObject({ price: 3.52, safetyDays: 5, tags: ['novidade'] })

    // same thing asked a second time creates nothing
    expect(run(s, 'create_items', { items: [{ name: 'Kombucha de Gengibre 330ml', sku: 'KOM-GEN' }] }).result.status).toBe('nothing_created')

    r = run(s, 'undo_action', { last: true })
    s = r.next
    expect(s.items.find((i) => i.id === kom.id)).toMatchObject({ price: 3.2, safetyDays: 3, tags: [] })
    r = run(s, 'undo_action', { action: created.id })
    s = r.next
    expect(s.items.some((i) => i.id === kom.id)).toBe(false)
    expect(s.categories.some((c) => c.name === 'Bebidas Vivas')).toBe(false)
    expect(s.actions.filter((a) => a.status === 'undone')).toHaveLength(2)
  })

  it('never widens its own authority', () => {
    const s = createDemoSnapshot()
    const r = run(s, 'set_policy', { money: 'auto', per_action_limit: 5000 })
    expect(r.result.status).toBe('awaiting_approval')
    expect(policyOf(r.next.workspace.settings).money).toBe('ask')
    expect(r.next.actions[0]).toMatchObject({ status: 'pending', kind: 'policy' })
    expect(r.next.actions[0].reason).toMatch(/never widens/)
  })

  it('holds a sent order for approval, and sends it alone once the limits allow', () => {
    let s = createDemoSnapshot()
    const first = run(s, 'prepare_purchase_order', { supplier: s.suppliers[0].name, auto_fill: true, lines: [{ item: s.items.find((i) => i.supplierId === s.suppliers[0].id)!.sku, qty: 2 }] })
    expect(first.result.status).toBe('done') // a draft is reversible
    s = first.next
    const po = s.orders.find((o) => o.status === 'draft' && o.createdBy === 'agent')!
    const send = run(s, 'update_order', { order: po.number, action: 'send' })
    expect(send.result.status).toBe('awaiting_approval')
    expect(send.next.orders.find((o) => o.id === po.id)!.status).toBe('draft')
    const total = po.lines.reduce((a, l) => a + l.qty * l.unitCost, 0)
    const open = { ...s, workspace: { ...s.workspace, settings: { ...s.workspace.settings, policy: { reversible: 'auto' as const, money: 'auto' as const, outbound: 'auto' as const, perActionLimit: total + 1, dailyLimit: total + 1 } } } }
    const sent = run(open, 'update_order', { order: po.number, action: 'send' })
    expect(sent.result.status).toBe('done')
    expect(sent.next.orders.find((o) => o.id === po.id)!.status).toBe('sent')
    // the daily limit is now used up
    const again = run({ ...sent.next, orders: sent.next.orders.map((o) => (o.id === po.id ? { ...o, status: 'draft' as const } : o)) }, 'update_order', { order: po.number, action: 'send' })
    expect(again.result.reason).toMatch(/today/)
  })

  it('writes rules, settings and dashboards', () => {
    let s = createDemoSnapshot()
    s = run(s, 'save_rule', { name: 'Sexta — Sogrape', instruction: 'Às sextas, prepara a encomenda da Sogrape se o Alvarinho cobrir menos de três semanas.', trigger: 'weekly' }).next
    expect(s.rules[0]).toMatchObject({ name: 'Sexta — Sogrape', trigger: 'weekly', enabled: true, createdBy: 'agent' })
    s = run(s, 'update_settings', { review_days: 10 }).next
    expect(s.workspace.settings.reviewDays).toBe(10)
    s = run(s, 'set_playbook', { key: 'pricewatch', enabled: false }).next
    expect(s.playbooks.find((p) => p.key === 'pricewatch')!.enabled).toBe(false)
    s = run(s, 'save_dashboard', { name: 'Loja do Porto' }).next
    expect(s.dashboards.some((d) => d.name === 'Loja do Porto')).toBe(true)
    const ws = run(s, 'get_workspace', {}).result
    expect(ws.rules[0].name).toBe('Sexta — Sogrape')
    expect(ws.policy.reversible).toBe('auto')
    s = run(s, 'delete_rule', { name: 'sexta' }).next
    expect(s.rules).toHaveLength(0)
  })

  it('reads the ledger and its own journal', () => {
    const s = createDemoSnapshot()
    const m = run(s, 'list_movements', { type: 'sale', days: 7, limit: 5 }).result
    expect(m.movements).toHaveLength(5)
    expect(m.net_quantity).toBeLessThan(0)
    const j = run(run(s, 'save_category', { name: 'Sazonal' }).next, 'list_journal', {}).result
    expect(j.actions[0]).toMatchObject({ title: 'Add category Sazonal', status: 'applied', can_undo: true })
  })
})

describe('autopilot on its own', () => {
  it('turns paperwork suggestions into draft orders and leaves what needs hands in the queue', () => {
    let s = createDemoSnapshot()
    s = applyChangeSet(s, runAutopilot(s))
    const pending = s.proposals.filter((p) => p.status === 'pending')
    const paperwork = pending.filter((p) => ['reorder', 'count', 'deadstock'].includes(p.kind))
    expect(paperwork.length).toBeGreaterThan(0)
    const cs = autoResolve(s)
    const after = applyChangeSet(s, cs)
    expect(after.proposals.filter((p) => p.status === 'pending').every((p) => ['transfer', 'markdown', 'price'].includes(p.kind))).toBe(true)
    expect(after.orders.length - s.orders.length).toBe(paperwork.filter((p) => p.kind === 'reorder').length)
    expect(after.orders.slice(s.orders.length).every((o) => o.status === 'draft')).toBe(true)
    expect(after.actions.filter((a) => a.source === 'autopilot' && a.status === 'applied')).toHaveLength(paperwork.length)
    // a second pass (the browser and the server both try) changes nothing
    const twice = applyChangeSet(after, autoResolve(after))
    expect(twice.orders).toHaveLength(after.orders.length)
    expect(applyChangeSet(s, autoResolve(s)).orders.map((o) => o.id)).toEqual(after.orders.map((o) => o.id))
    // and a workspace that approves everything keeps them all
    const asking = { ...s, workspace: { ...s.workspace, settings: { ...s.workspace.settings, policy: { ...policyOf(s.workspace.settings), reversible: 'ask' as const } } } }
    expect(autoResolve(asking)).toEqual({})
  })
})
