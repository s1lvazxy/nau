import type { Actor, Category, Item, Location, Movement, Receipt, Snapshot, Supplier, Unit } from '~/lib/types'
import { VAT_RATES } from '~/lib/pt'
import { hashString, normalize, round, stableId } from '~/lib/utils'
import type { ChangeSet } from '~/data/changeset'
import { event, newItem } from '~/data/commands'
import { emptyReport, type ExtDocument, type ExtLine, type ExtParty, type ExtProduct, type IngestBatch, type IngestReport, type Link } from './types'

export interface IngestOptions {
  /** Connector id, 'import' or 'api' — also the namespace for deterministic ids */
  source: string
  /** Shown in the activity feed, e.g. “Moloni” */
  label: string
  actor: Actor
  links?: Link[]
  /** Create items, suppliers and categories that Nau has never seen. Reversible, so on by default. */
  createMissing?: boolean
  /** Let the source overwrite name, price, cost and barcode of items it already matched */
  updateExisting?: boolean
  /** Treat product stock as the truth and write the difference as an opening count */
  setStock?: boolean
  /** Post purchase documents straight into stock; otherwise they wait as drafts in Receive */
  postPurchases?: boolean
  now?: Date
}

export interface IngestResult {
  cs: ChangeSet
  links: Link[]
  report: IngestReport
}

const UNITS: Record<string, Unit> = { un: 'un', uni: 'un', unid: 'un', unidade: 'un', unit: 'un', pc: 'un', pcs: 'un', each: 'un', kg: 'kg', kilo: 'kg', quilo: 'kg', kgs: 'kg', l: 'L', lt: 'L', litro: 'L', liter: 'L', litre: 'L', cx: 'cx', caixa: 'cx', box: 'cx', case: 'cx', m: 'm', metro: 'm', meter: 'm', mt: 'm' }
export const toUnit = (u?: string | null): Unit => UNITS[normalize(u ?? '').replace(/[^a-z]/g, '')] ?? 'un'

