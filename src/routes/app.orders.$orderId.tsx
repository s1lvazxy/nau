import { useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowLeftIcon, CopyIcon, EnvelopeSimpleIcon, MagicWandIcon, PaperPlaneTiltIcon, PlusIcon, PrinterIcon, TrashIcon, TrayArrowDownIcon, XCircleIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { cancelPO, createPO, poEmail, sendPO, updatePO } from '~/data/commands'
import { derive, poTotal } from '~/lib/analytics'
import { date, eur, qty as fmtQty } from '~/lib/format'
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

export const Route = createFileRoute('/app/orders/$orderId')({ component: OrderPage })

function OrderPage() {
  const { orderId } = Route.useParams()
  const s = useSnapshot()
  const navigate = useNavigate()
  const { commit, actor, canWrite } = useActions()
  const saved = s.orders.find((o) => o.id === orderId)
  usePageTitle(saved?.number ?? 'Order')
  const [po, setPo] = useState<PurchaseOrder | undefined>(saved)
  const items = indexBy(s.items, (x) => x.id)
  const sup = s.suppliers.find((x) => x.id === po?.supplierId)
  const loc = s.locations.find((x) => x.id === po?.locationId)
  const dirty = JSON.stringify(po) !== JSON.stringify(saved)
  const editable = po?.status === 'draft' && canWrite
  const stats = derive(s).byId
  const supplierItems = useMemo(() => s.items.filter((i) => !i.archived && (!sup || i.supplierId === sup.id || !i.supplierId)), [s.items, sup])
  if (!po || !saved) return <Empty title="Order not found" />
  const total = poTotal(po)
  const setLine = (i: number, patch: Partial<PurchaseOrder['lines'][number]>) => setPo({ ...po, lines: po.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  const autofill = () => {
    const lines = [...po.lines]
    for (const st of Object.values(stats)) {
      if (st.item.supplierId !== po.supplierId || st.item.tags.includes('daily')) continue
      if (st.suggestedQty <= 0 || lines.some((l) => l.itemId === st.item.id)) continue
      if (st.status === 'low' || st.status === 'critical' || st.status === 'out' || st.cover < st.leadTime + s.workspace.settings.reviewDays) lines.push({ itemId: st.item.id, qty: st.suggestedQty, unitCost: round(st.lastReceiptCost ?? st.item.cost, 4), received: 0 })
    }
    if (lines.length === po.lines.length) toast('Nothing else needs ordering from this supplier')
    setPo({ ...po, lines })
  }
  const save = () => void commit(updatePO(po), { success: 'Order saved' })
  const email = poEmail(s, po)
  const send = async () => {
    if (dirty) await commit(updatePO(po))
    window.location.href = email.mailto
    try {
      await navigator.clipboard.writeText(`${email.subject}\n\n${email.body}`)
    } catch {
      /* clipboard not available */
    }
    await commit(sendPO(s, po, actor), { success: `${po.number} marked as sent`, description: 'Your email app opened with the order. The text is also on your clipboard.' })
    setPo({ ...po, status: 'sent', sentAt: new Date().toISOString() })
  }
  return (
    <div className="pb-12">
      <div className="flex flex-col gap-4 border-b border-line px-5 pt-5 pb-5 md:px-8 print:hidden">
        <Link to="/app/orders" className="flex w-fit items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink">
          <ArrowLeftIcon size={12} /> Orders
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
                  <Mark size={10} /> Operator
                </Badge>
              )}
            </div>
            <p className="mt-1 text-[13px] text-ink-3">
              {sup?.name} · deliver to {loc?.name} · {po.expectedOn ? `expected ${date(po.expectedOn, 'medium')}` : 'no date yet'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && dirty && (
              <Button variant="primary" onClick={save}>
                Save changes
              </Button>
            )}
            {canWrite && po.status === 'draft' && (
              <Button variant={dirty ? 'secondary' : 'primary'} icon={<PaperPlaneTiltIcon size={14} />} disabled={!po.lines.length} onClick={() => void send()}>
                Send to supplier
              </Button>
            )}
            {canWrite && (po.status === 'sent' || po.status === 'partial') && (
              <Button variant="primary" icon={<TrayArrowDownIcon size={14} />} onClick={() => void navigate({ to: '/app/receive', search: { po: po.id } })}>
                Receive
              </Button>
            )}
            <Menu
              triggerClassName="flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] text-ink-2 shadow-card hover:bg-hover"
              trigger={<>More</>}
              items={[
                { label: 'Email text', icon: <EnvelopeSimpleIcon size={14} />, onSelect: () => void navigator.clipboard?.writeText(`${email.subject}\n\n${email.body}`).then(() => toast.success('Copied the order email')) },
                { label: 'Print or save PDF', icon: <PrinterIcon size={14} />, onSelect: () => window.print() },
                {
                  label: 'Duplicate',
                  icon: <CopyIcon size={14} />,
                  disabled: !canWrite,
                  onSelect: () => {
                    const { cs, po: copy } = createPO(s, { supplierId: po.supplierId, locationId: po.locationId, lines: po.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: l.unitCost })) }, actor)
                    void commit(cs, { success: `${copy.number} created` }).then(() => navigate({ to: '/app/orders/$orderId', params: { orderId: copy.id } }))
                  },
                },
                { separator: true, label: '' },
                { label: 'Cancel order', icon: <XCircleIcon size={14} />, danger: true, disabled: !canWrite || po.status === 'received' || po.status === 'cancelled', onSelect: () => void commit(cancelPO(po, actor), { success: 'Order cancelled' }).then(() => setPo({ ...po, status: 'cancelled' })) },
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
              <p className="text-[20px] font-semibold">Encomenda {po.number}</p>
              <p className="text-[12px] text-ink-2">
                {sup?.name} · NIF {sup?.nif ? formatNIF(sup.nif) : '—'}
                <br />
                Entrega: {loc?.name}
                {loc?.address ? `, ${loc.address}` : ''}
                <br />
                Data pretendida: {po.expectedOn ?? 'a combinar'}
              </p>
            </div>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3">
                <th className="px-4 py-2.5 font-normal">Item</th>
                <th className="w-28 px-2 py-2.5 text-right font-normal">Qty</th>
                <th className="w-28 px-2 py-2.5 text-right font-normal">Unit cost</th>
                <th className="w-28 px-2 py-2.5 text-right font-normal">Total</th>
                {po.status !== 'draft' && <th className="w-24 px-2 py-2.5 text-right font-normal">Received</th>}
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
                        <Select size="sm" value={l.itemId} onChange={(v) => setLine(i, { itemId: v, unitCost: items[v]?.cost ?? 0 })} options={supplierItems.map((x) => ({ value: x.id, label: x.name }))} placeholder="Choose item" />
                      ) : (
                        <>
                          <Link to="/app/items/$itemId" params={{ itemId: l.itemId }} className="text-ink hover:underline">
                            {it?.name ?? 'Unknown item'}
                          </Link>
                          <div className="font-mono text-[11px] text-ink-3">
                            {it?.sku}
                            {st && editable ? ` · ${fmtQty(st.onHand, it?.unit)} on hand · ${Number.isFinite(st.cover) ? Math.floor(st.cover) : '—'} d cover` : ''}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">{editable ? <NumberInput value={l.qty} min={0} onChange={(v) => setLine(i, { qty: v })} className="ml-auto h-7 w-20 text-[12.5px]" aria-label="Quantity" /> : <span className="tabular">{fmtQty(l.qty, it?.unit)}</span>}</td>
                    <td className="px-2 py-2 text-right">{editable ? <NumberInput value={l.unitCost} min={0} onChange={(v) => setLine(i, { unitCost: v })} className="ml-auto h-7 w-24 text-[12.5px]" aria-label="Unit cost" /> : <span className="tabular">{eur(l.unitCost)}</span>}</td>
                    <td className="tabular px-2 py-2 text-right text-ink">{eur(l.qty * l.unitCost)}</td>
                    {po.status !== 'draft' && <td className="tabular px-2 py-2 text-right text-ink-2">{fmtQty(l.received, it?.unit)}</td>}
                    {editable && (
                      <td className="pr-2">
                        <button type="button" aria-label="Remove line" onClick={() => setPo({ ...po, lines: po.lines.filter((_, j) => j !== i) })} className="touch-target flex size-7 items-center justify-center rounded-md text-ink-4 hover:bg-hover hover:text-bad-ink">
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
                    No lines yet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <td className="px-4 py-3 text-[12.5px] text-ink-3">Total before VAT</td>
                <td colSpan={2} />
                <td className="tabular px-2 py-3 text-right text-[14px] font-semibold text-ink">{eur(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
          {editable && (
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3 print:hidden">
              <Button size="sm" icon={<PlusIcon size={13} />} onClick={() => setPo({ ...po, lines: [...po.lines, { itemId: '', qty: 1, unitCost: 0, received: 0 }] })}>
                Add line
              </Button>
              <Button size="sm" icon={<MagicWandIcon size={13} />} onClick={autofill}>
                Fill from demand
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
                  <span>Minimum order</span>
                  <span className="tabular">
                    {eur(total, { decimals: 0 })} / {eur(sup.minOrderValue, { decimals: 0 })}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hover">
                  <div className={`h-full rounded-full ${total >= sup.minOrderValue ? 'bg-ok' : 'bg-warn'}`} style={{ width: `${Math.min(100, (total / Math.max(1, sup.minOrderValue)) * 100)}%` }} />
                </div>
                {total < sup.minOrderValue && <p className="mt-2 text-[12px] text-warn-ink">{eur(sup.minOrderValue - total)} below the minimum — use “Fill from demand” to top up.</p>}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-[12.5px]">
                <div>
                  <div className="text-ink-3">Lead time</div>
                  <div className="text-ink">{sup.leadTimeDays} days</div>
                </div>
                <div>
                  <div className="text-ink-3">Terms</div>
                  <div className="text-ink">{sup.paymentTerms ?? '—'}</div>
                </div>
              </div>
            </Card>
          )}
          {editable && (
            <Card className="p-5">
              <h2 className="text-[14px] font-medium text-ink">Expected delivery</h2>
              <Input type="date" className="mt-3" value={po.expectedOn ?? ''} onChange={(e) => setPo({ ...po, expectedOn: e.target.value })} aria-label="Expected delivery" />
            </Card>
          )}
          <Card className="p-5">
            <h2 className="text-[14px] font-medium text-ink">Email preview</h2>
            <pre className="mt-3 max-h-64 overflow-auto font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{email.body}</pre>
          </Card>
        </div>
      </div>
    </div>
  )
}
