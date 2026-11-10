import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowRightIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { adjustStock, onHandAt } from '~/data/commands'
import { itemStats, STATUS_META } from '~/lib/analytics'
import { eur, qty as fmtQty } from '~/lib/format'
import { Badge, ItemSwatch, PageHeader } from '~/components/ui/primitives'
import { Select } from '~/components/ui/form'
import { Scanner } from '~/components/app/scanner'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { tr } from '~/i18n'

export const Route = createFileRoute('/app/scan')({ component: ScanPage })

function ScanPage() {
  usePageTitle(tr('Scanner'))
  const s = useSnapshot()
  const { commit, actor, canWrite } = useActions()
  const [code, setCode] = useState<string | null>(null)
  const [loc, setLoc] = useState(s.locations.find((l) => l.kind === 'store')?.id ?? s.locations[0].id)
  const item = code ? s.items.find((i) => i.barcode === code || i.sku.toLowerCase() === code.toLowerCase()) : undefined
  const st = item ? itemStats(s, item.id) : undefined
  const move = (delta: number, reason: string, type: 'adjustment' | 'waste' = 'adjustment') => {
    if (!item) return
    void commit(adjustStock(s, { itemId: item.id, locationId: loc, delta, reason, type }, actor), { success: `${delta > 0 ? '+' : ''}${delta} ${item.name}`, undo: adjustStock(s, { itemId: item.id, locationId: loc, delta: -delta, reason: tr('Undo') }, actor) })
  }
  return (
    <div className="pb-24">
      <PageHeader title={tr('Scanner')} description={tr('Point at a barcode to see stock, demand and price — and fix the count on the spot.')} />
      <div className="mx-auto flex max-w-[520px] flex-col gap-4 px-5 py-5">
        <Select value={loc} onChange={setLoc} options={s.locations.map((l) => ({ value: l.id, label: l.name }))} aria-label={tr('Location')} />
        <Scanner
          onDetect={(c) => {
            setCode(c)
            if (!s.items.some((i) => i.barcode === c || i.sku.toLowerCase() === c.toLowerCase())) toast.error(tr('Not in your catalogue'), { description: c })
          }}
        />
        {item && st && (
          <div className="flex flex-col gap-4 rounded-[18px] bg-surface p-4 shadow-card">
            <div className="flex items-center gap-3">
              <ItemSwatch name={item.name} hue={item.hue} size={44} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium text-ink">{item.name}</div>
                <div className="text-[12px] text-ink-3">
                  {item.sku} · {eur(item.price)}
                </div>
              </div>
              <Badge tone={STATUS_META[st.status].tone} dot>
                {STATUS_META[st.status].label}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-[12px] bg-surface-2 p-3">
                <div className="tabular text-[22px] font-semibold tracking-[-0.03em] text-ink">{fmtQty(onHandAt(s, item.id, loc), item.unit)}</div>
                <div className="text-[11.5px] text-ink-3">{tr('here')}</div>
              </div>
              <div className="rounded-[12px] bg-surface-2 p-3">
                <div className="tabular text-[22px] font-semibold tracking-[-0.03em] text-ink">{fmtQty(st.onHand, item.unit)}</div>
                <div className="text-[11.5px] text-ink-3">{tr('everywhere')}</div>
              </div>
              <div className="rounded-[12px] bg-surface-2 p-3">
                <div className="tabular text-[22px] font-semibold tracking-[-0.03em] text-ink">{Number.isFinite(st.cover) ? Math.floor(st.cover) : '—'}</div>
                <div className="text-[11.5px] text-ink-3">{tr('days cover')}</div>
              </div>
            </div>
            {canWrite && (
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={() => move(-1, tr('Damaged'), 'waste')} className="press flex h-12 items-center justify-center gap-1.5 rounded-[12px] bg-bad-soft text-[13px] font-medium text-bad-ink">
                  <MinusIcon size={14} /> {tr('Write off')}
                </button>
                <button type="button" onClick={() => move(-1, tr('Recount'))} className="press flex h-12 items-center justify-center gap-1.5 rounded-[12px] bg-hover text-[13px] font-medium text-ink">
                  <MinusIcon size={14} /> {tr('One less')}
                </button>
                <button type="button" onClick={() => move(1, tr('Recount'))} className="press flex h-12 items-center justify-center gap-1.5 rounded-[12px] bg-ink text-[13px] font-medium text-inverse">
                  <PlusIcon size={14} /> {tr('One more')}
                </button>
              </div>
            )}
            <Link to="/app/items/$itemId" params={{ itemId: item.id }} className="flex items-center justify-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
              {tr('Open item')} <ArrowRightIcon size={12} />
            </Link>
          </div>
        )}
        <p className="text-center text-[12px] text-ink-4">{tr('Tip: add Nau to your home screen — it opens straight to the app, full screen.')}</p>
      </div>
    </div>
  )
}
