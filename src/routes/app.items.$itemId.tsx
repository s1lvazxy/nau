import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowCounterClockwiseIcon, ArrowLeftIcon, ArrowsLeftRightIcon, ClipboardTextIcon, DotsThreeIcon, PencilSimpleIcon, SlidersHorizontalIcon, TruckIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { batchesFor, itemStats, projection, STATUS_META } from '~/lib/analytics'
import { createPO, revertMovement, startCount } from '~/data/commands'
import { date, dateTime, eur, num, pct, qty as fmtQty, relative, signed } from '~/lib/format'
import { indexBy } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import { Badge, Card, Empty, ItemSwatch, Stat } from '~/components/ui/primitives'
import { AreaChart } from '~/components/ui/charts'
import { Menu } from '~/components/ui/overlay'
import { AdjustDialog, ItemSheet, TransferDialog } from '~/components/app/item-dialogs'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { useOperator } from '~/agent/operator'
import { useOperatorEnv } from '~/components/app/operator-panel'
import { Mark } from '~/components/brand/logo'

export const Route = createFileRoute('/app/items/$itemId')({ component: ItemPage })

const TYPE_LABEL: Record<string, string> = { receipt: 'Received', sale: 'Sold', adjustment: 'Adjusted', transfer: 'Transfer', count: 'Count', waste: 'Write-off', return: 'Returned' }

