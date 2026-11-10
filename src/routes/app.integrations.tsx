import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowsClockwiseIcon, ArrowSquareOutIcon, CheckIcon, CopyIcon, KeyIcon, PauseIcon, PlayIcon, PlugsConnectedIcon, PlusIcon, TrashIcon, UploadSimpleIcon, WebhooksLogoIcon } from '@phosphor-icons/react'
import { accessToken } from '~/agent/operator'
import { record } from '~/agent/policy'
import { useActions } from '~/components/app/actions'
import { usePageTitle } from '~/components/app/page'
import { Button, IconButton } from '~/components/ui/button'
import { Field, Input, Segmented, Switch } from '~/components/ui/form'
import { Modal } from '~/components/ui/overlay'
import { Badge, Card, Dot, Empty, PageHeader } from '~/components/ui/primitives'
import { CONNECTORS, connectorMeta, FAMILY_LABEL, type ConnectorMeta, type Family } from '~/connectors/catalog'
import { snapshotKey, useSession, useSnapshot } from '~/data/store'
import { ingest } from '~/ingest/ingest'
import type { ExtDocument } from '~/ingest/types'
import type { IntegrationView } from '~/server/integrations'
import { relative } from '~/lib/format'
import { cn, stableId } from '~/lib/utils'
import { tr } from '~/i18n'

type Tab = 'connections' | 'developers'

export const Route = createFileRoute('/app/integrations')({
  validateSearch: (s: Record<string, unknown>): { connect?: string; tab?: Tab } => ({ ...(typeof s.connect === 'string' ? { connect: s.connect } : {}), ...(s.tab === 'developers' ? { tab: 'developers' as Tab } : {}) }),
  component: Integrations,
})

