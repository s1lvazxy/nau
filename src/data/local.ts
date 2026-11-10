import { createStore, del, get, set } from 'idb-keyval'
import type { Session, Snapshot, UserProfile } from '~/lib/types'
import { hashString, uid } from '~/lib/utils'
import { createDemoSnapshot } from '~/lib/seed'
import { applyChangeSet, type ChangeSet } from './changeset'
import { AuthError, type Backend, type WorkspaceRef } from './backend'
import { tr } from '~/i18n'

interface LocalUser extends UserProfile {
  salt: string
  hash: string
  createdAt: string
}
interface IndexEntry {
  id: string
  name: string
  ownerId: string
}

const store = typeof indexedDB !== 'undefined' ? createStore('nau', 'kv') : undefined
const SESSION_KEY = 'nau:session'
const DEMO_USER: UserProfile = { id: 'demo-guest', email: 'guest@nau.demo', name: tr('Guest'), hue: 24 }
export const DEMO_WS_KEY = 'nau:demo'

async function pbkdf2(password: string, salt: string) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 120_000 }, key, 256)
  return btoa(String.fromCharCode(...new Uint8Array(bits)))
}

const listeners = new Set<(s: Session | null) => void>()
const cache = new Map<string, Snapshot>()
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>()

function persist(key: string, snap: Snapshot) {
  clearTimeout(writeTimers.get(key))
  writeTimers.set(
    key,
    setTimeout(() => {
      void set(key, snap, store)
    }, 250),
  )
}

