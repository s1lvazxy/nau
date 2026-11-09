import { createFileRoute } from '@tanstack/react-router'
import { safeEqual } from '~/server/crypto'
import { serverConfigured } from '~/server/db'
import { json } from '~/server/guard'
import { tick } from '~/server/tick'

let running = false

/**
 * The scheduler's door. Call it every five minutes with `Authorization: Bearer $CRON_SECRET`:
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-nau/api/cron/tick
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return json({ error: 'Set CRON_SECRET to enable the scheduler.' }, 503)
  if (!safeEqual(request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''), secret)) return json({ error: 'Unauthorized' }, 401)
  if (!serverConfigured()) return json({ error: 'The server database is not configured.' }, 503)
  if (running) return json({ ok: true, skipped: 'a tick is still running' })
  running = true
  try {
    return json({ ok: true, ...(await tick()) })
  } catch (e) {
    console.error('[tick]', e)
    return json({ error: 'Tick failed' }, 500)
  } finally {
    running = false
  }
}

export const Route = createFileRoute('/api/cron/tick')({ server: { handlers: { POST: ({ request }) => handle(request), GET: ({ request }) => handle(request) } } })
