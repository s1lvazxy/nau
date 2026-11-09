import type {
  ActivityEvent,
  Batch,
  Category,
  Count,
  Dashboard,
  Item,
  Location,
  Member,
  Movement,
  Playbook,
  PurchaseOrder,
  Receipt,
  Sector,
  Snapshot,
  StockLevel,
  Supplier,
  Unit,
  Widget,
  Workspace,
} from './types'
import { addDays, isoDay } from './format'
import { makeNIF } from './pt'
import { rng, round, slugify, uid } from './utils'
import { generateProposals } from './analytics'

export const DEFAULT_SETTINGS: Workspace['settings'] = {
  autonomy: { reorder: 'draft', transfer: 'suggest', adjustment: 'suggest', markdown: 'suggest', autoLimit: 250 },
  policy: { reversible: 'auto', money: 'ask', outbound: 'ask', perActionLimit: 250, dailyLimit: 750 },
  briefTime: '07:30',
  reviewDays: 7,
  deadStockDays: 45,
  expiryWarnDays: 5,
}

export const DEFAULT_PLAYBOOKS: Omit<Playbook, 'id'>[] = [
  { key: 'reorder', name: 'Reorder autopilot', description: 'Watches every item against demand and lead time, and drafts purchase orders grouped by supplier.', cadence: 'hourly', enabled: true },
  { key: 'rebalance', name: 'Rebalance locations', description: 'Moves stock between your stores before one runs dry while another sits on extra.', cadence: 'daily', enabled: true },
  { key: 'expiry', name: 'Expiry radar', description: 'Flags lots that won’t sell before their date and proposes a markdown in time to matter.', cadence: 'daily', enabled: true },
  { key: 'deadstock', name: 'Dead stock release', description: 'Finds money tied up in items that stopped selling and suggests how to free it.', cadence: 'weekly', enabled: true },
  { key: 'cyclecount', name: 'Cycle counts', description: 'Schedules small, rotating counts of your most valuable items so numbers stay true.', cadence: 'weekly', enabled: true },
  { key: 'pricewatch', name: 'Supplier price watch', description: 'Notices when a delivery costs more than the last one and shows the price that keeps your margin.', cadence: 'daily', enabled: true },
  { key: 'brief', name: 'Morning brief', description: 'A short summary of what changed overnight and what needs you today.', cadence: 'daily', enabled: true },
]

let wid = 0
const w = (type: Widget['type'], x: number, y: number, ww: number, h: number, config: Record<string, unknown> = {}, title?: string): Widget => ({
  id: `w${++wid}-${type}`,
  type,
  title,
  config,
  layout: { x, y, w: ww, h },
})

export function defaultDashboards(): Omit<Dashboard, 'id'>[] {
  return [
    {
      name: 'Overview',
      position: 0,
      widgets: [
        w('brief', 0, 0, 5, 5),
        w('health', 5, 0, 3, 5),
        w('approvals', 8, 0, 4, 5),
        w('kpi', 0, 5, 3, 2, { metric: 'stockValue' }),
        w('kpi', 3, 5, 3, 2, { metric: 'revenue7' }),
        w('kpi', 6, 5, 3, 2, { metric: 'lowCount' }),
        w('kpi', 9, 5, 3, 2, { metric: 'openPOValue' }),
        w('salesTrend', 0, 7, 8, 5, { days: 30 }),
        w('lowStock', 8, 7, 4, 5),
        w('topMovers', 0, 12, 4, 5),
        w('categoryMix', 4, 12, 4, 5),
        w('expiry', 8, 12, 4, 5),
        w('incoming', 0, 17, 6, 5),
        w('activity', 6, 17, 6, 5),
      ],
    },
    {
      name: 'Floor',
      position: 1,
      widgets: [
        w('quickActions', 0, 0, 4, 4),
        w('incoming', 4, 0, 8, 4),
        w('lowStock', 0, 4, 6, 6, { limit: 10 }),
        w('expiry', 6, 4, 6, 6),
        w('locations', 0, 10, 12, 4),
      ],
    },
  ]
}

/* ───────────────────────────── Catalogue ───────────────────────────── */

interface Spec {
  name: string
  cat: string
  sup: string
  unit?: Unit
  cost: number
  price: number
  vat: number
  /** base daily units across both stores */
  d: number
  expiry?: number
  tags?: string[]
  trend?: number
}

const CATS: { key: string; name: string; hue: number }[] = [
  { key: 'pantry', name: 'Tinned fish & pantry', hue: 28 },
  { key: 'oil', name: 'Olive oil & vinegar', hue: 78 },
  { key: 'wine', name: 'Wine', hue: 345 },
  { key: 'port', name: 'Port & spirits', hue: 15 },
  { key: 'coffee', name: 'Coffee & tea', hue: 24 },
  { key: 'cheese', name: 'Cheese & charcuterie', hue: 44 },
  { key: 'bakery', name: 'Bakery', hue: 36 },
  { key: 'drinks', name: 'Soft drinks & water', hue: 198 },
  { key: 'sweets', name: 'Sweets & honey', hue: 318 },
]

