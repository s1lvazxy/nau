import type { z } from 'zod'
import { DocumentsBody, ProductsBody } from '~/ingest/schema'
import { requireApiKey } from './auth'
import { load } from './db'
import { json } from './guard'
import { apiIntegration, applyBatch } from './integrations'

/**
 * Nau public API, v1 — the generic connector. Anything that can make an HTTP request can feed Nau and read it back.
 *
 *   GET  /api/v1/items          the catalogue with stock per location
 *   GET  /api/v1/stock          stock levels, flat
 *   GET  /api/v1/movements      the ledger, newest first (?since=ISO&type=sale&limit=200)
 *   GET  /api/v1/orders         purchase orders (?status=sent)
 *   POST /api/v1/documents      sales, returns and deliveries — idempotent on each document's `ref`
 *   POST /api/v1/products       create or update catalogue items; `setStock` writes stock figures
 *
 * Authenticate with `Authorization: Bearer nau_…` (create keys under Integrations → Developers).
 */

const err = (status: number, code: string, message: string, details?: unknown) => json({ error: { code, message, ...(details ? { details } : {}) } }, status)
const issues = (e: z.ZodError) => e.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }))

export async function readV1(request: Request, resource: string) {
  const auth = await requireApiKey(request, 'read')
  if (!auth.ok) return auth.res
  const q = new URL(request.url).searchParams
  const s = await load(auth.workspaceId)
  const loc = new Map(s.locations.map((l) => [l.id, l]))
  const item = new Map(s.items.map((i) => [i.id, i]))
  if (resource === 'items') {
    const cat = new Map(s.categories.map((c) => [c.id, c.name]))
    const sup = new Map(s.suppliers.map((x) => [x.id, x.name]))
    const stock = new Map<string, { location: string; code: string; on_hand: number }[]>()
    for (const l of s.levels) stock.set(l.itemId, [...(stock.get(l.itemId) ?? []), { location: loc.get(l.locationId)?.name ?? '', code: loc.get(l.locationId)?.code ?? '', on_hand: l.onHand }])
    return json({
      data: s.items
        .filter((i) => q.get('archived') === 'true' || !i.archived)
        .map((i) => ({ id: i.id, sku: i.sku, name: i.name, barcode: i.barcode ?? null, category: cat.get(i.categoryId ?? '') ?? null, unit: i.unit, cost: i.cost, price: i.price, vat_rate: i.vatRate, supplier: sup.get(i.supplierId ?? '') ?? null, reorder_point: i.reorderPoint ?? null, tracks_expiry: i.tracksExpiry, archived: !!i.archived, on_hand: (stock.get(i.id) ?? []).reduce((a, x) => a + x.on_hand, 0), stock: stock.get(i.id) ?? [] })),
    })
  }
  if (resource === 'stock')
    return json({ data: s.levels.filter((l) => item.has(l.itemId)).map((l) => ({ item_id: l.itemId, sku: item.get(l.itemId)!.sku, location: loc.get(l.locationId)?.name ?? '', location_code: loc.get(l.locationId)?.code ?? '', on_hand: l.onHand })) })
  if (resource === 'movements') {
    const since = q.get('since')
    const type = q.get('type')
    const limit = Math.min(1000, Math.max(1, Number(q.get('limit')) || 200))
    const rows = s.movements.filter((m) => (!since || m.createdAt >= since) && (!type || m.type === type)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
    return json({ data: rows.map((m) => ({ id: m.id, at: m.createdAt, type: m.type, item_id: m.itemId, sku: item.get(m.itemId)?.sku ?? null, location: loc.get(m.locationId)?.name ?? '', qty: m.qty, unit_cost: m.unitCost ?? null, ref: m.ref ?? null, lot: m.batchCode ?? null, by: m.actor.name })), window_days: 120 })
  }
  if (resource === 'orders') {
    const status = q.get('status')
    const sup = new Map(s.suppliers.map((x) => [x.id, x]))
    return json({ data: s.orders.filter((o) => !status || o.status === status).map((o) => ({ id: o.id, number: o.number, status: o.status, supplier: sup.get(o.supplierId)?.name ?? null, supplier_nif: sup.get(o.supplierId)?.nif ?? null, location: loc.get(o.locationId)?.name ?? '', expected_on: o.expectedOn ?? null, created_at: o.createdAt, sent_at: o.sentAt ?? null, lines: o.lines.map((l) => ({ sku: item.get(l.itemId)?.sku ?? null, name: item.get(l.itemId)?.name ?? null, qty: l.qty, unit_cost: l.unitCost, received: l.received })) })) })
  }
  return err(404, 'not_found', `There is no /api/v1/${resource}.`)
}

export async function writeV1(request: Request, resource: string) {
  const auth = await requireApiKey(request, 'write')
  if (!auth.ok) return auth.res
  const raw = await request.text()
  if (raw.length > 4_000_000) return err(413, 'too_large', 'Send at most 4 MB per request.')
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return err(400, 'invalid_json', 'The body is not valid JSON.')
  }
  try {
    if (resource === 'documents') {
      // One document may be sent bare
      const parsed = DocumentsBody.safeParse(body && typeof body === 'object' && 'documents' in body ? body : { documents: [body] })
      if (!parsed.success) return err(422, 'invalid', 'Some fields are missing or wrong.', issues(parsed.error))
      const post = new URL(request.url).searchParams.get('post') === 'true'
      const { report } = await applyBatch(auth.workspaceId, await apiIntegration(auth.workspaceId), { documents: parsed.data.documents }, { source: 'api', label: auth.name, actorName: `API · ${auth.name}`, kind: 'api', postPurchases: post })
      return json({ data: { accepted: report.documents.sales + report.documents.refunds + report.documents.purchases, already_known: report.documents.skipped, lines_applied: report.lines.applied, items_created: report.products.created, units_sold_without_stock: report.negative } })
    }
    if (resource === 'products') {
      const parsed = ProductsBody.safeParse(body)
      if (!parsed.success) return err(422, 'invalid', 'Some fields are missing or wrong.', issues(parsed.error))
      const { report } = await applyBatch(auth.workspaceId, await apiIntegration(auth.workspaceId), { products: parsed.data.products }, { source: 'api', label: auth.name, actorName: `API · ${auth.name}`, kind: 'api', updateExisting: parsed.data.update !== false, setStock: !!parsed.data.setStock })
      return json({ data: { created: report.products.created, updated: report.products.updated, unchanged: report.products.matched - report.products.updated, stock_levels_set: report.stockSet } })
    }
  } catch (e) {
    console.error('[api/v1]', e)
    return err(500, 'server_error', 'Something went wrong on our side. The request can be retried safely.')
  }
  return err(404, 'not_found', `There is no /api/v1/${resource}.`)
}