function ItemPage() {
  const { itemId } = Route.useParams()
  const s = useSnapshot()
  const navigate = useNavigate()
  const { commit, actor, canWrite } = useActions()
  const env = useOperatorEnv()
  const item = s.items.find((i) => i.id === itemId)
  const st = item ? itemStats(s, item.id) : undefined
  usePageTitle(item?.name ?? 'Item')
  const [adjust, setAdjust] = useState<string | null>(null)
  const [transfer, setTransfer] = useState(false)
  const [edit, setEdit] = useState(false)
  const [days, setDays] = useState(28)
  if (!item) return <Empty title="Item not found">It may have been deleted.</Empty>
  const sup = s.suppliers.find((x) => x.id === item.supplierId)
  const cat = s.categories.find((c) => c.id === item.categoryId)
  const locs = indexBy(s.locations, (l) => l.id)
  const p = st ? projection(s, item.id, days) : []
  const stockout = p.find((d) => d.level <= 0)
  const moves = s.movements.filter((m) => m.itemId === item.id).slice(-40).reverse()
  const lots = batchesFor(s, item.id)
  const reverted = new Set(s.movements.filter((m) => m.revertsId).map((m) => m.revertsId))
  const ask = (q: string) => {
    useOperator.getState().setOpen(true)
    void useOperator.getState().send(q, env)
  }
  const orderNow = () => {
    if (!sup || !st) return
    const { cs, po } = createPO(s, { supplierId: sup.id, lines: [{ itemId: item.id, qty: Math.max(st.suggestedQty, item.reorderQty ?? 1, 1), unitCost: st.lastReceiptCost ?? item.cost }] }, actor)
    void commit(cs, { success: `${po.number} drafted` }).then(() => navigate({ to: '/app/orders/$orderId', params: { orderId: po.id } }))
  }
  return (
    <div className="pb-10">
      <div className="flex flex-col gap-4 border-b border-line px-5 pt-5 pb-5 md:px-8">
        <Link to="/app/items" className="flex w-fit items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink">
          <ArrowLeftIcon size={12} /> Items
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <ItemSwatch name={item.name} hue={item.hue} size={48} />
            <div className="min-w-0">
              <h1 className="truncate text-[21px] font-semibold tracking-[-0.02em] text-ink">{item.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                <span className="font-mono">{item.sku}</span>
                {item.barcode && <span className="font-mono">· {item.barcode}</span>}
                {cat && <span>· {cat.name}</span>}
                {st && (
                  <Badge tone={STATUS_META[st.status].tone} dot>
                    {STATUS_META[st.status].label}
                  </Badge>
                )}
                {item.archived && <Badge tone="muted">Archived</Badge>}
                {item.tags.map((t) => (
                  <Badge key={t} tone="neutral">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={<Mark size={13} className="text-accent" />} onClick={() => ask(`Tell me about ${item.name}: is the stock right, and what should I do?`)}>
              Ask Operator
            </Button>
            {canWrite && (
              <>
                <Button icon={<SlidersHorizontalIcon size={14} />} onClick={() => setAdjust(s.locations.find((l) => l.isDefault)?.id ?? s.locations[0].id)}>
                  Adjust
                </Button>
                {s.locations.length > 1 && (
                  <Button icon={<ArrowsLeftRightIcon size={14} />} onClick={() => setTransfer(true)}>
                    Transfer
                  </Button>
                )}
                <Button variant="primary" icon={<PencilSimpleIcon size={14} />} onClick={() => setEdit(true)}>
                  Edit
                </Button>
                <Menu
                  triggerClassName="flex size-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-hover"
                  trigger={<DotsThreeIcon size={16} weight="bold" />}
                  items={[
                    { label: 'Order now', icon: <TruckIcon size={14} />, disabled: !sup, onSelect: orderNow },
                    {
                      label: 'Count this item',
                      icon: <ClipboardTextIcon size={14} />,
                      onSelect: () => {
                        const { cs, count } = startCount(s, { name: `${item.name} — spot count`, locationId: s.locations.find((l) => l.isDefault)?.id ?? s.locations[0].id, itemIds: [item.id] }, actor)
                        void commit(cs).then(() => navigate({ to: '/app/counts/$countId', params: { countId: count.id } }))
                      },
                    },
                  ]}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {st && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-line px-5 py-5 sm:grid-cols-3 md:px-8 lg:grid-cols-6">
          <Stat label="On hand" value={fmtQty(st.onHand, item.unit)} sub={st.onOrder ? `+${num(st.onOrder)} on order` : undefined} />
          <Stat label="Days of cover" value={Number.isFinite(st.cover) ? (st.cover < 1 ? '<1' : Math.floor(st.cover)) : '—'} sub={`lead time ${st.leadTime} d`} />
          <Stat label="Sells per day" value={num(st.daily, 1)} sub={st.trend ? `${signed(Math.round(st.trend * 100))}% vs prior 2 wks` : 'steady'} />
          <Stat label="Stock value" value={eur(st.value, { decimals: 0 })} sub={`${eur(st.retailValue, { decimals: 0 })} retail`} />
          <Stat label="Gross margin" value={pct(st.margin)} sub={`${eur(item.cost)} cost · ${eur(item.price)} price`} />
          <Stat label="Reorder point" value={fmtQty(st.reorderPoint, item.unit)} sub={item.reorderPoint == null ? `automatic · ABC ${st.abc}` : `manual · ABC ${st.abc}`} />
        </div>
      )}

      <div className="grid gap-4 px-5 py-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-medium text-ink">Projected stock</h2>
                <p className="mt-0.5 text-[12.5px] text-ink-3">
                  {stockout ? (
                    <>
                      Runs out around <span className="font-medium text-bad-ink">{date(stockout.day, 'long')}</span> at the current pace.
                    </>
                  ) : (
                    <>Covered for the next {days} days, including deliveries on the way.</>
                  )}
                </p>
              </div>
              <div className="flex gap-1">
                {[14, 28, 56].map((d) => (
                  <button key={d} type="button" onClick={() => setDays(d)} className={`h-7 rounded-md px-2.5 text-[12px] ${days === d ? 'bg-hover text-ink' : 'text-ink-3 hover:text-ink'}`}>
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <AreaChart className="mt-4" height={220} data={p.map((d) => ({ label: d.day, value: d.level, secondary: d.units, marker: d.holiday ?? (d.incoming ? `+${d.incoming} arriving` : undefined) }))} xFormat={(l) => date(l, 'short')} format={(v) => num(v)} primaryLabel="Stock" secondaryLabel="Demand" threshold={st ? { value: st.reorderPoint, label: 'reorder point' } : undefined} />
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-[14px] font-medium text-ink">Ledger</h2>
              <Link to="/app/movements" search={{ item: item.id }} className="text-[12.5px] text-ink-3 hover:text-ink">
                All movements
              </Link>
            </div>
            {moves.length === 0 ? (
              <p className="px-5 pb-5 text-[13px] text-ink-3">No movements yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[12.5px]">
                  <tbody>
                    {moves.map((m) => (
                      <tr key={m.id} className="group border-t border-line">
                        <td className="w-28 py-2 pl-5 text-ink-3">{dateTime(m.createdAt)}</td>
                        <td className="w-24 py-2">
                          <Badge tone={m.type === 'sale' ? 'neutral' : m.type === 'receipt' ? 'ok' : m.type === 'waste' ? 'bad' : m.type === 'transfer' ? 'info' : 'warn'}>{TYPE_LABEL[m.type]}</Badge>
                        </td>
                        <td className={`tabular w-20 py-2 text-right font-medium ${m.qty > 0 ? 'text-ok-ink' : 'text-ink'}`}>{signed(m.qty, Number.isInteger(m.qty) ? 0 : 2)}</td>
                        <td className="truncate py-2 pl-4 text-ink-2">{locs[m.locationId]?.name}</td>
                        <td className="truncate py-2 text-ink-3">{m.note ?? m.ref ?? ''}</td>
                        <td className="truncate py-2 text-ink-3">{m.actor.name}</td>
                        <td className="w-24 py-2 pr-4 text-right">
                          {canWrite && m.type !== 'sale' && !m.revertsId && !reverted.has(m.id) && (
                            <button type="button" onClick={() => void commit(revertMovement(s, m.id, actor), { success: 'Reverted' })} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100">
                              <ArrowCounterClockwiseIcon size={11} /> Revert
                            </button>
                          )}
                          {reverted.has(m.id) && <span className="text-[11.5px] text-ink-4">reverted</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="text-[14px] font-medium text-ink">By location</h2>
            <ul className="mt-3 flex flex-col">
              {s.locations.map((l) => {
                const q = st?.byLocation[l.id] ?? 0
                const max = Math.max(1, ...Object.values(st?.byLocation ?? {}))
                return (
                  <li key={l.id} className="group flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] text-ink">{l.name}</span>
                        <span className="tabular text-[13px] font-medium text-ink">{fmtQty(q, item.unit)}</span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-hover">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${(q / max) * 100}%` }} />
                      </div>
                    </div>
                    {canWrite && (
                      <button type="button" onClick={() => setAdjust(l.id)} aria-label={`Adjust at ${l.name}`} className="flex size-7 items-center justify-center rounded-md text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100">
                        <SlidersHorizontalIcon size={13} />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>

          {item.tracksExpiry && (
            <Card className="p-5">
              <h2 className="text-[14px] font-medium text-ink">Lots · first expired, first out</h2>
              {lots.length === 0 ? (
                <p className="mt-2 text-[13px] text-ink-3">No lots in stock.</p>
              ) : (
                <ul className="mt-3 flex flex-col">
                  {lots.map((b) => {
                    const d = Math.round((new Date(b.expiresOn).getTime() - Date.now()) / 86400000)
                    return (
                      <li key={b.id} className="flex items-center gap-2 border-t border-line py-2 first:border-t-0">
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-[12px] text-ink">{b.code}</span>
                          <span className="block text-[11.5px] text-ink-3">{locs[b.locationId]?.name}</span>
                        </span>
                        <span className="tabular text-[12.5px] text-ink-2">{fmtQty(b.qty, item.unit)}</span>
                        <Badge tone={d <= 1 ? 'bad' : d <= 4 ? 'warn' : 'neutral'}>{date(b.expiresOn, 'short')}</Badge>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          )}

          <Card className="p-5">
            <h2 className="text-[14px] font-medium text-ink">Supplier</h2>
            {sup ? (
              <div className="mt-3 flex flex-col gap-2 text-[13px]">
                <Link to="/app/suppliers" className="font-medium text-ink hover:underline">
                  {sup.name}
                </Link>
                <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                  <div>
                    <div className="text-ink-3">Lead time</div>
                    <div className="tabular text-ink">{sup.leadTimeDays} days</div>
                  </div>
                  <div>
                    <div className="text-ink-3">Minimum order</div>
                    <div className="tabular text-ink">{eur(sup.minOrderValue, { decimals: 0 })}</div>
                  </div>
                  <div>
                    <div className="text-ink-3">Last cost</div>
                    <div className="tabular text-ink">{st?.lastReceiptCost ? eur(st.lastReceiptCost) : '—'}</div>
                  </div>
                  <div>
                    <div className="text-ink-3">Last sale</div>
                    <div className="text-ink">{st?.lastSaleAt ? relative(st.lastSaleAt) : 'never'}</div>
                  </div>
                </div>
                {canWrite && st && st.suggestedQty > 0 && (
                  <Button size="sm" className="mt-2 w-full" icon={<TruckIcon size={13} />} onClick={orderNow}>
                    Draft an order for {fmtQty(st.suggestedQty, item.unit)}
                  </Button>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[13px] text-ink-3">No supplier set. Add one so Nau can size orders.</p>
            )}
          </Card>
        </div>
      </div>

      {adjust && <AdjustDialog key={adjust} item={item} open onOpenChange={(o) => !o && setAdjust(null)} defaultLocation={adjust} />}
      {transfer && <TransferDialog item={item} open onOpenChange={setTransfer} />}
      {edit && <ItemSheet item={item} open onOpenChange={setEdit} />}
    </div>
  )
}