const SUPS: { key: string; name: string; lead: number; min: number; terms: string; contact: string; every: number }[] = [
  { key: 'atl', name: 'Distribuidora Atlântico', lead: 3, min: 250, terms: '30 days', contact: 'Paulo Viegas', every: 7 },
  { key: 'lagar', name: 'Lagar do Vale', lead: 5, min: 300, terms: '30 days', contact: 'Helena Lopes', every: 14 },
  { key: 'quinta', name: 'Quinta das Pedras', lead: 7, min: 500, terms: '60 days', contact: 'Rui Almeida', every: 14 },
  { key: 'torr', name: 'Torrefação Lusa', lead: 2, min: 120, terms: '15 days', contact: 'Marta Pires', every: 7 },
  { key: 'serra', name: 'Queijaria da Serra', lead: 4, min: 200, terms: '30 days', contact: 'João Nunes', every: 7 },
  { key: 'estrela', name: 'Padaria Estrela', lead: 1, min: 40, terms: 'On delivery', contact: 'Sofia Reis', every: 1 },
  { key: 'norte', name: 'Bebidas do Norte', lead: 3, min: 150, terms: '30 days', contact: 'Carlos Matos', every: 7 },
]

const SPECS: Spec[] = [
  { name: 'Sardinhas em azeite 120g', cat: 'pantry', sup: 'atl', cost: 1.85, price: 3.9, vat: 6, d: 9 },
  { name: 'Sardinhas picantes 120g', cat: 'pantry', sup: 'atl', cost: 1.95, price: 4.2, vat: 6, d: 5 },
  { name: 'Atum em azeite 120g', cat: 'pantry', sup: 'atl', cost: 2.4, price: 4.9, vat: 6, d: 7 },
  { name: 'Cavala com tomate 125g', cat: 'pantry', sup: 'atl', cost: 2.1, price: 4.5, vat: 6, d: 3 },
  { name: 'Polvo em azeite e alho 111g', cat: 'pantry', sup: 'atl', cost: 4.2, price: 8.9, vat: 6, d: 2.5 },
  { name: 'Bacalhau com grão 250g', cat: 'pantry', sup: 'atl', cost: 3.6, price: 6.9, vat: 6, d: 2 },
  { name: 'Flor de sal 250g', cat: 'pantry', sup: 'atl', cost: 2.3, price: 5.5, vat: 6, d: 2.2 },
  { name: 'Massa sovada (caixa)', cat: 'pantry', sup: 'atl', cost: 2.9, price: 5.9, vat: 6, d: 0.0, tags: ['seasonal'] },
  { name: 'Piri-piri caseiro 100ml', cat: 'pantry', sup: 'atl', cost: 1.6, price: 3.95, vat: 23, d: 1.6 },
  { name: 'Azeite virgem extra 750ml', cat: 'oil', sup: 'lagar', cost: 6.4, price: 12.9, vat: 6, d: 6, trend: 0.15 },
  { name: 'Azeite virgem extra 250ml', cat: 'oil', sup: 'lagar', cost: 2.9, price: 5.9, vat: 6, d: 3.5 },
  { name: 'Azeite Galega DOP 500ml', cat: 'oil', sup: 'lagar', cost: 7.8, price: 16.5, vat: 6, d: 1.4 },
  { name: 'Vinagre de vinho tinto 500ml', cat: 'oil', sup: 'lagar', cost: 1.7, price: 3.8, vat: 6, d: 1.1 },
  { name: 'Azeitonas galega 300g', cat: 'oil', sup: 'lagar', cost: 2.2, price: 4.6, vat: 6, d: 2.8 },
  { name: 'Vinho Verde Alvarinho 75cl', cat: 'wine', sup: 'quinta', cost: 6.2, price: 12.9, vat: 13, d: 5, trend: 0.2 },
  { name: 'Vinho Verde Loureiro 75cl', cat: 'wine', sup: 'quinta', cost: 4.1, price: 8.5, vat: 13, d: 3.4 },
  { name: 'Douro tinto reserva 75cl', cat: 'wine', sup: 'quinta', cost: 8.9, price: 18.9, vat: 13, d: 2.6 },
  { name: 'Alentejo tinto 75cl', cat: 'wine', sup: 'quinta', cost: 4.6, price: 9.9, vat: 13, d: 4.2 },
  { name: 'Dão branco Encruzado 75cl', cat: 'wine', sup: 'quinta', cost: 7.4, price: 15.5, vat: 13, d: 1.3 },
  { name: 'Bairrada espumante bruto 75cl', cat: 'wine', sup: 'quinta', cost: 6.8, price: 13.9, vat: 13, d: 1.1 },
  { name: 'Colares Ramisco 50cl', cat: 'wine', sup: 'quinta', cost: 19.5, price: 39.0, vat: 13, d: 0.0 },
  { name: 'Moscatel de Setúbal 75cl', cat: 'port', sup: 'quinta', cost: 7.2, price: 14.9, vat: 13, d: 1.2 },
  { name: 'Porto Tawny 10 anos 75cl', cat: 'port', sup: 'quinta', cost: 14.5, price: 29.9, vat: 13, d: 1.9 },
  { name: 'Porto Ruby 75cl', cat: 'port', sup: 'quinta', cost: 6.1, price: 12.5, vat: 13, d: 2.4 },
  { name: 'Ginjinha de Óbidos 50cl', cat: 'port', sup: 'norte', cost: 5.3, price: 11.9, vat: 23, d: 2.1 },
  { name: 'Aguardente velha 70cl', cat: 'port', sup: 'quinta', cost: 15.2, price: 32.0, vat: 23, d: 0.0 },
  { name: 'Café em grão 1kg', cat: 'coffee', sup: 'torr', unit: 'kg', cost: 13.5, price: 24.9, vat: 23, d: 1.8 },
  { name: 'Café moído lote casa 250g', cat: 'coffee', sup: 'torr', cost: 3.9, price: 7.5, vat: 23, d: 5.5 },
  { name: 'Café cápsulas (10)', cat: 'coffee', sup: 'torr', cost: 2.2, price: 4.6, vat: 23, d: 6 },
  { name: 'Chá dos Açores verde 100g', cat: 'coffee', sup: 'torr', cost: 3.1, price: 6.5, vat: 23, d: 1.4 },
  { name: 'Queijo da Serra DOP', cat: 'cheese', sup: 'serra', unit: 'kg', cost: 21.0, price: 36.0, vat: 6, d: 1.3, expiry: 21 },
  { name: 'Queijo de Azeitão 250g', cat: 'cheese', sup: 'serra', cost: 6.2, price: 11.5, vat: 6, d: 2.2, expiry: 18 },
  { name: 'Queijo São Jorge 12 meses', cat: 'cheese', sup: 'serra', unit: 'kg', cost: 14.8, price: 26.0, vat: 6, d: 0.9, expiry: 40 },
  { name: 'Requeijão fresco 200g', cat: 'cheese', sup: 'serra', cost: 1.9, price: 3.6, vat: 6, d: 3.5, expiry: 6 },
  { name: 'Presunto fatiado 100g', cat: 'cheese', sup: 'serra', cost: 3.4, price: 6.9, vat: 6, d: 4.1, expiry: 25 },
  { name: 'Chouriço de porco preto', cat: 'cheese', sup: 'serra', cost: 4.5, price: 8.9, vat: 6, d: 2.6, expiry: 45 },
  { name: 'Pastel de nata', cat: 'bakery', sup: 'estrela', cost: 0.45, price: 1.3, vat: 6, d: 64, expiry: 2, trend: 0.08 },
  { name: 'Pão de Mafra', cat: 'bakery', sup: 'estrela', cost: 1.1, price: 2.6, vat: 6, d: 14, expiry: 2 },
  { name: 'Broa de milho', cat: 'bakery', sup: 'estrela', cost: 1.4, price: 3.2, vat: 6, d: 7, expiry: 3 },
  { name: 'Bolo de arroz', cat: 'bakery', sup: 'estrela', cost: 0.5, price: 1.4, vat: 6, d: 16, expiry: 2 },
  { name: 'Queijada de Sintra', cat: 'bakery', sup: 'estrela', cost: 0.6, price: 1.6, vat: 6, d: 9, expiry: 4 },
  { name: 'Água das Pedras 25cl', cat: 'drinks', sup: 'norte', cost: 0.42, price: 1.2, vat: 23, d: 18 },
  { name: 'Água mineral 50cl', cat: 'drinks', sup: 'norte', cost: 0.18, price: 0.8, vat: 6, d: 26 },
  { name: 'Laranjada gaseificada 33cl', cat: 'drinks', sup: 'norte', cost: 0.45, price: 1.4, vat: 23, d: 12 },
  { name: 'Ice tea de pêssego 33cl', cat: 'drinks', sup: 'norte', cost: 0.4, price: 1.3, vat: 23, d: 10 },
  { name: 'Cerveja artesanal IPA 33cl', cat: 'drinks', sup: 'norte', cost: 1.45, price: 3.5, vat: 23, d: 6, trend: 0.25 },
  { name: 'Sumo de laranja natural 1L', cat: 'drinks', sup: 'norte', cost: 1.9, price: 3.95, vat: 6, d: 4, expiry: 6 },
  { name: 'Mel de rosmaninho 500g', cat: 'sweets', sup: 'atl', cost: 5.1, price: 9.9, vat: 6, d: 1.3 },
  { name: 'Doce de abóbora 250g', cat: 'sweets', sup: 'atl', cost: 2.4, price: 4.9, vat: 6, d: 1.0 },
  { name: 'Ovos moles de Aveiro (6)', cat: 'sweets', sup: 'estrela', cost: 4.2, price: 8.5, vat: 6, d: 1.6, expiry: 8 },
  { name: 'Chocolate negro 70% flor de sal', cat: 'sweets', sup: 'atl', cost: 1.9, price: 3.95, vat: 23, d: 3.2 },
  { name: 'Amêndoas cobertas 200g', cat: 'sweets', sup: 'atl', cost: 2.6, price: 5.5, vat: 23, d: 0.9 },
  { name: 'Figos secos do Algarve 250g', cat: 'sweets', sup: 'atl', cost: 2.8, price: 5.9, vat: 6, d: 1.2 },
  { name: 'Bolachas de manteiga (lata)', cat: 'sweets', sup: 'atl', cost: 3.7, price: 7.9, vat: 23, d: 0.0 },
]

