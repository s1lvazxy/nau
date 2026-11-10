import type { AgentAction, Snapshot } from '~/lib/types'
import { uid } from '~/lib/utils'
import { isEmpty, mergeChangeSets } from '~/data/changeset'
import { isUndoable, undoSpec } from '~/data/undo'
import { ingest, type IngestOptions } from '~/ingest/ingest'
import type { IngestBatch, IngestReport, Link } from '~/ingest/types'
import { connectorMeta, type ConnectorMeta } from '~/connectors/catalog'
import { IMPL } from '~/connectors'
import { ConnectorError } from '~/connectors/http'
import type { Creds, Ctx } from '~/connectors/types'
import { open, seal, token } from './crypto'
import { admin, commit, load } from './db'
import { tr } from '~/i18n'

export interface IntegrationRow {
  id: string
  workspace_id: string
  connector: string
  name: string
  status: 'active' | 'paused' | 'error'
  config: Record<string, unknown>
  cursor: Record<string, unknown>
  secrets: string | null
  hook_secret: string | null
  last_sync_at: string | null
  last_error: string | null
  last_report: IngestReport | null
  created_at: string
}

/** What the browser may see: never the secrets, and the hook address only for systems that call back. */
export function view(row: IntegrationRow, origin: string) {
  const meta = connectorMeta(row.connector)
  return {
    id: row.id,
    connector: row.connector,
    name: row.name,
    status: row.status,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    lastReport: row.last_report,
    createdAt: row.created_at,
    hookUrl: meta?.can.webhooks ? `${origin}/api/hooks/${row.id}` : null,
    hookSigned: meta?.can.webhooks ? Boolean(row.hook_secret) : null,
    canPush: !!meta?.can.pushStock,
  }
}
export type IntegrationView = ReturnType<typeof view>

const ctxFor = (creds: Creds, row: Pick<IntegrationRow, 'cursor' | 'config'>, region: Ctx['region']): Ctx => ({ creds, cursor: row.cursor ?? {}, historyDays: Number(row.config?.historyDays ?? 90), now: new Date(), region })
const say = (e: unknown) => (e instanceof ConnectorError ? e.message : e instanceof Error ? e.message.slice(0, 300) : tr('Something went wrong'))

export async function list(workspaceId: string, origin: string) {
  const { data, error } = await admin().from('integrations').select('*').eq('workspace_id', workspaceId).neq('connector', 'api').order('created_at')
  if (error) throw new Error(error.message)
  return (data as IntegrationRow[]).map((r) => view(r, origin))
}

async function row(workspaceId: string | null, id: string): Promise<IntegrationRow> {
  let q = admin().from('integrations').select('*').eq('id', id)
  if (workspaceId) q = q.eq('workspace_id', workspaceId)
  const { data } = await q.maybeSingle()
  if (!data) throw new ConnectorError(tr('That connection no longer exists.'), 404)
  return data as IntegrationRow
}

/** Tests the credentials against the vendor, then stores them sealed. Nothing is saved when the test fails. */
export async function connect(workspaceId: string, userId: string, connectorId: string, fields: Record<string, string>, origin: string) {
  const meta = connectorMeta(connectorId)
  const impl = IMPL[connectorId as ConnectorMeta['id']]
  if (!meta || !impl || meta.status !== 'beta') throw new ConnectorError(tr('That system is not available yet.'))
  const creds: Creds = {}
  for (const f of meta.fields) {
    const v = String(fields[f.key] ?? '').trim()
    if (!v && !f.optional) throw new ConnectorError(tr('{0} is missing.', f.label))
    if (v.length > 2000) throw new ConnectorError(tr('{0} is too long.', f.label))
    if (v) creds[f.key] = v
  }
  const { data: ws } = await admin().from('workspaces').select('region').eq('id', workspaceId).single()
  const tested = await impl.test(ctxFor(creds, { cursor: {}, config: {} }, (ws?.region as Ctx['region']) ?? 'continente'))
  const stored = { ...creds, ...tested.creds }
  // The account password was only needed to get a token
  if (stored.refreshToken) delete stored.password
  const hookSecret = stored.webhookSecret ?? null
  const { data, error } = await admin()
    .from('integrations')
    .insert({ workspace_id: workspaceId, connector: connectorId, name: tested.account || meta.name, secrets: seal(stored), hook_secret: hookSecret ? seal({ s: hookSecret }) : null, created_by: userId })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return view(data as IntegrationRow, origin)
}

export async function setStatus(workspaceId: string, id: string, status: 'active' | 'paused') {
  await row(workspaceId, id)
  await admin().from('integrations').update({ status, last_error: null }).eq('id', id)
}

export async function disconnect(workspaceId: string, id: string) {
  await row(workspaceId, id)
  const { error } = await admin().from('integrations').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

async function linksOf(integrationId: string): Promise<Link[]> {
  const out: Link[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin().from('integration_links').select('kind, external_ref, internal_id').eq('integration_id', integrationId).order('external_ref').range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []).map((l) => ({ kind: l.kind as Link['kind'], externalRef: l.external_ref as string, internalId: l.internal_id as string })))
    if (!data || data.length < 1000) break
  }
  return out
}

