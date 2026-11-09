import type { POStatus } from '~/lib/types'

export const PO_STATUS: Record<POStatus, { label: string; tone: 'muted' | 'info' | 'warn' | 'ok' | 'bad' }> = {
  draft: { label: 'Draft', tone: 'muted' },
  sent: { label: 'Sent', tone: 'info' },
  partial: { label: 'Partly received', tone: 'warn' },
  received: { label: 'Received', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
}