function ean13(stem12: string) {
  const s = stem12.padEnd(12, '0').slice(0, 12)
  let total = 0
  for (let i = 0; i < 12; i++) total += Number(s[i]) * (i % 2 ? 3 : 1)
  return s + String((10 - (total % 10)) % 10)
}

function skuFor(name: string, cat: string, i: number) {
  const prefix = { pantry: 'PAN', oil: 'OIL', wine: 'WIN', port: 'SPR', coffee: 'COF', cheese: 'CHE', bakery: 'BAK', drinks: 'DRK', sweets: 'SWT' }[cat] ?? 'GEN'
  const word = slugify(name).split('-').filter((x) => x.length > 2)[0]?.slice(0, 3).toUpperCase() ?? 'ITM'
  return `${prefix}-${word}-${String(100 + i)}`
}

function poisson(r: () => number, lambda: number) {
  if (lambda <= 0) return 0
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (r() + r() + r() - 1.5) * 1.15))
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= r()
  } while (p > L)
  return k - 1
}

export interface SeedOptions {
  workspaceName?: string
  ownerName?: string
  ownerEmail?: string
  sector?: Sector
  nif?: string
  empty?: boolean
}

const DOW_FACTOR = [0.75, 0.85, 0.9, 0.95, 1.15, 1.45, 0.95] // Sun..Sat

