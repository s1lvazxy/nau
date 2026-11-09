import { createFileRoute } from '@tanstack/react-router'
import { readV1, writeV1 } from '~/server/api-v1'

/** Public API v1 — see src/server/api-v1.ts and docs/api.md */
export const Route = createFileRoute('/api/v1/$')({
  server: {
    handlers: {
      GET: ({ request, params }) => readV1(request, (params._splat ?? '').replace(/\/+$/, '')),
      POST: ({ request, params }) => writeV1(request, (params._splat ?? '').replace(/\/+$/, '')),
    },
  },
})
