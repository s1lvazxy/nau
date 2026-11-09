import { useMemo, useState, type ReactNode } from 'react'
import {
  ArrowsLeftRightIcon,
  BarcodeIcon,
  CalendarCheckIcon,
  ChartLineUpIcon,
  CheckIcon,
  ClipboardTextIcon,
  CompassIcon,
  GaugeIcon,
  HourglassMediumIcon,
  LightningIcon,
  ListChecksIcon,
  MapPinIcon,
  NoteIcon,
  PackageIcon,
  PlusIcon,
  PulseIcon,
  SnowflakeIcon,
  SquaresFourIcon,
  StackIcon,
  SunHorizonIcon,
  TrayArrowDownIcon,
  TrendUpIcon,
  TruckIcon,
  XIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { approveProposal, dismissProposal } from '~/data/commands'
import { STATUS_META, derive, expiringBatches, incomingOrders, itemStats, kpis, morningBrief, poTotal, projection, salesSeries, topMovers, valueByCategory, valueByLocation } from '~/lib/analytics'
import { date, eur, greeting, num, qty as fmtQty, relative } from '~/lib/format'
import type { Snapshot, Widget, WidgetType } from '~/lib/types'
import { cn, indexBy, round } from '~/lib/utils'
import { AnimatedNumber, AreaChart, BarList, Delta, MiniBars, Sparkline, StackedBar } from '~/components/ui/charts'
import { Avatar, Badge, Dot, ItemSwatch } from '~/components/ui/primitives'
import { Mark } from '~/components/brand/logo'
import { useActions } from '~/components/app/actions'

/* ───────────────────────────── Registry ───────────────────────────── */

export interface WidgetDef {
  type: WidgetType
  name: string
  description: string
  icon: Icon
  size: [number, number]
  min: [number, number]
  title: (w: Widget, s: Snapshot) => string
}

export const KPI_METRICS: { value: string; label: string }[] = [
  { value: 'stockValue', label: 'Stock value' },
  { value: 'retailValue', label: 'Retail value' },
  { value: 'revenue7', label: 'Sales · 7 days' },
  { value: 'revenue30', label: 'Sales · 30 days' },
  { value: 'unitsToday', label: 'Units sold today' },
  { value: 'lowCount', label: 'To reorder' },
  { value: 'outCount', label: 'Out of stock' },
  { value: 'deadValue', label: 'Not moving' },
  { value: 'openPOValue', label: 'On order' },
  { value: 'turnover', label: 'Stock turns' },
  { value: 'health', label: 'Stock health' },
  { value: 'margin30', label: 'Gross margin · 30 days' },
]

export const WIDGET_DEFS: Record<WidgetType, WidgetDef> = {
  kpi: { type: 'kpi', name: 'Number', description: 'One metric, big, with its trend.', icon: GaugeIcon, size: [3, 2], min: [2, 2], title: (w) => KPI_METRICS.find((m) => m.value === w.config.metric)?.label ?? 'Metric' },
  health: { type: 'health', name: 'Stock compass', description: 'Health of every category at a glance.', icon: CompassIcon, size: [3, 5], min: [3, 4], title: () => 'Stock compass' },
  brief: { type: 'brief', name: 'Morning brief', description: 'What changed and what needs you.', icon: SunHorizonIcon, size: [5, 5], min: [3, 4], title: () => 'Brief' },
  approvals: { type: 'approvals', name: 'Approvals', description: 'Autopilot suggestions waiting for a yes.', icon: ListChecksIcon, size: [4, 5], min: [3, 4], title: () => 'Waiting for you' },
  lowStock: { type: 'lowStock', name: 'Running low', description: 'Items that will run out first.', icon: HourglassMediumIcon, size: [4, 5], min: [3, 3], title: () => 'Running low' },
  salesTrend: { type: 'salesTrend', name: 'Sales trend', description: 'Daily sales against the previous period.', icon: ChartLineUpIcon, size: [8, 5], min: [4, 4], title: (w) => `Sales · ${w.config.days ?? 30} days` },
  topMovers: { type: 'topMovers', name: 'Best sellers', description: 'This week’s top items by revenue.', icon: TrendUpIcon, size: [4, 5], min: [3, 4], title: () => 'Best sellers · 7 days' },
  categoryMix: { type: 'categoryMix', name: 'Stock by category', description: 'Where your money sits.', icon: StackIcon, size: [4, 5], min: [3, 4], title: () => 'Stock by category' },
  expiry: { type: 'expiry', name: 'Expiry radar', description: 'Lots expiring soon, first-expired-first-out.', icon: SnowflakeIcon, size: [4, 5], min: [3, 3], title: () => 'Expiring soon' },
  activity: { type: 'activity', name: 'Activity', description: 'Everything that happened, by whom.', icon: PulseIcon, size: [6, 5], min: [3, 3], title: () => 'Activity' },
  locations: { type: 'locations', name: 'Locations', description: 'Stock value per location.', icon: MapPinIcon, size: [6, 4], min: [3, 3], title: () => 'Locations' },
  incoming: { type: 'incoming', name: 'Incoming', description: 'Open purchase orders and when they land.', icon: TruckIcon, size: [6, 5], min: [3, 3], title: () => 'Incoming deliveries' },
  note: { type: 'note', name: 'Note', description: 'A sticky note for the team.', icon: NoteIcon, size: [4, 3], min: [2, 2], title: (w) => w.title ?? 'Note' },
  quickActions: { type: 'quickActions', name: 'Quick actions', description: 'Receive, count, scan — one tap away.', icon: LightningIcon, size: [4, 4], min: [3, 3], title: () => 'Quick actions' },
  itemForecast: { type: 'itemForecast', name: 'Item forecast', description: 'Projected stock for one item.', icon: CalendarCheckIcon, size: [6, 5], min: [4, 4], title: (w, s) => s.items.find((i) => i.id === w.config.itemId)?.name ?? 'Item forecast' },
  deadStock: { type: 'deadStock', name: 'Not moving', description: 'Money tied up in items that stopped selling.', icon: PackageIcon, size: [4, 5], min: [3, 3], title: () => 'Not moving' },
}

/* ───────────────────────────── Frame ───────────────────────────── */

export function WidgetFrame({ title, icon, action, children, editing, onRemove, onConfigure, className, bodyClassName, compact }: { title: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; editing?: boolean; onRemove?: () => void; onConfigure?: () => void; className?: string; bodyClassName?: string; compact?: boolean }) {
  return (
    <section className={cn('group/widget flex h-full flex-col overflow-hidden rounded-[16px] bg-surface shadow-card transition-shadow duration-200', editing && 'ring-1 ring-accent-line', className)}>
      <header className={cn('flex h-11 shrink-0 items-center gap-2 px-4', compact && 'h-9', editing && 'drag-handle cursor-grab active:cursor-grabbing')}>
        {icon && <span className="flex text-ink-4">{icon}</span>}
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-medium tracking-[-0.005em] text-ink-3">{title}</h3>
        {editing ? (
          <div className="flex items-center gap-0.5">
            {onConfigure && (
              <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onConfigure} className="rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-3 hover:bg-hover hover:text-ink">
                Edit
              </button>
            )}
            {onRemove && (
              <button type="button" aria-label="Remove widget" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove} className="touch-target flex size-6 items-center justify-center rounded-md text-ink-3 hover:bg-bad-soft hover:text-bad-ink">
                <XIcon size={12} />
              </button>
            )}
          </div>
        ) : (
          action
        )}
      </header>
      <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 [scrollbar-width:thin]', bodyClassName)}>{children}</div>
    </section>
  )
}

