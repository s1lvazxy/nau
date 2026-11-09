import type { Session as SbSession } from '@supabase/supabase-js'
import type { Session, Workspace } from '~/lib/types'
import { env } from '~/lib/env'
import { addDays } from '~/lib/format'
import { hashString } from '~/lib/utils'
import { AuthError, type Backend, type WorkspaceRef } from './backend'
import type { ChangeSet } from './changeset'
import { loadSnapshot } from './load'
import { supabase } from './supabase'
import { changeSetToDb } from './changeset-db'

export { changeSetToDb }

function toSession(s: SbSession | null): Session | null {
  if (!s?.user) return null
  const u = s.user
  const email = u.email ?? ''
  return {
    mode: 'cloud',
    user: { id: u.id, email, name: (u.user_metadata?.name as string) || email.split('@')[0], hue: hashString(email) % 360 },
  }
}

function fail(error: { message: string; code?: string } | null): asserts error is null {
  if (error) {
    const msg = /Invalid login/i.test(error.message)
      ? 'That email and password don’t match.'
      : /already registered/i.test(error.message)
        ? 'An account with this email already exists. Sign in instead.'
        : /Email not confirmed/i.test(error.message)
          ? 'Confirm your email first — we sent you a link.'
          : error.message
    throw new AuthError(msg, error.code)
  }
}

export function createCloudBackend(): Backend {
  const sb = supabase()
  const redirect = (path: string) => `${typeof window !== 'undefined' ? window.location.origin : env.siteUrl}${path}`

  return {
    mode: 'cloud',
    async getSession() {
      const { data } = await sb.auth.getSession()
      return toSession(data.session)
    },
    onAuthChange(cb) {
      // Never call Supabase from inside this callback: it runs under the auth lock (deadlock). Defer instead.
      const { data } = sb.auth.onAuthStateChange((_e, s) => {
        setTimeout(() => cb(toSession(s)), 0)
      })
      return () => data.subscription.unsubscribe()
    },
    async signUp({ name, email, password }) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: redirect('/auth/callback') } })
      fail(error)
      return { confirm: !data.session }
    },
    async signIn({ email, password }) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      fail(error)
    },
    async magicLink(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect('/auth/callback') } })
      fail(error)
    },
    async oauth(provider) {
      const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: redirect('/auth/callback') } })
      fail(error)
    },
    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect('/reset-password') })
      fail(error)
    },
    async updatePassword(password) {
      const { error } = await sb.auth.updateUser({ password })
      fail(error)
    },
    async updateProfile({ name }) {
      const { error } = await sb.auth.updateUser({ data: { name } })
      fail(error)
      const { data } = await sb.auth.getSession()
      if (data.session?.user) await sb.from('profiles').update({ name }).eq('id', data.session.user.id)
    },
    async signOut() {
      await sb.auth.signOut()
    },
    async listWorkspaces(): Promise<WorkspaceRef[]> {
      const { data: auth } = await sb.auth.getSession()
      const user = auth.session?.user
      if (!user) return []
      const { data, error } = await sb.from('workspace_members').select('role, workspaces(id, name)').eq('user_id', user.id).eq('status', 'active')
      fail(error)
      return (data ?? [])
        .map((r) => {
          const w = r.workspaces as unknown as { id: string; name: string } | null
          return w ? { id: w.id, name: w.name, role: r.role as WorkspaceRef['role'] } : null
        })
        .filter(Boolean) as WorkspaceRef[]
    },
    async createWorkspace(initial) {
      const w = initial.workspace
      const { data, error } = await sb.rpc('create_workspace', {
        p_id: w.id,
        p_name: w.name,
        p_slug: w.slug,
        p_nif: w.nif ?? null,
        p_sector: w.sector,
        p_region: w.region,
        p_settings: w.settings,
        p_owner_name: initial.members[0]?.name ?? null,
      })
      fail(error)
      const id = data as string
      // Seed the rest of the workspace in one transaction
      const levels = initial.levels
      const cs: ChangeSet = {
        upserts: {
          locations: initial.locations,
          categories: initial.categories,
          suppliers: initial.suppliers,
          items: initial.items,
          playbooks: initial.playbooks,
          dashboards: initial.dashboards,
          rules: initial.rules,
          proposals: initial.proposals,
          receipts: initial.receipts,
          orders: initial.orders,
          counts: initial.counts,
          members: initial.members.slice(1),
        },
        movements: [
          // History is replayed without lot codes; current lots are written afterwards
          ...initial.movements.map((m) => ({ ...m, batchCode: null })),
          // Opening balances for anything not explained by history
          ...levels
            .map((l) => {
              const hist = initial.movements.filter((m) => m.itemId === l.itemId && m.locationId === l.locationId).reduce((a, m) => a + m.qty, 0)
              const diff = Math.round((l.onHand - hist) * 1000) / 1000
              return diff
                ? { id: crypto.randomUUID(), itemId: l.itemId, locationId: l.locationId, type: 'count' as const, qty: diff, actor: { kind: 'system' as const, name: 'Opening balance' }, createdAt: addDays(new Date(), -91).toISOString(), note: 'Opening balance' }
                : null
            })
            .filter((x) => x !== null),
        ],
        events: initial.events,
      }
      // Large demo seeds are sent in chunks to stay under request limits
      const movs = cs.movements ?? []
      const first: ChangeSet = { ...cs, movements: movs.slice(0, 2000) }
      await this.commit(id, first)
      for (let i = 2000; i < movs.length; i += 2000) await this.commit(id, { movements: movs.slice(i, i + 2000) })
      if (initial.batches.length) await this.commit(id, { upserts: { batches: initial.batches } })
      return id
    },
    async deleteWorkspace(id) {
      const { error } = await sb.rpc('delete_workspace', { p_workspace: id })
      fail(error)
    },
    load: (workspaceId) => loadSnapshot(sb, workspaceId),
    async commit(workspaceId, cs) {
      const { error } = await sb.rpc('apply_changeset', { p_workspace: workspaceId, p_changes: changeSetToDb(cs) })
      fail(error)
    },
    subscribe(workspaceId, onChange) {
      let t: ReturnType<typeof setTimeout> | undefined
      const ping = () => {
        clearTimeout(t)
        t = setTimeout(onChange, 400)
      }
      const ch = sb.channel(`ws:${workspaceId}`)
      for (const table of ['movements', 'proposals', 'purchase_orders', 'receipts', 'counts', 'items', 'dashboards', 'events', 'actions'])
        ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `workspace_id=eq.${workspaceId}` }, ping)
      ch.subscribe()
      return () => {
        clearTimeout(t)
        void sb.removeChannel(ch)
      }
    },
  }
}
