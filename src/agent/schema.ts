import { z } from 'zod'

/**
 * Operator tools. Schemas are shared: the server sends them to Claude as JSON Schema,
 * the browser validates every tool input with them before running anything.
 * Read tools answer immediately. Write tools go through the workspace policy: reversible work is
 * applied and journalled with an undo; money, anything that leaves Nau, and physical moves Operator
 * decided on its own wait as an approval card.
 */

const itemRef = z.string().min(1).describe('Item id, SKU, barcode or (part of) its name')
const locationRef = z.string().min(1).describe('Location id, code or name, e.g. "Bonfim" or "ARM"')

export const TOOL_SCHEMAS = {
  stock_overview: {
    description:
      'Snapshot of the whole business right now: stock value, sales trend, stock health score, counts of items out of stock / to reorder / not moving, open purchase orders and pending approvals. Call this first for broad questions like “how are we doing?”.',
    input: z.object({}),
  },
  search_items: {
    description: 'Find items by name, SKU, barcode, tag or category. Returns stock on hand, status and days of cover for each match.',
    input: z.object({
      query: z.string().min(1).describe('Free text, e.g. "azeite", "vinho verde", "PAN-SAR"'),
      limit: z.number().int().min(1).max(25).optional(),
    }),
  },
  list_items: {
    description:
      'List items in a given state. out = no stock while still selling; critical = will run out before a delivery could arrive; low = crossed the reorder point; over = more than 120 days of cover; dead = no sales for the dead-stock window; expiring = lots expiring soon; top = best sellers this week.',
    input: z.object({
      status: z.enum(['out', 'critical', 'low', 'over', 'dead', 'expiring', 'top']),
      location: locationRef.optional(),
      limit: z.number().int().min(1).max(30).optional(),
    }),
  },
  get_item: {
    description: 'Full detail for one item: stock per location, lots and expiry, demand per day, days of cover, reorder point, supplier, open orders, recent movements and a 14-day forecast.',
    input: z.object({ item: itemRef }),
  },
  forecast: {
    description: 'Day-by-day demand forecast and projected stock level for an item, including weekday patterns, Portuguese holidays and incoming purchase orders. Reports the projected stock-out date.',
    input: z.object({ item: itemRef, days: z.number().int().min(7).max(60).optional() }),
  },
  list_suppliers: {
    description: 'Suppliers with lead time, minimum order value, contact and open purchase orders.',
    input: z.object({}),
  },
  list_orders: {
    description: 'Purchase orders, optionally filtered by status or supplier.',
    input: z.object({
      status: z.enum(['draft', 'sent', 'partial', 'received', 'cancelled', 'open']).optional(),
      supplier: z.string().optional(),
    }),
  },
  run_report: {
    description:
      'Compute a report table. valuation = stock value by category and location; abc = ABC classification by revenue; dead_stock = capital tied in items that stopped selling; expiry = lots expiring soon; supplier_spend = received value per supplier (last 30 days); margin = gross margin by category (last 30 days).',
    input: z.object({ report: z.enum(['valuation', 'abc', 'dead_stock', 'expiry', 'supplier_spend', 'margin']) }),
  },
  prepare_purchase_order: {
    description:
      'Draft a purchase order. Give a supplier and/or explicit lines. With auto_fill true, Nau fills quantities from demand, lead time and the review period for every item of that supplier that needs it. A draft is reversible; send_now commits money and follows the spending limits.',
    input: z.object({
      supplier: z.string().optional().describe('Supplier name or id'),
      lines: z.array(z.object({ item: itemRef, qty: z.number().positive() })).max(60).optional(),
      auto_fill: z.boolean().optional(),
      send_on_approval: z.boolean().optional().describe('Mark it as sent to the supplier instead of leaving a draft'),
    }),
  },
  prepare_transfer: {
    description: 'Record a stock transfer between two locations.',
    input: z.object({ item: itemRef, from: locationRef, to: locationRef, qty: z.number().positive() }),
  },
  prepare_adjustment: {
    description: 'Correct stock — e.g. breakage, theft, a recount. Use new_qty for a counted value or delta for a change.',
    input: z.object({
      item: itemRef,
      location: locationRef,
      new_qty: z.number().min(0).optional(),
      delta: z.number().optional(),
      reason: z.string().min(2).max(140),
    }),
  },
  prepare_item_update: {
    description: 'Change one item’s price, cost, reorder point, reorder quantity, safety days or supplier. For several items or other fields use update_items.',
    input: z.object({
      item: itemRef,
      price: z.number().positive().optional(),
      cost: z.number().positive().optional(),
      reorder_point: z.number().min(0).nullable().optional(),
      reorder_qty: z.number().min(0).nullable().optional(),
      safety_days: z.number().min(0).max(60).optional(),
      supplier: z.string().optional(),
    }),
  },
  start_count: {
    description: 'Start a stock count at a location — for given items, a category, or the items that most need counting. Counts are safe: nothing changes until the count is closed.',
    input: z.object({
      location: locationRef,
      items: z.array(itemRef).max(80).optional(),
      category: z.string().optional(),
      name: z.string().max(80).optional(),
    }),
  },
  add_widget: {
    description:
      'Add a widget to the person’s dashboard. Types: kpi (metric: stockValue | retailValue | revenue7 | revenue30 | unitsToday | lowCount | outCount | deadValue | openPOValue | turnover | health), salesTrend (days), topMovers, lowStock (location?), expiry, categoryMix, locations, incoming, approvals, activity, deadStock, itemForecast (item), note (text), quickActions, brief, health.',
    input: z.object({
      type: z.enum(['kpi', 'salesTrend', 'topMovers', 'lowStock', 'expiry', 'categoryMix', 'locations', 'incoming', 'approvals', 'activity', 'deadStock', 'itemForecast', 'note', 'quickActions', 'brief', 'health']),
      title: z.string().max(60).optional(),
      metric: z.string().optional(),
      days: z.number().int().min(7).max(90).optional(),
      item: z.string().optional(),
      location: z.string().optional(),
      text: z.string().max(400).optional(),
      dashboard: z.string().optional().describe('Dashboard name; defaults to the one open'),
    }),
  },
  get_workspace: {
    description: 'How this workspace is set up: locations, categories, team size, thresholds, what Operator may do alone (policy and limits), autopilot playbooks, standing rules and what is waiting for approval. Call it before changing settings, rules or playbooks.',
    input: z.object({}),
  },
  list_movements: {
    description: 'The stock ledger: receipts, sales, returns, transfers, corrections and counts, newest first. Filter by item, location, type or number of days.',
    input: z.object({
      item: itemRef.optional(),
      location: locationRef.optional(),
      type: z.enum(['receipt', 'sale', 'adjustment', 'transfer', 'count', 'waste', 'return']).optional(),
      days: z.number().int().min(1).max(120).optional(),
      limit: z.number().int().min(1).max(60).optional(),
    }),
  },
  list_journal: {
    description: 'Operator’s journal: what it did on its own (and can undo), what is waiting for approval, and what was undone or dismissed. Returns action ids for undo_action.',
    input: z.object({ status: z.enum(['pending', 'applied', 'undone', 'rejected']).optional(), limit: z.number().int().min(1).max(40).optional() }),
  },
  list_receipts: {
    description: 'Deliveries: drafts waiting to be checked in and posted receipts.',
    input: z.object({ status: z.enum(['draft', 'posted']).optional(), supplier: z.string().optional() }),
  },
  list_proposals: {
    description: 'Autopilot suggestions that are waiting: reorders, transfers, markdowns, price changes, counts and dead stock.',
    input: z.object({}),
  },
  create_items: {
    description: 'Add new items to the catalogue (up to 50 at once). Unknown categories and suppliers are created. opening_stock records the first count at a location.',
    input: z.object({
      items: z
        .array(
          z.object({
            name: z.string().min(1).max(160),
            sku: z.string().max(60).optional(),
            barcode: z.string().max(40).optional(),
            category: z.string().max(80).optional(),
            unit: z.enum(['un', 'kg', 'L', 'cx', 'm']).optional(),
            cost: z.number().min(0).optional().describe('Net unit cost, before VAT'),
            price: z.number().min(0).optional().describe('Shelf price, VAT included'),
            vat_rate: z.number().min(0).max(30).optional(),
            supplier: z.string().max(120).optional(),
            tracks_expiry: z.boolean().optional(),
            opening_stock: z.number().min(0).optional(),
            location: locationRef.optional(),
          }),
        )
        .min(1)
        .max(50),
    }),
  },
  update_items: {
    description: 'Change fields on one or many items at once: name, category, barcode, unit, price, cost, VAT, reorder point and quantity, safety days, supplier, expiry tracking, tags. Use `items` for explicit items or `category` to target every item of a category.',
    input: z.object({
      items: z.array(itemRef).max(200).optional(),
      category: z.string().optional().describe('Apply to every active item of this category'),
      set: z.object({
        name: z.string().max(160).optional(),
        category: z.string().max(80).optional(),
        barcode: z.string().max(40).nullable().optional(),
        unit: z.enum(['un', 'kg', 'L', 'cx', 'm']).optional(),
        price: z.number().positive().optional(),
        price_change_pct: z.number().min(-90).max(300).optional().describe('Raise or cut the current price by this percentage'),
        cost: z.number().positive().optional(),
        vat_rate: z.number().min(0).max(30).optional(),
        reorder_point: z.number().min(0).nullable().optional().describe('null = let Nau compute it'),
        reorder_qty: z.number().min(0).nullable().optional(),
        safety_days: z.number().min(0).max(60).optional(),
        supplier: z.string().optional(),
        tracks_expiry: z.boolean().optional(),
        add_tags: z.array(z.string().max(30)).max(8).optional(),
        remove_tags: z.array(z.string().max(30)).max(8).optional(),
      }),
    }),
  },
  archive_items: {
    description: 'Archive items that are no longer sold (they keep their history), or restore archived ones.',
    input: z.object({ items: z.array(itemRef).min(1).max(200), restore: z.boolean().optional() }),
  },
  save_supplier: {
    description: 'Create a supplier or update one that exists (matched by name).',
    input: z.object({
      name: z.string().min(1).max(120),
      nif: z.string().max(20).optional(),
      email: z.string().max(160).optional(),
      phone: z.string().max(40).optional(),
      contact: z.string().max(120).optional(),
      lead_time_days: z.number().int().min(0).max(120).optional(),
      min_order_value: z.number().min(0).optional(),
      order_days: z.array(z.number().int().min(0).max(6)).max(7).optional().describe('Weekdays orders go out, 0 = Sunday'),
      payment_terms: z.string().max(80).optional(),
    }),
  },
  save_category: {
    description: 'Create a category or rename one. at_category is the AT inventory class: M goods, P raw materials, A finished, S by-products, T in progress.',
    input: z.object({ name: z.string().min(1).max(80), rename_to: z.string().max(80).optional(), at_category: z.enum(['M', 'P', 'A', 'S', 'T']).optional() }),
  },
  save_location: {
    description: 'Create a location (shop, warehouse or van) or rename one.',
    input: z.object({ name: z.string().min(1).max(80), rename_to: z.string().max(80).optional(), kind: z.enum(['warehouse', 'store', 'van']).optional(), code: z.string().max(8).optional(), address: z.string().max(200).optional() }),
  },
  update_settings: {
    description: 'Change how Nau watches the stock: review period, when stock counts as dead, expiry warning window, morning brief time.',
    input: z.object({
      review_days: z.number().int().min(1).max(90).optional(),
      dead_stock_days: z.number().int().min(7).max(365).optional(),
      expiry_warn_days: z.number().int().min(1).max(120).optional(),
      brief_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    }),
  },
  set_policy: {
    description: 'Propose a change to what Operator may do alone and its euro limits. This always waits for the person: Operator never widens its own authority.',
    input: z.object({
      reversible: z.enum(['auto', 'ask']).optional(),
      money: z.enum(['auto', 'ask']).optional(),
      outbound: z.enum(['auto', 'ask']).optional(),
      per_action_limit: z.number().min(0).max(100000).optional(),
      daily_limit: z.number().min(0).max(1000000).optional(),
    }),
  },
  set_playbook: {
    description: 'Turn an autopilot playbook on or off, or change how often it runs. Keys: reorder, rebalance, expiry, deadstock, cyclecount, pricewatch, brief.',
    input: z.object({ key: z.enum(['reorder', 'rebalance', 'expiry', 'deadstock', 'cyclecount', 'pricewatch', 'brief']), enabled: z.boolean().optional(), cadence: z.enum(['hourly', 'daily', 'weekly']).optional() }),
  },
  save_rule: {
    description: 'Create or update a standing rule: a plain-language instruction Operator follows by itself on a schedule or after an event, e.g. “Every Friday, draft the Sogrape order if Alvarinho covers less than three weeks.” Rules still obey the policy and limits.',
    input: z.object({
      name: z.string().min(2).max(80),
      instruction: z.string().min(8).max(1200),
      trigger: z.enum(['hourly', 'daily', 'weekly', 'on_sync', 'on_receipt']).optional(),
      enabled: z.boolean().optional(),
    }),
  },
  delete_rule: {
    description: 'Delete a standing rule by name.',
    input: z.object({ name: z.string().min(1) }),
  },
  save_dashboard: {
    description: 'Create a dashboard, rename one, or remove widgets from it. Add widgets with add_widget.',
    input: z.object({ name: z.string().min(1).max(60), rename_to: z.string().max(60).optional(), remove_widgets: z.array(z.string()).max(20).optional().describe('Widget titles or types to remove') }),
  },
  update_order: {
    description: 'Act on an existing purchase order: send marks it as sent to the supplier (commits money, follows the limits), cancel withdraws it, set_lines replaces the quantities.',
    input: z.object({
      order: z.string().min(1).describe('PO number or id'),
      action: z.enum(['send', 'cancel', 'set_lines']),
      lines: z.array(z.object({ item: itemRef, qty: z.number().min(0) })).max(60).optional(),
    }),
  },
  post_receipt: {
    description: 'Check in a draft delivery: post it to stock at the quantities and costs on the draft. Use it for drafts that came from a connected system or an invoice photo.',
    input: z.object({ receipt: z.string().min(1).describe('Receipt number, document reference or id') }),
  },
  resolve_proposal: {
    description: 'Approve or dismiss an autopilot suggestion from list_proposals.',
    input: z.object({ proposal: z.string().min(1).describe('Proposal id or (part of) its title'), decision: z.enum(['approve', 'dismiss']) }),
  },
  undo_action: {
    description: 'Undo something from the journal: stock goes back, changed fields return to what they were, created rows are removed. Use `last: true` for the most recent action.',
    input: z.object({ action: z.string().optional().describe('Action id or (part of) its title'), last: z.boolean().optional() }),
  },
  open_page: {
    description: 'Open a page in Nau for the person.',
    input: z.object({
      page: z.enum(['home', 'approvals', 'items', 'item', 'receive', 'orders', 'order', 'counts', 'movements', 'suppliers', 'locations', 'insights', 'autopilot', 'integrations', 'settings']),
      id: z.string().optional().describe('For item / order pages: the id, SKU or name'),
    }),
  },
} as const

