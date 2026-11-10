import { useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Mark } from '~/components/brand/logo'
import { useSession } from '~/data/store'
import { tr } from '~/i18n'

export const Route = createFileRoute('/auth/callback')({
  ssr: false,
  component: Callback,
})

function Callback() {
  const navigate = useNavigate()
  const { init, status, workspaces } = useSession()
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    void init()
    const t = setTimeout(() => setSlow(true), 6000)
    return () => clearTimeout(t)
  }, [init])
  useEffect(() => {
    if (status === 'signedIn') void navigate({ to: workspaces.length ? '/app' : '/onboarding', replace: true })
  }, [status, workspaces, navigate])
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 text-center">
      <Mark size={28} working className="text-ink" />
      <p className="text-[14px] text-ink-3">{tr('Signing you in…')}</p>
      {slow && (
        <p className="text-[13px] text-ink-4">
          {tr('Taking longer than usual.')}
          <Link to="/login" className="underline underline-offset-2">
            {tr('Back to sign in')}
          </Link>
        </p>
      )}
    </div>
  )
}
