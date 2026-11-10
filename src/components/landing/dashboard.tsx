import { LANDING_ONLY, href } from '~/lib/site'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckIcon, PlusIcon, SlidersHorizontalIcon } from '@phosphor-icons/react'
import { buttonClass } from '~/components/ui/button'
import { Segmented } from '~/components/ui/form'
import { DashboardGrid, WidgetGallery } from '~/components/dashboard/grid'
import { ActionsContext } from '~/components/app/actions'
import { AppIcon } from '~/components/brand/logo'
import { SnapshotContext } from '~/data/store'
import { applyChangeSet } from '~/data/changeset'
import { createDemoSnapshot } from '~/lib/seed'
import type { Dashboard, Snapshot } from '~/lib/types'
import { cn } from '~/lib/utils'
import { Rule, gsap, useGSAP } from './frame'
import { tr } from '~/i18n'

/** The real dashboard, laid back like a chart table. It stands up as you reach it, then it is yours to use. */
export function DashboardSection() {
  const ref = useRef<HTMLElement>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [editing, setEditing] = useState(false)
  const [gallery, setGallery] = useState(false)
  const [tab, setTab] = useState(0)
  const [upright, setUpright] = useState(false)

  useEffect(() => {
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        const s = createDemoSnapshot()
        s.dashboards = [
          {
            ...s.dashboards[0],
            widgets: [
              { id: 'd1', type: 'brief', config: {}, layout: { x: 0, y: 0, w: 5, h: 5 } },
              { id: 'd2', type: 'health', config: {}, layout: { x: 5, y: 0, w: 3, h: 5 } },
              { id: 'd3', type: 'approvals', config: {}, layout: { x: 8, y: 0, w: 4, h: 5 } },
              { id: 'd4', type: 'kpi', config: { metric: 'revenue7' }, layout: { x: 0, y: 5, w: 4, h: 2 } },
              { id: 'd5', type: 'kpi', config: { metric: 'stockValue' }, layout: { x: 4, y: 5, w: 4, h: 2 } },
              { id: 'd6', type: 'kpi', config: { metric: 'lowCount' }, layout: { x: 8, y: 5, w: 4, h: 2 } },
              { id: 'd7', type: 'salesTrend', config: { days: 30 }, layout: { x: 0, y: 7, w: 8, h: 5 } },
              { id: 'd8', type: 'lowStock', config: {}, layout: { x: 8, y: 7, w: 4, h: 5 } },
            ],
          },
          s.dashboards[1],
        ]
        setSnap(s)
        io.disconnect()
      },
      { rootMargin: '900px' },
    )
    if (ref.current) io.observe(ref.current)
    return () => io.disconnect()
  }, [])

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference) and (min-width: 768px)', () => {
        let was = false
        const st = { trigger: '[data-plane-wrap]', start: 'top 96%', end: 'top 16%', scrub: 0.5 }
        gsap.fromTo(
          '[data-plane]',
          { rotateX: 34, scale: 0.94, transformPerspective: 1700, transformOrigin: '50% 100%' },
          {
            rotateX: 0,
            scale: 1,
            ease: 'none',
            scrollTrigger: {
              ...st,
              onUpdate: (self) => {
                const now = self.progress > 0.985
                if (now !== was) setUpright((was = now))
              },
              onRefresh: (self) => {
                const now = self.progress > 0.985
                if (now !== was) setUpright((was = now))
              },
            },
          },
        )
        gsap.fromTo('[data-plane-shade]', { opacity: 1 }, { opacity: 0, ease: 'none', scrollTrigger: st })
        gsap.fromTo('[data-plane-rim]', { opacity: 0.25, scaleX: 0.5 }, { opacity: 1, scaleX: 1, ease: 'none', scrollTrigger: st })
        gsap.fromTo('[data-plane-glow]', { opacity: 0.35, scale: 0.8 }, { opacity: 1, scale: 1, ease: 'none', scrollTrigger: st })
      })
      // As the dashboard climbs over the heading, the words sink back.
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo('[data-dash-words]', { opacity: 1, scale: 1, filter: 'blur(0px)' }, { opacity: 0.1, scale: 0.94, filter: 'blur(7px)', ease: 'none', scrollTrigger: { trigger: '[data-plane-wrap]', start: 'top 60%', end: 'top 14%', scrub: true } })
      })
      mm.add('(prefers-reduced-motion: reduce), (max-width: 767px)', () => {
        gsap.set('[data-plane-shade]', { opacity: 0 })
        setUpright(true)
      })
    },
    { scope: ref },
  )

  const actions = useMemo(
    () => ({
      commit: async (cs: Parameters<typeof applyChangeSet>[1], opts?: { success?: string }) => {
        setSnap((s) => (s ? applyChangeSet(s, cs) : s))
        if (opts?.success) toast.success(opts.success, { description: tr('É só a demo — nada foi enviado.') })
      },
      actor: { kind: 'user' as const, name: 'Inês Marques' },
      navigate: () =>
        LANDING_ONLY
          ? toast(tr('Isso abre na aplicação'), { description: tr('Instala o Nau para ver: são três linhas.'), action: { label: tr('Instalar'), onClick: () => document.querySelector('#install')?.scrollIntoView({ behavior: 'smooth' }) } })
          : toast(tr('Isso abre na demo ao vivo'), { description: tr('Tudo o que vês aqui também funciona lá — sem registo.'), action: { label: tr('Abrir demo'), onClick: () => (window.location.href = href('/demo')) } }),
      canWrite: true,
      demo: true,
    }),
    [],
  )
  const dash = snap?.dashboards[tab]
  const setDash = (d: Dashboard) => setSnap((s) => (s ? { ...s, dashboards: s.dashboards.map((x) => (x.id === d.id ? d : x)) } : s))

  return (
    <section ref={ref} id="product-dashboard" aria-labelledby="dash-title" className="relative">
      <Rule />
      <div className="relative">
      {/* The words hold still while the product rises over them */}
      <div className="sticky top-0 z-0 flex h-[66svh] min-h-[440px] items-center justify-center px-6 pt-[72px] text-center">
        <div data-dash-words className="flex flex-col items-center will-change-transform">
          <h2 id="dash-title" data-lines className="max-w-[14ch] text-[clamp(2.5rem,5.6vw,5rem)] leading-[1] font-medium tracking-[-0.04em] text-white">
            {tr('O teu painel,')} <span className="text-white/38">{tr('à tua maneira.')}</span>
          </h2>
          <p data-reveal className="mt-6 max-w-[44ch] text-[16px] leading-[1.65] text-white/58">
            {tr('Arrasta, redimensiona ou descreve o widget que queres. Este é o verdadeiro — carrega em Personalizar.')}
          </p>
        </div>
      </div>

      <div data-plane-wrap className="relative z-[2] mx-auto max-w-[1420px] px-3 md:px-8">
        <div data-plane-glow aria-hidden className="pointer-events-none absolute inset-x-[8%] -top-24 h-[420px] rounded-[50%] bg-[radial-gradient(closest-side,rgb(255_91_31/0.34),transparent)] blur-2xl" />
        <div data-plane className={cn('relative will-change-transform', !upright && 'md:pointer-events-none')}>
          <div data-plane-rim aria-hidden className="absolute inset-x-[12%] -top-px z-[2] h-px bg-gradient-to-r from-transparent via-[#ffc9a8] to-transparent" />
          <div className="dark relative overflow-hidden rounded-[22px] bg-canvas font-sans shadow-[0_0_0_1px_rgb(255_255_255/0.1),inset_0_1px_0_rgb(255_255_255/0.08),0_80px_160px_-50px_rgb(0_0_0/1)]" style={{ colorScheme: 'dark' }}>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <AppIcon size={24} />
                <span className="text-[13px] font-medium text-ink">{tr('Casa Ribeira')}</span>
              </div>
              <Segmented size="sm" value={String(tab)} onChange={(v) => setTab(Number(v))} options={[{ value: '0', label: tr('Visão geral') }, { value: '1', label: tr('Armazém') }]} />
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {editing && (
                  <button type="button" onClick={() => setGallery(true)} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                    <PlusIcon size={13} /> {tr('Adicionar widget')}
                  </button>
                )}
                <button type="button" onClick={() => setEditing((e) => !e)} className={buttonClass({ variant: editing ? 'primary' : 'secondary', size: 'sm' })}>
                  {editing ? <CheckIcon size={13} /> : <SlidersHorizontalIcon size={13} />}
                  {editing ? tr('Concluído') : tr('Personalizar')}
                </button>
              </div>
            </div>
            <div className="mx-1.5 mb-1.5 min-h-[620px] rounded-[16px] bg-panel p-3 shadow-panel md:p-5">
              {snap && dash ? (
                <SnapshotContext.Provider value={snap}>
                  <ActionsContext.Provider value={actions}>
                    <DashboardGrid dashboard={dash} editing={editing} onChange={setDash} />
                    <WidgetGallery open={gallery} onOpenChange={setGallery} dashboard={dash} onAdd={(d) => (setDash(d), setGallery(false))} />
                  </ActionsContext.Provider>
                </SnapshotContext.Provider>
              ) : (
                <div className="grid grid-cols-12 gap-3.5">
                  {[5, 3, 4, 4, 4, 4, 8, 4].map((w, i) => (
                    <div key={i} className="h-40 animate-pulse rounded-[16px] bg-hover" style={{ gridColumn: `span ${w} / span ${w}` }} />
                  ))}
                </div>
              )}
            </div>
            {/* Dusk over the far end of the table while it is still lying back */}
            <div data-plane-shade aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(10_10_10/0.7)_0%,rgb(10_10_10/0)_62%)]" />
          </div>
        </div>
      </div>
      </div>
      <div className="h-28 md:h-40" />
    </section>
  )
}
