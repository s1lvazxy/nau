import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BarcodeIcon, CheckIcon, FileTextIcon, PackageIcon, WarehouseIcon, WineIcon } from '@phosphor-icons/react'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { gsap, ScrollTrigger, useGSAP } from './frame'

if (typeof window !== 'undefined') gsap.registerPlugin(MotionPathPlugin)

/*
 * Lit, monochrome isometric scenes for the feature cards. World units are pixels on an
 * isometric grid: +x runs right-down, +y runs left-down, +z runs up.
 */

type P = [number, number]
const C = 0.8660254
const S = 0.5
export const iso = (x: number, y: number, z = 0): P => [(x - y) * C, (x + y) * S - z]
const pts = (...ps: P[]) => ps.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

type Shade = 'stone' | 'ember' | 'amber'
const FILL: Record<Shade, [string, string, string]> = {
  stone: ['url(#nau-top)', 'url(#nau-left)', 'url(#nau-right)'],
  ember: ['url(#nau-ember-top)', 'url(#nau-ember-left)', 'url(#nau-ember-right)'],
  amber: ['url(#nau-amber-top)', 'url(#nau-amber-left)', 'url(#nau-amber-right)'],
}

export function Box({ x, y, z = 0, w, d, h, shade = 'stone', edge = 0.22, open }: { x: number; y: number; z?: number; w: number; d: number; h: number; shade?: Shade; edge?: number; open?: boolean }) {
  const [top, left, right] = FILL[shade]
  const T = [iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)] as P[]
  const L = [iso(x, y + d, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x, y + d, z + h)] as P[]
  const R = [iso(x + w, y, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x + w, y, z + h)] as P[]
  return (
    <g>
      <polygon points={pts(...L)} fill={left} />
      <polygon points={pts(...R)} fill={right} />
      {!open && <polygon points={pts(...T)} fill={top} />}
      <polyline points={pts(T[3], T[2], T[1])} fill="none" stroke={`rgb(255 255 255 / ${edge})`} strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <line x1={iso(x + w, y + d, z)[0]} y1={iso(x + w, y + d, z)[1]} x2={T[2][0]} y2={T[2][1]} stroke={`rgb(255 255 255 / ${edge * 0.5})`} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {!open && <polyline points={pts(T[3], T[0], T[1])} fill="none" stroke={`rgb(255 255 255 / ${edge * 0.35})`} strokeWidth="1" vectorEffect="non-scaling-stroke" />}
    </g>
  )
}

/** Shared paint for every scene (gradients are referenced by id across the page). */
export function SceneDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <defs>
        <linearGradient id="nau-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#343434" />
          <stop offset="1" stopColor="#212121" />
        </linearGradient>
        <linearGradient id="nau-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#171717" />
          <stop offset="1" stopColor="#0d0d0d" />
        </linearGradient>
        <linearGradient id="nau-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#202020" />
          <stop offset="1" stopColor="#141414" />
        </linearGradient>
        <linearGradient id="nau-ember-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc29e" />
          <stop offset="1" stopColor="#ff6a2b" />
        </linearGradient>
        <linearGradient id="nau-ember-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9501a" />
          <stop offset="1" stopColor="#6e2105" />
        </linearGradient>
        <linearGradient id="nau-ember-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2611f" />
          <stop offset="1" stopColor="#8f2c07" />
        </linearGradient>
        <linearGradient id="nau-amber-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe0a3" />
          <stop offset="1" stopColor="#f3a83a" />
        </linearGradient>
        <linearGradient id="nau-amber-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b97a1c" />
          <stop offset="1" stopColor="#5c3a08" />
        </linearGradient>
        <linearGradient id="nau-amber-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d4911f" />
          <stop offset="1" stopColor="#7a4d0b" />
        </linearGradient>
        <linearGradient id="nau-beam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffe6d6" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff1e8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffe6d6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="nau-beam-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="nau-beam-mask" maskContentUnits="objectBoundingBox">
          <rect width="1" height="1" fill="url(#nau-beam-fade)" />
        </mask>
        <linearGradient id="nau-laser" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5b1f" stopOpacity="0" />
          <stop offset="0.6" stopColor="#ff5b1f" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ff8a4c" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id="nau-pool">
          <stop offset="0" stopColor="#ff5b1f" stopOpacity="0.32" />
          <stop offset="1" stopColor="#ff5b1f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="nau-pool-white">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.1" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="nau-pool-amber">
          <stop offset="0" stopColor="#f5a524" stopOpacity="0.35" />
          <stop offset="1" stopColor="#f5a524" stopOpacity="0" />
        </radialGradient>
        <filter id="nau-blur-3" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id="nau-blur-8" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>
    </svg>
  )
}

