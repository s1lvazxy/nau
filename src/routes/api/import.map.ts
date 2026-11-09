import { createFileRoute } from '@tanstack/react-router'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { FIELDS, SHEET_KINDS } from '~/ingest/tabular'
import { authorizeModelCall, json, sameOrigin } from '~/server/guard'

const MODEL = process.env.NAU_AGENT_MODEL || 'claude-opus-5-5'

const Body = z.object({
  tables: z
    .array(z.object({ name: z.string().max(200), headers: z.array(z.string().max(120)).min(1).max(80), sample: z.array(z.record(z.string(), z.string().max(160))).max(8) }))
    .min(1)
    .max(8),
})

const Out = z.object({
  tables: z.array(
    z.object({
      kind: z.enum(SHEET_KINDS).describe('What the sheet holds'),
      columns: z.array(z.object({ header: z.string(), field: z.enum(FIELDS).nullable().describe('null when the column is not needed') })),
      price_includes_vat: z.boolean().describe('Whether the sale price column already includes VAT'),
    }),
  ),
})

/**
 * Reads the header and a few rows of each sheet and says what every column means.
 * Only headers and up to eight sample rows leave the browser. The built-in heuristics already
 * made a first pass; this corrects it for unusual exports.
 */
export const Route = createFileRoute('/api/import/map')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'not_configured' }, 503)
        if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403)
        const auth = await authorizeModelCall(request, 'extract')
        if (!auth.ok) return auth.res
        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return json({ error: 'Invalid request' }, 400)
        const { tables } = parsed.data
        try {
          const res = await new Anthropic().beta.messages.parse({
            model: MODEL,
            max_tokens: 8000,
            output_config: { effort: 'low', format: betaZodOutputFormat(Out) },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            messages: [
              {
                role: 'user',
                content: `These are exports from a Portuguese shop's software (spreadsheets, invoicing programs, POS, ERPs), being imported into an inventory system. For each sheet, in the same order, decide what it holds and map every header to one field or to null.

Sheet kinds: items (a product list, with or without stock; one row per product, or per product and location or lot), suppliers, sales (one row per line sold, with a date and a quantity), purchases (one row per line received from a supplier).

Fields: name (product description), sku (the shop's own product code), barcode (EAN/GTIN), category (family or group), unit, cost (net purchase price), price (sale price), vat (VAT rate), supplier (supplier name), stock (quantity on hand — items sheets only), location (warehouse or shop), lot, expiry, qty (quantity sold or received — history sheets only), date, doc (document number), nif, email, phone.

Rules: use each field at most once per sheet; pick the best column when several fit and give the rest null. A column of totals, margins, internal ids, or anything else not listed is null. "PVP" is a sale price including VAT; "Preço s/ IVA" excludes it. Return exactly the headers you were given, unchanged.

${tables.map((t, i) => `Sheet ${i + 1} — “${t.name}”\nHeaders: ${JSON.stringify(t.headers)}\nRows: ${JSON.stringify(t.sample.slice(0, 6))}`).join('\n\n')}`,
              },
            ],
          })
          if (res.stop_reason === 'refusal' || !res.parsed_output || res.parsed_output.tables.length !== tables.length) return json({ error: 'unreadable' }, 422)
          return json(res.parsed_output)
        } catch (e) {
          console.error('[import/map]', e)
          return json({ error: e instanceof Anthropic.RateLimitError ? 'busy' : 'failed' }, 502)
        }
      },
    },
  },
})
