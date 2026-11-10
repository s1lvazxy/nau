import type { Snapshot } from '~/lib/types'
import { derive, kpis, morningBrief } from '~/lib/analytics'
import { eur, qty as fmtQty } from '~/lib/format'
import { normalize } from '~/lib/utils'
import type { ToolName } from './schema'
import { tr } from '~/i18n'

/**
 * Offline Operator: a deterministic intent engine used when no model is configured
 * (and in the public demo). It plans tool calls with the same executors Claude uses.
 */

export interface OfflinePlan {
  thinking: string
  calls: { name: ToolName; input: Record<string, unknown> }[]
  /** Builds the reply once tool results are known */
  reply: (results: { name: ToolName; result: any; summary: string }[]) => string
}

const STOP = new Set(['the', 'and', 'for', 'com', 'para', 'from', 'with', 'how', 'many', 'much', 'what', 'have', 'stock', 'left', 'units', 'unit', 'item', 'items', 'show', 'tell', 'about', 'temos', 'quanto', 'quantos', 'qual', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'we', 'do', 'does', 'is', 'are', 'there', 'our', 'my', 'me', 'please', 'can', 'you', 'will', 'when', 'run', 'out', 'forecast', 'move', 'transfer', 'to', 'into', 'order', 'reorder', 'draft', 'prepare'])

/** English shop words → the Portuguese used on labels */
const SYNONYMS: Record<string, string[]> = {
  capsule: ['capsulas'], capsules: ['capsulas'], coffee: ['cafe'], beans: ['grao'], ground: ['moido'], tea: ['cha'],
  oil: ['azeite'], olive: ['azeite', 'azeitonas'], olives: ['azeitonas'], vinegar: ['vinagre'], wine: ['vinho'], white: ['branco'], red: ['tinto'],
  sparkling: ['espumante'], port: ['porto'], brandy: ['aguardente'], cherry: ['ginjinha'], cheese: ['queijo'], ham: ['presunto'], sausage: ['chourico'],
  sardines: ['sardinhas'], sardine: ['sardinhas'], tuna: ['atum'], mackerel: ['cavala'], octopus: ['polvo'], cod: ['bacalhau'], salt: ['sal'],
  bread: ['pao'], cornbread: ['broa'], tart: ['pastel', 'nata'], tarts: ['pastel', 'nata'], custard: ['nata'], cake: ['bolo'], honey: ['mel'],
  water: ['agua'], sparkling_water: ['pedras'], orange: ['laranja', 'laranjada'], juice: ['sumo'], beer: ['cerveja'], peach: ['pessego'],
  chocolate: ['chocolate'], almonds: ['amendoas'], figs: ['figos'], biscuits: ['bolachas'], cookies: ['bolachas'], jam: ['doce'], pumpkin: ['abobora'], eggs: ['ovos'],
}

function commonPrefix(a: string, b: string) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function findItem(s: Snapshot, text: string) {
  const t = normalize(text)
  const base = t.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w))
  const words = new Set(base.flatMap((w) => [w, ...(SYNONYMS[w] ?? [])]))
  let best: { id: string; name: string; score: number } | null = null
  for (const it of s.items) {
    if (it.archived) continue
    if (t.includes(it.sku.toLowerCase()) || (it.barcode && t.includes(it.barcode))) return { id: it.id, name: it.name, score: 100 }
    const toks = normalize(it.name).split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
    let score = 0
    for (const tok of toks) {
      if (words.has(tok)) score += 3
      else if ([...words].some((w) => ((tok.startsWith(w) || w.startsWith(tok)) && Math.min(w.length, tok.length) >= 4) || commonPrefix(w, tok) >= 5)) score += 2
    }
    if (score && (!best || score > best.score || (score === best.score && it.name.length < best.name.length))) best = { id: it.id, name: it.name, score }
  }
  return best && best.score >= 2 ? best : null
}

function findLocations(s: Snapshot, text: string) {
  const t = normalize(text)
  const hits: { id: string; at: number }[] = []
  for (const l of s.locations) {
    const keys = [normalize(l.name), normalize(l.code), ...normalize(l.name).split(/\s+/).filter((w) => w.length >= 4)]
    if (l.kind === 'warehouse') keys.push('warehouse', 'armazem', 'deposito')
    let at = -1
    for (const k of keys) {
      const i = t.indexOf(k)
      if (i >= 0 && (at < 0 || i < at)) at = i
    }
    if (at >= 0) hits.push({ id: l.id, at })
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id)
}

function findSupplier(s: Snapshot, text: string) {
  const t = normalize(text)
  return s.suppliers.find((x) => normalize(x.name).split(/\s+/).some((w) => w.length >= 5 && t.includes(w)))
}

