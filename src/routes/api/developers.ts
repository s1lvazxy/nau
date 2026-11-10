import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { assertPublicUrl, ConnectorError } from '~/connectors/http'
import { API_KEY_PREFIX, requireMember } from '~/server/auth'
import { sha256, token } from '~/server/crypto'
import { admin } from '~/server/db'
import { json, sameOrigin } from '~/server/guard'
import { tr } from '~/i18n'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_key'), workspace: z.string(), name: z.string().trim().min(1).max(80), write: z.boolean().optional() }),
  z.object({ action: z.literal('revoke_key'), workspace: z.string(), id: z.string().uuid() }),
  z.object({ action: z.literal('create_webhook'), workspace: z.string(), url: z.string().url().max(500), events: z.array(z.string().max(40)).max(20).optional() }),
  z.object({ action: z.literal('delete_webhook'), workspace: z.string(), id: z.string().uuid() }),
])

/** API keys and outbound webhooks of a workspace. Admins only; a key is shown once, at creation. */
export const Route = createFileRoute('/api/developers')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const workspace = new URL(request.url).searchParams.get('workspace')
        const auth = await requireMember(request, workspace, 'admin')
        if (!auth.ok) return auth.res
        const [keys, hooks] = await Promise.all([
          admin().from('api_keys').select('id, name, prefix, scopes, created_at, last_used_at').eq('workspace_id', workspace!).is('revoked_at', null).order('created_at'),
          admin().from('webhooks').select('id, url, events, active, failures, last_status, last_delivery_at, created_at').eq('workspace_id', workspace!).order('created_at'),
        ])
        return json({ keys: keys.data ?? [], webhooks: hooks.data ?? [] })
      },
      POST: async ({ request }) => {
        if (!sameOrigin(request)) return json({ error: tr('Forbidden') }, 403)
        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return json({ error: tr('Invalid request') }, 400)
        const b = parsed.data
        const auth = await requireMember(request, b.workspace, 'admin')
        if (!auth.ok) return auth.res
        if (b.action === 'create_key') {
          const { count } = await admin().from('api_keys').select('id', { count: 'exact', head: true }).eq('workspace_id', b.workspace).is('revoked_at', null)
          if ((count ?? 0) >= 20) return json({ error: tr('Twenty keys is the limit. Revoke one first.') }, 422)
          const key = `${API_KEY_PREFIX}${token(30)}`
          const { data, error } = await admin().from('api_keys').insert({ workspace_id: b.workspace, name: b.name, prefix: key.slice(0, 10), hash: sha256(key), scopes: b.write ? ['read', 'write'] : ['read'], created_by: auth.user.id }).select('id, name, prefix, scopes, created_at, last_used_at').single()
          if (error) return json({ error: tr('Could not create the key.') }, 500)
          return json({ key, row: data })
        }
        if (b.action === 'revoke_key') {
          await admin().from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', b.id).eq('workspace_id', b.workspace)
          return json({ ok: true })
        }
        if (b.action === 'create_webhook') {
          try {
            await assertPublicUrl(b.url)
          } catch (e) {
            return json({ error: e instanceof ConnectorError ? e.message : tr('That address cannot be used.') }, 422)
          }
          const secret = `whsec_${token(24)}`
          const { data, error } = await admin().from('webhooks').insert({ workspace_id: b.workspace, url: b.url, secret, events: b.events?.length ? b.events : ['*'] }).select('id, url, events, active, failures, last_status, last_delivery_at, created_at').single()
          if (error) return json({ error: tr('Could not create the webhook.') }, 500)
          return json({ secret, row: data })
        }
        await admin().from('webhooks').delete().eq('id', b.id).eq('workspace_id', b.workspace)
        return json({ ok: true })
      },
    },
  },
})
