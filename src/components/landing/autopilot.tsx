import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRightIcon, CheckIcon } from '@phosphor-icons/react'
import { cn } from '~/lib/utils'
import { gsap, useGSAP, useReducedMotion } from './frame'

/* One autopilot run, driven by the scroll: six checks, each one sending what it found into the count. */

const CHECKS = [
  { name: 'Reposição', found: '3 encomendas · 1 940 €', adds: 3 },
  { name: 'Validades', found: '8 lotes expiram em 3 dias', adds: 4 },
  { name: 'Preços de custo', found: '2 subiram mais de 5%', adds: 2 },
  { name: 'Entre lojas', found: '20 cápsulas para o Príncipe Real', adds: 1 },
  { name: 'Stock parado', found: '372 € sem vendas há 45 dias', adds: 2 },
  { name: 'Contagens', found: '8 artigos de valor por confirmar', adds: 2 },
]
const TOTAL = CHECKS.reduce((a, c) => a + c.adds, 0)
const CUM = CHECKS.map((_, i) => CHECKS.slice(0, i + 1).reduce((a, c) => a + c.adds, 0))
/** A check takes one beat: most of it travelling the wire, the rest landing in the count. */
const TRAVEL = 0.72
/** How far up the numeral the light has risen for a given count. */
const level = (count: number) => (count <= 0 ? 104 : count >= TOTAL ? -12 : 84 - (count / TOTAL) * 66)
const clip = (count: number) => `inset(${level(count)}% -12% -12% -12%)`

type State = 'idle' | 'running' | 'done'

function Glyph({ state }: { state: State }) {
  return (
    <span className="relative flex size-[18px] shrink-0 items-center justify-center">
      <span className={cn('absolute size-2.5 rounded-full transition-[transform,background-color,box-shadow] duration-300 ease-[var(--ease-out)]', state === 'idle' && 'shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.25)]', state === 'running' && 'scale-110 bg-[#ff5b1f] shadow-[0_0_14px_rgb(255_91_31/0.95)]', state === 'done' && 'scale-[1.8] bg-white')} />
      <CheckIcon size={10} weight="bold" className={cn('relative text-black transition-[opacity,transform] duration-300 ease-[var(--ease-out)]', state === 'done' ? 'scale-100 opacity-100' : 'scale-50 opacity-0')} />
    </span>
  )
}

function Wire({ flip }: { flip?: boolean }) {
  return (
    <span aria-hidden className="relative block h-px w-[clamp(40px,7vw,128px)] shrink-0 bg-white/10">
      <span data-wire className={cn('absolute inset-0 from-[#ff5b1f]/0 to-[#ffb48a]', flip ? 'origin-right bg-gradient-to-l' : 'origin-left bg-gradient-to-r')} style={{ transform: 'scaleX(0)' }} />
      <span data-spark={flip ? 'left' : 'right'} className={cn('absolute -top-[3px] size-[7px] rounded-full bg-[#ffe6d6] opacity-0 shadow-[0_0_14px_3px_rgb(255_91_31/0.9)]', flip ? 'right-0' : 'left-0')} />
    </span>
  )
}

function Check({ i, state, side }: { i: number; state: State; side: 'left' | 'right' }) {
  const c = CHECKS[i]
  const text = (
    <span className={cn('min-w-0 flex-1', side === 'left' ? 'text-right' : 'text-left')}>
      <span className={cn('block text-[clamp(1.05rem,1.55vw,1.4rem)] leading-tight font-medium tracking-[-0.02em] transition-colors duration-500', state === 'idle' ? 'text-white/30' : 'text-white')}>{c.name}</span>
      <span className={cn('mt-1 block h-5 truncate text-[13.5px] transition-[opacity,color] duration-500', state === 'done' ? 'text-white/55 opacity-100' : state === 'running' ? 'text-[#ffb48a] opacity-100' : 'opacity-0')}>{state === 'running' ? 'a verificar…' : c.found}</span>
    </span>
  )
  return (
    <li className="flex items-center gap-4 py-[clamp(10px,2.4vh,24px)]">
      {side === 'left' ? (
        <>
          {text}
          <Glyph state={state} />
          <Wire />
        </>
      ) : (
        <>
          <Wire flip />
          <Glyph state={state} />
          {text}
        </>
      )}
    </li>
  )
}

