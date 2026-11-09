import type { Snapshot } from '~/lib/types'
import { derive, kpis, morningBrief } from '~/lib/analytics'
import { eur, qty as fmtQty } from '~/lib/format'
import { normalize } from '~/lib/utils'
import type { ToolName } from './schema'

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
      thinking: 'They want a new widget on the dashboard. Picking the closest widget type and placing it at the end.',
      calls: [{ name: 'add_widget', input: { type, metric: type === 'kpi' ? metric : undefined, item: type === 'itemForecast' ? item?.id : undefined, title: undefined } }],
      reply: (r) => (r[0].result?.status === 'added' ? `Done — added it to ${r[0].result.dashboard}. Drag it wherever you like, or open Customise to resize it.` : `I couldn’t add that widget: ${r[0].summary}`),
    }
  }

  // Transfers
  if (has(t, 'move ', 'transfer', 'transferir', 'mover', 'passar') && item && locs.length >= 2 && n) {
    return {
      thinking: `Transfer ${n} of ${item.name} from ${locName(locs[0])} to ${locName(locs[1])}. Checking what’s available first.`,
      calls: [{ name: 'prepare_transfer', input: { item: item.id, from: locs[0], to: locs[1], qty: n } }],
      reply: (r) => (r[0].result?.status === 'awaiting_approval' ? `I’ve prepared the transfer. Approve it and both locations update straight away.` : r[0].result?.status === 'applied_automatically' ? 'Done — it was within your auto-approve limit, so I recorded the transfer.' : r[0].summary),
    }
  }

  // Corrections
  if (item && n != null && has(t, 'broke', 'broken', 'damaged', 'partiu', 'partid', 'stolen', 'lost', 'expired', 'spoiled', 'recount', 'counted', 'contei', 'quebr')) {
    const counted = has(t, 'counted', 'recount', 'contei')
    const loc = locs[0] ?? s.locations.find((l) => l.kind === 'store')?.id ?? s.locations[0].id
    return {
      thinking: `Stock correction for ${item.name} at ${locName(loc)}.`,
      calls: [{ name: 'prepare_adjustment', input: counted ? { item: item.id, location: loc, new_qty: n, reason: 'Recount' } : { item: item.id, location: loc, delta: -n, reason: raw.slice(0, 120) } }],
      reply: (r) => (r[0].result?.status === 'awaiting_approval' ? 'Prepared the correction — approve it to update the stock and keep the audit trail.' : r[0].summary),
    }
  }

  // Price changes
  if (item && n != null && has(t, 'price', 'preco', 'pvp')) {
    return {
      thinking: `Price change for ${item.name}.`,
      calls: [{ name: 'prepare_item_update', input: { item: item.id, price: n } }],
      reply: () => `Prepared the new price for ${item.name}. Approve it and it applies everywhere, including labels and margins.`,
    }
  }

  // Purchase orders
  if (has(t, 'draft', 'prepare', 'order from', 'reorder from', 'encomenda', 'po for', 'place an order', 'make an order', 'create order', 'create a po')) {
    if (sup) {
      return {
        thinking: `Building an order for ${sup.name} from demand, lead time (${sup.leadTimeDays} days) and the review period.`,
        calls: [{ name: 'prepare_purchase_order', input: { supplier: sup.id, auto_fill: true } }],
        reply: (r) => (r[0].result?.status === 'awaiting_approval' ? `Here’s the order for ${sup.name}. Approve it to save it as a draft you can email from the order page.` : r[0].result?.status === 'nothing_to_order' ? `Nothing from ${sup.name} needs ordering right now — everything is covered past their next delivery.` : r[0].summary),
      }
    }
    const { stats } = derive(s)
    const supIds = Array.from(new Set(stats.filter((x) => (x.status === 'low' || x.status === 'critical' || x.status === 'out') && x.item.supplierId && !x.item.tags.includes('daily')).map((x) => x.item.supplierId!))).slice(0, 3)
    if (supIds.length)
      return {
        thinking: `Grouping everything that needs reordering by supplier — ${supIds.length} supplier${supIds.length > 1 ? 's' : ''}.`,
        calls: supIds.map((id) => ({ name: 'prepare_purchase_order' as const, input: { supplier: id, auto_fill: true } })),
        reply: (r) => `I prepared ${r.filter((x) => x.result?.status === 'awaiting_approval').length} purchase order${r.length > 1 ? 's' : ''}, one per supplier, sized to cover lead time plus a week. Approve the ones you want — they’re saved as drafts.`,
      }
  }

  // Forecast
  if (item && has(t, 'forecast', 'run out', 'last', 'previs', 'acabar', 'esgot', 'when will', 'how long')) {
    return {
      thinking: `Projecting ${item.name} day by day with weekday patterns, holidays and incoming orders.`,
      calls: [{ name: 'forecast', input: { item: item.id, days: 28 } }],
      reply: (r) => {
        const f = r[0].result
        if (!f || f.error) return r[0].summary
        return f.projected_stockout
          ? `At the current pace ${item.name} runs out around ${f.projected_stockout}. I expect about ${f.total_forecast_units} units over the next four weeks${f.holidays?.length ? `, with a bump around ${f.holidays[0].split(' ').slice(1).join(' ')}` : ''}. Want me to prepare an order?`
          : `${item.name} is covered for the next four weeks — about ${f.total_forecast_units} units of demand${f.incoming?.length ? `, plus ${f.incoming.length} delivery on the way` : ''}.`
      },
    }
  }

  // Item question
  if (item && !has(t, 'widget')) {
    return {
      thinking: `Looking up ${item.name}.`,
      calls: [{ name: 'get_item', input: { item: item.id } }],
      reply: (r) => {
        const x = r[0].result
        if (!x || x.error) return r[0].summary
        const where = Object.entries(x.by_location as Record<string, number>)
          .filter(([, q]) => q > 0)
          .map(([k, q]) => `${fmtQty(q, x.unit)} at ${k}`)
          .join(', ')
        return `You have ${fmtQty(x.on_hand, x.unit)} of ${x.name}${where ? ` — ${where}` : ''}. It sells about ${x.sold_per_day}/day, so that’s ${x.days_of_cover == null ? 'no recent demand' : `${x.days_of_cover} days of cover`}${x.on_order ? `, with ${x.on_order} on order` : ''}. Status: ${x.status.toLowerCase()}.`
      },
    }
  }

  if (has(t, 'expir', 'validade', 'expire', 'perto do fim')) {
    return { thinking: 'Checking lots against their expiry dates and expected sales.', calls: [{ name: 'list_items', input: { status: 'expiring' } }], reply: (r) => (r[0].result?.count ? `${r[0].result.count} lots expire soon. The ones at the top won’t sell in time at normal pace — a markdown now recovers most of the value.` : 'Nothing is close to expiring.') }
  }
  if (has(t, 'dead', 'not moving', 'parado', 'slow', 'nao vende', 'stuck')) {
    return { thinking: 'Finding stock that hasn’t sold for the dead-stock window.', calls: [{ name: 'run_report', input: { report: 'dead_stock' } }], reply: (r) => (r[0].result?.total_value ? `${eur(r[0].result.total_value, { decimals: 0 })} is sitting in items that stopped selling. Bundling them with fast movers or a 25% clearance usually frees most of it within two weeks.` : 'Everything is moving — no dead stock right now.') }
  }
  if (has(t, 'best', 'top', 'selling', 'mais vend')) {
    return { thinking: 'Ranking items by revenue this week.', calls: [{ name: 'list_items', input: { status: 'top', limit: 8 } }], reply: () => 'These are your best sellers this week, by revenue.' }
  }
  if (has(t, 'margin', 'margem')) {
    return { thinking: 'Computing net revenue and cost of goods by category.', calls: [{ name: 'run_report', input: { report: 'margin' } }], reply: () => 'Gross margin by category over the last 30 days, before VAT.' }
  }
  if (has(t, 'abc')) {
    return { thinking: 'Classifying items by share of revenue.', calls: [{ name: 'run_report', input: { report: 'abc' } }], reply: () => 'A-items bring 80% of revenue — those deserve the tightest counts and safety stock.' }
  }
  if (has(t, 'valuation', 'worth', 'stock value', 'valor do stock', 'how much stock')) {
    return { thinking: 'Valuing stock at cost by category and by location.', calls: [{ name: 'run_report', input: { report: 'valuation' } }], reply: () => `Stock is valued at cost (weighted average). Retail value is higher — ${eur(kpis(s).retailValue, { decimals: 0 })} at current prices.` }
  }
  if (has(t, 'supplier', 'fornecedor')) {
    return { thinking: 'Listing suppliers with lead times and minimums.', calls: [{ name: 'list_suppliers', input: {} }], reply: () => 'Here are your suppliers. Ask me to prepare an order for any of them.' }
  }
  if (has(t, 'deliver', 'incoming', 'arriv', 'purchase order', 'orders', 'entregas', 'encomendas')) {
    return { thinking: 'Checking open purchase orders.', calls: [{ name: 'list_orders', input: { status: 'open' } }], reply: (r) => (r[0].result?.orders?.length ? 'These orders are open. Receive any of them from Receive when the van arrives.' : 'No open orders.') }
  }
  if (has(t, 'count', 'contagem', 'inventario', 'stocktake')) {
    const loc = locs[0] ?? s.locations.find((l) => l.isDefault)?.id ?? s.locations[0].id
    return { thinking: `Setting up a count at ${locName(loc)} with the items that most need it.`, calls: [{ name: 'start_count', input: { location: loc } }], reply: (r) => (r[0].result?.status === 'started' ? `Started a count with ${r[0].result.items} items. Open it on your phone and scan as you go — nothing changes until you close it.` : r[0].summary) }
  }
  if (has(t, 'low', 'reorder', 'running out', 'falta', 'acabar', 'what should i order', 'need to order', 'what to buy', 'comprar')) {
    return {
      thinking: 'Comparing every item’s stock with its demand and its supplier’s lead time.',
      calls: [
        { name: 'list_items', input: { status: 'out' } },
        { name: 'list_items', input: { status: 'critical' } },
        { name: 'list_items', input: { status: 'low' } },
      ],
      reply: (r) => {
        const [o, c, l] = r.map((x) => x.result?.count ?? 0)
        if (!o && !c && !l) return 'Nothing needs reordering — every item is covered past its next delivery.'
        return `${o ? `${o} out of stock, ` : ''}${c} critical and ${l} past the reorder point. Say “draft the orders” and I’ll prepare one purchase order per supplier.`
      },
    }
  }
  if (has(t, 'how are we', 'overview', 'summary', 'resumo', 'como estamos', 'brief', 'today', 'hoje', 'status', 'how is', 'what needs', 'what’s up', 'whats up')) {
    const b = morningBrief(s)
    return {
      thinking: 'Pulling the big picture: health, sales, risks and what is waiting for approval.',
      calls: [{ name: 'stock_overview', input: {} }],
      reply: () => `Stock health is ${b.health}/100. ${b.lines.map((l) => l.text).join(' ')}`,
    }
  }
  if (has(t, 'hello', 'hi ', 'hey', 'ola', 'olá', 'bom dia', 'boa tarde', 'help', 'ajuda', 'what can you do') || t.length < 4) {
    return {
      thinking: '',
      calls: [],
      reply: () =>
        'I’m Operator. I watch your stock and prepare the work — you approve it. Try “what’s running low?”, “draft the orders”, “move 10 capsules from Bonfim to Príncipe Real”, “when will Alvarinho run out?” or “add a sales trend widget”.',
    }
  }
  // Fallback: search
  const query = normalize(raw)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .flatMap((w) => SYNONYMS[w] ?? [w])
    .join(' ')
  return {
    thinking: 'Searching the catalogue for that.',
    calls: [{ name: 'search_items', input: { query: (query || raw).slice(0, 60) } }],
    reply: (r) => (r[0].result?.matches?.length ? 'Here’s what I found in your catalogue.' : 'I’m not sure what you mean. Try asking about an item, a supplier, what’s running low, or what to order.'),
  }
}
