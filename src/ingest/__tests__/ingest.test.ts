import { describe, expect, it } from 'vitest'
import { createDemoSnapshot, createEmptySnapshot } from '~/lib/seed'
import { applyChangeSet } from '~/data/changeset'
import { onHandAt, onHandTotal } from '~/data/commands'
import { ingest } from '../ingest'
import { guessMapping, parseDate, parseNumber, tableToBatch, toTable } from '../tabular'
import { saftToBatch } from '../saft'
import type { IngestBatch } from '../types'

const actor = { kind: 'agent' as const, name: 'Operator' }
const empty = () => createEmptySnapshot({ workspaceName: 'Teste', ownerName: 'Ana', ownerEmail: 'ana@example.pt', sector: 'grocery' })

describe('ingest — one door for every source', () => {
  it('creates the catalogue, sets opening stock and applies sales and deliveries', () => {
    const s = empty()
    const batch: IngestBatch = {
      products: [
        { ref: 'p1', sku: 'AZ-500', name: 'Azeite Virgem 500ml', category: 'Mercearia', cost: 4, price: 7.9, vatRate: 6, supplier: 'Lagar do Vale', stock: [{ qty: 20 }] },
        { ref: 'p2', sku: 'QJ-01', name: 'Queijo da Serra', cost: 9, price: 16, stock: [{ qty: 6, lot: 'L1', expiresOn: '2027-01-10' }] },
      ],
      documents: [
        { ref: 'FT 1', kind: 'sale', number: 'FT 2026/1', date: '2026-11-02', lines: [{ productRef: 'p1', name: 'Azeite', qty: 3 }, { sku: 'qj-01', name: 'Queijo', qty: 1 }] },
        { ref: 'NC 1', kind: 'refund', number: 'NC 2026/1', date: '2026-11-03', lines: [{ productRef: 'p1', name: 'Azeite', qty: 1 }] },
        { ref: 'FC 9', kind: 'purchase', number: 'FC 9', date: '2026-11-04', party: { name: 'Lagar do Vale', nif: '509123456' }, lines: [{ productRef: 'p1', name: 'Azeite', qty: 10, unitCost: 5 }] },
      ],
    }
    const r = ingest(s, batch, { source: 'test', label: 'Teste', actor, setStock: true, postPurchases: true })
    const after = applyChangeSet(s, r.cs)
    const az = after.items.find((i) => i.sku === 'AZ-500')!
    const qj = after.items.find((i) => i.sku === 'QJ-01')!
    expect(r.report.products.created).toBe(2)
    expect(after.suppliers.filter((x) => x.name === 'Lagar do Vale')).toHaveLength(1) // product and invoice name the same supplier
    expect(after.categories.some((c) => c.name === 'Mercearia')).toBe(true)
    // The file's stock is today's stock: the history replays underneath it and the level lands on the figure
    expect(onHandTotal(after, az.id)).toBe(20)
    expect(az.cost).toBe(4) // a cost stated by the catalogue is not moved by older deliveries
    expect(qj.tracksExpiry).toBe(true)
    expect(after.batches.find((b) => b.itemId === qj.id)).toMatchObject({ qty: 6, code: 'L1', expiresOn: '2027-01-10' })
    expect(onHandTotal(after, qj.id)).toBe(6)
    expect(after.movements.filter((m) => m.type === 'sale')).toHaveLength(2) // the demand history is kept
    expect(r.report.documents).toMatchObject({ sales: 1, refunds: 1, purchases: 1 })
  })

  it('moves stock and the weighted average cost in the order things happened when syncing', () => {
    let s = empty()
    s = applyChangeSet(s, ingest(s, { products: [{ ref: 'p1', sku: 'AZ', name: 'Azeite', cost: 4, stock: [{ qty: 20 }] }] }, { source: 'pos', label: 'POS', actor, setStock: true }).cs)
    const r = ingest(s, { documents: [
      { ref: 'c', kind: 'purchase', number: 'FC 1', date: '2026-11-04', party: { name: 'Lagar' }, lines: [{ sku: 'AZ', name: 'Azeite', qty: 10, unitCost: 5, lot: 'L9', expiresOn: '2027-06-01' }] },
      { ref: 'a', kind: 'sale', number: 'FS 1', date: '2026-11-02', lines: [{ sku: 'AZ', name: 'Azeite', qty: 3 }] },
      { ref: 'b', kind: 'refund', number: 'NC 1', date: '2026-11-03', lines: [{ sku: 'AZ', name: 'Azeite', qty: 1 }] },
    ] }, { source: 'pos', label: 'POS', actor, postPurchases: true })
    const after = applyChangeSet(s, r.cs)
    const az = after.items[0]
    expect(onHandTotal(after, az.id)).toBe(20 - 3 + 1 + 10)
    expect(az.cost).toBeCloseTo((18 * 4 + 10 * 5) / 28, 3)
    expect(after.receipts[0]).toMatchObject({ status: 'posted', docRef: 'FC 1' })
    expect(after.batches[0]).toMatchObject({ code: 'L9', qty: 10 })
    // held back instead: the delivery waits in Receive and stock does not move
    const draft = applyChangeSet(s, ingest(s, { documents: [{ ref: 'c', kind: 'purchase', number: 'FC 1', date: '2026-11-04', lines: [{ sku: 'AZ', name: 'Azeite', qty: 10, unitCost: 5 }] }] }, { source: 'pos', label: 'POS', actor }).cs)
    expect(draft.receipts[0].status).toBe('draft')
    expect(onHandTotal(draft, az.id)).toBe(20)
  })

  it('is idempotent: the same batch twice changes nothing the second time', () => {
    const s = empty()
    const batch: IngestBatch = { products: [{ ref: 'p1', sku: 'A', name: 'Arroz', stock: [{ qty: 10 }] }], documents: [{ ref: 'd1', kind: 'sale', number: 'FS 1', date: '2026-11-02', lines: [{ productRef: 'p1', name: 'Arroz', qty: 4 }] }] }
    const first = ingest(s, batch, { source: 'pos', label: 'POS', actor, setStock: true })
    const once = applyChangeSet(s, first.cs)
    // With the links the first run produced, the document is skipped outright…
    const second = ingest(once, batch, { source: 'pos', label: 'POS', actor, links: first.links })
    expect(second.report.documents.skipped).toBe(1)
    expect(second.cs.movements ?? []).toHaveLength(0)
    // …and even without them, the ledger refuses a movement it already holds.
    const blind = ingest(once, batch, { source: 'pos', label: 'POS', actor })
    const twice = applyChangeSet(once, blind.cs)
    expect(onHandTotal(once, once.items[0].id)).toBe(10)
    expect(onHandTotal(twice, once.items[0].id)).toBe(10)
    expect(twice.movements).toHaveLength(once.movements.length)
    expect(twice.items).toHaveLength(1)
  })

  it('matches by link, SKU, barcode, then exact name — and reports what it may not create', () => {
    const s = createDemoSnapshot()
    const it0 = s.items[0]
    const withBarcode = s.items.find((i) => i.barcode)!
    const r = ingest(s, { documents: [{ ref: 'x', kind: 'sale', number: 'X', date: '2026-11-02', lines: [{ sku: it0.sku.toLowerCase(), name: '?', qty: 1 }, { barcode: withBarcode.barcode, name: '?', qty: 1 }, { name: s.items[5].name.toUpperCase(), qty: 1 }, { name: 'Produto que não existe', qty: 2 }] }] }, { source: 'pos', label: 'POS', actor, createMissing: false })
    expect(r.cs.movements).toHaveLength(3)
    expect(r.report.unmatched).toEqual([{ name: 'Produto que não existe', sku: undefined, barcode: undefined, qty: 2, doc: 'X' }])
    expect(r.cs.upserts?.items).toBeUndefined()
  })

  it('counts units sold with no stock behind them', () => {
    const s = empty()
    const r = ingest(s, { documents: [{ ref: 'd', kind: 'sale', number: 'FS 2', date: '2026-11-02', lines: [{ name: 'Café', qty: 5 }] }] }, { source: 'pos', label: 'POS', actor })
    expect(r.report.negative).toBe(5)
    expect(onHandAt(applyChangeSet(s, r.cs), r.cs.upserts!.items![0].id, s.locations[0].id)).toBe(-5)
  })
})

