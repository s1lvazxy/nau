import { useEffect, useRef, useState, type ReactNode } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { useGSAP } from '@gsap/react'
import { cn } from '~/lib/utils'

if (typeof window !== 'undefined') gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP)

export { gsap, ScrollTrigger, SplitText, useGSAP }

/** The website sits on a quiet construction frame: two hairlines down the page, rules between chapters. */
export const FRAME = 'mx-auto w-full max-w-[1248px]'

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn(FRAME, 'px-6 md:px-12', className)}>{children}</div>
}

export function FrameLines() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] hidden md:block">
      <div className={cn(FRAME, 'h-full border-x border-white/[0.06]')} />
    </div>
  )
}

export function Rule({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('relative z-[2] h-px bg-white/[0.07]', className)}>
      <div className={cn(FRAME, 'relative hidden h-px md:block')}>
        <span className="absolute -top-[2px] -left-[2.5px] size-[5px] rounded-full bg-white/30" />
        <span className="absolute -top-[2px] -right-[2.5px] size-[5px] rounded-full bg-white/30" />
      </div>
    </div>
  )
}

/** Section heading: one idea, an optional italic accent, and a short line of support. */
export function Heading({ id, title, accent, children, className, align = 'split' }: { id: string; title: ReactNode; accent?: ReactNode; children?: ReactNode; className?: string; align?: 'split' | 'center' }) {
  return (
    <div className={cn(align === 'center' ? 'mx-auto flex max-w-[760px] flex-col items-center text-center' : 'grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end lg:gap-14', className)}>
      <h2 id={id} data-lines className="max-w-[18ch] font-display text-[clamp(2.25rem,4.6vw,4rem)] leading-[1.02] font-medium tracking-[-0.035em] text-white">
        {title}
        {accent && (
          <>
            {' '}
            <span className="text-white/38">{accent}</span>
          </>
        )}
      </h2>
      {children && (
        <p data-reveal className={cn('max-w-[44ch] text-[16px] leading-[1.65] text-white/58', align === 'center' ? 'mt-5' : 'lg:pb-2')}>
          {children}
        </p>
      )}
    </div>
  )
}

/** A card that answers the pointer (see `.spot` in app.css). */
export function Spot({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null)
  const onPointerMove = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  return (
    <div ref={ref} onPointerMove={onPointerMove} className={cn('spot rounded-[22px]', className)} {...rest}>
      {children}
    </div>
  )
}

/** True while the element is on screen (or, with `once`, from the first time it is). */
export function useInView<T extends Element>(threshold = 0.35, once = false) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        setInView(e.isIntersecting)
        if (e.isIntersecting && once) io.disconnect()
      },
      { threshold },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold, once])
  return [ref, inView] as const
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/**
 * Page-level scroll choreography (GSAP):
 * - [data-lines] headings are split into lines and rise out of a mask, one line after the other;
 * - [data-reveal] blocks rise into place once, in small batches;
 * - ScrollTrigger re-measures whenever the page changes height (lazy sections, answers, accordions).
 * Reduced motion shows everything at rest.
 */
export function useReveal(root: React.RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.utils.toArray<HTMLElement>('[data-lines]').forEach((el) => {
          SplitText.create(el, {
            type: 'lines',
            mask: 'lines',
            linesClass: 'split-line',
            autoSplit: true,
            onSplit: (self) => {
              gsap.set(el, { opacity: 1 })
              return gsap.fromTo(self.lines, { yPercent: 118 }, { yPercent: 0, duration: 1.15, ease: 'expo.out', stagger: 0.09, scrollTrigger: { trigger: el, start: 'top 90%', once: true } })
            },
          })
        })
        const els = gsap.utils.toArray<HTMLElement>('[data-reveal]')
        gsap.set(els, { y: 18 })
        ScrollTrigger.batch(els, {
          start: 'top 90%',
          once: true,
          onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 1, ease: 'expo.out', stagger: 0.08, overwrite: true }),
        })
      })
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set('[data-reveal], [data-lines]', { opacity: 1, y: 0 })
      })

      const el = root.current
      if (!el) return
      let height = el.offsetHeight
      let timer: ReturnType<typeof setTimeout> | undefined
      const ro = new ResizeObserver(() => {
        if (Math.abs(el.offsetHeight - height) < 2) return
        height = el.offsetHeight
        clearTimeout(timer)
        timer = setTimeout(() => ScrollTrigger.refresh(), 180)
      })
      ro.observe(el)
      return () => {
        clearTimeout(timer)
        ro.disconnect()
      }
    },
    { scope: root },
  )
}
