import { useEffect, useRef, type MouseEvent } from 'react'
import { currentLang, hasChosenLang, homePath, locale, rememberLang, tr } from '~/i18n'
import { LANDING_ONLY, href } from '~/lib/site'
import { FrameLines, useReveal } from './frame'
import { SiteNav } from './nav'
import { Hero } from './hero'
import { Bento } from './bento'
import { AutopilotSection } from './autopilot'
import { OperatorSection } from './operator'
import { DashboardSection } from './dashboard'
import { Portugal } from './portugal'
import { Install } from './install'
import { Faq } from './faq'
import { Closing } from './closing'

const SITE = ((import.meta.env.VITE_SITE_URL as string | undefined) ?? '').replace(/\/$/, '')

/** Head for both front doors: `/` in Portuguese, `/en` in English, each pointing at the other. */
export const landingHead = () => {
  const title = tr('Nau — o stock que se gere sozinho')
  const description = tr('Stock, receção de mercadoria e encomendas para negócios em Portugal, com um operador de IA que faz o trabalho e pergunta antes de gastar. Código aberto.')
  const origin = SITE ? new URL(SITE).origin : ''
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:image', content: `${SITE}${SITE ? '' : href('')}/og.png` },
      { property: 'og:locale', content: currentLang() === 'pt' ? 'pt_PT' : 'en_GB' },
    ],
    links: [
      { rel: 'alternate', hrefLang: 'pt', href: `${origin}${homePath('pt')}` },
      { rel: 'alternate', hrefLang: 'en', href: `${origin}${homePath('en')}` },
      { rel: 'alternate', hrefLang: 'x-default', href: `${origin}${homePath('pt')}` },
    ],
  }
}

export function Landing() {
  const root = useRef<HTMLDivElement>(null)
  useReveal(root)
  // A first visit keeps the language of the door it came through
  useEffect(() => {
    if (!hasChosenLang()) rememberLang(currentLang())
  }, [])
  // The static website is the landing page alone: a link that would lead into the app leads to the install chapter instead
  const stayOnSite = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a || !a.href) return
    const to = new URL(a.href, window.location.href)
    if (to.origin !== window.location.origin || to.pathname.replace(/\/$/, '') === window.location.pathname.replace(/\/$/, '') || to.pathname.replace(/\/$/, '') === homePath('pt').replace(/\/$/, '') || to.pathname === homePath('en')) return
    e.preventDefault()
    e.stopPropagation()
    document.querySelector('#install')?.scrollIntoView({ behavior: 'smooth' })
  }
  return (
    <div ref={root} lang={locale()} onClickCapture={LANDING_ONLY ? stayOnSite : undefined} className="dark relative min-h-dvh overflow-x-clip bg-[#0a0a0a] font-display text-white antialiased" style={{ colorScheme: 'dark' }}>
      <FrameLines />
      <SiteNav />
      <main className="relative">
        <Hero />
        <Bento />
        <AutopilotSection />
        <OperatorSection />
        <DashboardSection />
        <Portugal />
        <Install />
        <Faq />
      </main>
      <Closing />
    </div>
  )
}
