import type { ChangeSet } from '~/data/changeset'

export type ID = string

export type Role = 'owner' | 'admin' | 'member' | 'viewer'
export type Region = 'continente' | 'madeira' | 'acores'
export type Unit = 'un' | 'kg' | 'L' | 'cx' | 'm'
export type Accent = 'ember' | 'atlantic' | 'lilac' | 'moss'
export type Autonomy = 'suggest' | 'draft' | 'auto'

/** What an action touches. Reversible work can be undone from the journal; money and outbound leave the building. */
export type Risk = 'reversible' | 'money' | 'outbound'

/** How far Operator may go on its own. Money and outbound actions also respect the two limits. */
export interface Policy {
  reversible: 'auto' | 'ask'
  money: 'auto' | 'ask'
  outbound: 'auto' | 'ask'
  /** EUR per action */
  perActionLimit: number
  /** EUR per day, summed over what Operator already did today */
  dailyLimit: number
}

export interface AutonomySettings {
  reorder: Autonomy
  transfer: Autonomy
  adjustment: Autonomy
  markdown: Autonomy
  /** Auto-approve limit in EUR for actions set to `auto` */
  autoLimit: number
}

export interface Workspace {
  id: ID
  name: string
  slug: string
  nif?: string | null
  sector: Sector
  region: Region
  currency: 'EUR'
  timezone: string
  createdAt: string
  settings: {
    /** Legacy per-kind switches; `policy` supersedes them */
    autonomy: AutonomySettings
    policy?: Policy
    briefTime: string
    reviewDays: number
    deadStockDays: number
    expiryWarnDays: number
  }
}

export type Sector = 'grocery' | 'cafe' | 'retail' | 'pharmacy' | 'hardware' | 'ecommerce' | 'other'

export interface Member {
  id: ID
  userId?: ID | null
  name: string
  email: string
  role: Role
  status: 'active' | 'invited'
  hue: number
}

export interface Location {
  id: ID
  name: string
  code: string
  kind: 'warehouse' | 'store' | 'van'
  address?: string | null
  isDefault?: boolean
}

export interface Category {
  id: ID
  name: string
  hue: number
  /** AT inventory category: M mercadorias, P matérias-primas, A acabados, S subprodutos, T em curso */
  atCategory: 'M' | 'P' | 'A' | 'S' | 'T'
}

export interface Supplier {
  id: ID
  name: string
  nif?: string | null
  email?: string | null
  phone?: string | null
  contact?: string | null
  leadTimeDays: number
  minOrderValue: number
  paymentTerms?: string | null
  notes?: string | null
  orderDays?: number[] | null
}

export interface Item {
  id: ID
  sku: string
  name: string
  barcode?: string | null
  categoryId?: ID | null
  unit: Unit
  cost: number
  price: number
  vatRate: number
  /** null = Nau computes it from demand + lead time */
  reorderPoint?: number | null
  reorderQty?: number | null
  safetyDays: number
  supplierId?: ID | null
  tracksExpiry: boolean
  archived?: boolean
  tags: string[]
  createdAt: string
  hue: number
}

export interface StockLevel {
  itemId: ID
  locationId: ID
  onHand: number
}

export interface Batch {
  id: ID
  itemId: ID
  locationId: ID
  code: string
  expiresOn: string
  qty: number
}

export type MovementType = 'receipt' | 'sale' | 'adjustment' | 'transfer' | 'count' | 'waste' | 'return'

export interface Actor {
  kind: 'user' | 'agent' | 'system'
  name: string
}

export interface Movement {
  id: ID
  itemId: ID
  locationId: ID
  type: MovementType
  /** Signed quantity: + in, − out */
  qty: number
  unitCost?: number | null
  ref?: string | null
  note?: string | null
  actor: Actor
  createdAt: string
  groupId?: ID | null
  revertsId?: ID | null
  batchCode?: string | null
  expiresOn?: string | null
}

export interface ReceiptLine {
  id: ID
  itemId: ID | null
  description: string
  qty: number
  unitCost: number
  lot?: string | null
  expiresOn?: string | null
  confidence?: number
  previousCost?: number | null
}

export interface Receipt {
  id: ID
  number: string
  supplierId: ID | null
  locationId: ID
  status: 'draft' | 'posted'
  docRef?: string | null
  docDate: string
  lines: ReceiptLine[]
  source: 'manual' | 'scan' | 'agent' | 'po' | 'import'
  poId?: ID | null
  createdAt: string
  postedAt?: string | null
  note?: string | null
}

export interface POLine {
  itemId: ID
  qty: number
  unitCost: number
  received: number
}

export type POStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled'

