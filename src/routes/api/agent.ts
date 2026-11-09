import { createFileRoute } from '@tanstack/react-router'
import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT, toolDefinitions } from '~/agent/schema'
import { authorizeModelCall, json, sameOrigin } from '~/server/guard'

const MODEL = process.env.NAU_AGENT_MODEL || 'claude-opus-5-5'
const TOOLS = toolDefinitions()
const MAX_BODY = 600_000

function enabled(mode: string | null) {
  if (!process.env.ANTHROPIC_API_KEY) return false
  if (mode === 'demo' && process.env.NAU_AGENT_DEMO === 'off') return false
  return true
}

function friendly(e: unknown) {
  if (e instanceof Anthropic.RateLimitError) return 'Operator is busy right now. Try again in a minute.'
  if (e instanceof Anthropic.AuthenticationError) return 'Operator isn’t configured correctly (API key).'
  if (e instanceof Anthropic.BadRequestError) return 'Operator couldn’t read that conversation. Start a new chat.'
  if (e instanceof Anthropic.APIConnectionError) return 'Couldn’t reach the model. Check the connection and try again.'
  if (e instanceof Anthropic.APIError) return `Operator error (${e.status ?? 'unknown'}).`
  return 'Something went wrong.'
}

type Msg = Anthropic.Beta.BetaMessageParam

function validMessages(x: unknown): x is Msg[] {
  if (!Array.isArray(x) || x.length === 0 || x.length > 120) return false
  if ((x[0] as Msg)?.role !== 'user') return false
  return x.every((m) => m && typeof m === 'object' && ((m as Msg).role === 'user' || (m as Msg).role === 'assistant') && (typeof (m as Msg).content === 'string' || Array.isArray((m as Msg).content)))
}

export const Route = createFileRoute('/api/agent')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const mode = new URL(request.url).searchParams.get('mode')
        return json({ enabled: enabled(mode), model: enabled(mode) ? MODEL : null })
      },
      POST: async ({ request }) => {
        const mode = request.headers.get('x-nau-mode')
        if (!enabled(mode)) return json({ error: 'Operator model is not configured' }, 503)
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        const auth = await authorizeModelCall(request, 'agent')
        if (!auth.ok) return auth.res
        const raw = await request.text()
        if (raw.length > MAX_BODY) return json({ error: 'Conversation too long — start a new chat.' }, 413)
        let messages: unknown
        try {
          messages = (JSON.parse(raw) as { messages: unknown }).messages
        } catch {
          return json({ error: 'Invalid JSON' }, 400)
        }
        if (!validMessages(messages)) return json({ error: 'Invalid conversation' }, 400)

        const client = new Anthropic()
        const enc = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'))
            try {
              const stream = client.beta.messages.stream(
                {
                  model: MODEL,
                  max_tokens: 16000,
                  system: [{ type: 'text', text: SYSTEM_PROMPT }],
                  tools: TOOLS,
                  messages,
                  thinking: { type: 'adaptive', display: 'summarized' },
                  output_config: { effort: 'medium' },
                  cache_control: { type: 'ephemeral' },
                  betas: ['server-side-fallback-2026-07-01'],
                  fallbacks: 'default',
                },
                { signal: request.signal },
              )
              send({ t: 'model', model: MODEL })
              for await (const ev of stream) {
                if (ev.type === 'content_block_start') send({ t: 'block' })
                else if (ev.type === 'content_block_delta') {
                  if (ev.delta.type === 'text_delta') send({ t: 'text', d: ev.delta.text })
                  else if (ev.delta.type === 'thinking_delta') send({ t: 'thinking', d: ev.delta.thinking })
                }
              }
              const msg = await stream.finalMessage()
              send({ t: 'final', message: { id: msg.id, role: msg.role, content: msg.content, stop_reason: msg.stop_reason, model: msg.model } })
            } catch (e) {
              if (!request.signal.aborted) {
                console.error('[agent]', e)
                send({ t: 'error', error: friendly(e) })
              }
            } finally {
              controller.close()
            }
          },
        })
        return new Response(body, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } })
      },
    },
  },
})
