import type { Category, Dashboard, Item, Location, Policy, PurchaseOrder, Rule, Snapshot, Supplier } from '~/lib/types'
import { date, eur, qty as fmtQty, relative } from '~/lib/format'
import { fuzzyScore, indexBy, normalize, round, stableId, sum, uid } from '~/lib/utils'
import { mergeChangeSets, type ChangeSet } from '~/data/changeset'
import { approveProposal, archiveItems, cancelPO, dismissProposal, event, postReceipt, sendPO } from '~/data/commands'
import { ingest } from '~/ingest/ingest'
import type { ToolName } from './schema'
import type { ExecContext, ToolExec } from './types'
import { policyOf, spentToday, undoAction } from './policy'
import { fail, propose, resolveItem, resolveLocation, resolveSupplier } from './executors'
import { tr } from '~/i18n'

export const ADMIN_TOOLS = new Set<ToolName>([
  'get_workspace', 'list_movements', 'list_journal', 'list_receipts', 'list_proposals',
  'create_items', 'update_items', 'archive_items', 'save_supplier', 'save_category', 'save_location',
  'update_settings', 'set_policy', 'set_playbook', 'save_rule', 'delete_rule', 'save_dashboard',
  'update_order', 'post_receipt', 'resolve_proposal', 'undo_action',
])

const same = (a: string, b: string) => normalize(a) === normalize(b)
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ')

/** Proposal kinds that describe something a person has to do with their hands or on the shop floor. */
const HANDS: Record<string, string> = {
  transfer: tr('Someone has to move the stock — confirm once it’s done'),
  markdown: tr('The discount goes on the shelf — confirm when the labels are up'),
  price: tr('Shelf labels and tills change with the price — confirm it'),
}