describe('spreadsheets', () => {
  it('reads Portuguese and English numbers and dates', () => {
    expect(parseNumber('1.234,56')).toBe(1234.56)
    expect(parseNumber('1,234.56')).toBe(1234.56)
    expect(parseNumber('€ 9,90')).toBe(9.9)
    expect(parseNumber('23 %')).toBe(23)
    expect(parseNumber('1.250')).toBe(1.25)
    expect(parseNumber('')).toBeNull()
    expect(parseDate('31/12/2026')).toBe('2026-12-31')
    expect(parseDate('5-3-26')).toBe('2026-03-05')
    expect(parseDate('2026-11-09T10:00:00Z')).toBe('2026-11-09')
  })

  it('finds the header under a title block and maps the columns without a model', () => {
    const t = toTable('Artigos', [['Listagem de artigos — Mercearia Central'], [], ['Cód. Artigo', 'Designação', 'Família', 'PVP c/ IVA', 'Preço de Custo', 'Taxa IVA', 'Existências', 'Armazém'], ['A1', 'Arroz Carolino 1kg', 'Mercearia', '1,89', '1,10', '6%', '48', 'Loja'], ['A2', 'Atum em lata', 'Conservas', '2,35', '1,40', '13', '120', 'Loja'], ['A2', 'Atum em lata', 'Conservas', '2,35', '1,40', '13', '300', 'Armazém']])
    const m = guessMapping(t)
    expect(m.kind).toBe('items')
    expect(m.columns).toMatchObject({ 'Cód. Artigo': 'sku', 'Designação': 'name', 'Família': 'category', 'PVP c/ IVA': 'price', 'Preço de Custo': 'cost', 'Taxa IVA': 'vat', 'Existências': 'stock', 'Armazém': 'location' })
    const { batch } = tableToBatch(t, m)
    expect(batch.products).toHaveLength(2)
    expect(batch.products![1].stock).toEqual([{ location: 'Loja', qty: 120, lot: null, expiresOn: null }, { location: 'Armazém', qty: 300, lot: null, expiresOn: null }])
    expect(batch.products![0]).toMatchObject({ sku: 'A1', price: 1.89, cost: 1.1, vatRate: 6 })
  })

  it('recognises a sales history and groups lines into documents', () => {
    const t = toTable('Vendas', [['Data', 'Documento', 'Referência', 'Descrição', 'Qtd', 'Preço'], ['02/11/2026', 'FS 1/10', 'A1', 'Arroz', '2', '1,89'], ['02/11/2026', 'FS 1/10', 'A2', 'Atum', '1', '2,35'], ['03/11/2026', 'FS 1/11', 'A1', 'Arroz', '5', '1,89']])
    const m = guessMapping(t)
    expect(m.kind).toBe('sales')
    const { batch } = tableToBatch(t, m)
    expect(batch.documents).toHaveLength(2)
    expect(batch.documents![0].lines).toHaveLength(2)
  })
})

