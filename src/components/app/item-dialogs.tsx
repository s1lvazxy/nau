import { useMemo, useState } from 'react'
import type { Item, Unit } from '~/lib/types'
import { useSnapshot } from '~/data/store'
import { adjustStock, archiveItems, newItem, onHandAt, saveItem, transferStock } from '~/data/commands'
import { vatOptions } from '~/lib/pt'
import { eur, qty as fmtQty } from '~/lib/format'
import { round } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import { Field, Input, NumberInput, Select, Switch, Textarea } from '~/components/ui/form'
import { Modal, Sheet } from '~/components/ui/overlay'
import { useActions } from './actions'

const REASONS = ['Recount', 'Damaged', 'Expired', 'Theft or loss', 'Used in-house', 'Supplier return', 'Found']

export function AdjustDialog({ item, open, onOpenChange, defaultLocation }: { item: Item; open: boolean; onOpenChange: (o: boolean) => void; defaultLocation?: string }) {
  const s = useSnapshot()
  const { commit, actor } = useActions()
  const [loc, setLoc] = useState(defaultLocation ?? s.locations.find((l) => l.isDefault)?.id ?? s.locations[0].id)
  const current = onHandAt(s, item.id, loc)
  const [value, setValue] = useState<number>(current)
  const [reason, setReason] = useState('Recount')
  const [note, setNote] = useState('')
  const delta = round(value - current, 3)
  const submit = async () => {
    const waste = ['Damaged', 'Expired', 'Theft or loss'].includes(reason)
    const cs = adjustStock(s, { itemId: item.id, locationId: loc, newQty: value, reason: note ? `${reason} — ${note}` : reason, type: waste && delta < 0 ? 'waste' : 'adjustment' }, actor)
    const undo = adjustStock(s, { itemId: item.id, locationId: loc, delta: -delta, reason: 'Undo adjustment' }, actor)
    await commit(cs, { success: `${item.name}: ${fmtQty(current, item.unit)} → ${fmtQty(value, item.unit)}`, undo })
    onOpenChange(false)
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Adjust stock"
      description={item.name}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!delta} onClick={() => void submit()}>
            {delta ? `${delta > 0 ? 'Add' : 'Remove'} ${fmtQty(Math.abs(delta), item.unit)}` : 'No change'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Location">
          <Select
            value={loc}
            onChange={(v) => {
              setLoc(v)
              setValue(onHandAt(s, item.id, v))
            }}
            options={s.locations.map((l) => ({ value: l.id, label: l.name, hint: `${fmtQty(onHandAt(s, item.id, l.id), item.unit)} on hand` }))}
          />
        </Field>
        <Field label="Counted quantity" hint={`Now ${fmtQty(current, item.unit)}${delta ? ` · change ${delta > 0 ? '+' : ''}${delta} (${eur(delta * item.cost)})` : ''}`}>
          <NumberInput value={value} min={0} onChange={setValue} autoFocus />
        </Field>
        <Field label="Reason">
          <Select value={reason} onChange={setReason} options={REASONS.map((r) => ({ value: r, label: r }))} />
        </Field>
        <Field label="Note" optional>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. box dropped in the back" />
        </Field>
      </div>
    </Modal>
  )
}