/** Applies a batch that came from outside to one workspace: ingest, journal with an undo, commit, remember the links. */
export async function applyBatch(workspaceId: string, integrationId: string, batch: IngestBatch, o: Omit<IngestOptions, 'actor' | 'links'> & { actorName: string; kind: 'sync' | 'api' }): Promise<{ report: IngestReport; snapshot: Snapshot }> {
  const snapshot = await load(workspaceId)
  const actor = { kind: 'system' as const, name: o.actorName }
  const result = ingest(snapshot, batch, { ...o, actor, links: await linksOf(integrationId) })
  if (!isEmpty(result.cs)) {
    const r = result.report
    const lines = [r.products.created && tr('{0} new items', r.products.created), r.products.updated && tr('{0} items updated', r.products.updated), r.documents.sales && `${r.documents.sales} sales`, r.documents.refunds && `${r.documents.refunds} returns`, r.documents.purchases && `${r.documents.purchases} deliveries${o.postPurchases ? '' : tr(' waiting in Receive')}`, r.stockSet && tr('{0} stock levels set', r.stockSet), r.negative && tr('{0} units sold without stock behind them', Math.round(r.negative))].filter(Boolean) as string[]
    // A whole first import is too much to carry as one undo; ordinary syncs can be taken back from the journal
    const undo = (result.cs.movements?.length ?? 0) <= 2000 ? undoSpec(snapshot, result.cs) : null
    const at = new Date().toISOString()
    const action: AgentAction = { id: uid(), kind: o.kind, risk: 'reversible', title: `${o.label}: ${lines.slice(0, 2).join(', ') || tr('updated')}`, lines, impactEur: null, cs: {}, undo: undo && isUndoable(undo) ? undo : null, status: 'applied', source: o.kind === 'api' ? 'api' : 'integration', actor, approvedBy: null, reason: tr('Facts from a system you connected'), link: '/app/integrations', createdAt: at, resolvedAt: at }
    await commit(workspaceId, mergeChangeSets(result.cs, { upserts: { actions: [action] } }))
  }
  for (let i = 0; i < result.links.length; i += 500) {
    const { error } = await admin().from('integration_links').upsert(result.links.slice(i, i + 500).map((l) => ({ integration_id: integrationId, workspace_id: workspaceId, kind: l.kind, external_ref: l.externalRef, internal_id: l.internalId })), { onConflict: 'integration_id,kind,external_ref' })
    if (error) throw new Error(error.message)
  }
  return { report: result.report, snapshot }
}

/**
 * One sync: pull what is new from the vendor (or take the batch a webhook delivered) and apply it.
 * Safe to run twice at once — ids are deterministic and documents already linked are skipped.
 */
export async function sync(id: string, opts: { workspaceId?: string; batch?: IngestBatch } = {}): Promise<{ report: IngestReport; more: boolean }> {
  const r = await row(opts.workspaceId ?? null, id)
  const meta = connectorMeta(r.connector)
  const impl = IMPL[r.connector as ConnectorMeta['id']]
  if (!meta || !impl) throw new ConnectorError(tr('That system is not available.'))
  try {
    const { data: ws } = await admin().from('workspaces').select('region').eq('id', r.workspace_id).single()
    const creds = open<Creds>(r.secrets)
    const pulled = opts.batch ? { batch: opts.batch, cursor: r.cursor, more: false, creds: undefined } : await impl.pull(ctxFor(creds, r, (ws?.region as Ctx['region']) ?? 'continente'))
    // Rotated tokens are saved before anything else: losing one would lock the connection out
    if (pulled.creds) await admin().from('integrations').update({ secrets: seal(pulled.creds) }).eq('id', id)
    const first = !r.last_sync_at
    const { report } = await applyBatch(r.workspace_id, id, pulled.batch, { source: id, label: meta.name, actorName: meta.name, kind: 'sync', setStock: first && meta.can.stock && r.config?.stockFromSource !== false, postPurchases: false })
    await admin().from('integrations').update({ cursor: pulled.cursor, last_sync_at: new Date().toISOString(), last_error: null, last_report: report, status: r.status === 'error' ? 'active' : r.status }).eq('id', id)
    return { report, more: !!pulled.more }
  } catch (e) {
    await admin().from('integrations').update({ status: 'error', last_error: say(e) }).eq('id', id)
    throw e instanceof ConnectorError ? e : new ConnectorError(say(e))
  }
}

/** Writes Nau's stock back to the shop for every item the connection knows. An outbound action: the caller decides if it may run. */
export async function pushStock(workspaceId: string, id: string) {
  const r = await row(workspaceId, id)
  const impl = IMPL[r.connector as ConnectorMeta['id']]
  if (!impl?.pushStock) throw new ConnectorError(tr('This system does not take stock from Nau.'))
  const snapshot = await load(workspaceId)
  const onHand = new Map<string, number>()
  for (const l of snapshot.levels) onHand.set(l.itemId, (onHand.get(l.itemId) ?? 0) + l.onHand)
  const levels = (await linksOf(id)).filter((l) => l.kind === 'item' && onHand.has(l.internalId)).map((l) => ({ ref: l.externalRef, qty: onHand.get(l.internalId)! }))
  const { data: ws } = await admin().from('workspaces').select('region').eq('id', workspaceId).single()
  const out = await impl.pushStock(ctxFor(open<Creds>(r.secrets), r, (ws?.region as Ctx['region']) ?? 'continente'), levels)
  return { ...out, name: r.name, total: levels.length }
}

/** The public API writes through an integration of its own, so its documents get links and can never apply twice. */
export async function apiIntegration(workspaceId: string): Promise<string> {
  const { data } = await admin().from('integrations').select('id').eq('workspace_id', workspaceId).eq('connector', 'api').maybeSingle()
  if (data) return data.id as string
  const { data: made, error } = await admin().from('integrations').insert({ workspace_id: workspaceId, connector: 'api', name: 'API' }).select('id').single()
  if (error) throw new Error(error.message)
  return made.id as string
}

export function hookSecret(r: IntegrationRow): string | null {
  return r.hook_secret ? (open<{ s: string }>(r.hook_secret).s ?? null) : null
}
export { row as integrationRow, token }
