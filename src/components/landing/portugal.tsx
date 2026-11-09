import { useEffect, useRef, useState, type ReactNode } from 'react'
import NumberFlow from '@number-flow/react'
import { CheckIcon, DownloadSimpleIcon, FileTextIcon } from '@phosphor-icons/react'
import { cn } from '~/lib/utils'
import { Container, Rule, ScrollTrigger, gsap, useGSAP, useInView } from './frame'

/* Each Portuguese detail has a small working instrument. `on` starts its motion. */

/* ── SAF-T: the file goes in, movements come out ── */
function SaftVisual({ on }: { on: boolean }) {
  return (
    <div className="flex w-full items-center gap-4">
      <div className="flex shrink-0 items-center gap-2.5 rounded-[12px] bg-white/[0.05] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
        <FileTextIcon size={18} className="text-[#ffb48a]" />
        <div>
          <div className="font-mono text-[11px] text-white/85">saft_outubro.xml</div>
          <div className="font-mono text-[10px] text-white/35">2,4 MB · Moloni</div>
        </div>
      </div>
      <div className="relative h-px flex-1 bg-white/10">
        <span className={cn('absolute inset-y-0 left-0 bg-gradient-to-r from-[#ffb48a] to-[#ff5b1f] transition-[width] duration-[1600ms] ease-[var(--ease-out)] motion-reduce:transition-none', on ? 'w-full' : 'w-0')} />
        <span className={cn('absolute -top-[3px] size-[7px] rounded-full bg-[#ff5b1f] shadow-[0_0_10px_rgb(255_91_31/0.9)] transition-[left] duration-[1600ms] ease-[var(--ease-out)] motion-reduce:transition-none', on ? 'left-[calc(100%-7px)]' : 'left-0')} />
      </div>
      <div className="grid shrink-0 gap-1.5 text-right">
        <div className="flex items-baseline justify-end gap-2">
          <span className="text-[11px] text-white/40">faturas</span>
          <NumberFlow value={on ? 1284 : 0} locales="pt-PT" className="tabular text-[18px] font-medium tracking-[-0.03em] text-white" transformTiming={{ duration: 1500, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }} />
        </div>
        <div className="flex items-baseline justify-end gap-2">
          <span className="text-[11px] text-white/40">movimentos</span>
          <NumberFlow value={on ? 6920 : 0} locales="pt-PT" className="tabular text-[18px] font-medium tracking-[-0.03em] text-white" transformTiming={{ duration: 1800, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }} />
        </div>
      </div>
    </div>
  )
}

/* ── NIF: typed, checked, classified ── */
function NifVisual({ on }: { on: boolean }) {
  const full = '516 234 986'
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!on) return setN(0)
    let i = 0
    const t = setInterval(() => {
      i = i >= full.length + 14 ? 0 : i + 1
      setN(Math.min(i, full.length))
    }, 110)
    return () => clearInterval(t)
  }, [on])
  const done = n >= full.length
  return (
    <div className="w-full max-w-[280px]">
      <div className="mb-1.5 text-[11px] text-white/45">NIF do fornecedor</div>
      <div className={cn('flex h-11 items-center gap-2 rounded-[11px] bg-white/[0.04] px-3.5 transition-shadow duration-300', done ? 'shadow-[inset_0_0_0_1px_rgb(70_167_88/0.6)]' : 'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]')}>
        <span className="tabular font-mono text-[15px] tracking-[0.04em] text-white">{full.slice(0, n)}</span>
        {!done && <span className="h-4 w-px animate-[blink_1s_steps(2,start)_infinite] bg-[#ff5b1f]" />}
        <span className={cn('ml-auto flex size-5 items-center justify-center rounded-full bg-[var(--grass-9)] text-black transition-[opacity,transform] duration-300 ease-[var(--ease-out)]', done ? 'scale-100 opacity-100' : 'scale-50 opacity-0')}>
          <CheckIcon size={11} weight="bold" />
        </span>
      </div>
      <div className={cn('mt-2 flex items-center gap-1.5 text-[11.5px] transition-opacity duration-300', done ? 'opacity-100' : 'opacity-0')}>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-white/75">Pessoa coletiva</span>
        <span className="text-white/40">dígito de controlo válido</span>
      </div>
    </div>
  )
}

