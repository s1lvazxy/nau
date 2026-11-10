import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite'

/**
 * `VITE_LANDING_ONLY=1 pnpm build` makes the static website: the landing page in both languages, as plain files.
 * GitHub Pages serves a project from https://<user>.github.io/<repo>/, so everything hangs under that path.
 */
const landingOnly = process.env.VITE_LANDING_ONLY === '1'
const base = landingOnly ? (process.env.NAU_BASE ?? '/nau/') : '/'

export default defineConfig({
  base,
  server: { port: 3100, strictPort: true },
  resolve: { tsconfigPaths: true },
  optimizeDeps: {
    include: [
      '@base-ui/react/dialog', '@base-ui/react/menu', '@base-ui/react/popover', '@base-ui/react/tooltip', '@base-ui/react/select', '@base-ui/react/switch',
      '@tanstack/react-table', '@tanstack/react-virtual', '@tanstack/react-form', '@tanstack/react-query',
      'cmdk', 'sonner', 'zustand', 'zustand/middleware', 'immer', 'idb-keyval', 'zod',
      'react-grid-layout', '@number-flow/react', 'gsap', 'gsap/ScrollTrigger', '@gsap/react',
    ],
  },
  plugins: [
    wgslVitePlugin(),
    tailwindcss(),
    tanstackStart(landingOnly ? { prerender: { enabled: true, crawlLinks: false, autoStaticPathsDiscovery: false, autoSubfolderIndex: false, failOnError: true }, pages: [{ path: '/' }, { path: '/en' }] } : {}),
    nitro({
      routeRules: {
        '/**': {
          headers: {
            'x-content-type-options': 'nosniff',
            'x-frame-options': 'DENY',
            'referrer-policy': 'strict-origin-when-cross-origin',
            'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
            'strict-transport-security': 'max-age=31536000; includeSubDomains',
            'cross-origin-opener-policy': 'same-origin',
          },
        },
        '/assets/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
        '/app/**': { headers: { 'x-robots-tag': 'noindex' } },
      },
    }),
    viteReact(),
  ],
})