export function createDemoSnapshot(opts: SeedOptions = {}): Snapshot {
  const r = rng(20261109)
  const now = new Date()
  const ts = (d: Date, h: number, m = 0) => {
    const x = new Date(d)
    x.setHours(h, m, Math.floor(r() * 59), 0)
    // never in the future: today's events land before "now"
    const latest = now.getTime() - 60_000 - Math.floor(r() * 20) * 60_000
    return new Date(Math.min(x.getTime(), latest)).toISOString()
  }
  const workspace: Workspace = {
    id: uid(),
    name: opts.workspaceName ?? 'Casa Ribeira',
    slug: slugify(opts.workspaceName ?? 'casa-ribeira'),
    nif: opts.nif ?? makeNIF('51623498'),
    sector: opts.sector ?? 'grocery',
    region: 'continente',
    currency: 'EUR',
    timezone: 'Europe/Lisbon',
    createdAt: addDays(now, -120).toISOString(),
    settings: structuredClone(DEFAULT_SETTINGS),
  }
  const ownerName = opts.ownerName ?? 'Inês Marques'
  const members: Member[] = [
    { id: uid(), name: ownerName, email: opts.ownerEmail ?? 'ines@casaribeira.pt', role: 'owner', status: 'active', hue: 24 },
    { id: uid(), name: 'Tiago Costa', email: 'tiago@casaribeira.pt', role: 'admin', status: 'active', hue: 210 },
    { id: uid(), name: 'Rita Sousa', email: 'rita@casaribeira.pt', role: 'member', status: 'active', hue: 330 },
    { id: uid(), name: 'Bruno Faria', email: 'bruno@casaribeira.pt', role: 'member', status: 'active', hue: 140 },
    { id: uid(), name: 'Ana Ribeiro', email: 'contabilidade@ribeiro-cc.pt', role: 'viewer', status: 'invited', hue: 270 },
  ]
  const locations: Location[] = [
    { id: uid(), name: 'Marvila warehouse', code: 'ARM', kind: 'warehouse', address: 'Rua do Açúcar 74, Lisboa', isDefault: true },
    { id: uid(), name: 'Príncipe Real', code: 'PRL', kind: 'store', address: 'Rua da Escola Politécnica 61, Lisboa' },
    { id: uid(), name: 'Bonfim', code: 'BNF', kind: 'store', address: 'Rua do Heroísmo 212, Porto' },
  ]
  const [WH, LX, PO] = locations
  const categories: Category[] = CATS.map((c) => ({ id: uid(), name: c.name, hue: c.hue, atCategory: 'M' }))
  const catId = Object.fromEntries(CATS.map((c, i) => [c.key, categories[i].id]))
  const suppliers: Supplier[] = SUPS.map((s, i) => ({
    id: uid(),
    name: s.name,
    nif: makeNIF(String(50812345 + i * 1371)),
    email: `encomendas@${slugify(s.name)}.pt`,
    phone: `+351 21 ${String(3400000 + i * 18731).slice(0, 3)} ${String(1000 + i * 377).slice(0, 4)}`,
    contact: s.contact,
    leadTimeDays: s.lead,
    minOrderValue: s.min,
    paymentTerms: s.terms,
    notes: null,
    orderDays: s.every === 1 ? [1, 2, 3, 4, 5, 6] : [2],
  }))
  const supId = Object.fromEntries(SUPS.map((s, i) => [s.key, suppliers[i].id]))
  const supByKey = Object.fromEntries(SUPS.map((s) => [s.key, s]))

  if (opts.empty) {
    return {
      workspace,
      members: members.slice(0, 1),
      locations: [{ ...WH, name: 'Main store', code: 'MAIN', kind: 'store', address: null }],
      categories: categories.slice(0, 0),
      suppliers: [],
      items: [],
      levels: [],
      batches: [],
      movements: [],
      receipts: [],
      orders: [],
      counts: [],
      proposals: [],
      playbooks: DEFAULT_PLAYBOOKS.map((p) => ({ ...p, id: uid() })),
      dashboards: defaultDashboards().map((d) => ({ ...d, id: uid() })),
      events: [],
      actions: [],
      rules: [],
    }
  }

  const items: Item[] = SPECS.map((s, i) => ({
    id: uid(),
    sku: skuFor(s.name, s.cat, i),
    name: s.name,
    barcode: ean13('560' + String(7012340 + i * 37).padStart(9, '0')),
    categoryId: catId[s.cat],
    unit: s.unit ?? 'un',
    cost: s.cost,
    price: s.price,
    vatRate: s.vat,
    reorderPoint: null,
    reorderQty: null,
    safetyDays: s.expiry && s.expiry <= 3 ? 0.5 : 3,
    supplierId: supId[s.sup],
    tracksExpiry: !!s.expiry && s.expiry > 2,
    archived: false,
    tags: s.sup === 'estrela' && (s.expiry ?? 9) <= 4 ? ['daily', ...(s.tags ?? [])] : s.tags ?? [],
    createdAt: addDays(now, -150).toISOString(),
    hue: CATS.find((c) => c.key === s.cat)!.hue,
  }))

  // Simulation state
  const DAYS = 90
  const stock: Record<string, Record<string, number>> = {}
  const set = (itemId: string, loc: string, v: number) => ((stock[itemId] ||= {})[loc] = v)
  const get = (itemId: string, loc: string) => stock[itemId]?.[loc] ?? 0
  const movements: Movement[] = []
  const receipts: Receipt[] = []
  const orders: PurchaseOrder[] = []
  const actorSys = { kind: 'system' as const, name: 'POS sync' }
  const team = [
    { kind: 'user' as const, name: 'Tiago Costa' },
    { kind: 'user' as const, name: 'Rita Sousa' },
    { kind: 'user' as const, name: 'Bruno Faria' },
    { kind: 'user' as const, name: ownerName },
  ]
  const agent = { kind: 'agent' as const, name: 'Operator' }
  let rcpN = 300
  let poN = 120
  let costDrift: Record<string, number> = {}

  SPECS.forEach((s, i) => {
    const it = items[i]
    const base = s.d
    const perishable = s.expiry && s.expiry <= 4
    set(it.id, WH.id, perishable ? 0 : Math.ceil(base * 16 + 6))
    set(it.id, LX.id, Math.ceil(base * 0.58 * (perishable ? 1.1 : 6)) + 2)
    set(it.id, PO.id, Math.ceil(base * 0.42 * (perishable ? 1.1 : 6)) + 1)
  })

  for (let day = DAYS; day >= 0; day--) {
    const d = addDays(now, -day)
    const dow = d.getDay()
    const isToday = day === 0
    const hourNow = now.getHours()
    // morning deliveries
    SUPS.forEach((sup) => {
      const due = sup.every === 1 ? dow !== 0 : (DAYS - day) % sup.every === 2
      if (!due || (isToday && hourNow < 8)) return
      if (sup.key === 'estrela') {
        // bakery delivers straight to stores, sized to the day
        const lines: Receipt['lines'] = []
        for (const [i, s] of SPECS.entries()) {
          if (s.sup !== 'estrela' || s.d <= 0) continue
          const it = items[i]
          for (const [loc, share] of [
            [LX, 0.58],
            [PO, 0.42],
          ] as const) {
            const target = Math.ceil(s.d * share * DOW_FACTOR[dow] * (1 + (s.trend ?? 0) * (1 - day / DAYS)) * 1.08)
            const q = Math.max(0, target - get(it.id, loc.id))
            if (!q) continue
            set(it.id, loc.id, get(it.id, loc.id) + q)
            movements.push({ id: uid(), itemId: it.id, locationId: loc.id, type: 'receipt', qty: q, unitCost: it.cost, ref: `GR ${rcpN}`, actor: team[2], createdAt: ts(d, 7, 10), batchCode: `E${isoDay(d).replace(/-/g, '').slice(2)}`, expiresOn: isoDay(addDays(d, s.expiry ?? 2)) })
            lines.push({ id: uid(), itemId: it.id, description: it.name, qty: q, unitCost: it.cost })
          }
        }
        if (day <= 14 && lines.length)
          receipts.push({ id: uid(), number: `R-${rcpN}`, supplierId: supId[sup.key], locationId: LX.id, status: 'posted', docRef: `GR ${rcpN}`, docDate: isoDay(d), lines, source: day % 3 === 0 ? 'scan' : 'manual', createdAt: ts(d, 7, 12), postedAt: ts(d, 7, 14) })
        rcpN++
        return
      }
      const lines: Receipt['lines'] = []
      const poLines: PurchaseOrder['lines'] = []
      for (const [i, s] of SPECS.entries()) {
        if (s.sup !== sup.key) continue
        const it = items[i]
        const total = get(it.id, WH.id) + get(it.id, LX.id) + get(it.id, PO.id)
        const daily = s.d * (1 + (s.trend ?? 0))
        const target = daily * (sup.lead + sup.every + 4)
        let q = Math.ceil(target - total)
        if (s.d === 0 && day === DAYS) q = 14 // slow movers bought once, then stalled
        if (q <= 0) continue
        if (it.unit === 'kg') q = Math.ceil(q)
        let cost = it.cost
        // olive oil and Alvarinho got more expensive recently
        if ((s.name.startsWith('Azeite virgem extra 750') || s.name.startsWith('Vinho Verde Alvarinho')) && day < 12) {
          cost = round(it.cost * (s.name.startsWith('Azeite') ? 1.09 : 1.06))
          costDrift[it.id] = cost
        }
        set(it.id, WH.id, get(it.id, WH.id) + q)
        const lot = s.expiry ? `L${isoDay(d).replace(/-/g, '').slice(2)}${i}` : null
        movements.push({ id: uid(), itemId: it.id, locationId: WH.id, type: 'receipt', qty: q, unitCost: cost, ref: `R-${rcpN}`, actor: team[day % 2], createdAt: ts(d, 9, 20), batchCode: lot, expiresOn: s.expiry ? isoDay(addDays(d, s.expiry)) : null })
        lines.push({ id: uid(), itemId: it.id, description: it.name, qty: q, unitCost: cost, lot, expiresOn: s.expiry ? isoDay(addDays(d, s.expiry)) : null })
        poLines.push({ itemId: it.id, qty: q, unitCost: cost, received: q })
      }
      if (lines.length && day <= 45) {
        const poId = uid()
        orders.push({ id: poId, number: `PO-${poN++}`, supplierId: supId[sup.key], locationId: WH.id, status: 'received', lines: poLines, expectedOn: isoDay(d), createdBy: day % 3 === 0 ? 'agent' : 'user', createdAt: ts(addDays(d, -sup.lead), 16), sentAt: ts(addDays(d, -sup.lead), 16, 30) })
        receipts.push({ id: uid(), number: `R-${rcpN}`, supplierId: supId[sup.key], locationId: WH.id, status: 'posted', docRef: `FT 2026/${1000 + rcpN}`, docDate: isoDay(d), lines, source: day % 4 === 0 ? 'scan' : 'po', poId, createdAt: ts(d, 9, 15), postedAt: ts(d, 9, 25) })
      }
      rcpN++
    })
    // replenish stores from warehouse (non-bakery)
    if (dow === 1 || dow === 4) {
      for (const [i, s] of SPECS.entries()) {
        if (s.sup === 'estrela') continue
        const it = items[i]
        for (const [loc, share] of [
          [LX, 0.58],
          [PO, 0.42],
        ] as const) {
          const need = Math.ceil(s.d * share * 5) - get(it.id, loc.id)
          const q = Math.min(need, get(it.id, WH.id))
          if (q <= 0) continue
          const g = uid()
          set(it.id, WH.id, get(it.id, WH.id) - q)
          set(it.id, loc.id, get(it.id, loc.id) + q)
          const at = ts(d, 10, 30)
          movements.push({ id: uid(), itemId: it.id, locationId: WH.id, type: 'transfer', qty: -q, actor: team[0], createdAt: at, groupId: g, ref: `TR ${loc.code}` })
          movements.push({ id: uid(), itemId: it.id, locationId: loc.id, type: 'transfer', qty: q, actor: team[0], createdAt: at, groupId: g, ref: `TR ${loc.code}` })
        }
      }
    }
    // sales
    const progress = 1 - day / DAYS
    for (const [i, s] of SPECS.entries()) {
      if (s.d <= 0) continue
      const it = items[i]
      for (const [loc, share] of [
        [LX, 0.58],
        [PO, 0.42],
      ] as const) {
        let lambda = s.d * share * DOW_FACTOR[dow] * (1 + (s.trend ?? 0) * progress)
        if (isToday) lambda *= Math.min(1, Math.max(0, (hourNow - 8) / 12))
        let q = poisson(r, lambda)
        if (it.unit === 'kg') q = round(q * (0.35 + r() * 0.3), 2)
        q = Math.min(q, get(it.id, loc.id))
        if (q <= 0) continue
        set(it.id, loc.id, round(get(it.id, loc.id) - q, 2))
        movements.push({ id: uid(), itemId: it.id, locationId: loc.id, type: 'sale', qty: -q, unitCost: it.cost, actor: actorSys, createdAt: ts(d, 19, 45), ref: `POS ${loc.code}` })
      }
      // bakery leftovers are wasted at close
      if (s.expiry && s.expiry <= 2 && !isToday) {
        for (const loc of [LX, PO]) {
          const left = get(it.id, loc.id)
          if (left > 0 && r() < 0.5) {
            set(it.id, loc.id, 0)
            movements.push({ id: uid(), itemId: it.id, locationId: loc.id, type: 'waste', qty: -left, unitCost: it.cost, actor: team[2], createdAt: ts(d, 20, 10), note: 'End-of-day leftovers' })
          }
        }
      }
    }
    // occasional count corrections
    if (day % 11 === 3) {
      const i = Math.floor(r() * SPECS.length)
      const it = items[i]
      const delta = -Math.max(1, Math.floor(r() * 3))
      const loc = r() < 0.5 ? LX : PO
      if (get(it.id, loc.id) + delta >= 0) {
        set(it.id, loc.id, get(it.id, loc.id) + delta)
        movements.push({ id: uid(), itemId: it.id, locationId: loc.id, type: 'adjustment', qty: delta, unitCost: it.cost, actor: team[1], createdAt: ts(d, 18, 5), note: r() < 0.5 ? 'Damaged on shelf' : 'Count correction' })
      }
    }
  }

  // Apply cost drift to the item master as the latest cost
  for (const it of items) if (costDrift[it.id]) it.cost = costDrift[it.id]

  // Scenario shaping — make the demo tell a story
  const byName = (n: string) => items[SPECS.findIndex((s) => s.name.startsWith(n))]
  const zero = (n: string, loc: Location) => set(byName(n).id, loc.id, 0)
  // Alvarinho trending + nearly out everywhere (summer-like demand): critical
  set(byName('Vinho Verde Alvarinho').id, WH.id, 0)
  set(byName('Vinho Verde Alvarinho').id, LX.id, 4)
  set(byName('Vinho Verde Alvarinho').id, PO.id, 2)
  // Tinned octopus out of stock
  zero('Polvo em azeite', WH)
  zero('Polvo em azeite', LX)
  zero('Polvo em azeite', PO)
  // Capsules imbalance: Lisbon starving, warehouse fine, Porto overflowing
  set(byName('Café cápsulas').id, LX.id, 2)
  set(byName('Café cápsulas').id, PO.id, 64)
  set(byName('Café cápsulas').id, WH.id, 18)
  // Overstock on Douro reserva
  set(byName('Douro tinto reserva').id, WH.id, 96)
  // IPA trending, low
  set(byName('Cerveja artesanal IPA').id, WH.id, 6)
  set(byName('Cerveja artesanal IPA').id, LX.id, 5)
  set(byName('Cerveja artesanal IPA').id, PO.id, 3)

  const levels: StockLevel[] = []
  for (const it of items) for (const loc of locations) levels.push({ itemId: it.id, locationId: loc.id, onHand: round(Math.max(0, get(it.id, loc.id)), 2) })

  // Batches for items that track expiry (current stock split into lots)
  const batches: Batch[] = []
  for (const [i, s] of SPECS.entries()) {
    if (!s.expiry || s.expiry <= 4) continue
    const it = items[i]
    for (const loc of locations) {
      const q = get(it.id, loc.id)
      if (q <= 0) continue
      const near = Math.max(0, Math.round(q * 0.3))
      const exp1 = Math.max(2, Math.floor(s.expiry * 0.3))
      if (near > 0) batches.push({ id: uid(), itemId: it.id, locationId: loc.id, code: `L${String(2600 + i * 7 + batches.length)}A`, expiresOn: isoDay(addDays(now, exp1)), qty: near })
      if (q - near > 0) batches.push({ id: uid(), itemId: it.id, locationId: loc.id, code: `L${String(2600 + i * 7 + batches.length)}B`, expiresOn: isoDay(addDays(now, s.expiry)), qty: round(q - near, 2) })
    }
  }
  // A cheese lot that will clearly not sell in time
  const azeitao = byName('Queijo de Azeitão')
  batches.push({ id: uid(), itemId: azeitao.id, locationId: PO.id, code: 'L2611AZ', expiresOn: isoDay(addDays(now, 3)), qty: 14 })
  const lv = levels.find((l) => l.itemId === azeitao.id && l.locationId === PO.id)!
  lv.onHand = round(lv.onHand + 14, 2)

  // Open purchase orders (incoming)
  const mk = (supKey: string, names: [string, number][], status: PurchaseOrder['status'], expectedIn: number, by: 'user' | 'agent', createdAgo: number): PurchaseOrder => ({
    id: uid(),
    number: `PO-${poN++}`,
    supplierId: supId[supKey],
    locationId: WH.id,
    status,
    lines: names.map(([n, q]) => {
      const it = byName(n)
      return { itemId: it.id, qty: q, unitCost: it.cost, received: 0 }
    }),
    expectedOn: isoDay(addDays(now, expectedIn)),
    createdBy: by,
    createdAt: addDays(now, -createdAgo).toISOString(),
    sentAt: status === 'draft' ? null : addDays(now, -createdAgo).toISOString(),
    note: by === 'agent' ? 'Drafted by Operator from the reorder autopilot.' : null,
  })
  orders.push(
    mk('torr', [['Café em grão 1kg', 12], ['Café moído lote casa', 48], ['Chá dos Açores', 12]], 'sent', 0, 'agent', 2),
    mk('serra', [['Queijo da Serra', 6], ['Presunto fatiado', 30], ['Chouriço de porco preto', 18]], 'sent', 1, 'user', 3),
    mk('lagar', [['Azeite virgem extra 250ml', 24], ['Azeitonas galega', 24]], 'draft', 5, 'user', 0),
  )
  void supByKey

  // A count waiting for review
  const countItems = ['Sardinhas em azeite', 'Atum em azeite', 'Flor de sal', 'Mel de rosmaninho', 'Chocolate negro', 'Azeitonas galega'].map(byName)
  const counts: Count[] = [
    {
      id: uid(),
      name: 'Príncipe Real — pantry shelf',
      locationId: LX.id,
      status: 'review',
      blind: true,
      createdAt: addDays(now, -1).toISOString(),
      lines: countItems.map((it, k) => {
        const exp = get(it.id, LX.id)
        return { itemId: it.id, expected: exp, counted: k === 2 ? Math.max(0, exp - 3) : k === 4 ? exp + 2 : exp }
      }),
    },
    {
      id: uid(),
      name: 'Marvila — monthly wine count',
      locationId: WH.id,
      status: 'closed',
      blind: true,
      createdAt: addDays(now, -18).toISOString(),
      closedAt: addDays(now, -18).toISOString(),
      lines: items.filter((it) => it.categoryId === catId.wine).map((it) => ({ itemId: it.id, expected: get(it.id, WH.id), counted: get(it.id, WH.id) })),
    },
  ]

  // Activity
  const events: ActivityEvent[] = [
    { id: uid(), kind: 'receipt', title: 'Delivery from Padaria Estrela posted', detail: '5 lines · Príncipe Real', actor: team[2], createdAt: ts(now, 7, 14) },
    { id: uid(), kind: 'agent', title: 'Operator drafted PO for Torrefação Lusa', detail: '3 lines · approved by Tiago Costa', actor: agent, createdAt: addDays(now, -2).toISOString() },
    { id: uid(), kind: 'count', title: 'Count submitted for review', detail: 'Príncipe Real — pantry shelf · 2 variances', actor: team[1], createdAt: addDays(now, -1).toISOString() },
    { id: uid(), kind: 'transfer', title: 'Transfer to Bonfim completed', detail: '14 lines from Marvila warehouse', actor: team[0], createdAt: addDays(now, -3).toISOString() },
    { id: uid(), kind: 'member', title: 'Ana Ribeiro was invited as Viewer', detail: 'Accountant access', actor: team[3], createdAt: addDays(now, -6).toISOString() },
  ]

  const snapshot: Snapshot = {
    workspace,
    members,
    locations,
    categories,
    suppliers,
    items,
    levels,
    batches,
    movements: movements.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    receipts: receipts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40),
    orders: orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    counts,
    proposals: [],
    playbooks: DEFAULT_PLAYBOOKS.map((p) => ({ ...p, id: uid(), lastRunAt: addDays(now, 0).toISOString() })),
    dashboards: defaultDashboards().map((d) => ({ ...d, id: uid() })),
    events,
    actions: [],
    rules: [],
  }
  snapshot.proposals = generateProposals(snapshot).map((p) => ({ ...p, id: uid(), createdAt: ts(now, 6, 30), status: 'pending' as const }))
  return snapshot
}

