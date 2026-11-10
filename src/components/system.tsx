import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { Mark } from '~/components/brand/logo'
import { buttonClass } from '~/components/ui/button'
import { tr } from '~/i18n'

export function NotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
      <Mark size={36} className="text-ink-4" />
      <p className="mt-6 font-mono text-[12px] tracking-[0.08em] text-ink-3 uppercase">{tr('404 · Off the chart')}</p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">{tr('This page isn’t on the map.')}</h1>
      <p className="mt-2 max-w-sm text-[14px] text-ink-3">{tr('The link may be old, or the page moved. Your stock is fine.')}</p>
      <Link to="/" className={buttonClass({ variant: 'primary', size: 'lg', pill: true, className: 'mt-6' })}>
        {tr('Back to Nau')}
      </Link>
    </div>
  )
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 text-center">
      <Mark size={32} className="text-bad" />
      <h1 className="mt-5 text-[20px] font-semibold tracking-[-0.02em]">{tr('Something broke on our side')}</h1>
      <p className="mt-2 max-w-md text-[13px] text-ink-3">{tr('{0}. Nothing you saved was lost.', error instanceof Error ? error.message : tr('Unexpected error'))}</p>
      <button
        className={buttonClass({ variant: 'secondary', className: 'mt-5' })}
        onClick={() => {
          reset()
          void router.invalidate()
        }}
      >
        {tr('Try again')}
      </button>
    </div>
  )
}
