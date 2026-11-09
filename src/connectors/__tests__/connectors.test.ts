import { afterEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import { IMPL } from '..'
import { CONNECTORS } from '../catalog'
import { assertPublicUrl } from '../http'
import type { Ctx } from '../types'

/**
 * Each connector is run against responses shaped like the vendor's public documentation.
 * This proves the translation into Nau's batch format; it does not replace a run against a live account.
 */

type Handler = (url: URL, init: RequestInit) => unknown
function mock(routes: [RegExp, Handler][]) {
  const calls: { url: URL; init: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init: RequestInit = {}) => {
      const url = new URL(String(input))
      calls.push({ url, init })
      const hit = routes.find(([re]) => re.test(url.pathname + url.search))
      if (!hit) return new Response(JSON.stringify({ message: `unmocked ${url.pathname}` }), { status: 404 })
      const out = hit[1](url, init)
      return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
  return calls
}
const now = new Date('2026-11-09T12:00:00Z')
const ctx = (creds: Record<string, string>, cursor: Record<string, unknown> = {}): Ctx => ({ creds, cursor, historyDays: 2, now, region: 'continente' })
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.NAU_ALLOW_PRIVATE_HOSTS
})

describe('catalogue', () => {
  it('every connector offered as available has an implementation, and planned ones say how to get data in meanwhile', () => {
    for (const c of CONNECTORS) {
      if (c.status === 'beta') expect(IMPL[c.id], c.id).toBeTruthy()
      else expect(c.meanwhile, c.id).toBeTruthy()
      if (c.can.pushStock) expect(IMPL[c.id]?.pushStock, c.id).toBeTypeOf('function')
      if (c.can.webhooks) expect(IMPL[c.id]?.webhook, c.id).toBeTruthy()
    }
  })
})

