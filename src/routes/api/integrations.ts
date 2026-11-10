import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ConnectorError } from '~/connectors/http'
import { requireMember } from '~/server/auth'
import { secretsConfigured } from '~/server/crypto'
import { admin, serverConfigured } from '~/server/db'
import { json, sameOrigin } from '~/server/guard'
import { connect, disconnect, list, pushStock, setStatus, sync } from '~/server/integrations'
import { runWorkspace } from '~/server/agent-run'
import { tr } from '~/i18n'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('connect'), workspace: z.string(), connector: z.string().max(40), fields: z.record(z.string(), z.string().max(2000)) }),
  z.object({ action: z.enum(['sync', 'disconnect', 'pause', 'resume', 'push']), workspace: z.string(), id: z.string().uuid() }),
])

const origin = (request: Request) => process.env.VITE_SITE_URL?.replace(/\/$/, '') || new URL(request.url).origin
const fail = (e: unknown) => (e instanceof ConnectorError ? json({ error: e.message }, e.status === 404 ? 404 : 422) : (console.error('[integrations]', e), json({ error: tr('Something went wrong on our side.') }, 500)))

export const Route = createFileRoute('/api/integrations')({
  server: {
    handlers: {
      /** Connections of one workspace, without their secrets. `ready` tells the page whether this install can hold connections at all. */
      GET: async ({ request }) => {
        const workspace = new URL(request.url).searchParams.get('workspace')
        const ready = serverConfigured() && secretsConfigured()
        if (!serverConfigured()) return json({ ready: false, reason: 'database', integrations: [] })
        const auth = await requireMember(request, workspace, 'viewer')
        if (!auth.ok) return auth.res
        try {
          return json({ ready, reason: ready ? null : 'secret', integrations: await list(workspace!, origin(request)) })
        } catch (e) {
          return fail(e)
        }
      },
      POST: async ({ request }) => {
        if (!sameOrigin(request)) return json({ error: tr('Forbidden') }, 403)
        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return json({ error: tr('Invalid request') }, 400)
        const b = parsed.data
        // Reading the vendor is ordinary work; credentials and anything that writes outside are for admins
        const auth = await requireMember(request, b.workspace, b.action === 'sync' ? 'member' : 'admin')
        if (!auth.ok) return auth.res
        if (!secretsConfigured()) return json({ error: tr('Set NAU_SECRET_KEY on the server before connecting a system: credentials are stored encrypted with it.') }, 503)
        try {
          if (b.action === 'connect') return json({ integration: await connect(b.workspace, auth.user.id, b.connector, b.fields, origin(request)) })
          if (b.action === 'disconnect') return (await disconnect(b.workspace, b.id), json({ ok: true }))
          if (b.action === 'pause' || b.action === 'resume') return (await setStatus(b.workspace, b.id, b.action === 'pause' ? 'paused' : 'active'), json({ ok: true }))
          if (b.action === 'push') {
            // A person pressed the button: that is the approval. The journal still records what left.
            const out = await pushStock(b.workspace, b.id)
            const at = new Date().toISOString()
            await admin().rpc('apply_changeset_service', {
              p_workspace: b.workspace,
              p_changes: { upserts: { actions: [{ id: crypto.randomUUID(), kind: 'sync', risk: 'outbound', title: tr('Sent stock to {0}', out.name), lines: [tr('{0} of {1} items updated', out.updated, out.total), ...(out.failed.length ? [tr('{0} could not be matched there', out.failed.length)] : [])], cs: {}, status: 'applied', source: 'integration', actor: { kind: 'user', name: auth.user.email }, approved_by: auth.user.email, reason: tr('Sent on request'), link: '/app/integrations', created_at: at, resolved_at: at }] } },
            })
            return json(out)
          }
          let total = { sales: 0, refunds: 0, purchases: 0, created: 0 }
          let more = false
          for (let i = 0; i < 6; i++) {
            const r = await sync(b.id, { workspaceId: b.workspace })
            total = { sales: total.sales + r.report.documents.sales, refunds: total.refunds + r.report.documents.refunds, purchases: total.purchases + r.report.documents.purchases, created: total.created + r.report.products.created }
            more = r.more
            if (!more) break
          }
          // Rules that wait for a sync get their turn now
          if (total.sales + total.refunds + total.purchases > 0) await runWorkspace(b.workspace, { event: 'sync' }).catch((e) => console.error('[integrations] rules after sync', e))
          return json({ ...total, more })
        } catch (e) {
          return fail(e)
        }
      },
    },
  },
})

