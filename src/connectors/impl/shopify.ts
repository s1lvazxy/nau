import type { ExtDocument, ExtProduct, IngestBatch } from '~/ingest/types'
import { hmac, safeEqual } from '~/server/crypto'
import { ConnectorError, request } from '../http'
import { catalogDue, num, since, type Connector, type Ctx } from '../types'
import { tr } from '~/i18n'

const VERSION = '2026-01'
const shopOf = (ctx: Ctx) => {
  const shop = ctx.creds.shop?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop ?? '')) throw new ConnectorError(tr('Use the shop’s .myshopify.com address.'))
  return shop
}

async function gql<T>(ctx: Ctx, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await request<{ data?: T; errors?: { message: string }[] }>(`https://${shopOf(ctx)}/admin/api/${VERSION}/graphql.json`, { headers: { 'x-shopify-access-token': ctx.creds.accessToken }, json: { query, variables } })
  if (r.errors?.length) throw new ConnectorError(tr('Shopify: {0}', r.errors[0].message))
  return r.data as T
}

const VARIANTS = `query($after: String) { productVariants(first: 100, after: $after) { nodes { id sku barcode price title inventoryQuantity product { title productType status } inventoryItem { tracked unitCost { amount } } } pageInfo { hasNextPage endCursor } } }`
const ORDERS = `query($after: String, $q: String) { orders(first: 40, after: $after, query: $q, sortKey: UPDATED_AT) { nodes { id name createdAt cancelledAt test
  lineItems(first: 100) { nodes { quantity sku name variant { id } originalUnitPriceSet { shopMoney { amount } } } }
  refunds { id createdAt refundLineItems(first: 100) { nodes { quantity restockType lineItem { sku name variant { id } } } } } }
  pageInfo { hasNextPage endCursor } } }`

const variantName = (v: any) => (v.title && v.title !== 'Default Title' ? `${v.product?.title} — ${v.title}` : (v.product?.title ?? v.title))

/** The REST-shaped order a webhook delivers. */
function fromWebhookOrder(o: any): ExtDocument[] {
  if (!o?.id || o.test) return []
  const ref = (id: unknown) => (id ? `gid://shopify/ProductVariant/${id}` : null)
  const docs: ExtDocument[] = [{ ref: `gid://shopify/Order/${o.id}`, kind: 'sale', number: o.name ?? String(o.id), date: o.created_at, lines: (o.line_items ?? []).map((l: any) => ({ productRef: ref(l.variant_id), sku: l.sku || null, name: l.name ?? l.title, qty: num(l.quantity), unitPrice: num(l.price) })) }]
  for (const r of o.refunds ?? []) {
    const lines = (r.refund_line_items ?? []).filter((x: any) => x.restock_type && x.restock_type !== 'no_restock').map((x: any) => ({ productRef: ref(x.line_item?.variant_id), sku: x.line_item?.sku || null, name: x.line_item?.name ?? '', qty: num(x.quantity) }))
    if (lines.length) docs.push({ ref: `gid://shopify/Refund/${r.id}`, kind: 'refund', number: `${o.name} · refund`, date: r.created_at ?? o.updated_at, lines })
  }
  return docs
}