function firstNumber(text: string) {
  const m = text.replace(',', '.').match(/(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : null
}

const has = (t: string, ...keys: string[]) => keys.some((k) => t.includes(k))

export function planOffline(s: Snapshot, raw: string): OfflinePlan {
  const t = normalize(raw)
  const item = findItem(s, raw)
  const locs = findLocations(s, raw)
  const sup = findSupplier(s, raw)
  const n = firstNumber(raw)
  const locName = (id?: string) => s.locations.find((l) => l.id === id)?.name ?? ''

  // Widgets
  if (has(t, 'widget', 'dashboard', 'painel') && has(t, 'add', 'put', 'pin', 'adiciona', 'show', 'create', 'cria')) {
    const type = has(t, 'trend', 'sales', 'vendas') ? 'salesTrend' : has(t, 'expir', 'validade') ? 'expiry' : has(t, 'low', 'reorder', 'falta') ? 'lowStock' : has(t, 'top', 'best', 'mover') ? 'topMovers' : has(t, 'categor', 'mix') ? 'categoryMix' : has(t, 'location', 'loja', 'store') ? 'locations' : has(t, 'incoming', 'deliver', 'entrega') ? 'incoming' : has(t, 'dead', 'parado', 'not moving') ? 'deadStock' : has(t, 'forecast', 'previs') && item ? 'itemForecast' : has(t, 'health', 'saude') ? 'health' : has(t, 'note', 'nota') ? 'note' : 'kpi'
    const metric = has(t, 'margin') ? 'turnover' : has(t, 'value', 'valor', 'worth') ? 'stockValue' : has(t, 'revenue', 'sales', 'vendas') ? 'revenue7' : has(t, 'dead') ? 'deadValue' : has(t, 'order', 'po') ? 'openPOValue' : 'lowCount'
    return {
      thinking: tr('They want a new widget on the dashboard. Picking the closest widget type and placing it at the end.'),
      calls: [{ name: 'add_widget', input: { type, metric: type === 'kpi' ? metric : undefined, item: type === 'itemForecast' ? item?.id : undefined, title: undefined } }],
      reply: (r) => (r[0].result?.status === 'added' ? tr('Done — added it to {0}. Drag it wherever you like, or open Customise to resize it.', r[0].result.dashboard) : tr('I couldn’t add that widget: {0}', r[0].summary)),
    }
  }

  // Transfers
  if (has(t, 'move ', 'transfer', 'transferir', 'mover', 'passar') && item && locs.length >= 2 && n) {
    return {
      thinking: tr('Transfer {0} of {1} from {2} to {3}. Checking what’s available first.', n, item.name, locName(locs[0]), locName(locs[1])),
      calls: [{ name: 'prepare_transfer', input: { item: item.id, from: locs[0], to: locs[1], qty: n } }],
      reply: (r) => (r[0].result?.status === 'awaiting_approval' ? tr('I’ve prepared the transfer. Approve it and both locations update straight away.') : r[0].result?.status === 'applied_automatically' ? tr('Done — it was within your auto-approve limit, so I recorded the transfer.') : r[0].summary),
    }
  }

  // Corrections
  if (item && n != null && has(t, 'broke', 'broken', 'damaged', 'partiu', 'partid', 'stolen', 'lost', 'expired', 'spoiled', 'recount', 'counted', 'contei', 'quebr')) {
    const counted = has(t, 'counted', 'recount', 'contei')
    const loc = locs[0] ?? s.locations.find((l) => l.kind === 'store')?.id ?? s.locations[0].id
    return {
      thinking: tr('Stock correction for {0} at {1}.', item.name, locName(loc)),
      calls: [{ name: 'prepare_adjustment', input: counted ? { item: item.id, location: loc, new_qty: n, reason: tr('Recount') } : { item: item.id, location: loc, delta: -n, reason: raw.slice(0, 120) } }],
      reply: (r) => (r[0].result?.status === 'awaiting_approval' ? tr('Prepared the correction — approve it to update the stock and keep the audit trail.') : r[0].summary),
    }
  }

  // Price changes
  if (item && n != null && has(t, 'price', 'preco', 'pvp')) {
    return {
      thinking: tr('Price change for {0}.', item.name),
      calls: [{ name: 'prepare_item_update', input: { item: item.id, price: n } }],
      reply: () => tr('Prepared the new price for {0}. Approve it and it applies everywhere, including labels and margins.', item.name),
    }
  }

  // Purchase orders
  if (has(t, 'draft', 'prepare', 'order from', 'reorder from', 'encomenda', 'po for', 'place an order', 'make an order', 'create order', 'create a po')) {
    if (sup) {
      return {
        thinking: tr('Building an order for {0} from demand, lead time ({1} days) and the review period.', sup.name, sup.leadTimeDays),
        calls: [{ name: 'prepare_purchase_order', input: { supplier: sup.id, auto_fill: true } }],
        reply: (r) => (r[0].result?.status === 'awaiting_approval' ? tr('Here’s the order for {0}. Approve it to save it as a draft you can email from the order page.', sup.name) : r[0].result?.status === 'nothing_to_order' ? tr('Nothing from {0} needs ordering right now — everything is covered past their next delivery.', sup.name) : r[0].summary),
      }
    }
    const { stats } = derive(s)
    const supIds = Array.from(new Set(stats.filter((x) => (x.status === 'low' || x.status === 'critical' || x.status === 'out') && x.item.supplierId && !x.item.tags.includes('daily')).map((x) => x.item.supplierId!))).slice(0, 3)
    if (supIds.length)
      return {
        thinking: (supIds.length > 1 ? tr('Grouping everything that needs reordering by supplier — {0} suppliers.', supIds.length) : tr('Grouping everything that needs reordering by supplier — {0} supplier.', supIds.length)),
        calls: supIds.map((id) => ({ name: 'prepare_purchase_order' as const, input: { supplier: id, auto_fill: true } })),
        reply: (r) => (r.length > 1 ? tr('I prepared {0} purchase orders, one per supplier, sized to cover lead time plus a week. Approve the ones you want — they’re saved as drafts.', r.filter((x) => x.result?.status === 'awaiting_approval').length) : tr('I prepared {0} purchase order, one per supplier, sized to cover lead time plus a week. Approve the ones you want — they’re saved as drafts.', r.filter((x) => x.result?.status === 'awaiting_approval').length)),
      }
  }

  // Forecast
  if (item && has(t, 'forecast', 'run out', 'last', 'previs', 'acabar', 'esgot', 'when will', 'how long')) {
    return {
      thinking: tr('Projecting {0} day by day with weekday patterns, holidays and incoming orders.', item.name),
      calls: [{ name: 'forecast', input: { item: item.id, days: 28 } }],
      reply: (r) => {
        const f = r[0].result
        if (!f || f.error) return r[0].summary
        return f.projected_stockout
          ? tr('At the current pace {0} runs out around {1}. I expect about {2} units over the next four weeks{3}. Want me to prepare an order?', item.name, f.projected_stockout, f.total_forecast_units, f.holidays?.length ? tr(', with a bump around {0}', f.holidays[0].split(' ').slice(1).join(' ')) : '')
          : tr('{0} is covered for the next four weeks — about {1} units of demand{2}.', item.name, f.total_forecast_units, f.incoming?.length ? tr(', plus {0} delivery on the way', f.incoming.length) : '')
      },
    }
  }

  // Item question
  if (item && !has(t, 'widget')) {
    return {
      thinking: tr('Looking up {0}.', item.name),
      calls: [{ name: 'get_item', input: { item: item.id } }],
      reply: (r) => {
        const x = r[0].result
        if (!x || x.error) return r[0].summary
        const where = Object.entries(x.by_location as Record<string, number>)
          .filter(([, q]) => q > 0)
          .map(([k, q]) => `${fmtQty(q, x.unit)} at ${k}`)
          .join(', ')
        return tr('You have {0} of {1}{2}. It sells about {3}/day, so that’s {4}{5}. Status: {6}.', fmtQty(x.on_hand, x.unit), x.name, where ? ` — ${where}` : '', x.sold_per_day, x.days_of_cover == null ? tr('no recent demand') : tr('{0} days of cover', x.days_of_cover), x.on_order ? tr(', with {0} on order', x.on_order) : '', x.status.toLowerCase())
      },
    }
  }

  if (has(t, 'expir', 'validade', 'expire', 'perto do fim')) {
    return { thinking: tr('Checking lots against their expiry dates and expected sales.'), calls: [{ name: 'list_items', input: { status: 'expiring' } }], reply: (r) => (r[0].result?.count ? tr('{0} lots expire soon. The ones at the top won’t sell in time at normal pace — a markdown now recovers most of the value.', r[0].result.count) : tr('Nothing is close to expiring.')) }
  }
  if (has(t, 'dead', 'not moving', 'parado', 'slow', 'nao vende', 'stuck')) {
    return { thinking: tr('Finding stock that hasn’t sold for the dead-stock window.'), calls: [{ name: 'run_report', input: { report: 'dead_stock' } }], reply: (r) => (r[0].result?.total_value ? tr('{0} is sitting in items that stopped selling. Bundling them with fast movers or a 25% clearance usually frees most of it within two weeks.', eur(r[0].result.total_value, { decimals: 0 })) : tr('Everything is moving — no dead stock right now.')) }
  }
  if (has(t, 'best', 'top', 'selling', 'mais vend')) {
    return { thinking: tr('Ranking items by revenue this week.'), calls: [{ name: 'list_items', input: { status: 'top', limit: 8 } }], reply: () => tr('These are your best sellers this week, by revenue.') }
  }
  if (has(t, 'margin', 'margem')) {
    return { thinking: tr('Computing net revenue and cost of goods by category.'), calls: [{ name: 'run_report', input: { report: 'margin' } }], reply: () => tr('Gross margin by category over the last 30 days, before VAT.') }
  }
  if (has(t, 'abc')) {
    return { thinking: tr('Classifying items by share of revenue.'), calls: [{ name: 'run_report', input: { report: 'abc' } }], reply: () => tr('A-items bring 80% of revenue — those deserve the tightest counts and safety stock.') }
  }
  if (has(t, 'valuation', 'worth', 'stock value', 'valor do stock', 'how much stock')) {
    return { thinking: tr('Valuing stock at cost by category and by location.'), calls: [{ name: 'run_report', input: { report: 'valuation' } }], reply: () => tr('Stock is valued at cost (weighted average). Retail value is higher — {0} at current prices.', eur(kpis(s).retailValue, { decimals: 0 })) }
  }
  if (has(t, 'supplier', 'fornecedor')) {
    return { thinking: tr('Listing suppliers with lead times and minimums.'), calls: [{ name: 'list_suppliers', input: {} }], reply: () => tr('Here are your suppliers. Ask me to prepare an order for any of them.') }
  }
  if (has(t, 'deliver', 'incoming', 'arriv', 'purchase order', 'orders', 'entregas', 'encomendas')) {
    return { thinking: tr('Checking open purchase orders.'), calls: [{ name: 'list_orders', input: { status: 'open' } }], reply: (r) => (r[0].result?.orders?.length ? tr('These orders are open. Receive any of them from Receive when the van arrives.') : tr('No open orders.')) }
  }
  if (has(t, 'count', 'contagem', 'inventario', 'stocktake')) {
    const loc = locs[0] ?? s.locations.find((l) => l.isDefault)?.id ?? s.locations[0].id
    return { thinking: tr('Setting up a count at {0} with the items that most need it.', locName(loc)), calls: [{ name: 'start_count', input: { location: loc } }], reply: (r) => (r[0].result?.status === 'started' ? tr('Started a count with {0} items. Open it on your phone and scan as you go — nothing changes until you close it.', r[0].result.items) : r[0].summary) }
  }
  if (has(t, 'low', 'reorder', 'running out', 'falta', 'acabar', 'what should i order', 'need to order', 'what to buy', 'comprar')) {
    return {
      thinking: tr('Comparing every item’s stock with its demand and its supplier’s lead time.'),
      calls: [
        { name: 'list_items', input: { status: 'out' } },
        { name: 'list_items', input: { status: 'critical' } },
        { name: 'list_items', input: { status: 'low' } },
      ],
      reply: (r) => {
        const [o, c, l] = r.map((x) => x.result?.count ?? 0)
        if (!o && !c && !l) return tr('Nothing needs reordering — every item is covered past its next delivery.')
        return tr('{0}{1} critical and {2} past the reorder point. Say “draft the orders” and I’ll prepare one purchase order per supplier.', o ? tr('{0} out of stock, ', o) : '', c, l)
      },
    }
  }
  if (has(t, 'how are we', 'overview', 'summary', 'resumo', 'como estamos', 'brief', 'today', 'hoje', 'status', 'how is', 'what needs', 'what’s up', 'whats up')) {
    const b = morningBrief(s)
    return {
      thinking: tr('Pulling the big picture: health, sales, risks and what is waiting for approval.'),
      calls: [{ name: 'stock_overview', input: {} }],
      reply: () => tr('Stock health is {0}/100. {1}', b.health, b.lines.map((l) => l.text).join(' ')),
    }
  }
  if (has(t, 'hello', 'hi ', 'hey', 'ola', 'olá', 'bom dia', 'boa tarde', 'help', 'ajuda', 'what can you do') || t.length < 4) {
    return {
      thinking: '',
      calls: [],
      reply: () =>
        tr('I’m Operator. I watch your stock and prepare the work — you approve it. Try “what’s running low?”, “draft the orders”, “move 10 capsules from Bonfim to Príncipe Real”, “when will Alvarinho run out?” or “add a sales trend widget”.'),
    }
  }
  // Fallback: search
  const query = normalize(raw)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .flatMap((w) => SYNONYMS[w] ?? [w])
    .join(' ')
  return {
    thinking: tr('Searching the catalogue for that.'),
    calls: [{ name: 'search_items', input: { query: (query || raw).slice(0, 60) } }],
    reply: (r) => (r[0].result?.matches?.length ? tr('Here’s what I found in your catalogue.') : tr('I’m not sure what you mean. Try asking about an item, a supplier, what’s running low, or what to order.')),
  }
}
