import type { Batch, Item, Movement, Proposal, PurchaseOrder, Snapshot, Supplier } from './types'
import { addDays, isoDay, daysBetween, eur, qty as fmtQty } from './format'
import { holidayOn } from './pt'
import { hashString, indexBy, round, sum } from './utils'
import { tr } from '~/i18n'

export type StockStatus = 'out' | 'critical' | 'low' | 'healthy' | 'over' | 'dead' | 'idle'

export const STATUS_META: Record<StockStatus, { label: string; tone: 'bad' | 'warn' | 'ok' | 'info' | 'muted' | 'violet' }> = {
  out: { label: tr('Out of stock'), tone: 'bad' },
  critical: { label: tr('Critical'), tone: 'bad' },
  low: { label: tr('Reorder'), tone: 'warn' },
  healthy: { label: tr('Healthy'), tone: 'ok' },
  over: { label: tr('Overstock'), tone: 'info' },
  dead: { label: tr('Not moving'), tone: 'violet' },
  idle: { label: tr('Inactive'), tone: 'muted' },
}

export interface ItemStats {
  item: Item
  onHand: number
  byLocation: Record<string, number>
  value: number
  retailValue: number
  onOrder: number
  daily: number
  dailyByLocation: Record<string, number>
  weekday: number[]
  sold7: number
  sold30: number
  revenue30: number
  cogs30: number
  cover: number
  leadTime: number
  reorderPoint: number
  target: number
  suggestedQty: number
  status: StockStatus
  lastSaleAt?: string
  lastReceiptCost?: number
  prevReceiptCost?: number
  trend: number
  series: number[]
  abc: 'A' | 'B' | 'C'
  margin: number
}

const HISTORY = 56
const HALF_LIFE = 14

function now() {
  return new Date()
}

interface Derived {
  stats: ItemStats[]
  byId: Record<string, ItemStats>
  salesByDay: Map<string, { revenue: number; units: number; cogs: number }>
}

const memo = new WeakMap<Snapshot, Derived>()

