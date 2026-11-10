import { verifyUser } from './supabase-env'
import { sha256 } from './crypto'
import { admin, serverConfigured } from './db'
import { clientIp, json, rateLimited } from './guard'
import { tr } from '~/i18n'

type Fail = { ok: false; res: Response }
const RANK = { viewer: 0, member: 1, admin: 2, owner: 3 } as const
export type Role = keyof typeof RANK

/** A signed-in person with at least `min` on the workspace. The role comes from the database, never from the request. */
export async function requireMember(request: Request, workspaceId: unknown, min: Role = 'member'): Promise<{ ok: true; user: { id: string; email: string }; role: Role } | Fail> {
  if (!serverConfigured()) return { ok: false, res: json({ error: tr('This needs the server database. Connect Supabase (cloud or self-hosted) to use it.') }, 503) }
  if (typeof workspaceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(workspaceId)) return { ok: false, res: json({ error: tr('Unknown workspace') }, 400) }
  const user = await verifyUser(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null)
  if (!user) return { ok: false, res: json({ error: tr('Sign in first.') }, 401) }
  if (rateLimited(`srv:u:${user.id}`, 120, 60_000)) return { ok: false, res: json({ error: tr('Too many requests') }, 429) }
  const { data } = await admin().from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).eq('status', 'active').maybeSingle()
  const role = data?.role as Role | undefined
  if (!role) return { ok: false, res: json({ error: tr('Unknown workspace') }, 404) }
  if (RANK[role] < RANK[min]) return { ok: false, res: json({ error: min === 'admin' ? tr('Only owners and admins can do this.') : tr('You have view-only access.') }, 403) }
  return { ok: true, user, role }
}

export const API_KEY_PREFIX = 'nau_'

/** `Authorization: Bearer nau_…` → the workspace the key belongs to. Only the SHA-256 of a key is ever stored. */
export async function requireApiKey(request: Request, scope: 'read' | 'write'): Promise<{ ok: true; workspaceId: string; keyId: string; name: string } | Fail> {
  const fail = (status: number, code: string, message: string): Fail => ({ ok: false, res: json({ error: { code, message } }, status) })
  if (!serverConfigured()) return fail(503, 'not_configured', 'The API needs the server database.')
  const key = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? ''
  if (rateLimited(`api:ip:${clientIp(request)}`, 600, 60_000)) return fail(429, 'rate_limited', 'Too many requests.')
  if (!key.startsWith(API_KEY_PREFIX) || key.length < 30) return fail(401, 'unauthorized', 'Send your API key as “Authorization: Bearer nau_…”.')
  const { data } = await admin().from('api_keys').select('id, workspace_id, name, scopes, revoked_at').eq('hash', sha256(key)).maybeSingle()
  if (!data || data.revoked_at) return fail(401, 'unauthorized', 'This API key is not valid.')
  if (rateLimited(`api:k:${data.id}`, 300, 60_000)) return fail(429, 'rate_limited', 'Too many requests. The limit is 300 per minute per key.')
  if (scope === 'write' && !(data.scopes as string[]).includes('write')) return fail(403, 'forbidden', 'This key is read-only.')
  void admin().from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => undefined, () => undefined)
  return { ok: true, workspaceId: data.workspace_id as string, keyId: data.id as string, name: data.name as string }
}
