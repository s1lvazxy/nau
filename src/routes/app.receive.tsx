import { useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { BarcodeIcon, CameraIcon, CheckIcon, FileTextIcon, PlusIcon, SparkleIcon, TrashIcon, TrayArrowDownIcon, TruckIcon, WarningIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { newReceipt, postReceipt, receiptFromPO, saveReceiptDraft } from '~/data/commands'
import { incomingOrders, poTotal } from '~/lib/analytics'
import { date, eur, isoDay, qty as fmtQty, relative } from '~/lib/format'
import { cn, fuzzyScore, indexBy, round, sleep, uid } from '~/lib/utils'
import type { Receipt, ReceiptLine } from '~/lib/types'
import { Button } from '~/components/ui/button'
import { Field, Input, NumberInput, Select } from '~/components/ui/form'
import { Badge, Empty, PageHeader } from '~/components/ui/primitives'
import { Sheet } from '~/components/ui/overlay'
import { Scanner } from '~/components/app/scanner'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { Mark } from '~/components/brand/logo'
import { accessToken } from '~/agent/operator'
import { useSession } from '~/data/store'

export const Route = createFileRoute('/app/receive')({
  validateSearch: (s: Record<string, unknown>): { new?: number; po?: string; id?: string } => ({ ...(s.new ? { new: 1 } : {}), ...(typeof s.po === 'string' ? { po: s.po } : {}), ...(typeof s.id === 'string' ? { id: s.id } : {}) }),
  component: Receive,
})

function Receive() {
  usePageTitle('Receive')
  const s = useSnapshot()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/app/receive' })
  const { canWrite } = useActions()
  const sup = indexBy(s.suppliers, (x) => x.id)
  const loc = indexBy(s.locations, (x) => x.id)
  const incoming = incomingOrders(s)
  const editing = search.new || search.po || search.id
  const draft = useMemo(() => {
    if (search.id) return s.receipts.find((r) => r.id === search.id)
    if (search.po) {
      const po = s.orders.find((p) => p.id === search.po)
      return po ? receiptFromPO(s, po) : undefined
    }
    return search.new ? newReceipt(s) : undefined
  }, [search.id, search.po, search.new])
  const close = () => void navigate({ search: {} })
  return (
    <div>
      <PageHeader
        title="Receive"
        description="Deliveries in. Read the invoice, check what changed, post it to stock."
        actions={
          canWrite && (
            <Button variant="primary" icon={<TrayArrowDownIcon size={14} />} onClick={() => void navigate({ search: { new: 1 } })}>
              Receive a delivery
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-8 px-5 py-6 md:px-8">
        {incoming.length > 0 && (
          <section>
            <h2 className="mb-3 text-[13px] font-medium text-ink-2">Expected</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {incoming.map((po) => {
                const today = po.expectedOn === isoDay(new Date())
                return (
                  <div key={po.id} className="flex flex-col gap-3 rounded-[14px] bg-surface p-4 shadow-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-medium text-ink">{sup[po.supplierId]?.name}</div>
                        <div className="text-[12px] text-ink-3">
                          {po.number} · {po.lines.length} lines · {eur(poTotal(po), { decimals: 0 })}
                        </div>
                      </div>
                      {today ? <Badge tone="accent" dot>Today</Badge> : <Badge tone="info">{po.expectedOn ? date(po.expectedOn, 'short') : '—'}</Badge>}
                    </div>
                    {canWrite && (
                      <Button size="sm" icon={<CheckIcon size={13} />} onClick={() => void navigate({ search: { po: po.id } })}>
                        Receive {po.status === 'partial' ? 'the rest' : 'this order'}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
        <section>
          <h2 className="mb-3 text-[13px] font-medium text-ink-2">Receipts</h2>
          {s.receipts.length === 0 ? (
            <Empty icon={<TrayArrowDownIcon size={20} />} title="No deliveries yet">
              When the van arrives, snap the invoice — Operator reads it and matches every line.
            </Empty>
          ) : (
            <div className="overflow-hidden rounded-[14px] bg-surface shadow-card">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-ink-3">
                    <th className="px-4 py-2.5 font-normal">Receipt</th>
                    <th className="px-4 py-2.5 font-normal">Supplier</th>
                    <th className="px-4 py-2.5 font-normal">Document</th>
                    <th className="px-4 py-2.5 font-normal">Location</th>
                    <th className="px-4 py-2.5 text-right font-normal">Value</th>
                    <th className="px-4 py-2.5 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {s.receipts.slice(0, 60).map((r) => (
                    <tr key={r.id} onClick={() => r.status === 'draft' && canWrite && void navigate({ search: { id: r.id } })} className={cn('border-t border-line', r.status === 'draft' && 'cursor-default hover:bg-hover/50')}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-ink">{r.number}</div>
                        <div className="text-[11.5px] text-ink-3">{relative(r.postedAt ?? r.createdAt)}</div>
                      </td>
                      <td className="px-4 py-2.5 text-ink-2">{r.supplierId ? sup[r.supplierId]?.name : '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-ink-3">{r.docRef ?? '—'}</td>
                      <td className="px-4 py-2.5 text-ink-3">{loc[r.locationId]?.name}</td>
                      <td className="tabular px-4 py-2.5 text-right text-ink">{eur(r.lines.reduce((a, l) => a + l.qty * l.unitCost, 0))}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {r.status === 'draft' ? <Badge tone="warn">Draft</Badge> : <Badge tone="ok">Posted</Badge>}
                          {r.source === 'scan' && (
                            <Badge tone="neutral">
                              <CameraIcon size={10} /> Read
                            </Badge>
                          )}
                          {r.source === 'po' && <Badge tone="neutral">PO</Badge>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {editing && draft && <ReceiptEditor key={draft.id} initial={draft} onClose={close} />}
    </div>
  )
}

/* ───────────────────────── Editor ───────────────────────── */

const SAMPLE = {
  supplier: 'Distribuidora Atlântico',
  docRef: 'FT 2026/1418',
  lines: [
    ['Sardinhas em azeite 120g', 48, 1.96, 'L2611SA', 365],
    ['Atum em azeite 120g', 36, 2.4, 'L2611AT', 540],
    ['Flor de sal 250g', 24, 2.3, null, null],
    ['Mel de rosmaninho 500g', 12, 5.1, 'M2026-09', 400],
    ['Polvo em azeite e alho 111g', 24, 4.2, 'L2610PO', 420],
    ['Cavala com tomate 125g', 24, 2.1, 'L2611CV', 365],
  ] as const,
}

function ReceiptEditor({ initial, onClose }: { initial: Receipt; onClose: () => void }) {
  const s = useSnapshot()
  const { commit, actor } = useActions()
  const [r, setR] = useState<Receipt>(initial)
  const [mode, setMode] = useState<'lines' | 'scan'>('lines')
  const [reading, setReading] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const items = indexBy(s.items, (x) => x.id)
  const set = (patch: Partial<Receipt>) => setR((x) => ({ ...x, ...patch }))
  const setLine = (id: string, patch: Partial<ReceiptLine>) => setR((x) => ({ ...x, lines: x.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const total = round(r.lines.reduce((a, l) => a + l.qty * l.unitCost, 0))
  const unmatched = r.lines.filter((l) => !l.itemId).length
  const itemOptions = useMemo(() => s.items.filter((i) => !i.archived).map((i) => ({ value: i.id, label: i.name, hint: i.sku })), [s.items])

  const matchItem = (description: string, code?: string | null) => {
    const byCode = code ? s.items.find((i) => i.barcode === code || i.sku.toLowerCase() === code.toLowerCase()) : undefined
    if (byCode) return { id: byCode.id, confidence: 1 }
    const best = s.items.map((i) => ({ i, sc: fuzzyScore(description, i.name) })).sort((a, b) => b.sc - a.sc)[0]
    return best && best.sc >= 50 ? { id: best.i.id, confidence: best.sc / 100 } : { id: null, confidence: 0 }
  }

  const applyExtraction = (x: { supplier_name: string; supplier_nif?: string | null; document_number?: string | null; document_date?: string | null; lines: { description: string; code?: string | null; qty: number; unit_cost: number; lot?: string | null; expires_on?: string | null; match_item_id?: string | null; confidence?: number }[] }) => {
    const sup = s.suppliers.find((p) => (x.supplier_nif && p.nif === x.supplier_nif.replace(/\D/g, '')) || fuzzyScore(x.supplier_name, p.name) >= 50)
    const lines: ReceiptLine[] = x.lines.map((l) => {
      const m = l.match_item_id && items[l.match_item_id] ? { id: l.match_item_id, confidence: l.confidence ?? 0.9 } : matchItem(l.description, l.code)
      return { id: uid(), itemId: m.id, description: l.description, qty: l.qty, unitCost: round(l.unit_cost, 4), lot: l.lot ?? null, expiresOn: l.expires_on ?? null, confidence: m.confidence, previousCost: m.id ? items[m.id]?.cost ?? null : null }
    })
    // Match against an open PO from the same supplier
    const po = sup ? s.orders.find((p) => p.supplierId === sup.id && (p.status === 'sent' || p.status === 'partial')) : undefined
    setR((cur) => ({ ...cur, supplierId: sup?.id ?? cur.supplierId, docRef: x.document_number ?? cur.docRef, docDate: x.document_date ?? cur.docDate, lines, source: 'scan', poId: po?.id ?? cur.poId }))
    toast.success(`Read ${lines.length} lines`, { description: `${lines.filter((l) => l.itemId).length} matched to your catalogue${sup ? ` · ${sup.name}` : ''}` })
  }

  const readFile = async (f: File) => {
    setReadError(null)
    setReading('Reading the document…')
    try {
      const data = await new Promise<string>((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => res(String(fr.result).split(',')[1] ?? '')
        fr.onerror = () => rej(new Error('Couldn’t read the file'))
        fr.readAsDataURL(f)
      })
      const mediaType = f.type === 'application/pdf' ? 'application/pdf' : f.type === 'image/png' ? 'image/png' : f.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
      const mode = useSession.getState().session?.mode ?? 'local'
      const token = mode === 'cloud' ? await accessToken() : null
      const res = await fetch('/api/extract', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nau-mode': mode, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ data, mediaType, catalogue: s.items.filter((i) => !i.archived).map((i) => ({ id: i.id, name: i.name, sku: i.sku, barcode: i.barcode })) }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Couldn’t read that document')
      applyExtraction(json)
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'Couldn’t read that document')
    } finally {
      setReading(null)
    }
  }

  const readSample = async () => {
    setReadError(null)
    for (const step of ['Reading FT 2026/1418…', 'Matching 6 lines to your catalogue…', 'Checking prices against the last delivery…']) {
      setReading(step)
      await sleep(650)
    }
    setReading(null)
    const today = new Date()
    applyExtraction({
      supplier_name: SAMPLE.supplier,
      document_number: SAMPLE.docRef,
      document_date: isoDay(today),
      lines: SAMPLE.lines.map(([d, q, c, lot, exp]) => ({ description: d, qty: q, unit_cost: c, lot, expires_on: exp ? isoDay(new Date(today.getTime() + exp * 86400000)) : null })),
    })
  }

  const onScan = (code: string) => {
    const it = s.items.find((i) => i.barcode === code || i.sku.toLowerCase() === code.toLowerCase())
    if (!it) return toast.error('No item with that barcode', { description: code })
    setR((cur) => {
      const ex = cur.lines.find((l) => l.itemId === it.id)
      if (ex) return { ...cur, lines: cur.lines.map((l) => (l.id === ex.id ? { ...l, qty: l.qty + 1 } : l)) }
      return { ...cur, lines: [...cur.lines, { id: uid(), itemId: it.id, description: it.name, qty: 1, unitCost: it.cost, confidence: 1, previousCost: it.cost }] }
    })
    toast(`+1 ${it.name}`, { duration: 1200 })
  }

  const save = async () => {
    await commit(saveReceiptDraft(r), { success: 'Draft saved' })
    onClose()
  }
  const post = async () => {
    await commit(postReceipt(s, r, actor), { success: `${r.number} posted`, description: `${r.lines.filter((l) => l.itemId).length} lines · ${eur(total)}` })
    onClose()
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={initial.poId ? `Receive ${s.orders.find((p) => p.id === initial.poId)?.number}` : r.status === 'draft' && s.receipts.some((x) => x.id === r.id) ? `Draft ${r.number}` : 'Receive a delivery'}
      description="Check what arrived, then post it to stock."
      width={820}
      footer={
        <>
          <span className="mr-auto text-[12.5px] text-ink-3">
            {r.lines.length} lines · <span className="tabular font-medium text-ink">{eur(total)}</span>
            {unmatched > 0 && <span className="text-warn-ink"> · {unmatched} not matched — they won’t be posted</span>}
          </span>
          <Button variant="ghost" onClick={() => void save()} disabled={!r.lines.length}>
            Save draft
          </Button>
          <Button variant="primary" onClick={() => void post()} disabled={!r.lines.some((l) => l.itemId && l.qty > 0)}>
            Post to stock
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6 p-5">
        {r.lines.length === 0 && !reading && (
          <div className="grid gap-3 sm:grid-cols-3">
            <button type="button" onClick={() => file.current?.click()} className="press flex flex-col items-start gap-2 rounded-[14px] bg-surface p-4 text-left shadow-card hover:bg-surface-2">
              <CameraIcon size={20} className="text-accent" />
              <span className="text-[13.5px] font-medium text-ink">Read the invoice</span>
              <span className="text-[12.5px] text-ink-3">Photo or PDF of the fatura or guia. Operator matches each line.</span>
            </button>
            <button type="button" onClick={() => setMode('scan')} className="press flex flex-col items-start gap-2 rounded-[14px] bg-surface p-4 text-left shadow-card hover:bg-surface-2">
              <BarcodeIcon size={20} className="text-accent" />
              <span className="text-[13.5px] font-medium text-ink">Scan the boxes</span>
              <span className="text-[12.5px] text-ink-3">Each scan adds one. Camera or USB scanner.</span>
            </button>
            <button type="button" onClick={() => set({ lines: [{ id: uid(), itemId: null, description: '', qty: 1, unitCost: 0 }] })} className="press flex flex-col items-start gap-2 rounded-[14px] bg-surface p-4 text-left shadow-card hover:bg-surface-2">
              <FileTextIcon size={20} className="text-accent" />
              <span className="text-[13.5px] font-medium text-ink">Type it in</span>
              <span className="text-[12.5px] text-ink-3">Add lines by hand.</span>
            </button>
          </div>
        )}
        <input ref={file} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} />
        {reading && (
          <div className="flex items-center gap-3 rounded-[14px] bg-accent-soft px-4 py-3 text-[13px] text-accent-ink">
            <Mark size={16} working /> {reading}
          </div>
        )}
        {readError && (
          <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-warn-soft px-4 py-3 text-[13px] text-warn-ink">
            <WarningIcon size={16} />
            <span className="flex-1">{readError}</span>
            <Button size="sm" icon={<SparkleIcon size={13} />} onClick={() => void readSample()}>
              Try the sample invoice
            </Button>
          </div>
        )}
        {r.lines.length === 0 && !reading && !readError && (
          <button type="button" onClick={() => void readSample()} className="flex w-fit items-center gap-2 text-[12.5px] text-ink-3 hover:text-ink">
            <img src="/samples/fatura-atlantico.jpg" alt="" className="h-9 w-7 rounded-[4px] object-cover shadow-card" /> No invoice at hand? Try a sample from Distribuidora Atlântico →
          </button>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Supplier" className="sm:col-span-2">
            <Select value={r.supplierId ?? ''} onChange={(v) => set({ supplierId: v })} options={s.suppliers.map((x) => ({ value: x.id, label: x.name }))} placeholder="Choose supplier" />
          </Field>
          <Field label="Into">
            <Select value={r.locationId} onChange={(v) => set({ locationId: v })} options={s.locations.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
          <Field label="Document">
            <Input value={r.docRef ?? ''} onChange={(e) => set({ docRef: e.target.value })} placeholder="FT 2026/123" />
          </Field>
        </div>

        {mode === 'scan' && (
          <div className="rounded-[16px] bg-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--gray-a3)]">
            <Scanner onDetect={onScan} compact />
            <button type="button" className="mt-2 text-[12px] text-ink-3 hover:text-ink" onClick={() => setMode('lines')}>
              Hide scanner
            </button>
          </div>
        )}

        {r.lines.length > 0 && (
          <div className="overflow-x-auto rounded-[14px] shadow-[inset_0_0_0_1px_var(--gray-a4)]">
            <table className="w-full min-w-[720px] text-[12.5px]">
              <thead>
                <tr className="text-left text-ink-3">
                  <th className="px-3 py-2 font-normal">Item</th>
                  <th className="w-24 px-2 py-2 text-right font-normal">Qty</th>
                  <th className="w-28 px-2 py-2 text-right font-normal">Unit cost</th>
                  <th className="w-28 px-2 py-2 font-normal">Lot</th>
                  <th className="w-32 px-2 py-2 font-normal">Expires</th>
                  <th className="w-24 px-2 py-2 text-right font-normal">Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {r.lines.map((l) => {
                  const it = l.itemId ? items[l.itemId] : undefined
                  const change = l.previousCost && l.unitCost ? l.unitCost / l.previousCost - 1 : 0
                  return (
                    <tr key={l.id} className="border-t border-line align-top">
                      <td className="px-3 py-2">
                        <Select size="sm" value={l.itemId ?? ''} onChange={(v) => setLine(l.id, { itemId: v, previousCost: items[v]?.cost ?? null, description: items[v]?.name ?? l.description })} options={itemOptions} placeholder="Match to an item…" aria-label="Item" />
                        {(!it || (l.confidence ?? 1) < 0.8) && l.description && <div className="mt-1 truncate text-[11.5px] text-ink-3">On the invoice: “{l.description}”</div>}
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput value={l.qty} min={0} onChange={(v) => setLine(l.id, { qty: v })} className="h-7 text-[12.5px]" aria-label="Quantity" />
                        {it && <div className="mt-1 text-right text-[11px] text-ink-4">{it.unit}</div>}
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput value={l.unitCost} min={0} onChange={(v) => setLine(l.id, { unitCost: v })} className="h-7 text-[12.5px]" aria-label="Unit cost" />
                        {Math.abs(change) >= 0.02 && <div className={cn('mt-1 text-right text-[11px] font-medium', change > 0 ? 'text-warn-ink' : 'text-ok-ink')}>{change > 0 ? '+' : ''}{Math.round(change * 100)}% vs {eur(l.previousCost!)}</div>}
                      </td>
                      <td className="px-2 py-2">{(it?.tracksExpiry || l.lot) && <Input value={l.lot ?? ''} onChange={(e) => setLine(l.id, { lot: e.target.value || null })} className="h-7 text-[12.5px]" placeholder="Lot" aria-label="Lot" />}</td>
                      <td className="px-2 py-2">{(it?.tracksExpiry || l.expiresOn) && <Input type="date" value={l.expiresOn ?? ''} onChange={(e) => setLine(l.id, { expiresOn: e.target.value || null })} className="h-7 text-[12.5px]" aria-label="Expiry date" />}</td>
                      <td className="tabular px-2 py-2.5 text-right text-ink">{eur(l.qty * l.unitCost)}</td>
                      <td className="py-2 pr-2">
                        <button type="button" aria-label="Remove line" onClick={() => set({ lines: r.lines.filter((x) => x.id !== l.id) })} className="touch-target flex size-7 items-center justify-center rounded-md text-ink-4 hover:bg-hover hover:text-bad-ink">
                          <TrashIcon size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {r.lines.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<PlusIcon size={13} />} onClick={() => set({ lines: [...r.lines, { id: uid(), itemId: null, description: '', qty: 1, unitCost: 0 }] })}>
              Add line
            </Button>
            <Button size="sm" icon={<BarcodeIcon size={13} />} onClick={() => setMode(mode === 'scan' ? 'lines' : 'scan')}>
              {mode === 'scan' ? 'Hide scanner' : 'Scan'}
            </Button>
            <Button size="sm" icon={<CameraIcon size={13} />} onClick={() => file.current?.click()}>
              Read another page
            </Button>
            {r.poId && (
              <span className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-3">
                <TruckIcon size={13} /> Matched to {s.orders.find((p) => p.id === r.poId)?.number} — quantities update the order
              </span>
            )}
          </div>
        )}
        {r.lines.some((l) => l.itemId) && (
          <p className="text-[12px] text-ink-4">
            Posting updates stock at {s.locations.find((l) => l.id === r.locationId)?.name}, recalculates weighted average cost{r.lines.some((l) => l.lot) ? ', records lots' : ''} and can be reverted from the ledger. {fmtQty(r.lines.filter((l) => l.itemId).reduce((a, l) => a + l.qty, 0))} units in total.
          </p>
        )}
      </div>
    </Sheet>
  )
}
