import { useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { FrameLines, useReveal } from '~/components/landing/frame'
import { SiteNav } from '~/components/landing/nav'
import { Hero } from '~/components/landing/hero'
import { Bento } from '~/components/landing/bento'
import { AutopilotSection } from '~/components/landing/autopilot'
import { OperatorSection } from '~/components/landing/operator'
import { DashboardSection } from '~/components/landing/dashboard'
import { Portugal } from '~/components/landing/portugal'
import { Faq } from '~/components/landing/faq'
import { Closing } from '~/components/landing/closing'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'Nau — o stock que se gere sozinho' },
      { name: 'description', content: 'Stock, receção de mercadoria e encomendas para negócios em Portugal, com um operador de IA que prepara o trabalho e pergunta antes de gastar.' },
      { property: 'og:title', content: 'Nau — o stock que se gere sozinho' },
      { property: 'og:locale', content: 'pt_PT' },
    ],
  }),
  component: Landing,
})

function Landing() {
  const root = useRef<HTMLDivElement>(null)
  useReveal(root)
  return (
    <div ref={root} lang="pt-PT" className="dark relative min-h-dvh overflow-x-clip bg-[#0a0a0a] font-display text-white antialiased" style={{ colorScheme: 'dark' }}>
      <FrameLines />
      <SiteNav />
      <main className="relative">
        <Hero />
        <Bento />
        <AutopilotSection />
        <OperatorSection />
        <DashboardSection />
        <Portugal />
        <Faq />
      </main>
      <Closing />
    </div>
  )
}