const iso = (d: string, fallback: Date) => {
  if (!d) return fallback.toISOString()
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00` : d)
  return Number.isNaN(t.getTime()) ? fallback.toISOString() : t.toISOString()
}
const clean = (s?: string | null) => (s ?? '').trim()
const nameKey = (s: string) => normalize(s).replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Translates an outside batch into one change set against `s`.
 * Pure and repeatable: ids derive from the source's own references, and documents already linked are skipped.
 */
export function ingest(s: Snapshot, batch: IngestBatch, o: IngestOptions): IngestResult {
  const now = o.now ?? new Date()
  const create = o.createMissing ?? true
  const report = emptyReport()
  const links: Link[] = []
  const known = new Map((o.links ?? []).map((l) => [`${l.kind}:${l.externalRef}`, l.internalId]))
  const link = (kind: Link['kind'], ref: string | null | undefined, id: string) => {
    if (!ref || known.get(`${kind}:${ref}`) === id) return
    known.set(`${kind}:${ref}`, id)
    links.push({ kind, externalRef: ref, internalId: id })
  }

  const region = s.workspace.region ?? 'continente'
  const defaultLoc = s.locations.find((l) => l.isDefault) ?? s.locations[0]
  if (!defaultLoc) return { cs: {}, links, report }

  /* ── Catalogue indexes (kept current as rows are created) ── */
  const items = new Map(s.items.map((i) => [i.id, i]))
  const bySku = new Map(s.items.map((i) => [i.sku.toLowerCase(), i.id]))
  const byBarcode = new Map(s.items.filter((i) => i.barcode).map((i) => [i.barcode!, i.id]))
  const byName = new Map<string, string | null>()
  for (const i of s.items) {
    const k = nameKey(i.name)
    byName.set(k, byName.has(k) ? null : i.id) // ambiguous names never match
  }
  const cats = new Map(s.categories.map((c) => [nameKey(c.name), c]))
  const sups = [...s.suppliers]
  const touchedItems = new Map<string, Item>()
  const newCats: Category[] = []
  const newSups: Supplier[] = []
  let skuSeq = s.items.length

  const locationOf = (ref?: string | null): Location => {
    if (!ref) return defaultLoc
    const id = known.get(`location:${ref}`)
    const n = normalize(ref)
    return s.locations.find((l) => l.id === id || l.id === ref || normalize(l.code) === n || normalize(l.name) === n) ?? defaultLoc
  }

  const categoryOf = (name?: string | null): Category | undefined => {
    const k = nameKey(clean(name))
    if (!k) return undefined
    const hit = cats.get(k)
    if (hit || !create) return hit
    const c: Category = { id: stableId(s.workspace.id, 'cat', k), name: clean(name), hue: hashString(k) % 360, atCategory: 'M' }
    cats.set(k, c)
    newCats.push(c)
    report.categories.created++
    return c
  }

  const supplierOf = (p?: ExtParty | string | null): Supplier | undefined => {
    const party: ExtParty | null = typeof p === 'string' ? { name: p } : (p ?? null)
    if (!party || !clean(party.name)) return undefined
    const linked = party.ref ? known.get(`supplier:${party.ref}`) : undefined
    const nif = clean(party.nif).replace(/\D/g, '')
    const k = nameKey(party.name)
    const hit = sups.find((x) => x.id === linked) ?? (nif ? sups.find((x) => (x.nif ?? '').replace(/\D/g, '') === nif) : undefined) ?? sups.find((x) => nameKey(x.name) === k)
    if (hit) {
      report.suppliers.matched++
      link('supplier', party.ref, hit.id)
      return hit
    }
    if (!create) return undefined
    const sup: Supplier = { id: stableId(s.workspace.id, 'sup', nif || k), name: clean(party.name), nif: nif || null, email: clean(party.email) || null, phone: clean(party.phone) || null, contact: null, leadTimeDays: 5, minOrderValue: 0, paymentTerms: null, notes: null, orderDays: null }
    sups.push(sup)
    newSups.push(sup)
    report.suppliers.created++
    link('supplier', party.ref, sup.id)
    return sup
  }

  const register = (it: Item) => {
    items.set(it.id, it)
    touchedItems.set(it.id, it)
    bySku.set(it.sku.toLowerCase(), it.id)
    if (it.barcode) byBarcode.set(it.barcode, it.id)
    const k = nameKey(it.name)
    if (!byName.has(k)) byName.set(k, it.id)
  }

  const find = (x: { ref?: string | null; sku?: string | null; barcode?: string | null; name: string }): Item | undefined => {
    const id = (x.ref ? known.get(`item:${x.ref}`) : undefined) ?? (clean(x.sku) ? bySku.get(clean(x.sku).toLowerCase()) : undefined) ?? (clean(x.barcode) ? byBarcode.get(clean(x.barcode)) : undefined) ?? byName.get(nameKey(x.name)) ?? undefined
    return id ? items.get(id) : undefined
  }

  const freeSku = (wanted?: string | null) => {
    const w = clean(wanted)
    if (w && !bySku.has(w.toLowerCase())) return w
    let sku: string
    do sku = `SKU-${1000 + ++skuSeq}`
    while (bySku.has(sku.toLowerCase()))
    return sku
  }

  const makeItem = (p: { ref?: string | null; sku?: string | null; name: string; barcode?: string | null; category?: string | null; unit?: string | null; cost?: number | null; price?: number | null; vatRate?: number | null; supplier?: string | null; tracksExpiry?: boolean }): Item => {
    const cat = categoryOf(p.category)
    const sup = supplierOf(p.supplier)
    const it = newItem(s, {
      id: stableId(s.workspace.id, o.source, 'item', p.ref || clean(p.sku) || clean(p.barcode) || nameKey(p.name)),
      sku: freeSku(p.sku),
      name: clean(p.name),
      barcode: clean(p.barcode) || null,
      categoryId: cat?.id ?? null,
      unit: toUnit(p.unit),
      cost: round(Math.max(0, p.cost ?? 0), 4),
      price: round(Math.max(0, p.price ?? 0), 4),
      vatRate: p.vatRate ?? VAT_RATES[region].normal,
      supplierId: sup?.id ?? null,
      tracksExpiry: !!p.tracksExpiry,
      hue: cat?.hue ?? hashString(nameKey(p.name)) % 360,
      createdAt: now.toISOString(),
    })
    register(it)
    report.products.created++
    return it
  }

  /* ── Suppliers and products ── */
  for (const p of batch.suppliers ?? []) supplierOf(p)

  const stock: { item: Item; location: Location; qty: number; lot?: string | null; expiresOn?: string | null }[] = []
  for (const p of batch.products ?? []) {
    if (!clean(p.name)) continue
    let it = find(p)
    if (it) {
      report.products.matched++
      if (o.updateExisting) {
        const cat = categoryOf(p.category)
        const sup = supplierOf(p.supplier)
        const next: Item = {
          ...it,
          name: clean(p.name) || it.name,
          barcode: clean(p.barcode) || it.barcode,
          cost: p.cost != null && p.cost > 0 ? round(p.cost, 4) : it.cost,
          price: p.price != null && p.price > 0 ? round(p.price, 4) : it.price,
          vatRate: p.vatRate ?? it.vatRate,
          categoryId: cat?.id ?? it.categoryId,
          supplierId: sup?.id ?? it.supplierId,
          unit: p.unit ? toUnit(p.unit) : it.unit,
          tracksExpiry: it.tracksExpiry || !!p.tracksExpiry,
        }
        if (JSON.stringify(next) !== JSON.stringify(it)) {
          register(next)
          it = next
          report.products.updated++
        }
      }
    } else if (create) it = makeItem(p)
    else continue
    link('item', p.ref, it.id)
    if (p.stock?.some((x) => x.lot) && !it.tracksExpiry) {
      it = { ...it, tracksExpiry: true }
      register(it)
    }
    if (o.setStock) for (const st of p.stock ?? []) stock.push({ item: it, location: locationOf(st.location), qty: st.qty, lot: st.lot, expiresOn: st.expiresOn })
  }

  /* ── Documents, oldest first ── */
  const movements: Movement[] = []
  const receipts: Receipt[] = []
  // Running stock per item (all locations) and per item and location, as the documents replay
  const total = new Map<string, number>()
  const level = new Map<string, number>()
  for (const l of s.levels) {
    total.set(l.itemId, (total.get(l.itemId) ?? 0) + l.onHand)
    level.set(`${l.itemId}:${l.locationId}`, l.onHand)
  }
  const before = new Map(level)
  const move = (m: Movement) => {
    movements.push(m)
    total.set(m.itemId, (total.get(m.itemId) ?? 0) + m.qty)
    const k = `${m.itemId}:${m.locationId}`
    level.set(k, round((level.get(k) ?? 0) + m.qty, 3))
  }
  // A cost stated by the catalogue in this same batch is the cost as of today; history does not move it
  const pinned = new Set((batch.products ?? []).filter((p) => (p.cost ?? 0) > 0).map((p) => find(p)?.id).filter(Boolean) as string[])

  const lineItem = (l: ExtLine, doc: ExtDocument): Item | undefined => {
    const hit = find({ ref: l.productRef, sku: l.sku, barcode: l.barcode, name: l.name })
    if (hit) return hit
    if (!create || !clean(l.name)) {
      report.lines.unmatched++
      if (report.unmatched.length < 200) report.unmatched.push({ name: l.name, sku: l.sku, barcode: l.barcode, qty: l.qty, doc: doc.number })
      return undefined
    }
    const it = makeItem({ ref: l.productRef, sku: l.sku, name: l.name, barcode: l.barcode, cost: l.unitCost, price: l.unitPrice, vatRate: l.vatRate, supplier: doc.kind === 'purchase' ? doc.party?.name : null, tracksExpiry: !!l.lot })
    link('item', l.productRef, it.id)
    return it
  }

  let receiptNo = Math.max(300, ...s.receipts.map((r) => Number(r.number.replace(/\D/g, '')) || 0))
  const docs = [...(batch.documents ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  for (const doc of docs) {
    if (known.has(`doc:${doc.ref}`)) {
      report.documents.skipped++
      continue
    }
    const at = iso(doc.date, now)
    const loc = locationOf(doc.location)
    const group = stableId(s.workspace.id, o.source, doc.ref)
    if (doc.kind === 'purchase') {
      const lines = doc.lines.filter((l) => l.qty > 0).map((line) => ({ item: lineItem(line, doc), line })).filter((x): x is { item: Item; line: ExtLine } => !!x.item)
      report.documents.purchases++
      if (lines.length) {
        const sup = supplierOf(doc.party)
        const id = stableId(s.workspace.id, o.source, 'receipt', doc.ref)
        receipts.push({
          id,
          number: `R-${++receiptNo}`,
          supplierId: sup?.id ?? null,
          locationId: loc.id,
          status: o.postPurchases ? 'posted' : 'draft',
          docRef: doc.number,
          docDate: at.slice(0, 10),
          lines: lines.map(({ item, line }, i) => ({ id: stableId(id, 'l', i), itemId: item.id, description: line.name, qty: line.qty, unitCost: round(line.unitCost ?? item.cost, 4), lot: line.lot ?? null, expiresOn: line.expiresOn ?? null, confidence: 1, previousCost: item.cost || null })),
          source: 'import',
          createdAt: at,
          postedAt: o.postPurchases ? at : null,
          note: `From ${o.label}`,
        })
        if (o.postPurchases)
          lines.forEach(({ item, line }, i) => {
            const cur = items.get(item.id)!
            const cost = round(line.unitCost ?? cur.cost, 4)
            // Weighted average cost against what was on the shelf when the delivery arrived
            if (!pinned.has(cur.id) && cost > 0) {
              const have = Math.max(0, total.get(cur.id) ?? 0)
              const wac = round((have * cur.cost + line.qty * cost) / (have + line.qty), 4)
              if (wac !== cur.cost || (line.lot && !cur.tracksExpiry)) register({ ...cur, cost: wac, tracksExpiry: cur.tracksExpiry || !!line.lot })
            } else if (line.lot && !cur.tracksExpiry) register({ ...cur, tracksExpiry: true })
            move({ id: stableId(id, 'm', i), itemId: cur.id, locationId: loc.id, type: 'receipt', qty: line.qty, unitCost: cost, ref: doc.number, actor: o.actor, createdAt: at, groupId: id, batchCode: line.lot || null, expiresOn: line.expiresOn || null })
            report.lines.applied++
          })
      }
    } else {
      const sign = doc.kind === 'sale' ? -1 : 1
      doc.lines.forEach((line, i) => {
        if (!line.qty) return
        const it = lineItem(line, doc)
        if (!it) return
        // A negative line on a sale is a return, and the other way round
        const q = round(sign * line.qty, 3)
        move({ id: stableId(s.workspace.id, o.source, doc.ref, i), itemId: it.id, locationId: loc.id, type: q < 0 ? 'sale' : 'return', qty: q, unitCost: items.get(it.id)!.cost, ref: doc.number, actor: o.actor, createdAt: at, groupId: group, note: null })
        report.lines.applied++
      })
      report.documents[doc.kind === 'sale' ? 'sales' : 'refunds']++
    }
    link('doc', doc.ref, group)
  }

  /* ── Stock figures are the level as of now, after every document above ── */
  if (stock.length) {
    const byKey = new Map<string, typeof stock>()
    for (const st of stock) {
      const k = `${st.item.id}:${st.location.id}`
      byKey.set(k, [...(byKey.get(k) ?? []), st])
    }
    for (const [k, entries] of byKey) {
      const { item, location } = entries[0]
      const cost = items.get(item.id)!.cost
      const base = { itemId: item.id, locationId: location.id, type: 'count' as const, unitCost: cost, actor: o.actor, createdAt: now.toISOString(), note: `Stock from ${o.label}` }
      const lots = entries.filter((e) => e.lot)
      const plain = round(entries.filter((e) => !e.lot).reduce((a, e) => a + e.qty, 0), 3)
      // Bring the level to the plain figure first, then add each lot on top
      const delta = round(plain - (level.get(k) ?? 0), 3)
      if (delta) move({ ...base, id: stableId(s.workspace.id, o.source, 'stock', k, now.toISOString().slice(0, 10)), qty: delta })
      lots.forEach((e, i) => e.qty > 0 && move({ ...base, id: stableId(s.workspace.id, o.source, 'lot', k, e.lot!, i, now.toISOString().slice(0, 10)), qty: e.qty, batchCode: e.lot, expiresOn: e.expiresOn || null }))
      report.stockSet++
    }
  }

  for (const [k, v] of level) if (v < 0 && v < (before.get(k) ?? 0)) report.negative += Math.min(0, before.get(k) ?? 0) - v

  let cs: ChangeSet = {}
  const upserts: Record<string, unknown[]> = {}
  if (newCats.length) upserts.categories = newCats
  if (newSups.length) upserts.suppliers = newSups
  if (touchedItems.size) upserts.items = [...touchedItems.values()]
  if (receipts.length) upserts.receipts = receipts
  if (Object.keys(upserts).length) cs.upserts = upserts as ChangeSet['upserts']
  if (movements.length) cs.movements = movements

  const r = report
  const parts = [r.products.created && `${r.products.created} new items`, r.products.updated && `${r.products.updated} updated`, r.documents.sales && `${r.documents.sales} sales`, r.documents.refunds && `${r.documents.refunds} returns`, r.documents.purchases && `${r.documents.purchases} deliveries`, r.stockSet && `${r.stockSet} stock levels`, r.lines.unmatched && `${r.lines.unmatched} lines to match`].filter(Boolean)
  if (parts.length) cs.events = [event(o.source === 'import' ? 'import' : 'sync', `${o.label}: ${parts.join(' · ')}`, o.actor, r.negative ? `${round(r.negative, 1)} units sold without stock behind them — a count is due` : null, o.source === 'import' ? '/app/items' : '/app/integrations')]
  return { cs, links, report }
}
