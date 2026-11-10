import { currentLang, homePath } from '~/i18n'

/** Where the source lives. Change it if you publish a fork. */
export const REPO_URL = 'https://github.com/s1lvazxy/nau'
/** Who to talk to: there is no company address, the project lives on GitHub. */
export const AUTHOR_URL = 'https://github.com/s1lvazxy'
export const ISSUES_URL = `${REPO_URL}/issues/new`
export const SECURITY_URL = `${REPO_URL}/security/advisories/new`
export const DOCS_URL = `${REPO_URL}/blob/main/docs/self-hosting.md`

/**
 * The static website (GitHub Pages) carries the landing page only, so its calls to action
 * lead to the install chapter and the repository instead of into the app.
 */
export const LANDING_ONLY = import.meta.env.VITE_LANDING_ONLY === '1'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
/** An address inside this installation, under whatever base path it is served from. */
export const href = (path: string) => `${BASE}${path}`
/** The landing page in the reader's language. */
export const home = () => homePath(currentLang())