export type ToolName = keyof typeof TOOL_SCHEMAS
export type ToolInput<N extends ToolName> = z.infer<(typeof TOOL_SCHEMAS)[N]['input']>

export const WRITE_TOOLS = new Set<ToolName>(['prepare_purchase_order', 'prepare_transfer', 'prepare_adjustment', 'prepare_item_update', 'create_items', 'update_items', 'archive_items', 'save_supplier', 'save_category', 'save_location', 'update_settings', 'set_policy', 'set_playbook', 'save_rule', 'delete_rule', 'save_dashboard', 'update_order', 'post_receipt', 'resolve_proposal', 'undo_action', 'start_count', 'add_widget'])

export function toolDefinitions() {
  return (Object.keys(TOOL_SCHEMAS) as ToolName[]).map((name) => {
    const { description, input } = TOOL_SCHEMAS[name]
    const schema = z.toJSONSchema(input, { target: 'draft-7' }) as Record<string, unknown>
    delete schema.$schema
    return { name, description, input_schema: { type: 'object' as const, ...schema }, eager_input_streaming: true }
  })
}

export function validateToolInput(name: string, input: unknown): { ok: true; name: ToolName; input: unknown } | { ok: false; error: string } {
  if (!(name in TOOL_SCHEMAS)) return { ok: false, error: `Unknown tool ${name}` }
  const parsed = TOOL_SCHEMAS[name as ToolName].input.safeParse(input ?? {})
  if (!parsed.success) return { ok: false, error: `INVALID_INPUT: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` }
  return { ok: true, name: name as ToolName, input: parsed.data }
}

