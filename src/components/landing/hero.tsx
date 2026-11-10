import { useRef } from 'react'
import { ArrowRightIcon } from '@phosphor-icons/react'
import { tr } from '~/i18n'
import { LANDING_ONLY, REPO_URL, href } from '~/lib/site'
import { Container, gsap, useGSAP } from './frame'
import { GlassRose } from './rose/glass-rose'

/** Hero: the Nau mark as dark glass (vgpu / WebGPU). Raw data enters as one beam and leaves organised along the eight rays. */
export function Hero() {
  const root = useRef<HTMLElement>(null)
  useGSAP(
    () => {
      // Build the entrance now (so a remount reverts it cleanly) and only play it once fonts are in.
      // Explicit start and end values: a second mount can never read a half-played state as its target.
      let cancelled = false
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } })
        tl.set('[data-hero]', { opacity: 1 }, 0)
          .fromTo('[data-line]', { yPercent: 112 }, { yPercent: 0, duration: 1.3, stagger: 0.12 }, 0)
          .fromTo('[data-hero="sub"], [data-hero="cta"]', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 1.1, stagger: 0.08 }, 0.35)
          .fromTo('[data-hero="rose"]', { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: 2.2, ease: 'power2.out' }, 0)
        const play = () => {
          if (!cancelled && !tl.isActive() && tl.progress() === 0) tl.play()
        }
        void document.fonts.ready.then(play)
        // Never leave the hero hidden if fonts take too long
        const fallback = setTimeout(play, 1200)
        return () => clearTimeout(fallback)
      })
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set('[data-hero]', { opacity: 1 })
      })
      return () => {
        cancelled = true
      }
    },
    { scope: root },
  )

  return (
    <section ref={root} aria-labelledby="hero-title" className="relative isolate overflow-hidden" style={{ minHeight: 'max(100svh, 760px)' }}>
      <div data-hero="rose" className="absolute inset-0">
        <GlassRose layout="hero" />
      </div>
      {/* Keep the copy legible where the beams cross behind it */}
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,#0a0a0a_0%,rgb(10_10_10/0.75)_34%,transparent_62%)] max-lg:bg-[linear-gradient(0deg,#0a0a0a_0%,rgb(10_10_10/0.85)_42%,transparent_70%)]" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0a0a0a] to-transparent" />

      <Container className="relative z-[2] flex min-h-[inherit] flex-col justify-end pt-[120px] pb-16 lg:justify-center lg:pb-0">
        <div className="max-w-[620px] max-lg:pt-[44vh] lg:max-w-[min(620px,46vw)]">
          <h1 id="hero-title" data-hero="title" className="text-[clamp(3rem,6.6vw,6.25rem)] leading-[0.95] font-medium tracking-[-0.045em] text-white">
            <span className="block overflow-hidden pb-[0.06em]">
              <span data-line className="block">
                {tr('O stock que')}
              </span>
            </span>
            <span className="-mb-[0.18em] block overflow-hidden">
              <span data-line className="text-ember block pb-[0.18em]">
                {tr('se gere sozinho.')}
              </span>
            </span>
          </h1>
          <p data-hero="sub" className="mt-7 max-w-[42ch] text-[17px] leading-[1.6] text-white/62">
            {tr('Faturas, vendas e contagens entram desarrumadas. Saem encomendas prontas, alertas a tempo e o ficheiro para a AT — e nada é gasto sem o teu sim.')}
          </p>
          <div data-hero="cta" className="mt-9 flex flex-wrap gap-2.5">
            <a href={LANDING_ONLY ? '#install' : href('/signup')} className="press group inline-flex h-12 items-center gap-2 rounded-full bg-white pr-5 pl-6 text-[15px] font-medium text-black shadow-[0_0_0_1px_rgb(255_255_255/0.2),0_10px_40px_-10px_rgb(255_140_80/0.45)]">
              {tr('Começar')}
              <ArrowRightIcon size={14} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </a>
            <a href={LANDING_ONLY ? REPO_URL : href('/demo')} className="press inline-flex h-12 items-center rounded-full bg-white/[0.04] px-6 text-[15px] font-medium text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)] backdrop-blur-md transition-colors hover:bg-white/[0.08]">
              {LANDING_ONLY ? tr('Ver no GitHub') : tr('Ver a demo ao vivo')}
            </a>
          </div>
          <p data-hero="cta" className="mt-4 text-[12.5px] text-white/40">
            {tr('Código aberto. Corre no teu computador ou no servidor da empresa.')}
          </p>
        </div>
      </Container>
    </section>
  )
}
