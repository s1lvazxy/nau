import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import NumberFlow from '@number-flow/react'
import { cn } from '~/lib/utils'

export function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

function niceMax(v: number) {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p
}

function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] ?? pts[i]
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    const [x3, y3] = pts[i + 2] ?? pts[i + 1]
    const t = 0.16
    d += ` C${x1 + (x2 - x0) * t},${y1 + (y2 - y0) * t} ${x2 - (x3 - x1) * t},${y2 - (y3 - y1) * t} ${x2},${y2}`
  }
  return d
}

export function Sparkline({ values, width = 96, height = 28, className, tone = 'ink' }: { values: number[]; width?: number; height?: number; className?: string; tone?: 'ink' | 'accent' | 'ok' | 'bad' }) {
  const id = useId()
  if (!values.length) return null
  const max = Math.max(...values, 1)
  const pad = 2
  const pts = values.map((v, i) => [pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2), height - pad - (v / max) * (height - pad * 2)] as [number, number])
  const color = tone === 'accent' ? 'var(--accent-9)' : tone === 'ok' ? 'var(--grass-9)' : tone === 'bad' ? 'var(--red-9)' : 'var(--gray-11)'
  const line = smoothPath(pts)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('overflow-visible', className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${pts[pts.length - 1][0]},${height} L${pts[0][0]},${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.25" fill={color} />
    </svg>
  )
}

export interface SeriesPoint {
  label: string
  value: number
  secondary?: number
  marker?: string
}

