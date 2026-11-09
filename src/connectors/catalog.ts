/** What the app shows about each connector. No secrets and no network code here — the browser imports this file. */

export type ConnectorId = 'moloni' | 'invoicexpress' | 'vendus' | 'shopify' | 'woocommerce' | 'square' | 'sumup' | 'toconline' | 'zonesoft' | 'winrest'
export type Family = 'invoicing' | 'ecommerce' | 'pos'

export interface ConnectorField {
  key: string
  label: string
  type?: 'text' | 'password' | 'url'
  placeholder?: string
  help?: string
  /** Stored sealed; never sent back to the browser */
  secret?: boolean
  optional?: boolean
}

export interface ConnectorMeta {
  id: ConnectorId
  name: string
  family: Family
  blurb: string
  /** beta = built against the vendor's public documentation, not yet proven on a live account. planned = not built. */
  status: 'beta' | 'planned'
  fields: ConnectorField[]
  can: { catalog: boolean; stock: boolean; sales: boolean; purchases: boolean; pushStock: boolean; webhooks: boolean }
  /** Where the person finds the credentials */
  setup: string
  docs: string
  /** For planned connectors: how to get the same data in today */
  meanwhile?: string
}

const none = { catalog: false, stock: false, sales: false, purchases: false, pushStock: false, webhooks: false }

