import type { ExtDocument, ExtProduct, IngestBatch } from '~/ingest/types'
import { hmac, safeEqual } from '~/server/crypto'
import { basic, request } from '../http'
import { catalogDue, num, since, type Connector, type Ctx } from '../types'

const api = <T>(ctx: Ctx, path: string, o: { query?: Record<string, any>; json?: unknown; method?: string } = {}) =>
  request<T>(`${ctx.creds.url.replace(/\/+$/, '')}/wp-json/wc/v3/${path}`, { ...o, untrusted: true, headers: { authorization: basic(ctx.creds.consumerKey, ctx.creds.consumerSecret) } })

const PAID = new Set(['processing', 'completed', 'on-hold'])
const BACK = new Set(['refunded', 'cancelled'])
/** A simple product is `p:12`; a variation is `v:12:34` (the parent is needed to write stock back). */
const ref = (productId: unknown, variationId?: unknown) => (Number(variationId) ? `v:${productId}:${variationId}` : `p:${productId}`)

function orderDocs(o: any): ExtDocument[] {
  const lines = (o.line_items ?? []).map((l: any) => ({ productRef: ref(l.product_id, l.variation_id), sku: l.sku || null, name: l.name, qty: num(l.quantity), unitPrice: num(l.price) }))
  if (!lines.length) return []
  const sale: ExtDocument = { ref: `order:${o.id}`, kind: 'sale', number: `#${o.number ?? o.id}`, date: o.date_created_gmt ? `${o.date_created_gmt}Z` : o.date_created, lines }
  if (PAID.has(o.status)) return [sale]
  // A sale that was later refunded in full or cancelled puts the goods back. If it never counted as a sale, the pair cancels out.
  if (BACK.has(o.status)) return [sale, { ...sale, ref: `order:${o.id}:back`, kind: 'refund', number: `#${o.number ?? o.id} · ${o.status}`, date: o.date_modified_gmt ? `${o.date_modified_gmt}Z` : sale.date }]
  return []
}

export const woocommerce: Connector = {
  async test(ctx) {
    const s = await api<any>(ctx, 'system_status', { query: { _fields: 'environment' } }).catch(() => null)
    if (!s) await api(ctx, 'products', { query: { per_page: 1 } })
    return { account: new URL(ctx.creds.url).host }
  },

  async pull(ctx) {
    const cursor = { ...ctx.cursor }
    const products: ExtProduct[] = []
    if (catalogDue(ctx)) {
      for (let page = 1; page <= 200; page++) {
        const rows = await api<any[]>(ctx, 'products', { query: { per_page: 100, page, status: 'publish' } })
        for (const p of rows) {
          const base = { category: p.categories?.[0]?.name ?? null }
          if (p.type === 'variable') {
            const vars = await api<any[]>(ctx, `products/${p.id}/variations`, { query: { per_page: 100 } })
            for (const v of vars) products.push({ ...base, ref: ref(p.id, v.id), sku: v.sku || null, name: `${p.name} — ${(v.attributes ?? []).map((a: any) => a.option).join(' / ')}`, price: num(v.price || v.regular_price), stock: v.manage_stock === true ? [{ qty: num(v.stock_quantity) }] : [] })
          } else if (p.type === 'simple') products.push({ ...base, ref: ref(p.id), sku: p.sku || null, name: p.name, price: num(p.price || p.regular_price), stock: p.manage_stock ? [{ qty: num(p.stock_quantity) }] : [] })
        }
        if (rows.length < 100) break
      }
      cursor.catalogAt = ctx.now.toISOString()
    }

    const documents: ExtDocument[] = []
    const modified_after = since(ctx).toISOString()
    let more = false
    for (let page = Number(cursor.page ?? 1); ; page++) {
      const rows = await api<any[]>(ctx, 'orders', { query: { per_page: 100, page, modified_after, dates_are_gmt: true, orderby: 'modified', order: 'asc' } })
      for (const o of rows) documents.push(...orderDocs(o))
      if (rows.length < 100) {
        delete cursor.page
        cursor.since = ctx.now.toISOString()
        break
      }
      if (page - Number(cursor.page ?? 1) >= 4) {
        cursor.page = page + 1
        more = true
        break
      }
    }
    return { batch: { products, documents }, cursor, more }
  },

  async pushStock(ctx, levels) {
    let updated = 0
    const failed: string[] = []
    for (const l of levels) {
      const [kind, a, b] = l.ref.split(':')
      const path = kind === 'v' ? `products/${a}/variations/${b}` : kind === 'p' ? `products/${a}` : null
      if (!path) {
        failed.push(l.ref)
        continue
      }
      await api(ctx, path, { method: 'PUT', json: { manage_stock: true, stock_quantity: Math.max(0, Math.round(l.qty)) } }).then(
        () => updated++,
        () => failed.push(l.ref),
      )
    }
    return { updated, failed }
  },

  webhook: {
    verify: ({ headers, body, secret }) => safeEqual(headers.get('x-wc-webhook-signature'), hmac(secret, body, 'base64')),
    parse({ headers, body }): IngestBatch | null {
      if (headers.get('x-wc-webhook-resource') !== 'order') return null
      return { documents: orderDocs(JSON.parse(body)) }
    },
  },
}
