import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState, type RowSelectionState } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArchiveIcon, ArrowDownIcon, ArrowUpIcon, ClipboardTextIcon, DownloadSimpleIcon, MagnifyingGlassIcon, PackageIcon, PlusIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { derive, expiringBatches, STATUS_META, type ItemStats } from '~/lib/analytics'
import { eur, num, qty as fmtQty } from '~/lib/format'
import { cn, downloadFile, fuzzyScore, indexBy, csvCell } from '~/lib/utils'
import { archiveItems, startCount } from '~/data/commands'
import { Button } from '~/components/ui/button'
import { Input, Select, Segmented } from '~/components/ui/form'
import { Badge, Empty, ItemSwatch, PageHeader } from '~/components/ui/primitives'
import { Sparkline } from '~/components/ui/charts'
import { ItemSheet } from '~/components/app/item-dialogs'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'

type StatusFilter = 'all' | 'low' | 'over' | 'dead' | 'expiring' | 'archived'

export const Route = createFileRoute('/app/items/')({
  validateSearch: (s: Record<string, unknown>): { status?: StatusFilter; new?: number; q?: string } => ({
    ...(typeof s.status === 'string' ? { status: s.status as StatusFilter } : {}),
    ...(s.new ? { new: 1 } : {}),
    ...(typeof s.q === 'string' ? { q: s.q } : {}),
  }),
  component: Items,
})

