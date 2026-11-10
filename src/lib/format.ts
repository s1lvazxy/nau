import { currentLang, tr } from '~/i18n'

/** Numbers follow the language unless the person picked a format in Settings. */
let chosen: 'en-IE' | 'pt-PT' | null = null
/** The locale numbers are written in right now. */
export const numberLocale = () => chosen ?? (currentLang() === 'pt' ? 'pt-PT' : 'en-IE')

export function setNumberLocale(next: 'en-IE' | 'pt-PT' | null) {
  chosen = next
}

const cache = new Map<string, Intl.NumberFormat>()
function nf(key: string, opts: Intl.NumberFormatOptions) {
  const locale = numberLocale()
  const k = locale + key
  let f = cache.get(k)
  if (!f) {
    f = new Intl.NumberFormat(locale, opts)
    cache.set(k, f)
  }
  return f
}

const minus = (s: string) => s.replace(/^-/, '−')

export function eur(v: number, opts: { compact?: boolean; decimals?: number } = {}) {
  if (!Number.isFinite(v)) return '—'
  return minus(eurRaw(v, opts))
}

function eurRaw(v: number, opts: { compact?: boolean; decimals?: number }) {
  if (opts.compact && Math.abs(v) >= 10000)
    return nf('eurc', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(v)
  const d = opts.decimals ?? 2
  return nf('eur' + d, { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(v)
}

export function num(v: number, decimals = 0) {
  if (!Number.isFinite(v)) return '—'
  return minus(nf('n' + decimals, { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(v))
}

export function qty(v: number, unit?: string) {
  const d = Number.isInteger(v) ? 0 : 2
  const s = num(v, d)
  if (!unit || unit === 'un') return s
  return `${s} ${unit}`
}

export function pct(v: number, decimals = 0) {
  if (!Number.isFinite(v)) return '—'
  return nf('p' + decimals, { style: 'percent', maximumFractionDigits: decimals }).format(v)
}

export function signed(v: number, decimals = 0) {
  const s = num(Math.abs(v), decimals)
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s
}

const dtf = new Map<string, Intl.DateTimeFormat>()
/** `fixed` keeps the English layout for values that are parsed, not read. */
function df(key: string, opts: Intl.DateTimeFormatOptions, fixed = false) {
  const locale = fixed || currentLang() === 'en' ? 'en-GB' : 'pt-PT'
  let f = dtf.get(locale + key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Lisbon', ...opts })
    dtf.set(locale + key, f)
  }
  return f
}

export function date(d: string | Date, style: 'short' | 'medium' | 'long' = 'medium') {
  const x = typeof d === 'string' ? new Date(d) : d
  if (style === 'short') return df('s', { day: 'numeric', month: 'short' }).format(x)
  if (style === 'long') return df('l', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(x)
  return df('m', { day: 'numeric', month: 'short', year: 'numeric' }).format(x)
}

export function time(d: string | Date) {
  const x = typeof d === 'string' ? new Date(d) : d
  return df('t', { hour: '2-digit', minute: '2-digit', hour12: false }).format(x)
}

export function dateTime(d: string | Date) {
  return `${date(d, 'short')}, ${time(d)}`
}

export function relative(d: string | Date, now = new Date()) {
  const x = typeof d === 'string' ? new Date(d) : d
  const s = Math.round((now.getTime() - x.getTime()) / 1000)
  const abs = Math.abs(s)
  const fut = s < 0
  const fmt = (n: number, u: string) => (fut ? tr('in {0}{1}', n, u) : tr('{0}{1} ago', n, u))
  if (abs < 45) return fut ? tr('in a moment') : tr('just now')
  if (abs < 3600) return fmt(Math.round(abs / 60), 'm')
  if (abs < 86400) return fmt(Math.round(abs / 3600), 'h')
  if (abs < 86400 * 7) return fmt(Math.round(abs / 86400), 'd')
  return date(x, 'short')
}

export function isoDay(d: Date | string) {
  const x = typeof d === 'string' ? new Date(d) : d
  // Lisbon day key
  const parts = df('iso', { year: 'numeric', month: '2-digit', day: '2-digit' }, true).formatToParts(x)
  const g = (t: string) => parts.find((p) => p.type === t)?.value
  return `${g('year')}-${g('month')}-${g('day')}`
}

export function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function daysBetween(a: string | Date, b: string | Date) {
  const x = typeof a === 'string' ? new Date(a) : a
  const y = typeof b === 'string' ? new Date(b) : b
  return Math.round((y.getTime() - x.getTime()) / 86400000)
}

export function greeting(now = new Date()) {
  const h = Number(df('h', { hour: '2-digit', hour12: false }, true).format(now))
  if (h < 5) return tr('Good evening')
  if (h < 12) return tr('Good morning')
  if (h < 19) return tr('Good afternoon')
  return tr('Good evening')
}