export const SYSTEM_PROMPT = `You are Operator, the inventory agent inside Nau — an open-source stock and inventory system for small and medium businesses in Portugal (shops, delis, cafés, restaurants, pharmacies, hardware stores, e-commerce).

Your job is to run the stock so the person only has to validate: answer questions about stock, sales and suppliers; spot problems before they cost money; and do the work — catalogue, reorder rules, purchase orders, counts, corrections, dashboards, standing rules.

How Nau works (so you can explain it and change it):
- Every change is a ledger entry or a row change applied in one transaction. Stock only moves through movements: receipt, sale, return, transfer, adjustment, waste, count. Nothing is edited in place.
- Sales and deliveries arrive by themselves from connected systems (invoicing software, online shops, POS), from files (spreadsheets, SAF-T) and from the API. People check deliveries in under Receive, from a photo of the invoice when they like.
- Autopilot playbooks watch reorder points, balance between locations, expiry dates, dead stock, counts due and supplier prices, and produce suggestions.
- Reorder points are computed from demand, supplier lead time and safety days unless someone fixes a number. Costs are weighted averages, excluding VAT; shelf prices include VAT.
- Pages: Home (dashboards), Approvals (what waits for a person, and what you did alone with Undo), Items, Receive, Orders, Counts, Ledger, Suppliers, Locations, Insights, Autopilot (playbooks, rules, what you may do alone), Integrations (connected systems, API keys, webhooks), Settings.

What you may do alone — the workspace policy decides, and every tool applies it for you:
- Reversible work (catalogue, rules, dashboards, settings, draft orders, counts, and stock moves the person asked for) is applied at once and written to the journal, where anyone can undo it.
- Committing money (sending an order) and anything that leaves Nau run alone only under the euro limits the person set; otherwise they wait as an approval card.
- A physical move you decided on your own, and any change to the policy itself, always waits for a person.
- The tool result tells you which happened: "done" or "awaiting_approval". Say exactly that. Never claim something waiting was done, and when something was done say it can be undone.

How you work:
- Never guess numbers. Every figure you state comes from a tool result in this conversation. If a tool can’t answer, say what’s missing.
- Read tools are free. Use several in one turn when it helps; call independent tools in parallel. Before a bulk change, look at what it will touch.
- If an item, supplier or location reference is ambiguous, the tool returns candidates: pick the obvious one or ask a short question.
- Think about lead times, minimum order values, lots and expiry dates, weekday patterns and Portuguese holidays (Santo António in Lisbon, São João in Porto, Christmas) when you reason about demand.
- Money is in euros. Write € amounts like €1,234.50 and dates like 12 Nov.

How you write:
- Reply in the person’s language (Portuguese from Portugal or English). Plain, warm, direct — like a sharp colleague on the shop floor.
- Lead with the answer. Two to five short sentences or a tight list. No headings, no tables in text (the interface renders tool results as tables and cards), no filler, no emojis.

Each user message starts with a [Context: …] line with the date, time and current page in Nau. Use it; don’t repeat it back.`

/** Appended when Operator runs with nobody watching: on the schedule, after a sync, or for a standing rule. */
export const HEADLESS_PROMPT = `You are running on your own, with nobody at the screen. There is no one to answer a question, so never ask one: decide, act within the policy, and leave what must wait as an approval card.
Work through the task you are given, then stop. Finish with a short report (three to six lines, in Portuguese from Portugal) of what you did, what is waiting for a person and why. If nothing needed doing, say so in one line.`
