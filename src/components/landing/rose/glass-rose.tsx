import { useEffect, useRef, useState } from 'react'
import { Mark } from '~/components/brand/logo'
import { cn } from '~/lib/utils'

type Layout = 'hero' | 'center' | 'panel' | 'closing'
type Handle = { dispose: () => void }

/**
 * Where the rose sits and how large it is, in CSS pixels. The hero switches at the same 1024px
 * breakpoint as its copy, and the rose never grows wider than the space beside the text.
 */
function placement(layout: Layout, w: number, h: number): { center: [number, number]; scale: number } {
  h = Math.max(h, 1)
  w = Math.max(w, 1)
  if (layout === 'center') return { center: [0.5, 0.5], scale: Math.min(0.36, (0.38 * w) / h) }
  if (layout === 'closing') return { center: [0.5, 0.5], scale: Math.min(0.27, (0.42 * w) / h) }
  if (layout === 'panel') return { center: [0.5, 0.36], scale: Math.min(0.3, (0.36 * w) / h) }
  if (w >= 1024) {
    const r = Math.min(0.41 * h, (w < 1280 ? 0.215 : 0.29) * w)
    // Let the right-hand rays bleed off the edge rather than reach under the headline.
    return { center: [Math.max(0.66, 1 - (0.82 * r) / w), 0.5], scale: r / h }
  }
  const r = Math.min(0.24 * h, 0.4 * w)
  return { center: [0.5, Math.min(0.3, (r * 1.15) / h + 0.06)], scale: r / h }
}

/**
 * vgpu (WebGPU) renderer for the glass rose. Pauses off screen, holds still for reduced motion,
 * and reports failure so the caller can show the static fallback.
 */
async function createRose(canvas: HTMLCanvasElement, layout: Layout, reduced: boolean): Promise<Handle> {
  const [{ init, surface, effect, frameLoop, clock }, { default: fragment }] = await Promise.all([import('vgpu'), import('./rose.wgsl')])
  const gpu = await init()
  let loop: { stop(): void } | null = null
  let disposed = false
  const cleanups: (() => void)[] = []
  try {
    const output = surface(gpu, canvas, { dpr: [1, 2] })
    const place = () => placement(layout, canvas.clientWidth, canvas.clientHeight)
    const shader = effect(gpu, fragment, {
      label: 'glass-rose',
      set: { params: { resolution: output.size, pointer: [0, 0], center: place().center, time: 0, scale: place().scale, presence: 0 } },
    })
    cleanups.push(output.onResize(() => shader.set({ params: { resolution: output.size, ...place() } })))

    let pointer: [number, number] = [0, 0]
    let target: [number, number] = [0, 0]
    let presence = 0
    let targetPresence = 0
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      const c = place().center
      target = [Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - c[0]) * 2)), Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - c[1]) * 2))]
      targetPresence = 1
    }
    const leave = () => {
      target = [0, 0]
      targetPresence = 0
    }
    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerleave', leave)
    cleanups.push(() => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', leave)
    })

    const time = clock(gpu)
    let t = 3
    const start = () => {
      if (loop || disposed) return
      loop = frameLoop(
        gpu,
        (frame) => {
          const dt = Math.min(time.deltaTime, 0.1)
          if (!reduced) t += dt
          const k = 1 - Math.exp(-4 * dt)
          pointer = reduced ? [0, 0] : [pointer[0] + (target[0] - pointer[0]) * k, pointer[1] + (target[1] - pointer[1]) * k]
          presence += (targetPresence - presence) * k
          shader.set({ params: { time: t, pointer, presence } })
          frame.pass(output, shader)
        },
        { fps: 60 },
      )
    }
    const stop = () => {
      loop?.stop()
      loop = null
    }
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), { rootMargin: '80px' })
    io.observe(canvas)
    cleanups.push(() => io.disconnect())
    start()
  } catch (e) {
    gpu.dispose()
    throw e
  }
  return {
    dispose: () => {
      disposed = true
      loop?.stop()
      cleanups.forEach((c) => c())
      gpu.dispose()
    },
  }
}

/** Static stand-in where WebGPU is unavailable: the mark in dark glass with an ember glow. */
function Fallback({ layout }: { layout: Layout }) {
  return (
    <div className={cn('absolute inset-0 flex items-center justify-center', layout === 'hero' && 'max-lg:items-start max-lg:pt-[12vh] lg:justify-end lg:pr-[12vw]')}>
      <div className="relative">
        <div className="absolute inset-[-40%] rounded-full bg-[radial-gradient(closest-side,rgb(255_91_31/0.35),transparent)] blur-2xl" />
        <Mark size={layout === 'hero' ? 360 : 240} className="relative text-[#1a1412] drop-shadow-[0_0_1px_rgb(255_180_138/0.9)] max-lg:size-[220px]" />
      </div>
    </div>
  )
}

export function GlassRose({ className, layout = 'hero' }: { className?: string; layout?: Layout }) {
  const host = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'pending' | 'gpu' | 'fallback'>('pending')
  useEffect(() => {
    const el = host.current
    if (!el) return
    if (!('gpu' in navigator)) return setMode('fallback')
    // A fresh canvas per mount: a WebGPU context belongs to exactly one renderer.
    const canvas = document.createElement('canvas')
    canvas.className = 'absolute inset-0 h-full w-full'
    el.appendChild(canvas)
    let handle: Handle | null = null
    let alive = true
    createRose(canvas, layout, window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      .then((h) => {
        if (!alive) return h.dispose()
        handle = h
        setMode('gpu')
      })
      .catch(() => alive && setMode('fallback'))
    return () => {
      alive = false
      handle?.dispose()
      canvas.remove()
    }
  }, [layout])
  return (
    <div aria-hidden className={cn('absolute inset-0 overflow-hidden bg-[#0a0a0a]', className)}>
      {mode === 'fallback' && <Fallback layout={layout} />}
      <div ref={host} className={cn('absolute inset-0 transition-opacity duration-[1400ms] ease-out', mode === 'gpu' ? 'opacity-100' : 'opacity-0')} />
    </div>
  )
}