function Items() {
  usePageTitle('Items')
  const s = useSnapshot()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/app/items/' })
  const { commit, actor, canWrite } = useActions()
  const [q, setQ] = useState(search.q ?? '')
  const [cat, setCat] = useState<string>('all')
  const [loc, setLoc] = useState<string>('all')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'status', desc: false }])
  const [selection, setSelection] = useState<RowSelectionState>({})
  const status = search.status ?? 'all'
  const stats = derive(s).stats
  const archived = useMemo(() => s.items.filter((i) => i.archived), [s.items])
  const cats = indexBy(s.categories, (c) => c.id)
  const sups = indexBy(s.suppliers, (c) => c.id)
  const expiringIds = useMemo(() => new Set(expiringBatches(s).map((x) => x.item.id)), [s])

  const rows: ItemStats[] = useMemo(() => {
    let list: ItemStats[] =
      status === 'archived'
        ? archived.map((item) => ({ ...stats[0], item, onHand: 0, byLocation: {}, value: 0, status: 'idle', series: [], cover: 0, daily: 0 }) as ItemStats)
        : stats
    if (status === 'low') list = list.filter((x) => x.status === 'low' || x.status === 'critical' || x.status === 'out')
    if (status === 'over') list = list.filter((x) => x.status === 'over')
    if (status === 'dead') list = list.filter((x) => x.status === 'dead')
    if (status === 'expiring') list = list.filter((x) => expiringIds.has(x.item.id))
    if (cat !== 'all') list = list.filter((x) => x.item.categoryId === cat)
    if (loc !== 'all') list = list.filter((x) => (x.byLocation[loc] ?? 0) > 0)
    if (q.trim()) list = list.filter((x) => fuzzyScore(q, x.item.name) || fuzzyScore(q, x.item.sku) || x.item.barcode === q.trim() || x.item.tags.some((t) => fuzzyScore(q, t)))
    return list
  }, [stats, archived, status, cat, loc, q, expiringIds])

  const order: Record<string, number> = { out: 0, critical: 1, low: 2, dead: 3, over: 4, healthy: 5, idle: 6 }
  const columns = useMemo<ColumnDef<ItemStats>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => <input type="checkbox" aria-label="Select all" className="accent-[var(--accent-9)]" checked={table.getIsAllRowsSelected()} onChange={table.getToggleAllRowsSelectedHandler()} />,
        cell: ({ row }) => <input type="checkbox" aria-label={`Select ${row.original.item.name}`} className="accent-[var(--accent-9)]" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={(e) => e.stopPropagation()} />,
        size: 36,
        enableSorting: false,
      },
      {
        id: 'name',
        header: 'Item',
        accessorFn: (r) => r.item.name,
        cell: ({ row: { original: r } }) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <ItemSwatch name={r.item.name} hue={r.item.hue} size={28} />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-ink">{r.item.name}</div>
              <div className="truncate font-mono text-[11px] text-ink-3">
                {r.item.sku}
                {r.item.categoryId ? ` · ${cats[r.item.categoryId]?.name}` : ''}
              </div>
            </div>
          </div>
        ),
        size: 300,
      },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (r) => order[r.status] * 1000 + Math.min(999, Number.isFinite(r.cover) ? r.cover : 999),
        cell: ({ row: { original: r } }) => (
          <Badge tone={STATUS_META[r.status].tone} dot>
            {STATUS_META[r.status].label}
          </Badge>
        ),
        size: 120,
      },
      {
        id: 'onHand',
        header: 'On hand',
        accessorFn: (r) => r.onHand,
        cell: ({ row: { original: r } }) => (
          <div className="text-right">
            <div className="tabular text-[13px] text-ink">{fmtQty(r.onHand, r.item.unit)}</div>
            {r.onOrder > 0 && <div className="tabular text-[11px] text-info-ink">+{num(r.onOrder)} on order</div>}
          </div>
        ),
        size: 110,
      },
      {
        id: 'cover',
        header: 'Cover',
        accessorFn: (r) => (Number.isFinite(r.cover) ? r.cover : 9999),
        cell: ({ row: { original: r } }) =>
          r.item.tags.includes('daily') ? (
            <div className="text-right text-[12px] text-ink-3">Daily</div>
          ) : (
            <div className={cn('tabular text-right text-[13px]', r.cover < r.leadTime ? 'text-bad-ink' : 'text-ink-2')}>{!Number.isFinite(r.cover) ? '—' : r.cover < 1 ? '<1 d' : `${Math.floor(r.cover)} d`}</div>
          ),
        size: 80,
      },
      {
        id: 'trend',
        header: '30 days',
        enableSorting: false,
        cell: ({ row: { original: r } }) => (r.series.length ? <Sparkline values={r.series} width={84} height={22} tone={r.trend > 0.1 ? 'ok' : r.trend < -0.2 ? 'bad' : 'ink'} /> : null),
        size: 100,
      },
      {
        id: 'value',
        header: 'Value',
        accessorFn: (r) => r.value,
        cell: ({ row: { original: r } }) => <div className="tabular text-right text-[13px] text-ink-2">{eur(r.value, { decimals: 0 })}</div>,
        size: 90,
      },
      {
        id: 'price',
        header: 'Price',
        accessorFn: (r) => r.item.price,
        cell: ({ row: { original: r } }) => <div className="tabular text-right text-[13px] text-ink-2">{eur(r.item.price)}</div>,
        size: 80,
      },
      {
        id: 'supplier',
        header: 'Supplier',
        accessorFn: (r) => sups[r.item.supplierId ?? '']?.name ?? '',
        cell: ({ row: { original: r } }) => <div className="truncate text-[12.5px] text-ink-3">{sups[r.item.supplierId ?? '']?.name ?? '—'}</div>,
        size: 170,
      },
    ],
    [cats, sups],
  )

  const table = useReactTable({ data: rows, columns, state: { sorting, rowSelection: selection }, onSortingChange: setSorting, onRowSelectionChange: setSelection, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (r) => r.item.id, enableRowSelection: canWrite })
  const tableRows = table.getRowModel().rows
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  useEffect(() => setScrollEl(document.getElementById('main')), [])
  const listRef = useRef<HTMLTableSectionElement>(null)
  const virtualizer = useVirtualizer({ count: tableRows.length, getScrollElement: () => scrollEl, estimateSize: () => 52, overscan: 12, scrollMargin: listRef.current?.offsetTop ?? 0 })
  const vItems = virtualizer.getVirtualItems()
  const padTop = vItems.length ? vItems[0].start - virtualizer.options.scrollMargin : 0
  const padBottom = vItems.length ? virtualizer.getTotalSize() - (vItems[vItems.length - 1].end - virtualizer.options.scrollMargin) : 0
  const selected = Object.keys(selection).filter((k) => selection[k])

  const exportCsv = () => {
    const header = ['SKU', 'Name', 'Barcode', 'Category', 'Unit', 'On hand', ...s.locations.map((l) => l.name), 'Cost', 'Price', 'IVA', 'Value', 'Status', 'Supplier']
    const lines = table.getSortedRowModel().rows.map(({ original: r }) => [r.item.sku, r.item.name, r.item.barcode ?? '', cats[r.item.categoryId ?? '']?.name ?? '', r.item.unit, r.onHand, ...s.locations.map((l) => r.byLocation[l.id] ?? 0), r.item.cost, r.item.price, r.item.vatRate, r.value, STATUS_META[r.status].label, sups[r.item.supplierId ?? '']?.name ?? ''])
    const csv = [header, ...lines].map((row) => row.map((c) => csvCell(c)).join(';')).join('\r\n')
    downloadFile(`nau-items-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + csv, 'text/csv;charset=utf-8')
  }

  return (
    <div>
      <PageHeader
        title="Items"
        description={`${stats.length} active items · ${eur(stats.reduce((a, x) => a + x.value, 0), { decimals: 0 })} at cost`}
        actions={
          <>
            <Button icon={<DownloadSimpleIcon size={14} />} onClick={exportCsv}>
              Export
            </Button>
            {canWrite && (
              <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => void navigate({ search: { ...search, new: 1 } })}>
                New item
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={status}
            onChange={(v) => void navigate({ search: { ...search, status: v === 'all' ? undefined : v } })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'low', label: 'Needs stock' },
              { value: 'expiring', label: 'Expiring' },
              { value: 'over', label: 'Overstock' },
              { value: 'dead', label: 'Not moving' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, SKU, barcode…" leading={<MagnifyingGlassIcon size={14} />} className="w-[240px]" aria-label="Search items" />
            <Select size="sm" value={cat} onChange={setCat} className="w-[170px]" aria-label="Category" options={[{ value: 'all', label: 'All categories' }, ...s.categories.map((c) => ({ value: c.id, label: c.name }))]} />
            <Select size="sm" value={loc} onChange={setLoc} className="w-[160px]" aria-label="Location" options={[{ value: 'all', label: 'All locations' }, ...s.locations.map((l) => ({ value: l.id, label: l.name }))]} />
          </div>
        </div>
      </PageHeader>

      {selected.length > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-accent-soft px-5 py-2 backdrop-blur md:px-8">
          <span className="text-[13px] font-medium text-accent-ink">{selected.length} selected</span>
          <Button
            size="sm"
            icon={<ClipboardTextIcon size={13} />}
            onClick={() => {
              const { cs, count } = startCount(s, { name: `Count of ${selected.length} items`, locationId: loc !== 'all' ? loc : s.locations.find((l) => l.isDefault)?.id ?? s.locations[0].id, itemIds: selected }, actor)
              void commit(cs, { success: 'Count started' }).then(() => navigate({ to: '/app/counts/$countId', params: { countId: count.id } }))
            }}
          >
            Count these
          </Button>
          <Button
            size="sm"
            icon={<ArchiveIcon size={13} />}
            onClick={() => {
              const archiving = status !== 'archived'
              void commit(archiveItems(s, selected, archiving, actor), { success: archiving ? 'Archived' : 'Restored', undo: archiveItems(s, selected, !archiving, actor) })
              setSelection({})
            }}
          >
            {status === 'archived' ? 'Restore' : 'Archive'}
          </Button>
          <button className="ml-auto text-[12.5px] text-ink-3 hover:text-ink" onClick={() => setSelection({})}>
            Clear
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty icon={<PackageIcon size={20} />} title={s.items.length ? 'No items match' : 'No items yet'} action={!s.items.length && canWrite ? <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => void navigate({ search: { new: 1 } })}>Add your first item</Button> : undefined}>
          {s.items.length ? 'Try another filter or search.' : 'Add items one by one, import a spreadsheet from Insights, or scan barcodes as deliveries arrive.'}
        </Empty>
      ) : (
        <>
        <ul className="md:hidden">
          {tableRows.map((row) => {
            const r = row.original
            return (
              <li key={row.id}>
                <button type="button" onClick={() => void navigate({ to: '/app/items/$itemId', params: { itemId: row.id } })} className="flex w-full items-center gap-3 border-b border-line px-5 py-3 text-left active:bg-hover">
                  <ItemSwatch name={r.item.name} hue={r.item.hue} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{r.item.name}</span>
                    <span className="tabular block text-[12px] text-ink-3">
                      {fmtQty(r.onHand, r.item.unit)} · {r.item.tags.includes('daily') ? 'daily' : !Number.isFinite(r.cover) ? 'no sales' : r.cover < 1 ? '<1 day' : `${Math.floor(r.cover)} days`} · {eur(r.item.price)}
                    </span>
                  </span>
                  <Badge tone={STATUS_META[r.status].tone} dot>
                    {STATUS_META[r.status].label}
                  </Badge>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[980px] table-fixed border-collapse">
            <thead className="sticky top-0 z-[5] bg-panel/90 backdrop-blur">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-line">
                  {hg.headers.map((h, i) => (
                    <th key={h.id} style={{ width: h.getSize() }} className={cn('h-9 px-3 text-[12px] font-normal text-ink-3 first:pl-5 md:first:pl-8', ['onHand', 'cover', 'value', 'price'].includes(h.id) ? 'text-right' : 'text-left')}>
                      {h.column.getCanSort() ? (
                        <button type="button" onClick={h.column.getToggleSortingHandler()} className={cn('inline-flex items-center gap-1 hover:text-ink', ['onHand', 'cover', 'value', 'price'].includes(h.id) && 'flex-row-reverse')}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {h.column.getIsSorted() === 'asc' ? <ArrowUpIcon size={10} /> : h.column.getIsSorted() === 'desc' ? <ArrowDownIcon size={10} /> : null}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                      {i === 0 && null}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody ref={listRef}>
              {padTop > 0 && (
                <tr>
                  <td style={{ height: padTop }} colSpan={columns.length} />
                </tr>
              )}
              {vItems.map((v) => {
                const row = tableRows[v.index]
                return (
                  <tr
                    key={row.id}
                    data-index={v.index}
                    ref={virtualizer.measureElement}
                    onClick={() => void navigate({ to: '/app/items/$itemId', params: { itemId: row.id } })}
                    onKeyDown={(e) => e.key === 'Enter' && void navigate({ to: '/app/items/$itemId', params: { itemId: row.id } })}
                    tabIndex={0}
                    className={cn('cursor-default border-b border-line transition-colors outline-none hover:bg-hover/50 focus-visible:bg-hover', row.getIsSelected() && 'bg-accent-soft/50')}
                  >
                    {row.getVisibleCells().map((c) => (
                      <td key={c.id} className="h-[52px] px-3 first:pl-5 md:first:pl-8">
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </td>
                    ))}
                  </tr>
                )
              })}
              {padBottom > 0 && (
                <tr>
                  <td style={{ height: padBottom }} colSpan={columns.length} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}
      <ItemSheet key={search.new ? 'new' : 'closed'} open={!!search.new} onOpenChange={(o) => !o && void navigate({ search: { ...search, new: undefined } })} />
    </div>
  )
}
