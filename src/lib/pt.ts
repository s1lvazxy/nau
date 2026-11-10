import type { Region } from './types'
import { tr } from '~/i18n'

/** Validates a Portuguese NIF (Número de Identificação Fiscal) using the mod-11 check digit. */
export function isValidNIF(raw: string | null | undefined): boolean {
  if (!raw) return false
  const nif = raw.replace(/\s|PT/gi, '')
  if (!/^\d{9}$/.test(nif)) return false
  const validPrefixes = ['1', '2', '3', '45', '5', '6', '70', '71', '72', '74', '75', '77', '79', '8', '90', '91', '98', '99']
  if (!validPrefixes.some((p) => nif.startsWith(p))) return false
  let total = 0
  for (let i = 0; i < 8; i++) total += Number(nif[i]) * (9 - i)
  const mod = total % 11
  const check = mod < 2 ? 0 : 11 - mod
  return check === Number(nif[8])
}

export function nifKind(nif: string): string {
  if (/^[123]/.test(nif)) return tr('Individual')
  if (/^45/.test(nif)) return 'Non-resident individual'
  if (/^5/.test(nif)) return tr('Company')
  if (/^6/.test(nif)) return tr('Public body')
  if (/^8/.test(nif)) return tr('Sole trader')
  if (/^9/.test(nif)) return tr('Other entity')
  return tr('Entity')
}

export function formatNIF(nif: string) {
  const n = nif.replace(/\D/g, '')
  return n.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')
}

/** Generates a checksum-valid NIF from an 8-digit stem (used for demo data only). */
export function makeNIF(stem: string) {
  const s = stem.padEnd(8, '0').slice(0, 8)
  let total = 0
  for (let i = 0; i < 8; i++) total += Number(s[i]) * (9 - i)
  const mod = total % 11
  return s + String(mod < 2 ? 0 : 11 - mod)
}

export const VAT_RATES: Record<Region, { normal: number; intermediate: number; reduced: number }> = {
  continente: { normal: 23, intermediate: 13, reduced: 6 },
  madeira: { normal: 22, intermediate: 12, reduced: 4 },
  acores: { normal: 16, intermediate: 9, reduced: 4 },
}

export function vatOptions(region: Region) {
  const r = VAT_RATES[region]
  return [
    { value: r.normal, label: tr('{0}% · Normal', r.normal) },
    { value: r.intermediate, label: tr('{0}% · Intermediate', r.intermediate) },
    { value: r.reduced, label: tr('{0}% · Reduced', r.reduced) },
    { value: 0, label: tr('0% · Exempt') },
  ]
}

export const REGION_LABEL: Record<Region, string> = {
  continente: tr('Mainland Portugal'),
  madeira: tr('Madeira'),
  acores: tr('Azores'),
}

function easter(year: number) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

const key = (d: Date) => d.toISOString().slice(0, 10)
const shift = (d: Date, n: number) => new Date(d.getTime() + n * 86400000)

export interface Holiday {
  date: string
  name: string
  scope: 'national' | 'lisboa' | 'porto'
  /** Demand multiplier applied by the forecast for retail/food on the day before and the day itself */
  lift: number
}

export function holidays(year: number): Holiday[] {
  const e = easter(year)
  const fixed = (m: number, d: number) => key(new Date(Date.UTC(year, m - 1, d)))
  return [
    { date: fixed(1, 1), name: tr('New Year’s Day'), scope: 'national', lift: 0.6 },
    { date: key(shift(e, -47)), name: tr('Carnival'), scope: 'national', lift: 1.1 },
    { date: key(shift(e, -2)), name: tr('Good Friday'), scope: 'national', lift: 0.8 },
    { date: key(e), name: tr('Easter Sunday'), scope: 'national', lift: 1.3 },
    { date: fixed(4, 25), name: tr('Freedom Day'), scope: 'national', lift: 0.9 },
    { date: fixed(5, 1), name: tr('Labour Day'), scope: 'national', lift: 0.8 },
    { date: key(shift(e, 60)), name: tr('Corpus Christi'), scope: 'national', lift: 0.9 },
    { date: fixed(6, 10), name: tr('Portugal Day'), scope: 'national', lift: 1.0 },
    { date: fixed(6, 13), name: tr('Santo António'), scope: 'lisboa', lift: 1.6 },
    { date: fixed(6, 24), name: tr('São João'), scope: 'porto', lift: 1.6 },
    { date: fixed(8, 15), name: tr('Assumption'), scope: 'national', lift: 1.0 },
    { date: fixed(10, 5), name: tr('Republic Day'), scope: 'national', lift: 0.9 },
    { date: fixed(11, 1), name: tr('All Saints’ Day'), scope: 'national', lift: 0.9 },
    { date: fixed(12, 1), name: tr('Restoration of Independence'), scope: 'national', lift: 1.1 },
    { date: fixed(12, 8), name: tr('Immaculate Conception'), scope: 'national', lift: 1.1 },
    { date: fixed(12, 24), name: tr('Christmas Eve'), scope: 'national', lift: 1.8 },
    { date: fixed(12, 25), name: tr('Christmas Day'), scope: 'national', lift: 0.4 },
    { date: fixed(12, 31), name: tr('New Year’s Eve'), scope: 'national', lift: 1.5 },
  ]
}