export function derive(s: Snapshot): Derived {
  const hit = memo.get(s)
  if (hit) return hit
  const today = now()
  const todayKey = isoDay(today)
  const suppliers = indexBy(s.suppliers, (x) => x.id)
  const itemById = indexBy(s.items, (x) => x.id)

  const onHand: Record<string, Record<string, number>> = {}
  for (const l of s.levels) (onHand[l.itemId] ||= {})[l.locationId] = l.onHand

  const onOrder: Record<string, number> = {}
  for (const po of s.orders) {
    if (po.status !== 'sent' && po.status !== 'partial') continue
    for (const ln of po.lines) onOrder[ln.itemId] = (onOrder[ln.itemId] || 0) + Math.max(0, ln.qty - ln.received)
  }

  // Daily demand per item (and per location) for the last HISTORY days
  const dayIndex = new Map<string, number>()
  for (let i = 0; i < HISTORY; i++) dayIndex.set(isoDay(addDays(today, -i)), i)
  const salesByItem: Record<string, number[]> = {}
  const salesByItemLoc: Record<string, Record<string, number>> = {}
  const lastSale: Record<string, string> = {}
  const receipts: Record<string, Movement[]> = {}
  const salesByDay = new Map<string, { revenue: number; units: number; cogs: number }>()
  for (const m of s.movements) {
    if (m.type === 'sale') {
      const d = isoDay(m.createdAt)
      const idx = dayIndex.get(d)
      const it = itemById[m.itemId]
      const u = -m.qty
      if (!lastSale[m.itemId] || lastSale[m.itemId] < m.createdAt) lastSale[m.itemId] = m.createdAt
      const agg = salesByDay.get(d) || { revenue: 0, units: 0, cogs: 0 }
      agg.units += u
      agg.revenue += u * (it?.price ?? 0)
      agg.cogs += u * (it?.cost ?? 0)
      salesByDay.set(d, agg)
      if (idx === undefined) continue
      ;(salesByItem[m.itemId] ||= new Array(HISTORY).fill(0))[idx] += u
      const byLoc = (salesByItemLoc[m.itemId] ||= {})
      byLoc[m.locationId] = (byLoc[m.locationId] || 0) + u * Math.pow(0.5, idx / HALF_LIFE)
    } else if (m.type === 'receipt' && m.unitCost != null && m.qty > 0) {
      ;(receipts[m.itemId] ||= []).push(m)
    }
  }

  const weights = Array.from({ length: HISTORY }, (_, i) => Math.pow(0.5, i / HALF_LIFE))
  const wSum = sum(weights)

  const stats: ItemStats[] = s.items
    .filter((i) => !i.archived)
    .map((item) => {
      const byLocation = onHand[item.id] || {}
      const total = sum(Object.values(byLocation))
      const hist = salesByItem[item.id] || new Array(HISTORY).fill(0)
      const daily = sum(hist.map((v, i) => v * weights[i])) / wSum
      // weekday factors
      const wk = new Array(7).fill(0)
      const wc = new Array(7).fill(0)
      for (let i = 0; i < HISTORY; i++) {
        const dow = addDays(today, -i).getDay()
        wk[dow] += hist[i]
        wc[dow] += 1
      }
      const mean = sum(hist) / HISTORY || 0
      const weekday = wk.map((v, i) => (mean > 0 ? 0.6 + 0.4 * (v / wc[i] / mean) : 1))
      const sold7 = sum(hist.slice(0, 7))
      const sold30 = sum(hist.slice(0, 30))
      const prior14 = sum(hist.slice(14, 28))
      const last14 = sum(hist.slice(0, 14))
      const trend = prior14 > 0 ? last14 / prior14 - 1 : last14 > 0 ? 1 : 0
      const sup = item.supplierId ? suppliers[item.supplierId] : undefined
      const leadTime = sup?.leadTimeDays ?? 7
      const safety = daily * item.safetyDays
      const computedRP = Math.ceil(daily * leadTime + safety)
      const reorderPoint = item.reorderPoint ?? computedRP
      const target = Math.ceil(daily * (leadTime + s.workspace.settings.reviewDays) + safety)
      const oo = onOrder[item.id] || 0
      let suggested = Math.max(0, target - total - oo)
      if (item.reorderQty && suggested > 0) suggested = Math.max(item.reorderQty, suggested)
      suggested = item.unit === 'kg' || item.unit === 'L' ? Math.ceil(suggested * 2) / 2 : Math.ceil(suggested)
      const cover = daily > 0.0001 ? total / daily : total > 0 ? Infinity : 0
      const ls = lastSale[item.id]
      const daysSinceSale = ls ? daysBetween(ls, today) : Infinity
      let status: StockStatus
      const daily_fresh = item.tags.includes('daily')
      if (daily_fresh) status = total <= 0 && daily > 0.05 && new Date().getHours() < 17 ? 'out' : 'healthy'
      else if (total <= 0) status = daily > 0.05 ? 'out' : 'idle'
      else if (daysSinceSale >= s.workspace.settings.deadStockDays && daysBetween(item.createdAt, today) > s.workspace.settings.deadStockDays) status = 'dead'
      else if (total + oo <= reorderPoint && cover < leadTime) status = 'critical'
      else if (total + oo <= reorderPoint) status = 'low'
      else if (cover > 120 && total * item.cost > 80) status = 'over'
      else status = 'healthy'
      const rc = (receipts[item.id] || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const series = hist.slice(0, 30).reverse()
      return {
        item,
        onHand: total,
        byLocation,
        value: round(total * item.cost),
        retailValue: round(total * item.price),
        onOrder: oo,
        daily,
        dailyByLocation: Object.fromEntries(Object.entries(salesByItemLoc[item.id] || {}).map(([k, v]) => [k, v / wSum])),
        weekday,
        sold7,
        sold30,
        revenue30: round(sold30 * item.price),
        cogs30: round(sold30 * item.cost),
        cover,
        leadTime,
        reorderPoint,
        target,
        suggestedQty: suggested,
        status,
        lastSaleAt: ls,
        lastReceiptCost: rc[0]?.unitCost ?? undefined,
        prevReceiptCost: rc.find((m) => m.unitCost !== rc[0]?.unitCost)?.unitCost ?? undefined,
        trend,
        series,
        abc: 'C' as const,
        margin: item.price > 0 ? (item.price / (1 + item.vatRate / 100) - item.cost) / (item.price / (1 + item.vatRate / 100)) : 0,
      }
    })

  // ABC by 30d revenue
  const sorted = [...stats].sort((a, b) => b.revenue30 - a.revenue30)
  const totalRev = sum(sorted.map((x) => x.revenue30)) || 1
  let acc = 0
  for (const st of sorted) {
    acc += st.revenue30
    const share = acc / totalRev
    st.abc = share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C'
  }

  const result: Derived = { stats, byId: indexBy(stats, (x) => x.item.id), salesByDay }
  void todayKey
  memo.set(s, result)
  return result
}

export function itemStats(s: Snapshot, itemId: string): ItemStats | undefined {
  return derive(s).byId[itemId]
}

export function forecast(s: Snapshot, itemId: string, days = 28) {
  const st = itemStats(s, itemId)
  if (!st) return []
  const today = now()
  const out: { day: string; units: number; holiday?: string }[] = []
  for (let i = 1; i <= days; i++) {
    const d = addDays(today, i)
    const key = isoDay(d)
    const h = holidayOn(key)
    const eve = holidayOn(isoDay(addDays(d, 1)))
    let lift = 1
    if (h) lift = h.scope === 'national' ? h.lift : 1 + (h.lift - 1) * 0.6
    else if (eve && eve.lift > 1) lift = 1 + (eve.lift - 1) * 0.5
    out.push({ day: key, units: round(st.daily * st.weekday[d.getDay()] * lift, 2), holiday: h?.name })
  }
  return out
}

/** Projected on-hand trajectory incl. incoming POs */
export function projection(s: Snapshot, itemId: string, days = 28) {
  const st = itemStats(s, itemId)
  if (!st) return []
  const f = forecast(s, itemId, days)
  const incoming: Record<string, number> = {}
  for (const po of s.orders) {
    if ((po.status === 'sent' || po.status === 'partial') && po.expectedOn) {
      const ln = po.lines.find((l) => l.itemId === itemId)
      if (ln) incoming[po.expectedOn.slice(0, 10)] = (incoming[po.expectedOn.slice(0, 10)] || 0) + ln.qty - ln.received
    }
  }
  let level = st.onHand
  return f.map((d) => {
    level = Math.max(0, level - d.units + (incoming[d.day] || 0))
    return { ...d, level: round(level, 1), incoming: incoming[d.day] || 0 }
  })
}

export function kpis(s: Snapshot) {
  const { stats, salesByDay } = derive(s)
  const today = now()
  const range = (n: number, offset = 0) => {
    let revenue = 0
    let units = 0
    let cogs = 0
    for (let i = offset; i < offset + n; i++) {
      const v = salesByDay.get(isoDay(addDays(today, -i)))
      if (v) {
        revenue += v.revenue
        units += v.units
        cogs += v.cogs
      }
    }
    return { revenue: round(revenue), units, cogs: round(cogs) }
  }
  const stockValue = round(sum(stats.map((x) => x.value)))
  const retailValue = round(sum(stats.map((x) => x.retailValue)))
  const out = stats.filter((x) => x.status === 'out').length
  const low = stats.filter((x) => x.status === 'low' || x.status === 'critical').length
  const dead = stats.filter((x) => x.status === 'dead')
  const over = stats.filter((x) => x.status === 'over')
  const openPOs = s.orders.filter((p) => p.status === 'sent' || p.status === 'partial')
  const openPOValue = round(sum(openPOs.flatMap((p) => p.lines.map((l) => (l.qty - l.received) * l.unitCost))))
  const r30 = range(30)
  const avgInv = stockValue || 1
  const turnover = (r30.cogs * 12) / avgInv
  return {
    stockValue,
    retailValue,
    skuCount: stats.length,
    out,
    low,
    deadValue: round(sum(dead.map((x) => x.value))),
    deadCount: dead.length,
    overValue: round(sum(over.map((x) => x.value))),
    openPOValue,
    openPOCount: openPOs.length,
    today: range(1),
    d7: range(7),
    prev7: range(7, 7),
    d30: r30,
    prev30: range(30, 30),
    turnover: round(turnover, 1),
    health: healthScore(s),
    pending: s.proposals.filter((p) => p.status === 'pending').length,
  }
}

export function healthScore(s: Snapshot) {
  const { stats } = derive(s)
  const w: Record<StockStatus, number> = { healthy: 1, low: 0.7, over: 0.6, critical: 0.25, out: 0, dead: 0.25, idle: 1 }
  let num = 0
  let den = 0
  for (const st of stats) {
    if (st.status === 'idle') continue
    const weight = Math.sqrt(st.revenue30 + st.value * 0.2 + 1)
    num += w[st.status] * weight
    den += weight
  }
  return den ? Math.round((num / den) * 100) : 100
}

export function salesSeries(s: Snapshot, days = 30) {
  const { salesByDay } = derive(s)
  const today = now()
  const out: { day: string; revenue: number; units: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = isoDay(addDays(today, -i))
    const v = salesByDay.get(d)
    out.push({ day: d, revenue: round(v?.revenue ?? 0), units: v?.units ?? 0 })
  }
  return out
}

export function valueByCategory(s: Snapshot) {
  const { stats } = derive(s)
  const out = s.categories.map((c) => ({ id: c.id, name: c.name, hue: c.hue, value: 0, revenue30: 0 }))
  const idx = indexBy(out, (x) => x.id)
  for (const st of stats) {
    const row = st.item.categoryId ? idx[st.item.categoryId] : undefined
    if (row) {
      row.value += st.value
      row.revenue30 += st.revenue30
    }
  }
  return out.filter((x) => x.value > 0 || x.revenue30 > 0).sort((a, b) => b.value - a.value)
}

export function valueByLocation(s: Snapshot) {
  const { stats } = derive(s)
  return s.locations.map((l) => {
    let value = 0
    let units = 0
    for (const st of stats) {
      const q = st.byLocation[l.id] || 0
      value += q * st.item.cost
      units += q
    }
    return { location: l, value: round(value), units }
  })
}

export function topMovers(s: Snapshot, n = 6) {
  const { stats } = derive(s)
  return [...stats]
    .filter((x) => x.sold7 > 0)
    .sort((a, b) => b.sold7 * b.item.price - a.sold7 * a.item.price)
    .slice(0, n)
}

export function expiringBatches(s: Snapshot, withinDays?: number) {
  const days = withinDays ?? s.workspace.settings.expiryWarnDays
  const today = now()
  const items = indexBy(s.items, (x) => x.id)
  return s.batches
    .filter((b) => b.qty > 0)
    .map((b) => ({ batch: b, item: items[b.itemId], days: daysBetween(isoDay(today), b.expiresOn.slice(0, 10)) }))
    .filter((x) => x.item && x.days <= days)
    .sort((a, b) => a.days - b.days)
}

export function incomingOrders(s: Snapshot) {
  return s.orders
    .filter((p) => p.status === 'sent' || p.status === 'partial')
    .sort((a, b) => (a.expectedOn ?? '').localeCompare(b.expectedOn ?? ''))
}

export function poTotal(po: Pick<PurchaseOrder, 'lines'>) {
  return round(sum(po.lines.map((l) => l.qty * l.unitCost)))
}

/* ───────────────────────────── Autopilot ───────────────────────────── */

function fp(...parts: (string | number)[]) {
  return String(hashString(parts.join('|')))
}

export function generateProposals(s: Snapshot): Omit<Proposal, 'id' | 'createdAt' | 'status'>[] {
  const { stats } = derive(s)
  const suppliers = indexBy(s.suppliers, (x) => x.id)
  const locations = indexBy(s.locations, (x) => x.id)
  const out: Omit<Proposal, 'id' | 'createdAt' | 'status'>[] = []
  const playbookOn = (k: string) => s.playbooks.find((p) => p.key === k)?.enabled ?? true

  // 1 — Reorder, grouped by supplier
  if (playbookOn('reorder')) {
    const need = stats.filter((x) => (x.status === 'low' || x.status === 'critical' || x.status === 'out') && x.suggestedQty > 0 && x.item.supplierId && !x.item.tags.includes('daily'))
    const bySupplier: Record<string, ItemStats[]> = {}
    for (const st of need) (bySupplier[st.item.supplierId!] ||= []).push(st)
    for (const [supId, list] of Object.entries(bySupplier)) {
      const sup: Supplier | undefined = suppliers[supId]
      if (!sup) continue
      let lines = list.map((x) => ({ itemId: x.item.id, qty: x.suggestedQty, unitCost: x.lastReceiptCost ?? x.item.cost }))
      let total = sum(lines.map((l) => l.qty * l.unitCost))
      const rationale: string[] = []
      if (total < sup.minOrderValue) {
        // top up with items that will need reordering soon
        const extras = stats
          .filter((x) => x.item.supplierId === supId && !lines.some((l) => l.itemId === x.item.id) && x.daily > 0 && x.cover < x.leadTime + s.workspace.settings.reviewDays * 2)
          .sort((a, b) => a.cover - b.cover)
        for (const ex of extras) {
          if (total >= sup.minOrderValue) break
          const q = Math.max(1, Math.ceil(ex.daily * s.workspace.settings.reviewDays))
          lines.push({ itemId: ex.item.id, qty: q, unitCost: ex.item.cost })
          total += q * ex.item.cost
        }
        if (total >= sup.minOrderValue) rationale.push(tr('Topped up with items due soon to reach {0}’s {1} minimum.', sup.name, eur(sup.minOrderValue, { decimals: 0 })))
        else rationale.push(tr('Below {0}’s {1} minimum — consider waiting a day or two.', sup.name, eur(sup.minOrderValue, { decimals: 0 })))
      }
      lines = lines.map((l) => ({ ...l, unitCost: round(l.unitCost) }))
      const critical = list.filter((x) => x.status === 'critical' || x.status === 'out')
      const names = list.slice(0, 2).map((x) => x.item.name)
      rationale.unshift(
        critical.length
          ? (critical.length > 1 ? tr('{0} items will run out before a new delivery could arrive ({1}-day lead time).', critical.length, sup.leadTimeDays) : tr('{0} item will run out before a new delivery could arrive ({1}-day lead time).', critical.length, sup.leadTimeDays))
          : (list.length > 1 ? tr('{0} items crossed the reorder point.', list.length) : tr('{0} item crossed the reorder point.', list.length)),
      )
      const fastest = [...list].sort((a, b) => a.cover - b.cover)[0]
      if (fastest && Number.isFinite(fastest.cover))
        rationale.push(tr('{0} has {1} of cover at the current pace.', fastest.item.name, fastest.cover < 1 ? tr('less than a day') : Math.floor(fastest.cover) === 1 ? tr('one day') : tr('{0} days', Math.floor(fastest.cover))))
      out.push({
        kind: 'reorder',
        title: tr('Reorder from {0}', sup.name),
        summary: (lines.length > 1 ? tr('{0} lines · {1}{2}', lines.length, names.join(', '), list.length > 2 ? ` +${list.length - 2}` : '') : tr('{0} line · {1}{2}', lines.length, names.join(', '), list.length > 2 ? ` +${list.length - 2}` : '')),
        rationale,
        impactEur: round(total),
        payload: { supplierId: supId, locationId: s.locations.find((l) => l.isDefault)?.id ?? s.locations[0]?.id, lines },
        source: 'autopilot',
        fingerprint: fp('reorder', supId, ...lines.map((l) => l.itemId).sort()),
      })
    }
  }

  // 2 — Rebalance between locations
  if (playbookOn('rebalance') && s.locations.length > 1) {
    const transfers: Omit<Proposal, 'id' | 'createdAt' | 'status'>[] = []
    for (const st of stats) {
      if (st.daily <= 0 || st.item.tags.includes('daily')) continue
      const locs = s.locations.filter((l) => l.kind !== 'van')
      let short: { id: string; cover: number } | null = null
      let long: { id: string; cover: number; spare: number } | null = null
      for (const l of locs) {
        const q = st.byLocation[l.id] || 0
        const d = st.dailyByLocation[l.id] || 0
        const cover = d > 0 ? q / d : q > 0 ? Infinity : 0
        if (d > 0 && cover < 3 && (!short || cover < short.cover)) short = { id: l.id, cover }
        const spare = q - Math.ceil(d * 14)
        if (spare > 0 && cover > 21 && (!long || spare > long.spare)) long = { id: l.id, cover, spare }
      }
      if (short && long && short.id !== long.id) {
        const need = Math.ceil((st.dailyByLocation[short.id] || st.daily) * 10)
        const moveQty = Math.min(long.spare, Math.max(1, need))
        if (moveQty <= 0 || moveQty * st.item.cost < 15) continue
        transfers.push({
          kind: 'transfer',
          title: tr('Move {0} {1}', fmtQty(moveQty, st.item.unit), st.item.name),
          summary: `${locations[long.id]?.name} → ${locations[short.id]?.name}`,
          rationale: [
            tr('{0} has {1} of cover.', locations[short.id]?.name, short.cover < 1 ? tr('under a day') : Math.floor(short.cover) === 1 ? tr('one day') : tr('{0} days', Math.floor(short.cover))),
            tr('{0} holds {1}.', locations[long.id]?.name, Number.isFinite(long.cover) ? tr('{0} days', Math.floor(long.cover)) : tr('stock with no local demand')),
            tr('A transfer is faster and cheaper than a new order.'),
          ],
          impactEur: round(moveQty * st.item.cost),
          payload: { itemId: st.item.id, from: long.id, to: short.id, qty: moveQty },
          source: 'autopilot',
          fingerprint: fp('transfer', st.item.id, long.id, short.id),
        })
      }
    }
    out.push(...transfers.sort((a, b) => (b.impactEur ?? 0) - (a.impactEur ?? 0)).slice(0, 4))
  }

  // 3 — Expiry (one proposal per item, all at-risk lots together)
  if (playbookOn('expiry')) {
    const byItem: Record<string, ReturnType<typeof expiringBatches>> = {}
    for (const ex of expiringBatches(s)) (byItem[ex.item.id] ||= []).push(ex)
    for (const [itemId, lots] of Object.entries(byItem)) {
      const st = derive(s).byId[itemId]
      if (!st) continue
      let atRisk = 0
      let sold = 0
      for (const ex of lots) {
        const sellable = Math.max(0, st.daily * Math.max(0.5, ex.days) - sold)
        const risk = Math.max(0, ex.batch.qty - sellable)
        sold += Math.min(ex.batch.qty, sellable)
        atRisk += risk
      }
      const it = lots[0].item
      if (atRisk < 1 || atRisk * it.cost < 8) continue
      const first = lots[0]
      const discount = first.days <= 1 ? 40 : first.days <= 3 ? 30 : 20
      const when = first.days <= 0 ? tr('today') : first.days === 1 ? tr('tomorrow') : tr('in {0} days', first.days)
      out.push({
        kind: 'markdown',
        title: tr('Clear {0} {1} before it expires', fmtQty(Math.ceil(atRisk), it.unit), it.name),
        summary: tr('{0} · first expires {1} · {2}% off', lots.length > 1 ? tr('{0} lots', lots.length) : tr('Lot {0}', first.batch.code), when, discount),
        rationale: [
          tr('{0} expire within {1} days; normal sales will move about {2}.', fmtQty(round(lots.reduce((a, x) => a + x.batch.qty, 0), 2), it.unit), s.workspace.settings.expiryWarnDays, fmtQty(Math.floor(sold), it.unit)),
          tr('A {0}% markdown recovers {1} instead of writing it off.', discount, eur(atRisk * it.price * (1 - discount / 100), { decimals: 0 })),
        ],
        impactEur: round(atRisk * it.cost),
        payload: { itemId, batchIds: lots.map((x) => x.batch.id), discount, qty: Math.ceil(atRisk) },
        source: 'autopilot',
        fingerprint: fp('markdown', ...lots.map((x) => x.batch.id)),
      })
    }
  }

  // 4 — Dead stock
  if (playbookOn('deadstock')) {
    const dead = stats.filter((x) => x.status === 'dead' && x.value >= 60).sort((a, b) => b.value - a.value)
    if (dead.length) {
      const total = sum(dead.map((x) => x.value))
      out.push({
        kind: 'deadstock',
        title: tr('Free {0} tied up in stock that isn’t moving', eur(total, { decimals: 0 })),
        summary: dead
          .slice(0, 3)
          .map((x) => x.item.name)
          .join(', ') + (dead.length > 3 ? ` +${dead.length - 3}` : ''),
        rationale: [
          (dead.length > 1 ? tr('{0} items have had no sales in {1}+ days.', dead.length, s.workspace.settings.deadStockDays) : tr('{0} item has had no sales in {1}+ days.', dead.length, s.workspace.settings.deadStockDays)),
          tr('Suggested: bundle with fast movers, a 25% clearance, or return to supplier where terms allow.'),
        ],
        impactEur: round(total),
        payload: { itemIds: dead.map((x) => x.item.id), discount: 25 },
        source: 'autopilot',
        fingerprint: fp('deadstock', ...dead.map((x) => x.item.id)),
      })
    }
  }

  // 5 — Cycle count for A-items with recent adjustments or never counted
  if (playbookOn('cyclecount')) {
    const recentAdj = new Set(
      s.movements.filter((m) => (m.type === 'adjustment' || m.type === 'count') && daysBetween(m.createdAt, now()) <= 14).map((m) => m.itemId),
    )
    const counted = new Set(s.counts.filter((c) => c.status === 'closed' && c.closedAt && daysBetween(c.closedAt, now()) <= 30).flatMap((c) => c.lines.map((l) => l.itemId)))
    const pick = stats.filter((x) => x.abc === 'A' && x.onHand > 0 && (recentAdj.has(x.item.id) || !counted.has(x.item.id))).slice(0, 8)
    if (pick.length >= 4) {
      out.push({
        kind: 'count',
        title: tr('Spot-count {0} high-value items', pick.length),
        summary: pick
          .slice(0, 3)
          .map((x) => x.item.name)
          .join(', ') + ` +${pick.length - 3}`,
        rationale: [
          tr('These A-items drive most of your revenue and haven’t been counted in 30 days.'),
          tr('A 10-minute count keeps forecasts honest.'),
        ],
        impactEur: round(sum(pick.map((x) => x.value))),
        payload: { itemIds: pick.map((x) => x.item.id), locationId: s.locations.find((l) => l.isDefault)?.id ?? s.locations[0]?.id },
        source: 'autopilot',
        fingerprint: fp('count', ...pick.map((x) => x.item.id)),
      })
    }
  }

  // 6 — Supplier price increases
  if (playbookOn('pricewatch')) {
    for (const st of stats) {
      if (!st.lastReceiptCost || !st.prevReceiptCost) continue
      const change = st.lastReceiptCost / st.prevReceiptCost - 1
      if (change < 0.05) continue
      const net = st.item.price / (1 + st.item.vatRate / 100)
      const oldMargin = (net - st.prevReceiptCost) / net
      const newPrice = round((st.lastReceiptCost / (1 - oldMargin)) * (1 + st.item.vatRate / 100), 2)
      out.push({
        kind: 'price',
        title: tr('{0}: cost up {1}%', st.item.name, Math.round(change * 100)),
        summary: tr('Keep your margin at {0} (now {1})', eur(newPrice), eur(st.item.price)),
        rationale: [
          tr('Last delivery came in at {0} vs {1} before.', eur(st.lastReceiptCost), eur(st.prevReceiptCost)),
          tr('At the current price your margin drops from {0}% to {1}%.', Math.round(oldMargin * 100), Math.round(((net - st.lastReceiptCost) / net) * 100)),
        ],
        impactEur: round((st.lastReceiptCost - st.prevReceiptCost) * st.sold30),
        payload: { itemId: st.item.id, newPrice },
        source: 'autopilot',
        fingerprint: fp('price', st.item.id, st.lastReceiptCost),
      })
    }
  }

  return out
}

/* ───────────────────────────── Morning brief ───────────────────────────── */

export function morningBrief(s: Snapshot) {
  const k = kpis(s)
  const { stats } = derive(s)
  const today = isoDay(now())
  const lines: { tone: 'ok' | 'warn' | 'bad' | 'info'; text: string }[] = []
  const growth = k.prev7.revenue > 0 ? k.d7.revenue / k.prev7.revenue - 1 : 0
  lines.push({
    tone: growth >= 0 ? 'ok' : 'warn',
    text: (growth >= 0 ? tr('Sales this week {0}, up {1}% on last week.', eur(k.d7.revenue, { decimals: 0 }), Math.abs(Math.round(growth * 100))) : tr('Sales this week {0}, down {1}% on last week.', eur(k.d7.revenue, { decimals: 0 }), Math.abs(Math.round(growth * 100)))),
  })
  const outs = stats.filter((x) => x.status === 'out')
  if (outs.length) lines.push({ tone: 'bad', text: (outs.length > 1 ? outs.length > 2 ? tr('{0} items are out of stock — {1}…', outs.length, outs.slice(0, 2).map((x) => x.item.name).join(', ')) : tr('{0} items are out of stock — {1}.', outs.length, outs.slice(0, 2).map((x) => x.item.name).join(', ')) : outs.length > 2 ? tr('{0} item is out of stock — {1}…', outs.length, outs.slice(0, 2).map((x) => x.item.name).join(', ')) : tr('{0} item is out of stock — {1}.', outs.length, outs.slice(0, 2).map((x) => x.item.name).join(', '))) })
  const arriving = s.orders.filter((p) => (p.status === 'sent' || p.status === 'partial') && p.expectedOn?.slice(0, 10) === today)
  if (arriving.length) {
    const sup = indexBy(s.suppliers, (x) => x.id)
    lines.push({ tone: 'info', text: tr('Deliveries due today: {0}.', arriving.map((p) => sup[p.supplierId]?.name).join(', ')) })
  }
  const exp = expiringBatches(s, 3)
  if (exp.length) lines.push({ tone: 'warn', text: (exp.length > 1 ? tr('{0} lots expire within 3 days.', exp.length) : tr('{0} lot expire within 3 days.', exp.length)) })
  if (k.pending) lines.push({ tone: 'info', text: (k.pending > 1 ? tr('{0} suggestions waiting for your approval.', k.pending) : tr('{0} suggestion waiting for your approval.', k.pending)) })
  if (k.deadValue > 0) lines.push({ tone: 'warn', text: tr('{0} sits in items that haven’t sold in {1} days.', eur(k.deadValue, { decimals: 0 }), s.workspace.settings.deadStockDays) })
  return { health: k.health, lines }
}

export function batchesFor(s: Snapshot, itemId: string): Batch[] {
  return s.batches.filter((b) => b.itemId === itemId && b.qty > 0).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
}
