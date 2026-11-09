import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Container, FrameLines, Rule, useReveal } from '~/components/landing/frame'
import { SiteNav } from '~/components/landing/nav'
import { useRef } from 'react'

/** Secondary pages (brand, legal, contact) share the website's frame, navigation and type. */
export function PageShell({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  useReveal(root)
  return (
    <div ref={root} lang="pt-PT" className="dark relative min-h-dvh overflow-x-clip bg-[#0a0a0a] font-display text-ink antialiased" style={{ colorScheme: 'dark' }}>
      <FrameLines />
      <SiteNav />
      <main className="relative z-[2] pt-[96px] pb-28">{children}</main>
      <Rule />
      <Container className="relative z-[2] flex flex-wrap items-center justify-between gap-4 py-7 text-[12.5px] text-white/45">
        <span>© {new Date().getFullYear()} Nau · Lisboa</span>
        <span className="flex gap-5">
          <Link to="/legal/$doc" params={{ doc: 'terms' }} className="transition-colors hover:text-white">Termos</Link>
          <Link to="/legal/$doc" params={{ doc: 'privacy' }} className="transition-colors hover:text-white">Privacidade</Link>
          <Link to="/legal/$doc" params={{ doc: 'dpa' }} className="transition-colors hover:text-white">Dados</Link>
          <Link to="/brand" className="transition-colors hover:text-white">Marca</Link>
        </span>
      </Container>
    </div>
  )
}
