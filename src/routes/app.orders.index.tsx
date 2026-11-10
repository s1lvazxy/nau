import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { PlusIcon, TruckIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { createPO } from '~/data/commands'
import { poTotal } from '~/lib/analytics'
import { date, eur, relative } from '~/lib/format'
import { indexBy } from '~/lib/utils'
import { PO_STATUS } from '~/components/app/labels'
import { Button } from '~/components/ui/button'
import { Field, Segmented, Select } from '~/components/ui/form'
import { Modal } from '~/components/ui/overlay'
import { Badge, Empty, PageHeader } from '~/components/ui/primitives'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { Mark } from '~/components/brand/logo'
import { tr } from '~/i18n'

export const Route = createFileRoute('/app/orders/')({
  validateSearch: (s: Record<string, unknown>): { new?: number } => (s.new ? { new: 1 } : {}),
  component: Orders,
})


function Orders() {
  usePageTitle(tr('Orders'))
  const s = useSnapshot()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/app/orders/' })
  const { canWrite } = useActions()
  const [tab, setTab] = useState<'open' | 'draft' | 'done' | 'all'>('open')
  const sup = indexBy(s.suppliers, (x) => x.id)
  const list = s.orders.filter((o) => (tab === 'open' ? o.status === 'sent' || o.status === 'partial' : tab === 'draft' ? o.status === 'draft' : tab === 'done' ? o.status === 'received' || o.status === 'cancelled' : true))
  const count = (f: (o: (typeof s.orders)[number]) => boolean) => s.orders.filter(f).length
  return (
    <div>
      <PageHeader
        title={tr('Purchase orders')}
        description={tr('What you’ve asked suppliers for, and when it lands.')}
        actions={
          canWrite && (
            <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => void navigate({ search: { new: 1 } })}>
              {tr('New order')}
            </Button>
          )
        }
      >
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'open', label: tr('On the way · {0}', count((o) => o.status === 'sent' || o.status === 'partial')) },
            { value: 'draft', label: tr('Drafts · {0}', count((o) => o.status === 'draft')) },
            { value: 'done', label: tr('Completed') },
            { value: 'all', label: tr('All') },
          ]}
        />
      </PageHeader>
      <div className="px-5 py-6 md:px-8">
        {list.length === 0 ? (
          <Empty icon={<TruckIcon size={20} />} title={tab === 'draft' ? tr('No drafts') : tr('Nothing on the way')}>
            {tr('Approve a reorder in Approvals, or create an order yourself.')}
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-[14px] bg-surface shadow-card">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-ink-3">
                  <th className="px-4 py-2.5 font-normal">{tr('Order')}</th>
                  <th className="px-4 py-2.5 font-normal">{tr('Supplier')}</th>
                  <th className="px-4 py-2.5 font-normal">{tr('Expected')}</th>
                  <th className="px-4 py-2.5 text-right font-normal">{tr('Lines')}</th>
                  <th className="px-4 py-2.5 text-right font-normal">{tr('Value')}</th>
                  <th className="px-4 py-2.5 font-normal">{tr('Status')}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id} onClick={() => void navigate({ to: '/app/orders/$orderId', params: { orderId: o.id } })} className="cursor-default border-t border-line hover:bg-hover/50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 font-medium text-ink">
                        {o.number}
                        {o.createdBy === 'agent' && <Mark size={11} className="text-accent" title={tr('Prepared by Operator')} />}
                      </div>
                      <div className="text-[11.5px] text-ink-3">{relative(o.createdAt)}</div>
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{sup[o.supplierId]?.name}</td>
                    <td className="px-4 py-2.5 text-ink-2">{o.expectedOn ? date(o.expectedOn, 'short') : '—'}</td>
                    <td className="tabular px-4 py-2.5 text-right text-ink-2">{o.lines.length}</td>
                    <td className="tabular px-4 py-2.5 text-right text-ink">{eur(poTotal(o))}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={PO_STATUS[o.status].tone} dot>
                        {PO_STATUS[o.status].label}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {search.new && <NewOrder onClose={() => void navigate({ search: {} })} />}
    </div>
  )
}

function NewOrder({ onClose }: { onClose: () => void }) {
  const s = useSnapshot()
  const { commit, actor, navigate } = useActions()
  const [supplier, setSupplier] = useState<string>(s.suppliers[0]?.id ?? '')
  const [location, setLocation] = useState(s.locations.find((l) => l.isDefault)?.id ?? s.locations[0]?.id)
  const create = async () => {
    const { cs, po } = createPO(s, { supplierId: supplier, locationId: location, lines: [] }, actor)
    await commit(cs)
    onClose()
    navigate(`/app/orders/${po.id}`)
  }
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={tr('New purchase order')} size="sm" footer={<><Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button variant="primary" disabled={!supplier} onClick={() => void create()}>{tr('Create draft')}</Button></>}>
      {s.suppliers.length === 0 ? (
        <p className="text-[13px] text-ink-3">{tr('Add a supplier first, in Suppliers.')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label={tr('Supplier')}>
            <Select value={supplier} onChange={setSupplier} options={s.suppliers.map((x) => ({ value: x.id, label: x.name, hint: tr('{0}-day lead time · min {1}', x.leadTimeDays, eur(x.minOrderValue, { decimals: 0 })) }))} />
          </Field>
          <Field label={tr('Deliver to')}>
            <Select value={location} onChange={setLocation} options={s.locations.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
          <p className="text-[12.5px] text-ink-3">{tr('Next you can add lines — or let Nau fill them from demand with one click.')}</p>
        </div>
      )}
    </Modal>
  )
}
