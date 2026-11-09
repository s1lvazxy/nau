import type { ExtDocument, ExtProduct } from '~/ingest/types'
import { hmac, safeEqual } from '~/server/crypto'
import { request } from '../http'
import { catalogDue, num, since, type Connector, type Ctx } from '../types'

const API = 'https://connect.squareup.com/v2'
const call = <T>(ctx: Ctx, path: string, o: { query?: Record<string, any>; json?: unknown } = {}) => request<T>(`${API}/${path}`, { ...o, headers: { authorization: `Bearer ${ctx.creds.accessToken}` } })
const money = (m: any) => (m?.amount != null ? num(m.amount) / 100 : null)

export const square: Connector = {
  async test(ctx) {
    const r = await call<{ locations?: { name: string; business_name?: string }[] }>(ctx, 'locations')
    return { account: r.locations?.[0]?.business_name ?? r.locations?.[0]?.name ?? 'Square' }
  },

  async pull(ctx) {
    const cursor = { ...ctx.cursor }
    const products: ExtProduct[] = []
    if (catalogDue(ctx)) {
      for (let c: string | undefined, i = 0; i < 300; i++) {
        const r: any = await call(ctx, 'catalog/list', { query: { types: 'ITEM', cursor: c } })
        for (const obj of r.objects ?? []) {
          const vars = obj.item_data?.variations ?? []
          for (const v of vars) {
            const d = v.item_variation_data ?? {}
            products.push({ ref: v.id, sku: d.sku || null, barcode: d.upc || null, name: vars.length > 1 && d.name ? `${obj.item_data.name} — ${d.name}` : obj.item_data.name, price: money(d.price_money) })
          }
        }
        c = r.cursor
        if (!c) break
      }
      cursor.catalogAt = ctx.now.toISOString()
    }

    const locations = ((await call<any>(ctx, 'locations')).locations ?? []).filter((l: any) => l.status !== 'INACTIVE')
    const documents: ExtDocument[] = []
    let more = false
    if (locations.length) {
      let c = cursor.after as string | undefined
      for (let i = 0; ; i++) {
        const r: any = await call(ctx, 'orders/search', { json: { location_ids: locations.map((l: any) => l.id).slice(0, 10), cursor: c, limit: 200, query: { filter: { state_filter: { states: ['COMPLETED'] }, date_time_filter: { closed_at: { start_at: since(ctx).toISOString() } } }, sort: { sort_field: 'CLOSED_AT', sort_order: 'ASC' } } } })
        for (const o of r.orders ?? []) {
          const lines = (o.line_items ?? []).map((l: any) => ({ productRef: l.catalog_object_id ?? null, name: l.variation_name && l.variation_name !== 'Regular' ? `${l.name} — ${l.variation_name}` : l.name, qty: num(l.quantity), unitPrice: money(l.base_price_money) }))
          if (lines.length) documents.push({ ref: o.id, kind: 'sale', number: o.reference_id || o.id.slice(0, 8), date: o.closed_at ?? o.created_at, location: o.location_id, lines })
          const back = (o.returns ?? []).flatMap((x: any) => x.return_line_items ?? []).map((l: any) => ({ productRef: l.catalog_object_id ?? null, name: l.name, qty: num(l.quantity) }))
          if (back.length) documents.push({ ref: `${o.id}:returns`, kind: 'refund', number: `${o.reference_id || o.id.slice(0, 8)} · return`, date: o.closed_at ?? o.created_at, location: o.location_id, lines: back })
        }
        c = r.cursor
        if (!c) {
          delete cursor.after
          cursor.since = ctx.now.toISOString()
          break
        }
        if (i >= 4) {
          cursor.after = c
          more = true
          break
        }
      }
    }
    return { batch: { products, documents }, cursor, more }
  },

  webhook: {
    // Square signs the notification URL followed by the body
    verify: ({ headers, body, secret, url }) => safeEqual(headers.get('x-square-hmacsha256-signature'), hmac(secret, url + body, 'base64')),
    // Order events carry ids only, so the hook simply triggers a sync
    parse: () => null,
  },
}