/** Runs a looping GSAP timeline only while the scene is on screen; nothing moves for reduced motion. */
function useScene(build: (tl: gsap.core.Timeline) => void, ready = true) {
  const ref = useRef<SVGSVGElement>(null)
  useGSAP(
    () => {
      if (!ready) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline({ repeat: -1, paused: true })
        build(tl)
        ScrollTrigger.create({ trigger: ref.current, start: 'top bottom', end: 'bottom top', onToggle: (s) => (s.isActive ? tl.play() : tl.pause()) })
      })
    },
    { scope: ref, dependencies: [ready] },
  )
  return ref
}

function Token({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <g data-token transform={`translate(${x} ${y})`}>
      <circle r="16" fill="#151515" stroke="rgb(255 255 255 / 0.22)" vectorEffect="non-scaling-stroke" />
      <g transform="translate(-8 -8)">{children}</g>
    </g>
  )
}

/* ── 1 · Receber: light falls into an open box, the invoice's lines go in with it ── */
export function ReceiveScene() {
  const ref = useScene((tl) => {
    tl.to('[data-beam]', { opacity: 0.55, duration: 1.4, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0)
    gsap.utils.toArray<SVGGElement>('[data-token]').forEach((t, i) => {
      tl.fromTo(t, { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power2.out' }, i * 0.7).to(t, { y: 70, opacity: 0, duration: 1.2, ease: 'power2.in' }, i * 0.7 + 0.6)
    })
  })
  const b = 58
  return (
    <svg ref={ref} viewBox="-330 -250 660 340" className="h-full w-full" aria-hidden>
      <ellipse cx="0" cy="62" rx="210" ry="62" fill="url(#nau-pool)" />
      <g data-beam style={{ opacity: 1 }}>
        <polygon points="-50,-250 50,-250 104,-40 -104,-40" fill="url(#nau-beam)" filter="url(#nau-blur-8)" mask="url(#nau-beam-mask)" />
        <polygon points="-50,-250 50,-250 104,-40 -104,-40" fill="url(#nau-beam)" opacity="0.6" mask="url(#nau-beam-mask)" />
        <polygon points="-10,-250 10,-250 30,-46 -30,-46" fill="url(#nau-beam)" mask="url(#nau-beam-mask)" />
      </g>
      {/* back flaps */}
      <polygon points={pts(iso(-b, -b, 76), iso(b, -b, 76), iso(b, -b - 34, 118), iso(-b, -b - 34, 118))} fill="url(#nau-right)" stroke="rgb(255 255 255 / 0.1)" vectorEffect="non-scaling-stroke" />
      <polygon points={pts(iso(-b, -b, 76), iso(-b, b, 76), iso(-b - 34, b, 118), iso(-b - 34, -b, 118))} fill="url(#nau-left)" stroke="rgb(255 255 255 / 0.1)" vectorEffect="non-scaling-stroke" />
      {/* inside */}
      <polygon points={pts(iso(-b, -b, 22), iso(b, -b, 22), iso(b, b, 22), iso(-b, b, 22))} fill="#0b0b0b" />
      <polygon points={pts(iso(-b, -b, 76), iso(b, -b, 76), iso(b, -b, 22), iso(-b, -b, 22))} fill="#151515" />
      <polygon points={pts(iso(-b, -b, 76), iso(-b, b, 76), iso(-b, b, 22), iso(-b, -b, 22))} fill="#101010" />
      <ellipse cx={iso(0, 0, 26)[0]} cy={iso(0, 0, 26)[1]} rx="48" ry="18" fill="#ffd9bd" opacity="0.35" filter="url(#nau-blur-8)" />
      {[
        [-30, -175, <FileTextIcon key="f" size={16} color="rgb(255 255 255 / 0.85)" />],
        [24, -175, <BarcodeIcon key="b" size={16} color="rgb(255 255 255 / 0.85)" />],
        [-6, -175, <WineIcon key="w" size={16} color="rgb(255 255 255 / 0.85)" />],
        [34, -175, <PackageIcon key="p" size={16} color="rgb(255 255 255 / 0.85)" />],
      ].map(([x, y, icon], i) => (
        <Token key={i} x={x as number} y={(y as number) + i * 18}>
          {icon}
        </Token>
      ))}
      <Box x={-b} y={-b} w={b * 2} d={b * 2} h={76} open edge={0.3} />
      {/* front flaps, folded out */}
      <polygon points={pts(iso(b, -b, 76), iso(b, b, 76), iso(b + 36, b, 52), iso(b + 36, -b, 52))} fill="url(#nau-top)" stroke="rgb(255 255 255 / 0.16)" vectorEffect="non-scaling-stroke" />
      <polygon points={pts(iso(-b, b, 76), iso(b, b, 76), iso(b, b + 36, 52), iso(-b, b + 36, 52))} fill="url(#nau-right)" stroke="rgb(255 255 255 / 0.12)" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/* ── 2 · Contar: a scan line sweeps the shelf; each crate lights as it is counted ── */
export function CountScene() {
  const cols = [-78, -22, 34]
  const sweep = 2.4
  const span = 100
  const ref = useScene((tl) => {
    const [dx, dy] = [span * C, span * S]
    tl.fromTo('[data-laser]', { x: -dx, y: -dy }, { x: dx, y: dy, duration: sweep, ease: 'none' }, 0).to('[data-laser]', { x: -dx, y: -dy, duration: sweep, ease: 'none' }, sweep)
    gsap.utils.toArray<SVGElement>('[data-lit]').forEach((el) => {
      const col = Number(el.dataset.col)
      const f = (cols[col] + 22 + span) / (2 * span)
      tl.to(el, { opacity: 1, duration: 0.12 }, f * sweep)
        .to(el, { opacity: 0, duration: 0.7 }, f * sweep + 0.12)
        .to(el, { opacity: 1, duration: 0.12 }, sweep + (1 - f) * sweep)
        .to(el, { opacity: 0, duration: 0.7 }, sweep + (1 - f) * sweep + 0.12)
    })
  })
  const crates: { x: number; y: number; col: number }[] = []
  for (const y of [-50, 8]) cols.forEach((x, col) => crates.push({ x, y, col }))
  return (
    <svg ref={ref} viewBox="-230 -150 460 290" className="h-full w-full" aria-hidden>
      <ellipse cx="0" cy="70" rx="200" ry="56" fill="url(#nau-pool-white)" />
      <Box x={-90} y={-70} w={180} h={12} d={136} />
      {crates.map((c, i) => (
        <g key={i}>
          <Box x={c.x} y={c.y} z={12} w={44} d={44} h={38} />
          <polyline data-lit data-col={c.col} points={pts(iso(c.x, c.y + 44, 50), iso(c.x + 44, c.y + 44, 50), iso(c.x + 44, c.y, 50))} fill="none" stroke="#ffb48a" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ opacity: 0, filter: 'drop-shadow(0 0 6px rgb(255 91 31 / 0.9))' }} />
        </g>
      ))}
      <g data-laser>
        <polygon points={pts(iso(0, -78, 0), iso(0, 74, 0), iso(0, 74, 110), iso(0, -78, 110))} fill="url(#nau-laser)" />
        <line x1={iso(0, -78, 110)[0]} y1={iso(0, -78, 110)[1]} x2={iso(0, 74, 110)[0]} y2={iso(0, 74, 110)[1]} stroke="#ffb48a" strokeWidth="1.5" vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 5px rgb(255 91 31 / 1))' }} />
        <line x1={iso(0, -78, 12)[0]} y1={iso(0, -78, 12)[1]} x2={iso(0, 74, 12)[0]} y2={iso(0, 74, 12)[1]} stroke="#ff5b1f" strokeWidth="2" vectorEffect="non-scaling-stroke" opacity="0.8" />
      </g>
    </svg>
  )
}

/* ── 3 · Prever: next fortnight as a row of bars; Santo António stands out ── */
const DEMAND = [30, 36, 28, 40, 47, 38, 44, 54, 96, 50, 42]
export function ForecastScene() {
  const [p, setP] = useState(1)
  const ref = useRef<SVGSVGElement>(null)
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const o = { p: 0 }
        setP(0)
        gsap.to(o, { p: 1, duration: 1.8, ease: 'expo.out', onUpdate: () => setP(o.p), scrollTrigger: { trigger: ref.current, start: 'top 85%' } })
      })
    },
    { scope: ref },
  )
  const peak = 8
  const x0 = -114
  const top = iso(x0 + peak * 21 + 7, -6, 12 + DEMAND[peak] + 26)
  return (
    <svg ref={ref} viewBox="-230 -170 460 290" className="h-full w-full" aria-hidden>
      <ellipse cx={iso(x0 + peak * 21, 0, 0)[0]} cy="40" rx="150" ry="50" fill="url(#nau-pool)" opacity={0.4 + 0.6 * p} />
      <Box x={-124} y={-26} w={248} d={52} h={12} />
      {DEMAND.map((h, i) => (
        <Box key={i} x={x0 + i * 21} y={-14} z={12} w={14} d={28} h={Math.max(0.5, h * (i === peak ? p : Math.min(1, p * 1.3)))} shade={i === peak ? 'ember' : 'stone'} edge={i === peak ? 0.6 : 0.2} />
      ))}
      <g style={{ opacity: p > 0.85 ? 1 : 0, transition: 'opacity 500ms ease' }}>
        <line x1={top[0]} y1={top[1] + 22} x2={top[0]} y2={top[1] + 6} stroke="rgb(255 180 138 / 0.6)" vectorEffect="non-scaling-stroke" />
        <g transform={`translate(${top[0]} ${top[1] - 8})`}>
          <rect x="-44" y="-13" width="88" height="26" rx="13" fill="#161616" stroke="rgb(255 120 60 / 0.5)" vectorEffect="non-scaling-stroke" />
          <text x="0" y="4.5" textAnchor="middle" className="fill-white font-sans text-[11.5px]">
            13 jun · ×1,6
          </text>
        </g>
      </g>
    </svg>
  )
}

