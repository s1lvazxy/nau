import type { ChangeSet } from './changeset'

const TABLES: Record<string, string> = { members: 'workspace_members', levels: 'stock_levels', orders: 'purchase_orders' }
const toSnake = (s: string) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())

function rowToDb(row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[toSnake(k)] = v === undefined ? null : v
  return out
}

/** A change set in the shape `apply_changeset` reads: table and column names as Postgres knows them. */
export function changeSetToDb(cs: ChangeSet) {
  const out: Record<string, unknown> = {}
  if (cs.workspace) out.workspace = rowToDb(cs.workspace)
  if (cs.upserts) {
    const u: Record<string, unknown[]> = {}
    for (const [t, rows] of Object.entries(cs.upserts)) u[TABLES[t] ?? t] = (rows as object[]).map(rowToDb)
    out.upserts = u
  }
  if (cs.removes) {
    const r: Record<string, string[]> = {}
    for (const [t, ids] of Object.entries(cs.removes)) r[TABLES[t] ?? t] = ids as string[]
    out.removes = r
  }
  if (cs.movements) out.movements = cs.movements.map(rowToDb)
  if (cs.events) out.events = cs.events.map(rowToDb)
  return out
}
