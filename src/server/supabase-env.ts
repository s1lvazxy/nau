/** Where the database lives, read from the environment at request time so one build runs anywhere. */
export function supabaseEnv() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    anon: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
    service: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  }
}

/** The person behind a Supabase access token, or null. */
export async function verifyUser(token: string | null) {
  const { url, anon } = supabaseEnv()
  if (!token || !url || !anon) return null
  const r = await fetch(`${url}/auth/v1/user`, { headers: { authorization: `Bearer ${token}`, apikey: anon } })
  if (!r.ok) return null
  return (await r.json()) as { id: string; email: string }
}