/* ── 4 · Encomendar: an approved order leaves the warehouse for its supplier ── */
function dome(cx: number, cy: number, r: number) {
  const dots: { x: number; y: number; o: number }[] = []
  const tilt = 0.32
  for (let lat = 4; lat <= 84; lat += 7) {
    const la = (lat * Math.PI) / 180
    const n = Math.max(6, Math.round(64 * Math.cos(la)))
    for (let k = 0; k < n; k++) {
      const lo = (k / n) * Math.PI * 2
      const x = Math.cos(la) * Math.sin(lo)
      const y0 = Math.sin(la)
      const z0 = Math.cos(la) * Math.cos(lo)
      const y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt)
      const z = y0 * Math.sin(tilt) + z0 * Math.cos(tilt)
      if (z < -0.05) continue
      dots.push({ x: cx + r * x, y: cy - r * y, o: 0.12 + 0.55 * Math.max(0, z) * Math.min(1, lat / 20) })
    }
  }
  return dots
}
function onDome(cx: number, cy: number, r: number, latDeg: number, lonDeg: number): P {
  const tilt = 0.32
  const la = (latDeg * Math.PI) / 180
  const lo = (lonDeg * Math.PI) / 180
  const x = Math.cos(la) * Math.sin(lo)
  const y0 = Math.sin(la)
  const z0 = Math.cos(la) * Math.cos(lo)
  const y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt)
  return [cx + r * x, cy - r * y]
}
export function OrderScene() {
  // Trigonometry runs in the browser only, so server and client markup always agree.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const [cx, cy, r] = [0, 120, 230]
  const dots = useMemo(() => (ready ? dome(cx, cy, r) : []), [ready, cx, cy, r])
  const from = onDome(cx, cy, r, 22, -32)
  const to = [onDome(cx, cy, r, 40, 34), onDome(cx, cy, r, 62, -6), onDome(cx, cy, r, 30, 58)]
  const arc = (a: P, b: P) => {
    const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const lift: P = [cx + (m[0] - cx) * 1.15, cy + (m[1] - cy) * 1.55]
    return `M${a[0]} ${a[1]} Q${lift[0]} ${lift[1]} ${b[0]} ${b[1]}`
  }
  const paths = to.map((t) => arc(from, t))
  const ref = useScene((tl) => {
    tl.set('[data-packet]', { opacity: 1 }, 0)
      .to('[data-packet]', { duration: 1.8, ease: 'power1.inOut', motionPath: { path: '#nau-route', align: '#nau-route', alignOrigin: [0.5, 0.5] } }, 0)
      .fromTo('[data-ring]', { attr: { r: 6 }, opacity: 0.9 }, { attr: { r: 26 }, opacity: 0, duration: 1, ease: 'power2.out' }, 1.8)
      .to('[data-packet]', { opacity: 0, duration: 0.2 }, 1.8)
      .to({}, { duration: 1 })
  }, ready)
  if (!ready) return <svg ref={ref} viewBox="-320 -150 640 290" className="h-full w-full" aria-hidden />
  return (
    <svg ref={ref} viewBox="-320 -150 640 290" className="h-full w-full" aria-hidden>
      <ellipse cx="0" cy="120" rx="300" ry="40" fill="url(#nau-pool)" opacity="0.6" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r="1.25" fill="#fff" opacity={d.o.toFixed(2)} />
      ))}
      <path d={`M${cx - r} ${cy} A ${r} ${r * 0.3} 0 0 0 ${cx + r} ${cy}`} fill="none" stroke="rgb(255 255 255 / 0.12)" vectorEffect="non-scaling-stroke" />
      {paths.slice(1).map((d) => (
        <path key={d} d={d} fill="none" stroke="rgb(255 255 255 / 0.22)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
      ))}
      <path id="nau-route" d={paths[0]} fill="none" stroke="#ff8a4c" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 4px rgb(255 91 31 / 0.8))' }} />
      {to.map((t, i) => (
        <g key={i} transform={`translate(${t[0]} ${t[1]})`}>
          {i === 0 && <circle data-ring r="6" fill="none" stroke="#ff8a4c" vectorEffect="non-scaling-stroke" opacity="0" />}
          <circle r="11" fill="#151515" stroke={i === 0 ? 'rgb(255 140 80 / 0.7)' : 'rgb(255 255 255 / 0.25)'} vectorEffect="non-scaling-stroke" />
          <g transform="translate(-6 -6)">
            <PackageIcon size={12} color={i === 0 ? '#ffb48a' : 'rgb(255 255 255 / 0.7)'} />
          </g>
        </g>
      ))}
      <g transform={`translate(${from[0]} ${from[1]})`}>
        <circle r="15" fill="#151515" stroke="rgb(255 255 255 / 0.4)" vectorEffect="non-scaling-stroke" />
        <g transform="translate(-8 -8)">
          <WarehouseIcon size={16} color="#fff" />
        </g>
        <g transform="translate(-118 -58)">
          <rect width="112" height="28" rx="14" fill="#161616" stroke="rgb(255 255 255 / 0.14)" vectorEffect="non-scaling-stroke" />
          <circle cx="16" cy="14" r="7" fill="#46a758" />
          <g transform="translate(11.5 9.5)">
            <CheckIcon size={9} weight="bold" color="#000" />
          </g>
          <text x="30" y="18" className="fill-white font-sans text-[11.5px]">
            Aprovada
          </text>
        </g>
      </g>
      <circle data-packet r="4.5" fill="#ffd9bd" opacity="0" style={{ filter: 'drop-shadow(0 0 6px rgb(255 91 31 / 1))' }} cx="0" cy="0" />
    </svg>
  )
}

