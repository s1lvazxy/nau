import type { PurchaseOrder, Snapshot } from '~/lib/types'
import { tr } from '~/i18n'
import { event, poEmail } from '~/data/commands'
import { ConnectorError, request } from '~/connectors/http'
import { admin, commit, load } from './db'

/**
 * Outbound email goes through Resend, and only when whoever hosts this installation set it up:
 *   RESEND_API_KEY   an API key from resend.com
 *   NAU_MAIL_FROM    the sender, on a domain verified in Resend, e.g.  Compras <compras@empresa.pt>
 */
export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.NAU_MAIL_FROM)
export const mailFrom = () => process.env.NAU_MAIL_FROM ?? ''

export async function sendMail(m: { to: string; subject: string; text: string; replyTo?: string | null; idempotencyKey: string }): Promise<string> {
  if (!mailConfigured()) throw new ConnectorError('Email is not configured on this installation.')
  const res = await request<{ id: string }>('https://api.resend.com/emails', {
    // A retry of the same order never reaches the supplier twice
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'idempotency-key': m.idempotencyKey },
    json: { from: mailFrom(), to: [m.to], subject: m.subject, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) },
  })
  return res.id
}

const DAY = 86_400_000
const OPERATOR = { kind: 'agent' as const, name: 'Operator' }

/** Sends every purchase order waiting in the queue (of one workspace, or of all) and records the outcome on the order. */
export async function deliverOrderEmails(workspaceId?: string, opts: { replyTo?: string } = {}): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 }
  if (!mailConfigured()) return out
  let q = admin().from('purchase_orders').select('id, workspace_id').eq('email_status', 'queued').order('email_queued_at', { ascending: true }).limit(25)
  if (workspaceId) q = q.eq('workspace_id', workspaceId)
  const { data: queued } = await q
  const snapshots = new Map<string, Snapshot>()
  for (const row of queued ?? []) {
    const ws = row.workspace_id as string
    if (!snapshots.has(ws)) snapshots.set(ws, await load(ws))
    const s = snapshots.get(ws)!
    const po = s.orders.find((o) => o.id === row.id)
    // Only an order that was really sent goes out: a queued flag on a draft or a cancelled order is ignored
    if (!po || po.emailStatus !== 'queued' || po.status !== 'sent') continue
    const supplier = s.suppliers.find((x) => x.id === po.supplierId)
    const finish = async (patch: Partial<PurchaseOrder>, note: string) => {
      const next = { ...po, ...patch }
      await commit(ws, { upserts: { orders: [next] }, events: [event('order', note, OPERATOR, null, `/app/orders/${po.id}`)] })
      s.orders = s.orders.map((o) => (o.id === po.id ? next : o))
    }
    try {
      if (!supplier?.email) throw new ConnectorError(tr('The supplier has no email address.'))
      // An order that waited more than a day was probably dealt with by hand: do not surprise the supplier
      if (!po.emailQueuedAt || Date.now() - new Date(po.emailQueuedAt).getTime() > DAY) throw new ConnectorError(tr('It waited more than a day in the queue.'))
      const mail = poEmail(s, po)
      // The supplier answers a person: whoever pressed Send, or the owner when Operator or the scheduler sent it
      const owner = s.members.find((m) => m.role === 'owner' && m.status === 'active') ?? s.members[0]
      await sendMail({ to: supplier.email, subject: mail.subject, text: mail.body, replyTo: opts.replyTo ?? owner?.email, idempotencyKey: `nau-order/${po.id}/${po.emailQueuedAt}`.slice(0, 250) })
      await finish({ emailStatus: 'sent', emailedAt: new Date().toISOString(), emailError: null }, tr('Emailed {0} to {1}', po.number, supplier.email))
      out.sent++
    } catch (e) {
      const why = e instanceof Error ? e.message.slice(0, 240) : 'error'
      await finish({ emailStatus: 'failed', emailError: why }, tr('Could not email {0}: {1}', po.number, why)).catch(() => undefined)
      out.failed++
    }
  }
  return out
}
