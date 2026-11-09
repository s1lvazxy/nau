import { useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRightIcon, ArrowUpRightIcon } from '@phosphor-icons/react'
import { Logo } from '~/components/brand/logo'
import { REPO_URL } from '~/lib/site'
import { Container, Rule, gsap, useGSAP } from './frame'
import { GlassRose } from './rose/glass-rose'

const COLUMNS: [string, [string, string][]][] = [
  ['Produto', [['Demo ao vivo', '/demo'], ['Código no GitHub', REPO_URL], ['Operador', '/#operator'], ['Entrar', '/login']]],
  ['Empresa', [['Contacto', '/contact'], ['Marca', '/brand']]],
  ['Legal', [['Termos', '/legal/terms'], ['Privacidade', '/legal/privacy'], ['Tratamento de dados', '/legal/dpa']]],
]

/** The page ends where it began: the glass rose, now centred, with the last call to action around its light. */
export function Closing() {
  const root = useRef<HTMLElement>(null)
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const st = { trigger: '[data-footer-card]', start: 'top 85%', end: 'bottom bottom', scrub: 0.6 }
        gsap.fromTo('[data-wordmark]', { yPercent: 38, filter: 'blur(14px)', opacity: 0.4 }, { yPercent: 0, filter: 'blur(0px)', opacity: 1, ease: 'none', scrollTrigger: st })
        gsap.fromTo('[data-footer-glow]', { opacity: 0.2, scale: 0.85 }, { opacity: 1, scale: 1, ease: 'none', scrollTrigger: st })
        // The rose drifts a little slower than the page, so the words pass over it.
        gsap.fromTo('[data-close-rose]', { yPercent: -7 }, { yPercent: 7, ease: 'none', scrollTrigger: { trigger: '[data-close-stage]', start: 'top bottom', end: 'bottom top', scrub: true } })
      })
    },
    { scope: root },
  )
  return (
    <section ref={root} aria-labelledby="close-title" className="relative">
      <Rule />
      <div data-close-stage className="relative isolate overflow-hidden" style={{ minHeight: 'max(96svh, 780px)' }}>
        <div data-close-rose className="absolute inset-x-0 -inset-y-[8%]">
          <GlassRose layout="closing" />
        </div>
        <div aria-hidden className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-[#0a0a0a] to-transparent" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#0a0a0a] to-transparent" />
        <Container className="relative z-[2] flex min-h-[inherit] flex-col items-center justify-between pt-24 pb-20 text-center md:pt-28">
          <h2 id="close-title" data-lines className="max-w-[13ch] text-[clamp(2.6rem,6.2vw,5.5rem)] leading-[0.98] font-medium tracking-[-0.042em] text-white [text-shadow:0_2px_30px_rgb(10_10_10/0.9)]">
            Entrega o armazém <span className="text-white/45">ao Nau.</span>
          </h2>
          <div className="flex flex-col items-center">
            <div data-reveal className="flex flex-wrap justify-center gap-2.5">
              <Link to="/signup" className="press group inline-flex h-12 items-center gap-2 rounded-full bg-white pr-5 pl-6 text-[15px] font-medium text-black shadow-[0_10px_40px_-10px_rgb(255_140_80/0.5)]">
                Começar <ArrowRightIcon size={14} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <Link to="/demo" className="press inline-flex h-12 items-center rounded-full bg-[#0a0a0a]/55 px-6 text-[15px] font-medium text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)] backdrop-blur-md transition-colors hover:bg-white/[0.1]">
                Ver a demo ao vivo
              </Link>
            </div>
            <p data-reveal className="mt-5 text-[13px] text-white/45">
              Código aberto. Traz uma folha de cálculo, o SAF-T do teu programa, ou começa pela loja de demonstração.
            </p>
          </div>
        </Container>
      </div>

      <footer className="px-3 pb-3 md:px-4 md:pb-4">
        <div data-footer-card className="relative isolate overflow-hidden rounded-[32px] bg-[#0f0f0f] shadow-[0_0_0_1px_rgb(255_255_255/0.07),inset_0_1px_0_rgb(255_255_255/0.05)]">
          <div data-footer-glow aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-[1] h-[80%] origin-bottom bg-[radial-gradient(60%_90%_at_70%_100%,rgb(255_91_31/0.55),rgb(255_91_31/0.12)_45%,transparent_75%)]" />
          <div className="mx-auto grid max-w-[1248px] gap-12 px-7 pt-14 md:grid-cols-[1.3fr_repeat(3,1fr)] md:px-12 md:pt-16">
            <div className="flex flex-col gap-4">
              <Logo size={22} className="text-white" />
              <p className="max-w-[30ch] text-[14px] leading-relaxed text-white/50">Stock, entregas e encomendas para negócios em Portugal — com um operador em cada turno.</p>
              <a href="mailto:hello@nau.pt" className="group mt-1 inline-flex w-fit items-center gap-1.5 text-[14px] text-white/80 transition-colors hover:text-white">
                hello@nau.pt <ArrowUpRightIcon size={13} className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </div>
            {COLUMNS.map(([h, links]) => (
              <nav key={h} aria-label={h} className="flex flex-col gap-3">
                <span className="text-[13px] text-white/35">{h}</span>
                {links.map(([l, to]) => (
                  <a key={l} href={to} className="w-fit text-[14.5px] text-white/75 transition-colors hover:text-white">
                    {l}
                  </a>
                ))}
              </nav>
            ))}
          </div>
          <div aria-hidden className="pointer-events-none mt-16 overflow-hidden px-4 md:mt-24">
            <div data-wordmark className="bg-gradient-to-b from-[#ffd9bd] via-[#ff8a4c] to-[#ff5b1f]/0 bg-clip-text text-center font-display text-[clamp(9rem,34vw,30rem)] leading-[0.78] font-semibold tracking-[-0.075em] text-transparent select-none">
              nau
            </div>
          </div>
          <div className="mx-auto flex max-w-[1248px] flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] px-7 py-6 text-[12.5px] text-white/45 md:px-12">
            <span>© {new Date().getFullYear()} Nau · Lisboa</span>
            <span>Código aberto · AGPL-3.0 · Feito em Portugal.</span>
          </div>
        </div>
      </footer>
    </section>
  )
}
