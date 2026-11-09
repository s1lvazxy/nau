import type { Batch, Item, Movement, Proposal, PurchaseOrder, Snapshot, Supplier } from './types'
import { addDays, isoDay, daysBetween, eur, qty as fmtQty } from './format'
import { holidayOn } from './pt'
import { hashString, indexBy, round, sum } from './utils'

export type StockStatus = 'out' | 'critical' | 'low' | 'healthy' | 'over' | 'dead' | 'idle'

export const STATUS_META: Record<StockStatus, { label: string; tone: 'bad' | 'warn' | 'ok' | 'info' | 'muted' | 'violet' }> = {
  out: { label: 'Out of stock', tone: 'bad' },
  critical: { label: 'Critical', tone: 'bad' },
  low: { label: 'Reorder', tone: 'warn' },
  healthy: { label: 'Healthy', tone: 'ok' },
  over: { label: 'Overstock', tone: 'info' },
  dead: { label: 'Not moving', tone: 'violet' },
  idle: { label: 'Inactive', tone: 'muted' },
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
        if (total >= sup.minOrderValue) rationale.push(`Topped up with items due soon to reach ${sup.name}’s ${eur(sup.minOrderValue, { decimals: 0 })} minimum.`)
        else rationale.push(`Below ${sup.name}’s ${eur(sup.minOrderValue, { decimals: 0 })} minimum — consider waiting a day or two.`)
      }
      lines = lines.map((l) => ({ ...l, unitCost: round(l.unitCost) }))
      const critical = list.filter((x) => x.status === 'critical' || x.status === 'out')
      const names = list.slice(0, 2).map((x) => x.item.name)
      rationale.unshift(
        critical.length
          ? `${critical.length} item${critical.length > 1 ? 's' : ''} will run out before a new delivery could arrive (${sup.leadTimeDays}-day lead time).`
          : `${list.length} item${list.length > 1 ? 's' : ''} crossed the reorder point.`,
      )
      const fastest = [...list].sort((a, b) => a.cover - b.cover)[0]
      if (fastest && Number.isFinite(fastest.cover))
        rationale.push(`${fastest.item.name} has ${fastest.cover < 1 ? 'less than a day' : Math.floor(fastest.cover) === 1 ? 'one day' : `${Math.floor(fastest.cover)} days`} of cover at the current pace.`)
      out.push({
        kind: 'reorder',
        title: `Reorder from ${sup.name}`,
        summary: `${lines.length} line${lines.length > 1 ? 's' : ''} · ${names.join(', ')}${list.length > 2 ? ` +${list.length - 2}` : ''}`,
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
          title: `Move ${fmtQty(moveQty, st.item.unit)} ${st.item.name}`,
          summary: `${locations[long.id]?.name} → ${locations[short.id]?.name}`,
          rationale: [
            `${locations[short.id]?.name} has ${short.cover < 1 ? 'under a day' : Math.floor(short.cover) === 1 ? 'one day' : `${Math.floor(short.cover)} days`} of cover.`,
            `${locations[long.id]?.name} holds ${Number.isFinite(long.cover) ? `${Math.floor(long.cover)} days` : 'stock with no local demand'}.`,
            `A transfer is faster and cheaper than a new order.`,
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
      const when = first.days <= 0 ? 'today' : first.days === 1 ? 'tomorrow' : `in ${first.days} days`
      out.push({
        kind: 'markdown',
        title: `Clear ${fmtQty(Math.ceil(atRisk), it.unit)} ${it.name} before it expires`,
        summary: `${lots.length > 1 ? `${lots.length} lots` : `Lot ${first.batch.code}`} · first expires ${when} · ${discount}% off`,
        rationale: [
          `${fmtQty(round(lots.reduce((a, x) => a + x.batch.qty, 0), 2), it.unit)} expire within ${s.workspace.settings.expiryWarnDays} days; normal sales will move about ${fmtQty(Math.floor(sold), it.unit)}.`,
          `A ${discount}% markdown recovers ${eur(atRisk * it.price * (1 - discount / 100), { decimals: 0 })} instead of writing it off.`,
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
        title: `Free ${eur(total, { decimals: 0 })} tied up in stock that isn’t moving`,
        summary: dead
          .slice(0, 3)
          .map((x) => x.item.name)
          .join(', ') + (dead.length > 3 ? ` +${dead.length - 3}` : ''),
        rationale: [
          `${dead.length} item${dead.length > 1 ? 's have' : ' has'} had no sales in ${s.workspace.settings.deadStockDays}+ days.`,
          `Suggested: bundle with fast movers, a 25% clearance, or return to supplier where terms allow.`,
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
        title: `Spot-count ${pick.length} high-value items`,
        summary: pick
          .slice(0, 3)
          .map((x) => x.item.name)
          .join(', ') + ` +${pick.length - 3}`,
        rationale: [
          `These A-items drive most of your revenue and haven’t been counted in 30 days.`,
          `A 10-minute count keeps forecasts honest.`,
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
        title: `${st.item.name}: cost up ${Math.round(change * 100)}%`,
        summary: `Keep your margin at ${eur(newPrice)} (now ${eur(st.item.price)})`,
        rationale: [
          `Last delivery came in at ${eur(st.lastReceiptCost)} vs ${eur(st.prevReceiptCost)} before.`,
          `At the current price your margin drops from ${Math.round(oldMargin * 100)}% to ${Math.round(((net - st.lastReceiptCost) / net) * 100)}%.`,
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
    text: `Sales this week ${eur(k.d7.revenue, { decimals: 0 })}, ${growth >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(growth * 100))}% on last week.`,
  })
  const outs = stats.filter((x) => x.status === 'out')
  if (outs.length) lines.push({ tone: 'bad', text: `${outs.length} item${outs.length > 1 ? 's are' : ' is'} out of stock — ${outs.slice(0, 2).map((x) => x.item.name).join(', ')}${outs.length > 2 ? '…' : '.'}` })
  const arriving = s.orders.filter((p) => (p.status === 'sent' || p.status === 'partial') && p.expectedOn?.slice(0, 10) === today)
  if (arriving.length) {
    const sup = indexBy(s.suppliers, (x) => x.id)
    lines.push({ tone: 'info', text: `Deliveries due today: ${arriving.map((p) => sup[p.supplierId]?.name).join(', ')}.` })
  }
  const exp = expiringBatches(s, 3)
  if (exp.length) lines.push({ tone: 'warn', text: `${exp.length} lot${exp.length > 1 ? 's' : ''} expire within 3 days.` })
  if (k.pending) lines.push({ tone: 'info', text: `${k.pending} suggestion${k.pending > 1 ? 's' : ''} waiting for your approval.` })
  if (k.deadValue > 0) lines.push({ tone: 'warn', text: `${eur(k.deadValue, { decimals: 0 })} sits in items that haven’t sold in ${s.workspace.settings.deadStockDays} days.` })
  return { health: k.health, lines }
}

export function batchesFor(s: Snapshot, itemId: string): Batch[] {
  return s.batches.filter((b) => b.itemId === itemId && b.qty > 0).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
}
