import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, isCloudConfigured } from '~/lib/env'

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  if (!isCloudConfigured) throw new Error('Supabase is not configured')
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    })
  }
  return client
}

export const TABLES: Record<string, string> = {
  members: 'workspace_members',
  levels: 'stock_levels',
  orders: 'purchase_orders',
}
export const tableName = (t: string) => TABLES[t] ?? t

const toSnake = (s: string) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

export function rowToDb<T extends object>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[toSnake(k)] = v === undefined ? null : v
  return out
}

export function rowFromDb<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'workspace_id') continue
    const key = toCamel(k)
    // numeric columns arrive as strings from Postgres numeric
    out[key] = typeof v === 'string' && NUMERIC.has(k) ? Number(v) : v
  }
  return out as T
}

const NUMERIC = new Set(['cost', 'price', 'vat_rate', 'reorder_point', 'reorder_qty', 'safety_days', 'qty', 'on_hand', 'unit_cost', 'min_order_value', 'impact_eur', 'lead_time_days', 'hue'])
