import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { CarIcon, MapPinIcon, PlusIcon, StorefrontIcon, WarehouseIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { valueByLocation, derive } from '~/lib/analytics'
import { eur, num } from '~/lib/format'
import { uid } from '~/lib/utils'
import type { Location } from '~/lib/types'
import { Button } from '~/components/ui/button'
import { Field, Input, Segmented, Switch } from '~/components/ui/form'
import { Modal } from '~/components/ui/overlay'
import { Badge, PageHeader } from '~/components/ui/primitives'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { tr } from '~/i18n'

export const Route = createFileRoute('/app/locations')({ component: Locations })

const ICON = { warehouse: <WarehouseIcon size={18} />, store: <StorefrontIcon size={18} />, van: <CarIcon size={18} /> }

function Locations() {
  usePageTitle(tr('Locations'))
  const s = useSnapshot()
  const { canWrite } = useActions()
  const [editing, setEditing] = useState<Location | null>(null)
  const rows = valueByLocation(s)
  const stats = derive(s).stats
  return (
    <div>
      <PageHeader title={tr('Locations')} description={tr('Shops, warehouses and vans. Stock, demand and transfers are tracked per location.')} actions={canWrite && <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setEditing({ id: uid(), name: '', code: '', kind: 'store', address: null, isDefault: false })}>{tr('New location')}</Button>} />
      <div className="grid gap-3 px-5 py-6 sm:grid-cols-2 md:px-8 xl:grid-cols-3">
        {rows.map(({ location: l, value, units }) => {
          const low = stats.filter((x) => (x.dailyByLocation[l.id] ?? 0) > 0 && (x.byLocation[l.id] ?? 0) / (x.dailyByLocation[l.id] || 1) < 3).length
          return (
            <button key={l.id} type="button" onClick={() => canWrite && setEditing(l)} className="press flex flex-col gap-4 rounded-[16px] bg-surface p-5 text-left shadow-card hover:bg-surface-2">
              <div className="flex items-start justify-between">
                <span className="flex size-10 items-center justify-center rounded-[12px] bg-hover text-ink">{ICON[l.kind]}</span>
                {l.isDefault && <Badge tone="accent">{tr('Default for deliveries')}</Badge>}
              </div>
              <div>
                <div className="text-[15px] font-medium text-ink">{l.name}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-3">
                  <MapPinIcon size={11} /> {l.address ?? tr('No address')}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-[12px]">
                <div>
                  <div className="text-ink-3">{tr('Value')}</div>
                  <div className="tabular font-medium text-ink">{eur(value, { decimals: 0 })}</div>
                </div>
                <div>
                  <div className="text-ink-3">{tr('Units')}</div>
                  <div className="tabular font-medium text-ink">{num(units)}</div>
                </div>
                <div>
                  <div className="text-ink-3">{tr('Running low')}</div>
                  <div className={`tabular font-medium ${low ? 'text-warn-ink' : 'text-ink'}`}>{low}</div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
      {editing && <LocationDialog key={editing.id} loc={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function LocationDialog({ loc: init, onClose }: { loc: Location; onClose: () => void }) {
  const s = useSnapshot()
  const { commit } = useActions()
  const [loc, setLoc] = useState(init)
  const isNew = !s.locations.some((l) => l.id === init.id)
  const save = async () => {
    const list: Location[] = [{ ...loc, name: loc.name.trim(), code: loc.code || loc.name.trim().slice(0, 3).toUpperCase() }]
    if (loc.isDefault) for (const o of s.locations) if (o.id !== loc.id && o.isDefault) list.push({ ...o, isDefault: false })
    await commit({ upserts: { locations: list } }, { success: isNew ? tr('Added {0}', loc.name) : tr('Saved') })
    onClose()
  }
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={isNew ? tr('New location') : loc.name} footer={<><Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button variant="primary" disabled={!loc.name.trim()} onClick={() => void save()}>{isNew ? tr('Add location') : tr('Save')}</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_100px] gap-3">
          <Field label={tr('Name')}>
            <Input value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} autoFocus={isNew} />
          </Field>
          <Field label={tr('Code')}>
            <Input value={loc.code} onChange={(e) => setLoc({ ...loc, code: e.target.value.toUpperCase().slice(0, 5) })} />
          </Field>
        </div>
        <Field label={tr('Type')}>
          <Segmented
            value={loc.kind}
            onChange={(k) => setLoc({ ...loc, kind: k })}
            options={[
              { value: 'store', label: tr('Shop') },
              { value: 'warehouse', label: tr('Warehouse') },
              { value: 'van', label: tr('Van') },
            ]}
          />
        </Field>
        <Field label={tr('Address')} optional>
          <Input value={loc.address ?? ''} onChange={(e) => setLoc({ ...loc, address: e.target.value || null })} placeholder={tr('Rua, número, código postal, cidade')} />
        </Field>
        <Switch checked={!!loc.isDefault} onChange={(v) => setLoc({ ...loc, isDefault: v })} label={tr('Default for deliveries')} description={tr('Purchase orders and receipts go here unless you choose otherwise.')} />
      </div>
    </Modal>
  )
}
