import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { tr } from '~/i18n'

export class ConnectorError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
  }
}

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(127|10|192\.168|169\.254)\./i]
const isPrivate = (ip: string) => PRIVATE.some((r) => r.test(ip))

/**
 * Connector addresses can come from the person (a WooCommerce shop, a webhook target).
 * They must be public HTTPS hosts: a request to the server's own network is refused before it leaves.
 * NAU_ALLOW_PRIVATE_HOSTS=1 lifts this for local development and tests.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConnectorError(tr('That address is not a valid URL.'))
  }
  if (process.env.NAU_ALLOW_PRIVATE_HOSTS === '1') return url
  if (url.protocol !== 'https:') throw new ConnectorError(tr('The address must start with https://'))
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new ConnectorError(tr('That address points inside the server’s network.'))
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address)
  if (!ips.length) throw new ConnectorError(tr('Could not find {0}.', host))
  if (ips.some(isPrivate)) throw new ConnectorError(tr('That address points inside the server’s network.'))
  return url
}

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | undefined | null | string[]>
  json?: unknown
  form?: Record<string, string | number>
  /** The host was typed by a person: check it is public first */
  untrusted?: boolean
  /** Hand back the Response without reading it (redirect inspection) */
  raw?: boolean
  redirect?: RequestRedirect
  timeoutMs?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One outbound call with a timeout, one polite retry on 429/5xx, and errors that name the vendor's own message. */
export async function request<T = any>(url: string, o: RequestOptions = {}): Promise<T> {
  const u = o.untrusted ? await assertPublicUrl(url) : new URL(url)
  for (const [k, v] of Object.entries(o.query ?? {})) {
    if (v == null) continue
    if (Array.isArray(v)) for (const x of v) u.searchParams.append(k, x)
    else u.searchParams.set(k, String(v))
  }
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'Nau/1', ...o.headers }
  let body: string | undefined
  if (o.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(o.json)
  } else if (o.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(Object.entries(o.form).map(([k, v]) => [k, String(v)])).toString()
  }
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      // A redirect from a person-supplied host could lead inside the network, so those are never followed blindly
      res = await fetch(u, { method: o.method ?? (body ? 'POST' : 'GET'), headers, body, redirect: o.redirect ?? (o.untrusted ? 'error' : 'follow'), signal: AbortSignal.timeout(o.timeoutMs ?? 25_000) })
    } catch (e) {
      if (attempt === 0 && !(e instanceof DOMException && e.name === 'TimeoutError')) {
        await sleep(600)
        continue
      }
      throw new ConnectorError(tr('{0} did not answer ({1}).', u.host, e instanceof Error ? e.message : tr('network error')))
    }
    if (o.raw) return res as T
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await sleep(Math.min(8000, (Number(res.headers.get('retry-after')) || 1.5) * 1000))
      continue
    }
    const text = await res.text()
    let data: unknown = text
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const d = data as Record<string, any> | null
      const said = (d && (d.error_description || d.message || d.error?.message || d.errors?.[0]?.message || d.errors?.[0]?.detail || d.errors?.[0]?.error || (typeof d.error === 'string' ? d.error : ''))) || (typeof data === 'string' ? data.slice(0, 160) : '')
      throw new ConnectorError(res.status === 401 || res.status === 403 ? tr('{0} refused the credentials{1}.', u.host, said ? ` (${said})` : '') : tr('{0} answered {1}{2}.', u.host, res.status, said ? `: ${said}` : ''), res.status)
    }
    return data as T
  }
}

export const basic = (user: string, pass = '') => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
