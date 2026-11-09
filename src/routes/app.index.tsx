import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CheckIcon, CopyIcon, DotsThreeIcon, PencilSimpleIcon, PlusIcon, SlidersHorizontalIcon, SparkleIcon, TrashIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { saveDashboard } from '~/data/commands'
import { defaultDashboards } from '~/lib/seed'
import { date, greeting } from '~/lib/format'
import { uid, cn } from '~/lib/utils'
import type { Dashboard } from '~/lib/types'
import { Button } from '~/components/ui/button'
import { Menu, Modal } from '~/components/ui/overlay'
import { Input } from '~/components/ui/form'
import { DashboardGrid, WidgetGallery } from '~/components/dashboard/grid'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { useUI } from '~/stores/ui'
import { useOperator } from '~/agent/operator'
import { Mark } from '~/components/brand/logo'

export const Route = createFileRoute('/app/')({
  validateSearch: (s: Record<string, unknown>): { welcome?: number } => (s.welcome ? { welcome: 1 } : {}),
  component: Home,
})

function Home() {
  usePageTitle('Home')
  const s = useSnapshot()
  const { commit, canWrite, actor } = useActions()
  const navigate = useNavigate()
  const { welcome } = Route.useSearch()
  const { dashboardId, set, editingDashboard: editing } = useUI()
  const [gallery, setGallery] = useState(false)
  const [renaming, setRenaming] = useState<Dashboard | null>(null)
  const dashboards = [...s.dashboards].sort((a, b) => a.position - b.position)
  const dash = dashboards.find((d) => d.id === dashboardId) ?? dashboards[0]
  useEffect(() => () => set({ editingDashboard: false }), [set])

  const save = (d: Dashboard) => void commit(saveDashboard(d))
  const addDashboard = () => {
    const d: Dashboard = { id: uid(), name: `Dashboard ${dashboards.length + 1}`, position: dashboards.length, widgets: [] }
    void commit(saveDashboard(d))
    set({ dashboardId: d.id, editingDashboard: true })
    setGallery(true)
  }

  const first = actor.name.split(' ')[0]
  const pending = s.proposals.filter((p) => p.status === 'pending').length
  const active = dash
  return (
    <div className="flex flex-col">
      <div className="px-5 pt-7 pb-2 md:px-8 md:pt-9">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h1 className="text-[clamp(1.55rem,2.4vw,2rem)] leading-[1.1] font-medium tracking-[-0.035em] text-ink">
              {greeting()}
              {first && first !== 'Guest' && first !== 'You' ? `, ${first}` : ''}
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-3">
              <span>{date(new Date(), 'long')}</span>
              <span className="text-ink-4" aria-hidden>·</span>
              <span>{s.workspace.name}</span>
              {pending > 0 && (
                <>
                  <span className="text-ink-4" aria-hidden>·</span>
                  <button type="button" onClick={() => void navigate({ to: '/app/approvals' })} className="text-ink-2 underline decoration-[var(--gray-a6)] underline-offset-[3px] hover:text-ink">
                    {pending} waiting for you
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {editing && canWrite && (
              <Button size="md" icon={<PlusIcon size={14} />} onClick={() => setGallery(true)}>
                Add widget
              </Button>
            )}
            {canWrite && (
              <Button size="md" variant={editing ? 'primary' : 'secondary'} icon={editing ? <CheckIcon size={14} /> : <SlidersHorizontalIcon size={14} />} onClick={() => set({ editingDashboard: !editing })}>
                {editing ? 'Done' : 'Customise'}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          <div className="inline-flex items-center gap-0.5 rounded-[10px] bg-hover p-[3px]" role="tablist" aria-label="Dashboards">
            {dashboards.map((d) => (
              <button
                key={d.id}
                role="tab"
                aria-selected={d.id === active?.id}
                onClick={() => set({ dashboardId: d.id })}
                className={cn('h-7 rounded-[7px] px-3 text-[12.5px] whitespace-nowrap transition-colors duration-100', d.id === active?.id ? 'bg-surface font-medium text-ink shadow-card' : 'text-ink-3 hover:text-ink')}
              >
                {d.name}
              </button>
            ))}
          </div>
          {active && canWrite && (
            <Menu
              triggerClassName="flex size-7 items-center justify-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
              trigger={<DotsThreeIcon size={15} weight="bold" />}
              align="start"
              items={[
                { label: 'Rename', icon: <PencilSimpleIcon size={14} />, onSelect: () => setRenaming(active) },
                {
                  label: 'Duplicate',
                  icon: <CopyIcon size={14} />,
                  onSelect: () => {
                    const copy: Dashboard = { ...active, id: uid(), name: `${active.name} copy`, position: dashboards.length, widgets: active.widgets.map((w) => ({ ...w, id: uid() })) }
                    void commit(saveDashboard(copy), { success: 'Dashboard duplicated' })
                    set({ dashboardId: copy.id })
                  },
                },
                {
                  label: 'Reset to template',
                  icon: <ArrowCounterClockwiseIcon size={14} />,
                  onSelect: () => {
                    const tpl = defaultDashboards()[active.position === 1 ? 1 : 0]
                    save({ ...active, widgets: tpl.widgets.map((w) => ({ ...w, id: uid() })) })
                  },
                },
                { separator: true, label: '' },
                {
                  label: 'Delete',
                  icon: <TrashIcon size={14} />,
                  danger: true,
                  disabled: dashboards.length < 2,
                  onSelect: () => {
                    void commit({ removes: { dashboards: [active.id] } }, { success: `Deleted “${active.name}”`, undo: { upserts: { dashboards: [active] } } })
                    set({ dashboardId: dashboards.find((x) => x.id !== active.id)?.id ?? null })
                  },
                },
              ]}
            />
          )}
          {canWrite && (
            <button type="button" onClick={addDashboard} className="flex h-7 items-center gap-1 rounded-[8px] px-2 text-[12.5px] text-ink-3 hover:bg-hover hover:text-ink" aria-label="New dashboard">
              <PlusIcon size={13} /> New
            </button>
          )}
        </div>
      </div>

      <div className="px-3 pt-3 pb-6 md:px-6 md:pb-8">
        {dash && dash.widgets.length > 0 ? (
          <DashboardGrid dashboard={dash} editing={editing} onChange={save} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <SparkleIcon size={22} className="text-accent" />
            <p className="text-[15px] font-medium text-ink">An empty canvas</p>
            <p className="max-w-sm text-[13px] text-ink-3">Add widgets from the gallery, or ask Operator: “add a widget with this week’s sales”.</p>
            <Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => (set({ editingDashboard: true }), setGallery(true))}>
              Add widgets
            </Button>
          </div>
        )}
      </div>

      {dash && <WidgetGallery open={gallery} onOpenChange={setGallery} dashboard={dash} onAdd={(d) => (save(d), setGallery(false))} />}
      {renaming && <RenameDialog d={renaming} onClose={() => setRenaming(null)} onSave={(name) => (save({ ...renaming, name }), setRenaming(null))} />}
      {welcome && <Welcome onClose={() => void navigate({ to: '/app', search: {}, replace: true })} />}
    </div>
  )
}

function RenameDialog({ d, onClose, onSave }: { d: Dashboard; onClose: () => void; onSave: (n: string) => void }) {
  const [name, setName] = useState(d.name)
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Rename dashboard" size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => name.trim() && onSave(name.trim())}>Save</Button></>}>
      <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())} autoFocus aria-label="Dashboard name" />
    </Modal>
  )
}

