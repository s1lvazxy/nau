import type { ChangeSet } from '~/data/changeset'
import type { ActionSource, Actor, AgentAction, Snapshot } from '~/lib/types'

export type Format = 'eur' | 'num' | 'pct' | 'text' | 'days' | 'qty'

export type View =
  | {
      kind: 'items'
      title: string
      rows: { id: string; name: string; sku: string; onHand: number; unit: string; status: string; cover: number; value: number; hue: number; note?: string }[]
    }
  | { kind: 'table'; title: string; columns: { key: string; label: string; format?: Format; align?: 'right' }[]; rows: Record<string, string | number | null>[] }
  | { kind: 'item'; itemId: string }
  | { kind: 'forecast'; itemId: string; days: number }
  | { kind: 'overview' }
  | { kind: 'action'; actionId: string }
  | { kind: 'link'; to: string; label: string }

/** Journal entries are what the chat shows as cards */
export type PendingAction = AgentAction

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; done?: boolean; startedAt?: number; seconds?: number }
  | { type: 'tool'; id: string; name: string; input: unknown; status: 'running' | 'done' | 'error'; summary?: string; view?: View; error?: string }

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  parts: ChatPart[]
  createdAt: string
  engine?: 'claude' | 'offline'
  error?: string
  streaming?: boolean
  finishedAt?: string
}

export interface ExecContext {
  snapshot: Snapshot
  actor: Actor
  canWrite: boolean
  dashboardId?: string | null
  /** The installation can send email itself, so a sent order is queued for delivery */
  mail?: boolean
  /** Who is asking: a person in the chat (default), the scheduled autopilot, or a standing rule */
  source?: ActionSource
}

export interface ToolExec {
  /** compact JSON for the model */
  result: unknown
  summary: string
  view?: View
  action?: AgentAction
  /** What to commit now: the work and its journal entry, or only the entry when it waits for approval */
  apply?: ChangeSet
  navigate?: string
}
