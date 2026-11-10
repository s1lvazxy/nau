import { LANDING_ONLY, href } from '~/lib/site'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowUpIcon, StopIcon } from '@phosphor-icons/react'
import { AppIcon, Mark } from '~/components/brand/logo'
import { ChatThread, useStickToBottom } from '~/components/operator/chat'
import { SnapshotContext } from '~/data/store'
import { applyChangeSet } from '~/data/changeset'
import { useOperator, type OperatorEnv } from '~/agent/operator'
import { createDemoSnapshot } from '~/lib/seed'
import type { Autonomy, Policy, Snapshot } from '~/lib/types'
import { cn } from '~/lib/utils'
import { Container, Rule, useInView, useReducedMotion } from './frame'
import { msg, tr } from '~/i18n'

const SUGGESTIONS = [msg('O que está a acabar?'), msg('Prepara as encomendas'), msg('Quando acaba o Alvarinho?'), msg('Move 20 cápsulas do Bonfim para o Príncipe Real')]

const AUTONOMY: { value: Autonomy; label: string; note: string }[] = [
  { value: 'suggest', label: msg('Perguntar'), note: msg('O Operador pergunta antes de cada alteração.') },
  { value: 'draft', label: msg('Reversível'), note: msg('Faz sozinho o que se pode desfazer e regista-o. O dinheiro espera por ti.') },
  { value: 'auto', label: msg('Até 250 €'), note: msg('Também envia encomendas sozinho até 250 € cada. Acima disso, espera por ti.') },
]

/** The three positions of the switch, as the workspace policy the real product stores. */
const POLICY: Record<Autonomy, Policy> = {
  suggest: { reversible: 'ask', money: 'ask', outbound: 'ask', perActionLimit: 0, dailyLimit: 0 },
  draft: { reversible: 'auto', money: 'ask', outbound: 'ask', perActionLimit: 250, dailyLimit: 750 },
  auto: { reversible: 'auto', money: 'auto', outbound: 'auto', perActionLimit: 250, dailyLimit: 750 },
}

/** Types the suggestions into the empty prompt, one after the other. */
function useTyped(lines: string[], active: boolean) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (!active) return
    let line = 0
    let n = 0
    let dir = 1
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      n += dir
      setText(lines[line].slice(0, n))
      if (dir === 1 && n >= lines[line].length) {
        dir = -1
        timer = setTimeout(tick, 1900)
      } else if (dir === -1 && n <= 0) {
        dir = 1
        line = (line + 1) % lines.length
        timer = setTimeout(tick, 380)
      } else timer = setTimeout(tick, dir === 1 ? 44 : 16)
    }
    timer = setTimeout(tick, 500)
    return () => clearTimeout(timer)
  }, [active, lines])
  return text
}