function Mini({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-3 transition-colors hover:bg-hover hover:text-ink">
      {children}
    </button>
  )
}

/* ───────────────────────────── KPI ───────────────────────────── */

function KpiWidget({ w }: { w: Widget }) {
  const s = useSnapshot()
  const k = kpis(s)
  const series = salesSeries(s, 14)
  const m = String(w.config.metric ?? 'stockValue')
  const pctChange = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0)
  let value = 0
  let fmt: 'eur' | 'number' = 'number'
  let sub: ReactNode = null
  let spark: number[] | null = null
  let decimals = 0
  switch (m) {
    case 'stockValue':
      value = k.stockValue
      fmt = 'eur'
      sub = <span className="text-ink-3">{eur(k.retailValue, { decimals: 0 })} at retail</span>
      break
    case 'retailValue':
      value = k.retailValue
      fmt = 'eur'
      sub = <span className="text-ink-3">{eur(k.stockValue, { decimals: 0 })} at cost</span>
      break
    case 'revenue7':
      value = k.d7.revenue
      fmt = 'eur'
      sub = (
        <>
          <Delta value={pctChange(k.d7.revenue, k.prev7.revenue)} /> <span className="text-ink-3">vs last week</span>
        </>
      )
      spark = series.map((d) => d.revenue)
      break
    case 'revenue30':
      value = k.d30.revenue
      fmt = 'eur'
      sub = (
        <>
          <Delta value={pctChange(k.d30.revenue, k.prev30.revenue)} /> <span className="text-ink-3">vs previous 30</span>
        </>
      )
      spark = salesSeries(s, 30).map((d) => d.revenue)
      break
    case 'unitsToday':
      value = Math.round(k.today.units)
      sub = <span className="text-ink-3">{eur(k.today.revenue, { decimals: 0 })} so far today</span>
      break
    case 'lowCount':
      value = k.low + k.out
      sub = <span className="text-ink-3">{k.out ? `${k.out} out of stock` : 'none out of stock'}</span>
      break
    case 'outCount':
      value = k.out
      sub = <span className="text-ink-3">still selling, no stock</span>
      break
    case 'deadValue':
      value = k.deadValue
      fmt = 'eur'
      sub = <span className="text-ink-3">{k.deadCount} items · {s.workspace.settings.deadStockDays}+ days</span>
      break
    case 'openPOValue':
      value = k.openPOValue
      fmt = 'eur'
      sub = <span className="text-ink-3">{k.openPOCount} open orders</span>
      break
    case 'turnover':
      value = k.turnover
      decimals = 1
      sub = <span className="text-ink-3">turns a year</span>
      break
    case 'health':
      value = k.health
      sub = <span className="text-ink-3">out of 100</span>
      break
    case 'margin30': {
      const net = k.d30.revenue / 1.1
      value = net ? round(((net - k.d30.cogs) / net) * 100, 1) : 0
      decimals = 1
      sub = <span className="text-ink-3">% gross, ex-VAT</span>
      break
    }
  }
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="flex items-end justify-between gap-3">
        <AnimatedNumber value={value} format={fmt} decimals={decimals} compact={fmt === 'eur'} className="text-[clamp(1.45rem,2.2vw,1.85rem)] leading-none font-medium tracking-[-0.04em] text-ink" />
        {spark && (m === 'revenue7' ? <MiniBars values={spark.slice(-7)} width={78} height={30} /> : <Sparkline values={spark} width={84} height={28} tone="ink" />)}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[12px]">{sub}</div>
    </div>
  )
}

