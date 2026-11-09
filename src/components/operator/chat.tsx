import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRightIcon, ArrowUpIcon, CaretRightIcon, CheckIcon, CircleNotchIcon, StopIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { Mark } from '~/components/brand/logo'
import { AreaChart } from '~/components/ui/charts'
import { Badge, ItemSwatch } from '~/components/ui/primitives'
import { STATUS_META, itemStats, projection } from '~/lib/analytics'
import { date, eur, num, pct, qty as fmtQty } from '~/lib/format'
import { useSnapshot } from '~/data/store'
import { cn } from '~/lib/utils'
import type { ChatPart, ChatTurn, PendingAction, View } from '~/agent/types'

const TOOL_LABEL: Record<string, string> = {
  stock_overview: 'Checked the whole business',
  search_items: 'Searched the catalogue',
  list_items: 'Listed items',
  get_item: 'Looked up an item',
  forecast: 'Ran a forecast',
  list_suppliers: 'Read suppliers',
  list_orders: 'Read purchase orders',
  run_report: 'Built a report',
  prepare_purchase_order: 'Prepared a purchase order',
  prepare_transfer: 'Prepared a transfer',
  prepare_adjustment: 'Prepared a stock correction',
  prepare_item_update: 'Prepared an item change',
  start_count: 'Started a count',
  add_widget: 'Added a widget',
  open_page: 'Opened a page',
}

/* Minimal, safe inline markdown: **bold**, `code`, line breaks and bullet lists */
function Rich({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/)
  const inline = (s: string, k: string) =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
      p.startsWith('**') ? (
        <strong key={k + i} className="font-medium text-ink">
          {p.slice(2, -2)}
        </strong>
      ) : p.startsWith('`') ? (
        <code key={k + i} className="rounded bg-hover px-1 font-mono text-[0.9em]">
          {p.slice(1, -1)}
        </code>
      ) : (
        <span key={k + i}>{p}</span>
      ),
    )
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, bi) => {
        const lines = b.split('\n')
        if (lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l)))
          return (
            <ul key={bi} className="flex flex-col gap-1 pl-1">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-2">
                  <span className="mt-[0.55em] size-1 shrink-0 rounded-full bg-ink-3" />
                  <span>{inline(l.replace(/^\s*([-•*]|\d+\.)\s+/, ''), `${bi}-${li}`)}</span>
                </li>
              ))}
            </ul>
          )
        return <p key={bi}>{lines.map((l, li) => <span key={li}>{inline(l, `${bi}-${li}`)}{li < lines.length - 1 && <br />}</span>)}</p>
      })}
    </div>
  )
}

function Thinking({ part, live }: { part: Extract<ChatPart, { type: 'thinking' }>; live: boolean }) {
  const [open, setOpen] = useState(false)
  const done = part.done || !live
  return (
    <div className="text-[12.5px]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-ink-3 transition-colors hover:text-ink-2" aria-expanded={open}>
        {done ? <span>Thought process{part.seconds ? ` · ${part.seconds}s` : ''}</span> : <span className="animate-pulse">Thinking…</span>}
        <CaretRightIcon size={10} className={cn('transition-transform duration-200', open && 'rotate-90')} />
      </button>
      {open && part.text && <div className="mt-2 border-l-2 border-line pl-3 leading-relaxed whitespace-pre-wrap text-ink-3">{part.text}</div>}
    </div>
  )
}

export function ItemsView({ view, onOpen }: { view: Extract<View, { kind: 'items' }>; onOpen?: (id: string) => void }) {
  const [all, setAll] = useState(false)
  const rows = all ? view.rows : view.rows.slice(0, 6)
  return (
    <div className="overflow-hidden rounded-[12px] bg-surface shadow-card">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 text-[12px] font-medium text-ink-2">
        {view.title}
        <span className="font-normal text-ink-4">{view.rows.length}</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.id + (r.note ?? '')}>
            <button type="button" onClick={() => onOpen?.(r.id)} disabled={!onOpen} className="flex w-full items-center gap-2.5 border-t border-line px-3 py-2 text-left enabled:hover:bg-hover">
              <ItemSwatch name={r.name} hue={r.hue} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-ink">{r.name}</span>
                <span className="block truncate text-[11px] text-ink-3">{r.note ?? (r.onHand <= 0 ? 'None left' : `${fmtQty(r.onHand, r.unit)} · ${r.cover < 0 ? 'no recent sales' : `${num(r.cover, 1)} days cover`}`)}</span>
              </span>
              <Badge tone={STATUS_META[r.status as keyof typeof STATUS_META]?.tone ?? 'neutral'} dot>
                {STATUS_META[r.status as keyof typeof STATUS_META]?.label ?? r.status}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
      {view.rows.length > 6 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="w-full border-t border-line py-1.5 text-[12px] text-ink-3 hover:text-ink">
          {all ? 'Show less' : `Show all ${view.rows.length}`}
        </button>
      )}
    </div>
  )
}

