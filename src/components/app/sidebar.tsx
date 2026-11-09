import type { ReactNode } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  ArrowsDownUpIcon,
  BarcodeIcon,
  CaretUpDownIcon,
  ChartBarIcon,
  CheckIcon,
  ClipboardTextIcon,
  CompassIcon,
  PlugsConnectedIcon,
  GearSixIcon,
  HouseIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  MoonIcon,
  PackageIcon,
  PlusIcon,
  SignOutIcon,
  SidebarSimpleIcon,
  SunIcon,
  TrayArrowDownIcon,
  TruckIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react'
import { AppIcon, Mark } from '~/components/brand/logo'
import { Avatar, Kbd } from '~/components/ui/primitives'
import { Menu } from '~/components/ui/overlay'
import { Tip } from '~/components/ui/overlay'
import { useSession, useSnapshot } from '~/data/store'
import { useOperator } from '~/agent/operator'
import { useUI, resolvedDark } from '~/stores/ui'
import { cn } from '~/lib/utils'

export interface NavEntry {
  key: string
  label: string
  to: string
  icon: ReactNode
  badge?: number
  exact?: boolean
}

export function useNavEntries(): { group: string; items: NavEntry[] }[] {
  const s = useSnapshot()
  const pending = s.proposals.filter((p) => p.status === 'pending').length + s.actions.filter((a) => a.status === 'pending').length
  const openCounts = s.counts.filter((c) => c.status !== 'closed').length
  const drafts = s.receipts.filter((r) => r.status === 'draft').length
  return [
    {
      group: '',
      items: [
        { key: 'home', label: 'Home', to: '/app', icon: <HouseIcon size={16} />, exact: true },
        { key: 'approvals', label: 'Approvals', to: '/app/approvals', icon: <ListChecksIcon size={16} />, badge: pending },
      ],
    },
    {
      group: 'Stock',
      items: [
        { key: 'items', label: 'Items', to: '/app/items', icon: <PackageIcon size={16} /> },
        { key: 'receive', label: 'Receive', to: '/app/receive', icon: <TrayArrowDownIcon size={16} />, badge: drafts },
        { key: 'orders', label: 'Orders', to: '/app/orders', icon: <TruckIcon size={16} /> },
        { key: 'counts', label: 'Counts', to: '/app/counts', icon: <ClipboardTextIcon size={16} />, badge: openCounts },
        { key: 'movements', label: 'Ledger', to: '/app/movements', icon: <ArrowsDownUpIcon size={16} /> },
      ],
    },
    {
      group: 'Network',
      items: [
        { key: 'suppliers', label: 'Suppliers', to: '/app/suppliers', icon: <UsersThreeIcon size={16} /> },
        { key: 'locations', label: 'Locations', to: '/app/locations', icon: <MapPinIcon size={16} /> },
        { key: 'integrations', label: 'Integrations', to: '/app/integrations', icon: <PlugsConnectedIcon size={16} /> },
      ],
    },
    {
      group: 'Intelligence',
      items: [
        { key: 'insights', label: 'Insights', to: '/app/insights', icon: <ChartBarIcon size={16} /> },
        { key: 'autopilot', label: 'Autopilot', to: '/app/autopilot', icon: <CompassIcon size={16} /> },
      ],
    },
  ]
}

