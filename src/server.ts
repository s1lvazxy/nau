import { AsyncLocalStorage } from 'node:async_hooks'
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { langOfRequest, type Lang } from '~/i18n'

/**
 * Every request runs inside its own language: `tr()` on the server asks this store,
 * so two people reading the same page in different languages never cross.
 */
const requestLang = new AsyncLocalStorage<Lang>()
;(globalThis as { __nauLang?: () => Lang | undefined }).__nauLang = () => requestLang.getStore()

export default createServerEntry({
  fetch(request, opts) {
    return requestLang.run(langOfRequest(request), () => handler.fetch(request, opts))
  },
})