/* ───────────────────────────── Stock compass ───────────────────────────── */

export function StockCompass({ size = 200, className }: { size?: number; className?: string }) {
  const s = useSnapshot()
  const { stats } = derive(s)
  const [hover, setHover] = useState<number | null>(null)
  const cats = useMemo(() => {
    const w: Record<string, number> = { healthy: 1, low: 0.65, over: 0.6, critical: 0.25, out: 0, dead: 0.25, idle: 1 }
    return s.categories
      .map((c) => {
        const list = stats.filter((x) => x.item.categoryId === c.id && x.status !== 'idle')
        if (!list.length) return null
        let n = 0
        let d = 0
        for (const x of list) {
          const weight = Math.sqrt(x.revenue30 + x.value * 0.2 + 1)
          n += w[x.status] * weight
          d += weight
        }
        return { id: c.id, name: c.name, score: d ? n / d : 1, issues: list.filter((x) => x.status !== 'healthy').length }
      })
      .filter(Boolean) as { id: string; name: string; score: number; issues: number }[]
  }, [s, stats])
  const health = kpis(s).health
  const n = Math.max(cats.length, 1)
  const c = 256
  const r0 = 122
  const rMax = 204
  const tone = (v: number) => (v >= 0.82 ? 'var(--gray-12)' : v >= 0.6 ? 'var(--amber-9)' : 'var(--red-9)')
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5)
  return (
    <div className={cn('relative', className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 512 512" width={size} height={size} role="img" aria-label={`Stock health ${health} out of 100`}>
        {/* bezel: 72 bearings, the eight compass points longer */}
        {ticks.map((d) => {
          const major = d % 45 === 0
          return <line key={d} x1={c} y1={c - 246} x2={c} y2={c - (major ? 222 : 236)} stroke={major ? 'var(--gray-a9)' : 'var(--gray-a5)'} strokeWidth={major ? 3 : 2} strokeLinecap="round" transform={`rotate(${d} ${c} ${c})`} />
        })}
        <circle cx={c} cy={c} r={rMax + 10} fill="none" stroke="var(--gray-a3)" strokeWidth={1.5} />
        <circle cx={c} cy={c} r={r0 - 14} fill="none" stroke="var(--gray-a3)" strokeWidth={1.5} strokeDasharray="1 7" strokeLinecap="round" />
        {cats.map((cat, i) => {
          const deg = (i * 360) / n
          const outer = r0 + (rMax - r0) * Math.max(0.1, cat.score)
          const dim = hover != null && hover !== i
          return (
            <g key={cat.id} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} style={{ cursor: 'default' }}>
              <rect x={c - 6} y={c - rMax} width={12} height={rMax - r0} rx={6} fill="var(--gray-a3)" transform={`rotate(${deg} ${c} ${c})`} />
              <rect x={c - 6} y={c - outer} width={12} height={outer - r0} rx={6} fill={tone(cat.score)} opacity={dim ? 0.3 : 1} transform={`rotate(${deg} ${c} ${c})`} style={{ transition: 'opacity 150ms ease' }} />
              <rect x={c - 22} y={c - rMax - 4} width={44} height={rMax - r0 + 8} fill="transparent" transform={`rotate(${deg} ${c} ${c})`} />
            </g>
          )
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {hover != null && cats[hover] ? (
          <>
            <span className="tabular text-[24px] leading-none font-medium tracking-[-0.04em] text-ink">{Math.round(cats[hover].score * 100)}</span>
            <span className="mt-1.5 max-w-[76px] text-center text-[10.5px] leading-tight text-ink-3">{cats[hover].name}</span>
          </>
        ) : (
          <>
            <span className="tabular text-[32px] leading-none font-medium tracking-[-0.05em] text-ink">{health}</span>
            <span className="mt-1.5 font-mono text-[9.5px] tracking-[0.12em] text-ink-4 uppercase">Health</span>
          </>
        )}
      </div>
    </div>
  )
}

function HealthWidget() {
  const s = useSnapshot()
  const { stats } = derive(s)
  const counts = { healthy: 0, low: 0, critical: 0, out: 0, over: 0, dead: 0 }
  for (const x of stats) if (x.status in counts) counts[x.status as keyof typeof counts]++
  return (
    <div className="flex h-full flex-col items-center justify-between gap-3">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <StockCompass size={184} />
      </div>
      <div className="w-full">
        <StackedBar
          height={4}
          segments={[
            { key: 'h', value: counts.healthy, color: 'var(--gray-a8)', label: 'Healthy' },
            { key: 'l', value: counts.low, color: 'var(--amber-9)', label: 'Reorder' },
            { key: 'c', value: counts.critical + counts.out, color: 'var(--red-9)', label: 'Critical' },
            { key: 'o', value: counts.over, color: 'var(--blue-9)', label: 'Overstock' },
            { key: 'd', value: counts.dead, color: 'var(--violet-9)', label: 'Not moving' },
          ]}
        />
        <div className="mt-2.5 grid grid-cols-3 text-[11px] text-ink-3">
          <span><b className="tabular font-medium text-ink">{counts.healthy}</b> healthy</span>
          <span className="text-center"><b className="tabular font-medium text-ink">{counts.low + counts.critical + counts.out}</b> need stock</span>
          <span className="text-right"><b className="tabular font-medium text-ink">{counts.dead + counts.over}</b> too much</span>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────── Brief ───────────────────────────── */

function BriefWidget() {
  const s = useSnapshot()
  const b = morningBrief(s)
  const [lead, ...rest] = b.lines
  const toneOf = (t: string) => (t === 'ok' ? 'ok' : t === 'warn' ? 'warn' : t === 'bad' ? 'bad' : 'info') as 'ok' | 'warn' | 'bad' | 'info'
  return (
    <div className="flex h-full flex-col">
      {lead && <p className="max-w-[40ch] text-[clamp(1.05rem,1.45vw,1.25rem)] leading-snug font-medium tracking-[-0.022em] text-ink">{lead.text}</p>}
      <ul className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto">
        {rest.map((l) => (
          <li key={l.text} className="flex items-baseline gap-2.5 border-t border-line py-2 text-[13px] leading-snug text-ink-2 first:border-t-0">
            <Dot tone={toneOf(l.tone)} className="relative top-[-1px] size-1.5" />
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ───────────────────────────── Approvals ───────────────────────────── */

const KIND_ICON: Record<string, ReactNode> = {
  reorder: <TruckIcon size={14} />,
  transfer: <ArrowsLeftRightIcon size={14} />,
  markdown: <SnowflakeIcon size={14} />,
  deadstock: <PackageIcon size={14} />,
  count: <ClipboardTextIcon size={14} />,
  price: <TrendUpIcon size={14} />,
}

export function ApprovalsList({ limit = 6, compact }: { limit?: number; compact?: boolean }) {
  const s = useSnapshot()
  const { commit, actor, navigate, canWrite } = useActions()
  const pending = s.proposals.filter((p) => p.status === 'pending').sort((a, b) => (b.impactEur ?? 0) - (a.impactEur ?? 0))
  if (!pending.length)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <CheckIcon size={18} className="text-ok" />
        <p className="text-[13px] text-ink-3">Nothing waiting. Autopilot checks again every hour.</p>
      </div>
    )
  return (
    <ul className="flex flex-col">
      {pending.slice(0, limit).map((p) => (
        <li key={p.id} className="group flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-surface-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--gray-a3)]">{KIND_ICON[p.kind]}</span>
          <button type="button" onClick={() => navigate('/app/approvals')} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[13px] text-ink">{p.title}</span>
            {!compact && <span className="block truncate text-[11.5px] text-ink-3">{p.summary}</span>}
          </button>
          {canWrite && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label={`Dismiss ${p.title}`}
                onClick={() => void commit(dismissProposal(p))}
                title="Dismiss"
                className="touch-target flex size-7 items-center justify-center rounded-[8px] text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <XIcon size={12} />
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = approveProposal(s, p, actor)
                  void commit(r.cs, { success: r.message })
                }}
                aria-label={`Approve ${p.title}`}
                title="Approve"
                className="press touch-target flex size-7 items-center justify-center rounded-[8px] bg-hover text-ink shadow-[inset_0_0_0_1px_var(--gray-a4)] hover:bg-ink hover:text-inverse"
              >
                <CheckIcon size={13} weight="bold" />
              </button>
            </div>
          )}
        </li>
      ))}
      {pending.length > limit && (
        <li className="pt-2">
          <button type="button" onClick={() => navigate('/app/approvals')} className="text-[12px] text-ink-3 hover:text-ink">
            +{pending.length - limit} more
          </button>
        </li>
      )}
    </ul>
  )
}

/* ───────────────────────────── Lists ───────────────────────────── */

function LowStockWidget({ w }: { w: Widget }) {
  const s = useSnapshot()
  const { navigate } = useActions()
  const loc = w.config.locationId as string | undefined
  const list = derive(s)
    .stats.filter((x) => (x.status === 'out' || x.status === 'critical' || x.status === 'low') && (!loc || (x.byLocation[loc] ?? 0) <= x.reorderPoint))
    .sort((a, b) => a.cover - b.cover)
    .slice(0, Number(w.config.limit ?? 8))
  if (!list.length) return <p className="pt-6 text-center text-[13px] text-ink-3">Every item is covered past its next delivery.</p>
  return (
    <ul className="flex flex-col">
      {list.map((x) => (
        <li key={x.item.id}>
          <button type="button" onClick={() => navigate(`/app/items/${x.item.id}`)} className="flex w-full items-center gap-2.5 border-t border-line py-2 text-left first:border-t-0 hover:bg-hover/50">
            <ItemSwatch name={x.item.name} hue={x.item.hue} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-ink">{x.item.name}</span>
              <span className="tabular block text-[11px] text-ink-3">
                {fmtQty(x.onHand, x.item.unit)} · {Number.isFinite(x.cover) ? (x.cover < 1 ? '<1 day' : `${Math.floor(x.cover)} days`) : '—'}
                {x.onOrder ? ` · ${x.onOrder} on order` : ''}
              </span>
            </span>
            <Badge tone={STATUS_META[x.status].tone}>{STATUS_META[x.status].label}</Badge>
          </button>
        </li>
      ))}
    </ul>
  )
}

function ExpiryWidget() {
  const s = useSnapshot()
  const { navigate } = useActions()
  const loc = indexBy(s.locations, (l) => l.id)
  const list = expiringBatches(s, Math.max(7, s.workspace.settings.expiryWarnDays)).slice(0, 8)
  if (!list.length) return <p className="pt-6 text-center text-[13px] text-ink-3">Nothing expires this week.</p>
  return (
    <ul className="flex flex-col">
      {list.map((x) => (
        <li key={x.batch.id}>
          <button type="button" onClick={() => navigate(`/app/items/${x.item.id}`)} className="flex w-full items-center gap-2.5 border-t border-line py-2 text-left first:border-t-0">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-ink">{x.item.name}</span>
              <span className="block truncate font-mono text-[10.5px] text-ink-3">
                {x.batch.code} · {loc[x.batch.locationId]?.name} · {fmtQty(x.batch.qty, x.item.unit)}
              </span>
            </span>
            <Badge tone={x.days <= 1 ? 'bad' : x.days <= 3 ? 'warn' : 'neutral'}>{x.days <= 0 ? 'Today' : x.days === 1 ? 'Tomorrow' : `${x.days} days`}</Badge>
          </button>
        </li>
      ))}
    </ul>
  )
}

function DeadStockWidget() {
  const s = useSnapshot()
  const { navigate } = useActions()
  const list = derive(s)
    .stats.filter((x) => x.status === 'dead')
    .sort((a, b) => b.value - a.value)
  if (!list.length) return <p className="pt-6 text-center text-[13px] text-ink-3">Everything is moving.</p>
  return (
    <BarList
      rows={list.slice(0, 7).map((x) => ({ key: x.item.id, label: x.item.name, value: x.value, hue: 290, hint: x.lastSaleAt ? relative(x.lastSaleAt) : 'never', onClick: () => navigate(`/app/items/${x.item.id}`) }))}
      format={(v) => eur(v, { decimals: 0 })}
    />
  )
}

function TopMoversWidget() {
  const s = useSnapshot()
  const { navigate } = useActions()
  const list = topMovers(s, 7)
  return <BarList rows={list.map((x) => ({ key: x.item.id, label: x.item.name, value: round(x.sold7 * x.item.price), hue: x.item.hue, onClick: () => navigate(`/app/items/${x.item.id}`) }))} format={(v) => eur(v, { decimals: 0 })} />
}

function CategoryMixWidget() {
  const s = useSnapshot()
  const rows = valueByCategory(s)
  const total = rows.reduce((a, r) => a + r.value, 0)
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="flex h-full flex-col gap-2.5 overflow-y-auto">
      {rows.map((r, i) => (
        <li key={r.id} className="text-[12.5px]">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-ink-2">{r.name}</span>
            <span className="tabular text-ink">{eur(r.value, { decimals: 0 })}</span>
            <span className="tabular w-8 text-right text-[11.5px] text-ink-4">{total ? Math.round((r.value / total) * 100) : 0}%</span>
          </div>
          <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-hover">
            <div className={cn('h-full rounded-full', i === 0 ? 'bg-accent' : 'bg-[var(--gray-a8)]')} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function LocationsWidget() {
  const s = useSnapshot()
  const rows = valueByLocation(s)
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="grid h-full grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
      {rows.map((r) => (
        <div key={r.location.id} className="flex flex-col justify-between rounded-[12px] bg-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--gray-a3)]">
          <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
            <MapPinIcon size={12} /> {r.location.name}
          </div>
          <div>
            <div className="tabular mt-2 text-[20px] font-medium tracking-[-0.03em] text-ink">{eur(r.value, { decimals: 0 })}</div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-hover">
              <div className={cn('h-full rounded-full', r.value === max ? 'bg-accent' : 'bg-[var(--gray-a8)]')} style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
            <div className="tabular mt-1.5 text-[11px] text-ink-3">{num(r.units)} units · {r.location.kind}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function IncomingWidget() {
  const s = useSnapshot()
  const { navigate } = useActions()
  const sup = indexBy(s.suppliers, (x) => x.id)
  const list = incomingOrders(s)
  const drafts = s.orders.filter((o) => o.status === 'draft')
  if (!list.length && !drafts.length) return <p className="pt-6 text-center text-[13px] text-ink-3">No deliveries on the way.</p>
  return (
    <ul className="flex flex-col">
      {[...list, ...drafts].slice(0, 7).map((po) => {
        const today = po.expectedOn === new Date().toISOString().slice(0, 10)
        return (
          <li key={po.id}>
            <button type="button" onClick={() => navigate(`/app/orders/${po.id}`)} className="flex w-full items-center gap-3 border-t border-line py-2.5 text-left first:border-t-0">
              <span className="w-12 shrink-0 text-center">
                <span className="block font-mono text-[10px] text-ink-3 uppercase">{po.expectedOn ? date(po.expectedOn, 'short').split(' ')[1] : '—'}</span>
                <span className="tabular block text-[18px] leading-none font-medium tracking-[-0.03em] text-ink">{po.expectedOn ? po.expectedOn.slice(8, 10) : '·'}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-ink">{sup[po.supplierId]?.name}</span>
                <span className="block text-[11px] text-ink-3">
                  {po.number} · {po.lines.length} lines · {eur(poTotal(po), { decimals: 0 })}
                </span>
              </span>
              {po.status === 'draft' ? <Badge tone="muted">Draft</Badge> : today ? <Badge tone="accent" dot>Today</Badge> : <Badge tone="info">{po.status === 'partial' ? 'Partial' : 'Sent'}</Badge>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function ActivityWidget() {
  const s = useSnapshot()
  const events = s.events.slice(0, 12)
  return (
    <ul className="flex flex-col">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 border-t border-line py-2.5 first:border-t-0">
          {e.actor.kind === 'agent' ? (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-inverse">
              <Mark size={12} />
            </span>
          ) : (
            <Avatar name={e.actor.name} hue={e.actor.kind === 'system' ? 200 : (e.actor.name.length * 47) % 360} size={24} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] text-ink">{e.title}</p>
            <p className="truncate text-[11px] text-ink-3">
              {e.actor.name} · {relative(e.createdAt)}
              {e.detail ? ` · ${e.detail}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function SalesTrendWidget({ w }: { w: Widget }) {
  const s = useSnapshot()
  const days = Number(w.config.days ?? 30)
  const cur = salesSeries(s, days)
  const prev = salesSeries(s, days * 2).slice(0, days)
  const total = cur.reduce((a, d) => a + d.revenue, 0)
  const ptotal = prev.reduce((a, d) => a + d.revenue, 0)
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline gap-2">
        <AnimatedNumber value={total} format="eur" compact className="text-[26px] leading-none font-medium tracking-[-0.04em] text-ink" />
        <Delta value={ptotal ? ((total - ptotal) / ptotal) * 100 : 0} />
        <span className="text-[12px] text-ink-3">vs previous {days} days</span>
      </div>
      <div className="mt-2 min-h-0 flex-1">
        <AreaChart data={cur.map((d, i) => ({ label: d.day, value: d.revenue, secondary: prev[i]?.revenue }))} height={Math.max(110, 0)} xFormat={(l) => date(l, 'short')} format={(v) => eur(v, { decimals: 0, compact: true })} primaryLabel="Sales" secondaryLabel="Previous" className="h-full" />
      </div>
    </div>
  )
}

function ItemForecastWidget({ w }: { w: Widget }) {
  const s = useSnapshot()
  const id = String(w.config.itemId ?? s.items[0]?.id)
  const st = itemStats(s, id)
  if (!st) return <p className="text-[13px] text-ink-3">Pick an item in Edit.</p>
  const p = projection(s, id, 21)
  const out = p.find((d) => d.level <= 0)
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <span className="tabular text-ink">{fmtQty(st.onHand, st.item.unit)}</span> on hand ·{' '}
        {out ? <span className="text-bad-ink">runs out {date(out.day, 'short')}</span> : <span className="text-ok-ink">covered 3 weeks</span>}
      </div>
      <div className="mt-2 min-h-0 flex-1">
        <AreaChart data={p.map((d) => ({ label: d.day, value: d.level, secondary: d.units, marker: d.holiday }))} height={130} xFormat={(l) => date(l, 'short')} format={(v) => num(v)} primaryLabel="Stock" secondaryLabel="Demand" threshold={{ value: st.reorderPoint, label: 'reorder' }} />
      </div>
    </div>
  )
}

function NoteWidget({ w, onChange }: { w: Widget; onChange?: (w: Widget) => void }) {
  const [text, setText] = useState(String(w.config.text ?? ''))
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== w.config.text && onChange?.({ ...w, config: { ...w.config, text } })}
      placeholder="Write a note for the team…"
      aria-label="Note"
      className="h-full w-full resize-none bg-transparent text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-4"
    />
  )
}

function QuickActionsWidget() {
  const { navigate } = useActions()
  const items = [
    { label: 'Receive', icon: <TrayArrowDownIcon size={18} />, to: '/app/receive' },
    { label: 'Count', icon: <ClipboardTextIcon size={18} />, to: '/app/counts' },
    { label: 'Scan', icon: <BarcodeIcon size={18} />, to: '/app/scan' },
    { label: 'New item', icon: <PlusIcon size={18} />, to: '/app/items?new=1' },
    { label: 'Orders', icon: <TruckIcon size={18} />, to: '/app/orders' },
    { label: 'Reports', icon: <SquaresFourIcon size={18} />, to: '/app/insights' },
  ]
  return (
    <div className="grid h-full grid-cols-3 gap-2">
      {items.map((a) => (
        <button key={a.label} type="button" onClick={() => navigate(a.to)} className="press flex flex-col items-center justify-center gap-1.5 rounded-[12px] bg-surface-2 text-[12px] text-ink-2 shadow-[inset_0_0_0_1px_var(--gray-a3)] hover:bg-hover hover:text-ink">
          <span className="text-ink">{a.icon}</span>
          {a.label}
        </button>
      ))}
    </div>
  )
}

/* ───────────────────────────── Renderer ───────────────────────────── */

export function WidgetBody({ w, onChange }: { w: Widget; onChange?: (w: Widget) => void }) {
  switch (w.type) {
    case 'kpi':
      return <KpiWidget w={w} />
    case 'health':
      return <HealthWidget />
    case 'brief':
      return <BriefWidget />
    case 'approvals':
      return <ApprovalsList limit={5} />
    case 'lowStock':
      return <LowStockWidget w={w} />
    case 'salesTrend':
      return <SalesTrendWidget w={w} />
    case 'topMovers':
      return <TopMoversWidget />
    case 'categoryMix':
      return <CategoryMixWidget />
    case 'expiry':
      return <ExpiryWidget />
    case 'activity':
      return <ActivityWidget />
    case 'locations':
      return <LocationsWidget />
    case 'incoming':
      return <IncomingWidget />
    case 'note':
      return <NoteWidget w={w} onChange={onChange} />
    case 'quickActions':
      return <QuickActionsWidget />
    case 'itemForecast':
      return <ItemForecastWidget w={w} />
    case 'deadStock':
      return <DeadStockWidget />
  }
}

export function widgetAction(w: Widget, navigate: (to: string) => void): ReactNode {
  const map: Partial<Record<WidgetType, [string, string]>> = {
    approvals: ['/app/approvals', 'All'],
    lowStock: ['/app/items?status=low', 'All'],
    incoming: ['/app/orders', 'Orders'],
    activity: ['/app/movements', 'Ledger'],
    expiry: ['/app/items?status=expiring', 'All'],
    deadStock: ['/app/insights', 'Report'],
    topMovers: ['/app/insights', 'Report'],
  }
  const m = map[w.type]
  return m ? <Mini onClick={() => navigate(m[0])}>{m[1]}</Mini> : null
}
