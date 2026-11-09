import Anthropic from '@anthropic-ai/sdk'
import type { Rule, Snapshot } from '~/lib/types'
import { applyChangeSet, isEmpty, type ChangeSet } from '~/data/changeset'
import { autopilotPass } from '~/agent/autopilot'
import { contextLine, executeTool } from '~/agent/executors'
import { HEADLESS_PROMPT, SYSTEM_PROMPT, toolDefinitions, validateToolInput, type ToolName } from '~/agent/schema'
import { admin, commit, load } from './db'

const MODEL = process.env.NAU_AGENT_MODEL || 'claude-opus-5-5'
const TOOLS = toolDefinitions().filter((t) => t.name !== 'open_page') // nobody is looking at a page
const OPERATOR = { kind: 'agent' as const, name: 'Operator' }
type Msg = Anthropic.Beta.BetaMessageParam

export const modelConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY)

/** What a model call needs from the outside world; tests pass their own. */
export type Ask = (messages: Msg[]) => Promise<Pick<Anthropic.Beta.BetaMessage, 'content' | 'stop_reason'>>

const askClaude: Ask = async (messages) => {
  const client = new Anthropic()
  return client.beta.messages
    .stream({
      model: MODEL,
      max_tokens: 12000,
      system: [{ type: 'text', text: `${SYSTEM_PROMPT}\n\n${HEADLESS_PROMPT}` }],
      tools: TOOLS,
      messages,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })
    .finalMessage()
}

/**
 * Operator with nobody at the screen. The same tools as the chat, run on the server against a fresh snapshot;
 * every write goes through the same policy, so anything it may not do alone is left as an approval card.
 */
export async function runHeadless(workspaceId: string, task: string, source: 'rule' | 'autopilot', o: { ask?: Ask; snapshot?: Snapshot; save?: (cs: ChangeSet) => Promise<void> } = {}): Promise<{ report: string; snapshot: Snapshot; toolCalls: number }> {
  const ask = o.ask ?? askClaude
  const save = o.save ?? ((cs: ChangeSet) => commit(workspaceId, cs))
  let snapshot = o.snapshot ?? (await load(workspaceId))
  const messages: Msg[] = [{ role: 'user', content: `${contextLine(snapshot, 'headless')}\n\n${task}` }]
  let report = ''
  let toolCalls = 0
  for (let i = 0; i < 10; i++) {
    const msg = await ask(messages)
    messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] })
    report = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim() || report
    const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (msg.stop_reason !== 'tool_use' || !uses.length) break
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const u of uses) {
      toolCalls++
      const v = validateToolInput(u.name, u.input)
      let content: unknown
      let failed = false
      if (!v.ok || u.name === 'open_page') {
        content = { error: v.ok ? 'No page to open when running alone.' : v.error }
        failed = true
      } else {
        try {
          const exec = executeTool(v.name as ToolName, v.input as Record<string, unknown>, { snapshot, actor: OPERATOR, canWrite: true, source })
          if (exec.apply && !isEmpty(exec.apply)) {
            await save(exec.apply)
            snapshot = applyChangeSet(snapshot, exec.apply)
          }
          content = exec.result
        } catch (e) {
          content = { error: e instanceof Error ? e.message : String(e) }
          failed = true
        }
      }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(content), is_error: failed || undefined })
    }
    messages.push({ role: 'user', content: results })
  }
  return { report: report.slice(0, 1500), snapshot, toolCalls }
}

const HOUR = 3_600_000

/** Is it this rule's turn? Scheduled rules go by the clock in the workspace's timezone; event rules by what happened since. */
export function ruleDue(rule: Rule, s: Snapshot, now = new Date(), event?: 'sync'): boolean {
  if (!rule.enabled) return false
  const last = rule.lastRunAt ? new Date(rule.lastRunAt).getTime() : 0
  const age = now.getTime() - last
  if (rule.trigger === 'on_sync') return event === 'sync' && age > 5 * 60_000
  if (rule.trigger === 'on_receipt') return s.receipts.some((r) => r.status === 'posted' && (r.postedAt ?? '') > (rule.lastRunAt ?? rule.createdAt)) && age > 5 * 60_000
  if (rule.trigger === 'hourly') return age > 55 * 60_000
  const local = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: s.workspace.timezone || 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  // Daily and weekly rules wait for the time of the morning brief
  if (local(now) < (s.workspace.settings.briefTime || '07:30')) return false
  return age > (rule.trigger === 'weekly' ? 7 * 24 - 2 : 22) * HOUR
}

export interface WorkspaceRun {
  workspace: string
  autopilot: { suggestions: number; done: number }
  rules: { name: string; report: string }[]
  skipped?: string
}

/** One pass over a workspace: the deterministic autopilot first, then every standing rule whose turn it is. */
export async function runWorkspace(workspaceId: string, o: { event?: 'sync'; ask?: Ask } = {}): Promise<WorkspaceRun> {
  let s = await load(workspaceId)
  const out: WorkspaceRun = { workspace: s.workspace.name, autopilot: { suggestions: 0, done: 0 }, rules: [] }
  const pass = autopilotPass(s)
  if (!isEmpty(pass)) {
    await commit(workspaceId, pass)
    s = applyChangeSet(s, pass)
    out.autopilot = { suggestions: pass.upserts?.proposals?.filter((p) => p.status === 'pending').length ?? 0, done: pass.upserts?.actions?.length ?? 0 }
  }
  const due = s.rules.filter((r) => ruleDue(r, s, new Date(), o.event))
  if (due.length) {
    if (!o.ask && !modelConfigured()) out.skipped = 'Rules need the AI model (ANTHROPIC_API_KEY).'
    else
      for (const rule of due.slice(0, 5)) {
        let report: string
        try {
          const r = await runHeadless(workspaceId, `Standing rule “${rule.name}”, written by the owner:\n${rule.instruction}\n\nCarry it out now.`, 'rule', { ask: o.ask, snapshot: s })
          s = r.snapshot
          report = r.report || 'Nada a fazer.'
        } catch (e) {
          report = `Não correu: ${e instanceof Error ? e.message.slice(0, 200) : 'erro'}`
        }
        const stamp: ChangeSet = { upserts: { rules: [{ ...rule, lastRunAt: new Date().toISOString(), lastResult: report }] } }
        await commit(workspaceId, stamp)
        s = applyChangeSet(s, stamp)
        out.rules.push({ name: rule.name, report })
      }
  }
  await admin().from('workspaces').update({ agent_ran_at: new Date().toISOString() }).eq('id', workspaceId)
  return out
}
