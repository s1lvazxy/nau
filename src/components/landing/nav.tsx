import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from '@phosphor-icons/react'
import { Logo } from '~/components/brand/logo'
import { cn } from '~/lib/utils'
import { REPO_URL } from '~/lib/site'
import { FRAME, gsap, useGSAP } from './frame'

const LINKS: [string, string][] = [
  ['Produto', '/#product'],
  ['Autopiloto', '/#autopilot'],
  ['Operador', '/#operator'],
  ['Portugal', '/#portugal'],
  ['Código', REPO_URL],
]

/** Floating navigation: a centred glass rail whose highlight follows the pointer, and a full-screen menu on phones. */
export function SiteNav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const rail = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLSpanElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const progress = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const on = () => {
      setScrolled(window.scrollY > 12)
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (progress.current) progress.current.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`
    }
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  useEffect(() => {
    document.documentElement.style.overflow = open ? 'hidden' : ''
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('keydown', esc)
      document.documentElement.style.overflow = ''
    }
  }, [open])

  const { contextSafe } = useGSAP({ scope: rail })
  const highlight = contextSafe((el: HTMLElement | null) => {
    const p = pill.current
    if (!p) return
    if (!el) return void gsap.to(p, { opacity: 0, duration: 0.25, ease: 'power2.out' })
    const first = Number(gsap.getProperty(p, 'opacity')) < 0.05
    if (first) gsap.set(p, { x: el.offsetLeft, width: el.offsetWidth })
    gsap.to(p, { x: el.offsetLeft, width: el.offsetWidth, opacity: 1, duration: first ? 0.2 : 0.4, ease: 'power3.out' })
  })

  useGSAP(
    () => {
      if (!open) return
      gsap.fromTo('[data-menu-item]', { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out', stagger: 0.05 })
    },
    { dependencies: [open], scope: sheet },
  )

  return (
    <header className={cn('fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow] duration-300', scrolled && !open ? 'bg-[#0a0a0a]/72 shadow-[0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl' : 'bg-transparent')}>
      <div className={cn(FRAME, 'relative flex h-[72px] items-center px-6 md:px-12')}>
        <Link to="/" aria-label="Nau — início" className="relative z-[2] text-white" onClick={() => setOpen(false)}>
          <Logo size={21} className="text-white" />
        </Link>

        <nav aria-label="Secções" className="absolute left-1/2 hidden -translate-x-1/2 lg:block">
          <div ref={rail} onPointerLeave={() => highlight(null)} className="relative flex items-center rounded-full bg-white/[0.035] p-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] backdrop-blur-xl">
            <span ref={pill} aria-hidden className="absolute top-1 left-0 h-8 rounded-full bg-white/[0.08] opacity-0" />
            {LINKS.map(([label, href]) => (
              <a key={label} href={href} onPointerEnter={(e) => highlight(e.currentTarget)} onFocus={(e) => highlight(e.currentTarget)} className="relative z-[1] flex h-8 items-center rounded-full px-4 text-[13.5px] text-white/62 transition-colors duration-200 hover:text-white">
                {label}
              </a>
            ))}
          </div>
        </nav>

        <div className="relative z-[2] ml-auto flex items-center gap-1.5">
          <Link to="/login" className="hidden h-9 items-center rounded-full px-3.5 text-[13.5px] text-white/70 transition-colors hover:text-white sm:inline-flex">
            Entrar
          </Link>
          <Link to="/signup" className="press group hidden h-9 items-center gap-1.5 rounded-full bg-white pr-3.5 pl-4 text-[13.5px] font-medium text-black transition-colors hover:bg-white/90 sm:inline-flex">
            Começar
            <ArrowRightIcon size={13} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
          <button type="button" aria-expanded={open} aria-controls="site-menu" aria-label={open ? 'Fechar menu' : 'Abrir menu'} onClick={() => setOpen((o) => !o)} className="flex size-10 items-center justify-center rounded-full text-white lg:hidden">
            <span className="relative block h-3 w-5">
              <span className={cn('absolute left-0 h-[1.5px] w-5 rounded-full bg-current transition-transform duration-300 ease-[var(--ease-out)]', open ? 'top-[5px] rotate-45' : 'top-0')} />
              <span className={cn('absolute left-0 h-[1.5px] w-5 rounded-full bg-current transition-transform duration-300 ease-[var(--ease-out)]', open ? 'top-[5px] -rotate-45' : 'top-[10px]')} />
            </span>
          </button>
        </div>
      </div>
      <span aria-hidden ref={progress} className="absolute inset-x-0 bottom-0 h-px origin-left bg-gradient-to-r from-[#ff5b1f]/0 via-[#ff5b1f] to-[#ffb48a]" style={{ transform: 'scaleX(0)' }} />

      {open && (
        <div id="site-menu" ref={sheet} className="fixed inset-0 top-0 z-[1] flex flex-col bg-[#0a0a0a] px-6 pt-24 pb-10 lg:hidden">
          <nav aria-label="Menu" className="flex flex-col">
            {LINKS.map(([label, href]) => (
              <a key={label} data-menu-item href={href} onClick={() => setOpen(false)} className="border-b border-white/[0.07] py-4 font-display text-[34px] leading-none font-medium tracking-[-0.03em] text-white">
                {label}
              </a>
            ))}
          </nav>
          <div data-menu-item className="mt-auto flex flex-col gap-2.5">
            <Link to="/signup" className="flex h-12 items-center justify-center rounded-full bg-white text-[15px] font-medium text-black">
              Começar
            </Link>
            <Link to="/login" className="flex h-12 items-center justify-center rounded-full text-[15px] text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16)]">
              Entrar
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