export function createEmptySnapshot(opts: SeedOptions & { workspaceName: string; ownerName: string; ownerEmail: string; sector: Sector; locationName?: string }): Snapshot {
  const s = createDemoSnapshot({ ...opts, empty: true })
  s.workspace.name = opts.workspaceName
  s.workspace.slug = slugify(opts.workspaceName)
  s.workspace.nif = opts.nif ?? null
  s.workspace.createdAt = new Date().toISOString()
  s.members = [{ id: uid(), name: opts.ownerName, email: opts.ownerEmail, role: 'owner', status: 'active', hue: 24 }]
  if (opts.locationName) s.locations[0].name = opts.locationName
  s.categories = starterCategories(opts.sector)
  return s
}

export function starterCategories(sector: Sector): Category[] {
  const map: Record<Sector, string[]> = {
    grocery: ['Pantry', 'Fresh', 'Drinks', 'Household'],
    cafe: ['Coffee', 'Pastry', 'Drinks', 'Packaging'],
    retail: ['Apparel', 'Accessories', 'Home', 'Gifts'],
    pharmacy: ['Personal care', 'Supplements', 'Baby', 'Dermocosmetics'],
    hardware: ['Tools', 'Fixings', 'Electrical', 'Paint'],
    ecommerce: ['Core products', 'Bundles', 'Packaging', 'Returns'],
    other: ['General'],
  }
  const hues = [24, 200, 140, 320, 270, 50]
  return map[sector].map((name, i) => ({ id: uid(), name, hue: hues[i % hues.length], atCategory: 'M' }))
}
