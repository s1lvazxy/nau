import type { ExtDocument, ExtProduct } from '~/ingest/types'
import { VAT_RATES } from '~/lib/pt'
import { request } from '../http'
import { catalogDue, isoDay, num, since, type Connector, type Ctx } from '../types'

const API = 'https://www.vendus.pt/ws/v1.1'
const get = <T>(ctx: Ctx, path: string, query: Record<string, any> = {}) => request<T>(`${API}/${path}/`, { query: { api_key: ctx.creds.apiKey, ...query } })
/** Vendus names VAT bands rather than rates. */
const vat = (ctx: Ctx, id: unknown) => {
  const r = VAT_RATES[ctx.region]
  return ({ NOR: r.normal, INT: r.intermediate, RED: r.reduced, ISE: 0 } as Record<string, number>)[String(id ?? 'NOR').toUpperCase()] ?? r.normal
}
const list = (x: unknown): any[] => (Array.isArray(x) ? x : Array.isArray((x as any)?.data) ? (x as any).data : [])

export const vendus: Connector = {
  async test(ctx) {
    const acc = await get<any>(ctx, 'account')
    return { account: acc?.company ?? acc?.name ?? acc?.email ?? 'Vendus' }
  },

  async pull(ctx) {
    const cursor = { ...ctx.cursor }
    const products: ExtProduct[] = []
    if (catalogDue(ctx)) {
      for (let page = 1; page <= 300; page++) {
        const rows = list(await get(ctx, 'products', { per_page: 100, page }))
        for (const p of rows) {
          if (p.status && p.status !== 'on') continue
          const perStore = Array.isArray(p.stock) ? p.stock : null
          products.push({
            ref: String(p.id),
            sku: p.reference || null,
            name: p.title,
            barcode: p.barcode || null,
            cost: p.supply_price != null ? num(p.supply_price) : null,
            price: num(p.gross_price),
            vatRate: vat(ctx, p.tax_id),
            unit: p.unit_title ?? null,
            category: p.category_title ?? null,
            stock: perStore ? perStore.map((x: any) => ({ location: x.store_id != null ? String(x.store_id) : null, qty: num(x.qty ?? x.stock) })) : p.stock != null && String(p.stock_control ?? '1') !== '0' ? [{ qty: num(p.stock) }] : [],
          })
        }
        if (rows.length < 100) break
      }
      cursor.catalogAt = ctx.now.toISOString()
    }

    const from = isoDay(since(ctx, 'since', 60 * 24))
    const documents: ExtDocument[] = []
    let budget = 200
    let more = false
    walk: for (const type of ['FT', 'FS', 'FR', 'NC']) {
      for (let page = 1; ; page++) {
        const rows = list(await get(ctx, 'documents', { type, since: from, until: isoDay(ctx.now), per_page: 100, page }))
        for (const d of rows) {
          if (d.status && String(d.status).toUpperCase() === 'A') continue // annulled
          if (budget-- <= 0) {
            more = true
            break walk
          }
          const full = await get<any>(ctx, `documents/${d.id}`)
          documents.push({
            ref: String(d.id),
            kind: type === 'NC' ? 'refund' : 'sale',
            number: full.number ?? d.number ?? String(d.id),
            date: full.system_time ?? full.date ?? d.date,
            location: full.store_id != null ? String(full.store_id) : null,
            lines: (full.items ?? []).map((l: any) => ({ productRef: l.id != null ? String(l.id) : null, sku: l.reference || null, name: l.title, qty: num(l.qty), unitPrice: num(l.amounts?.gross_unit ?? l.gross_price), vatRate: l.tax_id ? vat(ctx, l.tax_id) : null })),
          })
        }
        if (rows.length < 100) break
      }
    }
    // An unfinished run restarts from the same day; the documents already taken are skipped by their links
    if (!more) cursor.since = ctx.now.toISOString()
    return { batch: { products, documents }, cursor, more }
  },
}
