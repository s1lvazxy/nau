import type { Item, Location, Snapshot, Supplier, Widget, WidgetType } from '~/lib/types'
import { derive, expiringBatches, forecast, kpis, projection, STATUS_META, topMovers, valueByCategory, valueByLocation, batchesFor, type ItemStats } from '~/lib/analytics'
import { addDays, date, eur, isoDay, qty as fmtQty } from '~/lib/format'
import { fuzzyScore, indexBy, normalize, round, sum, uid } from '~/lib/utils'
import { adjustStock, createPO, onHandAt, saveDashboard, startCount, transferStock, event } from '~/data/commands'
import { mergeChangeSets, type ChangeSet } from '~/data/changeset'
import type { ToolName } from './schema'
import type { ExecContext, ToolExec } from './types'
import { record, type Intent } from './policy'
import { ADMIN_TOOLS, executeAdmin } from './executors-admin'

/* ───────────────────────────── Resolution helpers ───────────────────────────── */

type Resolved<T> = { ok: true; value: T } | { ok: false; error: string; candidates?: string[] }

export function resolveItem(s: Snapshot, ref: string): Resolved<Item> {
  const r = ref.trim()
  const n = normalize(r)
  const active = s.items.filter((i) => !i.archived)
  const exact = active.find((i) => i.id === r || i.sku.toLowerCase() === n || i.barcode === r || normalize(i.name) === n)
  if (exact) return { ok: true, value: exact }
  const scored = active
    .map((i) => ({ i, score: Math.max(fuzzyScore(r, i.name), fuzzyScore(r, i.sku) * 0.9, ...i.tags.map((t) => fuzzyScore(r, t) * 0.6)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  if (!scored.length) return { ok: false, error: `No item matches “${ref}”.` }
  if (scored.length === 1 || scored[0].score >= scored[1].score + 15) return { ok: true, value: scored[0].i }
  return { ok: false, error: `“${ref}” matches several items.`, candidates: scored.slice(0, 6).map((x) => `${x.i.name} (${x.i.sku})`) }
}

export function resolveLocation(s: Snapshot, ref: string): Resolved<Location> {
  const n = normalize(ref)
  const hit =
    s.locations.find((l) => l.id === ref || normalize(l.code) === n || normalize(l.name) === n) ??
    s.locations.find((l) => normalize(l.name).includes(n) || n.includes(normalize(l.name)) || (n.includes('warehouse') && l.kind === 'warehouse') || (n.includes('armaz') && l.kind === 'warehouse'))
  return hit ? { ok: true, value: hit } : { ok: false, error: `No location matches “${ref}”.`, candidates: s.locations.map((l) => l.name) }
}

export function resolveSupplier(s: Snapshot, ref: string): Resolved<Supplier> {
  const n = normalize(ref)
  const hit = s.suppliers.find((x) => x.id === ref || normalize(x.name) === n) ?? s.suppliers.map((x) => ({ x, sc: fuzzyScore(ref, x.name) })).filter((y) => y.sc > 0).sort((a, b) => b.sc - a.sc)[0]?.x
  return hit ? { ok: true, value: hit } : { ok: false, error: `No supplier matches “${ref}”.`, candidates: s.suppliers.map((x) => x.name) }
}

const coverText = (c: number) => (!Number.isFinite(c) ? 'no recent sales' : c < 1 ? '<1 day' : `${Math.floor(c)} days`)

function itemRow(st: ItemStats, note?: string) {
  return {
    id: st.item.id,
    name: st.item.name,
    sku: st.item.sku,
    onHand: round(st.onHand, 2),
    unit: st.item.unit,
    status: st.status,
    cover: Number.isFinite(st.cover) ? round(st.cover, 1) : -1,
    value: st.value,
    hue: st.item.hue,
    note,
  }
}

function brief(st: ItemStats) {
  return {
    id: st.item.id,
    name: st.item.name,
    sku: st.item.sku,
    on_hand: round(st.onHand, 2),
    unit: st.item.unit,
    status: STATUS_META[st.status].label,
    days_of_cover: Number.isFinite(st.cover) ? round(st.cover, 1) : null,
    sold_per_day: round(st.daily, 2),
    on_order: st.onOrder,
  }
}

export function fail(error: string, candidates?: string[]): ToolExec {
  return { result: { error, candidates }, summary: error }
}

/* ───────────────────────────── Policy ───────────────────────────── */

/**
 * Every write goes through here. The workspace policy decides whether it runs now (journalled, with an undo)
 * or waits as an approval card. `needsPerson` holds back physical moves Operator decided by itself.
 */
export function propose(ctx: ExecContext, intent: Omit<Intent, 'source'> & { needsPerson?: string; alwaysAsk?: string }): ToolExec {
  if (!ctx.canWrite) return { result: { status: 'not_allowed', reason: 'This person has view-only access.' }, summary: 'View-only access — can’t change anything' }
  const source = ctx.source ?? 'operator'
  const hold = intent.alwaysAsk ?? (source !== 'operator' ? intent.needsPerson : undefined)
  const { needsPerson: _n, alwaysAsk: _a, ...rest } = intent
  const r = record(ctx.snapshot, { ...rest, source }, ctx.actor, hold ? { force: 'ask' } : {})
  const action = hold ? { ...r.action, reason: hold } : r.action
  const cs = hold ? { upserts: { actions: [action] } } : r.cs
  const base = { action_id: action.id, title: intent.title, lines: intent.lines.slice(0, 12), value_eur: intent.impactEur ?? null }
  if (r.applied) return { result: { status: 'done', ...base, note: `${r.reason}. Journalled — it can be undone.` }, summary: `${intent.title} — done`, action, apply: cs, view: { kind: 'action', actionId: action.id } }
  return { result: { status: 'awaiting_approval', ...base, reason: action.reason }, summary: `Waiting for approval: ${intent.title}`, action, apply: cs, view: { kind: 'action', actionId: action.id } }
}

/* ───────────────────────────── Widgets ───────────────────────────── */

const WIDGET_SIZE: Record<WidgetType, [number, number]> = {
  kpi: [3, 2],
  health: [3, 5],
  lowStock: [4, 5],
  approvals: [4, 5],
  salesTrend: [8, 5],
  topMovers: [4, 5],
  categoryMix: [4, 5],
  expiry: [4, 5],
  activity: [6, 5],
  locations: [6, 4],
  incoming: [6, 5],
  note: [4, 3],
  brief: [5, 5],
  quickActions: [4, 4],
  itemForecast: [6, 5],
  deadStock: [4, 5],
}

export function placeWidget(widgets: Widget[], type: WidgetType): Widget['layout'] {
  const [w, h] = WIDGET_SIZE[type]
  const bottom = widgets.reduce((m, x) => Math.max(m, x.layout.y + x.layout.h), 0)
  // try to fill the last row first
  const lastRow = widgets.filter((x) => x.layout.y + x.layout.h === bottom)
  const usedRight = lastRow.reduce((m, x) => Math.max(m, x.layout.x + x.layout.w), 0)
  if (lastRow.length && usedRight + w <= 12) {
    const y = Math.min(...lastRow.map((x) => x.layout.y))
    return { x: usedRight, y, w, h }
  }
  return { x: 0, y: bottom, w, h }
}

/* ───────────────────────────── Executors ───────────────────────────── */

export function executeTool(name: ToolName, input: Record<string, any>, ctx: ExecContext): ToolExec {
  if (ADMIN_TOOLS.has(name)) return executeAdmin(name, input, ctx)
  const s = ctx.snapshot
  const { stats, byId } = derive(s)
  const items = indexBy(s.items, (x) => x.id)
  const suppliers = indexBy(s.suppliers, (x) => x.id)
  const locations = indexBy(s.locations, (x) => x.id)

  switch (name) {
    case 'stock_overview': {
      const k = kpis(s)
      const by = (st: string) => stats.filter((x) => x.status === st).length
      const growth = k.prev7.revenue ? round((k.d7.revenue / k.prev7.revenue - 1) * 100, 1) : null
      return {
        result: {
          workspace: s.workspace.name,
          health_score: k.health,
          stock_value_at_cost: k.stockValue,
          stock_value_at_retail: k.retailValue,
          active_items: k.skuCount,
          items_out_of_stock: by('out'),
          items_critical: by('critical'),
          items_to_reorder: by('low'),
          items_overstocked: by('over'),
          items_not_moving: by('dead'),
          capital_in_dead_stock: k.deadValue,
          sales_today: k.today.revenue,
          sales_last_7_days: k.d7.revenue,
          sales_change_vs_previous_7_days_pct: growth,
          sales_last_30_days: k.d30.revenue,
          gross_margin_30d_pct: k.d30.revenue ? round((1 - k.d30.cogs / (k.d30.revenue / 1.13)) * 100, 1) : null,
          annual_stock_turns: k.turnover,
          open_purchase_orders: k.openPOCount,
          open_purchase_orders_value: k.openPOValue,
          pending_approvals: k.pending,
          lots_expiring_soon: expiringBatches(s).length,
          locations: s.locations.map((l) => l.name),
        },
        summary: `Health ${k.health}, ${eur(k.stockValue, { decimals: 0 })} in stock`,
        view: { kind: 'overview' },
      }
    }

    case 'search_items': {
      const q = String(input.query)
      const cats = indexBy(s.categories, (c) => c.id)
      const hits = stats
        .map((st) => ({ st, sc: Math.max(fuzzyScore(q, st.item.name), fuzzyScore(q, st.item.sku), st.item.barcode === q ? 100 : 0, fuzzyScore(q, cats[st.item.categoryId ?? '']?.name ?? '') * 0.7, ...st.item.tags.map((t) => fuzzyScore(q, t) * 0.6)) }))
        .filter((x) => x.sc > 0)
        .sort((a, b) => b.sc - a.sc)
        .slice(0, input.limit ?? 10)
      if (!hits.length) return fail(`No items match “${q}”.`)
      return {
        result: { matches: hits.map((h) => brief(h.st)) },
        summary: `${hits.length} match${hits.length > 1 ? 'es' : ''} for “${q}”`,
        view: { kind: 'items', title: `Results for “${q}”`, rows: hits.map((h) => itemRow(h.st)) },
      }
    }

    case 'list_items': {
      let list: { st: ItemStats; note?: string }[] = []
      const status = input.status as string
      let loc: Location | undefined
      if (input.location) {
        const r = resolveLocation(s, input.location)
        if (!r.ok) return fail(r.error, r.candidates)
        loc = r.value
      }
      if (status === 'expiring') {
        const ex = expiringBatches(s).filter((x) => !loc || x.batch.locationId === loc.id)
        list = ex.map((x) => ({ st: byId[x.item.id], note: `${fmtQty(x.batch.qty, x.item.unit)} · lot ${x.batch.code} · ${x.days <= 0 ? 'today' : `in ${x.days}d`} · ${locations[x.batch.locationId]?.name}` })).filter((x) => x.st)
      } else if (status === 'top') {
        list = topMovers(s, input.limit ?? 10).map((st) => ({ st, note: `${fmtQty(st.sold7, st.item.unit)} sold this week` }))
      } else {
        list = stats
          .filter((x) => x.status === status)
          .filter((x) => !loc || (x.byLocation[loc.id] ?? 0) <= (x.dailyByLocation[loc.id] ?? 0) * 3 || status === 'over' || status === 'dead')
          .sort((a, b) => (status === 'over' || status === 'dead' ? b.value - a.value : a.cover - b.cover))
          .map((st) => ({ st }))
      }
      list = list.slice(0, input.limit ?? 15)
      const label = status === 'top' ? 'Best sellers this week' : status === 'expiring' ? 'Expiring soon' : STATUS_META[status as keyof typeof STATUS_META]?.label ?? status
      return {
        result: { status, count: list.length, items: list.map((x) => ({ ...brief(x.st), note: x.note })) },
        summary: list.length ? `${list.length} item${list.length === 1 ? '' : 's'} · ${label}` : `None · ${label}`,
        view: list.length ? { kind: 'items', title: label + (loc ? ` · ${loc.name}` : ''), rows: list.map((x) => itemRow(x.st, x.note)) } : undefined,
      }
    }

    case 'get_item': {
      const r = resolveItem(s, input.item)
      if (!r.ok) return fail(r.error, r.candidates)
      const st = byId[r.value.id]
      if (!st) return fail('That item is archived.')
      const sup = st.item.supplierId ? suppliers[st.item.supplierId] : undefined
      const f = forecast(s, st.item.id, 14)
      const recent = s.movements.filter((m) => m.itemId === st.item.id).slice(-8).reverse()
      return {
        result: {
          ...brief(st),
          price_incl_vat: st.item.price,
          cost: round(st.item.cost, 2),
          vat_rate: st.item.vatRate,
          margin_pct: round(st.margin * 100, 1),
          abc_class: st.abc,
          by_location: Object.fromEntries(s.locations.map((l) => [l.name, round(st.byLocation[l.id] ?? 0, 2)])),
          reorder_point: st.reorderPoint,
          reorder_point_is_automatic: st.item.reorderPoint == null,
          suggested_order_qty: st.suggestedQty,
          supplier: sup ? { name: sup.name, lead_time_days: sup.leadTimeDays, min_order_value: sup.minOrderValue } : null,
          trend_14d_vs_previous_pct: round(st.trend * 100, 0),
          sold_last_7_days: st.sold7,
          sold_last_30_days: st.sold30,
          forecast_next_14_days_units: round(sum(f.map((x) => x.units)), 1),
          holidays_in_forecast: f.filter((x) => x.holiday).map((x) => `${x.day} ${x.holiday}`),
          lots: batchesFor(s, st.item.id).map((b) => ({ code: b.code, qty: b.qty, expires: b.expiresOn, location: locations[b.locationId]?.name })),
          recent_movements: recent.map((m) => ({ when: m.createdAt.slice(0, 16).replace('T', ' '), type: m.type, qty: m.qty, location: locations[m.locationId]?.name, by: m.actor.name })),
        },
        summary: `${st.item.name} · ${fmtQty(st.onHand, st.item.unit)} on hand`,
        view: { kind: 'item', itemId: st.item.id },
      }
    }

    case 'forecast': {
      const r = resolveItem(s, input.item)
      if (!r.ok) return fail(r.error, r.candidates)
      const days = input.days ?? 28
      const p = projection(s, r.value.id, days)
      const out = p.find((d) => d.level <= 0)
      return {
        result: {
          item: r.value.name,
          total_forecast_units: round(sum(p.map((d) => d.units)), 1),
          projected_stockout: out ? out.day : null,
          incoming: p.filter((d) => d.incoming).map((d) => ({ day: d.day, qty: d.incoming })),
          holidays: p.filter((d) => d.holiday).map((d) => `${d.day} ${d.holiday}`),
          by_week: Array.from({ length: Math.ceil(days / 7) }, (_, w) => round(sum(p.slice(w * 7, w * 7 + 7).map((d) => d.units)), 1)),
        },
        summary: out ? `${r.value.name} runs out around ${date(out.day, 'short')}` : `${r.value.name} covered for ${days} days`,
        view: { kind: 'forecast', itemId: r.value.id, days },
      }
    }

    case 'list_suppliers': {
      const rows = s.suppliers.map((sup) => {
        const open = s.orders.filter((p) => p.supplierId === sup.id && (p.status === 'sent' || p.status === 'partial'))
        return { name: sup.name, lead: sup.leadTimeDays, min: sup.minOrderValue, contact: sup.contact ?? '', open: open.length, items: s.items.filter((i) => i.supplierId === sup.id).length }
      })
      return {
        result: { suppliers: rows },
        summary: `${rows.length} suppliers`,
        view: {
          kind: 'table',
          title: 'Suppliers',
          columns: [
            { key: 'name', label: 'Supplier' },
            { key: 'lead', label: 'Lead time', format: 'days', align: 'right' },
            { key: 'min', label: 'Min. order', format: 'eur', align: 'right' },
            { key: 'items', label: 'Items', format: 'num', align: 'right' },
            { key: 'open', label: 'Open POs', format: 'num', align: 'right' },
          ],
          rows,
        },
      }
    }

    case 'list_orders': {
      let list = s.orders
      if (input.status === 'open') list = list.filter((p) => p.status === 'sent' || p.status === 'partial' || p.status === 'draft')
      else if (input.status) list = list.filter((p) => p.status === input.status)
      if (input.supplier) {
        const r = resolveSupplier(s, input.supplier)
        if (r.ok) list = list.filter((p) => p.supplierId === r.value.id)
      }
      list = list.slice(0, 15)
      const rows = list.map((p) => ({ number: p.number, supplier: suppliers[p.supplierId]?.name ?? '—', status: p.status, expected: p.expectedOn ?? '', value: round(sum(p.lines.map((l) => l.qty * l.unitCost))), lines: p.lines.length }))
      return {
        result: { orders: rows },
        summary: `${rows.length} purchase order${rows.length === 1 ? '' : 's'}`,
        view: {
          kind: 'table',
          title: 'Purchase orders',
          columns: [
            { key: 'number', label: 'PO' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'status', label: 'Status' },
            { key: 'expected', label: 'Expected' },
            { key: 'value', label: 'Value', format: 'eur', align: 'right' },
          ],
          rows,
        },
      }
    }

    case 'run_report': {
      const rep = input.report as string
      if (rep === 'valuation') {
        const rows = [
          ...valueByCategory(s).map((c) => ({ group: c.name, kind: 'Category', value: round(c.value) })),
          ...valueByLocation(s).map((l) => ({ group: l.location.name, kind: 'Location', value: l.value })),
        ]
        return { result: { rows }, summary: 'Stock valuation', view: { kind: 'table', title: 'Stock value at cost', columns: [{ key: 'group', label: 'Group' }, { key: 'kind', label: 'By' }, { key: 'value', label: 'Value', format: 'eur', align: 'right' }], rows } }
      }
      if (rep === 'abc') {
        const rows = (['A', 'B', 'C'] as const).map((c) => {
          const g = stats.filter((x) => x.abc === c)
          return { class: c, items: g.length, revenue30: round(sum(g.map((x) => x.revenue30))), stock: round(sum(g.map((x) => x.value))) }
        })
        return { result: { rows }, summary: 'ABC analysis', view: { kind: 'table', title: 'ABC classification (30-day revenue)', columns: [{ key: 'class', label: 'Class' }, { key: 'items', label: 'Items', format: 'num', align: 'right' }, { key: 'revenue30', label: 'Revenue', format: 'eur', align: 'right' }, { key: 'stock', label: 'Stock value', format: 'eur', align: 'right' }], rows } }
      }
      if (rep === 'dead_stock') {
        const list = stats.filter((x) => x.status === 'dead' || (x.status === 'over' && x.daily < 0.1)).sort((a, b) => b.value - a.value)
        return {
          result: { total_value: round(sum(list.map((x) => x.value))), items: list.map(brief) },
          summary: `${eur(sum(list.map((x) => x.value)), { decimals: 0 })} not moving`,
          view: { kind: 'items', title: 'Not moving', rows: list.map((x) => itemRow(x, x.lastSaleAt ? `last sale ${date(x.lastSaleAt, 'short')}` : 'never sold')) },
        }
      }
      if (rep === 'expiry') {
        const ex = expiringBatches(s, 14)
        const rows = ex.map((x) => ({ item: x.item.name, lot: x.batch.code, qty: x.batch.qty, location: locations[x.batch.locationId]?.name ?? '', expires: x.batch.expiresOn, value: round(x.batch.qty * x.item.cost) }))
        return { result: { lots: rows }, summary: `${rows.length} lots expiring in 14 days`, view: { kind: 'table', title: 'Expiring in 14 days', columns: [{ key: 'item', label: 'Item' }, { key: 'lot', label: 'Lot' }, { key: 'location', label: 'Location' }, { key: 'expires', label: 'Expires' }, { key: 'value', label: 'Value', format: 'eur', align: 'right' }], rows } }
      }
      if (rep === 'supplier_spend') {
        const since = addDays(new Date(), -30).toISOString()
        const rows = s.suppliers
          .map((sup) => {
            const rc = s.receipts.filter((r) => r.supplierId === sup.id && r.status === 'posted' && r.createdAt >= since)
            return { supplier: sup.name, deliveries: rc.length, value: round(sum(rc.flatMap((r) => r.lines.map((l) => l.qty * l.unitCost)))) }
          })
          .sort((a, b) => b.value - a.value)
        return { result: { rows }, summary: 'Supplier spend (30 days)', view: { kind: 'table', title: 'Received from suppliers · 30 days', columns: [{ key: 'supplier', label: 'Supplier' }, { key: 'deliveries', label: 'Deliveries', format: 'num', align: 'right' }, { key: 'value', label: 'Value', format: 'eur', align: 'right' }], rows } }
      }
      // margin
      const rows = s.categories
        .map((c) => {
          const g = stats.filter((x) => x.item.categoryId === c.id)
          const rev = sum(g.map((x) => (x.sold30 * x.item.price) / (1 + x.item.vatRate / 100)))
          const cogs = sum(g.map((x) => x.cogs30))
          return { category: c.name, revenue: round(rev), margin: rev ? round((rev - cogs) / rev, 3) : 0 }
        })
        .filter((r) => r.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue)
      return { result: { rows }, summary: 'Gross margin by category', view: { kind: 'table', title: 'Gross margin · 30 days (ex-VAT)', columns: [{ key: 'category', label: 'Category' }, { key: 'revenue', label: 'Net revenue', format: 'eur', align: 'right' }, { key: 'margin', label: 'Margin', format: 'pct', align: 'right' }], rows } }
    }

    case 'prepare_purchase_order': {
      let sup: Supplier | undefined
      if (input.supplier) {
        const r = resolveSupplier(s, input.supplier)
        if (!r.ok) return fail(r.error, r.candidates)
        sup = r.value
      }
      let lines: { itemId: string; qty: number; unitCost: number }[] = []
      for (const l of (input.lines ?? []) as { item: string; qty: number }[]) {
        const r = resolveItem(s, l.item)
        if (!r.ok) return fail(r.error, r.candidates)
        lines.push({ itemId: r.value.id, qty: l.qty, unitCost: round(byId[r.value.id]?.lastReceiptCost ?? r.value.cost, 4) })
      }
      if (!sup && lines.length) sup = suppliers[items[lines[0].itemId]?.supplierId ?? '']
      if (!sup) return fail('Which supplier? Give a supplier or items that have one.', s.suppliers.map((x) => x.name))
      if (input.auto_fill || !lines.length) {
        const need = stats.filter((x) => x.item.supplierId === sup!.id && x.suggestedQty > 0 && !x.item.tags.includes('daily') && (x.status === 'low' || x.status === 'critical' || x.status === 'out' || x.cover < x.leadTime + s.workspace.settings.reviewDays))
        for (const st of need) if (!lines.some((l) => l.itemId === st.item.id)) lines.push({ itemId: st.item.id, qty: st.suggestedQty, unitCost: round(st.lastReceiptCost ?? st.item.cost, 4) })
      }
      if (!lines.length) return { result: { status: 'nothing_to_order', supplier: sup.name }, summary: `Nothing needs ordering from ${sup.name}` }
      const total = round(sum(lines.map((l) => l.qty * l.unitCost)))
      const { cs, po } = createPO(s, { supplierId: sup.id, lines, status: input.send_on_approval ? 'sent' : 'draft', createdBy: 'agent', note: 'Prepared by Operator.' }, ctx.actor)
      const res = propose(ctx, {
        kind: 'order',
        risk: input.send_on_approval ? 'money' : 'reversible',
        title: `Order to ${sup.name}`,
        lines: [
          ...lines.map((l) => `${fmtQty(l.qty, items[l.itemId]?.unit)} × ${items[l.itemId]?.name} — ${eur(l.qty * l.unitCost)}`),
          ...(total < sup.minOrderValue ? [`Below the ${eur(sup.minOrderValue, { decimals: 0 })} minimum order`] : []),
        ],
        impactEur: total,
        cs,
        link: `/app/orders/${po.id}`,
      })
      ;(res.result as Record<string, unknown>).min_order_value = sup.minOrderValue
      ;(res.result as Record<string, unknown>).expected_delivery = isoDay(addDays(new Date(), sup.leadTimeDays))
      return res
    }

    case 'prepare_transfer': {
      const it = resolveItem(s, input.item)
      if (!it.ok) return fail(it.error, it.candidates)
      const from = resolveLocation(s, input.from)
      if (!from.ok) return fail(from.error, from.candidates)
      const to = resolveLocation(s, input.to)
      if (!to.ok) return fail(to.error, to.candidates)
      if (from.value.id === to.value.id) return fail('From and to are the same location.')
      const avail = onHandAt(s, it.value.id, from.value.id)
      if (input.qty > avail) return fail(`${from.value.name} only has ${fmtQty(avail, it.value.unit)} of ${it.value.name}.`)
      const cs = transferStock(s, { itemId: it.value.id, from: from.value.id, to: to.value.id, qty: input.qty, note: 'Prepared by Operator' }, ctx.actor)
      return propose(ctx, {
        kind: 'transfer',
        risk: 'reversible',
        needsPerson: 'Someone has to move the stock — confirm once it’s done',
        title: `Move ${fmtQty(input.qty, it.value.unit)} ${it.value.name}`,
        lines: [`${from.value.name} → ${to.value.name}`, `${from.value.name} keeps ${fmtQty(round(avail - input.qty, 2), it.value.unit)}`],
        impactEur: round(input.qty * it.value.cost),
        cs,
        link: `/app/items/${it.value.id}`,
      })
    }

    case 'prepare_adjustment': {
      const it = resolveItem(s, input.item)
      if (!it.ok) return fail(it.error, it.candidates)
      const loc = resolveLocation(s, input.location)
      if (!loc.ok) return fail(loc.error, loc.candidates)
      const cur = onHandAt(s, it.value.id, loc.value.id)
      const delta = input.delta ?? (input.new_qty != null ? input.new_qty - cur : 0)
      if (!delta) return fail('That would not change anything.')
      const cs = adjustStock(s, { itemId: it.value.id, locationId: loc.value.id, delta, reason: input.reason, type: /broke|damag|partid|expired|validade|spoil|waste|quebra/i.test(input.reason) ? 'waste' : 'adjustment' }, ctx.actor)
      return propose(ctx, {
        kind: 'adjustment',
        risk: 'reversible',
        needsPerson: 'A correction states what is on the shelf — confirm it',
        title: `${delta > 0 ? 'Add' : 'Remove'} ${fmtQty(Math.abs(delta), it.value.unit)} ${it.value.name}`,
        lines: [`${loc.value.name}: ${fmtQty(cur, it.value.unit)} → ${fmtQty(round(cur + delta, 3), it.value.unit)}`, `Reason: ${input.reason}`],
        impactEur: round(Math.abs(delta) * it.value.cost),
        cs,
        link: `/app/items/${it.value.id}`,
      })
    }

    case 'prepare_item_update': {
      const it = resolveItem(s, input.item)
      if (!it.ok) return fail(it.error, it.candidates)
      const next: Item = { ...it.value }
      const changes: string[] = []
      if (input.price != null) {
        next.price = input.price
        changes.push(`Price ${eur(it.value.price)} → ${eur(input.price)}`)
      }
      if (input.cost != null) {
        next.cost = input.cost
        changes.push(`Cost ${eur(it.value.cost)} → ${eur(input.cost)}`)
      }
      if (input.reorder_point !== undefined) {
        next.reorderPoint = input.reorder_point
        changes.push(`Reorder point ${it.value.reorderPoint ?? 'auto'} → ${input.reorder_point ?? 'auto'}`)
      }
      if (input.reorder_qty !== undefined) {
        next.reorderQty = input.reorder_qty
        changes.push(`Reorder qty ${it.value.reorderQty ?? 'auto'} → ${input.reorder_qty ?? 'auto'}`)
      }
      if (input.safety_days != null) {
        next.safetyDays = input.safety_days
        changes.push(`Safety stock ${it.value.safetyDays}d → ${input.safety_days}d`)
      }
      if (input.supplier) {
        const r = resolveSupplier(s, input.supplier)
        if (!r.ok) return fail(r.error, r.candidates)
        next.supplierId = r.value.id
        changes.push(`Supplier → ${r.value.name}`)
      }
      if (!changes.length) return fail('No changes given.')
      const cs: ChangeSet = { upserts: { items: [next] }, events: [event('item', `Updated ${it.value.name}`, ctx.actor, changes.join(' · '), `/app/items/${it.value.id}`)] }
      return propose(ctx, { kind: 'item', risk: 'reversible', title: `Update ${it.value.name}`, lines: changes, impactEur: null, cs, link: `/app/items/${it.value.id}`, needsPerson: input.price != null ? 'Shelf labels and tills change with the price — confirm it' : undefined })
    }

    case 'start_count': {
      if (!ctx.canWrite) return fail('View-only access.')
      const loc = resolveLocation(s, input.location)
      if (!loc.ok) return fail(loc.error, loc.candidates)
      let ids: string[] = []
      for (const ref of (input.items ?? []) as string[]) {
        const r = resolveItem(s, ref)
        if (r.ok) ids.push(r.value.id)
      }
      if (input.category) {
        const cat = s.categories.find((c) => fuzzyScore(input.category, c.name) > 0)
        if (cat) ids.push(...s.items.filter((i) => i.categoryId === cat.id && !i.archived).map((i) => i.id))
      }
      if (!ids.length) ids = stats.filter((x) => (x.byLocation[loc.value.id] ?? 0) > 0).sort((a, b) => (a.abc < b.abc ? -1 : 1) || b.value - a.value).slice(0, 12).map((x) => x.item.id)
      ids = Array.from(new Set(ids))
      const { cs, count } = startCount(s, { name: input.name ?? `${loc.value.name} — count ${date(new Date(), 'short')}`, locationId: loc.value.id, itemIds: ids }, ctx.actor)
      return { result: { status: 'started', count_id: count.id, items: ids.length }, summary: `Count started · ${ids.length} items`, apply: cs, view: { kind: 'link', to: `/app/counts/${count.id}`, label: `Open count · ${ids.length} items` } }
    }

    case 'add_widget': {
      const dash = (input.dashboard ? s.dashboards.find((d) => fuzzyScore(input.dashboard, d.name) > 0) : undefined) ?? s.dashboards.find((d) => d.id === ctx.dashboardId) ?? s.dashboards[0]
      if (!dash) return fail('No dashboard to add to.')
      const type = input.type as WidgetType
      const config: Record<string, unknown> = {}
      if (input.metric) config.metric = input.metric
      if (type === 'kpi' && !config.metric) config.metric = 'stockValue'
      if (input.days) config.days = input.days
      if (input.text) config.text = input.text
      if (input.location) {
        const r = resolveLocation(s, input.location)
        if (r.ok) config.locationId = r.value.id
      }
      if (input.item) {
        const r = resolveItem(s, input.item)
        if (!r.ok) return fail(r.error, r.candidates)
        config.itemId = r.value.id
      }
      const widget: Widget = { id: uid(), type, title: input.title, config, layout: placeWidget(dash.widgets, type) }
      const cs = mergeChangeSets(saveDashboard({ ...dash, widgets: [...dash.widgets, widget] }))
      return { result: { status: 'added', dashboard: dash.name, widget: type }, summary: `Added ${input.title ?? type} to ${dash.name}`, apply: cs, view: { kind: 'link', to: '/app', label: `See it on ${dash.name}` } }
    }

    case 'open_page': {
      const map: Record<string, string> = { integrations: '/app/integrations', home: '/app', approvals: '/app/approvals', items: '/app/items', receive: '/app/receive', orders: '/app/orders', counts: '/app/counts', movements: '/app/movements', suppliers: '/app/suppliers', locations: '/app/locations', insights: '/app/insights', autopilot: '/app/autopilot', settings: '/app/settings' }
      let to = map[input.page] ?? '/app'
      if (input.page === 'item' && input.id) {
        const r = resolveItem(s, input.id)
        if (!r.ok) return fail(r.error, r.candidates)
        to = `/app/items/${r.value.id}`
      }
      if (input.page === 'order' && input.id) {
        const po = s.orders.find((p) => p.id === input.id || p.number.toLowerCase() === String(input.id).toLowerCase())
        if (po) to = `/app/orders/${po.id}`
      }
      return { result: { opened: to }, summary: `Opened ${input.page}`, navigate: to }
    }
    default:
      return fail(`Unknown tool ${name}`)
  }
}

export function contextLine(s: Snapshot, path: string) {
  const now = new Date()
  const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(now)
  return `[Context: ${d} (Lisbon) · workspace “${s.workspace.name}” · page ${path}]`
}