function NavLink({ e, collapsed, onNavigate }: { e: NavEntry; collapsed: boolean; onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const active = e.exact ? path === e.to || path === e.to + '/' : path.startsWith(e.to)
  const link = (
    <Link
      to={e.to}
      onClick={onNavigate}
      className={cn(
        'group relative flex h-8 items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] transition-colors duration-100',
        active ? 'bg-surface font-medium text-ink shadow-card' : 'text-ink-2 hover:bg-hover hover:text-ink',
        collapsed && 'justify-center px-0',
      )}
    >
      <span className={cn('flex shrink-0', active ? 'text-ink' : 'text-ink-4 group-hover:text-ink-2')}>{e.icon}</span>
      {!collapsed && <span className="flex-1 truncate">{e.label}</span>}
      {!!e.badge && (collapsed ? <span className="absolute top-1 right-1.5 size-1.5 rounded-full bg-accent" /> : <span className="tabular min-w-5 rounded-full bg-accent-soft px-1.5 text-center text-[11px] leading-[18px] font-medium text-accent-ink">{e.badge}</span>)}
    </Link>
  )
  return collapsed ? (
    <Tip content={e.label} side="right">
      {link}
    </Tip>
  ) : (
    link
  )
}

export function SidebarContent({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const s = useSnapshot()
  const navigate = useNavigate()
  const { session, workspaces, workspaceId, setWorkspace, signOut } = useSession()
  const ui = useUI()
  const groups = useNavEntries()
  const ws = workspaces.find((w) => w.id === workspaceId)
  const dark = resolvedDark(ui.theme)
  const demo = session?.mode === 'demo'
  const active = s.items.filter((i) => !i.archived).length
  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex items-center gap-1 px-2 pt-2.5', collapsed && 'flex-col')}>
        <Menu
          align="start"
          triggerClassName={cn('flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-1.5 text-left hover:bg-hover', collapsed && 'flex-none justify-center')}
          trigger={
            <>
              <AppIcon size={28} />
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px] font-medium tracking-[-0.01em] text-ink">{s.workspace.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-3">{demo ? 'Demo workspace' : `${s.locations.length} location${s.locations.length === 1 ? '' : 's'} · ${active} item${active === 1 ? '' : 's'}`}</span>
                  </span>
                  <CaretUpDownIcon size={12} className="shrink-0 text-ink-4" />
                </>
              )}
            </>
          }
          items={[
            ...workspaces.map((w) => ({ label: w.name, icon: w.id === workspaceId ? <CheckIcon size={13} /> : <span className="w-[13px]" />, hint: w.role, onSelect: () => setWorkspace(w.id) })),
            { separator: true, label: '' },
            ...(demo ? [] : [{ label: 'New workspace', icon: <PlusIcon size={14} />, onSelect: () => void navigate({ to: '/onboarding' }) }]),
            { label: 'Workspace settings', icon: <GearSixIcon size={14} />, onSelect: () => void navigate({ to: '/app/settings' }) },
          ]}
        />
        <Tip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
          <button type="button" aria-label="Toggle sidebar" onClick={() => ui.set({ sidebarCollapsed: !ui.sidebarCollapsed })} className="hidden size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink md:flex">
            <SidebarSimpleIcon size={16} />
          </button>
        </Tip>
      </div>

      <div className="mt-2 flex flex-col gap-1 px-2">
        <button type="button" onClick={() => ui.set({ commandOpen: true })} className={cn('flex h-9 items-center gap-2.5 rounded-[10px] bg-panel px-2.5 text-[13px] text-ink-3 shadow-panel hover:text-ink-2', collapsed && 'justify-center px-0')} aria-label="Search">
          <MagnifyingGlassIcon size={15} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search</span>
              <Kbd>⌘K</Kbd>
            </>
          )}
        </button>
        <button type="button" onClick={() => useOperator.getState().toggle()} className={cn('flex h-8 items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] text-ink-2 hover:bg-hover hover:text-ink', collapsed && 'justify-center px-0')} aria-label="Operator">
          <Mark size={15} className="text-accent" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Operator</span>
              <Kbd>⌘J</Kbd>
            </>
          )}
        </button>
      </div>

      <nav className="mt-3 flex flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3" aria-label="App">
        {groups.map((g) => (
          <div key={g.group || 'main'} className="flex flex-col gap-0.5">
            {g.group && !collapsed && <div className="px-2.5 pb-1.5 text-[11.5px] text-ink-4">{g.group}</div>}
            {g.items
              .filter((e) => !ui.hiddenNav.includes(e.key))
              .map((e) => (
                <NavLink key={e.key} e={e} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
          </div>
        ))}
        <div className="flex flex-col gap-0.5">
          <NavLink e={{ key: 'scan', label: 'Scanner', to: '/app/scan', icon: <BarcodeIcon size={16} /> }} collapsed={collapsed} onNavigate={onNavigate} />
          <NavLink e={{ key: 'settings', label: 'Settings', to: '/app/settings', icon: <GearSixIcon size={16} /> }} collapsed={collapsed} onNavigate={onNavigate} />
        </div>
      </nav>

      {!collapsed && demo && (
        <div className="mx-2 mb-2 rounded-[14px] bg-surface p-3.5 shadow-card">
          <>
              <span className="mb-3 flex size-8 items-center justify-center rounded-[9px] bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--gray-a4)]">
                <Mark size={15} />
              </span>
              <p className="text-[13px] font-medium text-ink">You’re in the demo</p>
              <p className="mt-0.5 text-[12px] leading-snug text-ink-3">Change anything — it stays in this browser.</p>
              <Link to="/signup" className="press mt-3 flex h-8 items-center justify-center rounded-[9px] bg-ink text-[12.5px] font-medium text-inverse">
                Create your workspace
              </Link>
          </>
        </div>
      )}

      <div className="p-2 pt-0">
        <Menu
          align="start"
          triggerClassName={cn('flex h-10 w-full items-center gap-2.5 rounded-[9px] px-1.5 text-left hover:bg-hover', collapsed && 'justify-center')}
          trigger={
            <>
              <Avatar name={session?.user.name ?? 'You'} hue={session?.user.hue} size={26} />
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{session?.user.name}</span>
                  <span className="block truncate text-[11px] text-ink-3">{ws?.role ? ws.role[0].toUpperCase() + ws.role.slice(1) : ''}</span>
                </span>
              )}
            </>
          }
          items={[
            { label: dark ? 'Light mode' : 'Dark mode', icon: dark ? <SunIcon size={14} /> : <MoonIcon size={14} />, onSelect: () => ui.set({ theme: dark ? 'light' : 'dark' }) },
            { label: 'Preferences', icon: <GearSixIcon size={14} />, onSelect: () => void navigate({ to: '/app/settings', search: { tab: 'appearance' } }) },
            { label: 'Back to website', icon: <Mark size={13} />, onSelect: () => void navigate({ to: '/' }) },
            { separator: true, label: '' },
            { label: demo ? 'Leave demo' : 'Sign out', icon: <SignOutIcon size={14} />, onSelect: () => void signOut().then(() => navigate({ to: demo ? '/' : '/login' })) },
          ]}
        />
      </div>
    </div>
  )
}
