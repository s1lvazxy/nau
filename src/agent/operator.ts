import { create } from 'zustand'
import type Anthropic from '@anthropic-ai/sdk'
import type { ChangeSet } from '~/data/changeset'
import type { Actor, Snapshot } from '~/lib/types'
import { sleep, uid } from '~/lib/utils'
import { validateToolInput, type ToolName } from './schema'
import { executeTool, contextLine } from './executors'
import { approveAction, rejectAction, undoAction } from './policy'
import { planOffline } from './offline'
import type { ChatPart, ChatTurn, ToolExec } from './types'

export interface OperatorEnv {
  getSnapshot: () => Snapshot | undefined
  commit: (cs: ChangeSet, opts?: { success?: string; description?: string }) => Promise<void>
  navigate: (to: string) => void
  actor: Actor
  canWrite: boolean
  dashboardId?: string | null
  path: string
  mode: 'cloud' | 'local' | 'demo'
  authToken?: string | null
}

type Engine = 'claude' | 'offline'

interface OperatorState {
  open: boolean
  turns: ChatTurn[]
  api: Anthropic.Beta.BetaMessageParam[]
  running: boolean
  engine: Engine | null
  model: string | null
  notes: string[]
  abort: AbortController | null
  setOpen(open: boolean): void
  toggle(): void
  detectEngine(mode: OperatorEnv['mode']): Promise<Engine>
  send(text: string, env: OperatorEnv): Promise<void>
  approve(id: string, env: OperatorEnv): Promise<void>
  reject(id: string, env: OperatorEnv): Promise<void>
  undo(id: string, env: OperatorEnv): Promise<void>
  stop(): void
  reset(): void
}

export async function accessToken(): Promise<string | null> {
  try {
    const { supabase } = await import('~/data/supabase')
    return (await supabase().auth.getSession()).data.session?.access_token ?? null
  } catch {
    return null
  }
}