describe('outbound safety', () => {
  it('refuses addresses inside the server’s network and anything that is not https', async () => {
    await expect(assertPublicUrl('http://example.com')).rejects.toThrow(/https/)
    await expect(assertPublicUrl('https://localhost/x')).rejects.toThrow(/inside/)
    await expect(assertPublicUrl('https://127.0.0.1/x')).rejects.toThrow(/inside/)
    await expect(assertPublicUrl('https://10.0.0.8/x')).rejects.toThrow(/inside/)
    await expect(assertPublicUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow(/inside/)
    await expect(assertPublicUrl('https://[::1]/x')).rejects.toThrow(/inside/)
    await expect(assertPublicUrl('nonsense')).rejects.toThrow(/valid/)
  })
})

describe('WooCommerce', () => {
  const creds = { url: 'https://loja.exemplo.pt', consumerKey: 'ck_x', consumerSecret: 'cs_y', webhookSecret: 'whs' }
  const order = (id: number, status: string) => ({ id, number: String(id), status, date_created_gmt: '2026-11-08T10:00:00', date_modified_gmt: '2026-11-08T11:00:00', line_items: [{ product_id: 12, variation_id: 0, sku: 'AZ-500', name: 'Azeite 500ml', quantity: 2, price: '7.90' }, { product_id: 40, variation_id: 41, sku: '', name: 'T-shirt — M', quantity: 1, price: '15.00' }] })

  it('reads simple products and variations, paid orders, and puts refunded ones back', async () => {
    process.env.NAU_ALLOW_PRIVATE_HOSTS = '1'
    const calls = mock([
      [/\/products\/40\/variations/, () => [{ id: 41, sku: 'TS-M', price: '15.00', manage_stock: true, stock_quantity: 4, attributes: [{ option: 'M' }] }]],
      [/\/products\?/, () => [{ id: 12, type: 'simple', name: 'Azeite 500ml', sku: 'AZ-500', price: '7.90', manage_stock: true, stock_quantity: 30, categories: [{ name: 'Mercearia' }] }, { id: 40, type: 'variable', name: 'T-shirt', categories: [] }]],
      [/\/orders\?/, () => [order(900, 'processing'), order(901, 'refunded'), order(902, 'pending')]],
    ])
    const r = await IMPL.woocommerce!.pull(ctx(creds))
    expect(r.batch.products).toEqual([
      { category: 'Mercearia', ref: 'p:12', sku: 'AZ-500', name: 'Azeite 500ml', price: 7.9, stock: [{ qty: 30 }] },
      { category: null, ref: 'v:40:41', sku: 'TS-M', name: 'T-shirt — M', price: 15, stock: [{ qty: 4 }] },
    ])
    expect(r.batch.documents!.map((d) => [d.ref, d.kind])).toEqual([['order:900', 'sale'], ['order:901', 'sale'], ['order:901:back', 'refund']])
    expect(r.batch.documents![0].lines[1]).toMatchObject({ productRef: 'v:40:41', qty: 1, unitPrice: 15 })
    expect(r.cursor.since).toBe(now.toISOString())
    expect(calls[0].init.headers).toMatchObject({ authorization: `Basic ${Buffer.from('ck_x:cs_y').toString('base64')}` })
    expect(calls.find((c) => c.url.pathname.endsWith('/orders'))!.url.searchParams.get('modified_after')).toBe('2026-11-07T12:00:00.000Z')
  })

  it('verifies webhook signatures and writes stock back to the right resource', async () => {
    process.env.NAU_ALLOW_PRIVATE_HOSTS = '1'
    const body = JSON.stringify(order(903, 'completed'))
    const sig = crypto.createHmac('sha256', 'whs').update(body).digest('base64')
    const wh = IMPL.woocommerce!.webhook!
    expect(wh.verify({ headers: new Headers({ 'x-wc-webhook-signature': sig }), body, secret: 'whs', url: '' })).toBe(true)
    expect(wh.verify({ headers: new Headers({ 'x-wc-webhook-signature': sig }), body: body + ' ', secret: 'whs', url: '' })).toBe(false)
    expect(wh.verify({ headers: new Headers(), body, secret: 'whs', url: '' })).toBe(false)
    expect(wh.parse({ headers: new Headers({ 'x-wc-webhook-resource': 'order' }), body })!.documents![0].ref).toBe('order:903')
    const calls = mock([[/\/products\//, () => ({})]])
    const out = await IMPL.woocommerce!.pushStock!(ctx(creds), [{ ref: 'p:12', qty: 28.4 }, { ref: 'v:40:41', qty: -2 }, { ref: 'junk', qty: 1 }])
    expect(out).toEqual({ updated: 2, failed: ['junk'] })
    expect(calls.map((c) => [c.url.pathname, c.init.method, c.init.body])).toEqual([
      ['/wp-json/wc/v3/products/12', 'PUT', JSON.stringify({ manage_stock: true, stock_quantity: 28 })],
      ['/wp-json/wc/v3/products/40/variations/41', 'PUT', JSON.stringify({ manage_stock: true, stock_quantity: 0 })],
    ])
  })
})

describe('Shopify', () => {
  const creds = { shop: 'a-loja.myshopify.com', accessToken: 'shpat_x' }
  it('reads variants with cost and stock, orders, and only restocked refunds', async () => {
    mock([
      [/graphql/, (_u, init) => {
        const q = JSON.parse(String(init.body)).query as string
        if (q.includes('productVariants')) return { data: { productVariants: { nodes: [{ id: 'gid://shopify/ProductVariant/1', sku: 'KOM', barcode: '5601', price: '3.20', title: 'Default Title', inventoryQuantity: 12, product: { title: 'Kombucha', productType: 'Bebidas', status: 'ACTIVE' }, inventoryItem: { tracked: true, unitCost: { amount: '1.40' } } }], pageInfo: { hasNextPage: false } } } }
        return { data: { orders: { nodes: [{ id: 'gid://shopify/Order/5', name: '#1005', createdAt: '2026-11-08T09:00:00Z', cancelledAt: null, test: false, lineItems: { nodes: [{ quantity: 3, sku: 'KOM', name: 'Kombucha', variant: { id: 'gid://shopify/ProductVariant/1' }, originalUnitPriceSet: { shopMoney: { amount: '3.20' } } }] }, refunds: [{ id: 'gid://shopify/Refund/9', createdAt: '2026-11-08T12:00:00Z', refundLineItems: { nodes: [{ quantity: 1, restockType: 'RETURN', lineItem: { sku: 'KOM', name: 'Kombucha', variant: { id: 'gid://shopify/ProductVariant/1' } } }, { quantity: 1, restockType: 'NO_RESTOCK', lineItem: { sku: 'KOM', name: 'Kombucha', variant: null } }] } }] }], pageInfo: { hasNextPage: false } } } }
      }],
    ])
    const r = await IMPL.shopify!.pull(ctx(creds))
    expect(r.batch.products).toEqual([{ ref: 'gid://shopify/ProductVariant/1', sku: 'KOM', name: 'Kombucha', barcode: '5601', category: 'Bebidas', price: 3.2, cost: 1.4, stock: [{ qty: 12 }] }])
    expect(r.batch.documents!.map((d) => [d.kind, d.lines.length, d.lines[0].qty])).toEqual([['sale', 1, 3], ['refund', 1, 1]])
  })

  it('checks the HMAC on webhooks and reads the order they carry', () => {
    const body = JSON.stringify({ id: 6, name: '#1006', created_at: '2026-11-09T10:00:00Z', line_items: [{ variant_id: 1, sku: 'KOM', name: 'Kombucha', quantity: 2, price: '3.20' }] })
    const wh = IMPL.shopify!.webhook!
    const good = new Headers({ 'x-shopify-hmac-sha256': crypto.createHmac('sha256', 'secret').update(body).digest('base64'), 'x-shopify-topic': 'orders/create' })
    expect(wh.verify({ headers: good, body, secret: 'secret', url: '' })).toBe(true)
    expect(wh.verify({ headers: good, body, secret: 'other', url: '' })).toBe(false)
    expect(wh.parse({ headers: good, body })!.documents![0]).toMatchObject({ ref: 'gid://shopify/Order/6', kind: 'sale', lines: [{ productRef: 'gid://shopify/ProductVariant/1', qty: 2, unitPrice: 3.2 }] })
  })

  it('rejects a shop address that is not a myshopify.com host', async () => {
    await expect(IMPL.shopify!.test(ctx({ shop: 'evil.example.com/x?', accessToken: 't' }))).rejects.toThrow(/myshopify/)
  })
})

describe('Moloni', () => {
  it('logs in, keeps the rotated tokens, reads products net of VAT and documents day by day', async () => {
    const calls = mock([
      [/\/grant\//, () => ({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600 })],
      [/companies\/getAll/, () => [{ company_id: 77, name: 'Mercearia Central' }]],
      [/products\/getModifiedSince/, () => [{ product_id: 5, name: 'Arroz 1kg', reference: 'ARZ', ean: '5600', price: 1.783, has_stock: 1, stock: 40, taxes: [{ value: 6 }], category: { name: 'Mercearia' }, measurement_unit: { short_name: 'Un' }, suppliers: [{ cost_price: 1.1 }] }]],
      [/simplifiedInvoices\/getAll/, (_u, init) => (String(init.body).includes('date=2026-11-08') ? [{ document_id: 300, status: 1 }, { document_id: 301, status: 0 }] : [])],
      [/simplifiedInvoices\/getOne/, () => ({ number: 12, date: '2026-11-08T18:22:00+0000', document_set: { name: 'FS A' }, entity_name: 'Consumidor final', entity_vat: '999999990', products: [{ product_id: 5, name: 'Arroz 1kg', qty: 3, price: 1.783, discount: 0, taxes: [{ value: 6 }] }] })],
      [/\/getAll/, () => []],
    ])
    const r = await IMPL.moloni!.pull(ctx({ clientId: 'dev', clientSecret: 'sec', username: 'u@x.pt', password: 'pw' }))
    expect(r.creds).toMatchObject({ accessToken: 'acc', refreshToken: 'ref' })
    expect(r.batch.products).toEqual([{ ref: '5', sku: 'ARZ', name: 'Arroz 1kg', barcode: '5600', category: 'Mercearia', unit: 'Un', cost: 1.1, price: 1.89, vatRate: 6, stock: [{ qty: 40 }] }])
    expect(r.batch.documents).toEqual([{ ref: 'simplifiedInvoices:300', kind: 'sale', number: 'FS A 12', date: '2026-11-08T18:22:00', location: null, party: { name: 'Consumidor final', nif: '999999990' }, lines: [{ productRef: '5', sku: null, name: 'Arroz 1kg', qty: 3, unitPrice: 1.89, vatRate: 6 }] }])
    expect(r.cursor.day).toBe('2026-11-09')
    // three days × four kinds of document were listed
    expect(calls.filter((c) => /\/getAll\/$/.test(c.url.pathname) && !c.url.pathname.includes('companies')).length).toBe(12)
    // a second run within the hour reuses the token
    const again = mock([[/\/getAll/, () => []], [/getModifiedSince/, () => []]])
    await IMPL.moloni!.pull(ctx({ ...r.creds!, companyId: '77' }, r.cursor))
    expect(again.some((c) => c.url.pathname.includes('/grant/'))).toBe(false)
  })
})

describe('InvoiceXpress', () => {
  it('reads items (skipping services) and finalised invoices with their lines', async () => {
    const calls = mock([
      [/items\.json/, () => ({ items: [{ id: 1, name: 'CAFE250', description: 'Café moído 250g', unit_price: '4.0650', unit: 'unit', tax: { value: '23.0' } }, { id: 2, name: 'HORA', description: 'Consultoria', unit_price: '50', unit: 'hour', tax: { value: '23.0' } }], pagination: { total_pages: 1 } })],
      [/invoices\.json/, () => ({ invoices: [{ id: 88, type: 'InvoiceReceipt', inverted_sequence_number: 'FR 2026/14', date: '08/11/2026', client: { name: 'Ana', fiscal_id: '123456789' }, items: [{ name: 'CAFE250', description: 'Café moído 250g', unit_price: '4.0650', quantity: '2.0', tax: { value: 23 } }] }, { id: 89, type: 'CreditNote', sequence_number: 'NC 2026/1', date: '09/11/2026', items: [{ name: 'CAFE250', description: 'Café', unit_price: '4.0650', quantity: '1', tax: { value: 23 } }] }], pagination: { total_pages: 1 } })],
    ])
    const r = await IMPL.invoicexpress!.pull(ctx({ account: 'MinhaEmpresa', apiKey: 'k' }))
    expect(r.batch.products).toEqual([{ ref: '1', sku: 'CAFE250', name: 'Café moído 250g', price: 5, vatRate: 23 }])
    expect(r.batch.documents!.map((d) => [d.kind, d.number, d.date, d.lines[0].unitPrice])).toEqual([['sale', 'FR 2026/14', '2026-11-08', 5], ['refund', 'NC 2026/1', '2026-11-09', 5]])
    expect(calls[0].url.host).toBe('minhaempresa.app.invoicexpress.com')
    await expect(IMPL.invoicexpress!.test(ctx({ account: 'evil.com/x', apiKey: 'k' }))).rejects.toThrow(/account name/)
  })
})

describe('Vendus', () => {
  it('reads products with VAT bands and till documents with their items', async () => {
    mock([
      [/\/products\//, () => [{ id: 9, reference: 'BICA', barcode: '', title: 'Café', supply_price: '0.20', gross_price: '0.80', tax_id: 'INT', stock: '120', status: 'on' }]],
      [/\/documents\/700\//, () => ({ id: 700, number: 'FS 01P2026/7', system_time: '2026-11-08 08:31:02', store_id: 3, items: [{ id: 9, reference: 'BICA', title: 'Café', qty: '2', amounts: { gross_unit: '0.80' }, tax_id: 'INT' }] })],
      [/\/documents\/\?.*type=FS/, () => [{ id: 700, number: 'FS 01P2026/7', status: 'N' }, { id: 701, status: 'A' }]],
      [/\/documents\/\?/, () => []],
    ])
    const r = await IMPL.vendus!.pull(ctx({ apiKey: 'k' }))
    expect(r.batch.products).toEqual([{ ref: '9', sku: 'BICA', name: 'Café', barcode: null, cost: 0.2, price: 0.8, vatRate: 13, unit: null, category: null, stock: [{ qty: 120 }] }])
    expect(r.batch.documents).toEqual([{ ref: '700', kind: 'sale', number: 'FS 01P2026/7', date: '2026-11-08 08:31:02', location: '3', lines: [{ productRef: '9', sku: 'BICA', name: 'Café', qty: 2, unitPrice: 0.8, vatRate: 13 }] }])
  })
})

describe('Square', () => {
  it('reads variations and completed orders with returns, and verifies the signed URL + body', async () => {
    mock([
      [/catalog\/list/, () => ({ objects: [{ item_data: { name: 'Pastel de nata', variations: [{ id: 'VAR1', item_variation_data: { name: 'Regular', sku: 'NATA', price_money: { amount: 130, currency: 'EUR' } } }] } }] })],
      [/\/locations/, () => ({ locations: [{ id: 'L1', name: 'Baixa', business_name: 'Pastelaria', status: 'ACTIVE' }] })],
      [/orders\/search/, () => ({ orders: [{ id: 'ORDERID123', location_id: 'L1', closed_at: '2026-11-08T16:00:00Z', line_items: [{ catalog_object_id: 'VAR1', name: 'Pastel de nata', variation_name: 'Regular', quantity: '6', base_price_money: { amount: 130 } }], returns: [{ return_line_items: [{ catalog_object_id: 'VAR1', name: 'Pastel de nata', quantity: '1' }] }] }] })],
    ])
    const r = await IMPL.square!.pull(ctx({ accessToken: 't' }))
    expect(r.batch.products).toEqual([{ ref: 'VAR1', sku: 'NATA', barcode: null, name: 'Pastel de nata', price: 1.3 }])
    expect(r.batch.documents!.map((d) => [d.kind, d.location, d.lines[0].qty])).toEqual([['sale', 'L1', 6], ['refund', 'L1', 1]])
    const url = 'https://nau.example/api/hooks/abc'
    const body = '{"type":"order.updated"}'
    const sig = crypto.createHmac('sha256', 'key').update(url + body).digest('base64')
    expect(IMPL.square!.webhook!.verify({ headers: new Headers({ 'x-square-hmacsha256-signature': sig }), body, secret: 'key', url })).toBe(true)
    expect(IMPL.square!.webhook!.verify({ headers: new Headers({ 'x-square-hmacsha256-signature': sig }), body, secret: 'key', url: url + '/' })).toBe(false)
  })
})

describe('SumUp', () => {
  it('reads successful transactions with the products rung up', async () => {
    mock([
      [/transactions\/history/, () => ({ items: [{ id: 'tx-1', transaction_code: 'TEENSK4W2K', timestamp: '2026-11-08T13:00:00.000Z', status: 'SUCCESSFUL' }], links: [] })],
      [/\/transactions\?id=tx-1/, () => ({ id: 'tx-1', products: [{ name: 'Galão', price: 1.5, quantity: 2 }, { name: 'Tosta mista', price: 3.2, quantity: 1 }] })],
    ])
    const r = await IMPL.sumup!.pull(ctx({ apiKey: 'sup_sk_x', merchantCode: 'mabc1234' }))
    expect(r.batch.documents).toEqual([{ ref: 'tx-1', kind: 'sale', number: 'TEENSK4W2K', date: '2026-11-08T13:00:00.000Z', lines: [{ name: 'Galão', qty: 2, unitPrice: 1.5 }, { name: 'Tosta mista', qty: 1, unitPrice: 3.2 }] }])
    expect(r.cursor.since).toBe('2026-11-08T13:00:00.000Z')
  })
})
