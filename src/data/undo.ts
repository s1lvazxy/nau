import type { Actor, Movement, Snapshot, UndoPatch, UndoSpec } from '~/lib/types'
import { stableId, uid } from '~/lib/utils'
import { TABLE_ORDER, type ChangeSet } from './changeset'

/** Tables that are the record itself: undoing never rewrites history. */
const SKIP = new Set(['events', 'actions'])

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * What it takes to take a change set back, captured against the data as it was before.
 * Rows are remembered field by field, so undoing later leaves unrelated edits alone.
 */
export function undoSpec(before: Snapshot, cs: ChangeSet): UndoSpec {
  const patches: UndoPatch[] = []
  for (const table of TABLE_ORDER) {
    if (SKIP.has(table)) continue
    const existing = new Map((before[table] as { id: string }[]).map((r) => [r.id, r as Record<string, unknown>]))
    for (const row of (cs.upserts?.[table] ?? []) as unknown as Record<string, unknown>[]) {
      const old = existing.get(row.id as string)
      if (!old) {
        patches.push({ table, id: row.id as string, prev: null })
        continue
      }
      const prev: Record<string, unknown> = {}
      for (const k of new Set([...Object.keys(old), ...Object.keys(row)])) if (!same(old[k], row[k])) prev[k] = old[k] ?? null
      if (Object.keys(prev).length) patches.push({ table, id: row.id as string, prev })
    }
    for (const id of cs.removes?.[table] ?? []) {
      const old = existing.get(id)
      if (old) patches.push({ table, id, prev: old, removed: true })
    }
  }
  const spec: UndoSpec = {
    patches,
    movements: (cs.movements ?? []).map((m) => ({ id: m.id, itemId: m.itemId, locationId: m.locationId, type: m.type, qty: m.qty, unitCost: m.unitCost ?? null, batchCode: m.batchCode ?? null, expiresOn: m.expiresOn ?? null })),
  }
  if (cs.workspace) {
    const w = before.workspace as unknown as Record<string, unknown>
    spec.workspace = Object.fromEntries(Object.keys(cs.workspace).map((k) => [k, w[k] ?? null]))
  }
  return spec
}

export const isUndoable = (spec: UndoSpec | null | undefined) => !!spec && (spec.patches.length > 0 || spec.movements.length > 0 || !!spec.workspace)

/** Builds the change set that undoes `spec` against the data as it is now. */
export function materializeUndo(current: Snapshot, spec: UndoSpec, actor: Actor): ChangeSet {
  const cs: ChangeSet = {}
  const mine = new Set(spec.movements.map((m) => m.id))
  const dropped = new Set<string>()
  for (const p of spec.patches) {
    const table = p.table as (typeof TABLE_ORDER)[number]
    const rows = current[table] as unknown as Record<string, unknown>[]
    const now = rows.find((r) => r.id === p.id)
    if (p.removed) {
      if (!now && p.prev) ((cs.upserts ||= {}) as Record<string, unknown[]>)[table] = [...(((cs.upserts as Record<string, unknown[]>)[table]) ?? []), p.prev]
      continue
    }
    if (!now) continue
    if (p.prev === null) {
      // Created by the action. An item that has since gathered its own history is archived, not erased.
      if (table === 'items' && current.movements.some((m) => m.itemId === p.id && !mine.has(m.id))) {
        ;((cs.upserts ||= {}) as Record<string, unknown[]>).items = [...(((cs.upserts as Record<string, unknown[]>).items) ?? []), { ...now, archived: true }]
      } else {
        ;((cs.removes ||= {}) as Record<string, string[]>)[table] = [...(((cs.removes as Record<string, string[]>)[table]) ?? []), p.id]
        if (table === 'items') dropped.add(p.id)
      }
      continue
    }
    ;((cs.upserts ||= {}) as Record<string, unknown[]>)[table] = [...(((cs.upserts as Record<string, unknown[]>)[table]) ?? []), { ...now, ...p.prev }]
  }
  const group = uid()
  const at = new Date().toISOString()
  const back: Movement[] = spec.movements
    .filter((m) => !dropped.has(m.itemId) && current.items.some((i) => i.id === m.itemId))
    .map((m) => ({ id: stableId('undo', m.id), itemId: m.itemId, locationId: m.locationId, type: m.type, qty: -m.qty, unitCost: m.unitCost ?? null, actor, createdAt: at, groupId: group, revertsId: m.id, note: 'Undone', batchCode: m.batchCode ?? null, expiresOn: m.expiresOn ?? null }))
  if (back.length) cs.movements = back
  if (spec.workspace) cs.workspace = spec.workspace as ChangeSet['workspace']
  return cs
}
