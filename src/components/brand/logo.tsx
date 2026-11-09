import { cn } from '~/lib/utils'

/** Nau mark — rosa-dos-ventos around a unit of stock. Geometry from design/brand/nau-brand.ai (512 grid). */
const R0 = 92
const RAYS = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => ({ deg, outer: deg % 90 === 0 ? 230 : 168 }))

export function Mark({ size = 20, className, working = false, title }: { size?: number; className?: string; working?: boolean; title?: string }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={cn('shrink-0', className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {RAYS.map((r, i) => (
        <rect
          key={r.deg}
          x={256 - 21}
          y={256 - r.outer}
          width={42}
          height={r.outer - R0}
          rx={21}
          fill="currentColor"
          transform={`rotate(${r.deg} 256 256)`}
          className={working ? 'nau-ray' : undefined}
          style={working ? { animationDelay: `${i * 90}ms` } : undefined}
        />
      ))}
      <rect x={220} y={220} width={72} height={72} rx={18} fill="currentColor" />
    </svg>
  )
}

export function Logo({ className, size = 22, wordmark = true }: { className?: string; size?: number; wordmark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-ink', className)}>
      <Mark size={size} />
      {wordmark && (
        <span className="font-medium tracking-[-0.045em]" style={{ fontSize: size * 1.12, lineHeight: 1 }}>
          nau
        </span>
      )}
    </span>
  )
}

/** App-icon tile: an ember light under near-black glass, with the white mark */
export function AppIcon({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden text-white', className)}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: 'radial-gradient(120% 95% at 50% 115%, #ff8a4c 0%, #ff5b1f 32%, #5a1a06 68%, #121212 100%)',
        boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.14), inset 0 1px 0 rgb(255 255 255 / 0.22), 0 1px 2px rgb(0 0 0 / 0.3)',
      }}
    >
      <Mark size={size * 0.58} />
    </span>
  )
}
