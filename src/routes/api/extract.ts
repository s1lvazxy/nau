import { createFileRoute } from '@tanstack/react-router'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { authorizeModelCall, json, sameOrigin } from '~/server/guard'
import { tr } from '~/i18n'

const MODEL = process.env.NAU_AGENT_MODEL || 'claude-opus-5-5'

const Invoice = z.object({
  supplier_name: z.string().describe('Issuer of the document'),
  supplier_nif: z.string().nullable(),
  document_number: z.string().nullable().describe('e.g. FT 2026/123 or GR A/45'),
  document_date: z.string().nullable().describe('YYYY-MM-DD'),
  lines: z.array(
    z.object({
      description: z.string(),
      code: z.string().nullable().describe('Supplier product code or EAN if printed'),
      qty: z.number(),
      unit_cost: z.number().describe('Net unit price before VAT, after line discounts'),
      lot: z.string().nullable(),
      expires_on: z.string().nullable().describe('YYYY-MM-DD'),
      match_item_id: z.string().nullable().describe('id from the catalogue list when confident it is the same product, else null'),
      confidence: z.number().describe('0-1 confidence in the match'),
    }),
  ),
})

/** A photo of shelves or a stockroom: what is on them, counted as far as the picture shows. */
const Shelf = z.object({
  products: z.array(
    z.object({
      name: z.string().describe('Brand, product and size as printed on the label, e.g. “Delta Café Lote Chávena 250 g”'),
      category: z.string().nullable().describe('A short shop category in Portuguese, e.g. “Mercearia”, “Bebidas”'),
      barcode: z.string().nullable().describe('Only when the digits are legible'),
      count: z.number().describe('Units visible on the shelf'),
      confidence: z.number().describe('0-1 confidence in the name and the count'),
    }),
  ),
})

const Body = z.object({
  mode: z.enum(['invoice', 'shelf']).optional(),
  data: z.string().min(100).max(9_000_000),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  catalogue: z.array(z.object({ id: z.string(), name: z.string(), sku: z.string(), barcode: z.string().nullable().optional() })).max(3000).default([]),
})

export const Route = createFileRoute('/api/extract')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!process.env.ANTHROPIC_API_KEY) return json({ error: tr('Document reading needs the Operator model. Add ANTHROPIC_API_KEY.') }, 503)
        if (!sameOrigin(request)) return json({ error: tr('Forbidden') }, 403)
        const auth = await authorizeModelCall(request, 'extract')
        if (!auth.ok) return auth.res
        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return json({ error: tr('Invalid document') }, 400)
        const { data, mediaType, catalogue, mode } = parsed.data
        const client = new Anthropic()
        const doc: Anthropic.Beta.BetaContentBlockParam =
          mediaType === 'application/pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
            : { type: 'image', source: { type: 'base64', media_type: mediaType, data } }
        try {
          if (mode === 'shelf') {
            const shelf = await client.beta.messages.parse({
              model: MODEL,
              max_tokens: 16000,
              output_config: { effort: 'low', format: betaZodOutputFormat(Shelf) },
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default',
              messages: [{ role: 'user', content: [doc, { type: 'text', text: 'This is a photo of shelves, a counter or a stockroom in a Portuguese shop, café or restaurant. List every distinct product you can identify from its label, once each, with how many units are visible. Count only what you can see; do not guess what is behind. Skip anything whose label you cannot read. Names in Portuguese as printed.' }] }],
            })
            if (shelf.stop_reason === 'refusal' || !shelf.parsed_output) return json({ error: tr('Couldn’t read that photo. Try one taken straight on, with the labels in focus.') }, 422)
            return json(shelf.parsed_output)
          }
          const res = await client.beta.messages.parse({
            model: MODEL,
            max_tokens: 16000,
            output_config: { effort: 'low', format: betaZodOutputFormat(Invoice) },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            messages: [
              {
                role: 'user',
                content: [
                  doc,
                  {
                    type: 'text',
                    text: `This is a Portuguese supplier invoice, delivery note (guia de remessa) or receipt. Read every product line. Quantities are in the units printed; unit_cost is the net price per unit before VAT (IVA) after discounts. Ignore VAT summary, totals and payment lines.\n\nMatch each line to this catalogue when you are confident it is the same product (same product and size), otherwise null:\n${catalogue.map((c) => `${c.id} | ${c.sku} | ${c.name}${c.barcode ? ` | ${c.barcode}` : ''}`).join('\n')}`,
                  },
                ],
              },
            ],
          })
          if (res.stop_reason === 'refusal' || !res.parsed_output) return json({ error: tr('Couldn’t read that document. Try a sharper photo.') }, 422)
          return json(res.parsed_output)
        } catch (e) {
          console.error('[extract]', e)
          return json({ error: e instanceof Anthropic.RateLimitError ? tr('Busy — try again in a minute.') : tr('Couldn’t read that document.') }, 502)
        }
      },
    },
  },
})
