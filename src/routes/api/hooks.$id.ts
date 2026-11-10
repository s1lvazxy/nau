import { createFileRoute } from '@tanstack/react-router'
import { connectorMeta, type ConnectorId } from '~/connectors/catalog'
import { IMPL } from '~/connectors'
import { serverConfigured } from '~/server/db'
import { clientIp, json, rateLimited } from '~/server/guard'
import { hookSecret, integrationRow, sync } from '~/server/integrations'
import { tr } from '~/i18n'

/**
 * Inbound webhooks from connected systems (Shopify, WooCommerce, Square).
 * A call is only acted on when its signature matches the secret stored with the connection.
 */
export const Route = createFileRoute('/api/hooks/$id')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!serverConfigured()) return json({ error: tr('Not configured') }, 503)
        if (rateLimited(`hook:${clientIp(request)}`, 240, 60_000)) return json({ error: tr('Too many requests') }, 429)
        if (!/^[0-9a-f-]{36}$/i.test(params.id)) return json({ error: tr('Not found') }, 404)
        const body = await request.text()
        if (body.length > 2_000_000) return json({ error: tr('Too large') }, 413)
        let row
        try {
          row = await integrationRow(null, params.id)
        } catch {
          return json({ error: tr('Not found') }, 404)
        }
        const impl = IMPL[row.connector as ConnectorId]
        const secret = hookSecret(row)
        if (!impl?.webhook || !secret) return json({ error: tr('This connection has no webhook secret.') }, 409)
        const url = `${process.env.VITE_SITE_URL?.replace(/\/$/, '') || new URL(request.url).origin}/api/hooks/${row.id}`
        if (!impl.webhook.verify({ headers: request.headers, body, secret, url })) return json({ error: tr('Bad signature') }, 401)
        if (row.status === 'paused') return json({ ok: true, paused: true })
        let batch = null
        try {
          batch = impl.webhook.parse({ headers: request.headers, body })
        } catch {
          return json({ error: tr('Unreadable payload') }, 400)
        }
        if (batch) {
          try {
            await sync(row.id, { batch })
          } catch (e) {
            console.error('[hooks]', connectorMeta(row.connector)?.name, e)
            return json({ error: tr('Could not apply') }, 500) // the vendor retries
          }
          return json({ ok: true })
        }
        // The event carried no lines of its own: read the vendor now, and answer without waiting for it
        void sync(row.id).catch((e) => console.error('[hooks] sync', e))
        return json({ ok: true, queued: true }, 202)
      },
    },
  },
})