function Welcome({ onClose }: { onClose: () => void }) {
  const s = useSnapshot()
  const empty = s.items.length === 0
  const steps = empty
    ? [
        ['Add your first items', 'Import a spreadsheet in Insights, or scan barcodes as deliveries arrive.', '/app/items?new=1'],
        ['Add your suppliers', 'Lead times and minimum orders let Nau size every order.', '/app/suppliers'],
        ['Do a first count', 'Five minutes per shelf, on your phone.', '/app/counts'],
      ]
    : [
        ['Review what autopilot found', 'Suggestions are waiting in Approvals.', '/app/approvals'],
        ['Ask Operator anything', 'Press ⌘J — try “what’s running low?”.', ''],
        ['Make the dashboard yours', 'Customise, drag, resize — or describe a widget.', ''],
      ]
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Your workspace is ready" description={`${s.workspace.name} is set up. Three good places to start:`} footer={<Button variant="primary" onClick={onClose}>Let’s go</Button>}>
      <ol className="flex flex-col gap-2">
        {steps.map(([t, b, to], i) => (
          <li key={t}>
            <button
              type="button"
              onClick={() => {
                onClose()
                if (to) window.location.assign(to)
                else if (i === 1) useOperator.getState().setOpen(true)
              }}
              className="flex w-full items-start gap-3 rounded-[12px] bg-surface p-3 text-left shadow-card hover:bg-surface-2"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-[11px] text-accent-ink">{i + 1}</span>
              <span>
                <span className="block text-[13.5px] font-medium text-ink">{t}</span>
                <span className="block text-[12.5px] text-ink-3">{b}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-4">
        <Mark size={12} /> Tip: ⌘K finds anything. ⌘J opens Operator.
      </div>
    </Modal>
  )
}