export function TransferDialog({ item, open, onOpenChange }: { item: Item; open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useSnapshot()
  const { commit, actor } = useActions()
  const sorted = [...s.locations].sort((a, b) => onHandAt(s, item.id, b.id) - onHandAt(s, item.id, a.id))
  const [from, setFrom] = useState(sorted[0]?.id)
  const [to, setTo] = useState(sorted.find((l) => l.id !== sorted[0]?.id)?.id)
  const [qty, setQty] = useState(1)
  const avail = from ? onHandAt(s, item.id, from) : 0
  const ok = from && to && from !== to && qty > 0 && qty <= avail
  const submit = async () => {
    if (!from || !to) return
    const cs = transferStock(s, { itemId: item.id, from, to, qty }, actor)
    await commit(cs, { success: `Moved ${fmtQty(qty, item.unit)} ${item.name}`, undo: transferStock(s, { itemId: item.id, from: to, to: from, qty }, actor) })
    onOpenChange(false)
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Transfer stock" description={item.name} size="sm" footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => void submit()}>Transfer</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <Select value={from} onChange={setFrom} options={s.locations.map((l) => ({ value: l.id, label: l.name, hint: fmtQty(onHandAt(s, item.id, l.id), item.unit) }))} />
          </Field>
          <Field label="To">
            <Select value={to} onChange={setTo} options={s.locations.filter((l) => l.id !== from).map((l) => ({ value: l.id, label: l.name, hint: fmtQty(onHandAt(s, item.id, l.id), item.unit) }))} />
          </Field>
        </div>
        <Field label="Quantity" hint={`${fmtQty(avail, item.unit)} available`} error={qty > avail ? 'More than is available' : null}>
          <NumberInput value={qty} min={0} onChange={setQty} autoFocus />
        </Field>
      </div>
    </Modal>
  )
}

const UNITS: { value: Unit; label: string }[] = [
  { value: 'un', label: 'Units' },
  { value: 'kg', label: 'Kilograms' },
  { value: 'L', label: 'Litres' },
  { value: 'cx', label: 'Boxes' },
  { value: 'm', label: 'Metres' },
]

export function ItemSheet({ open, onOpenChange, item: initial }: { open: boolean; onOpenChange: (o: boolean) => void; item?: Item }) {
  const s = useSnapshot()
  const { commit, actor, navigate } = useActions()
  const isNew = !initial
  const [item, setItem] = useState<Item>(() => initial ?? newItem(s))
  const [opening, setOpening] = useState(0)
  const [openingLoc, setOpeningLoc] = useState(s.locations.find((l) => l.isDefault)?.id ?? s.locations[0]?.id)
  const [autoRP, setAutoRP] = useState(initial?.reorderPoint == null)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Item>(k: K, v: Item[K]) => setItem((x) => ({ ...x, [k]: v }))
  const margin = useMemo(() => {
    const net = item.price / (1 + item.vatRate / 100)
    return net > 0 ? (net - item.cost) / net : 0
  }, [item.price, item.cost, item.vatRate])
  const submit = async () => {
    if (!item.name.trim()) return setError('Give the item a name')
    if (s.items.some((x) => x.id !== item.id && x.sku.toLowerCase() === item.sku.toLowerCase())) return setError('Another item already uses this SKU')
    if (item.barcode && s.items.some((x) => x.id !== item.id && x.barcode === item.barcode)) return setError('Another item already uses this barcode')
    const next = { ...item, name: item.name.trim(), reorderPoint: autoRP ? null : item.reorderPoint ?? 0 }
    await commit(saveItem(s, next, actor, isNew && opening ? { locationId: openingLoc, qty: opening } : undefined), { success: isNew ? `Added ${next.name}` : 'Saved' })
    onOpenChange(false)
    if (isNew) navigate(`/app/items/${next.id}`)
  }
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={isNew ? 'New item' : `Edit ${initial?.name}`}
      width={520}
      footer={
        <>
          {!isNew && (
            <Button
              variant="ghost"
              className="mr-auto text-bad-ink"
              onClick={() => {
                void commit(archiveItems(s, [item.id], !item.archived, actor), { success: item.archived ? 'Restored' : 'Archived', undo: archiveItems(s, [item.id], !!item.archived, actor) })
                onOpenChange(false)
              }}
            >
              {item.archived ? 'Restore' : 'Archive'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()}>
            {isNew ? 'Add item' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 p-5">
        <Field label="Name">
          <Input value={item.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Azeite virgem extra 750ml" autoFocus={isNew} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU">
            <Input value={item.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} />
          </Field>
          <Field label="Barcode" optional>
            <Input value={item.barcode ?? ''} onChange={(e) => set('barcode', e.target.value.replace(/\s/g, '') || null)} inputMode="numeric" placeholder="EAN-13" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select value={item.categoryId ?? ''} onChange={(v) => set('categoryId', v)} options={s.categories.map((c) => ({ value: c.id, label: c.name }))} placeholder="None" />
          </Field>
          <Field label="Unit">
            <Select value={item.unit} onChange={(v) => set('unit', v)} options={UNITS} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Cost (ex-VAT)">
            <NumberInput value={item.cost} min={0} onChange={(v) => set('cost', v)} />
          </Field>
          <Field label="Price (with VAT)">
            <NumberInput value={item.price} min={0} onChange={(v) => set('price', v)} />
          </Field>
          <Field label="IVA">
            <Select value={item.vatRate} onChange={(v) => set('vatRate', v)} options={vatOptions(s.workspace.region)} />
          </Field>
        </div>
        <p className="-mt-2 text-[12px] text-ink-3">
          Gross margin <span className="tabular font-medium text-ink">{Math.round(margin * 100)}%</span> · {eur(item.price / (1 + item.vatRate / 100) - item.cost)} per unit before VAT
        </p>
        <Field label="Supplier" optional>
          <Select value={item.supplierId ?? ''} onChange={(v) => set('supplierId', v)} options={s.suppliers.map((x) => ({ value: x.id, label: x.name, hint: `${x.leadTimeDays}-day lead time` }))} placeholder="None" />
        </Field>
        <div className="rounded-[12px] bg-surface-2 p-4 shadow-[inset_0_0_0_1px_var(--gray-a3)]">
          <Switch checked={autoRP} onChange={setAutoRP} label="Automatic reorder point" description="Nau sets it from demand, lead time and safety stock — and keeps it current." />
          {!autoRP && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Reorder point">
                <NumberInput value={item.reorderPoint ?? 0} min={0} onChange={(v) => set('reorderPoint', v)} />
              </Field>
              <Field label="Order quantity" optional>
                <NumberInput value={item.reorderQty ?? 0} min={0} onChange={(v) => set('reorderQty', v || null)} />
              </Field>
            </div>
          )}
          <div className="mt-4">
            <Field label="Safety stock (days of demand)">
              <NumberInput value={item.safetyDays} min={0} onChange={(v) => set('safetyDays', v)} />
            </Field>
          </div>
        </div>
        <Switch checked={item.tracksExpiry} onChange={(v) => set('tracksExpiry', v)} label="Track lots and expiry dates" description="Receive with lot codes; sales use first-expired-first-out." />
        <Field label="Tags" optional hint="Comma separated, e.g. seasonal, local">
          <Input value={item.tags.join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))} />
        </Field>
        {isNew && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Opening stock" optional>
              <NumberInput value={opening} min={0} onChange={setOpening} />
            </Field>
            <Field label="At">
              <Select value={openingLoc} onChange={setOpeningLoc} options={s.locations.map((l) => ({ value: l.id, label: l.name }))} />
            </Field>
          </div>
        )}
        {error && (
          <p className="rounded-[10px] bg-bad-soft px-3 py-2 text-[13px] text-bad-ink" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  )
}

export function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Textarea value={value} onChange={(e) => onChange(e.target.value)} />
}
