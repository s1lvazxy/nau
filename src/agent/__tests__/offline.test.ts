import { describe, expect, it } from 'vitest'
import { createDemoSnapshot } from '~/lib/seed'
import { planOffline } from '../offline'
import { executeTool } from '../executors'
import { validateToolInput } from '../schema'
import { applyChangeSet } from '~/data/changeset'
import { approveAction } from '../policy'
import type { Snapshot } from '~/lib/types'

const s = createDemoSnapshot()
const ctx = { snapshot: s, actor: { kind: 'agent' as const, name: 'Operator' }, canWrite: true }
const asking: Snapshot = { ...s, workspace: { ...s.workspace, settings: { ...s.workspace.settings, policy: { reversible: 'ask' as const, money: 'ask' as const, outbound: 'ask' as const, perActionLimit: 0, dailyLimit: 0 } } } }

describe('offline operator', () => {
  it('understands English names for Portuguese products', () => {
    const p = planOffline(s, 'move 20 capsules from Bonfim to Príncipe Real')
    expect(p.calls[0].name).toBe('prepare_transfer')
    // The person asked for it and a transfer is reversible: it is recorded, journalled and can be undone
    const r = executeTool('prepare_transfer', p.calls[0].input as never, ctx)
    expect((r.result as { status: string }).status).toBe('done')
    expect(r.apply?.movements).toHaveLength(2)
    expect(r.action).toMatchObject({ status: 'applied', risk: 'reversible' })
    // A workspace that wants to approve everything gets a card instead, and nothing moves
    const held = executeTool('prepare_transfer', p.calls[0].input as never, { ...ctx, snapshot: asking })
    expect((held.result as { status: string }).status).toBe('awaiting_approval')
    expect(held.apply?.movements).toBeUndefined()
    // Autopilot deciding the same move on its own never records it: someone has to carry the boxes
    const own = executeTool('prepare_transfer', p.calls[0].input as never, { ...ctx, source: 'autopilot' })
    expect(own.action).toMatchObject({ status: 'pending' })
    expect(own.action?.reason).toMatch(/move the stock/)
  })
  it('answers stock questions and forecasts', () => {
    expect(planOffline(s, 'how many sardines do we have?').calls[0].name).toBe('get_item')
    expect(planOffline(s, 'when will the alvarinho run out').calls[0].name).toBe('forecast')
    expect(planOffline(s, 'what is running low?').calls.map((c) => c.name)).toEqual(['list_items', 'list_items', 'list_items'])
    expect(planOffline(s, 'add a sales trend widget').calls[0].name).toBe('add_widget')
  })
  it('numbers orders approved one after the other without collisions', () => {
    const p = planOffline(asking, 'draft the orders')
    let snap = asking
    for (const c of p.calls) snap = applyChangeSet(snap, executeTool(c.name, c.input as never, { ...ctx, snapshot: asking }).apply ?? {})
    const waiting = snap.actions.filter((a) => a.status === 'pending')
    expect(waiting.length).toBeGreaterThan(1)
    for (const a of waiting) snap = applyChangeSet(snap, approveAction(snap, a, { kind: 'user', name: 'Inês' }))
    const numbers = snap.orders.map((o) => o.number)
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(snap.orders.length).toBe(asking.orders.length + waiting.length)
  })
  it('validates every tool schema', () => {
    expect(validateToolInput('prepare_transfer', { item: 'x', from: 'a', to: 'b', qty: -1 }).ok).toBe(false)
    expect(validateToolInput('nope', {}).ok).toBe(false)
    expect(validateToolInput('stock_overview', {}).ok).toBe(true)
  })
})
