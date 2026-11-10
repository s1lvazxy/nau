import { useRef, useState } from 'react'
import { ArrowUpRightIcon, CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { tr } from '~/i18n'
import { DOCS_URL, REPO_URL } from '~/lib/site'
import { cn } from '~/lib/utils'
import { Container, Rule, gsap, useGSAP, useReducedMotion } from './frame'

type Place = 'try' | 'local' | 'server'

/** Three places to run it, three lines each. The commands are the ones in the hosting guide. */
const places = (): { id: Place; label: string; needs: string; gets: string; lines: [string, string][] }[] => [
  {
    id: 'try',
    label: tr('Experimentar'),
    needs: tr('Node 22.9 ou superior e pnpm.'),
    gets: tr('Importações, Operador, registo e desfazer. Os dados ficam no teu browser.'),
    lines: [
      ['git clone https://github.com/s1lvazxy/nau && cd nau', tr('o código')],
      ['pnpm install', tr('as dependências')],
      ['pnpm dev', tr('abre em localhost:3100')],
    ],
  },
  {
    id: 'local',
    label: tr('No teu computador'),
    needs: tr('O anterior, mais Docker e a CLI do Supabase.'),
    gets: tr('Tudo ligado: contas partilhadas, conectores, API, webhooks e o Operador agendado.'),
    lines: [
      ['supabase start', tr('base de dados e contas, em Docker')],
      ['pnpm setup:local', tr('preenche o .env e gera os segredos')],
      ['pnpm dev', tr('tudo ligado, em localhost:3100')],
    ],
  },
  {
    id: 'server',
    label: tr('No servidor'),
    needs: tr('Um projeto Supabase e um servidor com Docker.'),
    gets: tr('O mesmo, para a equipa toda, atrás do domínio da empresa.'),
    lines: [
      ['supabase db push', tr('aplica o esquema à tua base de dados')],
      ['cp .env.example .env', tr('endereço, chaves e segredos')],
      ['docker compose up -d --build', tr('a aplicação e o agendador')],
    ],
  },
]

/** The install chapter: a ruled sheet of three commands, set large, that changes with where you run it. */
export function Install() {
  const root = useRef<HTMLElement>(null)
  const seen = useRef(false)
  const reduced = useReducedMotion()
  const [place, setPlace] = useState<Place>('try')
  const [copied, setCopied] = useState<number | null>(null)
  const all = places()
  const index = all.findIndex((p) => p.id === place)
  const current = all[index]

  useGSAP(
    () => {
      if (reduced) return
      const first = !seen.current
      seen.current = true
      // The first time the sheet waits for the reader; after that a change of place answers at once.
      const scrollTrigger = first ? { trigger: '[data-sheet]', start: 'top 82%', once: true } : undefined
      gsap.fromTo('[data-cmd]', { opacity: 0, y: first ? 18 : 8 }, { opacity: 1, y: 0, duration: first ? 0.7 : 0.38, ease: 'power3.out', stagger: first ? 0.09 : 0.045, scrollTrigger })
      gsap.fromTo('[data-sweep]', { scaleX: 0, opacity: 0.9 }, { scaleX: 1, opacity: 0.32, duration: first ? 1.1 : 0.6, ease: 'power2.out', stagger: first ? 0.09 : 0.045, scrollTrigger })
    },
    { scope: root, dependencies: [place, reduced] },
  )

  const copy = (i: number, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(i)
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500)
    })
  }
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = all[(index + step + all.length) % all.length]
    setPlace(next.id)
    root.current?.querySelector<HTMLElement>(`[data-place="${next.id}"]`)?.focus()
  }

  return (
    <section id="install" ref={root} aria-labelledby="install-title" className="relative scroll-mt-20">
      <Rule />
      <Container className="pt-28 pb-28 md:pt-40 md:pb-36">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <h2 id="install-title" data-lines className="max-w-[16ch] text-[clamp(2.25rem,4.6vw,4rem)] leading-[1.02] font-medium tracking-[-0.035em] text-white">
            {tr('Instala em três linhas.')} <span className="text-white/38">{tr('Sem planos, sem chave de licença.')}</span>
          </h2>
          <div data-reveal role="tablist" aria-label={tr('Onde queres correr o Nau')} onKeyDown={onKey} className="relative grid h-10 w-full max-w-[460px] grid-cols-3 rounded-full bg-white/[0.045] p-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] lg:mb-2">
            <span aria-hidden className="absolute inset-y-1 left-1 w-[calc((100%-8px)/3)] rounded-full bg-white/[0.12] transition-transform duration-300 ease-[var(--ease-out)]" style={{ transform: `translateX(${index * 100}%)` }} />
            {all.map((p) => (
              <button key={p.id} type="button" role="tab" id={`install-tab-${p.id}`} data-place={p.id} aria-selected={p.id === place} aria-controls="install-panel" tabIndex={p.id === place ? 0 : -1} onClick={() => setPlace(p.id)} className={cn('relative z-[1] rounded-full px-2 text-[13px] transition-colors duration-200', p.id === place ? 'text-white' : 'text-white/50 hover:text-white/80')}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div data-sheet id="install-panel" role="tabpanel" aria-labelledby={`install-tab-${place}`} className="mt-12 border-t border-white/[0.09] md:mt-16">
          {current.lines.map(([cmd, note], i) => (
            <div key={`${place}-${i}`} className="group relative border-b border-white/[0.09]">
              <span data-sweep aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left bg-gradient-to-r from-[#ffb48a] via-[#ff5b1f]/60 to-transparent opacity-30" />
              <button type="button" data-cmd onClick={() => copy(i, cmd)} aria-label={tr('Copiar o comando {0}', cmd)} className="grid w-full grid-cols-[2.25rem_minmax(0,1fr)] items-baseline gap-x-3 py-6 text-left transition-colors duration-200 hover:bg-white/[0.02] md:grid-cols-[3.5rem_minmax(0,1fr)_auto_2rem] md:gap-x-6 md:py-8">
                <span className="font-mono text-[12px] text-white/30">0{i + 1}</span>
                <span className="min-w-0 overflow-x-auto font-mono text-[clamp(0.98rem,1.95vw,1.6rem)] leading-[1.25] tracking-[-0.02em] whitespace-nowrap text-white [scrollbar-width:none]">
                  <span aria-hidden className="mr-[0.6em] text-white/25 select-none">
                    $
                  </span>
                  {cmd}
                  {i === current.lines.length - 1 && <span aria-hidden className="ml-[0.35em] inline-block h-[1.02em] w-[0.5em] translate-y-[0.16em] bg-[#ff7a3d] shadow-[0_0_18px_rgb(255_91_31/0.9)] motion-safe:animate-[blink_1.1s_steps(2,jump-none)_infinite]" />}
                </span>
                <span className="col-start-2 mt-1.5 text-[13.5px] text-white/45 md:col-start-3 md:mt-0 md:text-right">{copied === i ? <span className="text-white/85">{tr('Copiado')}</span> : note}</span>
                <span aria-hidden className="hidden justify-self-end text-white/25 transition-colors duration-200 group-hover:text-white/70 md:block">
                  {copied === i ? <CheckIcon size={15} weight="bold" /> : <CopyIcon size={15} />}
                </span>
              </button>
            </div>
          ))}
        </div>
        <span role="status" className="sr-only">
          {copied !== null ? tr('Copiado') : ''}
        </span>

        <div data-reveal className="mt-8 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <p className="max-w-[52ch] text-[15.5px] leading-[1.65] text-white/58">
            {current.gets} <span className="text-white/35">{current.needs}</span>
          </p>
          <div className="flex shrink-0 flex-wrap gap-x-6 gap-y-2 text-[14.5px]">
            <a href={DOCS_URL} className="group/link inline-flex items-center gap-1.5 text-white/80 transition-colors hover:text-white">
              {tr('Guia de instalação')} <ArrowUpRightIcon size={13} className="transition-transform duration-200 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" />
            </a>
            <a href={REPO_URL} className="group/link inline-flex items-center gap-1.5 text-white/80 transition-colors hover:text-white">
              {tr('Ver o código')} <ArrowUpRightIcon size={13} className="transition-transform duration-200 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" />
            </a>
          </div>
        </div>
      </Container>
    </section>
  )
}