/** Calls a server route as the signed-in person. */
function useApi() {
  const { workspaceId } = useSession()
  return useCallback(
    async <T,>(path: string, body?: Record<string, unknown>): Promise<T> => {
      const token = await accessToken()
      const res = await fetch(body ? path : `${path}?workspace=${workspaceId}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify({ workspace: workspaceId, ...body }) : undefined })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((json as { error?: string }).error ?? tr('Request failed ({0})', res.status))
      return json as T
    },
    [workspaceId],
  )
}

const CAN: [keyof ConnectorMeta['can'], string][] = [
  ['catalog', tr('Catalogue')],
  ['stock', tr('Stock')],
  ['sales', tr('Sales')],
  ['purchases', tr('Deliveries')],
  ['pushStock', tr('Stock back')],
  ['webhooks', tr('Live')],
]

function Integrations() {
  usePageTitle(tr('Integrations'))
  const { connect, tab = 'connections' } = Route.useSearch()
  const navigate = useNavigate()
  const { session, workspaceId } = useSession()
  const { canWrite } = useActions()
  const api = useApi()
  const qc = useQueryClient()
  const cloud = session?.mode === 'cloud'
  const [dialog, setDialog] = useState<ConnectorMeta | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [removing, setRemoving] = useState<IntegrationView | null>(null)

  const q = useQuery({ queryKey: ['integrations', workspaceId], queryFn: () => api<{ ready: boolean; reason: 'database' | 'secret' | null; integrations: IntegrationView[] }>('/api/integrations'), enabled: cloud && !!workspaceId, refetchInterval: 60_000 })
  const ready = cloud && q.data?.ready
  const refresh = () => {
    void q.refetch()
    void qc.invalidateQueries({ queryKey: snapshotKey(session?.mode, workspaceId) })
  }

  useEffect(() => {
    const meta = connect ? connectorMeta(connect) : undefined
    if (meta?.status === 'beta') setDialog(meta)
  }, [connect])

  const act = async (i: IntegrationView, action: 'sync' | 'pause' | 'resume' | 'push') => {
    setBusy(`${i.id}:${action}`)
    try {
      const r = await api<{ sales?: number; refunds?: number; created?: number; updated?: number; total?: number; more?: boolean }>('/api/integrations', { action, id: i.id })
      if (action === 'sync') toast.success(tr('{0} is up to date', i.name), { description: [r.sales && `${r.sales} sales`, r.refunds && `${r.refunds} returns`, r.created && tr('{0} new items', r.created)].filter(Boolean).join(' · ') || tr('Nothing new since the last sync.') })
      if (action === 'push') toast.success(tr('Stock sent to {0}', i.name), { description: tr('{0} of {1} items updated.', r.updated, r.total) })
      refresh()
    } catch (e) {
      toast.error(action === 'sync' ? tr('{0} could not sync', i.name) : tr('That didn’t work'), { description: e instanceof Error ? e.message : undefined })
      void q.refetch()
    } finally {
      setBusy(null)
    }
  }

  const families = useMemo(() => (['invoicing', 'ecommerce', 'pos'] as Family[]).map((f) => ({ family: f, list: CONNECTORS.filter((c) => c.family === f) })), [])
  const connected = q.data?.integrations ?? []

  return (
    <div className="pb-14">
      <PageHeader title={tr('Integrations')} description={tr('Sales and deliveries arrive from the systems you already use. Everything enters through one door, and every sync can be undone from the journal.')}>
        <Segmented
          value={tab}
          onChange={(t: Tab) => void navigate({ to: '/app/integrations', search: t === 'developers' ? { tab: t } : {}, replace: true })}
          options={[
            { value: 'connections', label: tr('Connections{0}', connected.length ? ` · ${connected.length}` : '') },
            { value: 'developers', label: tr('API & webhooks') },
          ]}
        />
      </PageHeader>

      {tab === 'developers' ? (
        <Developers ready={!!ready} cloud={!!cloud} />
      ) : (
        <div className="mx-auto flex max-w-[1040px] flex-col gap-9 px-5 py-6 md:px-8">
          {!cloud && <LocalNotice />}
          {cloud && q.data && !q.data.ready && (
            <Card className="p-5 text-[13px] leading-relaxed text-ink-2">
              <b className="font-medium text-ink">{tr('One setting is missing on the server.')}</b> {q.data.reason === 'secret' ? tr('Set NAU_SECRET_KEY (32 random bytes, base64) so credentials can be stored encrypted, then restart.') : tr('Set SUPABASE_SERVICE_ROLE_KEY so the server can read and write on its own.')}
            </Card>
          )}
          {q.error && <Card className="p-5 text-[13px] text-bad-ink">{(q.error as Error).message}</Card>}

          {connected.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-[13px] font-medium text-ink-2">{tr('Connected')}</h2>
              {connected.map((i) => {
                const meta = connectorMeta(i.connector)
                const r = i.lastReport
                return (
                  <Card key={i.id} className="p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Dot tone={i.status === 'error' ? 'bad' : i.status === 'paused' ? 'muted' : 'ok'} pulse={busy === `${i.id}:sync`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                          <span className="truncate">{i.name}</span>
                          <Badge tone="muted">{meta?.name ?? i.connector}</Badge>
                          {i.status === 'paused' && <Badge tone="neutral">{tr('Paused')}</Badge>}
                        </div>
                        <div className={cn('mt-0.5 text-[12.5px]', i.status === 'error' ? 'text-bad-ink' : 'text-ink-3')}>
                          {i.status === 'error' ? i.lastError : i.lastSyncAt ? tr('Synced {0}{1}', relative(i.lastSyncAt), r ? ` · ${[r.documents.sales && `${r.documents.sales} sales`, r.documents.refunds && `${r.documents.refunds} returns`, r.products.created && `${r.products.created} new items`].filter(Boolean).join(' · ') || tr('nothing new')}` : '') : tr('Not synced yet — the first sync brings the catalogue and 90 days of sales.')}
                        </div>
                      </div>
                      {canWrite && (
                        <div className="flex items-center gap-1">
                          <Button size="sm" loading={busy === `${i.id}:sync`} disabled={!!busy || i.status === 'paused'} icon={<ArrowsClockwiseIcon size={13} />} onClick={() => void act(i, 'sync')}>
                            {tr('Sync now')}
                          </Button>
                          {i.canPush && (
                            <Button size="sm" variant="ghost" loading={busy === `${i.id}:push`} disabled={!!busy} icon={<UploadSimpleIcon size={13} />} onClick={() => void act(i, 'push')}>
                              {tr('Send stock')}
                            </Button>
                          )}
                          <IconButton size="sm" label={i.status === 'paused' ? tr('Resume') : tr('Pause')} disabled={!!busy} onClick={() => void act(i, i.status === 'paused' ? 'resume' : 'pause')}>
                            {i.status === 'paused' ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
                          </IconButton>
                          <IconButton size="sm" label={tr('Disconnect')} disabled={!!busy} onClick={() => setRemoving(i)}>
                            <TrashIcon size={14} />
                          </IconButton>
                        </div>
                      )}
                    </div>
                    {i.hookUrl && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12.5px] text-ink-3">
                        <span>{i.hookSigned ? tr('For instant updates, point a webhook at') : tr('Add the webhook secret to get instant updates at')}</span>
                        <CopyField value={i.hookUrl} />
                      </div>
                    )}
                    {r && r.negative > 0 && <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-3">{tr('{0} units were sold with no stock behind them in the last sync. A count will set the levels straight.', Math.round(r.negative))}</p>}
                  </Card>
                )
              })}
            </section>
          )}

          {families.map(({ family, list }) => (
            <section key={family} className="flex flex-col gap-2">
              <h2 className="text-[13px] font-medium text-ink-2">{FAMILY_LABEL[family]}</h2>
              <div className="grid gap-2 md:grid-cols-2">
                {list.map((c) => (
                  <Card key={c.id} className={cn('flex flex-col gap-3 p-4', c.status === 'planned' && 'bg-transparent shadow-[inset_0_0_0_1px_var(--gray-a4)]')}>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-ink">{c.name}</span>
                      {c.status === 'beta' ? <Badge tone="muted">{tr('Beta')}</Badge> : <Badge tone="neutral">{tr('Planned')}</Badge>}
                      {c.status === 'beta' && (
                        <Button size="sm" className="ml-auto" variant={ready ? 'secondary' : 'ghost'} disabled={!ready || !canWrite} icon={<PlusIcon size={12} />} onClick={() => setDialog(c)}>
                          {tr('Connect')}
                        </Button>
                      )}
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-ink-3">{c.status === 'beta' ? c.blurb : c.meanwhile}</p>
                    {c.status === 'beta' && (
                      <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
                        {CAN.filter(([k]) => c.can[k]).map(([k, label]) => (
                          <span key={k} className="inline-flex items-center gap-1">
                            <CheckIcon size={10} weight="bold" className="text-ink-3" /> {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          ))}
          <p className="text-[12.5px] leading-relaxed text-ink-3">
            <b className="font-medium text-ink-2">{tr('Beta')}</b> {tr('means the connector was built and tested against the vendor’s public documentation and has not yet been proven on a live account — watch the first syncs. Anything not listed can post sales to the')}
            <button type="button" className="text-ink underline underline-offset-2" onClick={() => void navigate({ to: '/app/integrations', search: { tab: 'developers' } })}>
              API
            </button> {tr('or come in as a SAF-T file.')}
          </p>
        </div>
      )}

      {dialog && <ConnectDialog meta={dialog} onClose={() => (setDialog(null), connect && void navigate({ to: '/app/integrations', search: {}, replace: true }))} onDone={refresh} />}
      <Modal
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        size="sm"
        title={tr('Disconnect {0}?', removing?.name ?? '')}
        description={tr('Nau stops reading it and forgets the credentials. Items, sales and stock that already came in stay.')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              {tr('Keep it')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const i = removing!
                setRemoving(null)
                void api('/api/integrations', { action: 'disconnect', id: i.id }).then(
                  () => (toast.success(tr('{0} disconnected', i.name)), void q.refetch()),
                  (e: Error) => toast.error(tr('Could not disconnect'), { description: e.message }),
                )
              }}
            >
              {tr('Disconnect')}
            </Button>
          </>
        }
      />
    </div>
  )
}

function ConnectDialog({ meta, onClose, onDone }: { meta: ConnectorMeta; onClose: () => void; onDone: () => void }) {
  const api = useApi()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const missing = meta.fields.some((f) => !f.optional && !fields[f.key]?.trim())
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { integration } = await api<{ integration: IntegrationView }>('/api/integrations', { action: 'connect', connector: meta.id, fields })
      toast.success(tr('{0} connected', integration.name), { description: tr('Reading the catalogue and the last 90 days of sales…') })
      onDone()
      onClose()
      // The first sync starts at once; the page shows its progress
      void api('/api/integrations', { action: 'sync', id: integration.id }).then(onDone, onDone)
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Could not connect'))
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={tr('Connect {0}', meta.name)}
      description={meta.setup}
      footer={
        <>
          {meta.docs && (
            <a href={meta.docs} target="_blank" rel="noreferrer" className="mr-auto inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink">
              {tr('{0} docs', meta.name)} <ArrowSquareOutIcon size={12} />
            </a>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tr('Cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={missing} onClick={() => void submit()}>
            {busy ? tr('Testing…') : tr('Test and connect')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault()
          if (!missing && !busy) void submit()
        }}
      >
        {meta.fields.map((f, i) => (
          <Field key={f.key} label={f.label} htmlFor={`f-${f.key}`} optional={f.optional} hint={f.help}>
            <Input id={`f-${f.key}`} type={f.type === 'password' ? 'password' : f.type === 'url' ? 'url' : 'text'} autoComplete="off" spellCheck={false} placeholder={f.placeholder} value={fields[f.key] ?? ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} autoFocus={i === 0} />
          </Field>
        ))}
        {error && (
          <p role="alert" className="rounded-[10px] bg-bad-soft px-3 py-2 text-[13px] text-bad-ink">
            {error}
          </p>
        )}
        <p className="text-[12px] leading-relaxed text-ink-3">{tr('Nau tests the credentials before saving them, stores them encrypted on the server, and never shows them again. Nothing is written to {0} unless you press “Send stock”.', meta.name)}</p>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

function CopyField({ value, secret }: { value: string; secret?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(value).then(() => (setDone(true), setTimeout(() => setDone(false), 1400)))}
      className={cn('group inline-flex max-w-full items-center gap-2 rounded-[8px] bg-hover px-2.5 py-1.5 font-mono text-[11.5px] text-ink-2 hover:text-ink', secret && 'bg-accent-soft text-accent-ink')}
      aria-label={tr('Copy {0}', secret ? tr('secret') : value)}
    >
      <span className="truncate">{value}</span>
      {done ? <CheckIcon size={12} weight="bold" className="shrink-0 text-ok" /> : <CopyIcon size={12} className="shrink-0 text-ink-3 group-hover:text-ink" />}
    </button>
  )
}

/** Local mode and the public demo keep data in the browser, so there is no server to hold a connection. The demo can still show the flow. */
function LocalNotice() {
  const s = useSnapshot()
  const { commit, canWrite, demo } = useActions()
  const simulate = () => {
    const sellers = s.items.filter((i) => !i.archived && s.levels.some((l) => l.itemId === i.id && l.onHand > 3)).slice(0, 40)
    const day = new Date().toISOString().slice(0, 10)
    const run = s.events.filter((e) => e.kind === 'sync').length
    const docs: ExtDocument[] = Array.from({ length: 9 }, (_, d) => ({
      ref: `demo-pos:${day}:${run}:${d}`,
      kind: 'sale',
      number: `FS ${day.slice(5).replace('-', '')}/${run * 9 + d + 1}`,
      date: new Date(Date.now() - (9 - d) * 17 * 60_000).toISOString(),
      location: s.locations.find((l) => l.kind === 'store')?.name ?? null,
      lines: Array.from({ length: 1 + ((d * 7 + run) % 3) }, (_, k) => {
        const it = sellers[(d * 5 + k * 11 + run * 3) % sellers.length]
        return { sku: it.sku, name: it.name, qty: 1 + ((d + k) % 3), unitPrice: it.price }
      }),
    }))
    const actor = { kind: 'system' as const, name: tr('Demo till') }
    const r = ingest(s, { documents: docs }, { source: stableId('demo-pos'), label: tr('Demo till'), actor })
    const j = record(s, { kind: 'sync', risk: 'reversible', title: tr('Demo till: {0} sales', r.report.documents.sales), lines: [tr('{0} lines applied to stock', r.report.lines.applied)], cs: r.cs, source: 'integration', link: '/app/movements' }, actor, { force: 'auto' })
    void commit(j.cs, { success: tr('{0} sales came in from the till', r.report.documents.sales), description: tr('They are in the ledger, and the sync is in the journal with Undo.') })
  }
  return (
    <Card className="flex flex-col gap-3 p-5 md:flex-row md:items-center">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-hover text-ink-2">
        <PlugsConnectedIcon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-ink">{demo ? tr('The demo keeps everything in your browser') : tr('Connections need the server database')}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">
          {demo ? tr('So there is nothing to connect to here — but you can watch what a connected till does: nine sales arrive, stock moves, and the whole sync can be undone.') : tr('In local mode your data lives in this browser, so a server cannot sync into it. Run Nau with a Supabase database to connect systems. Files work everywhere: import a spreadsheet or a SAF-T under Insights.')}
        </p>
      </div>
      {canWrite && (
        <Button variant="primary" icon={<ArrowsClockwiseIcon size={14} />} onClick={simulate}>
          {tr('Simulate a till sync')}
        </Button>
      )}
    </Card>
  )
}

interface KeyRow {
  id: string
  name: string
  prefix: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
}
interface HookRow {
  id: string
  url: string
  events: string[]
  active: boolean
  failures: number
  last_status: number | null
  last_delivery_at: string | null
}

function Developers({ ready, cloud }: { ready: boolean; cloud: boolean }) {
  const api = useApi()
  const { workspaceId, workspaces } = useSession()
  const admin = ['owner', 'admin'].includes(workspaces.find((w) => w.id === workspaceId)?.role ?? '')
  const q = useQuery({ queryKey: ['developers', workspaceId], queryFn: () => api<{ keys: KeyRow[]; webhooks: HookRow[] }>('/api/developers'), enabled: cloud && admin && !!workspaceId })
  const [name, setName] = useState('')
  const [write, setWrite] = useState(true)
  const [url, setUrl] = useState('')
  const [fresh, setFresh] = useState<{ label: string; value: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const run = async (body: Record<string, unknown>, done?: (r: { key?: string; secret?: string }) => void) => {
    setBusy(true)
    try {
      done?.(await api('/api/developers', body))
      await q.refetch()
    } catch (e) {
      toast.error(tr('That didn’t work'), { description: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }
  if (!cloud) return <div className="mx-auto max-w-[860px] px-5 py-6 md:px-8"><LocalNotice /></div>
  if (!admin) return <Empty icon={<KeyIcon size={20} />} title={tr('For owners and admins')}>{tr('API keys and webhooks give other systems access to this workspace, so only owners and admins manage them.')}</Empty>
  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-8 px-5 py-6 md:px-8">
      {fresh && (
        <Card className="flex flex-col gap-2 p-4 shadow-[0_0_0_1.5px_var(--accent-9)]">
          <p className="text-[13.5px] font-medium text-ink">{fresh.label}</p>
          <CopyField value={fresh.value} secret />
          <p className="text-[12.5px] text-ink-3">{tr('Copy it now. Nau keeps only a fingerprint of it and cannot show it again.')}</p>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[14px] font-medium text-ink">
            <KeyIcon size={15} className="text-ink-3" /> {tr('API keys')}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{tr('Any system that can make an HTTP request can post sales and deliveries to Nau and read stock back. Requests are idempotent on your own document id.')}</p>
        </div>
        <Card className="divide-y divide-line">
          {(q.data?.keys ?? []).map((k) => (
            <div key={k.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13.5px] text-ink">
                  <span className="truncate font-medium">{k.name}</span>
                  <Badge tone="muted">{k.scopes.includes('write') ? tr('Read and write') : tr('Read only')}</Badge>
                </div>
                <div className="font-mono text-[11.5px] text-ink-3">
                  {k.prefix}… <span className="font-sans">· {k.last_used_at ? tr('used {0}', relative(k.last_used_at)) : tr('never used')}</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ action: 'revoke_key', id: k.id })}>
                {tr('Revoke')}
              </Button>
            </div>
          ))}
          <form
            className="flex flex-wrap items-end gap-3 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) void run({ action: 'create_key', name, write }, (r) => (setFresh({ label: tr('API key “{0}”', name.trim()), value: r.key! }), setName('')))
            }}
          >
            <Field label={tr('New key')} htmlFor="key-name" className="min-w-[200px] flex-1">
              <Input id="key-name" placeholder={tr('What will use it, e.g. Till at Bonfim')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
            <div className="pb-1">
              <Switch checked={write} onChange={setWrite} label={tr('Can write')} />
            </div>
            <Button type="submit" variant="primary" disabled={!ready || !name.trim() || busy} icon={<PlusIcon size={12} />}>
              {tr('Create key')}
            </Button>
          </form>
        </Card>
        <pre className="overflow-x-auto rounded-[12px] bg-surface p-4 font-mono text-[11.5px] leading-relaxed text-ink-2 shadow-card">{`curl -X POST ${origin}/api/v1/documents \\
  -H "Authorization: Bearer nau_…" -H "Content-Type: application/json" \\
  -d '{"ref":"FS-2026-1418","kind":"sale","number":"FS 2026/1418","date":"2026-11-09T18:30:00Z",
       "lines":[{"sku":"AZ-500","name":"Azeite Virgem 500ml","qty":2,"unitPrice":7.9}]}'

curl ${origin}/api/v1/stock -H "Authorization: Bearer nau_…"`}</pre>
        <p className="text-[12.5px] text-ink-3">{tr('Also: GET /api/v1/items, /movements, /orders and POST /api/v1/products. The full reference is in docs/api.md in the repository.')}</p>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[14px] font-medium text-ink">
            <WebhooksLogoIcon size={15} className="text-ink-3" /> {tr('Webhooks')}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{tr('Nau posts each entry of the activity feed to your address, signed with HMAC-SHA256, at least once and in order.')}</p>
        </div>
        <Card className="divide-y divide-line">
          {(q.data?.webhooks ?? []).map((h) => (
            <div key={h.id} className="flex items-center gap-3 px-4 py-3">
              <Dot tone={!h.active ? 'muted' : h.failures ? 'warn' : 'ok'} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12px] text-ink">{h.url}</div>
                <div className="text-[12px] text-ink-3">{!h.active ? tr('Switched off after 30 failed deliveries in a row') : h.last_delivery_at ? tr('Last delivery {0} · HTTP {1}{2}', relative(h.last_delivery_at), h.last_status || tr('no answer'), h.failures ? tr(' · {0} failing', h.failures) : '') : tr('Nothing delivered yet')}</div>
              </div>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ action: 'delete_webhook', id: h.id })}>
                {tr('Remove')}
              </Button>
            </div>
          ))}
          <form
            className="flex flex-wrap items-end gap-3 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (url.trim()) void run({ action: 'create_webhook', url: url.trim() }, (r) => (setFresh({ label: tr('Webhook signing secret'), value: r.secret! }), setUrl('')))
            }}
          >
            <Field label={tr('New endpoint')} htmlFor="hook-url" className="min-w-[240px] flex-1">
              <Input id="hook-url" type="url" placeholder="https://example.pt/hooks/nau" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
            </Field>
            <Button type="submit" variant="primary" disabled={!ready || !/^https:\/\/.+\..+/.test(url.trim()) || busy} icon={<PlusIcon size={12} />}>
              {tr('Add endpoint')}
            </Button>
          </form>
        </Card>
      </section>
    </div>
  )
}
