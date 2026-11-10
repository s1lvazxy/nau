import { useEffect } from 'react'
import { tr } from '~/i18n'

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = tr('{0} — Nau', title)
  }, [title])
}
