import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ClipboardTextIcon, PlusIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { startCount } from '~/data/commands'
import { derive } from '~/lib/analytics'
import { eur, relative } from '~/lib/format'
import { indexBy } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import { Field, Input, Segmented, Select, Switch } from '~/components/ui/form'
import { Modal } from '~/components/ui/overlay'
import { Badge, Empty, PageHeader } from '~/components/ui/primitives'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { tr } from '~/i18n'

export const Route = createFileRoute('/app/counts/')({ component: Counts })

function Counts() {
  usePageTitle(tr('Counts'))
  const s = useSnapshot()
  const navigate = useNavigate()
  const { canWrite } = useActions()
  const [open, setOpen] = useState(false)
  const loc = indexBy(s.locations, (l) => l.id)
  const items = indexBy(s.items, (i) => i.id)
  return (
    <div>
      <PageHeader
        title={tr('Counts')}
        description={tr('Blind counts on your phone. Nau compares against live stock and posts only the difference.')}
        actions={
          canWrite && (
            <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setOpen(true)}>
              {tr('New count')}
            </Button>
          )
        }
      />
      <div className="px-5 py-6 md:px-8">
        {s.counts.length === 0 ? (
          <Empty icon={<ClipboardTextIcon size={20} />} title={tr('No counts yet')}>
            {tr('Start small — one shelf, ten minutes. Autopilot suggests which items to count first.')}
          </Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {s.counts.map((c) => {
              const done = c.lines.filter((l) => l.counted != null).length
              const variance = c.lines.reduce((a, l) => a + (l.counted == null ? 0 : (l.counted - l.expected) * (items[l.itemId]?.cost ?? 0)), 0)
              return (
                <button key={c.id} type="button" onClick={() => void navigate({ to: '/app/counts/$countId', params: { countId: c.id } })} className="press flex flex-col gap-3 rounded-[14px] bg-surface p-4 text-left shadow-card hover:bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium text-ink">{c.name}</div>
                      <div className="text-[12px] text-ink-3">
                        {loc[c.locationId]?.name} · {relative(c.closedAt ?? c.createdAt)}
                      </div>
                    </div>
                    <Badge tone={c.status === 'closed' ? 'ok' : c.status === 'review' ? 'warn' : 'info'} dot>
                      {c.status === 'closed' ? tr('Closed') : c.status === 'review' ? tr('In review') : tr('Counting')}
                    </Badge>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-hover">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(done / Math.max(1, c.lines.length)) * 100}%` }} />
                  </div>
                  <div className="flex justify-between text-[12px] text-ink-3">
                    <span>
                      {(c.blind ? tr('{0}/{1} counted · blind', done, c.lines.length) : tr('{0}/{1} counted', done, c.lines.length))}
                    </span>
                    {done > 0 && <span className={variance < 0 ? 'text-bad-ink' : variance > 0 ? 'text-ok-ink' : ''}>{eur(variance)}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
      {open && <NewCount onClose={() => setOpen(false)} />}
    </div>
  )
}

function NewCount({ onClose }: { onClose: () => void }) {
  const s = useSnapshot()
  const { commit, actor, navigate } = useActions()
  const [location, setLocation] = useState(s.locations.find((l) => l.kind === 'store')?.id ?? s.locations[0].id)
  const [scope, setScope] = useState<'suggested' | 'category' | 'all'>('suggested')
  const [category, setCategory] = useState(s.categories[0]?.id ?? '')
  const [blind, setBlind] = useState(true)
  const [name, setName] = useState('')
  const stats = derive(s).stats
  const ids =
    scope === 'all'
      ? stats.filter((x) => (x.byLocation[location] ?? 0) > 0).map((x) => x.item.id)
      : scope === 'category'
        ? s.items.filter((i) => i.categoryId === category && !i.archived).map((i) => i.id)
        : stats
            .filter((x) => (x.byLocation[location] ?? 0) > 0)
            .sort((a, b) => (a.abc < b.abc ? -1 : a.abc > b.abc ? 1 : b.value - a.value))
            .slice(0, 12)
            .map((x) => x.item.id)
  const create = async () => {
    const l = s.locations.find((x) => x.id === location)
    const { cs, count } = startCount(s, { name: name || `${l?.name} — ${scope === 'category' ? s.categories.find((c) => c.id === category)?.name : scope === 'all' ? tr('full count') : tr('spot count')}`, locationId: location, itemIds: ids, blind }, actor)
    await commit(cs)
    onClose()
    navigate(`/app/counts/${count.id}`)
  }
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={tr('New count')} footer={<><Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button variant="primary" disabled={!ids.length} onClick={() => void create()}>{tr('Start count · {0} items', ids.length)}</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label={tr('Location')}>
          <Select value={location} onChange={setLocation} options={s.locations.map((l) => ({ value: l.id, label: l.name }))} />
        </Field>
        <Field label={tr('What to count')}>
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'suggested', label: tr('Most valuable') },
              { value: 'category', label: tr('A category') },
              { value: 'all', label: tr('Everything here') },
            ]}
          />
        </Field>
        {scope === 'category' && (
          <Field label={tr('Category')}>
            <Select value={category} onChange={setCategory} options={s.categories.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
        )}
        <Field label={tr('Name')} optional>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Back room, top shelves')} />
        </Field>
        <Switch checked={blind} onChange={setBlind} label={tr('Blind count')} description={tr('Hide the expected quantity while counting — the honest way to count.')} />
      </div>
    </Modal>
  )
}
