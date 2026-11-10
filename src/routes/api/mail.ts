import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireMember } from '~/server/auth'
import { serverConfigured } from '~/server/db'
import { json, sameOrigin } from '~/server/guard'
import { deliverOrderEmails, mailConfigured, mailFrom } from '~/server/mail'

/** Whether this installation can send email, and a nudge to deliver what a workspace has queued. */
export const Route = createFileRoute('/api/mail')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!serverConfigured() || !mailConfigured()) return json({ enabled: false })
        const auth = await requireMember(request, new URL(request.url).searchParams.get('workspace'), 'viewer')
        if (!auth.ok) return auth.res
        return json({ enabled: true, from: mailFrom() })
      },
      POST: async ({ request }) => {
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        const parsed = z.object({ workspace: z.string() }).safeParse(await request.json().catch(() => null))
        if (!parsed.success) return json({ error: 'Invalid request' }, 400)
        const auth = await requireMember(request, parsed.data.workspace, 'member')
        if (!auth.ok) return auth.res
        try {
          return json(await deliverOrderEmails(parsed.data.workspace, { replyTo: auth.user.email }))
        } catch (e) {
          console.error('[mail]', e)
          return json({ error: 'Could not send' }, 500)
        }
      },
    },
  },
})
