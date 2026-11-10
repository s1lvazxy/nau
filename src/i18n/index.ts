import { pt } from './pt'
import { en } from './en'

/**
 * Two languages, one function. Strings stay in the code in the language they were written in
 * (English in the app, Portuguese on the website and in onboarding) and `tr()` looks up the other one.
 * A missing entry falls back to the source, so nothing ever renders blank.
 */
export type Lang = 'pt' | 'en'
export const LANGS: { value: Lang; label: string; short: string }[] = [
  { value: 'pt', label: 'Português', short: 'PT' },
  { value: 'en', label: 'English', short: 'EN' },
]
export const DEFAULT_LANG: Lang = 'pt'
export const LANG_COOKIE = 'nau-lang'

const BASE = ((import.meta.env?.BASE_URL as string | undefined) ?? '/').replace(/\/$/, '')
const isLang = (v: unknown): v is Lang => v === 'pt' || v === 'en'

/** The website's two front doors carry their language in the address: `/` is Portuguese, `/en` is English. */
export function pathLang(pathname: string): Lang | null {
  const p = (BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname).replace(/\/+$/, '') || '/'
  if (p === '/') return 'pt'
  if (p === '/en') return 'en'
  return null
}
export const homePath = (lang: Lang) => `${BASE}/${lang === 'en' ? 'en' : ''}`

const cookieLang = (cookie: string | null | undefined): Lang | null => {
  const m = cookie?.match(/(?:^|;\s*)nau-lang=(pt|en)\b/)
  return m ? (m[1] as Lang) : null
}

/** Server side: the address decides for the website's front doors, the cookie everywhere else. */
export function langOfRequest(request: Request): Lang {
  return pathLang(new URL(request.url).pathname) ?? cookieLang(request.headers.get('cookie')) ?? DEFAULT_LANG
}

let forced: Lang | null = null
/** Tests and scripts pin the language. */
export const forceLang = (lang: Lang | null) => void (forced = lang)

const stored: Lang | null = typeof document !== 'undefined' ? cookieLang(document.cookie) : null

export function currentLang(): Lang {
  if (forced) return forced
  if (typeof window === 'undefined') {
    // Set per request by the server entry (src/server.ts); outside a request there is nobody to ask
    const fromRequest = (globalThis as { __nauLang?: () => Lang | undefined }).__nauLang?.()
    return isLang(fromRequest) ? fromRequest : DEFAULT_LANG
  }
  return pathLang(window.location.pathname) ?? stored ?? DEFAULT_LANG
}

/** Whether the visitor has chosen a language yet (first visits take the language of the door they came through). */
export const hasChosenLang = () => stored !== null

export function rememberLang(lang: Lang) {
  if (typeof document === 'undefined') return
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`
}

/** Switches language. Module-level labels were read at load time, so the page loads again. */
export function setLang(lang: Lang) {
  rememberLang(lang)
  const here = pathLang(window.location.pathname)
  if (here) window.location.assign(homePath(lang) + window.location.hash)
  else window.location.reload()
}

let ptBack: Record<string, string> | null = null
let enBack: Record<string, string> | null = null
const invert = (d: Record<string, string>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [v, k]))

/**
 * Translates `source` into the current language and fills `{0}`, `{1}`… with `args`.
 * The reverse lookup lets text that was stored in one language (a playbook's name, a default category)
 * be shown in the other.
 */
export function tr(source: string, ...args: (string | number | null | undefined)[]): string {
  const lang = currentLang()
  const hit = lang === 'pt' ? (pt[source] ?? (enBack ??= invert(en))[source]) : (en[source] ?? (ptBack ??= invert(pt))[source])
  const out = hit ?? source
  return args.length ? out.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? '')) : out
}

/** Marks a string for translation without translating it yet — for constants that are read before a request exists. Pass the value to `tr()` where it is shown. */
export const msg = (source: string) => source

/** BCP 47 tag for dates and numbers in the current language. */
export const locale = () => (currentLang() === 'pt' ? 'pt-PT' : 'en-GB')
