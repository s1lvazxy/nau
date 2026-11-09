import crypto from 'node:crypto'

/**
 * Secrets at rest (connector credentials) are sealed with AES-256-GCM under NAU_SECRET_KEY.
 * Generate one with:  openssl rand -base64 32
 */
function key(): Buffer {
  const raw = process.env.NAU_SECRET_KEY
  if (!raw) throw new Error('NAU_SECRET_KEY is not set. Connectors need it to keep credentials encrypted.')
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('NAU_SECRET_KEY must be 32 bytes (base64 or hex).')
  return buf
}

export const secretsConfigured = () => {
  try {
    key()
    return true
  } catch {
    return false
  }
}

export function seal(value: unknown): string {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()])
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${body.toString('base64url')}`
}

export function open<T = Record<string, string>>(sealed: string | null | undefined): T {
  if (!sealed) return {} as T
  const [v, iv, tag, body] = sealed.split('.')
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('Unreadable secret')
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  try {
    return JSON.parse(Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8')) as T
  } catch {
    // The key changed since this was sealed: say so instead of surfacing a cipher error
    throw new Error('The stored credentials can’t be read with the current NAU_SECRET_KEY. Reconnect this system.')
  }
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
export const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url')
export const hmac = (secret: string, payload: string | Buffer, encoding: 'hex' | 'base64' = 'hex') => crypto.createHmac('sha256', secret).update(payload).digest(encoding)

/** Constant-time comparison of two signatures given as text. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
