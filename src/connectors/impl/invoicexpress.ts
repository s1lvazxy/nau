import type { ExtDocument, ExtProduct } from '~/ingest/types'
import { ConnectorError, request } from '../http'
import { catalogDue, gross, num, since, type Connector, type Ctx } from '../types'
import { tr } from '~/i18n'

const base = (ctx: Ctx) => {
  const account = ctx.creds.account?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.app\.invoicexpress\.com.*$/, '')
  if (!/^[a-z0-9-]+$/.test(account ?? '')) throw new ConnectorError(tr('The account name is the first part of your InvoiceXpress address.'))
  return `https://${account}.app.invoicexpress.com`
}
const get = <T>(ctx: Ctx, path: string, query: Record<string, any> = {}) => request<T>(`${base(ctx)}/${path}`, { query: { api_key: ctx.creds.apiKey, ...query } })
const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
const ymd = (s: string) => {
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s
}

export const invoicexpress: Connector = {
  async test(ctx) {
    await get(ctx, 'items.json', { per_page: 1 })
    return { account: `${ctx.creds.account}.app.invoicexpress.com` }
  },

  async pull(ctx) {
    const cursor = { ...ctx.cursor }
    const products: ExtProduct[] = []
    if (catalogDue(ctx)) {
      for (let page = 1; page <= 400; page++) {
        const r = await get<{ items?: any[]; pagination?: { total_pages?: number } }>(ctx, 'items.json', { page, per_page: 30 })
        for (const it of r.items ?? []) {
          if (it.unit === 'service' || it.unit === 'hour' || it.unit === 'day' || it.unit === 'month') continue
          const vat = num(it.tax?.value)
          // In InvoiceXpress the item "name" is the short code and the description is what people read
          products.push({ ref: String(it.id), sku: it.name, name: it.description || it.name, price: gross(num(it.unit_price), vat), vatRate: vat })
        }
        if (!r.items?.length || page >= (r.pagination?.total_pages ?? 1)) break
      }
      cursor.catalogAt = ctx.now.toISOString()
    }

    const from = since(ctx, 'since', 60 * 24) // dates have no time of day here: reread from the day before
    const documents: ExtDocument[] = []
    let more = false
    for (let page = Number(cursor.page ?? 1); ; page++) {
      const r = await get<{ invoices?: any[]; pagination?: { total_pages?: number } }>(ctx, 'invoices.json', { page, per_page: 30, 'date[from]': dmy(from), 'date[to]': dmy(ctx.now), 'type[]': ['Invoice', 'InvoiceReceipt', 'SimplifiedInvoice', 'CreditNote'], 'status[]': ['sent', 'settled', 'second_copy'], non_archived: true })
      for (const inv of r.invoices ?? []) {
        // The list carries the lines; older accounts return them only on the document itself
        const items: any[] = inv.items ?? (await get<any>(ctx, `invoices/${inv.id}.json`)).invoice?.items ?? []
        documents.push({
          ref: String(inv.id),
          kind: inv.type === 'CreditNote' ? 'refund' : 'sale',
          number: inv.inverted_sequence_number ?? inv.sequence_number ?? String(inv.id),
          date: ymd(inv.date),
          party: inv.client?.name ? { name: inv.client.name, nif: inv.client.fiscal_id || null } : null,
          lines: items.map((l) => ({ sku: l.name, name: l.description || l.name, qty: num(l.quantity), unitPrice: gross(num(l.unit_price) * (1 - num(l.discount) / 100), num(l.tax?.value)), vatRate: num(l.tax?.value) })),
        })
      }
      if (!r.invoices?.length || page >= (r.pagination?.total_pages ?? 1)) {
        delete cursor.page
        cursor.since = ctx.now.toISOString()
        break
      }
      if (documents.length >= 300) {
        cursor.page = page + 1
        more = true
        break
      }
    }
    return { batch: { products, documents }, cursor, more }
  },
}
