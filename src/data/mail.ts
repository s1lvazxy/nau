import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { accessToken } from '~/agent/operator'
import { snapshotKey, useSession } from './store'

/**
 * Whether this installation sends email itself (the host set up Resend), and a nudge to deliver what was just queued.
 * In local mode and in the demo it is always off, and orders open in the person's own mail app instead.
 */
export function useMail() {
  const { session, workspaceId } = useSession()
  const cloud = session?.mode === 'cloud'
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['mail', workspaceId],
    enabled: cloud && Boolean(workspaceId),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<{ enabled: boolean; from?: string }> => {
      const token = await accessToken()
      const res = await fetch(`/api/mail?workspace=${workspaceId}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
      return res.ok ? await res.json() : { enabled: false }
    },
  })
  const deliver = useCallback(async (): Promise<{ sent: number; failed: number }> => {
    const token = await accessToken()
    const res = await fetch('/api/mail', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ workspace: workspaceId }) })
    if (!res.ok) throw new Error(String(res.status))
    const out = (await res.json()) as { sent: number; failed: number }
    // The server wrote what happened onto the orders: show it now instead of waiting for the live feed
    void qc.invalidateQueries({ queryKey: snapshotKey(session?.mode, workspaceId) })
    return out
  }, [workspaceId, session?.mode, qc])
  return { enabled: cloud && q.data?.enabled === true, from: q.data?.from ?? '', deliver }
}
