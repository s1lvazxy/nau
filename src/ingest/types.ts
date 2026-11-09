/**
 * The one shape every outside source is translated into — spreadsheets, SAF-T files, photos,
 * connectors and the public API. `ingest()` turns a batch into a change set.
 */

export interface ExtStock {
  /** Location name, code or external id; omitted = the default location */
  location?: string | null
  qty: number
  lot?: string | null
  expiresOn?: string | null
}

export interface ExtProduct {
  /** Id in the source system. Stable across syncs. */
  ref: string
  sku?: string | null
  name: string
  barcode?: string | null
  category?: string | null
  unit?: string | null
  /** Net unit cost, before VAT */
  cost?: number | null
  /** Shelf price, VAT included */
  price?: number | null
  vatRate?: number | null
  supplier?: string | null
  tracksExpiry?: boolean
  stock?: ExtStock[]
}

export interface ExtParty {
  ref?: string | null
  name: string
  nif?: string | null
  email?: string | null
  phone?: string | null
}

export interface ExtLine {
  productRef?: string | null
  sku?: string | null
  barcode?: string | null
  name: string
  qty: number
  /** VAT included */
  unitPrice?: number | null
  /** Net, before VAT */
  unitCost?: number | null
  vatRate?: number | null
  lot?: string | null
  expiresOn?: string | null
}

export interface ExtDocument {
  ref: string
  kind: 'sale' | 'refund' | 'purchase'
  number: string
  /** ISO date or date-time */
  date: string
  location?: string | null
  party?: ExtParty | null
  lines: ExtLine[]
}

export interface IngestBatch {
  products?: ExtProduct[]
  suppliers?: ExtParty[]
  documents?: ExtDocument[]
}

export interface Link {
  kind: 'item' | 'supplier' | 'location' | 'doc'
  externalRef: string
  internalId: string
}

export interface IngestReport {
  products: { created: number; updated: number; matched: number }
  suppliers: { created: number; matched: number }
  categories: { created: number }
  documents: { sales: number; refunds: number; purchases: number; skipped: number }
  lines: { applied: number; unmatched: number }
  stockSet: number
  /** Lines Nau could not tie to an item (only when it may not create items) */
  unmatched: { name: string; sku?: string | null; barcode?: string | null; qty: number; doc: string }[]
  /** Units sold with no stock behind them — a count is due */
  negative: number
}

export const emptyReport = (): IngestReport => ({
  products: { created: 0, updated: 0, matched: 0 },
  suppliers: { created: 0, matched: 0 },
  categories: { created: 0 },
  documents: { sales: 0, refunds: 0, purchases: 0, skipped: 0 },
  lines: { applied: 0, unmatched: 0 },
  stockSet: 0,
  unmatched: [],
  negative: 0,
})
