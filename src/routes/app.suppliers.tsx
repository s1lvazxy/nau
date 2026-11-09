import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { EnvelopeSimpleIcon, PhoneIcon, PlusIcon, UsersThreeIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { saveSupplier } from '~/data/commands'
import { derive, poTotal } from '~/lib/analytics'
import { eur } from '~/lib/format'
import { formatNIF, isValidNIF, nifKind } from '~/lib/pt'
import { cn, uid } from '~/lib/utils'
import type { Supplier } from '~/lib/types'
import { Button } from '~/components/ui/button'
import { Field, Input, NumberInput, Textarea } from '~/components/ui/form'
import { Sheet } from '~/components/ui/overlay'
import { Empty, PageHeader } from '~/components/ui/primitives'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'

export const Route = createFileRoute('/app/suppliers')({ component: Suppliers })

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function Suppliers() {
  usePageTitle('Suppliers')
  const s = useSnapshot()
  const { canWrite } = useActions()
  const [editing, setEditing] = useState<Supplier | null>(null)
  const stats = derive(s).stats
  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Lead times and minimum orders are what make every suggested order right."
        actions={
          canWrite && (
            <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setEditing({ id: uid(), name: '', leadTimeDays: 3, minOrderValue: 0, nif: null, email: null, phone: null, contact: null, paymentTerms: '30 days', notes: null, orderDays: null })}>
              New supplier
            </Button>
          )
        }
      />
      <div className="px-5 py-6 md:px-8">
        {s.suppliers.length === 0 ? (
          <Empty icon={<UsersThreeIcon size={20} />} title="No suppliers yet">
            Add who you buy from. Nau uses their lead time and minimum order to size purchase orders.
          </Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {s.suppliers.map((sup) => {
              const mine = stats.filter((x) => x.item.supplierId === sup.id)
              const needs = mine.filter((x) => x.status === 'low' || x.status === 'critical' || x.status === 'out').length
              const open = s.orders.filter((o) => o.supplierId === sup.id && (o.status === 'sent' || o.status === 'partial'))
              return (
                <button key={sup.id} type="button" onClick={() => canWrite && setEditing(sup)} className="press flex flex-col gap-4 rounded-[14px] bg-surface p-4 text-left shadow-card hover:bg-surface-2">
                  <div>
                    <div className="text-[14px] font-medium text-ink">{sup.name}</div>
                    <div className="mt-0.5 text-[12px] text-ink-3">
                      {sup.contact ?? '—'}
                      {sup.nif ? ` · NIF ${formatNIF(sup.nif)}` : ''}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[12px]">
                    <div>
                      <div className="text-ink-3">Lead time</div>
                      <div className="tabular font-medium text-ink">{sup.leadTimeDays} d</div>
                    </div>
                    <div>
                      <div className="text-ink-3">Minimum</div>
                      <div className="tabular font-medium text-ink">{eur(sup.minOrderValue, { decimals: 0 })}</div>
                    </div>
                    <div>
                      <div className="text-ink-3">Items</div>
                      <div className="tabular font-medium text-ink">{mine.length}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                    {needs > 0 && <span className="text-warn-ink">{needs} to reorder</span>}
                    {open.length > 0 && <span className="text-info-ink">{open.length} on the way · {eur(open.reduce((a, o) => a + poTotal(o), 0), { decimals: 0 })}</span>}
                    {!needs && !open.length && <span className="text-ink-3">All covered</span>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
      {editing && <SupplierSheet key={editing.id} supplier={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function SupplierSheet({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const { commit } = useActions()
  const s = useSnapshot()
  const [sup, setSup] = useState(supplier)
  const isNew = !s.suppliers.some((x) => x.id === supplier.id)
  const set = <K extends keyof Supplier>(k: K, v: Supplier[K]) => setSup((x) => ({ ...x, [k]: v }))
  const nifDigits = (sup.nif ?? '').replace(/\D/g, '')
  const nifOk = !nifDigits || isValidNIF(nifDigits)
  const save = async () => {
    if (!sup.name.trim() || !nifOk) return
    await commit(saveSupplier({ ...sup, name: sup.name.trim(), nif: nifDigits || null }), { success: isNew ? `Added ${sup.name}` : 'Saved' })
    onClose()
  }
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={isNew ? 'New supplier' : sup.name} width={480} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!sup.name.trim() || !nifOk} onClick={() => void save()}>{isNew ? 'Add supplier' : 'Save'}</Button></>}>
      <div className="flex flex-col gap-5 p-5">
        <Field label="Name">
          <Input value={sup.name} onChange={(e) => set('name', e.target.value)} autoFocus={isNew} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="NIF" optional error={!nifOk && nifDigits.length >= 9 ? 'Check digit doesn’t match' : null} hint={nifDigits.length === 9 && nifOk ? nifKind(nifDigits) : undefined}>
            <Input value={sup.nif ? formatNIF(sup.nif) : ''} onChange={(e) => set('nif', e.target.value.replace(/\D/g, '').slice(0, 9))} inputMode="numeric" aria-invalid={!nifOk} />
          </Field>
          <Field label="Contact person" optional>
            <Input value={sup.contact ?? ''} onChange={(e) => set('contact', e.target.value || null)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Orders email" optional>
            <Input type="email" value={sup.email ?? ''} onChange={(e) => set('email', e.target.value || null)} leading={<EnvelopeSimpleIcon size={13} />} />
          </Field>
          <Field label="Phone" optional>
            <Input type="tel" value={sup.phone ?? ''} onChange={(e) => set('phone', e.target.value || null)} leading={<PhoneIcon size={13} />} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Lead time (days)">
            <NumberInput value={sup.leadTimeDays} min={0} onChange={(v) => set('leadTimeDays', Math.round(v))} />
          </Field>
          <Field label="Minimum order (€)">
            <NumberInput value={sup.minOrderValue} min={0} onChange={(v) => set('minOrderValue', v)} />
          </Field>
          <Field label="Payment terms" optional>
            <Input value={sup.paymentTerms ?? ''} onChange={(e) => set('paymentTerms', e.target.value || null)} />
          </Field>
        </div>
        <Field label="Order days" hint="Days you usually place orders with them.">
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = sup.orderDays?.includes(i) ?? false
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => set('orderDays', on ? (sup.orderDays ?? []).filter((x) => x !== i) : [...(sup.orderDays ?? []), i].sort())} className={cn('h-8 w-11 rounded-[8px] text-[12.5px] transition-colors', on ? 'bg-ink text-inverse' : 'bg-hover text-ink-2 hover:text-ink')}>
                  {d}
                </button>
              )
            })}
          </div>
        </Field>
        <Field label="Notes" optional>
          <Textarea value={sup.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} placeholder="e.g. delivers before 10:00, call ahead on holidays" />
        </Field>
      </div>
    </Sheet>
  )
}
