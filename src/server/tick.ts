import { runWorkspace, type WorkspaceRun } from './agent-run'
import { admin } from './db'
import { sync } from './integrations'
import { deliverWebhooks } from './webhooks-out'

const MIN = 60_000

/**
 * The heartbeat of a headless Nau. Call it every five minutes from any scheduler (cron, a platform cron job, pg_cron).
 * It syncs connections that are due, runs autopilot and standing rules for workspaces whose hour has come, and delivers webhooks.
 * Each step is bounded, so a tick always ends; whatever is left is picked up by the next one.
 */
export async function tick(now = new Date()) {
  const started = Date.now()
  const out = { synced: 0, syncErrors: [] as string[], workspaces: [] as WorkspaceRun[], webhooks: { delivered: 0, failed: 0 } }
  const touched = new Set<string>()

  const { data: due } = await admin()
    .from('integrations')
    .select('id, workspace_id, name, last_sync_at, status')
    .neq('connector', 'api')
    .in('status', ['active', 'error'])
    .or(`last_sync_at.is.null,last_sync_at.lt.${new Date(now.getTime() - 10 * MIN).toISOString()}`)
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(25)
  for (const i of due ?? []) {
    if (Date.now() - started > 40_000) break
    // A connection in error is retried once an hour, not every tick
    if (i.status === 'error' && i.last_sync_at && now.getTime() - new Date(i.last_sync_at as string).getTime() < 60 * MIN) continue
    try {
      // A first sync brings months of history in slices
      for (let n = 0; n < 4; n++) {
        const r = await sync(i.id as string)
        if (r.report.documents.sales + r.report.documents.refunds + r.report.documents.purchases > 0) touched.add(i.workspace_id as string)
        if (!r.more || Date.now() - started > 40_000) break
      }
      out.synced++
    } catch (e) {
      out.syncErrors.push(`${i.name}: ${e instanceof Error ? e.message : 'error'}`)
    }
  }

  const { data: stale } = await admin()
    .from('workspaces')
    .select('id')
    .or(`agent_ran_at.is.null,agent_ran_at.lt.${new Date(now.getTime() - 55 * MIN).toISOString()}`)
    .order('agent_ran_at', { ascending: true, nullsFirst: true })
    .limit(20)
  const queue = [...new Set([...touched, ...(stale ?? []).map((w) => w.id as string)])]
  for (const id of queue) {
    if (Date.now() - started > 50_000) break
    try {
      out.workspaces.push(await runWorkspace(id, { event: touched.has(id) ? 'sync' : undefined }))
    } catch (e) {
      out.workspaces.push({ workspace: id, autopilot: { suggestions: 0, done: 0 }, rules: [], skipped: e instanceof Error ? e.message : 'error' })
    }
  }

  out.webhooks = await deliverWebhooks()
  return { ...out, ms: Date.now() - started }
}