export const shopify: Connector = {
  async test(ctx) {
    const d = await gql<{ shop: { name: string } }>(ctx, `{ shop { name } }`)
    return { account: d.shop.name }
  },

  async pull(ctx) {
    const cursor = { ...ctx.cursor }
    const products: ExtProduct[] = []
    if (catalogDue(ctx)) {
      for (let after: string | null = null, i = 0; i < 300; i++) {
        const d: any = await gql(ctx, VARIANTS, { after })
        for (const v of d.productVariants.nodes) {
          if (v.product?.status === 'ARCHIVED') continue
          products.push({ ref: v.id, sku: v.sku || null, name: variantName(v), barcode: v.barcode || null, category: v.product?.productType || null, price: num(v.price), cost: v.inventoryItem?.unitCost ? num(v.inventoryItem.unitCost.amount) : null, stock: v.inventoryItem?.tracked ? [{ qty: num(v.inventoryQuantity) }] : [] })
        }
        if (!d.productVariants.pageInfo.hasNextPage) break
        after = d.productVariants.pageInfo.endCursor
      }
      cursor.catalogAt = ctx.now.toISOString()
    }

    const documents: ExtDocument[] = []
    let after = (cursor.after as string | undefined) ?? null
    let more = false
    const q = `updated_at:>='${since(ctx).toISOString()}'`
    for (let i = 0; ; i++) {
      const d: any = await gql(ctx, ORDERS, { after, q })
      for (const o of d.orders.nodes) {
        if (o.test) continue
        if (!o.cancelledAt) documents.push({ ref: o.id, kind: 'sale', number: o.name, date: o.createdAt, lines: o.lineItems.nodes.map((l: any) => ({ productRef: l.variant?.id ?? null, sku: l.sku || null, name: l.name, qty: num(l.quantity), unitPrice: num(l.originalUnitPriceSet?.shopMoney?.amount) })) })
        for (const r of o.refunds ?? []) {
          // Only what went back on the shelf counts as stock returning
          const lines = r.refundLineItems.nodes.filter((x: any) => x.restockType && x.restockType !== 'NO_RESTOCK').map((x: any) => ({ productRef: x.lineItem?.variant?.id ?? null, sku: x.lineItem?.sku || null, name: x.lineItem?.name ?? '', qty: num(x.quantity) }))
          if (lines.length) documents.push({ ref: r.id, kind: 'refund', number: `${o.name} · refund`, date: r.createdAt, lines })
        }
      }
      if (!d.orders.pageInfo.hasNextPage) {
        delete cursor.after
        cursor.since = ctx.now.toISOString()
        break
      }
      after = d.orders.pageInfo.endCursor
      if (i >= 9) {
        cursor.after = after
        more = true
        break
      }
    }
    return { batch: { products, documents }, cursor, more }
  },

  async pushStock(ctx, levels) {
    const loc = ctx.creds.locationId || (await gql<any>(ctx, `{ locations(first: 1, query: "active:true") { nodes { id } } }`)).locations.nodes[0]?.id
    if (!loc) throw new ConnectorError(tr('The shop has no active location to hold stock.'))
    let updated = 0
    const failed: string[] = []
    for (let i = 0; i < levels.length; i += 50) {
      const chunk = levels.slice(i, i + 50)
      const found: any = await gql(ctx, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id inventoryItem { id tracked } } } }`, { ids: chunk.map((l) => l.ref) })
      const item = new Map<string, string>((found.nodes ?? []).filter((n: any) => n?.inventoryItem?.tracked).map((n: any) => [n.id, n.inventoryItem.id]))
      const quantities = chunk.filter((l) => item.has(l.ref)).map((l) => ({ inventoryItemId: item.get(l.ref)!, locationId: loc, quantity: Math.max(0, Math.round(l.qty)), changeFromQuantity: null }))
      failed.push(...chunk.filter((l) => !item.has(l.ref)).map((l) => l.ref))
      if (!quantities.length) continue
      // One key per content: a retried request lands once
      const key = hmac('nau-shopify-stock', JSON.stringify(quantities)).slice(0, 32)
      const r: any = await gql(ctx, `mutation($input: InventorySetQuantitiesInput!, $key: String!) { inventorySetQuantities(input: $input) @idempotent(key: $key) { userErrors { field message } } }`, { input: { name: 'available', reason: 'correction', referenceDocumentUri: 'nau://stock-sync', quantities }, key })
      const errors = r.inventorySetQuantities?.userErrors ?? []
      if (errors.length) throw new ConnectorError(tr('Shopify refused the stock update: {0}', errors[0].message))
      updated += quantities.length
    }
    return { updated, failed }
  },

  webhook: {
    verify: ({ headers, body, secret }) => safeEqual(headers.get('x-shopify-hmac-sha256'), hmac(secret, body, 'base64')),
    parse({ headers, body }): IngestBatch | null {
      const topic = headers.get('x-shopify-topic') ?? ''
      if (!topic.startsWith('orders/') && !topic.startsWith('refunds/')) return null
      const o = JSON.parse(body)
      if (topic.startsWith('refunds/')) return null // a refund names its order only by id: let the sync read it whole
      return { documents: fromWebhookOrder(o).filter((d) => d.kind !== 'sale' || !o.cancelled_at) }
    },
  },
}
