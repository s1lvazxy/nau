import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowLeftIcon, BarcodeIcon, CheckIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { closeCount, onHandAt, saveCount } from '~/data/commands'
import { eur, qty as fmtQty } from '~/lib/format'
import { cn, fuzzyScore, indexBy, round } from '~/lib/utils'
import type { Count } from '~/lib/types'
import { Button } from '~/components/ui/button'
import { Input, NumberInput } from '~/components/ui/form'
import { Badge, Empty, ItemSwatch } from '~/components/ui/primitives'
import { Modal } from '~/components/ui/overlay'
import { Scanner } from '~/components/app/scanner'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { tr } from '~/i18n'

export const Route = createFileRoute('/app/counts/$countId')({ component: CountPage })

function CountPage() {
  const { countId } = Route.useParams()
  const s = useSnapshot()
  const { commit, actor, canWrite, navigate } = useActions()
  const saved = s.counts.find((c) => c.id === countId)
  usePageTitle(saved?.name ?? tr('Count'))
  const [count, setCount] = useState<Count | undefined>(saved)
  const [q, setQ] = useState('')
  const [scan, setScan] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const items = indexBy(s.items, (i) => i.id)
  const loc = s.locations.find((l) => l.id === count?.locationId)
  const lines = useMemo(() => (count ? count.lines.filter((l) => !q || fuzzyScore(q, items[l.itemId]?.name ?? '') || items[l.itemId]?.sku.toLowerCase().includes(q.toLowerCase())) : []), [count, q, items])
  if (!count || !saved) return <Empty title={tr('Count not found')} />
  const readOnly = count.status === 'closed' || !canWrite
  const done = count.lines.filter((l) => l.counted != null).length
  const setLine = (itemId: string, counted: number | null) => setCount((c) => (c ? { ...c, lines: c.lines.map((l) => (l.itemId === itemId ? { ...l, counted } : l)) } : c))
  const persist = (c: Count) => void commit(saveCount(c))
  const variances = count.lines
    .filter((l) => l.counted != null)
    .map((l) => {
      const live = count.status === 'closed' ? l.expected : onHandAt(s, l.itemId, count.locationId)
      return { l, live, diff: round((l.counted ?? 0) - live, 3), value: round(((l.counted ?? 0) - live) * (items[l.itemId]?.cost ?? 0)) }
    })
    .filter((v) => v.diff !== 0)
  const varianceValue = round(variances.reduce((a, v) => a + v.value, 0))
  const onScan = (code: string) => {
    const it = s.items.find((i) => i.barcode === code || i.sku.toLowerCase() === code.toLowerCase())
    if (!it) return toast.error(tr('Not in this count'), { description: code })
    const line = count.lines.find((l) => l.itemId === it.id)
    if (!line) {
      const next = { ...count, lines: [...count.lines, { itemId: it.id, expected: onHandAt(s, it.id, count.locationId), counted: 1 }] }
      setCount(next)
      toast(tr('Added {0}', it.name), { duration: 1200 })
      return
    }
    setLine(it.id, (line.counted ?? 0) + 1)
    setFocus(it.id)
    toast(`${it.name}: ${(line.counted ?? 0) + 1}`, { duration: 1000 })
  }
  return (
    <div className="pb-12">
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-line bg-panel/90 px-5 pt-5 pb-4 backdrop-blur md:px-8">
        <Link to="/app/counts" className="flex w-fit items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink">
          <ArrowLeftIcon size={12} /> {tr('Counts')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-ink">{count.name}</h1>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              {(count.blind && count.status === 'open' ? tr('{0} · {1}/{2} counted · blind', loc?.name, done, count.lines.length) : tr('{0} · {1}/{2} counted ', loc?.name, done, count.lines.length))}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && (
              <>
                <Button icon={<BarcodeIcon size={14} />} onClick={() => setScan((x) => !x)}>
                  {scan ? tr('Hide scanner') : tr('Scan')}
                </Button>
                {count.status === 'open' ? (
                  <Button
                    variant="primary"
                    disabled={!done}
                    onClick={() => {
                      const next = { ...count, status: 'review' as const }
                      setCount(next)
                      persist(next)
                    }}
                  >
                    {tr('Review')}
                  </Button>
                ) : (
                  <Button variant="primary" icon={<CheckIcon size={14} />} onClick={() => setClosing(true)}>
                    {tr('Close & post')}
                  </Button>
                )}
              </>
            )}
            {count.status === 'closed' && <Badge tone="ok" dot>{tr('Closed')}</Badge>}
          </div>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-hover">
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(done / Math.max(1, count.lines.length)) * 100}%` }} />
        </div>
      </div>

      <div className="mx-auto flex max-w-[760px] flex-col gap-4 px-5 py-5 md:px-8">
        {scan && <Scanner onDetect={onScan} compact />}
        {count.status !== 'open' && (
          <div className="rounded-[14px] bg-surface-2 p-4 shadow-[inset_0_0_0_1px_var(--gray-a3)]">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-ink">{variances.length ? (variances.length > 1 ? tr('{0} differences', variances.length) : tr('{0} difference', variances.length)) : tr('Everything matches')}</span>
              <span className={cn('tabular text-[15px] font-semibold', varianceValue < 0 ? 'text-bad-ink' : varianceValue > 0 ? 'text-ok-ink' : 'text-ink')}>{eur(varianceValue)}</span>
            </div>
            <p className="mt-1 text-[12px] text-ink-3">{tr('Compared against live stock now, so sales made during the count are accounted for.')}</p>
          </div>
        )}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Find an item in this count')} aria-label={tr('Filter items')} />
        <ul className="flex flex-col gap-2">
          {lines.map((l) => {
            const it = items[l.itemId]
            if (!it) return null
            const live = onHandAt(s, l.itemId, count.locationId)
            const showExpected = !count.blind || count.status !== 'open'
            const diff = l.counted != null ? round(l.counted - (count.status === 'closed' ? l.expected : live), 3) : 0
            return (
              <li key={l.itemId} className={cn('flex items-center gap-3 rounded-[14px] bg-surface p-3 shadow-card transition-shadow', focus === l.itemId && 'shadow-[0_0_0_2px_var(--accent-9)]')}>
                <ItemSwatch name={it.name} hue={it.hue} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] text-ink">{it.name}</div>
                  <div className="text-[11.5px] text-ink-3">
                    <span className="font-mono">{it.sku}</span>
                    {showExpected && <> {tr('· expected {0}', fmtQty(count.status === 'closed' ? l.expected : live, it.unit))}</>}
                    {l.counted != null && diff !== 0 && showExpected && <span className={diff < 0 ? 'text-bad-ink' : 'text-ok-ink'}> · {diff > 0 ? '+' : ''}{diff}</span>}
                  </div>
                </div>
                {readOnly ? (
                  <span className="tabular text-[15px] font-medium text-ink">{l.counted ?? '—'}</span>
                ) : (
                  <div className="flex items-center gap-1">
                    <button type="button" aria-label={tr('Minus one')} onClick={() => setLine(l.itemId, Math.max(0, (l.counted ?? 0) - 1))} className="press flex size-9 items-center justify-center rounded-full bg-hover text-ink">
                      <MinusIcon size={14} />
                    </button>
                    <NumberInput value={l.counted ?? null} min={0} onChange={(v) => setLine(l.itemId, v)} onBlur={() => persist(count)} placeholder="—" className="h-9 w-16 text-center text-[15px]" aria-label={tr('Counted {0}', it.name)} />
                    <button type="button" aria-label={tr('Plus one')} onClick={() => setLine(l.itemId, (l.counted ?? 0) + 1)} className="press flex size-9 items-center justify-center rounded-full bg-ink text-inverse">
                      <PlusIcon size={14} />
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {!readOnly && count.status === 'open' && (
          <Button variant="ghost" onClick={() => persist(count)}>
            {tr('Save progress')}
          </Button>
        )}
      </div>

      {closing && (
        <Modal
          open
          onOpenChange={setClosing}
          title={tr('Close this count?')}
          description={variances.length ? (variances.length > 1 ? tr('{0} differences worth {1} will be posted to the ledger.', variances.length, eur(varianceValue)) : tr('{0} difference worth {1} will be posted to the ledger.', variances.length, eur(varianceValue))) : tr('Everything matches — the count closes with no changes.')}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setClosing(false)}>
                {tr('Keep reviewing')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  void commit(closeCount(s, count, actor), { success: tr('Count closed'), description: variances.length ? tr('{0} corrections posted', variances.length) : tr('No differences') })
                  setClosing(false)
                  navigate('/app/counts')
                }}
              >
                {tr('Close & post')}
              </Button>
            </>
          }
        >
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {variances.slice(0, 8).map((v) => (
              <li key={v.l.itemId} className="flex justify-between">
                <span className="truncate text-ink-2">{items[v.l.itemId]?.name}</span>
                <span className={cn('tabular', v.diff < 0 ? 'text-bad-ink' : 'text-ok-ink')}>
                  {v.diff > 0 ? '+' : ''}
                  {v.diff} · {eur(v.value)}
                </span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  )
}
