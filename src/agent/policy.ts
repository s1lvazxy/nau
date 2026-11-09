import type { ActionSource, Actor, AgentAction, Policy, Risk, Snapshot, Workspace } from '~/lib/types'
import { eur } from '~/lib/format'
import { uid } from '~/lib/utils'
import { mergeChangeSets, type ChangeSet } from '~/data/changeset'
import { event, renumberOrders } from '~/data/commands'
import { isUndoable, materializeUndo, undoSpec } from '~/data/undo'

/** Reversible work runs alone; money and anything that leaves the building waits unless a limit is set. */
export const DEFAULT_POLICY: Policy = { reversible: 'auto', money: 'ask', outbound: 'ask', perActionLimit: 250, dailyLimit: 750 }

export function policyOf(settings: Workspace['settings']): Policy {
  if (settings.policy) return { ...DEFAULT_POLICY, ...settings.policy }
  const legacy = settings.autonomy
  if (!legacy) return DEFAULT_POLICY
  return { reversible: 'auto', money: legacy.reorder === 'auto' ? 'auto' : 'ask', outbound: 'ask', perActionLimit: legacy.autoLimit ?? 250, dailyLimit: (legacy.autoLimit ?? 250) * 3 }
}

/** EUR Operator already committed on its own since midnight (Lisbon). */
export function spentToday(s: Snapshot, now = new Date()): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: s.workspace.timezone || 'Europe/Lisbon' }).format(now)
  const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: s.workspace.timezone || 'Europe/Lisbon' }).format(new Date(iso))
  return s.actions.filter((a) => a.status === 'applied' && a.risk !== 'reversible' && !a.approvedBy && dayOf(a.resolvedAt ?? a.createdAt) === day).reduce((t, a) => t + (a.impactEur ?? 0), 0)
}

export interface Intent {
  kind: string
  risk: Risk
  title: string
  lines: string[]
  impactEur?: number | null
  cs: ChangeSet
  link?: string | null
  source: ActionSource
}

export function decide(policy: Policy, intent: Pick<Intent, 'risk' | 'impactEur'>, spent: number): { auto: boolean; reason: string } {
  if (intent.risk === 'reversible') return policy.reversible === 'auto' ? { auto: true, reason: 'Reversible — can be undone from the journal' } : { auto: false, reason: 'You asked to approve every change' }
  const what = intent.risk === 'money' ? 'Spending' : 'Sending outside Nau'
  if (policy[intent.risk] !== 'auto') return { auto: false, reason: `${what} waits for you` }
  const value = intent.impactEur ?? 0
  if (value > policy.perActionLimit) return { auto: false, reason: `Above the ${eur(policy.perActionLimit, { decimals: 0 })} per-action limit` }
  if (spent + value > policy.dailyLimit) return { auto: false, reason: `Would pass today’s ${eur(policy.dailyLimit, { decimals: 0 })} limit (${eur(spent, { decimals: 0 })} used)` }
  return { auto: true, reason: `Within the ${eur(policy.perActionLimit, { decimals: 0 })} limit` }
}

/**
 * Turns an intent into a journal entry. Returns the change set to commit now:
 * the work itself plus its undo spec when it may run alone, or only the pending entry when it waits.
 */
export function record(s: Snapshot, intent: Intent, actor: Actor, opts: { force?: 'ask' | 'auto' } = {}): { action: AgentAction; cs: ChangeSet; applied: boolean; reason: string } {
  const d = opts.force ? { auto: opts.force === 'auto', reason: opts.force === 'auto' ? 'Applied' : 'Waiting for approval' } : decide(policyOf(s.workspace.settings), intent, spentToday(s))
  const at = new Date().toISOString()
  const base: AgentAction = { id: uid(), kind: intent.kind, risk: intent.risk, title: intent.title, lines: intent.lines, impactEur: intent.impactEur ?? null, cs: intent.cs, undo: null, status: 'pending', source: intent.source, actor, approvedBy: null, reason: d.reason, link: intent.link ?? null, createdAt: at, resolvedAt: null }
  if (!d.auto) return { action: base, cs: { upserts: { actions: [base] } }, applied: false, reason: d.reason }
  const undo = undoSpec(s, intent.cs)
  const action: AgentAction = { ...base, cs: {}, undo: isUndoable(undo) ? undo : null, status: 'applied', resolvedAt: at }
  return { action, cs: mergeChangeSets(intent.cs, { upserts: { actions: [action] } }), applied: true, reason: d.reason }
}

export function approveAction(s: Snapshot, a: AgentAction, actor: Actor): ChangeSet {
  const cs = renumberOrders(s, a.cs)
  const undo = undoSpec(s, cs)
  const done: AgentAction = { ...a, cs: {}, undo: isUndoable(undo) ? undo : null, status: 'applied', resolvedAt: new Date().toISOString(), approvedBy: actor.name, reason: `Approved by ${actor.name}` }
  return mergeChangeSets(cs, { upserts: { actions: [done] } })
}

export function rejectAction(a: AgentAction, actor: Actor): ChangeSet {
  return { upserts: { actions: [{ ...a, status: 'rejected', resolvedAt: new Date().toISOString(), reason: `Dismissed by ${actor.name}` }] } }
}

export function undoAction(s: Snapshot, a: AgentAction, actor: Actor): ChangeSet {
  if (a.status !== 'applied' || !a.undo) return {}
  const back = materializeUndo(s, a.undo, actor)
  return mergeChangeSets(back, {
    upserts: { actions: [{ ...a, status: 'undone', resolvedAt: new Date().toISOString(), reason: `Undone by ${actor.name}` }] },
    events: [event('undo', `Undid “${a.title}”`, actor, null, a.link ?? null)],
  })
}

export const RISK_LABEL: Record<Risk, string> = { reversible: 'Reversible', money: 'Money', outbound: 'Leaves Nau' }