export interface PurchaseOrder {
  id: ID
  number: string
  supplierId: ID
  locationId: ID
  status: POStatus
  lines: POLine[]
  expectedOn?: string | null
  createdBy: 'user' | 'agent'
  note?: string | null
  createdAt: string
  sentAt?: string | null
}

export interface CountLine {
  itemId: ID
  expected: number
  counted: number | null
}

export interface Count {
  id: ID
  name: string
  locationId: ID
  status: 'open' | 'review' | 'closed'
  lines: CountLine[]
  createdAt: string
  closedAt?: string | null
  blind: boolean
}

export type ProposalKind = 'reorder' | 'transfer' | 'markdown' | 'count' | 'deadstock' | 'price'

export interface Proposal {
  id: ID
  kind: ProposalKind
  title: string
  summary: string
  rationale: string[]
  impactEur?: number | null
  payload: Record<string, unknown>
  status: 'pending' | 'approved' | 'dismissed'
  createdAt: string
  resolvedAt?: string | null
  source: 'autopilot' | 'operator'
  fingerprint: string
}

export interface Playbook {
  id: ID
  key: 'reorder' | 'rebalance' | 'expiry' | 'deadstock' | 'cyclecount' | 'pricewatch' | 'brief'
  name: string
  description: string
  cadence: 'hourly' | 'daily' | 'weekly'
  enabled: boolean
  lastRunAt?: string | null
}

export type WidgetType =
  | 'kpi'
  | 'health'
  | 'lowStock'
  | 'approvals'
  | 'salesTrend'
  | 'topMovers'
  | 'categoryMix'
  | 'expiry'
  | 'activity'
  | 'locations'
  | 'incoming'
  | 'note'
  | 'brief'
  | 'quickActions'
  | 'itemForecast'
  | 'deadStock'

export interface WidgetLayout {
  x: number
  y: number
  w: number
  h: number
}

export interface Widget {
  id: ID
  type: WidgetType
  title?: string
  config: Record<string, unknown>
  layout: WidgetLayout
}

export interface Dashboard {
  id: ID
  name: string
  widgets: Widget[]
  ownerId?: ID | null
  position: number
}

/** One field-level change to restore on undo. `prev: null` means the row was created by the action. */
export interface UndoPatch {
  table: string
  id: ID
  prev: Record<string, unknown> | null
  /** The row was deleted by the action; `prev` holds it whole */
  removed?: boolean
}

export interface UndoSpec {
  patches: UndoPatch[]
  movements: Pick<Movement, 'id' | 'itemId' | 'locationId' | 'type' | 'qty' | 'unitCost' | 'batchCode' | 'expiresOn'>[]
  workspace?: Record<string, unknown>
}

export type ActionSource = 'operator' | 'autopilot' | 'integration' | 'import' | 'api' | 'rule'

/** The journal: everything Operator did on its own or is waiting to do. */
export interface AgentAction {
  id: ID
  kind: string
  risk: Risk
  title: string
  lines: string[]
  impactEur?: number | null
  /** Pending: the change to apply on approval. Applied: emptied, the undo spec is what matters. */
  cs: ChangeSet
  undo?: UndoSpec | null
  status: 'pending' | 'applied' | 'undone' | 'rejected'
  source: ActionSource
  actor: Actor
  /** Who approved it. Empty when Operator ran it alone — only those count against the daily limit. */
  approvedBy?: string | null
  /** Why it is waiting, or why it could run alone */
  reason?: string | null
  link?: string | null
  createdAt: string
  resolvedAt?: string | null
}

/** A standing instruction in plain language that Operator follows on a schedule or after an event. */
export interface Rule {
  id: ID
  name: string
  instruction: string
  trigger: 'hourly' | 'daily' | 'weekly' | 'on_sync' | 'on_receipt'
  enabled: boolean
  createdBy: 'user' | 'agent'
  createdAt: string
  lastRunAt?: string | null
  lastResult?: string | null
}

export interface ActivityEvent {
  id: ID
  kind: string
  title: string
  detail?: string | null
  actor: Actor
  createdAt: string
  link?: string | null
}

export interface Snapshot {
  workspace: Workspace
  members: Member[]
  locations: Location[]
  categories: Category[]
  suppliers: Supplier[]
  items: Item[]
  levels: StockLevel[]
  batches: Batch[]
  movements: Movement[]
  receipts: Receipt[]
  orders: PurchaseOrder[]
  counts: Count[]
  proposals: Proposal[]
  playbooks: Playbook[]
  dashboards: Dashboard[]
  events: ActivityEvent[]
  actions: AgentAction[]
  rules: Rule[]
}

export type TableName = Exclude<keyof Snapshot, 'workspace'>

export interface UserProfile {
  id: ID
  email: string
  name: string
  hue: number
}

export interface Session {
  user: UserProfile
  mode: 'cloud' | 'local' | 'demo'
}
