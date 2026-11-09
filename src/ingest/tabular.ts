import { normalize } from '~/lib/utils'
import type { ExtDocument, ExtProduct, IngestBatch } from './types'

/** What a spreadsheet column can mean to Nau. */
export const FIELDS = ['name', 'sku', 'barcode', 'category', 'unit', 'cost', 'price', 'vat', 'supplier', 'stock', 'location', 'lot', 'expiry', 'qty', 'date', 'doc', 'nif', 'email', 'phone'] as const
export type Field = (typeof FIELDS)[number]
export const SHEET_KINDS = ['items', 'suppliers', 'sales', 'purchases'] as const
export type SheetKind = (typeof SHEET_KINDS)[number]

export interface Table {
  name: string
  headers: string[]
  rows: Record<string, string>[]
}

export interface Mapping {
  kind: SheetKind
  /** header → field, or null to ignore the column */
  columns: Record<string, Field | null>
  /** Shelf prices in the file already include VAT */
  priceIncludesVat: boolean
}

export const FIELD_LABEL: Record<Field, string> = {
  name: 'Nome do artigo',
  sku: 'Referência / SKU',
  barcode: 'Código de barras',
  category: 'Categoria',
  unit: 'Unidade',
  cost: 'Preço de custo',
  price: 'Preço de venda',
  vat: 'Taxa de IVA',
  supplier: 'Fornecedor',
  stock: 'Stock atual',
  location: 'Local',
  lot: 'Lote',
  expiry: 'Validade',
  qty: 'Quantidade',
  date: 'Data',
  doc: 'N.º do documento',
  nif: 'NIF',
  email: 'Email',
  phone: 'Telefone',
}

export const KIND_LABEL: Record<SheetKind, string> = { items: 'Artigos e stock', suppliers: 'Fornecedores', sales: 'Histórico de vendas', purchases: 'Histórico de compras' }

/** Portuguese and English column names seen in exports from Excel, Moloni, PHC, Primavera, Sage, Shopify, WooCommerce and POS software. */
const SYNONYMS: Record<Field, string[]> = {
  name: ['name', 'nome', 'descricao', 'description', 'designacao', 'artigo', 'produto', 'product', 'title', 'titulo', 'item', 'item name', 'product name', 'nome do artigo', 'descricao do artigo'],
  sku: ['sku', 'ref', 'referencia', 'reference', 'codigo', 'code', 'cod', 'codigo do artigo', 'cod artigo', 'product code', 'item code', 'variant sku', 'codigo interno', 'artigo n', 'n artigo'],
  barcode: ['barcode', 'ean', 'ean13', 'gtin', 'upc', 'codigo de barras', 'cod barras', 'codbarras', 'codigo barras'],
  category: ['category', 'categoria', 'familia', 'family', 'grupo', 'group', 'type', 'tipo', 'seccao', 'departamento', 'product type', 'categories'],
  unit: ['unit', 'unidade', 'un', 'uom', 'unidade de medida', 'medida'],
  cost: ['cost', 'custo', 'preco de custo', 'preco custo', 'pcusto', 'pc', 'cost price', 'purchase price', 'preco de compra', 'preco compra', 'custo unitario', 'cost per item', 'ultimo custo', 'custo medio', 'pmc'],
  price: ['price', 'preco', 'pvp', 'preco de venda', 'preco venda', 'pv', 'sale price', 'retail price', 'regular price', 'preco unitario', 'unit price', 'valor', 'variant price', 'preco c iva', 'pvp c iva', 'preco s iva', 'pvp1'],
  vat: ['vat', 'iva', 'taxa iva', 'taxa de iva', 'tax', 'tax rate', 'imposto', 'taxa'],
  supplier: ['supplier', 'fornecedor', 'vendor', 'fornecedor habitual', 'nome fornecedor', 'marca'],
  stock: ['stock', 'existencias', 'existencia', 'qty on hand', 'on hand', 'quantidade em stock', 'stock atual', 'stock actual', 'inventory', 'stock quantity', 'qtd stock', 'saldo', 'disponivel', 'variant inventory qty', 'em stock'],
  location: ['location', 'local', 'armazem', 'warehouse', 'loja', 'store', 'localizacao'],
  lot: ['lot', 'lote', 'batch', 'n lote', 'numero de lote'],
  expiry: ['expiry', 'validade', 'expires', 'expiration', 'data de validade', 'best before', 'expiry date', 'data validade'],
  qty: ['qty', 'quantidade', 'quantity', 'qtd', 'qt', 'units', 'unidades', 'quant'],
  date: ['date', 'data', 'dia', 'created at', 'data documento', 'data do documento', 'data venda', 'paid at', 'data de emissao'],
  doc: ['doc', 'documento', 'document', 'invoice', 'fatura', 'factura', 'numero', 'number', 'order', 'encomenda', 'n documento', 'n doc', 'no', 'order id', 'name order'],
  nif: ['nif', 'nipc', 'contribuinte', 'vat number', 'tax id', 'n contribuinte', 'numero de contribuinte'],
  email: ['email', 'e-mail', 'mail', 'correio eletronico'],
  phone: ['phone', 'telefone', 'telemovel', 'tel', 'contacto', 'mobile'],
}