function readSessionUser(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

export function createLocalBackend(demo: boolean): Backend {
  const mode: Session['mode'] = demo ? 'demo' : 'local'
  const wsKey = (id: string) => (demo ? DEMO_WS_KEY : `nau:ws:${id}`)

  async function users(): Promise<LocalUser[]> {
    return ((await get('nau:users', store)) as LocalUser[] | undefined) ?? []
  }
  async function index(): Promise<IndexEntry[]> {
    return ((await get('nau:ws-index', store)) as IndexEntry[] | undefined) ?? []
  }
  async function current(): Promise<Session | null> {
    if (demo) return { user: DEMO_USER, mode }
    const id = readSessionUser()
    if (!id) return null
    const u = (await users()).find((x) => x.id === id)
    return u ? { user: { id: u.id, email: u.email, name: u.name, hue: u.hue }, mode } : null
  }
  async function emit() {
    const s = await current()
    listeners.forEach((l) => l(s))
  }

  return {
    mode,
    getSession: current,
    onAuthChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async signUp({ name, email, password }) {
      const all = await users()
      const norm = email.trim().toLowerCase()
      if (all.some((u) => u.email === norm)) throw new AuthError(tr('An account with this email already exists. Sign in instead.'), 'exists')
      const salt = uid()
      const user: LocalUser = { id: uid(), email: norm, name: name.trim(), hue: hashString(norm) % 360, salt, hash: await pbkdf2(password, salt), createdAt: new Date().toISOString() }
      await set('nau:users', [...all, user], store)
      localStorage.setItem(SESSION_KEY, user.id)
      await emit()
      return { confirm: false }
    },
    async signIn({ email, password }) {
      const u = (await users()).find((x) => x.email === email.trim().toLowerCase())
      if (!u || (await pbkdf2(password, u.salt)) !== u.hash) throw new AuthError(tr('That email and password don’t match.'), 'invalid')
      localStorage.setItem(SESSION_KEY, u.id)
      await emit()
    },
    async magicLink() {
      throw new AuthError(tr('Magic links need the server database. Use your password in local mode.'), 'unsupported')
    },
    async oauth() {
      throw new AuthError(tr('Google sign-in needs the server database. Use your email and password in local mode.'), 'unsupported')
    },
    async resetPassword(email) {
      const u = (await users()).find((x) => x.email === email.trim().toLowerCase())
      if (!u) return
      // Local mode has no email: we hand back a reset token through the session
      localStorage.setItem('nau:reset', u.id)
    },
    async updatePassword(password) {
      const id = localStorage.getItem('nau:reset') ?? readSessionUser()
      if (!id) throw new AuthError(tr('Your reset link has expired. Ask for a new one.'), 'expired')
      const all = await users()
      const u = all.find((x) => x.id === id)
      if (!u) throw new AuthError(tr('Account not found.'), 'missing')
      u.salt = uid()
      u.hash = await pbkdf2(password, u.salt)
      await set('nau:users', all, store)
      localStorage.removeItem('nau:reset')
      localStorage.setItem(SESSION_KEY, u.id)
      await emit()
    },
    async updateProfile({ name }) {
      if (demo) return
      const all = await users()
      const id = readSessionUser()
      const u = all.find((x) => x.id === id)
      if (u) {
        u.name = name
        await set('nau:users', all, store)
        await emit()
      }
    },
    async signOut() {
      if (!demo) localStorage.removeItem(SESSION_KEY)
      await emit()
    },
    async listWorkspaces(): Promise<WorkspaceRef[]> {
      if (demo) {
        const snap = (await get(DEMO_WS_KEY, store)) as Snapshot | undefined
        return snap ? [{ id: snap.workspace.id, name: snap.workspace.name, role: 'owner' }] : []
      }
      const s = await current()
      if (!s) return []
      return (await index()).filter((w) => w.ownerId === s.user.id).map((w) => ({ id: w.id, name: w.name, role: 'owner' }))
    },
    async createWorkspace(initial) {
      if (demo) {
        await set(DEMO_WS_KEY, initial, store)
        cache.set(DEMO_WS_KEY, initial)
        return initial.workspace.id
      }
      const s = await current()
      if (!s) throw new AuthError(tr('Sign in first.'))
      await set(wsKey(initial.workspace.id), initial, store)
      cache.set(wsKey(initial.workspace.id), initial)
      await set('nau:ws-index', [...(await index()), { id: initial.workspace.id, name: initial.workspace.name, ownerId: s.user.id }], store)
      return initial.workspace.id
    },
    async deleteWorkspace(id) {
      await del(wsKey(id), store)
      cache.delete(wsKey(id))
      if (!demo) await set('nau:ws-index', (await index()).filter((w) => w.id !== id), store)
    },
    async load(workspaceId) {
      const key = wsKey(workspaceId)
      const hit = cache.get(key)
      if (hit) return hit
      let snap = (await get(key, store)) as Snapshot | undefined
      if (!snap && demo) {
        snap = createDemoSnapshot()
        await set(key, snap, store)
      }
      if (!snap) throw new Error(tr('Workspace not found'))
      // Workspaces saved before the journal existed
      if (!snap.actions || !snap.rules) snap = { ...snap, actions: snap.actions ?? [], rules: snap.rules ?? [] }
      cache.set(key, snap)
      return snap
    },
    async commit(workspaceId, cs: ChangeSet) {
      const key = wsKey(workspaceId)
      const base = cache.get(key) ?? (await this.load(workspaceId))
      const next = applyChangeSet(base, cs)
      cache.set(key, next)
      persist(key, next)
      if (!demo && cs.workspace?.name) {
        const idx = await index()
        const e = idx.find((w) => w.id === workspaceId)
        if (e) {
          e.name = cs.workspace.name
          await set('nau:ws-index', idx, store)
        }
      }
    },
  }
}

export async function resetDemo(): Promise<Snapshot> {
  const snap = createDemoSnapshot()
  cache.set(DEMO_WS_KEY, snap)
  await set(DEMO_WS_KEY, snap, store)
  return snap
}

export async function ensureDemo(): Promise<string> {
  const existing = (await get(DEMO_WS_KEY, store)) as Snapshot | undefined
  if (existing) {
    // Refresh demo data if it is older than 12 hours so the story stays "live"
    const age = Date.now() - new Date(existing.proposals[0]?.createdAt ?? existing.workspace.createdAt).getTime()
    if (age < 12 * 3600 * 1000) return existing.workspace.id
  }
  return (await resetDemo()).workspace.id
}
