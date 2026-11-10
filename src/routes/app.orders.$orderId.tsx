import { useEffect, useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowLeftIcon, CopyIcon, EnvelopeSimpleIcon, MagicWandIcon, PaperPlaneTiltIcon, PlusIcon, PrinterIcon, TrashIcon, TrayArrowDownIcon, XCircleIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { useMail } from '~/data/mail'
import { cancelPO, createPO, poEmail, queueEmail, sendPO, updatePO } from '~/data/commands'
import { derive, poTotal } from '~/lib/analytics'
import { date, dateTime, eur, qty as fmtQty } from '~/lib/format'
import { indexBy, round } from '~/lib/utils'
import type { PurchaseOrder } from '~/lib/types'
import { Button } from '~/components/ui/button'
import { Input, NumberInput, Select } from '~/components/ui/form'
import { Badge, Card, Empty } from '~/components/ui/primitives'
import { Menu } from '~/components/ui/overlay'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { PO_STATUS } from '~/components/app/labels'
import { Logo, Mark } from '~/components/brand/logo'
import { formatNIF } from '~/lib/pt'
import { tr } from '~/i18n'

export const Route = createFileRoute('/app/orders/$orderId')({ component: OrderPage })

/** The fields a person edits on a draft, to tell unsaved work from what the server changed */
const editableOf = (o?: PurchaseOrder) => (o ? JSON.stringify([o.supplierId, o.locationId, o.lines, o.expectedOn ?? null, o.note ?? null]) : '')

function OrderPage() {
  const { orderId } = Route.useParams()
  const s = useSnapshot()
  const navigate = useNavigate()
  const { commit, actor, canWrite } = useActions()
  const mail = useMail()
  const [sending, setSending] = useState(false)
  const saved = s.orders.find((o) => o.id === orderId)
  usePageTitle(saved?.number ?? tr('Order'))
  const [po, setPo] = useState<PurchaseOrder | undefined>(saved)
  const items = indexBy(s.items, (x) => x.id)
  const sup = s.suppliers.find((x) => x.id === po?.supplierId)
  const loc = s.locations.find((x) => x.id === po?.locationId)
  // Only a draft is edited here. Once sent, the page mirrors the stored order, including what the server did with the email.
  useEffect(() => {
    if (saved && saved.status !== 'draft') setPo(saved)
  }, [saved])
  const dirty = editableOf(po) !== editableOf(saved)
  const editable = po?.status === 'draft' && canWrite
  const stats = derive(s).byId
  const supplierItems = useMemo(() => s.items.filter((i) => !i.archived && (!sup || i.supplierId === sup.id || !i.supplierId)), [s.items, sup])
  if (!po || !saved) return <Empty title={tr('Order not found')} />
  const total = poTotal(po)
  const setLine = (i: number, patch: Partial<PurchaseOrder['lines'][number]>) => setPo({ ...po, lines: po.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  const autofill = () => {
    const lines = [...po.lines]
    for (const st of Object.values(stats)) {
      if (st.item.supplierId !== po.supplierId || st.item.tags.includes('daily')) continue
      if (st.suggestedQty <= 0 || lines.some((l) => l.itemId === st.item.id)) continue
      if (st.status === 'low' || st.status === 'critical' || st.status === 'out' || st.cover < st.leadTime + s.workspace.settings.reviewDays) lines.push({ itemId: st.item.id, qty: st.suggestedQty, unitCost: round(st.lastReceiptCost ?? st.item.cost, 4), received: 0 })
    }
    if (lines.length === po.lines.length) toast(tr('Nothing else needs ordering from this supplier'))
    setPo({ ...po, lines })
  }
  const save = () => void commit(updatePO(po), { success: tr('Order saved') })
  const email = poEmail(s, po)
  // The installation sends the email itself when its host set that up; otherwise the person's own mail app opens
  const viaServer = mail.enabled && Boolean(sup?.email)
  const deliver = async () => {
    try {
      const r = await mail.deliver()
      if (r.failed) toast.error(tr('The email did not go out'), { description: tr('The reason is on the order. You can try again, or send it from your own email.') })
      else if (r.sent) toast.success(tr('Emailed to {0}', sup?.email))
    } catch {
      toast(tr('The email is queued'), { description: tr('It goes out on the next scheduled run.') })
    }
  }
  const sendViaServer = async () => {
    setSending(true)
    try {
      if (dirty) await commit(updatePO(po))
      const cs = sendPO(s, po, actor, { email: true })
      await commit(cs, { success: tr('{0} marked as sent', po.number) })
      setPo(cs.upserts!.orders![0] as PurchaseOrder)
      await deliver()
    } finally {
      setSending(false)
    }
  }
  const retryEmail = async () => {
    setSending(true)
    try {
      await commit({ upserts: { orders: [{ ...saved!, ...queueEmail() }] } })
      await deliver()
    } finally {
      setSending(false)
    }
  }
  const send = async () => {
    if (viaServer) return sendViaServer()
    if (dirty) await commit(updatePO(po))
    window.location.href = email.mailto
    try {
      await navigator.clipboard.writeText(`${email.subject}\n\n${email.body}`)
    } catch {
      /* clipboard not available */
    }
    await commit(sendPO(s, po, actor), { success: tr('{0} marked as sent', po.number), description: tr('Your email app opened with the order. The text is also on your clipboard.') })
    setPo({ ...po, status: 'sent', sentAt: new Date().toISOString() })
  }
  return (
    <div className="pb-12">
      <div className="flex flex-col gap-4 border-b border-line px-5 pt-5 pb-5 md:px-8 print:hidden">
        <Link to="/app/orders" className="flex w-fit items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink">
          <ArrowLeftIcon size={12} /> {tr('Orders')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[21px] font-semibold tracking-[-0.02em] text-ink">{po.number}</h1>
              <Badge tone={PO_STATUS[po.status].tone} dot>
                {PO_STATUS[po.status].label}
              </Badge>
              {po.createdBy === 'agent' && (
                <Badge tone="neutral">
                  <Mark size={10} /> {tr('Operator')}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-[13px] text-ink-3">
              {tr('{0} · deliver to {1} · {2}', sup?.name, loc?.name, po.expectedOn ? tr('expected {0}', date(po.expectedOn, 'medium')) : tr('no date yet'))}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && dirty && (
              <Button variant="primary" onClick={save}>
                {tr('Save changes')}
              </Button>
            )}
            {canWrite && po.status === 'draft' && (
              <Button variant={dirty ? 'secondary' : 'primary'} icon={<PaperPlaneTiltIcon size={14} />} disabled={!po.lines.length || sending} onClick={() => void send()}>
                {viaServer ? tr('Email to supplier') : tr('Send to supplier')}
              </Button>
            )}
            {canWrite && (po.status === 'sent' || po.status === 'partial') && (
              <Button variant="primary" icon={<TrayArrowDownIcon size={14} />} onClick={() => void navigate({ to: '/app/receive', search: { po: po.id } })}>
                {tr('Receive')}
              </Button>
            )}
            <Menu
              triggerClassName="flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] text-ink-2 shadow-card hover:bg-hover"
              trigger={<>{tr('More')}</>}
              items={[
                { label: tr('Email text'), icon: <EnvelopeSimpleIcon size={14} />, onSelect: () => void navigator.clipboard?.writeText(`${email.subject}\n\n${email.body}`).then(() => toast.success(tr('Copied the order email'))) },
                { label: tr('Print or save PDF'), icon: <PrinterIcon size={14} />, onSelect: () => window.print() },
                {
                  label: tr('Duplicate'),
                  icon: <CopyIcon size={14} />,
                  disabled: !canWrite,
                  onSelect: () => {
                    const { cs, po: copy } = createPO(s, { supplierId: po.supplierId, locationId: po.locationId, lines: po.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: l.unitCost })) }, actor)
                    void commit(cs, { success: tr('{0} created', copy.number) }).then(() => navigate({ to: '/app/orders/$orderId', params: { orderId: copy.id } }))
                  },
                },
                { separator: true, label: '' },
                { label: tr('Cancel order'), icon: <XCircleIcon size={14} />, danger: true, disabled: !canWrite || po.status === 'received' || po.status === 'cancelled', onSelect: () => void commit(cancelPO(po, actor), { success: tr('Order cancelled') }).then(() => setPo({ ...po, status: 'cancelled' })) },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-5 py-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_320px] print:block print:p-0">
        <Card className="overflow-hidden print:shadow-none">
          <div className="hidden items-start justify-between p-8 print:flex">
            <div>
              <Logo size={18} />
              <p className="mt-4 text-[12px] text-ink-2">
                {s.workspace.name}
                <br />
                NIF {s.workspace.nif ? formatNIF(s.workspace.nif) : '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[20px] font-semibold">{tr('Encomenda {0}', po.number)}</p>
              <p className="text-[12px] text-ink-2">
                {tr('{0} · NIF {1}', sup?.name, sup?.nif ? formatNIF(sup.nif) : '—')}
                <br />
                {tr('Entrega: {0}{1}', loc?.name, loc?.address ? `, ${loc.address}` : '')}
                <br />
                {tr('Data pretendida: {0}', po.expectedOn ?? tr('a combinar'))}
              </p>
            </div>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3">
                <th className="px-4 py-2.5 font-normal">{tr('Item')}</th>
                <th className="w-28 px-2 py-2.5 text-right font-normal">{tr('Qty')}</th>
                <th className="w-28 px-2 py-2.5 text-right font-normal">{tr('Unit cost')}</th>
                <th className="w-28 px-2 py-2.5 text-right font-normal">{tr('Total')}</th>
                {po.status !== 'draft' && <th className="w-24 px-2 py-2.5 text-right font-normal">{tr('Received')}</th>}
                {editable && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l, i) => {
                const it = items[l.itemId]
                const st = stats[l.itemId]
                return (
                  <tr key={l.itemId + i} className="border-t border-line">
                    <td className="px-4 py-2">
                      {editable && !it ? (
                        <Select size="sm" value={l.itemId} onChange={(v) => setLine(i, { itemId: v, unitCost: items[v]?.cost ?? 0 })} options={supplierItems.map((x) => ({ value: x.id, label: x.name }))} placeholder={tr('Choose item')} />
                      ) : (
                        <>
                          <Link to="/app/items/$itemId" params={{ itemId: l.itemId }} className="text-ink hover:underline">
                            {it?.name ?? tr('Unknown item')}
                          </Link>
                          <div className="font-mono text-[11px] text-ink-3">
                            {it?.sku}
                            {st && editable ? tr(' · {0} on hand · {1} d cover', fmtQty(st.onHand, it?.unit), Number.isFinite(st.cover) ? Math.floor(st.cover) : '—') : ''}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">{editable ? <NumberInput value={l.qty} min={0} onChange={(v) => setLine(i, { qty: v })} className="ml-auto h-7 w-20 text-[12.5px]" aria-label={tr('Quantity')} /> : <span className="tabular">{fmtQty(l.qty, it?.unit)}</span>}</td>
                    <td className="px-2 py-2 text-right">{editable ? <NumberInput value={l.unitCost} min={0} onChange={(v) => setLine(i, { unitCost: v })} className="ml-auto h-7 w-24 text-[12.5px]" aria-label={tr('Unit cost')} /> : <span className="tabular">{eur(l.unitCost)}</span>}</td>
                    <td className="tabular px-2 py-2 text-right text-ink">{eur(l.qty * l.unitCost)}</td>
                    {po.status !== 'draft' && <td className="tabular px-2 py-2 text-right text-ink-2">{fmtQty(l.received, it?.unit)}</td>}
                    {editable && (
                      <td className="pr-2">
                        <button type="button" aria-label={tr('Remove line')} onClick={() => setPo({ ...po, lines: po.lines.filter((_, j) => j !== i) })} className="touch-target flex size-7 items-center justify-center rounded-md text-ink-4 hover:bg-hover hover:text-bad-ink">
                          <TrashIcon size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
              {po.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-ink-3">
                    {tr('No lines yet.')}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <td className="px-4 py-3 text-[12.5px] text-ink-3">{tr('Total before VAT')}</td>
                <td colSpan={2} />
                <td className="tabular px-2 py-3 text-right text-[14px] font-semibold text-ink">{eur(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
          {editable && (
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3 print:hidden">
              <Button size="sm" icon={<PlusIcon size={13} />} onClick={() => setPo({ ...po, lines: [...po.lines, { itemId: '', qty: 1, unitCost: 0, received: 0 }] })}>
                {tr('Add line')}
              </Button>
              <Button size="sm" icon={<MagicWandIcon size={13} />} onClick={autofill}>
                {tr('Fill from demand')}
              </Button>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4 print:hidden">
          {sup && (
            <Card className="p-5">
              <h2 className="text-[14px] font-medium text-ink">{sup.name}</h2>
              <p className="mt-1 text-[12.5px] text-ink-3">
                {sup.contact} · {sup.email}
              </p>
              <div className="mt-4">
                <div className="flex justify-between text-[12px] text-ink-3">
                  <span>{tr('Minimum order')}</span>
                  <span className="tabular">
                    {eur(total, { decimals: 0 })} / {eur(sup.minOrderValue, { decimals: 0 })}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hover">
                  <div className={`h-full rounded-full ${total >= sup.minOrderValue ? 'bg-ok' : 'bg-warn'}`} style={{ width: `${Math.min(100, (total / Math.max(1, sup.minOrderValue)) * 100)}%` }} />
                </div>
                {total < sup.minOrderValue && <p className="mt-2 text-[12px] text-warn-ink">{tr('{0} below the minimum — use “Fill from demand” to top up.', eur(sup.minOrderValue - total))}</p>}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-[12.5px]">
                <div>
                  <div className="text-ink-3">{tr('Lead time')}</div>
                  <div className="text-ink">{tr('{0} days', sup.leadTimeDays)}</div>
                </div>
                <div>
                  <div className="text-ink-3">{tr('Terms')}</div>
                  <div className="text-ink">{sup.paymentTerms ?? '—'}</div>
                </div>
              </div>
            </Card>
          )}
          {editable && (
            <Card className="p-5">
              <h2 className="text-[14px] font-medium text-ink">{tr('Expected delivery')}</h2>
              <Input type="date" className="mt-3" value={po.expectedOn ?? ''} onChange={(e) => setPo({ ...po, expectedOn: e.target.value })} aria-label={tr('Expected delivery')} />
            </Card>
          )}
          <Card className="p-5">
            <h2 className="text-[14px] font-medium text-ink">{tr('Email preview')}</h2>
            {saved.emailStatus === 'sent' && sup?.email && (
              <p className="mt-2 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ok" aria-hidden />
                {tr('Emailed to {0} · {1}', sup.email, saved.emailedAt ? dateTime(saved.emailedAt) : '')}
              </p>
            )}
            {saved.emailStatus === 'queued' && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12.5px] leading-relaxed text-ink-2">
                <span>{tr('Waiting to go out to {0}.', sup?.email ?? '')}</span>
                {canWrite && mail.enabled && (
                  <Button size="sm" disabled={sending} onClick={() => void (setSending(true), deliver().finally(() => setSending(false)))}>
                    {tr('Send now')}
                  </Button>
                )}
              </div>
            )}
            {saved.emailStatus === 'failed' && (
              <div className="mt-2 text-[12.5px] leading-relaxed">
                <p className="text-bad" role="status">
                  {tr('The email did not go out: {0}', saved.emailError ?? '')}
                </p>
                {canWrite && mail.enabled && saved.status === 'sent' && (
                  <Button size="sm" className="mt-2" disabled={sending} onClick={() => void retryEmail()}>
                    {tr('Try again')}
                  </Button>
                )}
              </div>
            )}
            {!saved.emailStatus && po.status === 'draft' && mail.enabled && (
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
                {sup?.email ? tr('Goes out from {0}. The supplier’s reply comes to you.', mail.from) : tr('{0} has no email address, so the order opens in your own email app.', sup?.name ?? tr('supplier'))}
              </p>
            )}
            <pre className="mt-3 max-h-64 overflow-auto font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{email.body}</pre>
          </Card>
        </div>
      </div>
    </div>
  )
}
