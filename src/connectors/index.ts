import type { ConnectorId } from './catalog'
import type { Connector } from './types'
import { moloni } from './impl/moloni'
import { invoicexpress } from './impl/invoicexpress'
import { vendus } from './impl/vendus'
import { shopify } from './impl/shopify'
import { woocommerce } from './impl/woocommerce'
import { square } from './impl/square'
import { sumup } from './impl/sumup'

/** Server-side implementations. To add a system: describe it in catalog.ts, implement `Connector`, register it here. */
export const IMPL: Partial<Record<ConnectorId, Connector>> = { moloni, invoicexpress, vendus, shopify, woocommerce, square, sumup }
