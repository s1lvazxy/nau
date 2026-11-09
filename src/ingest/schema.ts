import { z } from 'zod'

/** Wire format of the public API and of what the model extracts — the same shapes `ingest()` reads. */

const text = (max: number) => z.string().trim().min(1).max(max)
const opt = (max: number) => z.string().trim().max(max).nullish()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use an ISO date, e.g. 2026-11-09 or 2026-11-09T18:30:00Z')

export const ProductSchema = z.object({
  ref: text(200).describe('Your id for the product. Stable across calls.'),
  sku: opt(60),
  name: text(160),
  barcode: opt(40),
  category: opt(80),
  unit: opt(20),
  cost: z.number().min(0).nullish().describe('Net unit cost, before VAT'),
  price: z.number().min(0).nullish().describe('Shelf price, VAT included'),
  vatRate: z.number().min(0).max(30).nullish(),
  supplier: opt(120),
  tracksExpiry: z.boolean().optional(),
  stock: z.array(z.object({ location: opt(80), qty: z.number(), lot: opt(60), expiresOn: day.nullish() })).max(50).optional(),
})

export const PartySchema = z.object({ ref: opt(200), name: text(160), nif: opt(20), email: opt(160), phone: opt(40) })

export const LineSchema = z.object({
  productRef: opt(200),
  sku: opt(60),
  barcode: opt(40),
  name: text(200),
  qty: z.number(),
  unitPrice: z.number().min(0).nullish().describe('VAT included'),
  unitCost: z.number().min(0).nullish().describe('Net, before VAT'),
  vatRate: z.number().min(0).max(30).nullish(),
  lot: opt(60),
  expiresOn: day.nullish(),
})

export const DocumentSchema = z.object({
  ref: text(200).describe('Your id for the document. Sending the same ref twice changes nothing.'),
  kind: z.enum(['sale', 'refund', 'purchase']),
  number: text(80),
  date: day,
  location: opt(80).describe('Location name or code in Nau; omitted = the default location'),
  party: PartySchema.nullish(),
  lines: z.array(LineSchema).min(1).max(500),
})

export const DocumentsBody = z.object({ documents: z.array(DocumentSchema).min(1).max(500) })
export const ProductsBody = z.object({ products: z.array(ProductSchema).min(1).max(1000), setStock: z.boolean().optional(), update: z.boolean().optional() })