export const useOperator = create<OperatorState>((set, get) => {
  const patchTurn = (id: string, fn: (t: ChatTurn) => ChatTurn) => set((st) => ({ turns: st.turns.map((t) => (t.id === id ? fn(t) : t)) }))
  const pushPart = (id: string, part: ChatPart) => patchTurn(id, (t) => ({ ...t, parts: [...t.parts, part] }))

  async function runTool(turnId: string, partId: string, name: string, rawInput: unknown, env: OperatorEnv): Promise<{ exec?: ToolExec; error?: string }> {
    const v = validateToolInput(name, rawInput)
    const snapshot = env.getSnapshot()
    if (!v.ok || !snapshot) {
      const error = v.ok ? 'Workspace not loaded' : v.error
      patchTurn(turnId, (t) => ({ ...t, parts: t.parts.map((p) => (p.type === 'tool' && p.id === partId ? { ...p, status: 'error', error } : p)) }))
      return { error }
    }
    let exec: ToolExec
    try {
      exec = executeTool(v.name as ToolName, v.input as Record<string, unknown>, { snapshot, actor: { kind: 'agent', name: 'Operator' }, canWrite: env.canWrite, dashboardId: env.dashboardId, source: 'operator' })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      patchTurn(turnId, (t) => ({ ...t, parts: t.parts.map((p) => (p.type === 'tool' && p.id === partId ? { ...p, status: 'error', error } : p)) }))
      return { error }
    }
    if (exec.apply) await env.commit(exec.apply).catch(() => undefined)
    if (exec.navigate) env.navigate(exec.navigate)
    const failed = !!(exec.result as { error?: string } | null)?.error
    patchTurn(turnId, (t) => ({
      ...t,
      parts: t.parts.map((p) => (p.type === 'tool' && p.id === partId ? { ...p, input: v.input, status: failed ? 'error' : 'done', summary: exec.summary, view: exec.view, error: failed ? exec.summary : undefined } : p)),
    }))
    return { exec }
  }

  async function runOffline(turnId: string, text: string, env: OperatorEnv) {
    const snapshot = env.getSnapshot()
    if (!snapshot) return
    const plan = planOffline(snapshot, text)
    if (plan.thinking) {
      pushPart(turnId, { type: 'thinking', text: plan.thinking, startedAt: Date.now() })
      await sleep(380)
      patchTurn(turnId, (t) => ({ ...t, parts: t.parts.map((p) => (p.type === 'thinking' ? { ...p, done: true, seconds: 1 } : p)) }))
    }
    const results: { name: ToolName; result: any; summary: string }[] = []
    for (const call of plan.calls) {
      if (get().abort?.signal.aborted) return
      const partId = uid()
      pushPart(turnId, { type: 'tool', id: partId, name: call.name, input: call.input, status: 'running' })
      await sleep(220)
      const { exec, error } = await runTool(turnId, partId, call.name, call.input, env)
      results.push({ name: call.name, result: exec?.result ?? { error }, summary: exec?.summary ?? error ?? '' })
    }
    const reply = plan.reply(results)
    pushPart(turnId, { type: 'text', text: '' })
    const words = reply.split(/(\s+)/)
    let acc = ''
    for (let i = 0; i < words.length; i++) {
      if (get().abort?.signal.aborted) break
      acc += words[i]
      if (i % 3 === 0 || i === words.length - 1) {
        const snap = acc
        patchTurn(turnId, (t) => {
          const parts = [...t.parts]
          const last = parts[parts.length - 1]
          if (last?.type === 'text') parts[parts.length - 1] = { ...last, text: snap }
          return { ...t, parts }
        })
        await sleep(14)
      }
    }
  }

  async function streamOnce(turnId: string, env: OperatorEnv, signal: AbortSignal): Promise<Anthropic.Beta.BetaMessage> {
    const token = env.mode === 'cloud' ? await accessToken() : null
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nau-mode': env.mode, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ messages: get().api }),
      signal,
    })
    if (!res.ok || !res.body) {
      const msg = await res.text().catch(() => '')
      throw new Error(res.status === 429 ? 'Operator is busy — try again in a minute.' : msg || `Operator unavailable (${res.status})`)
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let final: Anthropic.Beta.BetaMessage | null = null
    // live parts for this iteration
    const liveStart = (get().turns.find((t) => t.id === turnId)?.parts.length ?? 0)
    let current: 'thinking' | 'text' | null = null
    const appendDelta = (kind: 'thinking' | 'text', d: string) => {
      patchTurn(turnId, (t) => {
        const parts = [...t.parts]
        const last = parts[parts.length - 1]
        if (current === kind && last && last.type === kind) parts[parts.length - 1] = { ...last, text: last.text + d } as ChatPart
        else parts.push(kind === 'thinking' ? { type: 'thinking', text: d, startedAt: Date.now() } : { type: 'text', text: d })
        return { ...t, parts }
      })
      current = kind
    }
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        const ev = JSON.parse(line) as { t: string; d?: string; message?: Anthropic.Beta.BetaMessage; error?: string; name?: string; model?: string }
        if (ev.t === 'thinking' && ev.d) appendDelta('thinking', ev.d)
        else if (ev.t === 'text' && ev.d) appendDelta('text', ev.d)
        else if (ev.t === 'block') current = null
        else if (ev.t === 'final' && ev.message) final = ev.message
        else if (ev.t === 'model' && ev.model) set({ model: ev.model })
        else if (ev.t === 'error') throw new Error(ev.error || 'Operator error')
      }
    }
    if (!final) throw new Error('The response was cut off. Try again.')
    // Replace live parts with the exact content of the final message
    const parts: ChatPart[] = []
    for (const b of final.content) {
      if (b.type === 'thinking') {
        if (b.thinking.trim()) parts.push({ type: 'thinking', text: b.thinking, done: true })
      } else if (b.type === 'text') {
        if (b.text.trim()) parts.push({ type: 'text', text: b.text })
      } else if (b.type === 'tool_use') parts.push({ type: 'tool', id: b.id, name: b.name, input: b.input, status: 'running' })
    }
    patchTurn(turnId, (t) => {
      const before = t.parts.slice(0, liveStart)
      const startedAt = t.parts.slice(liveStart).find((p) => p.type === 'thinking') as Extract<ChatPart, { type: 'thinking' }> | undefined
      const secs = startedAt?.startedAt ? Math.max(1, Math.round((Date.now() - startedAt.startedAt) / 1000)) : undefined
      return { ...t, parts: [...before, ...parts.map((p) => (p.type === 'thinking' ? { ...p, seconds: secs } : p))] }
    })
    return final
  }

  async function runClaude(turnId: string, env: OperatorEnv, signal: AbortSignal) {
    for (let i = 0; i < 8; i++) {
      const final = await streamOnce(turnId, env, signal)
      set((st) => ({ api: [...st.api, { role: 'assistant', content: final.content as Anthropic.Beta.BetaContentBlockParam[] }] }))
      if (final.stop_reason === 'refusal') {
        pushPart(turnId, { type: 'text', text: 'I can’t help with that one. Ask me anything about your stock, sales or suppliers.' })
        return
      }
      const uses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      if (final.stop_reason === 'max_tokens' && uses.length) {
        pushPart(turnId, { type: 'text', text: 'That got long — ask me again more specifically and I’ll keep it shorter.' })
        return
      }
      if (final.stop_reason !== 'tool_use' || !uses.length) return
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const u of uses) {
        if (signal.aborted) return
        const { exec, error } = await runTool(turnId, u.id, u.name, u.input, env)
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(exec ? exec.result : { error }), is_error: !exec || undefined })
      }
      set((st) => ({ api: [...st.api, { role: 'user', content: results }] }))
    }
  }

  return {
    open: false,
    turns: [],
    api: [],
    running: false,
    engine: null,
    model: null,
    notes: [],
    abort: null,
    setOpen: (open) => set({ open }),
    toggle: () => set((s) => ({ open: !s.open })),
    async detectEngine(mode) {
      if (get().engine) return get().engine!
      try {
        const r = await fetch(`/api/agent?mode=${mode}`)
        const j = (await r.json()) as { enabled: boolean; model?: string }
        set({ engine: j.enabled ? 'claude' : 'offline', model: j.model ?? null })
        return j.enabled ? 'claude' : 'offline'
      } catch {
        set({ engine: 'offline' })
        return 'offline'
      }
    },
    async send(text, env) {
      const body = text.trim()
      if (!body || get().running) return
      const snapshot = env.getSnapshot()
      if (!snapshot) return
      const engine = await get().detectEngine(env.mode)
      const userTurn: ChatTurn = { id: uid(), role: 'user', parts: [{ type: 'text', text: body }], createdAt: new Date().toISOString() }
      const turn: ChatTurn = { id: uid(), role: 'assistant', parts: [], createdAt: new Date().toISOString(), engine, streaming: true }
      const abort = new AbortController()
      const base = get().api.length
      set((st) => ({ turns: [...st.turns, userTurn, turn], running: true, abort }))
      try {
        if (engine === 'claude') {
          const notes = get().notes
          const content = `${contextLine(snapshot, env.path)}${notes.length ? `\n[Since your last reply the person: ${notes.join('; ')}]` : ''}\n\n${body}`
          set((st) => ({ api: [...st.api, { role: 'user', content }], notes: [] }))
          await runClaude(turn.id, env, abort.signal)
        } else {
          await runOffline(turn.id, body, env)
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          const message = e instanceof Error ? e.message : String(e)
          if (engine === 'claude') {
            // Keep the transcript valid: roll back this incomplete exchange, then answer offline
            set((st) => ({ api: st.api.slice(0, base) }))
            patchTurn(turn.id, (t) => ({ ...t, engine: 'offline', error: message }))
            await runOffline(turn.id, body, env)
          } else patchTurn(turn.id, (t) => ({ ...t, error: message }))
        }
      } finally {
        patchTurn(turn.id, (t) => ({ ...t, streaming: false, finishedAt: new Date().toISOString() }))
        set({ running: false, abort: null })
      }
    },
    async approve(id, env) {
      const snap = env.getSnapshot()
      const a = snap?.actions.find((x) => x.id === id)
      if (!snap || !a || a.status !== 'pending') return
      await env.commit(approveAction(snap, a, env.actor), { success: 'Approved', description: a.title })
      set((st) => ({ notes: [...st.notes, `approved “${a.title}”`] }))
    },
    async reject(id, env) {
      const a = env.getSnapshot()?.actions.find((x) => x.id === id)
      if (!a || a.status !== 'pending') return
      await env.commit(rejectAction(a, env.actor))
      set((st) => ({ notes: [...st.notes, `dismissed “${a.title}”`] }))
    },
    async undo(id, env) {
      const snap = env.getSnapshot()
      const a = snap?.actions.find((x) => x.id === id)
      if (!snap || !a || a.status !== 'applied' || !a.undo) return
      await env.commit(undoAction(snap, a, env.actor), { success: 'Undone', description: a.title })
      set((st) => ({ notes: [...st.notes, `undid “${a.title}”`] }))
    },
    stop() {
      get().abort?.abort()
      set({ running: false })
    },
    reset() {
      get().abort?.abort()
      set({ turns: [], api: [], running: false, notes: [] })
    },
  }
})