export const CONNECTORS: ConnectorMeta[] = [
  {
    id: 'moloni',
    name: 'Moloni',
    family: 'invoicing',
    blurb: 'Products with stock, and every invoice, invoice-receipt, simplified invoice and credit note as a sale or return.',
    status: 'beta',
    fields: [
      { key: 'clientId', label: 'Developer ID', placeholder: 'the client_id Moloni gave you' },
      { key: 'clientSecret', label: 'Client secret', type: 'password', secret: true },
      { key: 'username', label: 'Moloni email' },
      { key: 'password', label: 'Moloni password', type: 'password', secret: true, help: 'Used once to obtain a token. Nau stores the token, sealed, and refreshes it.' },
      { key: 'companyId', label: 'Company ID', optional: true, help: 'Only when the account has more than one company.' },
    ],
    can: { ...none, catalog: true, stock: true, sales: true },
    setup: 'Ask Moloni for API access (Developer ID and client secret) in your account under Configurações → Integrações.',
    docs: 'https://www.moloni.pt/dev/',
  },
  {
    id: 'invoicexpress',
    name: 'InvoiceXpress',
    family: 'invoicing',
    blurb: 'Items, and finalised invoices and credit notes as sales and returns.',
    status: 'beta',
    fields: [
      { key: 'account', label: 'Account name', placeholder: 'the “minhaempresa” in minhaempresa.app.invoicexpress.com' },
      { key: 'apiKey', label: 'API key', type: 'password', secret: true },
    ],
    can: { ...none, catalog: true, sales: true },
    setup: 'In InvoiceXpress: Conta → Integrações → API. Copy the account name and the API key.',
    docs: 'https://docs.invoicexpress.com/',
  },
  {
    id: 'vendus',
    name: 'Vendus',
    family: 'pos',
    blurb: 'Point of sale and invoicing: products with stock, and every till document as a sale or return.',
    status: 'beta',
    fields: [{ key: 'apiKey', label: 'API key', type: 'password', secret: true }],
    can: { ...none, catalog: true, stock: true, sales: true },
    setup: 'In Vendus: Definições → Conta → API. Create a key with read access.',
    docs: 'https://www.vendus.pt/ws/',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    family: 'ecommerce',
    blurb: 'Variants with cost and stock, orders and restocked refunds, live through webhooks. Stock set in Nau flows back to the shop.',
    status: 'beta',
    fields: [
      { key: 'shop', label: 'Shop domain', placeholder: 'a-minha-loja.myshopify.com' },
      { key: 'accessToken', label: 'Admin API access token', type: 'password', secret: true, placeholder: 'shpat_…' },
      { key: 'webhookSecret', label: 'API secret key', type: 'password', secret: true, optional: true, help: 'Signs webhooks. Without it Nau syncs on its schedule instead of instantly.' },
    ],
    can: { catalog: true, stock: true, sales: true, purchases: false, pushStock: true, webhooks: true },
    setup: 'In Shopify admin: Settings → Apps → Develop apps. Create an app with read_products, read_orders, read_inventory, write_inventory and read_locations.',
    docs: 'https://shopify.dev/docs/api/admin-graphql',
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    family: 'ecommerce',
    blurb: 'Products and variations with stock, paid orders and refunds, live through webhooks. Stock set in Nau flows back to the shop.',
    status: 'beta',
    fields: [
      { key: 'url', label: 'Shop address', type: 'url', placeholder: 'https://loja.exemplo.pt' },
      { key: 'consumerKey', label: 'Consumer key', placeholder: 'ck_…' },
      { key: 'consumerSecret', label: 'Consumer secret', type: 'password', secret: true, placeholder: 'cs_…' },
      { key: 'webhookSecret', label: 'Webhook secret', type: 'password', secret: true, optional: true, help: 'The secret you type when creating the webhook in WooCommerce.' },
    ],
    can: { catalog: true, stock: true, sales: true, purchases: false, pushStock: true, webhooks: true },
    setup: 'In WordPress: WooCommerce → Settings → Advanced → REST API. Add a key with Read/Write permission.',
    docs: 'https://woocommerce.github.io/woocommerce-rest-api-docs/',
  },
  {
    id: 'square',
    name: 'Square',
    family: 'pos',
    blurb: 'Catalogue variations and completed orders from every location, with returns.',
    status: 'beta',
    fields: [
      { key: 'accessToken', label: 'Access token', type: 'password', secret: true },
      { key: 'webhookSecret', label: 'Webhook signature key', type: 'password', secret: true, optional: true },
    ],
    can: { ...none, catalog: true, sales: true, webhooks: true },
    setup: 'In the Square Developer Dashboard: create an application and copy its production access token (ITEMS_READ, ORDERS_READ, MERCHANT_PROFILE_READ).',
    docs: 'https://developer.squareup.com/reference/square',
  },
  {
    id: 'sumup',
    name: 'SumUp',
    family: 'pos',
    blurb: 'Successful card and cash transactions with the products rung up, matched to your items by name.',
    status: 'beta',
    fields: [
      { key: 'apiKey', label: 'API key', type: 'password', secret: true, placeholder: 'sup_sk_…' },
      { key: 'merchantCode', label: 'Merchant code', placeholder: 'MXXXXXXX' },
    ],
    can: { ...none, sales: true },
    setup: 'In SumUp: Settings → For developers → API keys. The merchant code is on your profile.',
    docs: 'https://developer.sumup.com/api',
  },
  {
    id: 'toconline',
    name: 'TOConline',
    family: 'invoicing',
    blurb: 'Products and sales documents.',
    status: 'planned',
    fields: [],
    can: none,
    setup: '',
    docs: 'https://api-docs.toconline.pt/',
    meanwhile: 'Export the SAF-T (PT) from TOConline and drop it into Nau — it carries the products, prices and every sale of the period.',
  },
  {
    id: 'zonesoft',
    name: 'Zone Soft',
    family: 'pos',
    blurb: 'ZS POS and ZS Rest sales.',
    status: 'planned',
    fields: [],
    can: none,
    setup: '',
    docs: 'https://developer.zonesoft.org/',
    meanwhile: 'Export the SAF-T (PT) from the back office, or send each sale to the Nau API as it closes.',
  },
  {
    id: 'winrest',
    name: 'WinRest',
    family: 'pos',
    blurb: 'Restaurant sales.',
    status: 'planned',
    fields: [],
    can: none,
    setup: '',
    docs: '',
    meanwhile: 'WinRest publishes no open API. Export the SAF-T (PT) monthly, or ask your reseller to post sales to the Nau API.',
  },
]

export const connectorMeta = (id: string) => CONNECTORS.find((c) => c.id === id)
export const FAMILY_LABEL: Record<Family, string> = { invoicing: 'Invoicing', ecommerce: 'Online shops', pos: 'Point of sale' }
