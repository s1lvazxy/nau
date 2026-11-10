import { useMemo, useState } from 'react'
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout } from 'react-grid-layout'
import { MagicWandIcon } from '@phosphor-icons/react'
import type { Dashboard, Widget, WidgetType } from '~/lib/types'
import { uid } from '~/lib/utils'
import { useSnapshot } from '~/data/store'
import { Button } from '~/components/ui/button'
import { Field as FormField, Input, Select } from '~/components/ui/form'
import { Modal, Sheet } from '~/components/ui/overlay'
import { placeWidget, executeTool } from '~/agent/executors'
import { planOffline } from '~/agent/offline'
import { useActions } from '~/components/app/actions'
import { KPI_METRICS, WIDGET_DEFS, WidgetBody, WidgetFrame, widgetAction } from './widgets'
import { tr } from '~/i18n'

const ROW = 48
const GAP: [number, number] = [14, 14]

export function DashboardGrid({ dashboard, editing, onChange }: { dashboard: Dashboard; editing: boolean; onChange: (d: Dashboard) => void }) {
  const { width, containerRef, mounted } = useContainerWidth()
  const s = useSnapshot()
  const { navigate } = useActions()
  const [configuring, setConfiguring] = useState<Widget | null>(null)
  const cols = width >= 900 ? 12 : width >= 600 ? 6 : 1

  const layout: Layout = useMemo(() => {
    const sorted = [...dashboard.widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
    if (cols === 12)
      return sorted.map((w) => ({ i: w.id, ...w.layout, minW: WIDGET_DEFS[w.type].min[0], minH: WIDGET_DEFS[w.type].min[1] }))
    let y = 0
    let x = 0
    let rowH = 0
    return sorted.map((w) => {
      const ww = cols === 1 ? 1 : Math.min(cols, Math.max(3, Math.round(w.layout.w / 2)))
      if (x + ww > cols) {
        x = 0
        y += rowH
        rowH = 0
      }
      const item = { i: w.id, x, y, w: ww, h: w.layout.h, static: true }
      x += ww
      rowH = Math.max(rowH, w.layout.h)
      return item
    })
  }, [dashboard.widgets, cols])

  const update = (w: Widget) => onChange({ ...dashboard, widgets: dashboard.widgets.map((x) => (x.id === w.id ? w : x)) })
  const remove = (id: string) => onChange({ ...dashboard, widgets: dashboard.widgets.filter((x) => x.id !== id) })

  return (
    <div ref={containerRef as React.RefObject<HTMLDivElement>} className="w-full" data-editing={editing ? 'true' : 'false'}>
      {mounted && width > 0 && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols, rowHeight: ROW, margin: GAP, containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing && cols === 12, handle: '.drag-handle', threshold: 4 }}
          resizeConfig={{ enabled: editing && cols === 12, handles: ['se'] }}
          compactor={verticalCompactor}
          onLayoutChange={(next) => {
            if (!editing || cols !== 12) return
            const byId = new Map(next.map((l) => [l.i, l]))
            let changed = false
            const widgets = dashboard.widgets.map((w) => {
              const l = byId.get(w.id)
              if (!l) return w
              if (l.x !== w.layout.x || l.y !== w.layout.y || l.w !== w.layout.w || l.h !== w.layout.h) changed = true
              return { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } }
            })
            if (changed) onChange({ ...dashboard, widgets })
          }}
        >
          {dashboard.widgets.map((w) => {
            const def = WIDGET_DEFS[w.type]
            return (
              <div key={w.id}>
                <WidgetFrame
                  title={w.title || def.title(w, s)}
                  editing={editing}
                  onRemove={() => remove(w.id)}
                  onConfigure={() => setConfiguring(w)}
                  action={widgetAction(w, navigate)}
                  bodyClassName={w.type === 'kpi' ? 'overflow-visible pb-3.5' : undefined}
                  compact={w.type === 'kpi'}
                >
                  <WidgetBody w={w} onChange={update} />
                </WidgetFrame>
              </div>
            )
          })}
        </ReactGridLayout>
      )}
      {configuring && <WidgetSettings widget={configuring} onClose={() => setConfiguring(null)} onSave={(w) => (update(w), setConfiguring(null))} />}
    </div>
  )
}

