# Nau — product

**What it is.** Open-source (AGPL-3.0) stock and inventory for small and medium businesses in Portugal (delis, cafés, restaurants, shops, pharmacies, hardware stores, online shops). There are no plans or paid features: it runs on a laptop for one person or on a company server for a team, configured from the environment. Languages: website and onboarding in Portuguese (Portugal); the app in English for now. Market conventions: Portuguese (NIF, IVA by region, AT year-end inventory file, SAF-T (PT), Portuguese holidays, supplier emails in Portuguese).

**Promise.** Inventory that runs itself, where people only validate: sales arrive from the systems a shop already uses, and Operator — an AI agent with the run of the platform — does the work inside a policy the owner sets. Reversible work is done and journalled with an undo; money waits for a person unless a euro limit says otherwise.

**Who uses it.**
- Owner (desktop, mornings): brief, approvals, money tied up, margins.
- Floor / warehouse staff (phone, all day): receive deliveries, scan, count, transfer.
- Accountant (viewer): valuation, ledger, AT export.

**Differentiators.**
0. One door for data: spreadsheets, SAF-T, photos of invoices and shelves, connectors (Moloni, InvoiceXpress, Vendus, Shopify, WooCommerce, Square, SumUp — beta) and a public API with webhooks, all through the same ingest. Onboarding is built around where the data comes from.
1. Operator: agentic AI with 36 tools over the whole platform, a policy (reversible / money / outbound, per-action and per-day limits), a journal with undo, and standing rules in plain language that it runs by itself on the server.
2. Autopilot playbooks: reorder by supplier (lead time, minimum order), rebalance locations, expiry markdowns, dead stock release, cycle counts, supplier price watch, morning brief.
3. Snap-to-receive: read the fatura or guia from a photo/PDF, match lines, flag price changes and short deliveries.
4. Dashboards your way: multiple dashboards, drag/resize, widget gallery, “describe a widget”, accent and theme.
5. Portugal-native: NIF validation, IVA mainland/Madeira/Azores, AT inventory CSV (Portaria 2/2015), SAF-T import, Santos Populares in forecasts.
6. Immutable ledger with one-click revert; blind counts on the phone; lots with FEFO.

**Voice.** Plain, specific, calm. Numbers, names and dates over adjectives. No hype, no exclamation marks.

**Truth constraints.** Nau is not certified invoicing software and never claims to issue fiscal documents. No fabricated customers, logos, testimonials or statistics. Connectors are called beta until each has run against a live account. Operator never records a physical move it decided on its own, and never widens its own policy.
