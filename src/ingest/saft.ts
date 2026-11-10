import type { ExtDocument, ExtParty, ExtProduct, IngestBatch } from './types'
import { tr } from '~/i18n'

const block = (xml: string, tag: string) => xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g'))
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const text = (xml: string, tag: string) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`))
  return m ? unescape(m[1].trim()) : ''
}
const num = (s: string) => Number(s.replace(',', '.')) || 0

export interface SaftSummary {
  batch: IngestBatch
  company: string
  nif: string
  period: string
  invoices: number
  products: number
}

/**
 * SAF-T (PT) — the file every certified invoicing program in Portugal can export.
 * It carries the product list and every sales line of the period, so one file gives Nau
 * the catalogue, shelf prices and the demand history. It carries no stock and no costs.
 * Plain string scanning, so it reads the same in the browser and on the server.
 */
export function saftToBatch(xml: string): SaftSummary {
  if (!/<(?:\w+:)?AuditFile[\s>]/.test(xml)) throw new Error(tr('Este ficheiro não é um SAF-T (PT).'))
  const header = [...block(xml, 'Header')][0]?.[1] ?? ''
  const products = new Map<string, ExtProduct>()
  for (const [, p] of block(xml, 'Product')) {
    const code = text(p, 'ProductCode')
    if (!code || text(p, 'ProductType') === 'S') continue // services hold no stock
    const ean = text(p, 'ProductNumberCode')
    products.set(code, { ref: code, sku: code, name: text(p, 'ProductDescription') || code, category: text(p, 'ProductGroup') || null, barcode: /^\d{8,14}$/.test(ean) && ean !== code ? ean : null })
  }
  const suppliers: ExtParty[] = []
  for (const [, s] of block(xml, 'Supplier')) {
    const name = text(s, 'CompanyName')
    if (name) suppliers.push({ ref: text(s, 'SupplierID') || null, name, nif: text(s, 'SupplierTaxID') || null, email: text(s, 'Email') || null, phone: text(s, 'Telephone') || null })
  }
  const documents: ExtDocument[] = []
  let invoices = 0
  for (const [, inv] of block(xml, 'Invoice')) {
    invoices++
    if (text(inv, 'InvoiceStatus') === 'A' || text(inv, 'InvoiceStatus') === 'F') continue // annulled, or already billed elsewhere
    const type = text(inv, 'InvoiceType')
    if (type === 'ND') continue
    const number = text(inv, 'InvoiceNo')
    const doc: ExtDocument = { ref: number, kind: type === 'NC' ? 'refund' : 'sale', number, date: text(inv, 'InvoiceDate'), lines: [] }
    for (const [, line] of block(inv, 'Line')) {
      const code = text(line, 'ProductCode')
      const qty = num(text(line, 'Quantity'))
      if (!code || !qty) continue
      const known = products.get(code)
      if (!known && !text(line, 'ProductDescription')) continue
      const rate = num(text(line, 'TaxPercentage'))
      const gross = Math.round(num(text(line, 'UnitPrice')) * (1 + rate / 100) * 10000) / 10000
      if (!known) continue // a line whose product is a service (or missing from the master table) moves no stock
      if (gross > 0) {
        known.price = gross
        known.vatRate = rate
      }
      doc.lines.push({ productRef: code, sku: code, name: text(line, 'ProductDescription') || known.name, qty, unitPrice: gross, vatRate: rate })
    }
    if (doc.lines.length) documents.push(doc)
  }
  return {
    batch: { products: [...products.values()], suppliers, documents },
    company: text(header, 'CompanyName'),
    nif: text(header, 'TaxRegistrationNumber'),
    period: [text(header, 'StartDate'), text(header, 'EndDate')].filter(Boolean).join(' → '),
    invoices,
    products: products.size,
  }
}
