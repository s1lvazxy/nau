import { describe, expect, it, vi } from 'vitest'
import { createDemoSnapshot } from '~/lib/seed'
import { applyChangeSet } from '~/data/changeset'
import { useOperator, type OperatorEnv } from '../operator'

function ndjson(frames: unknown[]) {
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(c) {
        // split frames across chunks to exercise the line buffer
        const text = frames.map((f) => JSON.stringify(f) + '\n').join('')
        for (let i = 0; i < text.length; i += 37) c.enqueue(enc.encode(text.slice(i, i + 37)))
        c.close()
      },
    }),
    { headers: { 'content-type': 'application/x-ndjson' } },
  )
}

describe('Operator ↔ Claude protocol', () => {
  it('streams, runs tools in the browser, returns tool_result, keeps the transcript append-only', async () => {
    let snap = createDemoSnapshot()
    const env: OperatorEnv = {
      getSnapshot: () => snap,
      commit: async (cs) => {
        snap = applyChangeSet(snap, cs)
      },
      navigate: () => {},
      actor: { kind: 'user', name: 'Test' },
      canWrite: true,
      path: '/app',
      mode: 'local',
    }
    const bodies: any[] = []
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      bodies.push(body)
      if (bodies.length === 1)
        return ndjson([
          { t: 'model', model: 'claude-opus-5-5' },
          { t: 'block' },
          { t: 'thinking', d: 'Checking what is low.' },
          { t: 'block' },
          { t: 'text', d: 'Let me check.' },
          {
            t: 'final',
            message: {
              role: 'assistant',
              stop_reason: 'tool_use',
              content: [
                { type: 'thinking', thinking: 'Checking what is low.', signature: 'sig' },
                { type: 'text', text: 'Let me check.' },
                { type: 'tool_use', id: 'toolu_1', name: 'list_items', input: { status: 'critical' } },
                { type: 'tool_use', id: 'toolu_2', name: 'prepare_transfer', input: { item: 'nope', from: 'x', to: 'y', qty: -3 } },
              ],
            },
          },
        ])
      return ndjson([{ t: 'block' }, { t: 'text', d: 'Two items are critical.' }, { t: 'final', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Two items are critical.' }] } }])
    })
    vi.stubGlobal('fetch', fetchMock)
    useOperator.getState().reset()
    useOperator.setState({ engine: 'claude' })
    await useOperator.getState().send('What is critical?', env)

    const { turns, api } = useOperator.getState()
    // transcript: user → assistant(tool_use) → user(tool_results) → assistant(text)
    expect(api.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(String(api[0].content)).toMatch(/^\[Context: /)
    const results = api[2].content as { type: string; tool_use_id: string; content: string; is_error?: boolean }[]
    expect(results.map((r) => r.tool_use_id)).toEqual(['toolu_1', 'toolu_2'])
    expect(JSON.parse(results[0].content).count).toBeGreaterThan(0)
    expect(results[1].is_error).toBe(true) // invalid input rejected before running
    expect(results[1].content).toMatch(/INVALID_INPUT/)
    // second request carried the full append-only history, thinking block unchanged
    expect(bodies[1].messages[1].content[0]).toEqual({ type: 'thinking', thinking: 'Checking what is low.', signature: 'sig' })
    const turn = turns[1]
    expect(turn.parts.some((p) => p.type === 'thinking')).toBe(true)
    expect(turn.parts.filter((p) => p.type === 'tool').map((p) => (p as { status: string }).status)).toEqual(['done', 'error'])
    expect(turn.parts.at(-1)).toEqual({ type: 'text', text: 'Two items are critical.' })
    expect(turn.finishedAt).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('handles refusals and falls back to the built-in engine on transport errors', async () => {
    const snap = createDemoSnapshot()
    const env: OperatorEnv = { getSnapshot: () => snap, commit: async () => {}, navigate: () => {}, actor: { kind: 'user', name: 'T' }, canWrite: true, path: '/app', mode: 'local' }
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([{ t: 'final', message: { role: 'assistant', stop_reason: 'refusal', content: [] } }])))
    useOperator.getState().reset()
    useOperator.setState({ engine: 'claude' })
    await useOperator.getState().send('something', env)
    expect(JSON.stringify(useOperator.getState().turns[1].parts)).toMatch(/can’t help with that/)

    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    useOperator.getState().reset()
    useOperator.setState({ engine: 'claude' })
    await useOperator.getState().send('what is running low?', env)
    const t = useOperator.getState().turns[1]
    expect(t.engine).toBe('offline')
    expect(t.parts.some((p) => p.type === 'tool')).toBe(true)
    expect(useOperator.getState().api).toEqual([]) // failed exchange rolled back, transcript stays valid
    vi.unstubAllGlobals()
  })
})