const key = (h: string) => normalize(h).replace(/[^a-z0-9]+/g, ' ').trim()

function fieldFor(header: string): { field: Field; score: number } | null {
  const k = key(header)
  if (!k) return null
  let best: { field: Field; score: number } | null = null
  for (const f of FIELDS)
    for (const syn of SYNONYMS[f]) {
      const score = k === syn ? 100 : k.startsWith(syn + ' ') || k.endsWith(' ' + syn) ? 70 + syn.length : k.includes(syn) && syn.length >= 4 ? 40 + syn.length : 0
      if (score && (!best || score > best.score)) best = { field: f, score }
    }
  return best
}

/** Reads the header row and decides what each column is and what the sheet holds — no model needed. */
export function guessMapping(table: Pick<Table, 'headers' | 'rows' | 'name'>): Mapping {
  const taken = new Map<Field, { header: string; score: number }>()
  for (const h of table.headers) {
    const g = fieldFor(h)
    if (!g) continue
    const cur = taken.get(g.field)
    if (!cur || g.score > cur.score) taken.set(g.field, { header: h, score: g.score })
  }
  const columns: Record<string, Field | null> = Object.fromEntries(table.headers.map((h) => [h, null]))
  for (const [f, v] of taken) columns[v.header] = f
  const has = (f: Field) => taken.has(f)
  // A sheet with a date and a quantity per line is a history, not a catalogue.
  let kind: SheetKind = 'items'
  const title = key(table.name)
  if (has('date') && has('qty') && !has('stock')) kind = /compra|purchase|fornecedor|entrada|rece/.test(title) || (has('supplier') && has('cost') && !has('price')) ? 'purchases' : 'sales'
  else if ((has('nif') || has('email') || has('phone')) && !has('price') && !has('stock') && !has('sku')) kind = 'suppliers'
  if (kind !== 'items' && columns[taken.get('stock')?.header ?? ''] === 'stock') columns[taken.get('stock')!.header] = 'qty'
  const priceHeader = key(taken.get('price')?.header ?? '')
  return { kind, columns, priceIncludesVat: !/s iva|sem iva|net|excl|liquido/.test(priceHeader) }
}

/** “1.234,56”, “1,234.56”, “12,5 %” and “€ 9.90” all mean what a person would read. */
export function parseNumber(v: string | undefined | null): number | null {
  if (v == null) return null
  let x = String(v).replace(/[^\d,.\-]/g, '')
  if (!x || x === '-') return null
  const comma = x.lastIndexOf(',')
  const dot = x.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) x = comma > dot ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '')
  else if (comma >= 0) x = x.replace(/,/g, (m, i) => (i === comma ? '.' : ''))
  else if (dot >= 0 && /^-?\d{1,3}(\.\d{3}){2,}$/.test(x)) x = x.replace(/\./g, '')
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

/** 31/12/2026, 31-12-26, 2026-12-31 and ISO timestamps → YYYY-MM-DD. Day comes first, as in Portugal. */
export function parseDate(v: string | undefined | null): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    const [d, mo] = Number(m[2]) > 12 ? [m[2], m[1]] : [m[1], m[2]]
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10)
}

export interface TabularIssue {
  row: number
  message: string
}