function WidgetSettings({ widget, onClose, onSave }: { widget: Widget; onClose: () => void; onSave: (w: Widget) => void }) {
  const s = useSnapshot()
  const [w, setW] = useState(widget)
  const def = WIDGET_DEFS[w.type]
  const set = (k: string, v: unknown) => setW({ ...w, config: { ...w.config, [k]: v } })
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={tr('{0} settings', def.name)}
      description={def.description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tr('Cancel')}
          </Button>
          <Button variant="primary" onClick={() => onSave(w)}>
            {tr('Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label={tr('Title')} optional>
          <Input value={w.title ?? ''} placeholder={def.title(widget, s)} onChange={(e) => setW({ ...w, title: e.target.value || undefined })} />
        </FormField>
        {w.type === 'kpi' && (
          <FormField label={tr('Metric')}>
            <Select value={String(w.config.metric ?? 'stockValue')} onChange={(v) => set('metric', v)} options={KPI_METRICS} />
          </FormField>
        )}
        {w.type === 'salesTrend' && (
          <FormField label={tr('Period')}>
            <Select
              value={Number(w.config.days ?? 30)}
              onChange={(v) => set('days', v)}
              options={[
                { value: 14, label: tr('14 days') },
                { value: 30, label: tr('30 days') },
                { value: 60, label: tr('60 days') },
                { value: 90, label: tr('90 days') },
              ]}
            />
          </FormField>
        )}
        {w.type === 'itemForecast' && (
          <FormField label={tr('Item')}>
            <Select value={String(w.config.itemId ?? '')} onChange={(v) => set('itemId', v)} options={s.items.filter((i) => !i.archived).map((i) => ({ value: i.id, label: i.name }))} />
          </FormField>
        )}
        {w.type === 'lowStock' && (
          <FormField label={tr('Location')}>
            <Select value={String(w.config.locationId ?? 'all')} onChange={(v) => set('locationId', v === 'all' ? undefined : v)} options={[{ value: 'all', label: tr('All locations') }, ...s.locations.map((l) => ({ value: l.id, label: l.name }))]} />
          </FormField>
        )}
      </div>
    </Modal>
  )
}

export function WidgetGallery({ open, onOpenChange, dashboard, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; dashboard: Dashboard; onAdd: (d: Dashboard) => void }) {
  const s = useSnapshot()
  const { actor, canWrite } = useActions()
  const [prompt, setPrompt] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const add = (type: WidgetType, config: Record<string, unknown> = {}) => {
    const w: Widget = { id: uid(), type, config: type === 'kpi' && !config.metric ? { metric: 'revenue7' } : config, layout: placeWidget(dashboard.widgets, type) }
    onAdd({ ...dashboard, widgets: [...dashboard.widgets, w] })
  }
  const ask = () => {
    const text = prompt.trim()
    if (!text) return
    const plan = planOffline(s, /widget|dashboard/i.test(text) ? text : `add a widget ${text}`)
    const call = plan.calls.find((c) => c.name === 'add_widget')
    if (!call) {
      setHint(tr('Try something like “sales trend for 60 days” or “stock value number”.'))
      return
    }
    const res = executeTool('add_widget', { ...call.input, dashboard: dashboard.name }, { snapshot: { ...s, dashboards: s.dashboards.map((d) => (d.id === dashboard.id ? dashboard : d)) }, actor, canWrite, dashboardId: dashboard.id })
    const next = res.apply?.upserts?.dashboards?.[0]
    if (next) {
      onAdd(next)
      setPrompt('')
      setHint(tr('Added — {0}.', res.summary.toLowerCase()))
    }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tr('Add widgets')} description={tr('Click to add. Drag the header to move, the corner to resize.')} width={420}>
      <div className="flex flex-col gap-5 p-5">
        <div className="rounded-[14px] bg-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--gray-a3)]">
          <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
            <MagicWandIcon size={14} className="text-accent" /> {tr('Describe a widget')}
          </div>
          <div className="flex gap-2">
            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} placeholder={tr('e.g. sales trend for 60 days')} />
            <Button variant="primary" onClick={ask}>
              {tr('Add')}
            </Button>
          </div>
          {hint && <p className="mt-2 text-[12px] text-ink-3">{hint}</p>}
        </div>
        <ul className="grid grid-cols-1 gap-2">
          {Object.values(WIDGET_DEFS).map((d) => {
            const Icon = d.icon
            return (
              <li key={d.type}>
                <button type="button" onClick={() => add(d.type)} className="press flex w-full items-center gap-3 rounded-[12px] bg-surface p-3 text-left shadow-card hover:bg-surface-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-hover text-ink">
                    <Icon size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{d.name}</span>
                    <span className="block text-[12px] text-ink-3">{d.description}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Sheet>
  )
}