/* ── IVA: the same three rates, in three places ── */
const REGIONS: [string, number[]][] = [
  ['Continente', [23, 13, 6]],
  ['Madeira', [22, 12, 4]],
  ['Açores', [16, 9, 4]],
]
function IvaVisual({ on }: { on: boolean }) {
  const [r, setR] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setR((x) => (x + 1) % REGIONS.length), 2200)
    return () => clearInterval(t)
  }, [on])
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="relative grid grid-cols-3 rounded-full bg-white/[0.04] p-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
        <span className="absolute inset-y-1 left-1 w-[calc((100%-8px)/3)] rounded-full bg-white/[0.1] transition-transform duration-500 ease-[var(--ease-out)]" style={{ transform: `translateX(${r * 100}%)` }} />
        {REGIONS.map(([name], i) => (
          <span key={name} className={cn('relative z-[1] py-1 text-center text-[11px] transition-colors duration-300', i === r ? 'text-white' : 'text-white/40')}>
            {name}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['Normal', 'Intermédia', 'Reduzida'].map((label, i) => (
          <div key={label} className="rounded-[10px] bg-white/[0.03] px-2.5 py-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
            <div className="flex items-baseline text-[20px] font-medium tracking-[-0.03em] text-white">
              <NumberFlow value={REGIONS[r][1][i]} className="tabular" />
              <span className="text-[12px] text-white/45">%</span>
            </div>
            <div className="text-[10.5px] text-white/40">{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Calendar: June, as a forecaster sees it ── */
function CalendarVisual({ on }: { on: boolean }) {
  // June 2026 starts on a Monday.
  const days = Array.from({ length: 30 }, (_, i) => i + 1)
  const marks: Record<number, 'nat' | 'lis' | 'por'> = { 4: 'nat', 10: 'nat', 13: 'lis', 24: 'por' }
  return (
    <div className="flex w-full items-center gap-4">
      <div className="grid flex-1 grid-cols-7 gap-[3px]">
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
          <span key={i} className="pb-0.5 text-center text-[9px] text-white/30">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const m = marks[d]
          return (
            <span
              key={d}
              className={cn(
                'tabular flex h-[17px] items-center justify-center rounded-[4px] text-[9.5px] transition-[background-color,color,box-shadow] duration-500',
                !m && 'text-white/35',
                m === 'nat' && (on ? 'bg-white/[0.1] text-white' : 'text-white/35'),
                m === 'lis' && (on ? 'bg-[#ff5b1f] font-medium text-black shadow-[0_0_14px_rgb(255_91_31/0.7)]' : 'text-white/35'),
                m === 'por' && (on ? 'bg-[#ffb48a] font-medium text-black' : 'text-white/35'),
              )}
              style={{ transitionDelay: on ? `${(d % 7) * 60}ms` : '0ms' }}
            >
              {d}
            </span>
          )
        })}
      </div>
      <div className="w-[118px] shrink-0 space-y-2 text-[11px]">
        <div className="flex items-center justify-between text-white/80">
          <span>13 · Sto. António</span>
          <span className="text-[#ffb48a]">×1,6</span>
        </div>
        <div className="flex items-center justify-between text-white/60">
          <span>24 · S. João</span>
          <span className="text-white/45">Porto</span>
        </div>
        <div className="flex items-center justify-between text-white/60">
          <span>4 · 10</span>
          <span className="text-white/45">feriados</span>
        </div>
      </div>
    </div>
  )
}

/* ── AT: the closing inventory, already in the right shape ── */
function AtVisual({ on }: { on: boolean }) {
  const rows = [
    ['M', 'WIN-VIN-114', '6', 'UN'],
    ['M', 'PAN-SAR-100', '71', 'UN'],
    ['M', 'CHS-QSE-110', '12,4', 'KG'],
  ]
  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
        <div className="grid grid-cols-[22px_1fr_44px_30px] gap-2 bg-white/[0.04] px-2.5 py-1.5 font-mono text-[9.5px] text-white/40">
          <span>Cat</span>
          <span>ProductCode</span>
          <span className="text-right">Qty</span>
          <span>Un</span>
        </div>
        {rows.map((r, i) => (
          <div key={r[1]} className={cn('grid grid-cols-[22px_1fr_44px_30px] gap-2 border-t border-white/[0.05] px-2.5 py-1.5 font-mono text-[10.5px] text-white/75 transition-[opacity,transform] duration-500 ease-[var(--ease-out)]', on ? 'opacity-100' : 'translate-y-1 opacity-0')} style={{ transitionDelay: on ? `${200 + i * 140}ms` : '0ms' }}>
            <span>{r[0]}</span>
            <span>{r[1]}</span>
            <span className="text-right">{r[2]}</span>
            <span>{r[3]}</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-[11px] text-white/40">Portaria n.º 2/2015</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-black">
          <DownloadSimpleIcon size={11} weight="bold" /> inventario_2026.csv
        </span>
      </div>
    </div>
  )
}

/* ── Orders: written the way suppliers expect them ── */
function OrderEmail({ on }: { on: boolean }) {
  const lines = ['24 × Vinho Verde Alvarinho 75cl', '6 × Colares Ramisco 50cl', '12 × Queijo da Serra DOP']
  return (
    <div className="w-full max-w-[460px] rounded-[14px] bg-white/[0.03] text-left shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
      <div className="space-y-1 border-b border-white/[0.06] px-4 py-3 text-[11.5px]">
        <div className="flex gap-2">
          <span className="w-14 text-white/35">Para</span>
          <span className="text-white/80">Paulo · Quinta das Pedras</span>
        </div>
        <div className="flex gap-2">
          <span className="w-14 text-white/35">Assunto</span>
          <span className="text-white/80">Encomenda EC-141 · Casa Ribeira</span>
        </div>
      </div>
      <div className="px-4 py-3 text-[12px] leading-relaxed text-white/70">
        <p>Bom dia Paulo,</p>
        <p className="mt-1">Segue a nossa encomenda, para entrega na quinta-feira no armazém de Marvila:</p>
        <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-white/85">
          {lines.map((l, i) => (
            <li key={l} className={cn('transition-opacity duration-500', on ? 'opacity-100' : 'opacity-0')} style={{ transitionDelay: on ? `${300 + i * 220}ms` : '0ms' }}>
              {l}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-white/45">NIF 508 123 453 · Obrigado!</p>
      </div>
    </div>
  )
}

/* ───────────────────────── The index ───────────────────────── */

const ITEMS: { word: string; title: string; body: string; V: (p: { on: boolean }) => ReactNode }[] = [
  { word: 'SAF-T', title: 'Entra o SAF-T, sai o stock', body: 'Continuas no teu software de faturação certificado. Largas o ficheiro e cada linha de fatura passa a movimento de stock — sem plugins.', V: SaftVisual },
  { word: 'NIF', title: 'NIF que se valida sozinho', body: 'Validado enquanto escreves, com o tipo de entidade. Acabaram as gralhas nas encomendas.', V: NifVisual },
  { word: 'IVA', title: 'IVA do continente e das ilhas', body: '23, 13 e 6% — e as taxas da Madeira e dos Açores quando vendes lá.', V: IvaVisual },
  { word: 'Inventário AT', title: 'O ficheiro de inventário da AT', body: 'O inventário de fecho no formato da portaria, num clique, pronto para 31 de janeiro.', V: AtVisual },
  { word: 'Santo António', title: 'Um calendário que conhece Portugal', body: 'Feriados, Páscoa, Santo António e São João entram em cada previsão.', V: CalendarVisual },
  { word: 'Encomendas', title: 'Encomendas como os fornecedores gostam', body: 'Em português, com o teu NIF, a morada e a data de entrega. Aprovas no Nau e segue pelo teu email.', V: OrderEmail },
]

function Detail({ i, on, className }: { i: number; on: boolean; className?: string }) {
  const it = ITEMS[i]
  return (
    <div className={className}>
      <div className="relative flex h-[220px] items-center justify-center lg:h-[250px] overflow-hidden rounded-[18px] bg-black/35 px-5 font-sans shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]">
        <it.V on={on} />
      </div>
      <div className="px-2 pt-5 pb-2">
        <h3 className="text-[19px] font-medium tracking-[-0.02em] text-white">{it.title}</h3>
        <p className="mt-1.5 text-[14.5px] leading-[1.6] text-white/52">{it.body}</p>
      </div>
    </div>
  )
}

/** A typographic index: six words at full size. The one you are on lights up and shows its instrument. */
export function Portugal() {
  const root = useRef<HTMLElement>(null)
  const [active, setActive] = useState(0)
  const [panel, seen] = useInView<HTMLDivElement>(0.3)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      // On wide screens the word crossing the middle of the window takes the light.
      mm.add('(min-width: 1024px)', () => {
        gsap.utils.toArray<HTMLElement>('[data-word]').forEach((el, i) => {
          ScrollTrigger.create({ trigger: el, start: 'top 56%', end: 'bottom 56%', onToggle: (self) => self.isActive && setActive(i) })
        })
      })
    },
    { scope: root },
  )

  // The marker slides to the word that holds the light.
  useGSAP(
    () => {
      const el = root.current?.querySelectorAll<HTMLElement>('[data-word]')[active]
      const list = root.current?.querySelector<HTMLElement>('[role="tablist"]')
      if (!el || !list) return
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const y = el.getBoundingClientRect().top - list.getBoundingClientRect().top + el.offsetHeight * 0.52
      gsap.to('[data-marker]', { y, opacity: 1, duration: reduce ? 0 : 0.7, ease: 'expo.out', overwrite: true })
    },
    { dependencies: [active], scope: root },
  )

  return (
    <section id="portugal" ref={root} aria-labelledby="pt-title" className="relative scroll-mt-20">
      <Rule />
      <Container className="pt-28 pb-28 md:pt-40 md:pb-40">
        <div className="grid gap-x-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,430px)]">
          <div>
            <h2 id="pt-title" data-lines className="max-w-[26ch] text-[clamp(1.5rem,2.3vw,2rem)] leading-[1.18] font-medium tracking-[-0.025em] text-white">
              Feito para Portugal. <span className="text-white/38">Os detalhes que o teu contabilista vai notar.</span>
            </h2>

            <ul role="tablist" aria-orientation="vertical" aria-labelledby="pt-title" className="relative mt-12 md:mt-16">
              <span data-marker aria-hidden className="absolute top-0 left-0 hidden h-[3px] w-7 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#ff5b1f] to-[#ffb48a] opacity-0 shadow-[0_0_14px_rgb(255_91_31/0.8)] lg:block" />
              {ITEMS.map((it, i) => {
                const on = i === active
                return (
                  <li key={it.word} data-reveal>
                    <button
                      type="button"
                      role="tab"
                      id={`pt-tab-${i}`}
                      aria-selected={on}
                      aria-controls="pt-panel"
                      data-word
                      onClick={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(i)}
                      className="group block w-full text-left text-[clamp(2.6rem,7.1vw,6.4rem)] leading-[1.06] font-medium tracking-[-0.045em] outline-none"
                    >
                      <span className={cn('relative inline-block transition-transform duration-500 ease-[var(--ease-out)] motion-reduce:transition-none', on && 'lg:translate-x-11')}>
                        <span className={cn('transition-colors duration-300', on ? 'text-transparent' : 'text-white/[0.17] group-hover:text-white/40 group-focus-visible:text-white/40')}>{it.word}</span>
                        <span aria-hidden className={cn('text-ember absolute inset-0 pb-[0.12em] transition-opacity duration-300', on ? 'opacity-100' : 'opacity-0')}>
                          {it.word}
                        </span>
                      </span>
                    </button>
                    {/* Phones and tablets: the instrument opens under its word */}
                    <div className={cn('grid transition-[grid-template-rows,opacity] duration-500 ease-[var(--ease-out)] motion-reduce:transition-none lg:hidden', on ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
                      <div className="min-h-0 overflow-hidden">
                        <Detail i={i} on={on} className="pt-4 pb-7" />
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Wide screens: one panel that stays with you while the words pass */}
          <div className="hidden lg:block">
            <div ref={panel} className="sticky top-[max(96px,calc(50svh-235px))]">
            <div id="pt-panel" role="tabpanel" aria-labelledby={`pt-tab-${active}`} className="spot rounded-[26px] p-2.5">
              <div className="grid">
                {ITEMS.map((it, i) => (
                  <div key={it.word} aria-hidden={i !== active} className={cn('col-start-1 row-start-1 transition-[opacity,transform,filter] duration-500 ease-[var(--ease-out)] motion-reduce:transition-none', i === active ? 'opacity-100' : 'pointer-events-none translate-y-2 opacity-0 blur-[4px]')}>
                    <Detail i={i} on={i === active && seen} />
                  </div>
                ))}
              </div>
              <div aria-hidden className="flex gap-1.5 px-2 pt-3 pb-2">
                {ITEMS.map((it, i) => (
                  <span key={it.word} className={cn('h-[3px] rounded-full transition-[width,background-color] duration-500 ease-[var(--ease-out)]', i === active ? 'w-8 bg-[#ff5b1f]' : 'w-3 bg-white/15')} />
                ))}
              </div>
            </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
