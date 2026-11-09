import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, createFileRoute, useNavigate, useRouterState, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BarcodeIcon, HouseIcon, ListIcon, ListChecksIcon, PackageIcon } from '@phosphor-icons/react'
import { Mark } from '~/components/brand/logo'
import { Sheet } from '~/components/ui/overlay'
import { SidebarContent } from '~/components/app/sidebar'
import { CommandMenu } from '~/components/app/command'
import { OperatorPanel, useOperatorEnv } from '~/components/app/operator-panel'
import { ActionsContext, type ActionsCtx } from '~/components/app/actions'
import { SnapshotContext, snapshotKey, useCanWrite, useCommit, useSession } from '~/data/store'
import { autopilotPass } from '~/agent/autopilot'
import { isEmpty } from '~/data/changeset'
import { useOperator } from '~/agent/operator'
import { useUI, resolvedDark } from '~/stores/ui'
import { setNumberLocale } from '~/lib/format'
import { cn } from '~/lib/utils'
import type { Snapshot } from '~/lib/types'

export const Route = createFileRoute('/app')({
  ssr: false,
  head: () => ({ meta: [{ title: 'Nau' }] }),
  component: AppLayout,
})

function Loading({ label = 'Loading your workspace…' }: { label?: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4">
      <Mark size={28} working className="text-ink" />
      <p className="text-[13px] text-ink-3">{label}</p>
    </div>
  )
}

function useAppTheme() {
  const { theme, accent, numberLocale } = useUI()
  useEffect(() => {
    const root = document.documentElement
    const apply = () => root.classList.toggle('dark', resolvedDark(theme))
    apply()
    root.setAttribute('data-accent', accent)
    setNumberLocale(numberLocale)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme, accent, numberLocale])
  useEffect(
    () => () => {
      // Outside the app the site is always dark
      document.documentElement.classList.add('dark')
      document.documentElement.removeAttribute('data-accent')
    },
    [],
  )
}

function AppLayout() {
  const { status, session, workspaceId, backend, init } = useSession()
  const navigate = useNavigate()
  useAppTheme()
  useEffect(() => void init(), [init])
  useEffect(() => {
    if (status === 'signedOut') void navigate({ to: '/login', replace: true })
    else if (status === 'signedIn' && !workspaceId) void navigate({ to: '/onboarding', replace: true })
  }, [status, workspaceId, navigate])

  const q = useQuery({
    queryKey: snapshotKey(session?.mode, workspaceId),
    queryFn: () => backend!.load(workspaceId!),
    enabled: !!backend && !!workspaceId && status === 'signedIn',
    staleTime: Infinity,
  })

  useEffect(() => {
    if (!backend?.subscribe || !workspaceId) return
    return backend.subscribe(workspaceId, () => void q.refetch())
  }, [backend, workspaceId, q.refetch])

  if (q.error)
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <Mark size={28} className="text-bad" />
        <p className="text-[15px] font-medium">We couldn’t open this workspace</p>
        <p className="max-w-sm text-[13px] text-ink-3">{(q.error as Error).message}</p>
        <button className="mt-2 text-[13px] text-ink underline underline-offset-2" onClick={() => void q.refetch()}>
          Try again
        </button>
      </div>
    )
  if (!q.data) return <Loading label={status === 'signedIn' ? 'Loading your workspace…' : 'Signing you in…'} />
  return (
    <SnapshotContext.Provider value={q.data}>
      <Shell snapshot={q.data} />
    </SnapshotContext.Provider>
  )
}

