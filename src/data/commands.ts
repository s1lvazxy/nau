import type {
  Actor,
  ActivityEvent,
  Count,
  Dashboard,
  Item,
  Movement,
  POLine,
  Proposal,
  PurchaseOrder,
  Receipt,
  ReceiptLine,
  Snapshot,
  Supplier,
} from '~/lib/types'
import { generateProposals, itemStats } from '~/lib/analytics'
import { addDays, eur, isoDay, qty as fmtQty } from '~/lib/format'
import { indexBy, round, uid } from '~/lib/utils'
import { mergeChangeSets, type ChangeSet } from './changeset'
import { tr } from '~/i18n'

const nowIso = () => new Date().toISOString()

export function event(kind: string, title: string, actor: Actor, detail?: string | null, link?: string | null): ActivityEvent {
  return { id: uid(), kind, title, detail: detail ?? null, actor, createdAt: nowIso(), link: link ?? null }
}

function nextNumber(list: { number: string }[], prefix: string, start = 100) {
  let max = start
  for (const x of list) {
    const n = Number(x.number.replace(/\D/g, ''))
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}-${max + 1}`
}

export const onHandAt = (s: Snapshot, itemId: string, locationId: string) => s.levels.find((l) => l.itemId === itemId && l.locationId === locationId)?.onHand ?? 0
export const onHandTotal = (s: Snapshot, itemId: string) => s.levels.filter((l) => l.itemId === itemId).reduce((a, l) => a + l.onHand, 0)

/* ───────────────────────────── Receiving ───────────────────────────── */

export function newReceipt(s: Snapshot, init: Partial<Receipt> = {}): Receipt {
  return {
    id: uid(),
    number: nextNumber(s.receipts, 'R', 300),
    supplierId: null,
    locationId: s.locations.find((l) => l.isDefault)?.id ?? s.locations[0]?.id,
    status: 'draft',
    docRef: null,
    docDate: isoDay(new Date()),
    lines: [],
    source: 'manual',
    createdAt: nowIso(),
    ...init,
  }
}

export function saveReceiptDraft(r: Receipt): ChangeSet {
  return { upserts: { receipts: [r] } }
}

export function postReceipt(s: Snapshot, r: Receipt, actor: Actor): ChangeSet {
  const items = indexBy(s.items, (x) => x.id)
  const lines = r.lines.filter((l) => l.itemId && l.qty > 0)
  const movements: Movement[] = lines.map((l) => ({
    id: uid(),
    itemId: l.itemId!,
    locationId: r.locationId,
    type: 'receipt',
    qty: l.qty,
    unitCost: l.unitCost,
    ref: r.docRef || r.number,
    actor,
    createdAt: nowIso(),
    groupId: r.id,
    batchCode: l.lot || null,
    expiresOn: l.expiresOn || null,
  }))
  // Weighted average cost (custo médio ponderado)
  const updated: Item[] = []
  for (const l of lines) {
    const it = items[l.itemId!]
    if (!it) continue
    const have = Math.max(0, onHandTotal(s, it.id))
    const wac = have + l.qty > 0 ? (have * it.cost + l.qty * l.unitCost) / (have + l.qty) : l.unitCost
    const prev = updated.find((u) => u.id === it.id)
    if (prev) prev.cost = round(wac, 4)
    else updated.push({ ...it, cost: round(wac, 4) })
  }
  const posted: Receipt = { ...r, lines: r.lines, status: 'posted', postedAt: nowIso() }
  const cs: ChangeSet = { upserts: { receipts: [posted], items: updated }, movements }
  // Reconcile with purchase order
  if (r.poId) {
    const po = s.orders.find((p) => p.id === r.poId)
    if (po) {
      const lines2: POLine[] = po.lines.map((pl) => {
        const got = lines.filter((l) => l.itemId === pl.itemId).reduce((a, l) => a + l.qty, 0)
        return { ...pl, received: round(pl.received + got, 3) }
      })
      const done = lines2.every((l) => l.received >= l.qty)
      cs.upserts!.orders = [{ ...po, lines: lines2, status: done ? 'received' : 'partial' }]
    }
  }
  const sup = s.suppliers.find((x) => x.id === r.supplierId)
  const loc = s.locations.find((x) => x.id === r.locationId)
  const total = lines.reduce((a, l) => a + l.qty * l.unitCost, 0)
  cs.events = [event('receipt', tr('Received {0}', sup ? tr('delivery from {0}', sup.name) : r.number), actor, tr('{0} lines · {1} · {2}', lines.length, eur(total), loc?.name ?? ''), `/app/receive`)]
  return cs
}

export function receiptFromPO(s: Snapshot, po: PurchaseOrder): Receipt {
  const items = indexBy(s.items, (x) => x.id)
  return newReceipt(s, {
    supplierId: po.supplierId,
    locationId: po.locationId,
    poId: po.id,
    source: 'po',
    docRef: null,
    lines: po.lines
      .filter((l) => l.qty - l.received > 0)
      .map((l) => ({ id: uid(), itemId: l.itemId, description: items[l.itemId]?.name ?? tr('Item'), qty: round(l.qty - l.received, 3), unitCost: l.unitCost, confidence: 1, previousCost: items[l.itemId]?.cost ?? null })),
  })
}

/* ───────────────────────────── Purchase orders ───────────────────────────── */

export function createPO(
  s: Snapshot,
  input: { supplierId: string; locationId?: string; lines: { itemId: string; qty: number; unitCost: number }[]; status?: PurchaseOrder['status']; createdBy?: 'user' | 'agent'; note?: string | null; email?: boolean },
  actor: Actor,
): { cs: ChangeSet; po: PurchaseOrder } {
  const sup = s.suppliers.find((x) => x.id === input.supplierId)
  const status = input.status ?? 'draft'
  const po: PurchaseOrder = {
    id: uid(),
    number: nextNumber(s.orders, 'PO', 120),
    supplierId: input.supplierId,
    locationId: input.locationId ?? s.locations.find((l) => l.isDefault)?.id ?? s.locations[0].id,
    status,
    lines: input.lines.map((l) => ({ ...l, received: 0 })),
    expectedOn: isoDay(addDays(new Date(), sup?.leadTimeDays ?? 5)),
    createdBy: input.createdBy ?? 'user',
    note: input.note ?? null,
    createdAt: nowIso(),
    sentAt: status === 'sent' ? nowIso() : null,
    ...(status === 'sent' && input.email && sup?.email ? queueEmail() : {}),
  }
  const total = po.lines.reduce((a, l) => a + l.qty * l.unitCost, 0)
  return {
    po,
    cs: {
      upserts: { orders: [po] },
      events: [event('order', (status === 'sent' ? tr('Sent {0} to {1}', po.number, sup?.name ?? tr('supplier')) : tr('Drafted {0} to {1}', po.number, sup?.name ?? tr('supplier'))), actor, tr('{0} lines · {1}', po.lines.length, eur(total)), `/app/orders/${po.id}`)],
    },
  }
}

/** Gives new purchase orders in a change set the next free numbers against the latest data (prepared actions are numbered on approval). */
export function renumberOrders(s: Snapshot, cs: ChangeSet): ChangeSet {
  const fresh = (cs.upserts?.orders ?? []).filter((o) => !s.orders.some((x) => x.id === o.id))
  if (!fresh.length) return cs
  const taken = [...s.orders]
  const orders = (cs.upserts?.orders ?? []).map((o) => {
    if (s.orders.some((x) => x.id === o.id)) return o
    const number = nextNumber(taken, 'PO', 120)
    const next = { ...o, number }
    taken.push(next)
    return next
  })
  const byOld = new Map(fresh.map((o) => [o.number, orders.find((x) => x.id === o.id)!.number]))
  const events = cs.events?.map((e) => {
    let title = e.title
    for (const [a, b] of byOld) title = title.replace(a, b)
    return { ...e, title }
  })
  return { ...cs, upserts: { ...cs.upserts, orders }, events }
}

export function updatePO(po: PurchaseOrder): ChangeSet {
  return { upserts: { orders: [po] } }
}

/** Marks an order for the server to email. Each time it is queued it gets a new stamp, so a retry is a new attempt. */
export const queueEmail = (): Pick<PurchaseOrder, 'emailStatus' | 'emailQueuedAt' | 'emailError'> => ({ emailStatus: 'queued', emailQueuedAt: nowIso(), emailError: null })

/** `email: true` queues the order for the server to email (only when the installation has mail configured). */
export function sendPO(s: Snapshot, po: PurchaseOrder, actor: Actor, opts: { email?: boolean } = {}): ChangeSet {
  const sup = s.suppliers.find((x) => x.id === po.supplierId)
  const next: PurchaseOrder = { ...po, status: 'sent', sentAt: nowIso(), expectedOn: po.expectedOn ?? isoDay(addDays(new Date(), sup?.leadTimeDays ?? 5)), ...(opts.email && sup?.email ? queueEmail() : {}) }
  return { upserts: { orders: [next] }, events: [event('order', tr('Sent {0} to {1}', po.number, sup?.name ?? tr('supplier')), actor, sup?.email ? tr('Emailed to {0}', sup.email) : null, `/app/orders/${po.id}`)] }
}

export function cancelPO(po: PurchaseOrder, actor: Actor): ChangeSet {
  return { upserts: { orders: [{ ...po, status: 'cancelled' }] }, events: [event('order', tr('Cancelled {0}', po.number), actor)] }
}

export function poEmail(s: Snapshot, po: PurchaseOrder) {
  const sup = s.suppliers.find((x) => x.id === po.supplierId)
  const loc = s.locations.find((x) => x.id === po.locationId)
  const items = indexBy(s.items, (x) => x.id)
  const lines = po.lines.map((l) => `• ${fmtQty(l.qty, items[l.itemId]?.unit)} × ${items[l.itemId]?.name ?? 'Item'} (${items[l.itemId]?.sku ?? ''})`).join('\n')
  const subject = `Encomenda ${po.number} — ${s.workspace.name}`
  const when = po.expectedOn ? new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(po.expectedOn + 'T12:00:00')) : 'a combinar'
  const body = `Bom dia${sup?.contact ? ` ${sup.contact.split(' ')[0]}` : ''},\n\nSegue a nossa encomenda ${po.number}:\n\n${lines}\n\nEntrega em: ${loc?.name ?? ''}${loc?.address ? `, ${loc.address}` : ''}\nData pretendida: ${when}\nNIF: ${s.workspace.nif ?? '—'}\n\nObrigado,\n${s.workspace.name}`
  return { to: sup?.email ?? '', subject, body, mailto: `mailto:${sup?.email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` }
}

/* ───────────────────────────── Stock moves ───────────────────────────── */

export function adjustStock(s: Snapshot, input: { itemId: string; locationId: string; newQty?: number; delta?: number; reason: string; type?: 'adjustment' | 'waste' }, actor: Actor): ChangeSet {
  const cur = onHandAt(s, input.itemId, input.locationId)
  const delta = round(input.delta ?? (input.newQty ?? cur) - cur, 3)
  if (!delta) return {}
  const it = s.items.find((x) => x.id === input.itemId)
  const loc = s.locations.find((x) => x.id === input.locationId)
  return {
    movements: [{ id: uid(), itemId: input.itemId, locationId: input.locationId, type: input.type ?? 'adjustment', qty: delta, unitCost: it?.cost ?? null, note: input.reason, actor, createdAt: nowIso() }],
    events: [event('adjustment', `${delta > 0 ? tr('Added') : tr('Removed')} ${fmtQty(Math.abs(delta), it?.unit)} ${it?.name ?? ''}`, actor, `${loc?.name ?? ''} · ${input.reason}`, `/app/items/${input.itemId}`)],
  }
}

export function transferStock(s: Snapshot, input: { itemId: string; from: string; to: string; qty: number; note?: string }, actor: Actor): ChangeSet {
  const it = s.items.find((x) => x.id === input.itemId)
  const from = s.locations.find((x) => x.id === input.from)
  const to = s.locations.find((x) => x.id === input.to)
  const g = uid()
  const at = nowIso()
  const ref = `TR ${to?.code ?? ''}`
  return {
    movements: [
      { id: uid(), itemId: input.itemId, locationId: input.from, type: 'transfer', qty: -input.qty, unitCost: it?.cost ?? null, actor, createdAt: at, groupId: g, ref, note: input.note ?? null },
      { id: uid(), itemId: input.itemId, locationId: input.to, type: 'transfer', qty: input.qty, unitCost: it?.cost ?? null, actor, createdAt: at, groupId: g, ref, note: input.note ?? null },
    ],
    events: [event('transfer', tr('Moved {0} {1}', fmtQty(input.qty, it?.unit), it?.name ?? ''), actor, `${from?.name} → ${to?.name}`, `/app/items/${input.itemId}`)],
  }
}

export function revertMovement(s: Snapshot, movementId: string, actor: Actor): ChangeSet {
  const m = s.movements.find((x) => x.id === movementId)
  if (!m) return {}
  const group = m.groupId && m.type === 'transfer' ? s.movements.filter((x) => x.groupId === m.groupId) : [m]
  const g = uid()
  const it = s.items.find((x) => x.id === m.itemId)
  return {
    movements: group.map((x) => ({ ...x, id: uid(), qty: -x.qty, revertsId: x.id, groupId: g, actor, createdAt: nowIso(), note: tr('Reverted {0}', x.type), batchCode: x.qty < 0 ? x.batchCode : null })),
    events: [event('revert', tr('Reverted a {0} of {1}', m.type, it?.name ?? tr('an item')), actor, null, `/app/items/${m.itemId}`)],
  }
}

/* ───────────────────────────── Catalogue ───────────────────────────── */

export function newItem(s: Snapshot, init: Partial<Item> = {}): Item {
  const n = s.items.length + 1
  return {
    id: uid(),
    sku: `SKU-${String(1000 + n)}`,
    name: '',
    barcode: null,
    categoryId: s.categories[0]?.id ?? null,
    unit: 'un',
    cost: 0,
    price: 0,
    vatRate: 23,
    reorderPoint: null,
    reorderQty: null,
    safetyDays: 3,
    supplierId: null,
    tracksExpiry: false,
    archived: false,
    tags: [],
    createdAt: nowIso(),
    hue: s.categories[0]?.hue ?? 24,
    ...init,
  }
}

export function saveItem(s: Snapshot, item: Item, actor: Actor, opening?: { locationId: string; qty: number }): ChangeSet {
  const isNew = !s.items.some((x) => x.id === item.id)
  const cat = s.categories.find((c) => c.id === item.categoryId)
  const cs: ChangeSet = {
    upserts: { items: [{ ...item, hue: cat?.hue ?? item.hue }] },
    events: isNew ? [event('item', tr('Added {0}', item.name), actor, item.sku, `/app/items/${item.id}`)] : undefined,
  }
  if (isNew && opening && opening.qty) {
    cs.movements = [{ id: uid(), itemId: item.id, locationId: opening.locationId, type: 'count', qty: opening.qty, unitCost: item.cost, actor, createdAt: nowIso(), note: tr('Opening stock') }]
  }
  return cs
}

export function archiveItems(s: Snapshot, ids: string[], archived: boolean, actor: Actor): ChangeSet {
  const set = new Set(ids)
  const items = s.items.filter((x) => set.has(x.id)).map((x) => ({ ...x, archived }))
  return { upserts: { items }, events: [event('item', (archived ? items.length > 1 ? tr('Archived {0} items', items.length) : tr('Archived {0} item', items.length) : items.length > 1 ? tr('Restored {0} items', items.length) : tr('Restored {0} item', items.length)), actor)] }
}

export function saveSupplier(sup: Supplier): ChangeSet {
  return { upserts: { suppliers: [sup] } }
}

/* ───────────────────────────── Counts ───────────────────────────── */

export function startCount(s: Snapshot, input: { name: string; locationId: string; itemIds: string[]; blind?: boolean }, actor: Actor): { cs: ChangeSet; count: Count } {
  const count: Count = {
    id: uid(),
    name: input.name,
    locationId: input.locationId,
    status: 'open',
    blind: input.blind ?? true,
    createdAt: nowIso(),
    lines: input.itemIds.map((itemId) => ({ itemId, expected: onHandAt(s, itemId, input.locationId), counted: null })),
  }
  return { count, cs: { upserts: { counts: [count] }, events: [event('count', tr('Started count “{0}”', input.name), actor, tr('{0} items', count.lines.length), `/app/counts/${count.id}`)] } }
}

export function saveCount(count: Count): ChangeSet {
  return { upserts: { counts: [count] } }
}

export function closeCount(s: Snapshot, count: Count, actor: Actor): ChangeSet {
  const items = indexBy(s.items, (x) => x.id)
  const movements: Movement[] = []
  for (const l of count.lines) {
    if (l.counted == null) continue
    // Compare against live stock so sales during the count are respected
    const live = onHandAt(s, l.itemId, count.locationId)
    const delta = round(l.counted - live, 3)
    if (!delta) continue
    movements.push({ id: uid(), itemId: l.itemId, locationId: count.locationId, type: 'count', qty: delta, unitCost: items[l.itemId]?.cost ?? null, actor, createdAt: nowIso(), groupId: count.id, ref: count.name, note: tr('Count variance') })
  }
  const value = movements.reduce((a, m) => a + m.qty * (m.unitCost ?? 0), 0)
  return {
    upserts: { counts: [{ ...count, status: 'closed', closedAt: nowIso() }] },
    movements,
    events: [event('count', tr('Closed count “{0}”', count.name), actor, (movements.length === 1 ? tr('{0} variance · {1}', movements.length, eur(value)) : tr('{0} variances · {1}', movements.length, eur(value))), `/app/counts/${count.id}`)],
  }
}

/* ───────────────────────────── Proposals & autopilot ───────────────────────────── */

export function runAutopilot(s: Snapshot): ChangeSet {
  const recent = new Set(s.proposals.filter((p) => p.status === 'pending' || (p.resolvedAt && Date.now() - new Date(p.resolvedAt).getTime() < 3 * 86400000)).map((p) => p.fingerprint))
  const fresh = generateProposals(s)
    .filter((p) => !recent.has(p.fingerprint))
    .map((p) => ({ ...p, id: uid(), createdAt: nowIso(), status: 'pending' as const }))
  const stillValid = new Set(generateProposals(s).map((p) => p.fingerprint))
  // Pending proposals whose situation resolved on its own are withdrawn
  const stale = s.proposals.filter((p) => p.status === 'pending' && p.source === 'autopilot' && !stillValid.has(p.fingerprint))
  const playbooks = s.playbooks.map((p) => ({ ...p, lastRunAt: nowIso() }))
  return {
    upserts: { proposals: fresh, playbooks },
    removes: stale.length ? { proposals: stale.map((p) => p.id) } : undefined,
  }
}

export function approveProposal(s: Snapshot, p: Proposal, actor: Actor, opts: { send?: boolean; email?: boolean } = {}): { cs: ChangeSet; link?: string; message: string } {
  const resolved: Proposal = { ...p, status: 'approved', resolvedAt: nowIso() }
  const base: ChangeSet = { upserts: { proposals: [resolved] } }
  const pl = p.payload as Record<string, unknown>
  switch (p.kind) {
    case 'reorder': {
      const { cs, po } = createPO(
        s,
        {
          supplierId: pl.supplierId as string,
          locationId: pl.locationId as string,
          lines: pl.lines as { itemId: string; qty: number; unitCost: number }[],
          status: opts.send ? 'sent' : 'draft',
          email: opts.email,
          createdBy: 'agent',
          note: tr('Drafted by Operator from the reorder autopilot.'),
        },
        actor,
      )
      return { cs: mergeChangeSets(base, cs), link: `/app/orders/${po.id}`, message: `${po.number} ${opts.send ? tr('sent') : tr('drafted')}` }
    }
    case 'transfer': {
      const cs = transferStock(s, { itemId: pl.itemId as string, from: pl.from as string, to: pl.to as string, qty: pl.qty as number, note: tr('Suggested by autopilot') }, actor)
      return { cs: mergeChangeSets(base, cs), message: tr('Transfer recorded') }
    }
    case 'price': {
      const it = s.items.find((x) => x.id === pl.itemId)
      if (!it) return { cs: base, message: tr('Done') }
      return {
        cs: mergeChangeSets(base, { upserts: { items: [{ ...it, price: pl.newPrice as number }] }, events: [event('price', tr('Updated price of {0} to {1}', it.name, eur(pl.newPrice as number)), actor)] }),
        message: tr('Price updated'),
      }
    }
    case 'count': {
      const { cs, count } = startCount(s, { name: tr('Spot count — high-value items'), locationId: pl.locationId as string, itemIds: pl.itemIds as string[] }, actor)
      return { cs: mergeChangeSets(base, cs), link: `/app/counts/${count.id}`, message: tr('Count started') }
    }
    case 'deadstock': {
      const ids = new Set(pl.itemIds as string[])
      const items = s.items.filter((x) => ids.has(x.id)).map((x) => ({ ...x, tags: Array.from(new Set([...x.tags, 'clearance'])) }))
      return { cs: mergeChangeSets(base, { upserts: { items }, events: [event('clearance', tr('Marked {0} items for clearance', items.length), actor, tr('{0}% suggested', String(pl.discount)))] }), message: tr('Marked for clearance') }
    }
    case 'markdown': {
      const it = s.items.find((x) => x.id === pl.itemId)
      return {
        cs: mergeChangeSets(base, { events: [event('markdown', tr('Markdown {0}% on {1}', String(pl.discount), it?.name ?? tr('item')), actor, tr('{0} units before expiry', String(pl.qty)))] }),
        message: tr('Markdown noted — print labels from the item page'),
      }
    }
    default:
      return { cs: base, message: tr('Approved') }
  }
}

export function dismissProposal(p: Proposal): ChangeSet {
  return { upserts: { proposals: [{ ...p, status: 'dismissed', resolvedAt: nowIso() }] } }
}

/* ───────────────────────────── Dashboards ───────────────────────────── */

export function saveDashboard(d: Dashboard): ChangeSet {
  return { upserts: { dashboards: [d] } }
}

/* ───────────────────────────── Imports ───────────────────────────── */

export function importSales(s: Snapshot, lines: { code: string; qty: number; date: string }[], locationId: string, actor: Actor) {
  const bySku = new Map(s.items.map((i) => [i.sku.toLowerCase(), i]))
  const byBarcode = new Map(s.items.filter((i) => i.barcode).map((i) => [i.barcode!, i]))
  const movements: Movement[] = []
  const unmatched = new Set<string>()
  for (const l of lines) {
    const it = bySku.get(l.code.toLowerCase()) ?? byBarcode.get(l.code)
    if (!it) {
      unmatched.add(l.code)
      continue
    }
    movements.push({ id: uid(), itemId: it.id, locationId, type: l.qty >= 0 ? 'sale' : 'return', qty: -l.qty, unitCost: it.cost, actor, createdAt: new Date(l.date + 'T19:00:00').toISOString(), ref: 'SAF-T' })
  }
  const cs: ChangeSet = { movements, events: [event('import', tr('Imported {0} sales lines from SAF-T', movements.length), actor, unmatched.size ? tr('{0} product codes not found', unmatched.size) : null)] }
  return { cs, matched: movements.length, unmatched: [...unmatched] }
}

export function itemsFromCSV(s: Snapshot, rows: Record<string, string>[], actor: Actor): { cs: ChangeSet; created: number; updated: number } {
  const bySku = new Map(s.items.map((i) => [i.sku.toLowerCase(), i]))
  const cats = new Map(s.categories.map((c) => [c.name.toLowerCase(), c]))
  const location = s.locations.find((l) => l.isDefault)?.id ?? s.locations[0].id
  const items: Item[] = []
  const movements: Movement[] = []
  let created = 0
  let updated = 0
  const pick = (r: Record<string, string>, ...keys: string[]) => {
    for (const k of keys) {
      const hit = Object.keys(r).find((x) => x.trim().toLowerCase() === k)
      if (hit && r[hit] !== '') return r[hit]
    }
    return undefined
  }
  const n = (v?: string) => (v == null ? undefined : Number(String(v).replace(/\s/g, '').replace(',', '.')))
  for (const r of rows) {
    const name = pick(r, 'name', 'nome', 'description', 'descrição', 'designacao', 'designação')
    if (!name) continue
    const sku = pick(r, 'sku', 'code', 'código', 'codigo', 'ref', 'referência') ?? `SKU-${1000 + s.items.length + items.length + 1}`
    const existing = bySku.get(sku.toLowerCase())
    const catName = pick(r, 'category', 'categoria', 'família', 'familia')
    const cat = catName ? cats.get(catName.toLowerCase()) : undefined
    const base = existing ?? newItem(s, { sku })
    const item: Item = {
      ...base,
      name,
      sku,
      barcode: pick(r, 'barcode', 'ean', 'código de barras') ?? base.barcode,
      cost: n(pick(r, 'cost', 'custo', 'preço de custo')) ?? base.cost,
      price: n(pick(r, 'price', 'preço', 'pvp', 'preco')) ?? base.price,
      vatRate: n(pick(r, 'vat', 'iva', 'taxa iva')) ?? base.vatRate,
      categoryId: cat?.id ?? base.categoryId,
      unit: (pick(r, 'unit', 'unidade') as Item['unit']) ?? base.unit,
    }
    items.push(item)
    if (existing) updated++
    else {
      created++
      const q = n(pick(r, 'stock', 'qty', 'quantidade', 'existências', 'existencias'))
      if (q) movements.push({ id: uid(), itemId: item.id, locationId: location, type: 'count', qty: q, unitCost: item.cost, actor, createdAt: nowIso(), note: tr('Imported opening stock') })
    }
  }
  return { cs: { upserts: { items }, movements, events: [event('import', tr('Imported {0} items from CSV', created + updated), actor, tr('{0} new · {1} updated', created, updated))] }, created, updated }
}

export function stockValueOf(s: Snapshot, itemId: string) {
  const st = itemStats(s, itemId)
  return st ? st.value : 0
}

export function parseCSV(text: string): Record<string, string>[] {
  const firstLine = text.split(/\r?\n/)[0] ?? ''
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : firstLine.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === delim) {
      cur.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ''
    } else field += c
  }
  if (field || cur.length) {
    cur.push(field)
    rows.push(cur)
  }
  const [header, ...body] = rows.filter((r) => r.some((x) => x.trim()))
  if (!header) return []
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

export type { ReceiptLine }
