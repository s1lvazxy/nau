import { useMail } from '~/data/mail'
import { useEffect, useMemo } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowsClockwiseIcon, XIcon } from '@phosphor-icons/react'
import { Mark } from '~/components/brand/logo'
import { ChatThread, Composer, useStickToBottom } from '~/components/operator/chat'
import { useOperator, type OperatorEnv } from '~/agent/operator'
import { snapshotKey, useCanWrite, useSession, useSnapshot } from '~/data/store'
import { morningBrief } from '~/lib/analytics'
import { useUI } from '~/stores/ui'
import { cn } from '~/lib/utils'
import type { Snapshot } from '~/lib/types'
import { useActions } from './actions'
import { tr } from '~/i18n'

const STARTERS = [tr('What needs me today?'), tr('What’s running low?'), tr('Draft the orders'), tr('What’s not selling?'), tr('Add a sales trend widget')]

export function useOperatorEnv(): OperatorEnv {
  const qc = useQueryClient()
  const { session, workspaceId } = useSession()
  const { commit, actor } = useActions()
  const navigate = useNavigate()
  const canWrite = useCanWrite()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const dashboardId = useUI((s) => s.dashboardId)
  const mail = useMail()
  return useMemo(
    () => ({
      getSnapshot: () => qc.getQueryData<Snapshot>(snapshotKey(session?.mode, workspaceId)),
      commit,
      navigate: (to: string) => void navigate({ to }),
      actor,
      canWrite,
      dashboardId,
      path,
      mode: session?.mode ?? 'local',
      authToken: null,
      mail: mail.enabled,
    }),
    [qc, session?.mode, workspaceId, commit, navigate, actor, canWrite, dashboardId, path, mail.enabled],
  )
}

export function OperatorPanel() {
  const { open, setOpen, turns, running, send, approve, reject, undo, stop, reset, engine, model, detectEngine } = useOperator()
  const env = useOperatorEnv()
  const s = useSnapshot()
  const navigate = useNavigate()
  const scroller = useStickToBottom(turns)
  useEffect(() => {
    void detectEngine(env.mode)
  }, [detectEngine, env.mode])
  const actions = useMemo(() => Object.fromEntries(s.actions.map((a) => [a.id, a])), [s.actions])
  const brief = morningBrief(s)
  return (
    <aside
      aria-label={tr('Operator')}
      aria-hidden={!open}
      className={cn(
        'fixed inset-y-2 right-2 z-40 flex w-[min(420px,calc(100vw-16px))] flex-col overflow-hidden rounded-[16px] bg-raised shadow-pop transition-[transform,opacity] duration-[380ms] ease-[var(--ease-drawer)] xl:static xl:inset-auto xl:z-auto xl:my-2 xl:mr-2 xl:shadow-card',
        open ? 'translate-x-0 opacity-100 xl:w-[400px]' : 'pointer-events-none translate-x-[calc(100%+16px)] opacity-0 xl:hidden',
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <Mark size={15} working={running} className="text-ink" />
        <span className="text-[13.5px] font-medium text-ink">{tr('Operator')}</span>
        <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-3" title={engine === 'claude' ? tr('AI model: {0}', model) : tr('Built-in engine — add ANTHROPIC_API_KEY for the full model')}>
          {engine === 'claude' ? tr('AI') : engine === 'offline' ? tr('Built-in') : '…'}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {turns.length > 0 && (
            <button type="button" onClick={reset} aria-label={tr('New chat')} title={tr('New chat')} className="touch-target flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
              <ArrowsClockwiseIcon size={14} />
            </button>
          )}
          <button type="button" onClick={() => setOpen(false)} aria-label={tr('Close Operator')} className="touch-target flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
            <XIcon size={14} />
          </button>
        </div>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col justify-end gap-4">
            <div>
              <Mark size={22} className="text-accent" />
              <p className="mt-3 text-[19px] leading-tight font-medium tracking-[-0.02em] text-ink">{tr('How can I help with {0}?', s.workspace.name)}</p>
              <p className="mt-1.5 text-[13px] text-ink-3">{tr('I can read every item, order and supplier, and prepare the work for you to approve.')}</p>
            </div>
            <div className="rounded-[12px] bg-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--gray-a3)]">
              <p className="mono-label text-ink-3">{tr('Right now · health {0}', brief.health)}</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {brief.lines.slice(0, 4).map((l) => (
                  <li key={l.text} className="text-[12.5px] leading-snug text-ink-2">
                    {l.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <ChatThread turns={turns} actions={actions} running={running} onApprove={(id) => void approve(id, env)} onReject={(id) => void reject(id, env)} onUndo={(id) => void undo(id, env)} onOpenItem={(id) => void navigate({ to: '/app/items/$itemId', params: { itemId: id } })} />
        )}
      </div>
      <div className="border-t border-line p-3">
        <Composer onSend={(t) => void send(t, env)} running={running} onStop={stop} suggestions={turns.length === 0 ? STARTERS : undefined} autoFocus={open} />
      </div>
    </aside>
  )
}
