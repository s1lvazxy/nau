import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowsLeftRightIcon, CheckIcon, ClipboardTextIcon, CompassIcon, PackageIcon, SnowflakeIcon, TrendUpIcon, TruckIcon, XIcon } from '@phosphor-icons/react'
import { useSnapshot } from '~/data/store'
import { approveProposal, dismissProposal } from '~/data/commands'
import { autopilotPass } from '~/agent/autopilot'
import { approveAction, rejectAction, undoAction } from '~/agent/policy'
import { ActionCard } from '~/components/operator/chat'
import { eur, qty as fmtQty, relative } from '~/lib/format'
import { indexBy, round } from '~/lib/utils'
import type { Proposal } from '~/lib/types'
import { Button } from '~/components/ui/button'
import { Badge, Empty, PageHeader } from '~/components/ui/primitives'
import { NumberInput, Segmented } from '~/components/ui/form'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { Mark } from '~/components/brand/logo'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/app/approvals')({ component: Approvals })

const KIND: Record<Proposal['kind'], { label: string; icon: React.ReactNode; tone: 'accent' | 'info' | 'warn' | 'violet' | 'ok' | 'neutral' }> = {
  reorder: { label: 'Reorder', icon: <TruckIcon size={16} />, tone: 'accent' },
  transfer: { label: 'Transfer', icon: <ArrowsLeftRightIcon size={16} />, tone: 'info' },
  markdown: { label: 'Expiry', icon: <SnowflakeIcon size={16} />, tone: 'warn' },
  deadstock: { label: 'Dead stock', icon: <PackageIcon size={16} />, tone: 'violet' },
  count: { label: 'Count', icon: <ClipboardTextIcon size={16} />, tone: 'ok' },
  price: { label: 'Price', icon: <TrendUpIcon size={16} />, tone: 'warn' },
}

type Tab = 'pending' | 'done' | 'resolved'

