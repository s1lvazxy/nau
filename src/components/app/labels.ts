import type { POStatus } from '~/lib/types'
import { tr } from '~/i18n'

export const PO_STATUS: Record<POStatus, { label: string; tone: 'muted' | 'info' | 'warn' | 'ok' | 'bad' }> = {
  draft: { label: tr('Draft'), tone: 'muted' },
  sent: { label: tr('Sent'), tone: 'info' },
  partial: { label: tr('Partly received'), tone: 'warn' },
  received: { label: tr('Received'), tone: 'ok' },
  cancelled: { label: tr('Cancelled'), tone: 'bad' },
}
