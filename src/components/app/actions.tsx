import { createContext, useContext } from 'react'
import type { ChangeSet } from '~/data/changeset'
import type { Actor } from '~/lib/types'

export interface ActionsCtx {
  commit: (cs: ChangeSet, opts?: { success?: string; description?: string; undo?: ChangeSet }) => Promise<void>
  actor: Actor
  navigate: (to: string) => void
  canWrite: boolean
  demo?: boolean
}

export const ActionsContext = createContext<ActionsCtx | null>(null)

export function useActions(): ActionsCtx {
  const c = useContext(ActionsContext)
  if (!c) throw new Error('useActions must be used inside ActionsContext')
  return c
}