/** Applies a mapping to the rows of one sheet. */
export function tableToBatch(table: Table, mapping: Mapping): { batch: IngestBatch; issues: TabularIssue[]; used: number } {
  const col = (f: Field) => Object.keys(mapping.columns).find((h) => mapping.columns[h] === f)
  const c = Object.fromEntries(FIELDS.map((f) => [f, col(f)])) as Record<Field, string | undefined>
  const get = (r: Record<string, string>, f: Field) => (c[f] ? (r[c[f]!] ?? '').trim() : '')
  const issues: TabularIssue[] = []
  const batch: IngestBatch = {}
  let used = 0
  const vat = (r: Record<string, string>) => {
    const v = parseNumber(get(r, 'vat'))
    return v == null ? null : v > 0 && v < 1 ? Math.round(v * 100) : v
  }
  const gross = (price: number | null, rate: number | null) => (price == null ? null : mapping.priceIncludesVat ? price : price * (1 + (rate ?? 23) / 100))

  if (mapping.kind === 'suppliers') {
    batch.suppliers = []
    table.rows.forEach((r, i) => {
      const name = get(r, 'name') || get(r, 'supplier')
      if (!name) return void issues.push({ row: i + 2, message: 'Sem nome' })
      batch.suppliers!.push({ name, nif: get(r, 'nif') || null, email: get(r, 'email') || null, phone: get(r, 'phone') || null })
      used++
    })
    return { batch, issues, used }
  }

  if (mapping.kind === 'items') {
    const byRef = new Map<string, ExtProduct>()
    table.rows.forEach((r, i) => {
      const name = get(r, 'name')
      const sku = get(r, 'sku')
      if (!name && !sku) return
      if (!name) return void issues.push({ row: i + 2, message: `${sku}: sem nome` })
      const rate = vat(r)
      const ref = sku || get(r, 'barcode') || key(name)
      let p = byRef.get(ref)
      if (!p) {
        p = { ref, sku: sku || null, name, barcode: get(r, 'barcode') || null, category: get(r, 'category') || null, unit: get(r, 'unit') || null, cost: parseNumber(get(r, 'cost')), price: gross(parseNumber(get(r, 'price')), rate), vatRate: rate, supplier: get(r, 'supplier') || null, stock: [] }
        byRef.set(ref, p)
      }
      // One line per item, or one line per item and location or lot — both fold into the same product.
      const qty = parseNumber(get(r, 'stock'))
      if (qty != null) {
        const expiry = parseDate(get(r, 'expiry'))
        const lot = get(r, 'lot') || (expiry ? `L${expiry.replace(/-/g, '')}` : null)
        if (qty < 0) issues.push({ row: i + 2, message: `${name}: stock negativo (${qty})` })
        p.stock!.push({ location: get(r, 'location') || null, qty, lot, expiresOn: expiry })
        if (lot) p.tracksExpiry = true
      }
      used++
    })
    batch.products = [...byRef.values()]
    return { batch, issues, used }
  }

  // Histories: lines sharing a document number become one document; lines without one, one per day.
  const docs = new Map<string, ExtDocument>()
  table.rows.forEach((r, i) => {
    const qty = parseNumber(get(r, 'qty'))
    const date = parseDate(get(r, 'date'))
    const name = get(r, 'name')
    const sku = get(r, 'sku')
    if (!name && !sku) return
    if (qty == null || !date) return void issues.push({ row: i + 2, message: `${name || sku}: ${qty == null ? 'sem quantidade' : 'data ilegível'}` })
    const number = get(r, 'doc') || `${mapping.kind === 'sales' ? 'Vendas' : 'Compras'} ${date}`
    const ref = `${mapping.kind}:${number}:${date}`
    let d = docs.get(ref)
    if (!d) {
      const sup = mapping.kind === 'purchases' ? get(r, 'supplier') : ''
      d = { ref, kind: mapping.kind === 'sales' ? 'sale' : 'purchase', number, date, location: get(r, 'location') || null, party: sup ? { name: sup, nif: get(r, 'nif') || null } : null, lines: [] }
      docs.set(ref, d)
    }
    const rate = vat(r)
    d.lines.push({ sku: sku || null, barcode: get(r, 'barcode') || null, name: name || sku, qty, unitPrice: gross(parseNumber(get(r, 'price')), rate), unitCost: parseNumber(get(r, 'cost')), vatRate: rate, lot: get(r, 'lot') || null, expiresOn: parseDate(get(r, 'expiry')) })
    used++
  })
  batch.documents = [...docs.values()]
  return { batch, issues, used }
}

export function mergeBatches(...batches: IngestBatch[]): IngestBatch {
  return { products: batches.flatMap((b) => b.products ?? []), suppliers: batches.flatMap((b) => b.suppliers ?? []), documents: batches.flatMap((b) => b.documents ?? []) }
}

/** Rows of text → a table, taking the first non-empty row as the header. */
export function toTable(name: string, grid: unknown[][]): Table {
  const cell = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim())
  const rows = grid.map((r) => r.map(cell)).filter((r) => r.some(Boolean))
  // Exports often start with a title block; the header is the first row that is mostly filled in.
  const width = Math.max(0, ...rows.map((r) => r.length))
  const at = Math.max(0, rows.findIndex((r) => r.filter(Boolean).length >= Math.max(2, Math.ceil(width * 0.5))))
  const seen = new Map<string, number>()
  const headers = (rows[at] ?? []).map((h, i) => {
    const base = h || `Coluna ${i + 1}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n > 1 ? `${base} (${n})` : base
  })
  return { name, headers, rows: rows.slice(at + 1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) }
}
