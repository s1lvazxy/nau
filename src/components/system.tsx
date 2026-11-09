import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { Mark } from '~/components/brand/logo'
import { buttonClass } from '~/components/ui/button'

export function NotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
      <Mark size={36} className="text-ink-4" />
      <p className="mt-6 font-mono text-[12px] tracking-[0.08em] text-ink-3 uppercase">404 · Off the chart</p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">This page isn’t on the map.</h1>
      <p className="mt-2 max-w-sm text-[14px] text-ink-3">The link may be old, or the page moved. Your stock is fine.</p>
      <Link to="/" className={buttonClass({ variant: 'primary', size: 'lg', pill: true, className: 'mt-6' })}>
        Back to Nau
      </Link>
    </div>
  )
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 text-center">
      <Mark size={32} className="text-bad" />
      <h1 className="mt-5 text-[20px] font-semibold tracking-[-0.02em]">Something broke on our side</h1>
      <p className="mt-2 max-w-md text-[13px] text-ink-3">{error instanceof Error ? error.message : 'Unexpected error'}. Nothing you saved was lost.</p>
      <button
        className={buttonClass({ variant: 'secondary', className: 'mt-5' })}
        onClick={() => {
          reset()
          void router.invalidate()
        }}
      >
        Try again
      </button>
    </div>
  )
}
