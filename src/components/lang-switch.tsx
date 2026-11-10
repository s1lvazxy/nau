import { LANGS, currentLang, homePath, pathLang, rememberLang, setLang } from '~/i18n'
import { cn } from '~/lib/utils'

/** PT · EN. On the website's front doors it is a plain link to the other door; elsewhere it reloads in the other language. */
export function LangSwitch({ className }: { className?: string }) {
  const lang = currentLang()
  return (
    <div role="group" aria-label="Língua · Language" className={cn('flex items-center text-[12.5px] font-medium', className)}>
      {LANGS.map((l, i) => (
        <span key={l.value} className="flex items-center">
          {i > 0 && <span aria-hidden className="px-0.5 text-ink-4">·</span>}
          {l.value === lang ? (
            <span aria-current="true" className="px-1 text-ink">
              {l.short}
            </span>
          ) : (
            <a
              href={homePath(l.value)}
              lang={l.value}
              hrefLang={l.value}
              aria-label={l.label}
              onClick={(e) => {
                if (pathLang(window.location.pathname)) return void rememberLang(l.value)
                e.preventDefault()
                setLang(l.value)
              }}
              className="rounded px-1 text-ink-3 transition-colors hover:text-ink"
            >
              {l.short}
            </a>
          )}
        </span>
      ))}
    </div>
  )
}