function Shell({ snapshot }: { snapshot: Snapshot }) {
  const commitRaw = useCommit()
  const { session } = useSession()
  const navigate = useNavigate()
  const canWrite = useCanWrite()
  const collapsed = useUI((s) => s.sidebarCollapsed)
  const [mobileNav, setMobileNav] = useState(false)
  const path = useRouterState({ select: (s) => s.location.pathname })
  const ran = useRef(false)

  const actions: ActionsCtx = useMemo(
    () => ({
      commit: async (cs, opts) => {
        if (!canWrite) {
          const { toast } = await import('sonner')
          toast.error('View-only access', { description: 'Ask an admin to give you edit rights.' })
          return
        }
        await commitRaw(cs, opts)
      },
      actor: { kind: 'user', name: session?.user.name ?? 'You' },
      navigate: (to: string) => void navigate({ to }),
      canWrite,
      demo: session?.mode === 'demo',
    }),
    [commitRaw, session, navigate, canWrite],
  )

  // Autopilot: once on open, then hourly while the app is open
  const runPilot = useCallback(
    (s: Snapshot) => {
      if (!canWrite) return
      const cs = autopilotPass(s)
      if (!isEmpty(cs) && ((cs.upserts?.proposals?.length ?? 0) > 0 || (cs.removes?.proposals?.length ?? 0) > 0 || (cs.upserts?.actions?.length ?? 0) > 0)) void commitRaw(cs)
    },
    [canWrite, commitRaw],
  )
  const latest = useRef(snapshot)
  latest.current = snapshot
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const t = setTimeout(() => runPilot(latest.current), 1200)
    const i = setInterval(() => runPilot(latest.current), 3600_000)
    return () => {
      clearTimeout(t)
      clearInterval(i)
    }
  }, [runPilot])

  useEffect(() => setMobileNav(false), [path])

  return (
    <ActionsContext.Provider value={actions}>
      <ShellInner collapsed={collapsed} mobileNav={mobileNav} setMobileNav={setMobileNav} />
    </ActionsContext.Provider>
  )
}

function ShellInner({ collapsed, mobileNav, setMobileNav }: { collapsed: boolean; mobileNav: boolean; setMobileNav: (o: boolean) => void }) {
  const env = useOperatorEnv()
  const operatorOpen = useOperator((s) => s.open)
  const path = useRouterState({ select: (s) => s.location.pathname })
  const ask = (q: string) => {
    useOperator.getState().setOpen(true)
    void useOperator.getState().send(q, env)
  }
  return (
    <div className="flex h-dvh bg-canvas">
      <aside className={cn('hidden shrink-0 transition-[width] duration-200 ease-[var(--ease-out)] md:block', collapsed ? 'w-[60px]' : 'w-[244px]')}>
        <SidebarContent collapsed={collapsed} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex h-12 shrink-0 items-center gap-2 bg-panel px-3 md:hidden">
          <button type="button" aria-label="Open menu" onClick={() => setMobileNav(true)} className="flex size-9 items-center justify-center rounded-lg text-ink">
            <ListIcon size={18} />
          </button>
          <Mark size={18} className="text-ink" />
          <div className="ml-auto">
            <button type="button" onClick={() => useOperator.getState().toggle()} className="flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-[12.5px] font-medium text-ink shadow-card">
              <Mark size={13} className="text-accent" /> Operator
            </button>
          </div>
        </div>
        <main id="main" className="relative min-h-0 flex-1 overflow-y-auto bg-panel md:my-2 md:rounded-[16px] md:shadow-panel">
          <Outlet />
          <div className="h-20 md:hidden" />
        </main>
      </div>
      <div className={cn('hidden md:block', !operatorOpen && 'md:w-2')} />
      <OperatorPanel />
      <CommandMenu onAsk={ask} />
      <Sheet open={mobileNav} onOpenChange={setMobileNav} width={300}>
        <SidebarContent onNavigate={() => setMobileNav(false)} />
      </Sheet>
      {/* Mobile tab bar */}
      <nav className="glass fixed inset-x-3 bottom-3 z-30 flex h-14 items-center justify-around rounded-[18px] bg-raised/85 shadow-pop backdrop-blur-xl md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Quick">
        {[
          { to: '/app', icon: <HouseIcon size={20} />, label: 'Home', exact: true },
          { to: '/app/items', icon: <PackageIcon size={20} />, label: 'Items' },
          { to: '/app/scan', icon: <BarcodeIcon size={20} />, label: 'Scan' },
          { to: '/app/approvals', icon: <ListChecksIcon size={20} />, label: 'Approvals' },
        ].map((t) => {
          const active = t.exact ? path === t.to : path.startsWith(t.to)
          return (
            <Link key={t.to} to={t.to} className={cn('flex flex-col items-center gap-0.5 text-[10.5px]', active ? 'text-ink' : 'text-ink-3')}>
              {t.icon}
              {t.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
