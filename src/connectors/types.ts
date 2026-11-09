import type { IngestBatch } from '~/ingest/types'

export type Creds = Record<string, string>
export type Cursor = Record<string, unknown>

export interface Ctx {
  creds: Creds
  cursor: Cursor
  /** How far back the first sync reaches */
  historyDays: number
  now: Date
  region: 'continente' | 'madeira' | 'acores'
}

export interface PullResult {
  batch: IngestBatch
  cursor: Cursor
  /** Rotated tokens to store back, sealed */
  creds?: Creds
  /** There is more history to fetch: call again soon */
  more?: boolean
}

export interface StockPush {
  /** The connector's own product reference, as it appeared in `ExtProduct.ref` */
  ref: string
  qty: number
}

export interface Connector {
  /** Proves the credentials work and names the account */
  test(ctx: Ctx): Promise<{ account: string; creds?: Creds }>
  /** Products once a day (and on the first run), documents every time */
  pull(ctx: Ctx): Promise<PullResult>
  pushStock?(ctx: Ctx, levels: StockPush[]): Promise<{ updated: number; failed: string[] }>
  webhook?: {
    /** `url` is the address the vendor called, which some of them sign */
    verify(input: { headers: Headers; body: string; secret: string; url: string }): boolean
    /** A batch to ingest at once, or null to answer the hook by running a normal sync */
    parse(input: { headers: Headers; body: string }): IngestBatch | null
  }
}

const DAY = 86_400_000
export const isoDay = (d: Date) => d.toISOString().slice(0, 10)
/** Where to resume from: the saved instant minus a small overlap, or the start of the history window. */
export const since = (ctx: Ctx, key = 'since', overlapMinutes = 10) => {
  const saved = typeof ctx.cursor[key] === 'string' ? new Date(ctx.cursor[key] as string) : null
  return saved && !Number.isNaN(saved.getTime()) ? new Date(saved.getTime() - overlapMinutes * 60_000) : new Date(ctx.now.getTime() - ctx.historyDays * DAY)
}
/** The catalogue is re-read on the first run and then once a day. */
export const catalogDue = (ctx: Ctx) => {
  const last = typeof ctx.cursor.catalogAt === 'string' ? new Date(ctx.cursor.catalogAt as string).getTime() : 0
  return ctx.now.getTime() - last > DAY - 3_600_000
}
export const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
export const gross = (net: number, vat: number | null | undefined) => Math.round(net * (1 + (vat ?? 0) / 100) * 10000) / 10000
