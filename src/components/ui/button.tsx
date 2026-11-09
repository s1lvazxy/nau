import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '~/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'accent' | 'link'
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const base =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium select-none outline-none transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-45 disabled:pointer-events-none active:scale-[0.97]'

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-inverse hover:bg-ink/88 shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.12)]',
  secondary: 'bg-raised text-ink shadow-card hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
  outline: 'text-ink shadow-[inset_0_0_0_1px_var(--gray-a6)] hover:bg-hover',
  danger: 'bg-bad text-white hover:bg-bad/90',
  accent: 'bg-accent text-[var(--gray-12)] dark:text-[#111] hover:bg-accent-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]',
  link: 'text-accent-ink hover:underline underline-offset-4 active:scale-100 px-0 h-auto',
}

const sizes: Record<Size, string> = {
  xs: 'h-6 px-2 text-[12px] rounded-[6px] gap-1',
  sm: 'h-7 px-2.5 text-[12.5px] rounded-[7px]',
  md: 'h-8 px-3 text-[13px] rounded-[8px]',
  lg: 'h-10 px-4 text-[14px] rounded-[10px]',
  xl: 'h-12 px-6 text-[15px] rounded-full',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  pill?: boolean
  loading?: boolean
  icon?: ReactNode
  trailing?: ReactNode
}

export function buttonClass({ variant = 'secondary', size = 'md', pill, className }: { variant?: Variant; size?: Size; pill?: boolean; className?: string } = {}) {
  return cn(base, variants[variant], sizes[size], pill && 'rounded-full', className)
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', pill, loading, icon, trailing, className, children, disabled, type = 'button', ...props }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass({ variant, size, pill, className })} {...props}>
      {loading ? <Spinner className="size-3.5" /> : icon}
      {children}
      {trailing}
    </button>
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' | 'lg'; variant?: 'ghost' | 'secondary' | 'outline' }>(function IconButton({ label, size = 'md', variant = 'ghost', className, children, type = 'button', ...props }, ref) {
  const s = size === 'sm' ? 'size-7 rounded-[7px]' : size === 'lg' ? 'size-10 rounded-[10px]' : 'size-8 rounded-[8px]'
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={cn(base, variants[variant], s, 'touch-target p-0', className)} {...props}>
      {children}
    </button>
  )
})

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('animate-spin', className)} aria-hidden style={{ animationDuration: '700ms' }}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
