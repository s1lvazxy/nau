import { useRef, type ReactNode } from 'react'
import { Dialog as BDialog } from '@base-ui/react/dialog'
import { Menu as BMenu } from '@base-ui/react/menu'
import { Popover as BPopover } from '@base-ui/react/popover'
import { Tooltip as BTooltip } from '@base-ui/react/tooltip'
import { XIcon } from '@phosphor-icons/react'
import { cn } from '~/lib/utils'
import { tr } from '~/i18n'

/* ───────────── Modal dialog (centered; scale from 0.97, never from 0) ───────────── */

/** Prefer a field the content already focused (autoFocus); otherwise focus the body, never the close button. */
function focusTarget(body: React.RefObject<HTMLDivElement | null>) {
  return () => {
    const active = document.activeElement as HTMLElement | null
    if (active && body.current?.contains(active)) return active
    return body.current
  }
}

export function Modal({ open, onOpenChange, title, description, children, footer, className, size = 'md' }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const body = useRef<HTMLDivElement>(null)
  const w = size === 'sm' ? 'w-[400px]' : size === 'lg' ? 'w-[720px]' : size === 'xl' ? 'w-[960px]' : 'w-[520px]'
  return (
    <BDialog.Root open={open} onOpenChange={onOpenChange}>
      <BDialog.Portal>
        <BDialog.Backdrop className="fixed inset-0 z-[60] bg-[rgb(10_8_6/0.28)] backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/55" />
        <BDialog.Popup
          initialFocus={focusTarget(body)}
          className={cn(
            'fixed top-[12vh] left-1/2 z-[61] flex max-h-[80vh] max-w-[calc(100vw-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-raised shadow-pop outline-none transition-[transform,opacity] duration-200 ease-[var(--ease-out)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0',
            w,
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
            <div>
              <BDialog.Title className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</BDialog.Title>
              {description && <BDialog.Description className="mt-0.5 text-[13px] text-ink-3">{description}</BDialog.Description>}
            </div>
            <BDialog.Close aria-label={tr('Close')} className="touch-target -mr-1.5 flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
              <XIcon size={14} />
            </BDialog.Close>
          </div>
          <div ref={body} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 outline-none">
            {children}
          </div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3">{footer}</div>}
        </BDialog.Popup>
      </BDialog.Portal>
    </BDialog.Root>
  )
}

/* ───────────── Side sheet (slides in from the right, exits the same way) ───────────── */

export function Sheet({ open, onOpenChange, title, description, children, footer, width = 480, modal = true }: { open: boolean; onOpenChange: (o: boolean) => void; title?: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; modal?: boolean }) {
  const body = useRef<HTMLDivElement>(null)
  return (
    <BDialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <BDialog.Portal>
        {modal && <BDialog.Backdrop className="fixed inset-0 z-[60] bg-[rgb(10_8_6/0.22)] transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/50" />}
        <BDialog.Popup
          initialFocus={focusTarget(body)}
          className="fixed inset-y-2 right-2 z-[61] flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl bg-raised shadow-pop outline-none transition-transform duration-[380ms] ease-[var(--ease-drawer)] data-ending-style:translate-x-[calc(100%+16px)] data-starting-style:translate-x-[calc(100%+16px)] motion-reduce:transition-opacity motion-reduce:data-ending-style:translate-x-0 motion-reduce:data-ending-style:opacity-0 motion-reduce:data-starting-style:translate-x-0 motion-reduce:data-starting-style:opacity-0"
          style={{ width }}
        >
          {title && (
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
              <div className="min-w-0">
                <BDialog.Title className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</BDialog.Title>
                {description && <BDialog.Description className="mt-0.5 text-[12.5px] text-ink-3">{description}</BDialog.Description>}
              </div>
              <BDialog.Close aria-label={tr('Close')} className="touch-target -mr-1.5 flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink">
                <XIcon size={14} />
              </BDialog.Close>
            </div>
          )}
          <div ref={body} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
            {children}
          </div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </BDialog.Popup>
      </BDialog.Portal>
    </BDialog.Root>
  )
}

/* ───────────── Menu (origin-aware) ───────────── */

export interface MenuItem {
  label: ReactNode
  icon?: ReactNode
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  hint?: ReactNode
  separator?: boolean
}

export function Menu({ trigger, items, align = 'end', className, triggerClassName, header }: { trigger: ReactNode; items: MenuItem[]; align?: 'start' | 'center' | 'end'; className?: string; triggerClassName?: string; header?: ReactNode }) {
  return (
    <BMenu.Root>
      <BMenu.Trigger className={triggerClassName}>{trigger}</BMenu.Trigger>
      <BMenu.Portal>
        <BMenu.Positioner className="z-[70] outline-none" sideOffset={6} align={align}>
          <BMenu.Popup className={cn('min-w-[200px] origin-[var(--transform-origin)] rounded-[12px] bg-raised p-1 shadow-pop outline-none transition-[transform,opacity] duration-150 ease-[var(--ease-out)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0', className)}>
            {header}
            {items.map((it, i) =>
              it.separator ? (
                <BMenu.Separator key={i} className="mx-1 my-1 h-px bg-line" />
              ) : (
                <BMenu.Item
                  key={i}
                  disabled={it.disabled}
                  onClick={it.onSelect}
                  className={cn('flex h-8 cursor-default items-center gap-2 rounded-[8px] px-2 text-[13px] text-ink outline-none select-none data-disabled:opacity-40 data-highlighted:bg-hover', it.danger && 'text-bad-ink')}
                >
                  {it.icon && <span className="flex text-ink-3">{it.icon}</span>}
                  <span className="flex-1">{it.label}</span>
                  {it.hint && <span className="text-[11.5px] text-ink-4">{it.hint}</span>}
                </BMenu.Item>
              ),
            )}
          </BMenu.Popup>
        </BMenu.Positioner>
      </BMenu.Portal>
    </BMenu.Root>
  )
}

/* ───────────── Popover ───────────── */

export function Popover({ trigger, children, className, align = 'center', side = 'bottom', open, onOpenChange, triggerClassName }: { trigger: ReactNode; children: ReactNode; className?: string; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'left' | 'right'; open?: boolean; onOpenChange?: (o: boolean) => void; triggerClassName?: string }) {
  return (
    <BPopover.Root open={open} onOpenChange={onOpenChange}>
      <BPopover.Trigger className={triggerClassName}>{trigger}</BPopover.Trigger>
      <BPopover.Portal>
        <BPopover.Positioner className="z-[70]" sideOffset={8} align={align} side={side}>
          <BPopover.Popup className={cn('origin-[var(--transform-origin)] rounded-[12px] bg-raised p-3 shadow-pop outline-none transition-[transform,opacity] duration-150 ease-[var(--ease-out)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0', className)}>{children}</BPopover.Popup>
        </BPopover.Positioner>
      </BPopover.Portal>
    </BPopover.Root>
  )
}

/* ───────────── Tooltip (instant after the first one) ───────────── */

export const TooltipProvider = BTooltip.Provider

export function Tip({ content, children, side = 'top', className }: { content: ReactNode; children: React.ReactElement; side?: 'top' | 'bottom' | 'left' | 'right'; className?: string }) {
  return (
    <BTooltip.Root>
      <BTooltip.Trigger render={children} />
      <BTooltip.Portal>
        <BTooltip.Positioner sideOffset={6} side={side} className="z-[90]">
          <BTooltip.Popup className={cn('origin-[var(--transform-origin)] rounded-[7px] bg-[var(--gray-12)] px-2 py-1 text-[12px] font-medium text-[var(--gray-1)] shadow-pop transition-[transform,opacity] duration-125 ease-[var(--ease-out)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-[0.97] data-starting-style:opacity-0', className)}>{content}</BTooltip.Popup>
        </BTooltip.Positioner>
      </BTooltip.Portal>
    </BTooltip.Root>
  )
}