export function OperatorSection() {
  const [ref, inView] = useInView<HTMLElement>(0.25)
  const reduced = useReducedMotion()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const snapRef = useRef<Snapshot | null>(null)
  const [autonomy, setAutonomy] = useState<Autonomy>('draft')
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const { turns, running, send, approve, reject, undo, stop } = useOperator()
  const actions = useMemo(() => Object.fromEntries((snap?.actions ?? []).map((a) => [a.id, a])), [snap])
  const scroller = useStickToBottom(turns)

  useEffect(() => {
    useOperator.getState().reset()
    useOperator.setState({ engine: 'offline' })
    return () => {
      useOperator.getState().reset()
      useOperator.setState({ engine: null })
    }
  }, [])

  // The demo shop is built the first time the section comes near the screen.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting || snapRef.current) return
        snapRef.current = createDemoSnapshot()
        setSnap(snapRef.current)
        io.disconnect()
      },
      { rootMargin: '700px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref])

  useEffect(() => {
    const s = snapRef.current
    if (!s) return
    snapRef.current = { ...s, workspace: { ...s.workspace, settings: { ...s.workspace.settings, policy: POLICY[autonomy] } } }
    setSnap(snapRef.current)
  }, [autonomy])

  const env: OperatorEnv = useMemo(
    () => ({
      getSnapshot: () => snapRef.current ?? undefined,
      commit: async (cs, opts) => {
        if (!snapRef.current) return
        snapRef.current = applyChangeSet(snapRef.current, cs)
        setSnap(snapRef.current)
        if (opts?.success) toast.success(opts.success, { description: tr('Na demo, fica tudo no teu browser.') })
      },
      navigate: () => (LANDING_ONLY ? toast(tr('Isso abre na aplicação'), { description: tr('Instala o Nau para ver: são três linhas.') }) : toast(tr('Isso abre na demo ao vivo'), { description: tr('Abre a demo para ver — sem registo.') })),
      actor: { kind: 'user', name: 'You' },
      canWrite: true,
      path: '/ (website)',
      mode: 'demo',
    }),
    [],
  )

  const ask = (text: string) => {
    const q = text.trim()
    if (!q || running || !snapRef.current) return
    setValue('')
    void send(q, env)
  }

  const suggestions = SUGGESTIONS.map((s) => tr(s))
  const typed = useTyped(suggestions, inView && !value && !reduced && turns.length === 0)
  const hint = reduced || turns.length > 0 ? (turns.length > 0 ? tr('Pergunta outra coisa…') : suggestions[0]) : typed
  const open = turns.length > 0

  return (
    <section id="operator" ref={ref} aria-labelledby="operator-title" className="relative scroll-mt-20">
      <Rule />
      <Container className="flex flex-col items-center pt-28 pb-28 md:pt-40 md:pb-40">
        <h2 id="operator-title" data-lines className="max-w-[12ch] text-center text-[clamp(2.75rem,6.6vw,6rem)] leading-[0.97] font-medium tracking-[-0.045em] text-white">
          {tr('Pergunta ao')} <span className="text-white/38">{tr('teu stock.')}</span>
        </h2>
        <p data-reveal className="mt-6 max-w-[44ch] text-center text-[17px] leading-[1.6] text-white/58">
          {tr('O Operador responde com os teus números e deixa o trabalho pronto. Tu aprovas.')}
        </p>

        <form
          data-reveal
          className="relative mt-12 w-full max-w-[780px]"
          onSubmit={(e) => {
            e.preventDefault()
            ask(value)
          }}
        >
          <div aria-hidden className={cn('pointer-events-none absolute -inset-x-16 top-1/3 -bottom-16 -z-[1] bg-[radial-gradient(50%_60%_at_50%_100%,rgb(255_91_31/0.3),transparent)] blur-2xl transition-opacity duration-700', focused || running ? 'opacity-100' : 'opacity-55')} />
          <div className="prompt-ring rounded-[28px] p-px" data-live={running ? 'true' : undefined} data-focus={focused ? 'true' : undefined}>
            <div className="rounded-[27px] bg-[#0f0f0f] px-5 pt-5 pb-4 font-sans">
              <div className="relative min-h-[60px]">
                <textarea
                  ref={input}
                  value={value}
                  rows={2}
                  onChange={(e) => setValue(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      ask(value)
                    }
                  }}
                  aria-label={tr('Pergunta ao Operador')}
                  className="relative z-[1] block w-full resize-none bg-transparent text-[18px] leading-[1.5] tracking-[-0.01em] text-white caret-[#ff5b1f] outline-none"
                />
                {!value && (
                  <div aria-hidden className="pointer-events-none absolute inset-0 text-[18px] leading-[1.5] tracking-[-0.01em] text-white/32">
                    {hint}
                    {!focused && !reduced && !open && <span className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[0.18em] animate-[blink_1.1s_steps(2,start)_infinite] bg-[#ff5b1f]" />}
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex h-9 items-center gap-2 rounded-full bg-white/[0.045] pr-3.5 pl-1.5 text-[13px] text-white/70 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
                  <AppIcon size={24} className="rounded-full!" />
                  {tr('Casa Ribeira')} <span className="text-white/35">{tr('· loja de demonstração')}</span>
                </span>
                <div className="flex min-w-[240px] flex-1 items-center gap-2">
                <div role="radiogroup" aria-label={tr('Autonomia do Operador')} className="relative grid h-9 grid-cols-3 rounded-full bg-white/[0.045] p-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] max-sm:flex-1">
                  <span aria-hidden className="absolute inset-y-1 left-1 w-[calc((100%-8px)/3)] rounded-full bg-white/[0.12] transition-transform duration-300 ease-[var(--ease-out)]" style={{ transform: `translateX(${AUTONOMY.findIndex((a) => a.value === autonomy) * 100}%)` }} />
                  {AUTONOMY.map((a) => (
                    <button key={a.value} type="button" role="radio" aria-checked={autonomy === a.value} title={tr(a.note)} onClick={() => setAutonomy(a.value)} className={cn('relative z-[1] rounded-full px-3 text-[12.5px] transition-colors duration-200 max-sm:px-1.5', autonomy === a.value ? 'text-white' : 'text-white/45 hover:text-white/75')}>
                      {tr(a.label)}
                    </button>
                  ))}
                </div>
                {running ? (
                  <button type="button" onClick={stop} aria-label={tr('Parar')} className="press ml-auto flex size-10 items-center justify-center rounded-full bg-white/[0.1] text-white">
                    <StopIcon size={15} weight="fill" />
                  </button>
                ) : (
                  <button type="submit" disabled={!value.trim() || !snap} aria-label={tr('Perguntar')} className="press ml-auto flex size-10 items-center justify-center rounded-full bg-white text-black transition-opacity duration-200 disabled:opacity-25">
                    <ArrowUpIcon size={17} weight="bold" />
                  </button>
                )}
                </div>
              </div>
            </div>
          </div>
        </form>

        <div data-reveal className="mt-5 flex max-w-[780px] flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => ask(s)} disabled={running || !snap} className="press rounded-full px-3.5 py-2 text-[13.5px] text-white/65 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] transition-colors duration-200 hover:bg-white/[0.05] hover:text-white disabled:opacity-40">
              {s}
            </button>
          ))}
        </div>
        <p data-reveal className="mt-5 text-[12.5px] text-white/35">
          {tr('{0} Corre no teu browser, sobre 54 produtos e 90 dias de vendas.', tr(AUTONOMY.find((a) => a.value === autonomy)?.note ?? ''))}
        </p>

        {/* The answer unfolds under the prompt */}
        <div className={cn('grid w-full max-w-[780px] transition-[grid-template-rows,opacity,margin-top] duration-700 ease-[var(--ease-out)] motion-reduce:transition-none', open ? 'mt-10 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0')}>
          <div className="min-h-0 overflow-hidden">
            <div className="dark m-px rounded-[24px] bg-[#0f0f0f] font-sans shadow-[0_0_0_1px_rgb(255_255_255/0.08),inset_0_1px_0_rgb(255_255_255/0.05)]" style={{ colorScheme: 'dark' }}>
              <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
                <div className="flex items-center gap-2 text-[13.5px] font-medium text-white">
                  <Mark size={15} working={running} className="text-[#ff5b1f]" /> {tr('Operador')}
                </div>
                <button type="button" onClick={() => useOperator.getState().reset()} className="text-[12.5px] text-white/50 transition-colors hover:text-white/85">
                  {tr('Nova conversa')}
                </button>
              </div>
              <div ref={scroller} className="max-h-[min(620px,72vh)] overflow-y-auto overscroll-contain px-5 py-6">
                {snap && (
                  <SnapshotContext.Provider value={snap}>
                    <ChatThread turns={turns} actions={actions} running={running} onApprove={(id) => void approve(id, env)} onReject={(id) => void reject(id, env)} onUndo={(id) => void undo(id, env)} />
                  </SnapshotContext.Provider>
                )}
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
