import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowCounterClockwiseIcon, DownloadSimpleIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { revertMovement } from '~/data/commands'
import { dateTime, eur, num, signed } from '~/lib/format'
import { cn, downloadFile, fuzzyScore, indexBy, csvCell } from '~/lib/utils'
import type { MovementType } from '~/lib/types'
import { Button } from '~/components/ui/button'
import { Input, Select } from '~/components/ui/form'
import { Badge, PageHeader } from '~/components/ui/primitives'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { Mark } from '~/components/brand/logo'
import { tr } from '~/i18n'

export const Route = createFileRoute('/app/movements')({
  validateSearch: (s: Record<string, unknown>): { item?: string } => (typeof s.item === 'string' ? { item: s.item } : {}),
  component: Ledger,
})

const TYPES: { value: MovementType | 'all'; label: string }[] = [
  { value: 'all', label: tr('All types') },
  { value: 'receipt', label: tr('Received') },
  { value: 'sale', label: tr('Sold') },
  { value: 'transfer', label: tr('Transfers') },
  { value: 'adjustment', label: tr('Adjustments') },
  { value: 'count', label: tr('Counts') },
  { value: 'waste', label: tr('Write-offs') },
  { value: 'return', label: tr('Returns') },
]
const TONE: Record<MovementType, 'neutral' | 'ok' | 'bad' | 'info' | 'warn'> = { sale: 'neutral', receipt: 'ok', waste: 'bad', transfer: 'info', adjustment: 'warn', count: 'warn', return: 'info' }

function Ledger() {
  usePageTitle(tr('Ledger'))
  const s = useSnapshot()
  const search = Route.useSearch()
  const { commit, actor, canWrite } = useActions()
  const [type, setType] = useState<MovementType | 'all'>('all')
  const [loc, setLoc] = useState('all')
  const [q, setQ] = useState('')
  const items = indexBy(s.items, (i) => i.id)
  const locs = indexBy(s.locations, (l) => l.id)
  const reverted = useMemo(() => new Set(s.movements.filter((m) => m.revertsId).map((m) => m.revertsId)), [s.movements])
  const rows = useMemo(() => {
    let list = [...s.movements].reverse()
    if (search.item) list = list.filter((m) => m.itemId === search.item)
    if (type !== 'all') list = list.filter((m) => m.type === type)
    if (loc !== 'all') list = list.filter((m) => m.locationId === loc)
    if (q.trim()) list = list.filter((m) => fuzzyScore(q, items[m.itemId]?.name ?? '') || (m.ref ?? '').toLowerCase().includes(q.toLowerCase()) || m.actor.name.toLowerCase().includes(q.toLowerCase()))
    return list
  }, [s.movements, type, loc, q, search.item, items])
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  useEffect(() => setScroller(document.getElementById('main')), [])
  const body = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller, estimateSize: () => 44, overscan: 20, scrollMargin: body.current?.offsetTop ?? 0 })
  const exportCsv = () => {
    const head = [tr('Date'), tr('Type'), tr('Item'), 'SKU', tr('Location'), tr('Qty'), tr('Unit cost'), tr('Reference'), tr('Note'), tr('By')]
    const lines = rows.map((m) => [m.createdAt, m.type, items[m.itemId]?.name ?? '', items[m.itemId]?.sku ?? '', locs[m.locationId]?.name ?? '', m.qty, m.unitCost ?? '', m.ref ?? '', m.note ?? '', m.actor.name])
    downloadFile(`nau-ledger-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + [head, ...lines].map((r) => r.map((c) => csvCell(c)).join(';')).join('\r\n'), 'text/csv;charset=utf-8')
  }
  const item = search.item ? items[search.item] : undefined
  return (
    <div>
      <PageHeader title={item ? tr('Ledger · {0}', item.name) : tr('Ledger')} description={tr('Every movement, never edited. Mistakes are fixed with a reversing entry, so the history always adds up.')} actions={<Button icon={<DownloadSimpleIcon size={14} />} onClick={exportCsv}>{tr('Export CSV')}</Button>}>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Item, reference or person')} leading={<MagnifyingGlassIcon size={14} />} className="w-[260px]" aria-label={tr('Search ledger')} />
          <Select size="sm" value={type} onChange={setType} options={TYPES} className="w-[150px]" aria-label={tr('Type')} />
          <Select size="sm" value={loc} onChange={setLoc} options={[{ value: 'all', label: tr('All locations') }, ...s.locations.map((l) => ({ value: l.id, label: l.name }))]} className="w-[170px]" aria-label={tr('Location')} />
          {item && (
            <Link to="/app/movements" search={{}} className="text-[12.5px] text-ink-3 hover:text-ink">
              {tr('Clear item filter')}
            </Link>
          )}
          <span className="ml-auto text-[12px] text-ink-3">{tr('{0} movements', num(rows.length))}</span>
        </div>
      </PageHeader>
      <div className="overflow-x-auto">
      <div ref={body} className="relative min-w-[960px]" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((vi) => {
          const m = rows[vi.index]
          const it = items[m.itemId]
          return (
            <div key={m.id} className="group absolute inset-x-0 flex h-11 items-center gap-3 border-b border-line px-5 text-[12.5px] md:px-8" style={{ transform: `translateY(${vi.start - v.options.scrollMargin}px)` }}>
              <span className="w-28 shrink-0 text-ink-3">{dateTime(m.createdAt)}</span>
              <span className="w-24 shrink-0">
                <Badge tone={TONE[m.type]}>{TYPES.find((t) => t.value === m.type)?.label}</Badge>
              </span>
              <Link to="/app/items/$itemId" params={{ itemId: m.itemId }} className="min-w-0 flex-1 truncate text-ink hover:underline">
                {it?.name ?? '—'}
              </Link>
              <span className={cn('tabular w-16 shrink-0 text-right font-medium', m.qty > 0 ? 'text-ok-ink' : 'text-ink')}>{signed(m.qty, Number.isInteger(m.qty) ? 0 : 2)}</span>
              <span className="tabular w-20 shrink-0 text-right text-ink-3">{m.unitCost != null ? eur(Math.abs(m.qty) * m.unitCost, { decimals: 0 }) : ''}</span>
              <span className="w-36 shrink-0 truncate text-ink-2">{locs[m.locationId]?.name}</span>
              <span className="w-40 shrink-0 truncate text-ink-3">{m.note ?? m.ref ?? ''}</span>
              <span className="flex w-32 shrink-0 items-center gap-1.5 truncate text-ink-3">
                {m.actor.kind === 'agent' && <Mark size={11} className="text-accent" />}
                {m.actor.name}
              </span>
              <span className="w-20 shrink-0 text-right">
                {canWrite && m.type !== 'sale' && !m.revertsId && !reverted.has(m.id) ? (
                  <button type="button" onClick={() => void commit(revertMovement(s, m.id, actor), { success: tr('Reverted') })} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100">
                    <ArrowCounterClockwiseIcon size={11} /> {tr('Revert')}
                  </button>
                ) : reverted.has(m.id) ? (
                  <span className="text-[11.5px] text-ink-4">{tr('reverted')}</span>
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
      </div>
    </div>
  )
}