export function executeAdmin(name: ToolName, input: Record<string, any>, ctx: ExecContext): ToolExec {
  const s = ctx.snapshot
  const items = indexBy(s.items, (x) => x.id)
  const locations = indexBy(s.locations, (x) => x.id)
  const suppliers = indexBy(s.suppliers, (x) => x.id)

  switch (name) {
    /* ───────────── Reading the platform ───────────── */

    case 'get_workspace': {
      const p = policyOf(s.workspace.settings)
      const st = s.workspace.settings
      return {
        result: {
          name: s.workspace.name,
          sector: s.workspace.sector,
          region: s.workspace.region,
          nif: s.workspace.nif ?? null,
          locations: s.locations.map((l) => ({ name: l.name, code: l.code, kind: l.kind, default: !!l.isDefault })),
          categories: s.categories.map((c) => c.name),
          team: s.members.length,
          active_items: s.items.filter((i) => !i.archived).length,
          suppliers: s.suppliers.length,
          thresholds: { review_days: st.reviewDays, dead_stock_days: st.deadStockDays, expiry_warn_days: st.expiryWarnDays, brief_time: st.briefTime },
          policy: { reversible: p.reversible, money: p.money, outbound: p.outbound, per_action_limit_eur: p.perActionLimit, daily_limit_eur: p.dailyLimit, spent_alone_today_eur: round(spentToday(s)) },
          playbooks: s.playbooks.map((x) => ({ key: x.key, name: x.name, enabled: x.enabled, cadence: x.cadence, last_run: x.lastRunAt ?? null })),
          rules: s.rules.map((r) => ({ name: r.name, trigger: r.trigger, enabled: r.enabled, instruction: r.instruction, last_run: r.lastRunAt ?? null, last_result: r.lastResult ?? null })),
          waiting_for_a_person: { suggestions: s.proposals.filter((x) => x.status === 'pending').length, operator_actions: s.actions.filter((a) => a.status === 'pending').length },
        },
        summary: (s.locations.length === 1 ? s.rules.length === 1 ? tr('{0} · {1} location · {2} rule', s.workspace.name, s.locations.length, s.rules.length) : tr('{0} · {1} location · {2} rules', s.workspace.name, s.locations.length, s.rules.length) : s.rules.length === 1 ? tr('{0} · {1} locations · {2} rule', s.workspace.name, s.locations.length, s.rules.length) : tr('{0} · {1} locations · {2} rules', s.workspace.name, s.locations.length, s.rules.length)),
      }
    }

    case 'list_movements': {
      let list = s.movements
      if (input.item) {
        const r = resolveItem(s, input.item)
        if (!r.ok) return fail(r.error, r.candidates)
        list = list.filter((m) => m.itemId === r.value.id)
      }
      if (input.location) {
        const r = resolveLocation(s, input.location)
        if (!r.ok) return fail(r.error, r.candidates)
        list = list.filter((m) => m.locationId === r.value.id)
      }
      if (input.type) list = list.filter((m) => m.type === input.type)
      if (input.days) {
        const since = new Date(Date.now() - input.days * 86400000).toISOString()
        list = list.filter((m) => m.createdAt >= since)
      }
      const rows = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, input.limit ?? 20).map((m) => ({ when: when(m.createdAt), type: m.type, item: items[m.itemId]?.name ?? '—', qty: m.qty, location: locations[m.locationId]?.name ?? '', ref: m.ref ?? m.note ?? '', by: m.actor.name }))
      return {
        result: { total_matching: list.length, net_quantity: round(sum(list.map((m) => m.qty)), 3), movements: rows },
        summary: (list.length === 1 ? tr('{0} movement', list.length) : tr('{0} movements', list.length)),
        view: rows.length ? { kind: 'table', title: tr('Ledger'), columns: [{ key: 'when', label: tr('When') }, { key: 'type', label: tr('Type') }, { key: 'item', label: tr('Item') }, { key: 'qty', label: tr('Qty'), format: 'qty', align: 'right' }, { key: 'location', label: tr('Where') }, { key: 'by', label: tr('By') }], rows } : undefined,
      }
    }

    case 'list_journal': {
      const list = s.actions.filter((a) => !input.status || a.status === input.status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, input.limit ?? 15)
      const rows = list.map((a) => ({ id: a.id, title: a.title, status: a.status, risk: a.risk, value: a.impactEur ?? null, when: relative(a.createdAt), source: a.source, can_undo: a.status === 'applied' && !!a.undo, reason: a.reason ?? '' }))
      return {
        result: { actions: rows },
        summary: (rows.length === 1 ? tr('{0} journal entry', rows.length) : tr('{0} journal entries', rows.length)),
        view: rows.length ? { kind: 'table', title: tr('Operator’s journal'), columns: [{ key: 'title', label: tr('Action') }, { key: 'status', label: tr('Status') }, { key: 'value', label: tr('Value'), format: 'eur', align: 'right' }, { key: 'when', label: tr('When') }], rows: rows.map(({ can_undo: _c, ...r }) => r) } : undefined,
      }
    }

    case 'list_receipts': {
      let list = s.receipts.filter((r) => !input.status || r.status === input.status)
      if (input.supplier) {
        const r = resolveSupplier(s, input.supplier)
        if (r.ok) list = list.filter((x) => x.supplierId === r.value.id)
      }
      const rows = list.slice(0, 20).map((r) => ({ number: r.number, document: r.docRef ?? '', supplier: suppliers[r.supplierId ?? '']?.name ?? '—', status: r.status, date: r.docDate, lines: r.lines.length, value: round(sum(r.lines.map((l) => l.qty * l.unitCost))), source: r.source }))
      return {
        result: { receipts: rows },
        summary: (rows.length === 1 ? tr('{0} delivery', rows.length) : tr('{0} deliveries', rows.length)),
        view: rows.length ? { kind: 'table', title: tr('Deliveries'), columns: [{ key: 'number', label: tr('Receipt') }, { key: 'supplier', label: tr('Supplier') }, { key: 'status', label: tr('Status') }, { key: 'date', label: tr('Date') }, { key: 'value', label: tr('Value'), format: 'eur', align: 'right' }], rows } : undefined,
      }
    }

    case 'list_proposals': {
      const rows = s.proposals.filter((p) => p.status === 'pending').map((p) => ({ id: p.id, kind: p.kind, title: p.title, summary: p.summary, value: p.impactEur ?? null, why: p.rationale.slice(0, 3) }))
      return {
        result: { suggestions: rows },
        summary: rows.length ? (rows.length === 1 ? tr('{0} suggestion waiting', rows.length) : tr('{0} suggestions waiting', rows.length)) : tr('Nothing waiting'),
        view: rows.length ? { kind: 'table', title: tr('Autopilot suggestions'), columns: [{ key: 'title', label: tr('Suggestion') }, { key: 'kind', label: tr('Kind') }, { key: 'value', label: tr('Value'), format: 'eur', align: 'right' }], rows: rows.map(({ why: _w, ...r }) => r) } : undefined,
      }
    }

    /* ───────────── Catalogue ───────────── */

    case 'create_items': {
      const rows = input.items as Record<string, any>[]
      const r = ingest(
        s,
        {
          products: rows.map((x, i) => ({
            ref: x.sku || x.barcode || `new:${normalize(x.name)}:${i}`,
            sku: x.sku,
            name: x.name,
            barcode: x.barcode,
            category: x.category,
            unit: x.unit,
            cost: x.cost,
            price: x.price,
            vatRate: x.vat_rate,
            supplier: x.supplier,
            tracksExpiry: x.tracks_expiry,
            stock: x.opening_stock ? [{ location: x.location ?? null, qty: x.opening_stock }] : [],
          })),
        },
        { source: 'operator', label: tr('Operator'), actor: ctx.actor, setStock: true },
      )
      const made = (r.cs.upserts?.items ?? []) as Item[]
      if (!made.length) return { result: { status: 'nothing_created', already_exist: r.report.products.matched }, summary: tr('Those items already exist') }
      const res = propose(ctx, { kind: 'catalog', risk: 'reversible', title: (made.length === 1 ? tr('Add {0} item', made.length) : tr('Add {0} items', made.length)), lines: made.map((i) => `${i.name} · ${i.sku}${i.price ? ` · ${eur(i.price)}` : ''}`), cs: { ...r.cs, events: [event('item', (made.length === 1 ? tr('Added {0} item', made.length) : tr('Added {0} items', made.length)), ctx.actor, made.slice(0, 4).map((i) => i.name).join(', '), '/app/items')] }, link: made.length === 1 ? `/app/items/${made[0].id}` : '/app/items' })
      Object.assign(res.result as object, { created: made.map((i) => ({ id: i.id, sku: i.sku, name: i.name })), already_existed: r.report.products.matched, new_categories: r.report.categories.created, new_suppliers: r.report.suppliers.created })
      return res
    }

    case 'update_items': {
      const set = (input.set ?? {}) as Record<string, any>
      let targets: Item[] = []
      for (const ref of (input.items ?? []) as string[]) {
        const r = resolveItem(s, ref)
        if (!r.ok) return fail(r.error, r.candidates)
        targets.push(r.value)
      }
      if (input.category) {
        const cat = s.categories.find((c) => same(c.name, input.category)) ?? s.categories.find((c) => fuzzyScore(input.category, c.name) >= 60)
        if (!cat) return fail(tr('No category matches “{0}”.', input.category), s.categories.map((c) => c.name))
        targets.push(...s.items.filter((i) => i.categoryId === cat.id && !i.archived))
      }
      targets = [...new Map(targets.map((t) => [t.id, t])).values()]
      if (!targets.length) return fail(tr('Which items? Give `items` or a `category`.'))
      const extra: ChangeSet = {}
      let cat: Category | undefined
      if (set.category) {
        cat = s.categories.find((c) => same(c.name, set.category))
        if (!cat) {
          cat = { id: uid(), name: String(set.category).trim(), hue: (s.categories.length * 67 + 24) % 360, atCategory: 'M' }
          extra.upserts = { categories: [cat] }
        }
      }
      let sup: Supplier | undefined
      if (set.supplier) {
        const r = resolveSupplier(s, set.supplier)
        if (!r.ok) return fail(r.error, r.candidates)
        sup = r.value
      }
      if (set.name && targets.length > 1) return fail(tr('A name can only be given to one item at a time.'))
      const next = targets.map((it): Item => {
        const tags = new Set(it.tags)
        for (const t of (set.add_tags ?? []) as string[]) tags.add(t)
        for (const t of (set.remove_tags ?? []) as string[]) tags.delete(t)
        return {
          ...it,
          name: set.name ?? it.name,
          categoryId: cat?.id ?? it.categoryId,
          hue: cat?.hue ?? it.hue,
          barcode: set.barcode !== undefined ? set.barcode : it.barcode,
          unit: set.unit ?? it.unit,
          price: set.price ?? (set.price_change_pct != null ? round(it.price * (1 + set.price_change_pct / 100), 2) : it.price),
          cost: set.cost ?? it.cost,
          vatRate: set.vat_rate ?? it.vatRate,
          reorderPoint: set.reorder_point !== undefined ? set.reorder_point : it.reorderPoint,
          reorderQty: set.reorder_qty !== undefined ? set.reorder_qty : it.reorderQty,
          safetyDays: set.safety_days ?? it.safetyDays,
          supplierId: sup?.id ?? it.supplierId,
          tracksExpiry: set.tracks_expiry ?? it.tracksExpiry,
          tags: [...tags],
        }
      })
      const changed = next.filter((n, i) => JSON.stringify(n) !== JSON.stringify(targets[i]))
      if (!changed.length) return fail(tr('That would not change anything.'))
      const what = Object.keys(set).map((k) => k.replace(/_/g, ' ')).join(', ')
      const priced = set.price != null || set.price_change_pct != null
      const lines = changed.slice(0, 10).map((n) => {
        const o = items[n.id]
        return priced ? `${n.name}: ${eur(o.price)} → ${eur(n.price)}` : n.name
      })
      if (changed.length > 10) lines.push(tr('+{0} more', changed.length - 10))
      return propose(ctx, {
        kind: 'catalog',
        risk: 'reversible',
        title: changed.length === 1 ? tr('Update {0}', changed[0].name) : tr('Update {0} items ({1})', changed.length, what),
        lines: changed.length === 1 && !priced ? [what] : lines,
        cs: mergeChangeSets(extra, { upserts: { items: changed }, events: [event('item', (changed.length === 1 ? tr('Updated {0} item', changed.length) : tr('Updated {0} items', changed.length)), ctx.actor, what, changed.length === 1 ? `/app/items/${changed[0].id}` : '/app/items')] }),
        link: changed.length === 1 ? `/app/items/${changed[0].id}` : '/app/items',
        needsPerson: priced ? HANDS.price : undefined,
      })
    }

    case 'archive_items': {
      const ids: string[] = []
      for (const ref of input.items as string[]) {
        const hit = s.items.find((i) => i.id === ref || i.sku.toLowerCase() === String(ref).toLowerCase() || same(i.name, ref))
        const r = hit ? ({ ok: true, value: hit } as const) : resolveItem(s, ref)
        if (!r.ok) return fail(r.error, r.candidates)
        ids.push(r.value.id)
      }
      const restore = !!input.restore
      return propose(ctx, { kind: 'catalog', risk: 'reversible', title: (restore ? ids.length === 1 ? tr('Restore {0} item', ids.length) : tr('Restore {0} items', ids.length) : ids.length === 1 ? tr('Archive {0} item', ids.length) : tr('Archive {0} items', ids.length)), lines: ids.slice(0, 10).map((id) => items[id].name), cs: archiveItems(s, ids, !restore, ctx.actor), link: '/app/items' })
    }

    case 'save_supplier': {
      const old = s.suppliers.find((x) => same(x.name, input.name))
      const next: Supplier = {
        ...(old ?? { id: uid(), name: String(input.name).trim(), nif: null, email: null, phone: null, contact: null, leadTimeDays: 5, minOrderValue: 0, paymentTerms: null, notes: null, orderDays: null }),
        ...(input.nif !== undefined ? { nif: input.nif } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.contact !== undefined ? { contact: input.contact } : {}),
        ...(input.lead_time_days !== undefined ? { leadTimeDays: input.lead_time_days } : {}),
        ...(input.min_order_value !== undefined ? { minOrderValue: input.min_order_value } : {}),
        ...(input.order_days !== undefined ? { orderDays: input.order_days } : {}),
        ...(input.payment_terms !== undefined ? { paymentTerms: input.payment_terms } : {}),
      }
      if (old && JSON.stringify(old) === JSON.stringify(next)) return fail(tr('That would not change anything.'))
      const lines = [next.leadTimeDays != null && tr('Lead time {0} days', next.leadTimeDays), next.minOrderValue ? tr('Minimum order {0}', eur(next.minOrderValue, { decimals: 0 })) : null, next.email, next.nif && `NIF ${next.nif}`].filter(Boolean) as string[]
      return propose(ctx, { kind: 'supplier', risk: 'reversible', title: (old ? tr('Update supplier {0}', next.name) : tr('Add supplier {0}', next.name)), lines, cs: { upserts: { suppliers: [next] }, events: [event('supplier', (old ? tr('Updated supplier {0}', next.name) : tr('Added supplier {0}', next.name)), ctx.actor, null, '/app/suppliers')] }, link: '/app/suppliers' })
    }

    case 'save_category': {
      const old = s.categories.find((c) => same(c.name, input.name))
      const next: Category = { ...(old ?? { id: uid(), name: String(input.name).trim(), hue: (s.categories.length * 67 + 24) % 360, atCategory: 'M' as const }), ...(input.rename_to ? { name: String(input.rename_to).trim() } : {}), ...(input.at_category ? { atCategory: input.at_category } : {}) }
      if (old && JSON.stringify(old) === JSON.stringify(next)) return { result: { status: 'exists', category: old.name }, summary: tr('{0} already exists', old.name) }
      return propose(ctx, { kind: 'catalog', risk: 'reversible', title: old ? tr('Update category {0}', old.name) : tr('Add category {0}', next.name), lines: old && input.rename_to ? [`${old.name} → ${next.name}`] : [], cs: { upserts: { categories: [next] } }, link: '/app/items' })
    }

    case 'save_location': {
      const old = s.locations.find((l) => same(l.name, input.name) || same(l.code, input.name))
      const nm = String(input.rename_to ?? input.name).trim()
      const next: Location = { ...(old ?? { id: uid(), name: nm, code: (input.code ?? nm.slice(0, 3)).toUpperCase(), kind: input.kind ?? 'store', address: null, isDefault: s.locations.length === 0 }), name: nm, ...(input.kind ? { kind: input.kind } : {}), ...(input.code ? { code: String(input.code).toUpperCase() } : {}), ...(input.address !== undefined ? { address: input.address } : {}) }
      if (old && JSON.stringify(old) === JSON.stringify(next)) return { result: { status: 'exists', location: old.name }, summary: tr('{0} already exists', old.name) }
      return propose(ctx, { kind: 'location', risk: 'reversible', title: old ? tr('Update location {0}', old.name) : tr('Add location {0}', next.name), lines: [`${next.kind} · ${next.code}`], cs: { upserts: { locations: [next] }, events: [event('location', (old ? tr('Updated location {0}', next.name) : tr('Added location {0}', next.name)), ctx.actor, null, '/app/locations')] }, link: '/app/locations' })
    }

    /* ───────────── How Nau behaves ───────────── */

    case 'update_settings': {
      const st = s.workspace.settings
      const next = { ...st, ...(input.review_days != null ? { reviewDays: input.review_days } : {}), ...(input.dead_stock_days != null ? { deadStockDays: input.dead_stock_days } : {}), ...(input.expiry_warn_days != null ? { expiryWarnDays: input.expiry_warn_days } : {}), ...(input.brief_time ? { briefTime: input.brief_time } : {}) }
      const lines = [input.review_days != null && tr('Review period {0} → {1} days', st.reviewDays, input.review_days), input.dead_stock_days != null && tr('Dead stock after {0} → {1} days', st.deadStockDays, input.dead_stock_days), input.expiry_warn_days != null && tr('Expiry warning {0} → {1} days', st.expiryWarnDays, input.expiry_warn_days), input.brief_time && tr('Morning brief {0} → {1}', st.briefTime, input.brief_time)].filter(Boolean) as string[]
      if (!lines.length) return fail(tr('No settings given.'))
      return propose(ctx, { kind: 'settings', risk: 'reversible', title: tr('Change autopilot thresholds'), lines, cs: { workspace: { settings: next }, events: [event('settings', tr('Changed autopilot thresholds'), ctx.actor, lines.join(' · '), '/app/autopilot')] }, link: '/app/autopilot' })
    }

    case 'set_policy': {
      const cur = policyOf(s.workspace.settings)
      const next: Policy = { reversible: input.reversible ?? cur.reversible, money: input.money ?? cur.money, outbound: input.outbound ?? cur.outbound, perActionLimit: input.per_action_limit ?? cur.perActionLimit, dailyLimit: input.daily_limit ?? cur.dailyLimit }
      if (JSON.stringify(cur) === JSON.stringify(next)) return fail(tr('That is already the policy.'))
      const say = (k: 'reversible' | 'money' | 'outbound', label: string) => (cur[k] !== next[k] ? `${label}: ${cur[k] === 'auto' ? 'alone' : 'asks'} → ${next[k] === 'auto' ? 'alone' : 'asks'}` : null)
      const lines = [say('reversible', tr('Reversible work')), say('money', tr('Spending')), say('outbound', tr('Sending outside Nau')), cur.perActionLimit !== next.perActionLimit && tr('Per action {0} → {1}', eur(cur.perActionLimit, { decimals: 0 }), eur(next.perActionLimit, { decimals: 0 })), cur.dailyLimit !== next.dailyLimit && tr('Per day {0} → {1}', eur(cur.dailyLimit, { decimals: 0 }), eur(next.dailyLimit, { decimals: 0 }))].filter(Boolean) as string[]
      return propose(ctx, { kind: 'policy', risk: 'reversible', title: tr('Change what Operator may do alone'), lines, cs: { workspace: { settings: { ...s.workspace.settings, policy: next } }, events: [event('settings', tr('Changed Operator’s policy'), ctx.actor, lines.join(' · '), '/app/autopilot')] }, link: '/app/autopilot', alwaysAsk: tr('Operator never widens its own authority — this one is yours to approve') })
    }

    case 'set_playbook': {
      const pb = s.playbooks.find((p) => p.key === input.key)
      if (!pb) return fail(tr('No playbook “{0}”.', input.key), s.playbooks.map((p) => p.key))
      const next = { ...pb, enabled: input.enabled ?? pb.enabled, cadence: input.cadence ?? pb.cadence }
      if (JSON.stringify(pb) === JSON.stringify(next)) return fail(tr('That would not change anything.'))
      return propose(ctx, { kind: 'settings', risk: 'reversible', title: `${pb.name}: ${next.enabled ? tr('on') : tr('off')}${input.cadence ? `, ${next.cadence}` : ''}`, lines: [pb.description], cs: { upserts: { playbooks: [next] } }, link: '/app/autopilot' })
    }

    case 'save_rule': {
      const old = s.rules.find((r) => same(r.name, input.name))
      const next: Rule = { ...(old ?? { id: uid(), createdBy: 'agent' as const, createdAt: new Date().toISOString(), lastRunAt: null, lastResult: null, trigger: 'daily' as const, enabled: true }), name: String(input.name).trim(), instruction: String(input.instruction).trim(), ...(input.trigger ? { trigger: input.trigger } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) }
      return propose(ctx, { kind: 'rule', risk: 'reversible', title: (old ? tr('Update rule: {0}', next.name) : tr('New rule: {0}', next.name)), lines: [next.instruction, tr('Runs {0}', next.trigger.replace('on_', 'after each ').replace('_', ' '))], cs: { upserts: { rules: [next] }, events: [event('rule', (old ? tr('Updated rule “{0}”', next.name) : tr('Added rule “{0}”', next.name)), ctx.actor, null, '/app/autopilot')] }, link: '/app/autopilot' })
    }

    case 'delete_rule': {
      const old = s.rules.find((r) => same(r.name, input.name)) ?? s.rules.find((r) => fuzzyScore(input.name, r.name) >= 60)
      if (!old) return fail(tr('No rule matches “{0}”.', input.name), s.rules.map((r) => r.name))
      return propose(ctx, { kind: 'rule', risk: 'reversible', title: tr('Delete rule: {0}', old.name), lines: [old.instruction], cs: { removes: { rules: [old.id] } }, link: '/app/autopilot' })
    }

    case 'save_dashboard': {
      const old = s.dashboards.find((d) => same(d.name, input.name))
      const drop = ((input.remove_widgets ?? []) as string[]).map(normalize)
      const next: Dashboard = { ...(old ?? { id: uid(), name: String(input.name).trim(), widgets: [], ownerId: null, position: s.dashboards.length }), ...(input.rename_to ? { name: String(input.rename_to).trim() } : {}) }
      if (old && drop.length) next.widgets = old.widgets.filter((w) => !drop.some((d) => normalize(w.title ?? '') === d || normalize(w.type) === d || (d.length >= 4 && normalize(w.title ?? w.type).includes(d))))
      if (old && JSON.stringify(old) === JSON.stringify(next)) return fail(tr('That would not change anything.'))
      const removed = old ? old.widgets.length - next.widgets.length : 0
      return propose(ctx, { kind: 'dashboard', risk: 'reversible', title: old ? tr('Update dashboard {0}', old.name) : tr('New dashboard {0}', next.name), lines: [input.rename_to && old ? `${old.name} → ${next.name}` : null, removed ? `Remove ${removed} widget${removed === 1 ? '' : 's'}` : null].filter(Boolean) as string[], cs: { upserts: { dashboards: [next] } }, link: '/app' })
    }

    /* ───────────── Documents ───────────── */

    case 'update_order': {
      const ref = String(input.order).toLowerCase()
      const po = s.orders.find((p) => p.id === input.order || p.number.toLowerCase() === ref || p.number.toLowerCase().replace(/\D/g, '') === ref.replace(/\D/g, ''))
      if (!po) return fail(tr('No purchase order matches “{0}”.', input.order), s.orders.slice(0, 6).map((p) => p.number))
      const sup = suppliers[po.supplierId]
      const total = round(sum(po.lines.map((l) => l.qty * l.unitCost)))
      const link = `/app/orders/${po.id}`
      if (input.action === 'send') {
        if (po.status !== 'draft') return fail(tr('{0} is already {1}.', po.number, po.status))
        return propose(ctx, { kind: 'order', risk: 'money', title: tr('Send {0} to {1}', po.number, sup?.name ?? tr('supplier')), lines: [`${po.lines.length} lines · ${eur(total)}`, total < (sup?.minOrderValue ?? 0) ? tr('Below the {0} minimum order', eur(sup!.minOrderValue, { decimals: 0 })) : null].filter(Boolean) as string[], impactEur: total, cs: sendPO(s, po, ctx.actor, { email: ctx.mail }), link })
      }
      if (input.action === 'cancel') {
        if (po.status === 'received' || po.status === 'cancelled') return fail(tr('{0} is already {1}.', po.number, po.status))
        return propose(ctx, { kind: 'order', risk: po.status === 'draft' ? 'reversible' : 'outbound', title: tr('Cancel {0}', po.number), lines: [`${sup?.name ?? ''} · ${eur(total)}`], impactEur: po.status === 'draft' ? null : total, cs: cancelPO(po, ctx.actor), link })
      }
      if (po.status !== 'draft') return fail(tr('{0} was already sent — its lines can’t change.', po.number))
      const lines: PurchaseOrder['lines'] = []
      for (const l of (input.lines ?? []) as { item: string; qty: number }[]) {
        const r = resolveItem(s, l.item)
        if (!r.ok) return fail(r.error, r.candidates)
        if (l.qty > 0) lines.push({ itemId: r.value.id, qty: l.qty, unitCost: po.lines.find((x) => x.itemId === r.value.id)?.unitCost ?? r.value.cost, received: 0 })
      }
      if (!lines.length) return fail(tr('Give at least one line with a quantity.'))
      const value = round(sum(lines.map((l) => l.qty * l.unitCost)))
      return propose(ctx, { kind: 'order', risk: 'reversible', title: tr('Change {0}', po.number), lines: lines.map((l) => `${fmtQty(l.qty, items[l.itemId]?.unit)} × ${items[l.itemId]?.name}`), impactEur: value, cs: { upserts: { orders: [{ ...po, lines }] } }, link })
    }

    case 'post_receipt': {
      const ref = String(input.receipt).toLowerCase()
      const rc = s.receipts.find((r) => r.id === input.receipt || r.number.toLowerCase() === ref || (r.docRef ?? '').toLowerCase() === ref)
      if (!rc) return fail(tr('No delivery matches “{0}”.', input.receipt), s.receipts.filter((r) => r.status === 'draft').slice(0, 6).map((r) => r.number))
      if (rc.status === 'posted') return fail(tr('{0} is already in stock.', rc.number))
      const lines = rc.lines.filter((l) => l.itemId && l.qty > 0)
      if (!lines.length) return fail(tr('{0} has no lines matched to items yet — open it in Receive.', rc.number))
      const value = round(sum(lines.map((l) => l.qty * l.unitCost)))
      return propose(ctx, { kind: 'receipt', risk: 'reversible', title: tr('Check in {0}', rc.docRef ?? rc.number), lines: lines.slice(0, 8).map((l) => `${fmtQty(l.qty, items[l.itemId!]?.unit)} × ${items[l.itemId!]?.name ?? l.description}`), impactEur: value, cs: postReceipt(s, rc, ctx.actor), link: '/app/receive', needsPerson: tr('Someone should check the delivery against the document') })
    }

    case 'resolve_proposal': {
      const pending = s.proposals.filter((p) => p.status === 'pending')
      const p = pending.find((x) => x.id === input.proposal) ?? pending.map((x) => ({ x, sc: fuzzyScore(input.proposal, x.title) })).filter((y) => y.sc > 0).sort((a, b) => b.sc - a.sc)[0]?.x
      if (!p) return fail(tr('No waiting suggestion matches “{0}”.', input.proposal), pending.slice(0, 6).map((x) => x.title))
      if (input.decision === 'dismiss') return propose(ctx, { kind: 'proposal', risk: 'reversible', title: tr('Dismiss: {0}', p.title), lines: [p.summary], cs: dismissProposal(p) })
      const r = approveProposal(s, p, ctx.actor)
      return propose(ctx, { kind: p.kind === 'reorder' ? 'order' : p.kind, risk: 'reversible', title: p.title, lines: [p.summary, ...p.rationale.slice(0, 3)], impactEur: p.impactEur ?? null, cs: r.cs, link: r.link ?? '/app/approvals', needsPerson: HANDS[p.kind] })
    }

    case 'undo_action': {
      if (!ctx.canWrite) return fail(tr('View-only access.'))
      const done = s.actions.filter((a) => a.status === 'applied' && a.undo).sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt))
      const a = input.last || !input.action ? done[0] : (done.find((x) => x.id === input.action) ?? done.map((x) => ({ x, sc: fuzzyScore(input.action, x.title) })).filter((y) => y.sc > 0).sort((p, q) => q.sc - p.sc)[0]?.x)
      if (!a) return fail(tr('Nothing in the journal can be undone.'), done.slice(0, 5).map((x) => x.title))
      return { result: { status: 'undone', title: a.title, done_at: date(a.resolvedAt ?? a.createdAt, 'short') }, summary: tr('Undid “{0}”', a.title), apply: undoAction(s, a, ctx.actor), view: { kind: 'action', actionId: a.id } }
    }

    default:
      return fail(tr('Unknown tool {0}', name))
  }
}

