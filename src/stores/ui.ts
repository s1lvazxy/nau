import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Accent } from '~/lib/types'

export type Theme = 'light' | 'dark' | 'system'

interface UIState {
  theme: Theme
  accent: Accent
  density: 'comfortable' | 'compact'
  sidebarCollapsed: boolean
  numberLocale: 'en-IE' | 'pt-PT'
  hiddenNav: string[]
  dashboardId: string | null
  commandOpen: boolean
  editingDashboard: boolean
  set: (patch: Partial<Omit<UIState, 'set'>>) => void
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      theme: 'dark',
      accent: 'ember',
      density: 'comfortable',
      sidebarCollapsed: false,
      numberLocale: 'en-IE',
      hiddenNav: [],
      dashboardId: null,
      commandOpen: false,
      editingDashboard: false,
      set: (patch) => set(patch),
    }),
    {
      name: 'nau:ui',
      partialize: (s) => ({ theme: s.theme, accent: s.accent, density: s.density, sidebarCollapsed: s.sidebarCollapsed, numberLocale: s.numberLocale, hiddenNav: s.hiddenNav, dashboardId: s.dashboardId }),
    },
  ),
)

export function resolvedDark(theme: Theme) {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Inline script that applies the app theme before first paint (only inside /app). */
export const themeBootstrap = `(function(){try{var p=location.pathname;if(p.indexOf('/app')!==0&&p.indexOf('/onboarding')!==0){document.documentElement.classList.add('dark');return;}var s=JSON.parse(localStorage.getItem('nau:ui')||'{}').state||{};var t=s.theme||'dark';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');if(s.accent)document.documentElement.setAttribute('data-accent',s.accent);}catch(e){}})()`
