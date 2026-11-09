import { assertPublicUrl } from '~/connectors/http'
import { hmac } from './crypto'
import { admin } from './db'

interface Hook {
  id: string
  workspace_id: string
  url: string
  secret: string
  events: string[]
  cursor: string
  failures: number
}

/**
 * Delivers the activity feed to subscribed endpoints, oldest first, at least once.
 * Each request is signed: `Nau-Signature: t=<unix>,v1=<hex hmac-sha256 of "t.body">`.
 * A hook that fails keeps its place and is tried again on the next tick; after 30 failures in a row it is switched off.
 */
export async function deliverWebhooks(limit = 50): Promise<{ delivered: number; failed: number }> {
  const { data: hooks } = await admin().from('webhooks').select('id, workspace_id, url, secret, events, cursor, failures').eq('active', true).limit(limit)
  let delivered = 0
  let failed = 0
  for (const h of (hooks ?? []) as Hook[]) {
    const { data: events } = await admin().from('events').select('id, kind, title, detail, actor, link, created_at').eq('workspace_id', h.workspace_id).gt('created_at', h.cursor).order('created_at').limit(50)
    let cursor = h.cursor
    let status: number | null = null
    let ok = true
    for (const e of events ?? []) {
      if (!h.events.includes('*') && !h.events.includes(e.kind as string)) {
        cursor = e.created_at as string
        continue
      }
      const body = JSON.stringify({ id: e.id, type: `activity.${e.kind}`, created_at: e.created_at, workspace_id: h.workspace_id, data: { title: e.title, detail: e.detail, actor: e.actor, link: e.link } })
      const t = Math.floor(Date.now() / 1000)
      try {
        const url = await assertPublicUrl(h.url)
        const res = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/json', 'user-agent': 'Nau-Webhooks/1', 'nau-event': `activity.${e.kind}`, 'nau-delivery': e.id as string, 'nau-signature': `t=${t},v1=${hmac(h.secret, `${t}.${body}`)}` }, body })
        status = res.status
        ok = res.ok
      } catch {
        status = 0
        ok = false
      }
      if (!ok) break
      cursor = e.created_at as string
      delivered++
    }
    if (!ok) failed++
    const failures = ok ? 0 : h.failures + 1
    await admin().from('webhooks').update({ cursor, failures, active: failures < 30, ...(status !== null ? { last_status: status, last_delivery_at: new Date().toISOString() } : {}) }).eq('id', h.id)
  }
  return { delivered, failed }
}