describe('SAF-T (PT)', () => {
  const xml = `<?xml version="1.0"?><AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01"><Header><CompanyName>Mercearia &amp; Filhos</CompanyName><TaxRegistrationNumber>509123456</TaxRegistrationNumber><StartDate>2026-10-01</StartDate><EndDate>2026-10-31</EndDate></Header>
  <MasterFiles><Product><ProductType>P</ProductType><ProductCode>A1</ProductCode><ProductGroup>Mercearia</ProductGroup><ProductDescription>Arroz Carolino 1kg</ProductDescription><ProductNumberCode>5601234567890</ProductNumberCode></Product>
  <Product><ProductType>S</ProductType><ProductCode>ENT</ProductCode><ProductDescription>Entrega</ProductDescription><ProductNumberCode>ENT</ProductNumberCode></Product></MasterFiles>
  <SourceDocuments><SalesInvoices><Invoice><InvoiceNo>FS 1/1</InvoiceNo><DocumentStatus><InvoiceStatus>N</InvoiceStatus></DocumentStatus><InvoiceDate>2026-10-03</InvoiceDate><InvoiceType>FS</InvoiceType>
  <Line><LineNumber>1</LineNumber><ProductCode>A1</ProductCode><ProductDescription>Arroz Carolino 1kg</ProductDescription><Quantity>3</Quantity><UnitPrice>1.7830</UnitPrice><Tax><TaxPercentage>6.00</TaxPercentage></Tax></Line>
  <Line><LineNumber>2</LineNumber><ProductCode>ENT</ProductCode><ProductDescription>Entrega</ProductDescription><Quantity>1</Quantity><UnitPrice>2.00</UnitPrice><Tax><TaxPercentage>23</TaxPercentage></Tax></Line></Invoice>
  <Invoice><InvoiceNo>FS 1/2</InvoiceNo><DocumentStatus><InvoiceStatus>A</InvoiceStatus></DocumentStatus><InvoiceDate>2026-10-04</InvoiceDate><InvoiceType>FS</InvoiceType><Line><ProductCode>A1</ProductCode><Quantity>9</Quantity><UnitPrice>1</UnitPrice></Line></Invoice>
  <Invoice><InvoiceNo>NC 1/1</InvoiceNo><DocumentStatus><InvoiceStatus>N</InvoiceStatus></DocumentStatus><InvoiceDate>2026-10-05</InvoiceDate><InvoiceType>NC</InvoiceType><Line><ProductCode>A1</ProductCode><ProductDescription>Arroz</ProductDescription><Quantity>1</Quantity><UnitPrice>1.7830</UnitPrice><Tax><TaxPercentage>6</TaxPercentage></Tax></Line></Invoice>
  </SalesInvoices></SourceDocuments></AuditFile>`

  it('yields products with shelf prices, and sales without services or annulled invoices', () => {
    const r = saftToBatch(xml)
    expect(r.company).toBe('Mercearia & Filhos')
    expect(r.batch.products).toEqual([{ ref: 'A1', sku: 'A1', name: 'Arroz Carolino 1kg', category: 'Mercearia', barcode: '5601234567890', price: 1.89, vatRate: 6 }])
    expect(r.batch.documents!.map((d) => [d.kind, d.lines.length])).toEqual([['sale', 1], ['refund', 1]])
    const s = empty()
    const out = ingest(s, r.batch, { source: 'import', label: 'SAF-T', actor })
    expect(onHandTotal(applyChangeSet(s, out.cs), out.cs.upserts!.items![0].id)).toBe(-2)
  })

  it('refuses a file that is not SAF-T', () => {
    expect(() => saftToBatch('<html></html>')).toThrow()
  })
})
