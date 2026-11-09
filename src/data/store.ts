import { create } from 'zustand'
import { createContext, useCallback, useContext } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Session, Snapshot } from '~/lib/types'
import { isCloudConfigured } from '~/lib/env'
import type { Backend, WorkspaceRef } from './backend'
import { createLocalBackend, ensureDemo } from './local'
import { applyChangeSet, isEmpty, type ChangeSet } from './changeset'

const MODE_KEY = 'nau:mode'
const WS_KEY = 'nau:workspace'

let backends: Partial<Record<Session['mode'], Backend>> = {}

async function backendFor(mode: Session['mode']): Promise<Backend> {
  if (backends[mode]) return backends[mode]!
  let b: Backend
  if (mode === 'cloud') {
    const { createCloudBackend } = await import('./cloud')
    b = createCloudBackend()
  } else b = createLocalBackend(mode === 'demo')
  backends[mode] = b
  return b
}

export function primaryMode(): Session['mode'] {
  return isCloudConfigured ? 'cloud' : 'local'
}

interface SessionState {
  status: 'idle' | 'loading' | 'signedOut' | 'signedIn'
  session: Session | null
  backend: Backend | null
  workspaces: WorkspaceRef[]
  workspaceId: string | null
  init(): Promise<void>
  useMode(mode: Session['mode']): Promise<void>
  enterDemo(): Promise<void>
  leaveDemo(): Promise<void>
  refreshWorkspaces(): Promise<WorkspaceRef[]>
  setWorkspace(id: string | null): void
  signOut(): Promise<void>
}

let unsub: (() => void) | null = null

export const useSession = create<SessionState>((setState, getState) => ({
  status: 'idle',
  session: null,
  backend: null,
  workspaces: [],
  workspaceId: null,
  async init() {
    if (getState().status !== 'idle') return
    setState({ status: 'loading' })
    let mode: Session['mode'] = primaryMode()
    try {
      if (localStorage.getItem(MODE_KEY) === 'demo') mode = 'demo'
    } catch {
      /* storage unavailable */
    }
    await getState().useMode(mode)
  },
  async useMode(mode) {
    const backend = await backendFor(mode)
    unsub?.()
    const apply = async (session: Session | null) => {
      if (!session) {
        setState({ session: null, status: 'signedOut', workspaces: [], workspaceId: null, backend })
        return
      }
      setState({ session, backend })
      const ws = await getState().refreshWorkspaces()
      let preferred: string | null = null
      try {
        preferred = localStorage.getItem(WS_KEY)
      } catch {
        /* noop */
      }
      const id = ws.find((w) => w.id === preferred)?.id ?? ws[0]?.id ?? null
      setState({ workspaceId: id, status: 'signedIn' })
    }
    unsub = backend.onAuthChange((s) => {
      const prev = getState().session
      if (prev?.user.id !== s?.user.id) void apply(s)
      else if (s) setState({ session: s })
    })
    await apply(await backend.getSession())
  },
  async enterDemo() {
    try {
      localStorage.setItem(MODE_KEY, 'demo')
    } catch {
      /* noop */
    }
    setState({ status: 'loading' })
    const id = await ensureDemo()
    await getState().useMode('demo')
    setState({ workspaceId: id })
  },
  async leaveDemo() {
    try {
      localStorage.removeItem(MODE_KEY)
    } catch {
      /* noop */
    }
    setState({ status: 'loading' })
    await getState().useMode(primaryMode())
  },
  async refreshWorkspaces() {
    const b = getState().backend
    const ws = b ? await b.listWorkspaces() : []
    setState({ workspaces: ws })
    return ws
  },
  setWorkspace(id) {
    try {
      if (id) localStorage.setItem(WS_KEY, id)
    } catch {
      /* noop */
    }
    setState({ workspaceId: id })
  },
  async signOut() {
    const { session } = getState()
    if (session?.mode === 'demo') return getState().leaveDemo()
    await getState().backend?.signOut()
  },
}))

/* ───────────── Snapshot context: everything inside /app reads from here ───────────── */

export const SnapshotContext = createContext<Snapshot | null>(null)

export function useSnapshot(): Snapshot {
  const s = useContext(SnapshotContext)
  if (!s) throw new Error('useSnapshot must be used inside the app shell')
  return s
}

export const snapshotKey = (mode: string | undefined, id: string | null) => ['snapshot', mode, id] as const

export function useCommit() {
  const qc = useQueryClient()
  const { backend, workspaceId, session } = useSession()
  return useCallback(
    async (cs: ChangeSet, opts: { success?: string; description?: string; undo?: ChangeSet } = {}) => {
      if (!backend || !workspaceId || isEmpty(cs)) return
      const key = snapshotKey(session?.mode, workspaceId)
      const prev = qc.getQueryData<Snapshot>(key)
      if (prev) qc.setQueryData(key, applyChangeSet(prev, cs))
      try {
        await backend.commit(workspaceId, cs)
        if (opts.success)
          toast.success(opts.success, {
            description: opts.description,
            action: opts.undo
              ? {
                  label: 'Undo',
                  onClick: () => {
                    const cur = qc.getQueryData<Snapshot>(key)
                    if (cur) qc.setQueryData(key, applyChangeSet(cur, opts.undo!))
                    void backend.commit(workspaceId, opts.undo!)
                  },
                }
              : undefined,
          })
        if (backend.mode === 'cloud') void qc.invalidateQueries({ queryKey: key })
      } catch (e) {
        if (prev) qc.setQueryData(key, prev)
        toast.error('That didn’t save', { description: e instanceof Error ? e.message : String(e) })
        throw e
      }
    },
    [qc, backend, workspaceId, session?.mode],
  )
}

export function useCanWrite() {
  const { workspaces, workspaceId } = useSession()
  const role = workspaces.find((w) => w.id === workspaceId)?.role ?? 'owner'
  return role !== 'viewer'
}
