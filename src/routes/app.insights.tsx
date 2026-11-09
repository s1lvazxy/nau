import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { DownloadSimpleIcon, FileArrowUpIcon, FileCsvIcon, BankIcon, PackageIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { derive, kpis, salesSeries, valueByCategory, valueByLocation } from '~/lib/analytics'
import { atInventoryCSV, parseSAFT } from '~/lib/pt'
import { importSales, itemsFromCSV, parseCSV } from '~/data/commands'
import { date, eur, num, pct } from '~/lib/format'
import { downloadFile, indexBy, round, csvCell } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import { AreaChart, BarList, StackedBar } from '~/components/ui/charts'
import { Select } from '~/components/ui/form'
import { Modal } from '~/components/ui/overlay'
import { Badge, Card, PageHeader, Stat } from '~/components/ui/primitives'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'

export const Route = createFileRoute('/app/insights')({ component: Insights })

function Insights() {
  usePageTitle('Insights')
  const s = useSnapshot()
  const { stats } = derive(s)
  const k = kpis(s)
  const cats = valueByCategory(s)
  const locs = valueByLocation(s)
  const series = salesSeries(s, 90)
  const abc = (['A', 'B', 'C'] as const).map((c) => {
    const g = stats.filter((x) => x.abc === c)
    return { c, n: g.length, rev: round(g.reduce((a, x) => a + x.revenue30, 0)), stock: round(g.reduce((a, x) => a + x.value, 0)) }
  })
  const margin = s.categories
    .map((c) => {
      const g = stats.filter((x) => x.item.categoryId === c.id)
      const rev = g.reduce((a, x) => a + (x.sold30 * x.item.price) / (1 + x.item.vatRate / 100), 0)
      const cogs = g.reduce((a, x) => a + x.cogs30, 0)
      return { id: c.id, name: c.name, hue: c.hue, rev: round(rev), m: rev ? (rev - cogs) / rev : 0 }
    })
    .filter((x) => x.rev > 0)
    .sort((a, b) => b.rev - a.rev)
  const net30 = margin.reduce((a, x) => a + x.rev, 0)
  const grossMargin = net30 ? (net30 - k.d30.cogs) / net30 : 0
  const dead = stats.filter((x) => x.status === 'dead').sort((a, b) => b.value - a.value)
  return (
    <div className="pb-12">
      <PageHeader title="Insights" description="Where the money is, what moves it, and the files your accountant needs." />
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-line px-5 py-5 sm:grid-cols-3 md:px-8 lg:grid-cols-6">
        <Stat label="Stock at cost" value={eur(k.stockValue, { decimals: 0 })} sub={`${eur(k.retailValue, { decimals: 0 })} at retail`} />
        <Stat label="Sales · 30 days" value={eur(k.d30.revenue, { decimals: 0 })} sub={`${num(k.d30.units)} units`} />
        <Stat label="Gross margin" value={pct(grossMargin, 1)} sub="30 days, ex-VAT" />
        <Stat label="Stock turns" value={`${k.turnover}×`} sub="per year, at cost" />
        <Stat label="Days of stock" value={k.turnover ? Math.round(365 / k.turnover) : '—'} sub="average holding" />
        <Stat label="Not moving" value={eur(k.deadValue, { decimals: 0 })} sub={`${k.deadCount} items`} />
      </div>
      <div className="grid gap-4 px-5 py-6 md:px-8 xl:grid-cols-2">
        <Card className="p-5 xl:col-span-2">
          <h2 className="text-[14px] font-medium text-ink">Sales · 90 days</h2>
          <AreaChart className="mt-4" height={220} data={series.map((d) => ({ label: d.day, value: d.revenue }))} xFormat={(l) => date(l, 'short')} format={(v) => eur(v, { decimals: 0, compact: true })} primaryLabel="Sales" />
        </Card>
        <Card className="p-5">
          <h2 className="text-[14px] font-medium text-ink">Stock value by category</h2>
          <StackedBar className="mt-4" height={10} segments={cats.map((c) => ({ key: c.id, value: c.value, color: `oklch(0.74 0.12 ${c.hue})`, label: c.name }))} />
          <BarList className="mt-4" rows={cats.map((c) => ({ key: c.id, label: c.name, value: round(c.value), hue: c.hue }))} format={(v) => eur(v, { decimals: 0 })} />
        </Card>
        <Card className="p-5">
          <h2 className="text-[14px] font-medium text-ink">Gross margin by category · 30 days</h2>
          <ul className="mt-4 flex flex-col">
            {margin.map((m) => (
              <li key={m.id} className="flex items-center gap-3 border-t border-line py-2 text-[13px] first:border-t-0">
                <span className="size-2 rounded-[3px]" style={{ background: `oklch(0.74 0.12 ${m.hue})` }} />
                <span className="flex-1 truncate text-ink-2">{m.name}</span>
                <span className="tabular text-ink-3">{eur(m.rev, { decimals: 0 })}</span>
                <span className="tabular w-14 text-right font-medium text-ink">{pct(m.m)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="text-[14px] font-medium text-ink">ABC classification</h2>
          <p className="mt-1 text-[12.5px] text-ink-3">A-items make 80% of revenue. Count them most often and give them the most safety stock.</p>
          <table className="mt-4 w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3">
                <th className="py-1.5 font-normal">Class</th>
                <th className="py-1.5 text-right font-normal">Items</th>
                <th className="py-1.5 text-right font-normal">Revenue · 30d</th>
                <th className="py-1.5 text-right font-normal">Stock value</th>
              </tr>
            </thead>
            <tbody>
              {abc.map((r) => (
                <tr key={r.c} className="border-t border-line">
                  <td className="py-2">
                    <Badge tone={r.c === 'A' ? 'accent' : r.c === 'B' ? 'info' : 'neutral'}>{r.c}</Badge>
                  </td>
                  <td className="tabular py-2 text-right text-ink-2">{r.n}</td>
                  <td className="tabular py-2 text-right text-ink">{eur(r.rev, { decimals: 0 })}</td>
                  <td className="tabular py-2 text-right text-ink-2">{eur(r.stock, { decimals: 0 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="p-5">
          <h2 className="text-[14px] font-medium text-ink">Stock by location</h2>
          <BarList className="mt-4" rows={locs.map((l) => ({ key: l.location.id, label: l.location.name, value: l.value, hint: `${num(l.units)} units` }))} format={(v) => eur(v, { decimals: 0 })} />
          <h3 className="mt-6 text-[13px] font-medium text-ink">Not moving</h3>
          {dead.length ? <BarList className="mt-3" rows={dead.slice(0, 6).map((x) => ({ key: x.item.id, label: x.item.name, value: x.value, hue: 290 }))} format={(v) => eur(v, { decimals: 0 })} /> : <p className="mt-2 text-[12.5px] text-ink-3">Everything is selling.</p>}
        </Card>
      </div>
      <div className="px-5 md:px-8">
        <h2 className="mb-3 text-[13px] font-medium text-ink-2">Files</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <ATExport />
          <SAFTImport />
          <CSVImport />
        </div>
      </div>
    </div>
  )
}

function FileCard({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <span className="flex size-9 items-center justify-center rounded-[10px] bg-hover text-ink">{icon}</span>
      <div>
        <h3 className="text-[14px] font-medium text-ink">{title}</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{body}</p>
      </div>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">{children}</div>
    </Card>
  )
}

function ATExport() {
  const s = useSnapshot()
  const cats = indexBy(s.categories, (c) => c.id)
  const run = () => {
    const rows = s.items
      .map((i) => ({ i, q: s.levels.filter((l) => l.itemId === i.id).reduce((a, l) => a + l.onHand, 0) }))
      .filter((x) => x.q > 0)
      .map(({ i, q }) => ({ category: cats[i.categoryId ?? '']?.atCategory ?? 'M', code: i.sku, description: i.name, numberCode: i.barcode ?? i.sku, qty: q, unit: i.unit === 'un' ? 'UN' : i.unit.toUpperCase() }))
    downloadFile(`inventario-AT-${s.workspace.nif ?? 'nif'}-${new Date().getFullYear()}.csv`, atInventoryCSV(rows), 'text/csv;charset=utf-8')
    toast.success('Inventory file ready', { description: `${rows.length} products · submit on the Portal das Finanças by 31 January.` })
  }
  return (
    <FileCard icon={<BankIcon size={18} />} title="AT year-end inventory" body="Closing inventory in the Portaria n.º 2/2015 CSV layout — ProductCategory, code, description, quantity, unit. Your accountant submits it by 31 January.">
      <Button size="sm" icon={<DownloadSimpleIcon size={13} />} onClick={run}>
        Export for the AT
      </Button>
    </FileCard>
  )
}

function SAFTImport() {
  const s = useSnapshot()
  const { commit, actor, canWrite } = useActions()
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ file: string; company?: string; period?: string; invoices: number; lines: { code: string; qty: number; date: string }[] } | null>(null)
  const [loc, setLoc] = useState(s.locations.find((l) => l.kind === 'store')?.id ?? s.locations[0].id)
  const result = preview ? importSales(s, preview.lines, loc, actor) : null
  return (
    <FileCard icon={<FileArrowUpIcon size={18} />} title="Import sales from SAF-T (PT)" body="Upload the monthly SAF-T file from your certified invoicing software. Each invoice line becomes a sale; credit notes become returns. Nothing to install.">
      <Button size="sm" disabled={!canWrite} icon={<FileArrowUpIcon size={13} />} onClick={() => input.current?.click()}>
        Choose SAF-T file
      </Button>
      <input
        ref={input}
        type="file"
        accept=".xml,text/xml,application/xml"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          try {
            const r = parseSAFT(await f.text())
            setPreview({ file: f.name, ...r })
          } catch (err) {
            toast.error('Couldn’t read that file', { description: (err as Error).message })
          }
          e.target.value = ''
        }}
      />
      {preview && result && (
        <Modal
          open
          onOpenChange={(o) => !o && setPreview(null)}
          title="Import SAF-T sales"
          description={`${preview.file}${preview.company ? ` · ${preview.company}` : ''}${preview.period ? ` · ${preview.period}` : ''}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!result.matched}
                onClick={() => {
                  void commit(result.cs, { success: `Imported ${result.matched} sales lines` })
                  setPreview(null)
                }}
              >
                Import {result.matched} lines
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4 text-[13px]">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Invoices" value={num(preview.invoices)} />
              <Stat label="Lines matched" value={num(result.matched)} />
              <Stat label="Unknown codes" value={num(result.unmatched.length)} />
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-ink-2">Sold from</span>
              <Select value={loc} onChange={setLoc} options={s.locations.map((l) => ({ value: l.id, label: l.name }))} />
            </label>
            {result.unmatched.length > 0 && <p className="text-[12.5px] text-warn-ink">Codes not in your catalogue (match by SKU or barcode): {result.unmatched.slice(0, 8).join(', ')}{result.unmatched.length > 8 ? '…' : ''}</p>}
          </div>
        </Modal>
      )}
    </FileCard>
  )
}

function CSVImport() {
  const s = useSnapshot()
  const { commit, actor, canWrite } = useActions()
  const input = useRef<HTMLInputElement>(null)
  const exportStock = () => {
    const header = 'sku;name;barcode;category;unit;cost;price;vat;stock'
    const cats = indexBy(s.categories, (c) => c.id)
    const lines = s.items.filter((i) => !i.archived).map((i) => [i.sku, i.name, i.barcode ?? '', cats[i.categoryId ?? '']?.name ?? '', i.unit, i.cost, i.price, i.vatRate, s.levels.filter((l) => l.itemId === i.id).reduce((a, l) => a + l.onHand, 0)].map((c) => csvCell(c)).join(';'))
    downloadFile('nau-catalogue.csv', '﻿' + [header, ...lines].join('\r\n'), 'text/csv;charset=utf-8')
  }
  return (
    <FileCard icon={<FileCsvIcon size={18} />} title="Catalogue CSV" body="Bring items from Excel or another system — Portuguese or English headers (nome, código, pvp, iva, stock…). Existing SKUs are updated, new ones are created.">
      <Button size="sm" disabled={!canWrite} icon={<PackageIcon size={13} />} onClick={() => input.current?.click()}>
        Import items
      </Button>
      <Button size="sm" variant="ghost" icon={<DownloadSimpleIcon size={13} />} onClick={exportStock}>
        Export
      </Button>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv,.txt"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          const rows = parseCSV(await f.text())
          const r = itemsFromCSV(s, rows, actor)
          if (!r.created && !r.updated) toast.error('No items found', { description: 'The file needs at least a name column.' })
          else void commit(r.cs, { success: `Imported ${r.created + r.updated} items`, description: `${r.created} new · ${r.updated} updated` })
          e.target.value = ''
        }}
      />
    </FileCard>
  )
}
