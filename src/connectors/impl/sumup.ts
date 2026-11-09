import type { ExtDocument } from '~/ingest/types'
import { ConnectorError, request } from '../http'
import { num, since, type Connector, type Ctx } from '../types'

const API = 'https://api.sumup.com'
const call = <T>(ctx: Ctx, path: string, query: Record<string, any> = {}) => request<T>(`${API}${path}`, { query, headers: { authorization: `Bearer ${ctx.creds.apiKey}` } })
const merchant = (ctx: Ctx) => {
  const code = ctx.creds.merchantCode?.trim()
  if (!/^[A-Z0-9]{4,16}$/i.test(code ?? '')) throw new ConnectorError('The merchant code looks like MXXXXXXX — it is on your SumUp profile.')
  return code.toUpperCase()
}

export const sumup: Connector = {
  async test(ctx) {
    await call(ctx, `/v2.1/merchants/${merchant(ctx)}/transactions/history`, { limit: 1 })
    return { account: `SumUp ${merchant(ctx)}` }
  },

  /** SumUp knows what was rung up only by name, so lines are matched to items by name. A refund does not say what came back, so it moves no stock. */
  async pull(ctx) {
    const cursor = { ...ctx.cursor }
    const documents: ExtDocument[] = []
    const m = merchant(ctx)
    let budget = 150
    let more = false
    let params: Record<string, any> = { order: 'ascending', limit: 100, 'statuses[]': ['SUCCESSFUL'], 'types[]': ['PAYMENT'], changes_since: since(ctx).toISOString() }
    walk: for (let page = 0; page < 20; page++) {
      const r = await call<{ items?: any[]; links?: { rel: string; href: string }[] }>(ctx, `/v2.1/merchants/${m}/transactions/history`, params)
      for (const t of r.items ?? []) {
        if (budget-- <= 0) {
          more = true
          break walk
        }
        const full = await call<any>(ctx, `/v2.1/merchants/${m}/transactions`, { id: t.id })
        const lines = (full.products ?? []).filter((p: any) => p?.name).map((p: any) => ({ name: p.name, qty: num(p.quantity) || 1, unitPrice: num(p.price_with_vat ?? p.price) }))
        if (lines.length) documents.push({ ref: t.id, kind: 'sale', number: t.transaction_code ?? t.id, date: t.timestamp, lines })
        cursor.since = t.timestamp
      }
      const next = r.links?.find((l) => l.rel === 'next')?.href
      if (!next || !r.items?.length) break
      params = Object.fromEntries(new URLSearchParams(next.replace(/^.*\?/, '')).entries())
    }
    if (!more && !documents.length) cursor.since = ctx.now.toISOString()
    return { batch: { documents }, cursor, more }
  },
}