export function AreaChart({ data, height = 180, format = (v) => String(Math.round(v)), xFormat = (s) => s, className, secondaryLabel, primaryLabel, threshold }: { data: SeriesPoint[]; height?: number; format?: (v: number) => string; xFormat?: (s: string) => string; className?: string; primaryLabel?: string; secondaryLabel?: string; threshold?: { value: number; label: string } }) {
  const [ref, { width }] = useMeasure<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  const pad = { l: 0, r: 0, t: 12, b: 22 }
  const w = Math.max(10, width)
  const max = useMemo(() => niceMax(Math.max(...data.map((d) => Math.max(d.value, d.secondary ?? 0)), threshold?.value ?? 0) * 1.08), [data, threshold])
  const x = (i: number) => pad.l + (i / Math.max(1, data.length - 1)) * (w - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b)
  const pts = data.map((d, i) => [x(i), y(d.value)] as [number, number])
  const sec = data.some((d) => d.secondary != null) ? data.map((d, i) => [x(i), y(d.secondary ?? 0)] as [number, number]) : null
  const line = smoothPath(pts)
  const ticks = [0, 0.5, 1].map((f) => f * max)
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(w / 72))))
  return (
    <div ref={ref} className={cn('relative w-full select-none', className)} style={{ height }}>
      {width > 0 && (
        <svg
          width={w}
          height={height}
          className="overflow-visible"
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
            const i = Math.round(((e.clientX - r.left - pad.l) / (w - pad.l - pad.r)) * (data.length - 1))
            setHover(Math.max(0, Math.min(data.length - 1, i)))
          }}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`${primaryLabel ?? 'Series'} chart`}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--gray-12)" stopOpacity="0.09" />
              <stop offset="100%" stopColor="var(--gray-12)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--gray-a5)' : 'var(--gray-a3)'} strokeDasharray={t === 0 ? undefined : '1 4'} strokeLinecap="round" />
              {t > 0 && (
                <text x={w} y={y(t) - 4} textAnchor="end" className="fill-[var(--gray-9)] font-mono text-[10px]">
                  {format(t)}
                </text>
              )}
            </g>
          ))}
          {threshold && (
            <g>
              <line x1={0} x2={w} y1={y(threshold.value)} y2={y(threshold.value)} stroke="var(--amber-9)" strokeDasharray="4 4" strokeOpacity="0.8" />
              <text x={4} y={y(threshold.value) - 4} className="fill-[var(--amber-11)] font-mono text-[10px]">
                {threshold.label}
              </text>
            </g>
          )}
          {pts.length > 1 && <path d={`${line} L${pts[pts.length - 1][0]},${y(0)} L${pts[0][0]},${y(0)} Z`} fill={`url(#${id})`} />}
          {sec && <path d={smoothPath(sec)} fill="none" stroke="var(--gray-a7)" strokeWidth="1.25" strokeDasharray="2 4" strokeLinecap="round" />}
          <path d={line} fill="none" stroke="var(--gray-12)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
          {pts.length > 0 && hover == null && (
            <g>
              <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="7" fill="var(--accent-a4)" />
              <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill="var(--accent-9)" />
            </g>
          )}
          {data.map((d, i) =>
            d.marker ? (
              <g key={`m${i}`}>
                <line x1={x(i)} x2={x(i)} y1={pad.t} y2={y(0)} stroke="var(--violet-9)" strokeOpacity="0.35" strokeDasharray="2 3" />
                <circle cx={x(i)} cy={pad.t} r="2.5" fill="var(--violet-9)" />
              </g>
            ) : null,
          )}
          {data.map((d, i) =>
            i % labelEvery === 0 || i === data.length - 1 ? (
              <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} className="fill-[var(--gray-9)] font-mono text-[10px]">
                {xFormat(d.label)}
              </text>
            ) : null,
          )}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} stroke="var(--gray-a6)" strokeDasharray="1 3" strokeLinecap="round" />
              <circle cx={x(hover)} cy={y(data[hover].value)} r="4" fill="var(--raised)" stroke="var(--accent-9)" strokeWidth="2" />
            </g>
          )}
        </svg>
      )}
      {hover != null && data[hover] && (
        <div className="pointer-events-none absolute top-0 z-10 rounded-[8px] bg-raised px-2.5 py-1.5 text-[12px] shadow-pop" style={{ left: Math.min(Math.max(0, x(hover) - 70), w - 150) }}>
          <div className="font-mono text-[10.5px] text-ink-3">{xFormat(data[hover].label)}{data[hover].marker ? ` · ${data[hover].marker}` : ''}</div>
          <div className="tabular font-medium text-ink">
            {primaryLabel && <span className="mr-1 text-ink-3">{primaryLabel}</span>}
            {format(data[hover].value)}
          </div>
          {data[hover].secondary != null && (
            <div className="tabular text-ink-3">
              {secondaryLabel} {format(data[hover].secondary!)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function BarList({ rows, format = (v) => String(v), className, max: maxIn }: { rows: { key: string; label: ReactNode; value: number; hint?: ReactNode; hue?: number; onClick?: () => void }[]; format?: (v: number) => string; className?: string; max?: number }) {
  const max = maxIn ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className={cn('flex flex-col gap-1.5', className)}>
      {rows.map((r, i) => (
        <li key={r.key}>
          <button type="button" onClick={r.onClick} disabled={!r.onClick} className="group relative flex h-7 w-full items-center justify-between gap-3 overflow-hidden rounded-[7px] px-2 text-left text-[12.5px] enabled:hover:bg-hover">
            <span
              className="absolute inset-y-0.5 left-0 rounded-[6px] transition-[width] duration-500 ease-[var(--ease-out)]"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: i === 0 && r.value === max ? 'var(--accent-a4)' : 'var(--gray-a3)' }}
            />
            <span className="relative z-[1] min-w-0 truncate text-ink">{r.label}</span>
            <span className="tabular relative z-[1] shrink-0 text-ink-2">
              {format(r.value)}
              {r.hint && <span className="ml-1.5 text-ink-4">{r.hint}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Small columns; the last one (today) carries the accent. */
export function MiniBars({ values, width = 92, height = 30, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  if (!values.length) return null
  const max = Math.max(...values, 1)
  const gap = 3
  const bw = (width - gap * (values.length - 1)) / values.length
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * height)
        return <rect key={i} x={i * (bw + gap)} y={height - h} width={bw} height={h} rx={Math.min(2, bw / 2)} fill={i === values.length - 1 ? 'var(--accent-9)' : 'var(--gray-a5)'} />
      })}
    </svg>
  )
}

export function StackedBar({ segments, height = 8, className }: { segments: { key: string; value: number; color: string; label?: string }[]; height?: number; className?: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  return (
    <div className={cn('flex w-full gap-[2px] overflow-hidden rounded-full', className)} style={{ height }}>
      {segments.map((s) => (
        <div key={s.key} title={s.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  )
}

export function Ring({ value, size = 120, stroke = 10, className, children }: { value: number; size?: number; stroke?: number; className?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const tone = value >= 80 ? 'var(--grass-9)' : value >= 60 ? 'var(--amber-9)' : 'var(--red-9)'
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gray-a3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} style={{ transition: 'stroke-dashoffset 900ms var(--ease-out)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

export function AnimatedNumber({ value, format = 'number', decimals = 0, className, compact }: { value: number; format?: 'number' | 'eur' | 'percent'; decimals?: number; className?: string; compact?: boolean }) {
  const opts: Intl.NumberFormatOptions =
    format === 'eur'
      ? { style: 'currency', currency: 'EUR', maximumFractionDigits: compact ? 0 : decimals, minimumFractionDigits: compact ? 0 : decimals, notation: compact && Math.abs(value) >= 100000 ? 'compact' : 'standard' }
      : format === 'percent'
        ? { style: 'percent', maximumFractionDigits: decimals }
        : { maximumFractionDigits: decimals }
  return <NumberFlow value={value} format={opts as never} locales="en-IE" className={cn('tabular', className)} willChange />
}

export function Delta({ value, suffix = '%', className, invert }: { value: number; suffix?: string; className?: string; invert?: boolean }) {
  if (!Number.isFinite(value)) return null
  const up = value > 0
  const good = invert ? !up : up
  const tone = Math.abs(value) < 0.5 ? 'text-ink-3' : good ? 'text-ok-ink' : 'text-bad-ink'
  return (
    <span className={cn('tabular inline-flex items-center gap-0.5 text-[12px] font-medium', tone, className)}>
      <span aria-hidden>{Math.abs(value) < 0.5 ? '→' : up ? '↑' : '↓'}</span>
      {Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}
      {suffix}
    </span>
  )
}
