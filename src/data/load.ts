import type { SupabaseClient } from '@supabase/supabase-js'
import type { Snapshot, Workspace } from '~/lib/types'
import { addDays } from '~/lib/format'
import { rowFromDb, tableName } from './supabase'

type Res = { data: unknown[] | null; error: { message: string; code?: string } | null }

/** PostgREST caps responses (1000 rows by default) — page through large tables. */
async function fetchAll(page: (from: number, to: number) => PromiseLike<Res>): Promise<Res> {
  const size = 1000
  const rows: unknown[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if (!data || data.length < size) break
  }
  return { data: rows, error: null }
}

/** One workspace as a snapshot. The browser calls it under row-level security, the server with the service role. */
export async function loadSnapshot(sb: SupabaseClient, workspaceId: string): Promise<Snapshot> {
  const since = addDays(new Date(), -120).toISOString()
  const q = (t: string) => sb.from(tableName(t)).select('*').eq('workspace_id', workspaceId)
  const all = (t: string, order: string) => fetchAll((from, to) => q(t).order(order).order('id').range(from, to))
  const [ws, members, locations, categories, suppliers, items, levels, batches, movements, receipts, orders, counts, proposals, playbooks, dashboards, events, actions, rules] = await Promise.all([
    sb.from('workspaces').select('*').eq('id', workspaceId).single(),
    q('members'),
    q('locations'),
    all('categories', 'name'),
    all('suppliers', 'name'),
    all('items', 'name'),
    fetchAll((from, to) => q('levels').order('item_id').order('location_id').range(from, to)),
    all('batches', 'expires_on'),
    fetchAll((from, to) => q('movements').gte('created_at', since).order('created_at').order('id').range(from, to)),
    q('receipts').order('created_at', { ascending: false }).limit(200),
    q('orders').order('created_at', { ascending: false }).limit(300),
    q('counts').order('created_at', { ascending: false }).limit(100),
    q('proposals').order('created_at', { ascending: false }).limit(300),
    q('playbooks'),
    q('dashboards').order('position'),
    q('events').order('created_at', { ascending: false }).limit(200),
    q('actions').order('created_at', { ascending: false }).limit(300),
    q('rules').order('created_at'),
  ])
  for (const r of [ws, members, locations, categories, suppliers, items, levels, batches, movements, receipts, orders, counts, proposals, playbooks, dashboards, events, actions, rules]) if (r.error) throw new Error(r.error.message)
  const map = <T,>(rows: unknown[] | null) => (rows ?? []).map((r) => rowFromDb<T>(r as Record<string, unknown>))
  return {
    workspace: rowFromDb<Workspace>(ws.data as Record<string, unknown>),
    members: map(members.data),
    locations: map(locations.data),
    categories: map(categories.data),
    suppliers: map(suppliers.data),
    items: map(items.data),
    levels: map(levels.data),
    batches: map(batches.data),
    movements: map(movements.data),
    receipts: map(receipts.data),
    orders: map(orders.data),
    counts: map(counts.data),
    proposals: map(proposals.data),
    playbooks: map(playbooks.data),
    dashboards: map(dashboards.data),
    events: map(events.data),
    actions: map(actions.data),
    rules: map(rules.data),
  }
}