const holidayCache = new Map<number, Map<string, Holiday>>()
export function holidayOn(day: string): Holiday | undefined {
  const y = Number(day.slice(0, 4))
  let m = holidayCache.get(y)
  if (!m) {
    m = new Map(holidays(y).map((h) => [h.date, h]))
    holidayCache.set(y, m)
  }
  return m.get(day)
}

export function upcomingHolidays(from: Date, days: number): Holiday[] {
  const out: Holiday[] = []
  for (let i = 0; i <= days; i++) {
    const d = key(shift(new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())), i))
    const h = holidayOn(d)
    if (h) out.push(h)
  }
  return out
}

/**
 * AT year-end inventory communication (Portaria n.º 2/2015) — CSV layout.
 * Columns: ProductCategory;ProductCode;ProductDescription;ProductNumberCode;ClosingStockQuantity;UnitOfMeasure
 */
export function atInventoryCSV(
  rows: { category: string; code: string; description: string; numberCode: string; qty: number; unit: string }[],
) {
  const esc = (s: string) => s.replace(/;/g, ',').replace(/\r?\n/g, ' ').trim()
  const header = 'ProductCategory;ProductCode;ProductDescription;ProductNumberCode;ClosingStockQuantity;UnitOfMeasure'
  const body = rows.map((r) =>
    [r.category, esc(r.code), esc(r.description).slice(0, 200), esc(r.numberCode || r.code), r.qty.toFixed(2).replace('.', ','), esc(r.unit.toUpperCase())].join(';'),
  )
  return [header, ...body].join('\r\n')
}

/** Parses SAF-T (PT) sales invoices into per-product sold quantities. Runs in the browser with DOMParser. */
export function parseSAFT(xml: string): { invoices: number; lines: { code: string; description: string; qty: number; date: string; unitPrice: number }[]; period?: string; company?: string } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error(tr('This file is not valid XML.'))
  const byLocal = (el: Element | Document, name: string) => Array.from(el.getElementsByTagNameNS('*', name))
  const text = (el: Element, name: string) => byLocal(el, name)[0]?.textContent?.trim() ?? ''
  const header = byLocal(doc, 'Header')[0]
  const company = header ? text(header, 'CompanyName') : undefined
  const period = header ? `${text(header, 'StartDate')} → ${text(header, 'EndDate')}` : undefined
  const invoices = byLocal(doc, 'Invoice')
  const lines: { code: string; description: string; qty: number; date: string; unitPrice: number }[] = []
  for (const inv of invoices) {
    const type = text(inv, 'InvoiceType')
    const status = byLocal(inv, 'InvoiceStatus')[0]?.textContent?.trim()
    if (status === 'A') continue // annulled
    const sign = type === 'NC' ? -1 : 1 // credit notes return goods
    const date = text(inv, 'InvoiceDate')
    for (const line of byLocal(inv, 'Line')) {
      const code = text(line, 'ProductCode')
      const qty = Number(text(line, 'Quantity').replace(',', '.')) || 0
      if (!code || !qty) continue
      lines.push({ code, description: text(line, 'ProductDescription'), qty: qty * sign, date, unitPrice: Number(text(line, 'UnitPrice')) || 0 })
    }
  }
  return { invoices: invoices.length, lines, period, company }
}