/* ── 5 · Lotes: crates ride towards the exit in expiry order; the next to go glows ── */
export function LotsScene() {
  const slots = [-230, -160, -90, -20, 50, 120]
  const ref = useScene((tl) => {
    const [dx, dy] = [70 * C, 70 * S]
    tl.to('[data-row]', { x: dx, y: dy, duration: 1.1, ease: 'power2.inOut' }, 0.9)
      .to('[data-crate="0"]', { opacity: 1, duration: 0.6 }, 0.9)
      .to('[data-crate="5"]', { opacity: 0, duration: 0.6 }, 1.3)
      .to('[data-glow="4"]', { opacity: 1, duration: 0.8 }, 1.2)
      .to('[data-glow="5"]', { opacity: 0, duration: 0.5 }, 1)
      .to('[data-belt]', { x: dx, y: dy, duration: 1.1, ease: 'power2.inOut' }, 0.9)
      .set('[data-row], [data-belt]', { x: 0, y: 0 }, 2.2)
      .set('[data-crate="0"]', { opacity: 0 }, 2.2)
      .set('[data-crate="5"]', { opacity: 1 }, 2.2)
      .set('[data-glow="4"]', { opacity: 0 }, 2.2)
      .set('[data-glow="5"]', { opacity: 1 }, 2.2)
  })
  const beltY = -30
  const exit = iso(slots[5] + 28, beltY + 28, 0)
  return (
    <svg ref={ref} viewBox="-330 -215 660 330" className="h-full w-full" aria-hidden>
      <defs>
        <clipPath id="nau-belt-clip">
          <polygon points={pts(iso(-250, beltY - 6, 14), iso(200, beltY - 6, 14), iso(200, beltY + 62, 14), iso(-250, beltY + 62, 14))} />
        </clipPath>
      </defs>
      <ellipse cx={exit[0]} cy={exit[1] + 20} rx="120" ry="40" fill="url(#nau-pool-amber)" />
      <Box x={-250} y={beltY - 6} w={450} d={68} h={14} />
      <g clipPath="url(#nau-belt-clip)">
        <g data-belt>
          {Array.from({ length: 16 }, (_, i) => {
            const x = -320 + i * 35
            return <line key={i} x1={iso(x, beltY - 6, 14)[0]} y1={iso(x, beltY - 6, 14)[1]} x2={iso(x, beltY + 62, 14)[0]} y2={iso(x, beltY + 62, 14)[1]} stroke="rgb(255 255 255 / 0.07)" vectorEffect="non-scaling-stroke" />
          })}
        </g>
      </g>
      <g data-row>
        {slots.map((x, i) => (
          <g key={i} data-crate={i} style={{ opacity: i === 0 ? 0 : 1 }}>
            <Box x={x} y={beltY} z={14} w={56} d={56} h={46} />
            <g data-glow={i} style={{ opacity: i === 5 ? 1 : 0 }}>
              <Box x={x} y={beltY} z={14} w={56} d={56} h={46} shade="amber" edge={0.5} />
            </g>
          </g>
        ))}
      </g>
      <g transform={`translate(${iso(slots[5] + 28, beltY + 28, 96)[0]} ${iso(slots[5] + 28, beltY + 28, 96)[1]})`}>
        <rect x="-62" y="-14" width="124" height="28" rx="14" fill="#161616" stroke="rgb(245 165 36 / 0.5)" vectorEffect="non-scaling-stroke" />
        <text x="0" y="4.5" textAnchor="middle" className="fill-[#ffd27a] font-sans text-[11.5px]">
          Sai primeiro · 2 dias
        </text>
      </g>
    </svg>
  )
}