function Numeral({ count }: { count: number }) {
  return (
    <div data-count className="relative text-center font-medium tracking-[-0.06em] tabular-nums" style={{ width: '1.32em', lineHeight: 0.84 }}>
      <span className="block" style={{ color: '#0c0c0c', WebkitTextStroke: '2px rgb(255 255 255 / 0.17)', paintOrder: 'stroke fill' }}>
        {count}
      </span>
      <span data-fill aria-hidden className="absolute inset-0 block bg-[linear-gradient(180deg,#ffe2cf_8%,#ff9a5c_48%,#ff5b1f_92%)] bg-clip-text text-transparent" style={{ clipPath: clip(0) }}>
        {count}
      </span>
    </div>
  )
}

export function AutopilotSection() {
  const track = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const [time, setTime] = useState(0)
  const done = reduced ? CHECKS.length : CHECKS.filter((_, i) => time >= i + TRAVEL).length
  const running = reduced || time >= CHECKS.length || time <= 0.02 ? -1 : time - Math.floor(time) < TRAVEL ? Math.floor(time) : -1
  const count = done ? CUM[done - 1] : 0
  const stateOf = (i: number): State => (i < done ? 'done' : i === running ? 'running' : 'idle')

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: { trigger: track.current, start: 'top top', end: 'bottom bottom', scrub: 0.45, invalidateOnRefresh: true },
        })
        // React follows the playhead itself (not its events), so a re-measure can never leave the two apart.
        // Quantised: it only hears about the moments that change what is shown.
        let last = -1
        const sync = () => {
          const t = Math.round(tl.time() * 50) / 50
          const key = Math.floor(t) * 10 + (t - Math.floor(t) < TRAVEL ? 0 : 1) + (t <= 0.02 ? 100 : 0)
          if (key === last) return
          last = key
          setTime(t)
        }
        gsap.ticker.add(sync)
        for (const layout of ['wide', 'narrow']) {
          const wires = gsap.utils.toArray<HTMLElement>(`[data-layout="${layout}"] [data-wire]`)
          const sparks = gsap.utils.toArray<HTMLElement>(`[data-layout="${layout}"] [data-spark]`)
          wires.forEach((w, i) => {
            tl.fromTo(w, { scaleX: 0 }, { scaleX: 1, duration: TRAVEL }, i)
            const s = sparks[i]
            if (!s) return
            const dir = s.dataset.spark === 'left' ? -1 : 1
            tl.fromTo(s, { x: 0, opacity: 0, scale: 1 }, { x: () => dir * (w.parentElement?.offsetWidth ?? 0), opacity: 1, duration: TRAVEL }, i).to(s, { opacity: 0, scale: 2.4, duration: 0.12 }, i + TRAVEL)
          })
        }
        gsap.utils.toArray<HTMLElement>('[data-fill]').forEach((f) => {
          CHECKS.forEach((_, i) => tl.fromTo(f, { clipPath: clip(i ? CUM[i - 1] : 0) }, { clipPath: clip(CUM[i]), duration: 1 - TRAVEL, ease: 'power1.out', immediateRender: i === 0 }, i + TRAVEL))
        })
        tl.fromTo('[data-glow]', { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: CHECKS.length }, 0).to({}, { duration: 0.7 })
        return () => gsap.ticker.remove(sync)
      })
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set('[data-wire]', { scaleX: 1 })
        gsap.set('[data-fill]', { clipPath: clip(TOTAL) })
        gsap.set('[data-glow]', { opacity: 1 })
      })
    },
    { scope: track },
  )

  // The count lands with a small settle each time a check delivers.
  const first = useRef(true)
  useGSAP(
    () => {
      if (first.current) return void (first.current = false)
      if (reduced) return
      gsap.fromTo('[data-count]', { scale: 1.04 }, { scale: 1, duration: 0.6, ease: 'expo.out', overwrite: true })
    },
    { dependencies: [count], scope: track },
  )

  const finished = done === CHECKS.length
  return (
    <section id="autopilot" aria-labelledby="pilot-title" className="relative scroll-mt-20">
      <div ref={track} className="relative" style={{ height: reduced ? undefined : '250vh' }}>
        <div className={cn('isolate flex flex-col items-center overflow-hidden px-6', reduced ? 'relative py-28' : 'sticky top-0 h-svh justify-center pt-[72px]')}>
          <div data-glow aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -z-[1] aspect-square w-[min(1100px,120vw)] -translate-x-1/2 -translate-y-[42%] rounded-full bg-[radial-gradient(closest-side,rgb(255_91_31/0.2),rgb(255_91_31/0.05)_55%,transparent)] opacity-0" />

          <h2 id="pilot-title" data-lines className="text-center text-[clamp(1.6rem,3vw,2.75rem)] leading-[1.05] font-medium tracking-[-0.03em] text-white">
            De hora a hora, <span className="text-white/38">sem pedir.</span>
          </h2>

          {/* Wide: the count in the middle, three checks feeding it from each side */}
          <div data-layout="wide" className="mt-[clamp(8px,3vh,36px)] hidden w-full max-w-[1180px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center lg:grid" style={{ fontSize: 'clamp(9rem, min(40vh, 25vw), 23rem)' }}>
            <ul className="text-base">
              {[0, 1, 2].map((i) => (
                <Check key={i} i={i} state={stateOf(i)} side="left" />
              ))}
            </ul>
            <Numeral count={count} />
            <ul className="text-base">
              {[3, 4, 5].map((i) => (
                <Check key={i} i={i} state={stateOf(i)} side="right" />
              ))}
            </ul>
          </div>

          {/* Narrow: the count on top, the run as a list beneath it */}
          <div data-layout="narrow" className="mt-4 flex w-full max-w-[520px] flex-col items-center lg:hidden">
            <div style={{ fontSize: 'clamp(6.5rem, min(22vh, 42vw), 12rem)' }}>
              <Numeral count={count} />
            </div>
            <ul className="mt-[clamp(8px,2vh,20px)] w-full">
              {CHECKS.map((c, i) => {
                const st = stateOf(i)
                return (
                  <li key={c.name} className="relative flex items-center gap-3 py-[clamp(8px,1.5vh,13px)]">
                    <Glyph state={st} />
                    <span className={cn('text-[15.5px] font-medium tracking-[-0.01em] transition-colors duration-500', st === 'idle' ? 'text-white/30' : 'text-white')}>{c.name}</span>
                    <span className={cn('ml-auto min-w-0 truncate text-[12.5px] transition-opacity duration-500', st === 'done' ? 'text-white/50 opacity-100' : st === 'running' ? 'text-[#ffb48a] opacity-100' : 'opacity-0')}>{st === 'running' ? 'a verificar…' : c.found}</span>
                    <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-white/[0.08]">
                      <span data-wire className="absolute inset-0 origin-left bg-gradient-to-r from-[#ff5b1f]/0 to-[#ffb48a]" style={{ transform: 'scaleX(0)' }} />
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="mt-[clamp(10px,3vh,34px)] flex flex-col items-center gap-4">
            <p className="text-center text-[15px] text-white/55">
              {count === 1 ? 'proposta pronta' : 'propostas prontas'} para aprovares, <span className="text-white/80">cada uma com a sua razão</span>.
            </p>
            <Link to="/demo" tabIndex={finished ? 0 : -1} aria-hidden={!finished} className={cn('press group inline-flex h-10 items-center gap-2 rounded-full bg-white/[0.05] pr-4 pl-5 text-[14px] font-medium text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)] transition-[opacity,transform,background-color] duration-500 ease-[var(--ease-out)] hover:bg-white/[0.09]', finished ? 'opacity-100' : 'pointer-events-none translate-y-1.5 opacity-0')}>
              Ver as {TOTAL} na demo
              <ArrowRightIcon size={13} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
