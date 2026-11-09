/** Small in-memory guards for public endpoints (per instance). Put a CDN/WAF rate limit in front in production. */
const buckets = new Map<string, { n: number; reset: number }>()

export function rateLimited(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs })
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k)
    return false
  }
  b.n++
  return b.n > max
}

export function clientIp(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'local'
  )
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

export const json = (data: unknown, init?: number | ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...(typeof init === 'number' ? { status: init } : init),
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

/**
 * Who may spend model calls:
 * - Cloud configured: a signed-in Supabase user (per-user limits), or the public demo (strict per-IP + global limits).
 * - No cloud (self-hosted local mode): treated like the demo.
 */
export async function authorizeModelCall(request: Request, scope: 'agent' | 'extract'): Promise<{ ok: true; who: string } | { ok: false; res: Response }> {
  const { verifyUser, supabaseEnv } = await import('./supabase-env')
  const mode = request.headers.get('x-nau-mode')
  const ip = clientIp(request)
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
  const env = supabaseEnv()
  if (env.url && env.anon && mode !== 'demo') {
    const user = await verifyUser(token)
    if (!user) return { ok: false, res: json({ error: 'Sign in to use Operator.' }, 401) }
    const perMin = scope === 'agent' ? 30 : 6
    const perDay = scope === 'agent' ? 1500 : 200
    if (rateLimited(`${scope}:u:${user.id}`, perMin, 60_000) || rateLimited(`${scope}:ud:${user.id}`, perDay, 86_400_000)) return { ok: false, res: json({ error: 'Too many requests' }, 429) }
    return { ok: true, who: `user:${user.id}` }
  }
  if (mode === 'demo' && process.env.NAU_AGENT_DEMO === 'off') return { ok: false, res: json({ error: 'The demo runs on the built-in engine.' }, 503) }
  const perMin = scope === 'agent' ? 10 : 3
  if (rateLimited(`${scope}:ip:${ip}`, perMin, 60_000) || rateLimited(`${scope}:ipd:${ip}`, scope === 'agent' ? 200 : 20, 86_400_000) || rateLimited(`${scope}:global`, scope === 'agent' ? 600 : 60, 3_600_000))
    return { ok: false, res: json({ error: 'Too many requests' }, 429) }
  return { ok: true, who: `ip:${ip}` }
}
