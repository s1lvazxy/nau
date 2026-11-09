import type { HTMLAttributes, ReactNode } from 'react'
import { cn, initials } from '~/lib/utils'

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'accent' | 'violet' | 'muted'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-hover text-ink-2',
  muted: 'bg-transparent text-ink-3 shadow-[inset_0_0_0_1px_var(--gray-a5)]',
  // Status reads from the dot; only problems and the accent carry a tint.
  ok: 'bg-hover text-ink-2',
  warn: 'bg-hover text-ink-2',
  info: 'bg-hover text-ink-2',
  violet: 'bg-hover text-ink-2',
  bad: 'bg-bad-soft text-bad-ink',
  accent: 'bg-accent-soft text-accent-ink',
}
const dotClass: Record<Tone, string> = {
  neutral: 'bg-ink-3',
  muted: 'bg-ink-4',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
  accent: 'bg-accent',
  violet: 'bg-violet',
}
const STATUS_TONES: Tone[] = ['ok', 'warn', 'bad', 'info', 'violet', 'accent']

export function Badge({ tone = 'neutral', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  const showDot = dot ?? STATUS_TONES.includes(tone)
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap', toneClass[tone], className)}>
      {showDot && <span className={cn('size-1.5 shrink-0 rounded-full', dotClass[tone])} />}
      {children}
    </span>
  )
}

export function Dot({ tone = 'neutral', className, pulse }: { tone?: Tone; className?: string; pulse?: boolean }) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)}>
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-50', dotClass[tone])} style={{ animationDuration: '1.8s' }} />}
      <span className={cn('relative size-2 rounded-full', dotClass[tone])} />
    </span>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-surface px-1 font-mono text-[10.5px] text-ink-3 shadow-[inset_0_0_0_1px_var(--gray-a5),0_1px_0_var(--gray-a4)]', className)}>{children}</kbd>
}

export function Avatar({ name, hue = 24, size = 24, className }: { name: string; hue?: number; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white select-none', className)}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38), background: `linear-gradient(140deg, oklch(0.72 0.13 ${hue}), oklch(0.56 0.16 ${(hue + 40) % 360}))` }}
    >
      {initials(name)}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-hover', className)} />
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl bg-surface shadow-card', className)} {...props}>
      {children}
    </div>
  )
}

export function Empty({ icon, title, children, action, className }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-surface text-ink-3 shadow-card">{icon}</div>}
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('mono-label text-ink-3', className)}>{children}</span>
}

export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-line px-5 pt-6 pb-4 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[21px] leading-tight font-medium tracking-[-0.025em] text-ink">{title}</h1>
          {description && <p className="mt-1 text-[13px] text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-[12px] text-ink-3">{label}</span>
      <span className="tabular text-[22px] font-medium tracking-[-0.03em] text-ink">{value}</span>
      {sub && <span className="text-[12px] text-ink-3">{sub}</span>}
    </div>
  )
}

export function ItemSwatch({ name, hue, size = 28, className }: { name: string; hue: number; size?: number; className?: string }) {
  const letter = name.replace(/[^A-Za-zÀ-ú0-9]/g, '').slice(0, 1).toUpperCase()
  return (
    <span aria-hidden className={cn('swatch relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[8px] font-medium', className)} style={{ width: size, height: size, fontSize: size * 0.4, ['--h' as string]: hue }}>
      {letter}
    </span>
  )
}
