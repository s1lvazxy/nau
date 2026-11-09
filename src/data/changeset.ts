import { produce } from 'immer'
import type { ActivityEvent, Batch, Movement, Snapshot, TableName, Workspace } from '~/lib/types'
import { round, uid } from '~/lib/utils'

type EntityTables = Exclude<TableName, 'levels'>
type Row<T extends EntityTables> = Snapshot[T][number]

/**
 * A ChangeSet is the only way data changes in Nau.
 * It is applied optimistically in the browser and atomically in Postgres (`apply_changeset`).
 */
export interface ChangeSet {
  workspace?: Partial<Pick<Workspace, 'name' | 'nif' | 'sector' | 'region' | 'settings' | 'slug'>>
  upserts?: { [T in EntityTables]?: Row<T>[] }
  removes?: { [T in EntityTables]?: string[] }
  movements?: Movement[]
  events?: ActivityEvent[]
}

export const TABLE_ORDER: EntityTables[] = [
  'members',
  'locations',
  'categories',
  'suppliers',
  'items',
  'batches',
  'receipts',
  'orders',
  'counts',
  'proposals',
  'playbooks',
  'dashboards',
  'events',
  'actions',
  'rules',
]

export function mergeChangeSets(...sets: ChangeSet[]): ChangeSet {
  const out: ChangeSet = {}
  for (const cs of sets) {
    if (cs.workspace) out.workspace = { ...out.workspace, ...cs.workspace }
    for (const [t, rows] of Object.entries(cs.upserts ?? {})) {
      const list = ((out.upserts ||= {}) as Record<string, unknown[]>)[t] || []
      ;(out.upserts as Record<string, unknown[]>)[t] = [...list, ...(rows as unknown[])]
    }
    for (const [t, ids] of Object.entries(cs.removes ?? {})) {
      const list = ((out.removes ||= {}) as Record<string, string[]>)[t] || []
      ;(out.removes as Record<string, string[]>)[t] = [...list, ...(ids as string[])]
    }
    if (cs.movements?.length) out.movements = [...(out.movements ?? []), ...cs.movements]
    if (cs.events?.length) out.events = [...(out.events ?? []), ...cs.events]
  }
  // A row written twice keeps its last version: Postgres refuses to upsert the same id twice in one statement.
  for (const [t, rows] of Object.entries(out.upserts ?? {})) {
    const last = new Map((rows as { id: string }[]).map((r) => [r.id, r]))
    if (last.size !== (rows as unknown[]).length) (out.upserts as Record<string, unknown[]>)[t] = [...last.values()]
  }
  return out
}

export function isEmpty(cs: ChangeSet) {
  return !cs.workspace && !Object.keys(cs.upserts ?? {}).length && !Object.keys(cs.removes ?? {}).length && !cs.movements?.length && !cs.events?.length
}

/** Applies stock movements to levels and lots (FEFO on outflows). Mirrors `apply_changeset` in SQL. */
function applyMovements(draft: Snapshot, movements: Movement[]) {
  const levelIdx = new Map<string, number>()
  draft.levels.forEach((l, i) => levelIdx.set(l.itemId + ':' + l.locationId, i))
  const itemTracks = new Map(draft.items.map((i) => [i.id, i.tracksExpiry]))
  for (const m of movements) {
    const k = m.itemId + ':' + m.locationId
    const i = levelIdx.get(k)
    if (i === undefined) {
      draft.levels.push({ itemId: m.itemId, locationId: m.locationId, onHand: round(m.qty, 3) })
      levelIdx.set(k, draft.levels.length - 1)
    } else {
      draft.levels[i].onHand = round(draft.levels[i].onHand + m.qty, 3)
    }
    if (!itemTracks.get(m.itemId)) continue
    if (m.qty > 0 && m.batchCode) {
      const existing = draft.batches.find((b) => b.itemId === m.itemId && b.locationId === m.locationId && b.code === m.batchCode)
      if (existing) {
        existing.qty = round(existing.qty + m.qty, 3)
        if (m.expiresOn) existing.expiresOn = m.expiresOn
      } else if (m.expiresOn) {
        const b: Batch = { id: uid(), itemId: m.itemId, locationId: m.locationId, code: m.batchCode, expiresOn: m.expiresOn, qty: m.qty }
        draft.batches.push(b)
      }
    } else if (m.qty < 0) {
      let remaining = -m.qty
      const lots = draft.batches
        .filter((b) => b.itemId === m.itemId && b.locationId === m.locationId && b.qty > 0 && (!m.batchCode || b.code === m.batchCode))
        .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
      for (const lot of lots) {
        if (remaining <= 0) break
        const take = Math.min(lot.qty, remaining)
        lot.qty = round(lot.qty - take, 3)
        remaining = round(remaining - take, 3)
      }
    }
  }
  draft.batches = draft.batches.filter((b) => b.qty > 0.0001)
}

export function applyChangeSet(snapshot: Snapshot, cs: ChangeSet): Snapshot {
  return produce(snapshot, (draft) => {
    if (cs.workspace) Object.assign(draft.workspace, cs.workspace)
    for (const table of TABLE_ORDER) {
      const rows = cs.upserts?.[table] as { id: string }[] | undefined
      if (rows?.length) {
        const list = draft[table] as { id: string }[]
        const idx = new Map(list.map((r, i) => [r.id, i]))
        for (const row of rows) {
          const i = idx.get(row.id)
          if (i === undefined) {
            list.push(row)
            idx.set(row.id, list.length - 1)
          } else list[i] = row
        }
      }
      const ids = cs.removes?.[table]
      if (ids?.length) {
        const set = new Set(ids)
        ;(draft as unknown as Record<string, { id: string }[]>)[table] = (draft[table] as { id: string }[]).filter((r) => !set.has(r.id))
      }
    }
    // Deleting an item takes its stock and history with it (the same cascade Postgres applies).
    const gone = cs.removes?.items
    if (gone?.length) {
      const set = new Set(gone)
      draft.levels = draft.levels.filter((l) => !set.has(l.itemId))
      draft.batches = draft.batches.filter((b) => !set.has(b.itemId))
      draft.movements = draft.movements.filter((m) => !set.has(m.itemId))
    }
    if (cs.events?.length) {
      const seen = new Set(draft.events.map((e) => e.id))
      draft.events.unshift(...cs.events.filter((e) => !seen.has(e.id)))
    }
    if (cs.movements?.length) {
      // The ledger is idempotent on movement id, so a retried sync or a double undo changes nothing.
      const seen = new Set(draft.movements.map((m) => m.id))
      const fresh = cs.movements.filter((m) => !seen.has(m.id) && (seen.add(m.id), true))
      draft.movements.push(...fresh)
      applyMovements(draft as Snapshot, fresh)
    }
  })
}
