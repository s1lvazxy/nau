import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSession } from '~/data/store'
import { tr } from '~/i18n'

/** Boots the session store and sends signed-in people to the right place. */
export function useRedirectIfSignedIn(to = '/app') {
  const { status, workspaceId, session, init } = useSession()
  const navigate = useNavigate()
  useEffect(() => {
    void init()
  }, [init])
  useEffect(() => {
    if (status === 'signedIn' && session && session.mode !== 'demo') void navigate({ to: workspaceId ? to : '/onboarding' })
  }, [status, workspaceId, session, navigate, to])
  return status
}

export function errorText(errors: unknown[]) {
  const e = errors.find(Boolean)
  if (!e) return null
  if (typeof e === 'string') return tr(e)
  if (typeof e === 'object' && e && 'message' in e) return tr(String((e as { message: string }).message))
  return tr('Valor inválido')
}
