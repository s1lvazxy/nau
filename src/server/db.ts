import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Snapshot } from '~/lib/types'
import { isEmpty, type ChangeSet } from '~/data/changeset'
import { changeSetToDb } from '~/data/changeset-db'
import { loadSnapshot } from '~/data/load'
import { supabaseEnv } from './supabase-env'

let client: SupabaseClient | null = null

export const serverConfigured = () => {
  const e = supabaseEnv()
  return Boolean(e.url && e.service)
}

/** Service-role client: bypasses row-level security. Server code only — every caller scopes by workspace itself. */
export function admin(): SupabaseClient {
  const e = supabaseEnv()
  if (!e.url || !e.service) throw new Error('The server database is not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).')
  client ??= createClient(e.url, e.service, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

export const load = (workspaceId: string): Promise<Snapshot> => loadSnapshot(admin(), workspaceId)

/** The server's write path: the same change set, applied by the same function, under the service role. */
export async function commit(workspaceId: string, cs: ChangeSet) {
  if (isEmpty(cs)) return
  // Large ledgers go in slices so one request never carries more than a few thousand movements
  const moves = cs.movements ?? []
  const first: ChangeSet = { ...cs, movements: moves.slice(0, 2000) }
  const { error } = await admin().rpc('apply_changeset_service', { p_workspace: workspaceId, p_changes: changeSetToDb(first) })
  if (error) throw new Error(error.message)
  for (let i = 2000; i < moves.length; i += 2000) {
    const r = await admin().rpc('apply_changeset_service', { p_workspace: workspaceId, p_changes: changeSetToDb({ movements: moves.slice(i, i + 2000) }) })
    if (r.error) throw new Error(r.error.message)
  }
}