/**
 * Autopilot suggestions that are pure paperwork are approved as they appear when the policy lets
 * reversible work run alone: reorders become draft orders, counts are opened, dead stock is flagged.
 * Anything that needs hands stays in the queue. Ids derive from the suggestion, so the browser and
 * the server can both try without doing it twice.
 */
export function autoResolve(s: Snapshot, actor = { kind: 'agent' as const, name: 'Operator' }): ChangeSet {
  if (policyOf(s.workspace.settings).reversible !== 'auto') return {}
  let cs: ChangeSet = {}
  let work = s
  for (const p of s.proposals) {
    if (p.status !== 'pending' || p.source !== 'autopilot' || HANDS[p.kind]) continue
    const r = approveProposal(work, p, actor)
    const res = propose({ snapshot: work, actor, canWrite: true, source: 'autopilot' }, { kind: p.kind === 'reorder' ? 'order' : p.kind, risk: 'reversible', title: p.title, lines: [p.summary, ...p.rationale.slice(0, 2)], impactEur: p.impactEur ?? null, cs: stable(r.cs, p.id), link: r.link ?? null })
    if (!res.apply || !res.action) continue
    const step = { ...res.apply, upserts: { ...res.apply.upserts, actions: [{ ...res.action, id: stableKey(p.id, 'action') }] } }
    cs = mergeChangeSets(cs, step)
    work = { ...work, proposals: work.proposals.map((x) => (x.id === p.id ? { ...x, status: 'approved' as const } : x)), orders: [...work.orders, ...((step.upserts.orders ?? []) as PurchaseOrder[])] }
  }
  return cs
}

const stableKey = (...parts: string[]) => stableId('auto', ...parts)

/** Rows a suggestion creates get ids derived from the suggestion itself. */
function stable(cs: ChangeSet, proposalId: string): ChangeSet {
  const orders = cs.upserts?.orders?.map((o, i) => ({ ...o, id: stableKey(proposalId, 'po', String(i)) }))
  const counts = cs.upserts?.counts?.map((c, i) => ({ ...c, id: stableKey(proposalId, 'count', String(i)) }))
  const events = cs.events?.map((e, i) => ({ ...e, id: stableKey(proposalId, 'event', String(i)), link: orders?.[0] ? `/app/orders/${orders[0].id}` : counts?.[0] ? `/app/counts/${counts[0].id}` : e.link }))
  return { ...cs, upserts: { ...cs.upserts, ...(orders ? { orders } : {}), ...(counts ? { counts } : {}) }, events }
}