function Approvals() {
  usePageTitle('Approvals')
  const s = useSnapshot()
  const { commit, canWrite, actor } = useActions()
  const [tab, setTab] = useState<Tab>('pending')
  const pending = s.proposals.filter((p) => p.status === 'pending').sort((a, b) => (b.impactEur ?? 0) - (a.impactEur ?? 0))
  const resolved = s.proposals.filter((p) => p.status !== 'pending').sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '')).slice(0, 50)
  const byTime = [...s.actions].sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt))
  const waiting = byTime.filter((a) => a.status === 'pending')
  // What ran without a person: Operator, autopilot, rules and connected systems
  const alone = byTime.filter((a) => a.status === 'applied' && !a.approvedBy).slice(0, 60)
  const closed = byTime.filter((a) => a.status === 'rejected' || a.status === 'undone' || (a.status === 'applied' && a.approvedBy)).slice(0, 40)
  const lastRun = s.playbooks.map((p) => p.lastRunAt).filter(Boolean).sort().pop()
  const card = (a: (typeof byTime)[number]) => (
    <div key={a.id}>
      <ActionCard action={a} onApprove={() => canWrite && void commit(approveAction(s, a, actor), { success: 'Approved', description: a.title })} onReject={() => canWrite && void commit(rejectAction(a, actor), { success: 'Dismissed' })} onUndo={canWrite ? () => void commit(undoAction(s, a, actor), { success: 'Undone', description: a.title }) : undefined} />
      <p className="mt-1.5 px-1 text-[11.5px] text-ink-4">
        {a.actor.name} · {relative(a.resolvedAt ?? a.createdAt)}
        {a.status !== 'pending' && a.reason ? ` · ${a.reason}` : ''}
      </p>
    </div>
  )
  const count = { pending: waiting.length + pending.length, done: alone.length, resolved: closed.length + resolved.length }
  return (
    <div>
      <PageHeader
        title="Approvals"
        description={`Autopilot checked everything ${lastRun ? relative(lastRun) : 'recently'}. What needs you is here; what Operator did alone is one click from undone.`}
        actions={
          canWrite && (
            <Button icon={<CompassIcon size={14} />} onClick={() => void commit(autopilotPass(s), { success: 'Autopilot ran', description: 'Checked stock, demand, lots and prices.' })}>
              Run autopilot now
            </Button>
          )
        }
      >
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pending', label: `Waiting · ${count.pending}` },
            { value: 'done', label: `Done alone · ${count.done}` },
            { value: 'resolved', label: 'History' },
          ]}
        />
      </PageHeader>
      <div className="mx-auto flex max-w-[860px] flex-col gap-3 px-5 py-6 md:px-8">
        {count[tab] === 0 ? (
          <Empty icon={<CheckIcon size={20} />} title={tab === 'pending' ? 'All clear' : tab === 'done' ? 'Nothing yet' : 'Nothing here yet'}>
            {tab === 'pending' ? 'Every item is covered, nothing is about to expire and no prices moved. Autopilot checks again every hour.' : tab === 'done' ? 'When Operator, a rule or a connected system changes something on its own, it is listed here with an Undo.' : 'Approved, dismissed and undone work appears here.'}
          </Empty>
        ) : tab === 'pending' ? (
          <>
            {waiting.map(card)}
            {pending.map((p) => (
              <ProposalCard key={p.id} p={p} />
            ))}
          </>
        ) : tab === 'done' ? (
          alone.map(card)
        ) : (
          <>
            {closed.map(card)}
            {resolved.map((p) => (
              <ProposalCard key={p.id} p={p} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function ProposalCard({ p }: { p: Proposal }) {
  const s = useSnapshot()
  const { commit, actor, canWrite } = useActions()
  const navigate = useNavigate()
  const items = indexBy(s.items, (x) => x.id)
  const locations = indexBy(s.locations, (x) => x.id)
  const k = KIND[p.kind]
  const payload = p.payload as Record<string, unknown>
  const [lines, setLines] = useState(() => (payload.lines as { itemId: string; qty: number; unitCost: number }[] | undefined) ?? null)
  const total = lines ? round(lines.reduce((a, l) => a + l.qty * l.unitCost, 0)) : p.impactEur
  const approve = async (send = false) => {
    const prop = lines ? { ...p, payload: { ...payload, lines: lines.filter((l) => l.qty > 0) } } : p
    const r = approveProposal(s, prop, actor, { send })
    await commit(r.cs, { success: r.message, description: r.link ? 'Open it from Orders or Counts.' : undefined })
    if (r.link && p.kind === 'count') void navigate({ to: r.link })
  }
  const dismiss = () => void commit(dismissProposal(p), { success: 'Dismissed', undo: { upserts: { proposals: [p] } } })
  return (
    <article className={cn('overflow-hidden rounded-[16px] bg-surface shadow-card', p.status !== 'pending' && 'opacity-70')}>
      <div className="flex gap-4 p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-hover text-ink">{k.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={k.tone}>{k.label}</Badge>
            {p.source === 'operator' && (
              <Badge tone="neutral">
                <Mark size={10} /> Operator
              </Badge>
            )}
            <span className="text-[12px] text-ink-4">{relative(p.createdAt)}</span>
            {p.status !== 'pending' && <Badge tone={p.status === 'approved' ? 'ok' : 'muted'}>{p.status === 'approved' ? 'Approved' : 'Dismissed'}</Badge>}
          </div>
          <h2 className="mt-2 text-[15px] font-medium tracking-[-0.01em] text-ink">{p.title}</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">{p.summary}</p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {p.rationale.map((r) => (
              <li key={r} className="flex gap-2 text-[13px] leading-snug text-ink-2">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" />
                {r}
              </li>
            ))}
          </ul>
          {lines && p.status === 'pending' && (
            <div className="mt-4 overflow-hidden rounded-[12px] shadow-[inset_0_0_0_1px_var(--gray-a4)]">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-ink-3">
                    <th className="px-3 py-2 text-left font-normal">Item</th>
                    <th className="w-28 px-3 py-2 text-right font-normal">Qty</th>
                    <th className="w-24 px-3 py-2 text-right font-normal">Cost</th>
                    <th className="w-24 px-3 py-2 text-right font-normal">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.itemId} className="border-t border-line">
                      <td className="px-3 py-1.5 text-ink">{items[l.itemId]?.name}</td>
                      <td className="px-3 py-1.5">
                        <NumberInput value={l.qty} min={0} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: v } : x)))} className="h-7 w-20 text-[12.5px]" aria-label={`Quantity for ${items[l.itemId]?.name}`} />
                      </td>
                      <td className="tabular px-3 py-1.5 text-right text-ink-2">{eur(l.unitCost)}</td>
                      <td className="tabular px-3 py-1.5 text-right text-ink">{eur(l.qty * l.unitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {p.kind === 'transfer' && (
            <p className="mt-3 text-[12.5px] text-ink-3">
              {fmtQty(payload.qty as number, items[payload.itemId as string]?.unit)} · {locations[payload.from as string]?.name} → {locations[payload.to as string]?.name}
            </p>
          )}
        </div>
        {total != null && (
          <div className="hidden shrink-0 text-right sm:block">
            <div className="tabular text-[17px] font-semibold tracking-[-0.02em] text-ink">{eur(total, { decimals: 0 })}</div>
            <div className="text-[11.5px] text-ink-3">{p.kind === 'reorder' ? 'order value' : p.kind === 'price' ? 'margin at stake / mo' : 'at stake'}</div>
          </div>
        )}
      </div>
      {p.status === 'pending' && canWrite && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/50 px-5 py-3">
          <Button variant="primary" size="sm" icon={<CheckIcon size={13} />} onClick={() => void approve(false)}>
            {p.kind === 'reorder' ? 'Approve as draft' : p.kind === 'count' ? 'Start count' : p.kind === 'price' ? 'Update price' : 'Approve'}
          </Button>
          {p.kind === 'reorder' && (
            <Button size="sm" onClick={() => void approve(true)}>
              Approve &amp; mark sent
            </Button>
          )}
          <Button variant="ghost" size="sm" icon={<XIcon size={13} />} onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      )}
    </article>
  )
}