/* ── 6 · Várias lojas: two shops and a warehouse, stock moving between them ── */
function Building({ x, y, w, d, h, label, lit }: { x: number; y: number; w: number; d: number; h: number; label: string; lit?: boolean }) {
  const door = [iso(x + w * 0.3, y + d, 0), iso(x + w * 0.55, y + d, 0), iso(x + w * 0.55, y + d, h * 0.55), iso(x + w * 0.3, y + d, h * 0.55)]
  const win = [iso(x + w, y + d * 0.25, h * 0.45), iso(x + w, y + d * 0.75, h * 0.45), iso(x + w, y + d * 0.75, h * 0.8), iso(x + w, y + d * 0.25, h * 0.8)]
  const tag = iso(x + w / 2, y + d / 2, h + 34)
  const width = label.length * 6.4 + 22
  return (
    <g>
      <Box x={x} y={y} w={w} d={d} h={h} />
      <Box x={x - 4} y={y - 4} z={h} w={w + 8} d={d + 8} h={5} edge={0.3} />
      <polygon points={pts(...door)} fill="#0a0a0a" />
      <polygon points={pts(...win)} fill={lit ? '#ff8a4c' : '#1d1d1d'} opacity={lit ? 0.85 : 1} style={lit ? { filter: 'drop-shadow(0 0 6px rgb(255 91 31 / 0.8))' } : undefined} />
      <line x1={tag[0]} y1={tag[1] + 11} x2={tag[0]} y2={iso(x + w / 2, y + d / 2, h + 6)[1]} stroke="rgb(255 255 255 / 0.2)" vectorEffect="non-scaling-stroke" />
      <g transform={`translate(${tag[0]} ${tag[1]})`}>
        <rect x={-width / 2} y="-11" width={width} height="22" rx="11" fill="#161616" stroke="rgb(255 255 255 / 0.14)" vectorEffect="non-scaling-stroke" />
        <text x="0" y="4" textAnchor="middle" className="fill-white/80 font-sans text-[11px]">
          {label}
        </text>
      </g>
    </g>
  )
}
export function StoresScene() {
  const line = (...ps: P[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const route = line(iso(-60, -10), iso(30, -10), iso(30, -68), iso(60, -68))
  const route2 = line(iso(-100, 24), iso(-100, 62), iso(40, 62))
  const ref = useScene((tl) => {
    tl.set('[data-van]', { opacity: 1 }, 0)
      .to('[data-van]', { duration: 2.2, ease: 'power1.inOut', motionPath: { path: '#nau-stores-a', align: '#nau-stores-a', alignOrigin: [0.5, 0.5] } }, 0)
      .to('[data-van]', { opacity: 0, duration: 0.2 }, 2.2)
      .set('[data-van2]', { opacity: 1 }, 1.1)
      .to('[data-van2]', { duration: 2.2, ease: 'power1.inOut', motionPath: { path: '#nau-stores-b', align: '#nau-stores-b', alignOrigin: [0.5, 0.5] } }, 1.1)
      .to('[data-van2]', { opacity: 0, duration: 0.2 }, 3.3)
      .to({}, { duration: 0.6 })
  })
  const grid = Array.from({ length: 9 }, (_, i) => -160 + i * 40)
  return (
    <svg ref={ref} viewBox="-240 -175 480 300" className="h-full w-full" aria-hidden>
      <ellipse cx="0" cy="40" rx="210" ry="70" fill="url(#nau-pool)" opacity="0.5" />
      {grid.map((g) => (
        <g key={g} stroke="rgb(255 255 255 / 0.045)" vectorEffect="non-scaling-stroke">
          <line x1={iso(g, -160)[0]} y1={iso(g, -160)[1]} x2={iso(g, 160)[0]} y2={iso(g, 160)[1]} />
          <line x1={iso(-160, g)[0]} y1={iso(-160, g)[1]} x2={iso(160, g)[0]} y2={iso(160, g)[1]} />
        </g>
      ))}
      <path id="nau-stores-a" d={route} fill="none" stroke="rgb(255 140 80 / 0.55)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      <path id="nau-stores-b" d={route2} fill="none" stroke="rgb(255 255 255 / 0.25)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      <Building x={60} y={-90} w={52} d={44} h={46} label="Bonfim" lit />
      <Building x={-140} y={-40} w={80} d={64} h={40} label="Armazém" />
      <Building x={40} y={40} w={52} d={44} h={46} label="Príncipe Real" lit />
      <circle data-van r="4.5" fill="#ffd9bd" opacity="0" style={{ filter: 'drop-shadow(0 0 6px rgb(255 91 31 / 1))' }} />
      <circle data-van2 r="4" fill="#fff" opacity="0" style={{ filter: 'drop-shadow(0 0 5px rgb(255 255 255 / 0.8))' }} />
    </svg>
  )
}
