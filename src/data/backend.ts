import type { Role, Session, Snapshot } from '~/lib/types'
import type { ChangeSet } from './changeset'

export interface WorkspaceRef {
  id: string
  name: string
  role: Role
}

export interface Backend {
  mode: Session['mode']
  getSession(): Promise<Session | null>
  onAuthChange(cb: (s: Session | null) => void): () => void
  signUp(input: { name: string; email: string; password: string }): Promise<{ confirm: boolean }>
  signIn(input: { email: string; password: string }): Promise<void>
  magicLink(email: string): Promise<void>
  oauth(provider: 'google'): Promise<void>
  resetPassword(email: string): Promise<void>
  updatePassword(password: string): Promise<void>
  updateProfile(patch: { name: string }): Promise<void>
  signOut(): Promise<void>
  listWorkspaces(): Promise<WorkspaceRef[]>
  createWorkspace(initial: Snapshot): Promise<string>
  deleteWorkspace(id: string): Promise<void>
  load(workspaceId: string): Promise<Snapshot>
  commit(workspaceId: string, cs: ChangeSet): Promise<void>
  subscribe?(workspaceId: string, onChange: () => void): () => void
}

export class AuthError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}
