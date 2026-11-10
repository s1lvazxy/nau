/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import appCss from '~/styles/app.css?url'
import { themeBootstrap } from '~/stores/ui'
import { TooltipProvider } from '~/components/ui/overlay'
import { currentLang, tr } from '~/i18n'
import { LANDING_ONLY, href } from '~/lib/site'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => {
    const title = tr('Nau — Inventory that runs itself')
    const description = tr('Stock, deliveries and reorders for Portuguese businesses, with an AI operator that does the work and asks before it spends a cent. Built for NIF, IVA and the AT.')
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { title },
        { name: 'description', content: description },
        { name: 'theme-color', content: '#0a0a0a' },
        { property: 'og:type', content: 'website' },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:image', content: href('/og.png') },
        { property: 'og:locale', content: currentLang() === 'pt' ? 'pt_PT' : 'en_GB' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:image', content: href('/og.png') },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        { rel: 'icon', href: href('/favicon.svg'), type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: href('/apple-touch-icon.png') },
        // The web app manifest describes the installable app, which the static landing page is not
        ...(LANDING_ONLY ? [] : [{ rel: 'manifest', href: href('/manifest.webmanifest') }]),
      ],
      scripts: [{ children: themeBootstrap }],
    }
  },
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang={currentLang()} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  return (
    <TooltipProvider delay={400} closeDelay={80}>
      <Outlet />
      <Toaster position="bottom-right" offset={16} gap={8} toastOptions={{ duration: 4500 }} />
    </TooltipProvider>
  )
}