function TableView({ view }: { view: Extract<View, { kind: 'table' }> }) {
  const fmt = (v: string | number | null, f?: string) => (v == null ? '—' : typeof v === 'string' ? v : f === 'eur' ? eur(v) : f === 'pct' ? pct(v, 1) : f === 'days' ? `${v}d` : num(v, 2))
  return (
    <div className="overflow-hidden rounded-[12px] bg-surface shadow-card">
      <div className="px-3 pt-2.5 pb-1.5 text-[12px] font-medium text-ink-2">{view.title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-t border-line text-ink-3">
              {view.columns.map((c) => (
                <th key={c.key} className={cn('px-3 py-1.5 font-normal whitespace-nowrap', c.align === 'right' ? 'text-right' : 'text-left')}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.slice(0, 14).map((r, i) => (
              <tr key={i} className="border-t border-line">
                {view.columns.map((c) => (
                  <td key={c.key} className={cn('px-3 py-1.5 whitespace-nowrap text-ink', c.align === 'right' && 'tabular text-right')}>
                    {fmt(r[c.key], c.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ItemView({ itemId, onOpen }: { itemId: string; onOpen?: (id: string) => void }) {
  const s = useSnapshot()
  const st = itemStats(s, itemId)
  if (!st) return null
  return (
    <button type="button" onClick={() => onOpen?.(itemId)} disabled={!onOpen} className="flex w-full items-center gap-3 rounded-[12px] bg-surface p-3 text-left shadow-card enabled:hover:bg-surface-2">
      <ItemSwatch name={st.item.name} hue={st.item.hue} size={34} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink">{st.item.name}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-ink-3">
          <span className="tabular">{fmtQty(st.onHand, st.item.unit)} on hand</span>
          <span className="tabular">{Number.isFinite(st.cover) ? `${num(st.cover, 1)}d cover` : 'no demand'}</span>
          <span className="tabular">{eur(st.item.price)}</span>
        </div>
      </div>
      <Badge tone={STATUS_META[st.status].tone} dot>
        {STATUS_META[st.status].label}
      </Badge>
    </button>
  )
}

function ForecastView({ itemId, days }: { itemId: string; days: number }) {
  const s = useSnapshot()
  const st = itemStats(s, itemId)
  const p = projection(s, itemId, days)
  if (!st) return null
  return (
    <div className="rounded-[12px] bg-surface p-3 shadow-card">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="font-medium text-ink-2">Projected stock · {st.item.name}</span>
        <span className="text-ink-4">{days} days</span>
      </div>
      <AreaChart data={p.map((d) => ({ label: d.day, value: d.level, secondary: d.units, marker: d.holiday }))} height={130} xFormat={(l) => date(l, 'short')} format={(v) => num(v, 0)} primaryLabel="Stock" secondaryLabel="Demand" threshold={st.reorderPoint ? { value: st.reorderPoint, label: 'reorder point' } : undefined} className="mt-2" />
    </div>
  )
}

const KIND_LABEL: Record<string, string> = { order: 'Purchase order', transfer: 'Transfer', adjustment: 'Stock correction', item: 'Item change', catalog: 'Catalogue', supplier: 'Supplier', location: 'Location', settings: 'Settings', policy: 'Policy', rule: 'Rule', dashboard: 'Dashboard', receipt: 'Delivery', proposal: 'Suggestion', count: 'Count', sync: 'Sync', import: 'Import', reorder: 'Reorder', deadstock: 'Dead stock', markdown: 'Markdown', price: 'Price' }

/** A journal entry as a card: approve what waits, undo what was done. */
export function ActionCard({ action, onApprove, onReject, onUndo }: { action: PendingAction; onApprove: () => void; onReject: () => void; onUndo?: () => void }) {
  const state = action.status
  const quiet = state === 'rejected' || state === 'undone'
  return (
    <div className={cn('overflow-hidden rounded-[14px] bg-surface shadow-card transition-opacity', quiet && 'opacity-55')}>
      <div className="px-3.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="mono-label text-ink-3">{KIND_LABEL[action.kind] ?? action.kind}</span>
          {action.impactEur != null && <span className="tabular text-[12px] text-ink-3">{eur(action.impactEur)}</span>}
        </div>
        <div className="mt-1 text-[13.5px] font-medium text-ink">{action.title}</div>
        <ul className="mt-2 flex flex-col gap-1 pb-3">
          {action.lines.slice(0, 8).map((l, i) => (
            <li key={i} className="text-[12px] text-ink-2">
              {l}
            </li>
          ))}
          {action.lines.length > 8 && <li className="text-[12px] text-ink-4">+{action.lines.length - 8} more</li>}
          {state === 'pending' && action.reason && <li className="text-[12px] text-ink-3">{action.reason}</li>}
        </ul>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-surface-2/60 px-3.5 py-2.5">
        {state === 'pending' ? (
          <>
            <button type="button" onClick={onApprove} className="press inline-flex h-7 items-center gap-1.5 rounded-full bg-ink px-3 text-[12px] font-medium text-inverse">
              <CheckIcon size={12} weight="bold" /> Approve
            </button>
            <button type="button" onClick={onReject} className="press inline-flex h-7 items-center rounded-full px-3 text-[12px] text-ink-2 shadow-[inset_0_0_0_1px_var(--gray-a6)] hover:bg-hover">
              Not now
            </button>
          </>
        ) : (
          <>
            <span className={cn('flex items-center gap-1.5 text-[12px] font-medium', quiet ? 'text-ink-3' : 'text-ok-ink')}>
              {quiet ? <XIcon size={12} /> : <CheckIcon size={12} weight="bold" />}
              {state === 'rejected' ? 'Dismissed' : state === 'undone' ? 'Undone' : action.approvedBy ? `Approved by ${action.approvedBy}` : 'Done by Operator'}
            </span>
            {state === 'applied' && action.undo && onUndo && (
              <button type="button" onClick={onUndo} className="press inline-flex h-7 items-center rounded-full px-2.5 text-[12px] text-ink-2 hover:bg-hover hover:text-ink">
                Undo
              </button>
            )}
          </>
        )}
        {action.link && !quiet && (
          <Link to={action.link} className="ml-auto inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
            Open <ArrowRightIcon size={11} />
          </Link>
        )}
      </div>
    </div>
  )
}

function ToolRow({ part, actions, onApprove, onReject, onUndo, onOpenItem, children }: { part: Extract<ChatPart, { type: 'tool' }>; actions: Record<string, PendingAction>; onApprove: (id: string) => void; onReject: (id: string) => void; onUndo?: (id: string) => void; onOpenItem?: (id: string) => void; children?: ReactNode }) {
  const view = part.view
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        {part.status === 'running' ? <CircleNotchIcon size={12} className="animate-spin" /> : part.status === 'error' ? <WarningCircleIcon size={12} className="text-warn" /> : <CheckIcon size={12} weight="bold" className="text-ok" />}
        <span className="text-ink-2">{TOOL_LABEL[part.name] ?? part.name}</span>
        {part.summary && <span className="truncate">· {part.summary}</span>}
      </div>
      {view?.kind === 'items' && <ItemsView view={view} onOpen={onOpenItem} />}
      {view?.kind === 'table' && <TableView view={view} />}
      {view?.kind === 'item' && <ItemView itemId={view.itemId} onOpen={onOpenItem} />}
      {view?.kind === 'forecast' && <ForecastView itemId={view.itemId} days={view.days} />}
      {view?.kind === 'action' && actions[view.actionId] && <ActionCard action={actions[view.actionId]} onApprove={() => onApprove(view.actionId)} onReject={() => onReject(view.actionId)} onUndo={onUndo ? () => onUndo(view.actionId) : undefined} />}
      {view?.kind === 'link' && (
        <Link to={view.to} className="inline-flex w-fit items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[12px] font-medium text-ink shadow-card hover:bg-surface-2">
          {view.label} <ArrowRightIcon size={11} />
        </Link>
      )}
      {children}
    </div>
  )
}

/** Keeps a scroll container pinned to the bottom while content streams, unless the reader scrolled up. */
export function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const on = () => (pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80)
    el.addEventListener('scroll', on, { passive: true })
    return () => el.removeEventListener('scroll', on)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [dep])
  return ref
}

function WorkReceipt({ turn, actions }: { turn: ChatTurn; actions: Record<string, PendingAction> }) {
  const tools = turn.parts.filter((p): p is Extract<ChatPart, { type: 'tool' }> => p.type === 'tool')
  if (!tools.length) return null
  const prepared = tools.filter((p) => p.view?.kind === 'action').map((p) => (p.view as { actionId: string }).actionId)
  const reads = tools.length - prepared.length
  const pending = prepared.filter((id) => actions[id]?.status === 'pending').length
  const done = prepared.filter((id) => actions[id]?.status === 'applied').length
  const seconds = turn.finishedAt ? Math.max(1, Math.round((new Date(turn.finishedAt).getTime() - new Date(turn.createdAt).getTime()) / 1000)) : null
  const bits = [seconds ? `Worked for ${seconds}s` : null, reads ? `${reads} check${reads > 1 ? 's' : ''}` : null, done ? `${done} done` : null, pending ? `${pending} awaiting approval` : null].filter(Boolean)
  return <p className="tabular text-[11.5px] text-ink-3">{bits.join(' · ')}</p>
}

export function ChatThread({ turns, actions, onApprove, onReject, onUndo, onOpenItem, className, running }: { turns: ChatTurn[]; actions: Record<string, PendingAction>; onApprove: (id: string) => void; onReject: (id: string) => void; onUndo?: (id: string) => void; onOpenItem?: (id: string) => void; className?: string; running?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      {turns.map((t) =>
        t.role === 'user' ? (
          <div key={t.id} className="ml-auto max-w-[85%] rounded-[16px] rounded-br-[6px] bg-ink px-3.5 py-2.5 text-[13.5px] leading-snug whitespace-pre-wrap text-inverse">
            {t.parts.map((p) => (p.type === 'text' ? p.text : null))}
          </div>
        ) : (
          <div key={t.id} className="flex gap-3">
            <Mark size={15} working={!!t.streaming && running} className="mt-[3px] text-ink" />
            <div className="flex min-w-0 flex-1 flex-col gap-3 text-[13.5px] leading-[1.55] text-ink-2">
              {t.parts.length === 0 && <span className="animate-pulse text-[12.5px] text-ink-3">Thinking…</span>}
              {t.parts.map((p, i) =>
                p.type === 'text' ? (
                  p.text ? <Rich key={i} text={p.text} /> : null
                ) : p.type === 'thinking' ? (
                  <Thinking key={i} part={p} live={!!t.streaming} />
                ) : (
                  <ToolRow key={p.id} part={p} actions={actions} onApprove={onApprove} onReject={onReject} onUndo={onUndo} onOpenItem={onOpenItem} />
                ),
              )}
              {!t.streaming && <WorkReceipt turn={t} actions={actions} />}
              {t.error && t.engine === 'offline' && <p className="text-[11.5px] text-ink-3">The AI model was unavailable ({t.error}) — answered with the built-in engine.</p>}
            </div>
          </div>
        ),
      )}
    </div>
  )
}

export function Composer({ onSend, running, onStop, placeholder = 'Ask about stock, sales or suppliers…', autoFocus, suggestions, className }: { onSend: (text: string) => void; running?: boolean; onStop?: () => void; placeholder?: string; autoFocus?: boolean; suggestions?: string[]; className?: string }) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(160, el.scrollHeight) + 'px'
  }, [value])
  const send = (t = value) => {
    if (!t.trim() || running) return
    onSend(t)
    setValue('')
  }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} disabled={running} className="press rounded-full bg-surface px-3 py-1.5 text-[12px] text-ink-2 shadow-card hover:text-ink disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-[16px] bg-raised p-2 pl-3.5 shadow-[inset_0_0_0_1px_var(--gray-a6)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--accent-9),0_0_0_3px_var(--accent-a3)]">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={placeholder}
          aria-label="Message Operator"
          className="max-h-40 min-h-[30px] flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-[1.5] text-ink outline-none placeholder:text-ink-4"
        />
        {running ? (
          <button type="button" onClick={onStop} aria-label="Stop" className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-hover text-ink">
            <StopIcon size={13} weight="fill" />
          </button>
        ) : (
          <button type="button" onClick={() => send()} disabled={!value.trim()} aria-label="Send" className="press flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-inverse transition-opacity disabled:opacity-30">
            <ArrowUpIcon size={14} weight="bold" />
          </button>
        )}
      </div>
    </div>
  )
}
