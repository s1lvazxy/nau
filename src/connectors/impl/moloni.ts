import type { ExtDocument, ExtProduct } from '~/ingest/types'
import { ConnectorError, request } from '../http'
import { catalogDue, gross, isoDay, num, type Connector, type Creds, type Ctx } from '../types'
import { tr } from '~/i18n'

const API = 'https://api.moloni.pt/v1'
/** Sales documents that move stock, and the one that brings it back. */
const SALES = ['invoices', 'invoiceReceipts', 'simplifiedInvoices'] as const
const PAGE = 50

async function token(ctx: Ctx): Promise<{ access: string; creds?: Creds }> {
  const c = ctx.creds
  if (c.accessToken && Number(c.expiresAt) > ctx.now.getTime() + 60_000) return { access: c.accessToken }
  const base = { client_id: c.clientId, client_secret: c.clientSecret }
  // The refresh token lives 14 days; past that, the password grant starts a new chain.
  const grant = async (q: Record<string, string>) => request<{ access_token: string; refresh_token: string; expires_in?: number }>(`${API}/grant/`, { query: { ...base, ...q } })
  let t: Awaited<ReturnType<typeof grant>>
  try {
    t = c.refreshToken ? await grant({ grant_type: 'refresh_token', refresh_token: c.refreshToken }) : await grant({ grant_type: 'password', username: c.username, password: c.password })
  } catch (e) {
    if (!c.refreshToken || !c.password) throw e
    t = await grant({ grant_type: 'password', username: c.username, password: c.password })
  }
  const creds = { ...c, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: String(ctx.now.getTime() + (t.expires_in ?? 3600) * 1000) }
  return { access: t.access_token, creds }
}

const call = <T>(access: string, path: string, form: Record<string, string | number>) => request<T>(`${API}/${path}/`, { query: { access_token: access }, form })

async function companyId(ctx: Ctx, access: string): Promise<{ id: number; name: string }> {
  const list = await call<{ company_id: number; name: string }[]>(access, 'companies/getAll', {})
  if (!Array.isArray(list) || !list.length) throw new ConnectorError(tr('This Moloni user has no company.'))
  const wanted = ctx.creds.companyId ? list.find((c) => String(c.company_id) === String(ctx.creds.companyId)) : list[0]
  if (!wanted) throw new ConnectorError(tr('Company {0} is not in this Moloni account. Available: {1}', ctx.creds.companyId, list.map((c) => `${c.name} (${c.company_id})`).join(', ')))
  return { id: wanted.company_id, name: wanted.name }
}

export const moloni: Connector = {
  async test(ctx) {
    const t = await token(ctx)
    const co = await companyId({ ...ctx, creds: t.creds ?? ctx.creds }, t.access)
    return { account: co.name, creds: { ...(t.creds ?? ctx.creds), companyId: String(co.id) } }
  },

  async pull(ctx) {
    const t = await token(ctx)
    const creds = t.creds ?? ctx.creds
    const company_id = creds.companyId ? Number(creds.companyId) : (await companyId(ctx, t.access)).id
    const cursor = { ...ctx.cursor }
    const products: ExtProduct[] = []

    if (catalogDue(ctx)) {
      const lastmodified = typeof cursor.catalogAt === 'string' ? (cursor.catalogAt as string).slice(0, 19).replace('T', ' ') : '2000-01-01 00:00:00'
      for (let offset = 0; offset < 20_000; offset += PAGE) {
        const page = await call<any[]>(t.access, 'products/getModifiedSince', { company_id, lastmodified, qty: PAGE, offset })
        if (!Array.isArray(page) || !page.length) break
        for (const p of page) {
          const vat = num(p.taxes?.[0]?.value ?? p.taxes?.[0]?.tax?.value)
          const perWarehouse = Array.isArray(p.warehouses) && p.warehouses.length > 1
          products.push({
            ref: String(p.product_id),
            sku: p.reference || null,
            name: p.name,
            barcode: p.ean || null,
            category: p.category?.name ?? null,
            unit: p.measurement_unit?.short_name ?? null,
            cost: p.suppliers?.[0]?.cost_price ? num(p.suppliers[0].cost_price) : null,
            // Moloni prices are net of VAT; Nau keeps the shelf price
            price: gross(num(p.price), vat),
            vatRate: vat,
            stock: !Number(p.has_stock) ? [] : perWarehouse ? p.warehouses.map((w: any) => ({ location: String(w.warehouse_id), qty: num(w.stock) })) : [{ qty: num(p.stock) }],
          })
        }
        if (page.length < PAGE) break
      }
      cursor.catalogAt = ctx.now.toISOString()
    }

    // Documents are listed day by day (the API filters on an exact date), then read one by one for their lines.
    const start = typeof cursor.day === 'string' ? (cursor.day as string) : isoDay(new Date(ctx.now.getTime() - ctx.historyDays * 86_400_000))
    const seen = new Set<string>(cursor.day === start && Array.isArray(cursor.seen) ? (cursor.seen as string[]) : [])
    const documents: ExtDocument[] = []
    const today = isoDay(ctx.now)
    let day = start
    let budget = 150 // document reads per run; the rest waits for the next one
    let more = false
    walk: for (;;) {
      for (const kind of [...SALES, 'creditNotes'] as const) {
        for (let offset = 0; ; offset += PAGE) {
          const list = await call<any[]>(t.access, `${kind}/getAll`, { company_id, date: day, qty: PAGE, offset })
          if (!Array.isArray(list) || !list.length) break
          for (const d of list) {
            const key = `${kind}:${d.document_id}`
            if (seen.has(key) || Number(d.status) !== 1) continue // drafts are not sales yet
            if (budget-- <= 0) {
              more = true
              break walk
            }
            const full = await call<any>(t.access, `${kind}/getOne`, { company_id, document_id: d.document_id })
            documents.push({
              ref: key,
              kind: kind === 'creditNotes' ? 'refund' : 'sale',
              number: `${full.document_set?.name ?? full.document_type?.saft_code ?? kind} ${full.number}`.trim(),
              date: String(full.date ?? day).slice(0, 19),
              location: full.products?.[0]?.warehouse_id ? String(full.products[0].warehouse_id) : null,
              party: full.entity_name ? { name: full.entity_name, nif: full.entity_vat || null } : null,
              lines: (full.products ?? []).map((l: any) => ({ productRef: l.product_id ? String(l.product_id) : null, sku: l.reference || null, name: l.name, qty: num(l.qty), unitPrice: gross(num(l.price) * (1 - num(l.discount) / 100), num(l.taxes?.[0]?.value)), vatRate: num(l.taxes?.[0]?.value) })),
            })
            seen.add(key)
          }
          if (list.length < PAGE) break
        }
      }
      if (day >= today) break
      day = isoDay(new Date(new Date(`${day}T12:00:00Z`).getTime() + 86_400_000))
      seen.clear()
    }
    cursor.day = day
    cursor.seen = [...seen]
    return { batch: { products, documents }, cursor, creds: t.creds, more }
  },
}
