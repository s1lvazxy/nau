import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { Select as BSelect } from '@base-ui/react/select'
import { Switch as BSwitch } from '@base-ui/react/switch'
import { CaretUpDownIcon, CheckIcon } from '@phosphor-icons/react'
import { cn } from '~/lib/utils'
import { tr } from '~/i18n'

export const inputClass =
  'h-8 w-full rounded-[8px] bg-raised px-2.5 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--gray-a6)] outline-none transition-shadow duration-150 placeholder:text-ink-4 hover:shadow-[inset_0_0_0_1px_var(--gray-a7)] focus:shadow-[inset_0_0_0_1px_var(--accent-9),0_0_0_3px_var(--accent-a4)] disabled:opacity-50 aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--red-9)]'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode; trailing?: ReactNode; inputSize?: 'md' | 'lg' }>(function Input({ className, leading, trailing, inputSize = 'md', ...props }, ref) {
  const size = inputSize === 'lg' ? 'h-10 text-[14px] rounded-[10px]' : ''
  // Keep one DOM shape when adornments are declared (even if empty) so focus survives re-renders
  if (leading === undefined && trailing === undefined) return <input ref={ref} className={cn(inputClass, size, className)} {...props} />
  return (
    <div className={cn('relative flex items-center', className)}>
      {leading && <span className="pointer-events-none absolute left-2.5 flex text-ink-3">{leading}</span>}
      <input ref={ref} className={cn(inputClass, size, leading && 'pl-8', trailing && 'pr-9')} {...props} />
      {trailing && <span className="absolute right-2 flex items-center text-ink-3">{trailing}</span>}
    </div>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(inputClass, 'h-auto min-h-20 py-2 leading-relaxed', className)} {...props} />
})

export function Field({ label, hint, error, children, className, htmlFor, optional }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string; optional?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
        {label}
        {optional && <span className="font-normal text-ink-4">{tr('Optional')}</span>}
      </label>
      {children}
      {error ? <p className="text-[12px] text-bad-ink" role="alert">{error}</p> : hint ? <p className="text-[12px] text-ink-3">{hint}</p> : null}
    </div>
  )
}

export interface Option<T extends string | number = string> {
  value: T
  label: string
  hint?: string
}

export function Select<T extends string | number>({ value, onChange, options, placeholder = 'Select…', className, disabled, id, 'aria-label': ariaLabel, size = 'md' }: { value: T | null | undefined; onChange: (v: T) => void; options: Option<T>[]; placeholder?: string; className?: string; disabled?: boolean; id?: string; 'aria-label'?: string; size?: 'sm' | 'md' }) {
  const current = options.find((o) => o.value === value)
  return (
    <BSelect.Root value={value ?? null} onValueChange={(v) => v != null && onChange(v as T)} disabled={disabled} items={options}>
      <BSelect.Trigger id={id} aria-label={ariaLabel} className={cn(inputClass, 'flex items-center justify-between gap-2 text-left', size === 'sm' && 'h-7 text-[12.5px]', className)}>
        <span className={cn('truncate', !current && 'text-ink-4')}>{current?.label ?? placeholder}</span>
        <BSelect.Icon className="flex text-ink-3">
          <CaretUpDownIcon size={13} />
        </BSelect.Icon>
      </BSelect.Trigger>
      <BSelect.Portal>
        <BSelect.Positioner className="z-[80] outline-none" sideOffset={6} alignItemWithTrigger={false}>
          <BSelect.Popup className="max-h-[min(var(--available-height),320px)] min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-y-auto rounded-[10px] bg-raised p-1 shadow-pop outline-none transition-[transform,opacity] duration-150 ease-[var(--ease-out)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
            <BSelect.List>
              {options.map((o) => (
                <BSelect.Item key={String(o.value)} value={o.value} className="grid cursor-default grid-cols-[14px_1fr] items-center gap-2 rounded-[7px] py-1.5 pr-3 pl-2 text-[13px] text-ink outline-none select-none data-highlighted:bg-hover">
                  <BSelect.ItemIndicator className="col-start-1 text-accent">
                    <CheckIcon size={12} weight="bold" />
                  </BSelect.ItemIndicator>
                  <BSelect.ItemText className="col-start-2 flex flex-col">
                    {o.label}
                    {o.hint && <span className="text-[11.5px] text-ink-3">{o.hint}</span>}
                  </BSelect.ItemText>
                </BSelect.Item>
              ))}
            </BSelect.List>
          </BSelect.Popup>
        </BSelect.Positioner>
      </BSelect.Portal>
    </BSelect.Root>
  )
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      {(label || description) && (
        <label htmlFor={id} className="min-w-0 cursor-default">
          {label && <span className="block text-[13px] font-medium text-ink">{label}</span>}
          {description && <span className="mt-0.5 block text-[12.5px] text-ink-3">{description}</span>}
        </label>
      )}
      <BSwitch.Root id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="relative mt-0.5 flex h-[18px] w-[30px] shrink-0 rounded-full bg-[var(--gray-a6)] p-[2px] transition-colors duration-150 data-checked:bg-accent disabled:opacity-50">
        <BSwitch.Thumb className="size-[14px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-[var(--ease-out)] data-checked:translate-x-3" />
      </BSwitch.Root>
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" className={cn('inline-flex max-w-full overflow-x-auto rounded-[9px] bg-hover p-0.5 scrollbar-none', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 font-medium whitespace-nowrap text-ink-3 transition-[background-color,color,box-shadow] duration-150 hover:text-ink',
            size === 'sm' ? 'h-6 text-[12px]' : 'h-7 text-[12.5px]',
            value === o.value && 'bg-raised text-ink shadow-card',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function NumberInput({ value, onChange, step = 1, min, className, ...rest }: { value: number | null | undefined; onChange: (v: number) => void; step?: number; min?: number; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <input
      inputMode="decimal"
      className={cn(inputClass, 'tabular text-right', className)}
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value.replace(',', '.')
        if (raw === '') return onChange(0)
        const n = Number(raw)
        if (Number.isFinite(n)) onChange(min != null ? Math.max(min, n) : n)
      }}
      onFocus={(e) => e.currentTarget.select()}
      step={step}
      {...rest}
    />
  )
}
