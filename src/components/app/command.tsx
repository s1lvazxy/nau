import { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { Dialog as BDialog } from '@base-ui/react/dialog'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRightIcon, CompassIcon, MoonIcon, PackageIcon, PlusIcon, TruckIcon, UsersThreeIcon } from '@phosphor-icons/react'
import { Mark } from '~/components/brand/logo'
import { ItemSwatch, Kbd } from '~/components/ui/primitives'
import { useSnapshot } from '~/data/store'
import { useOperator } from '~/agent/operator'
import { useUI, resolvedDark } from '~/stores/ui'
import { runAutopilot } from '~/data/commands'
import { fuzzyScore } from '~/lib/utils'
import { qty as fmtQty } from '~/lib/format'
import { useActions } from './actions'
import { useNavEntries } from './sidebar'
import { tr } from '~/i18n'

const itemClass = 'flex h-10 cursor-default items-center gap-3 rounded-[9px] px-3 text-[13.5px] text-ink-2 outline-none select-none data-[selected=true]:bg-hover data-[selected=true]:text-ink'
const groupClass = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-4'

export function CommandMenu({ onAsk }: { onAsk: (q: string) => void }) {
  const { commandOpen, set, theme } = useUI()
  const navigate = useNavigate()
  const s = useSnapshot()
  const { commit, canWrite } = useActions()
  const [q, setQ] = useState('')
  const groups = useNavEntries()

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        set({ commandOpen: !useUI.getState().commandOpen })
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        useOperator.getState().toggle()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [set])

  const items = useMemo(() => {
    if (!q.trim()) return []
    return s.items
      .filter((i) => !i.archived)
      .map((i) => ({ i, sc: Math.max(fuzzyScore(q, i.name), fuzzyScore(q, i.sku), i.barcode === q ? 100 : 0) }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 7)
  }, [q, s.items])
  const onHand = (id: string) => s.levels.filter((l) => l.itemId === id).reduce((a, l) => a + l.onHand, 0)

  const go = (to: string) => {
    set({ commandOpen: false })
    setQ('')
    void navigate({ to })
  }

  return (
    <BDialog.Root open={commandOpen} onOpenChange={(o) => set({ commandOpen: o })}>
      <BDialog.Portal>
        <BDialog.Backdrop className="fixed inset-0 z-[80] bg-[rgb(10_8_6/0.25)] dark:bg-black/50" />
        <BDialog.Popup className="fixed top-[14vh] left-1/2 z-[81] w-[600px] max-w-[calc(100vw-24px)] -translate-x-1/2 overflow-hidden rounded-[16px] bg-raised shadow-pop outline-none">
          <BDialog.Title className="sr-only">{tr('Command menu')}</BDialog.Title>
          <Command label={tr('Command menu')} shouldFilter={true} loop>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Mark size={15} className="text-ink-3" />
              <Command.Input value={q} onValueChange={setQ} placeholder={tr('Search items, pages, actions — or ask Operator')} className="h-12 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-4" autoFocus />
              <Kbd>{tr('esc')}</Kbd>
            </div>
            <Command.List className="max-h-[min(60vh,440px)] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-3">{tr('Nothing found. Press Enter on “Ask Operator”.')}</Command.Empty>
              {q.trim() && (
                <Command.Group className={groupClass}>
                  <Command.Item
                    value={`ask operator ${q}`}
                    onSelect={() => {
                      set({ commandOpen: false })
                      onAsk(q)
                      setQ('')
                    }}
                    className={itemClass}
                  >
                    <Mark size={15} className="text-accent" />
                    <span className="flex-1 truncate">
                      {tr('Ask Operator:')} <span className="text-ink">“{q}”</span>
                    </span>
                    <Kbd>↵</Kbd>
                  </Command.Item>
                </Command.Group>
              )}
              {items.length > 0 && (
                <Command.Group heading={tr('Items')} className={groupClass}>
                  {items.map(({ i }) => (
                    <Command.Item key={i.id} value={`item ${i.name} ${i.sku} ${i.barcode ?? ''}`} onSelect={() => go(`/app/items/${i.id}`)} className={itemClass}>
                      <ItemSwatch name={i.name} hue={i.hue} size={22} />
                      <span className="flex-1 truncate text-ink">{i.name}</span>
                      <span className="tabular text-[12px] text-ink-3">{fmtQty(onHand(i.id), i.unit)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading={tr('Actions')} className={groupClass}>
                {canWrite && (
                  <>
                    <Command.Item value="new item add product" onSelect={() => go('/app/items?new=1')} className={itemClass}>
                      <PlusIcon size={15} /> {tr('New item')}
                    </Command.Item>
                    <Command.Item value="receive delivery entrada invoice" onSelect={() => go('/app/receive?new=1')} className={itemClass}>
                      <PackageIcon size={15} /> {tr('Receive a delivery')}
                    </Command.Item>
                    <Command.Item value="new purchase order encomenda" onSelect={() => go('/app/orders?new=1')} className={itemClass}>
                      <TruckIcon size={15} /> {tr('New purchase order')}
                    </Command.Item>
                    <Command.Item
                      value="run autopilot now"
                      onSelect={() => {
                        set({ commandOpen: false })
                        void commit(runAutopilot(s), { success: tr('Autopilot ran'), description: tr('New suggestions are in Approvals.') })
                      }}
                      className={itemClass}
                    >
                      <CompassIcon size={15} /> {tr('Run autopilot now')}
                    </Command.Item>
                  </>
                )}
                <Command.Item value="invite team member" onSelect={() => go('/app/settings?tab=team')} className={itemClass}>
                  <UsersThreeIcon size={15} /> {tr('Invite a teammate')}
                </Command.Item>
                <Command.Item
                  value="toggle theme dark light mode"
                  onSelect={() => {
                    set({ commandOpen: false, theme: resolvedDark(theme) ? 'light' : 'dark' })
                  }}
                  className={itemClass}
                >
                  <MoonIcon size={15} /> {tr('Toggle dark mode')}
                </Command.Item>
              </Command.Group>
              <Command.Group heading={tr('Go to')} className={groupClass}>
                {groups
                  .flatMap((g) => g.items)
                  .map((e) => (
                    <Command.Item key={e.key} value={`go ${e.label}`} onSelect={() => go(e.to)} className={itemClass}>
                      <span className="text-ink-3">{e.icon}</span>
                      <span className="flex-1">{e.label}</span>
                      <ArrowRightIcon size={12} className="text-ink-4" />
                    </Command.Item>
                  ))}
              </Command.Group>
            </Command.List>
          </Command>
        </BDialog.Popup>
      </BDialog.Portal>
    </BDialog.Root>
  )
}
