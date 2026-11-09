# Nau — inventory that runs itself

Open-source stock, deliveries and reorders for small and medium businesses in Portugal. Sales arrive by themselves from the systems a shop already uses, **Operator** — an AI agent with the run of the platform — does the work, and people validate.

- **One door for data.** Spreadsheets, SAF-T (PT) files, photos of invoices and shelves, seven connectors and a public API all become the same batch and go through the same `ingest()`.
- **An agent that acts, inside a policy.** Operator builds the catalogue, drafts orders, opens counts, writes its own standing rules and changes settings. Reversible work is applied and journalled with an **undo**; money and anything that leaves Nau wait for a person unless a euro limit says otherwise. It never widens its own authority.
- **One write path.** Every change is a change set applied in one transaction to an append-only ledger. The browser, connectors, the API and the scheduled agent all use it.

Licence: [AGPL-3.0](LICENSE). There are no plans or paid features: every installation has everything, on a laptop or on a company server, configured entirely from the environment.

## What is in the box

- **Website** — `/` (dark, in PT-PT): the Nau mark as dark glass rendered live in WebGPU, a bento of six lit scenes, a pinned Autopilot run, a centred Operator prompt on the real engine, the real dashboard tilting upright, a typographic index of the Portuguese details. Also `/brand`, `/contact`, `/legal/*`.
- **Account** — `/signup`, `/login` (password, magic link, Google), password reset.
- **Onboarding** — `/onboarding` (PT-PT), built around where the data comes from: a spreadsheet, invoicing software (SAF-T or a connected account), another stock system, or paper. Files are read in the browser, the columns are recognised (by the model when there is one, by built-in rules otherwise), and a manifest shows what was understood before anything is created.
- **Product** — `/app`: dashboards, approvals and the journal, items, receive, orders, counts, ledger, suppliers, locations, integrations, insights, autopilot (playbooks, rules, policy), scanner, settings.
- **Live demo** — `/demo`: a deli with two shops and a warehouse, 54 products and 90 days of history, entirely in the browser.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3100
```

With no configuration Nau runs in **local mode**: accounts and workspaces live in the browser (IndexedDB, PBKDF2-hashed passwords) and Operator uses its built-in engine. Imports, the journal, undo and the policy all work.

For everything on your machine — shared accounts, connectors, the API, webhooks, the scheduled Operator:

```bash
supabase start       # local Postgres and auth, in Docker
pnpm setup:local     # fills .env from the running stack and generates the server secrets
pnpm dev
```

For a company server, see [docs/self-hosting.md](docs/self-hosting.md): one container, a Supabase project, and a scheduler.

```bash
pnpm test                          # unit tests: domain, ingest, connectors, policy, undo, Operator tools
supabase start && pnpm test:int    # plus Postgres: tenancy, the server write path, sync, API, webhooks, tick
pnpm typecheck && pnpm build && pnpm start
```

## Integrations

| System | Family | Status |
| --- | --- | --- |
| Moloni, InvoiceXpress | Invoicing | beta |
| Vendus, Square, SumUp | Point of sale | beta |
| Shopify, WooCommerce | Online shops, with stock written back and live webhooks | beta |
| TOConline, Zone Soft, WinRest | | planned — today they come in as SAF-T or through the API |
| Anything else | [REST API and webhooks](docs/api.md), SAF-T (PT), Excel, CSV | available |

**Beta is literal**: each connector is built and tested against the vendor's public documentation with recorded response shapes, and none has yet been run against a live account. WooCommerce is also exercised end to end against a local stand-in shop. See [docs/connectors.md](docs/connectors.md) for the contract and how to add one.

What a sync does: products are matched by link, SKU, barcode, then exact name, and created when new; the first sync sets stock as "the level today, after the history"; sales and refunds become ledger movements with ids derived from the vendor's own references, so a replay changes nothing; each sync is one journal entry that can be undone.

## Operator

```bash
ANTHROPIC_API_KEY=...            # server-side only
NAU_AGENT_MODEL=claude-opus-5-5  # optional (default)
NAU_AGENT_DEMO=off               # optional: keep the public demo on the built-in engine
```

- **Tools** are defined once in `src/agent/schema.ts` (zod → JSON Schema): 36 of them. Reading: overview, items, forecasts, reports, the ledger, deliveries, the journal, the workspace's own setup. Writing: catalogue in bulk, suppliers, categories, locations, orders, deliveries, counts, dashboards, settings, playbooks, standing rules, the policy, undo.
- **The policy** (`src/agent/policy.ts`) sorts every write into reversible, money or outbound. Reversible work runs and is journalled with an undo spec that restores only the fields it touched. Money and outbound run alone only under the per-action and per-day limits. Two things always wait for a person: a physical move Operator decided by itself, and any change to the policy.
- **In the chat**, tools run in the browser against the person's own data and permissions; `src/routes/api/agent.ts` streams Claude with adaptive thinking and prompt caching. Without a key, `src/agent/offline.ts` — a deterministic intent engine — drives the same tools.
- **With nobody watching**, `src/server/agent-run.ts` runs the same tools on the server: the deterministic autopilot first (paperwork suggestions become draft orders and counts when the policy allows), then each standing rule whose turn it is. A rule is a plain-language instruction with a trigger; its last report is shown beside it.
- `/api/extract` reads supplier invoices, delivery notes and shelf photos; `/api/import/map` reads spreadsheet headers. Both send only what is needed and both have a fallback without the model.

## The scheduler

Nothing runs by itself until something calls the tick, every five minutes:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-nau/api/cron/tick
```

It syncs connections that are due, runs autopilot and rules for each workspace about once an hour, and delivers webhooks. `docker-compose.yml` ships a service that does this.

## Database

`supabase/migrations/` — apply with `supabase db push` (hosted) or `supabase start` (local Docker).

- Every workspace table carries `workspace_id`; **row-level security** lets members read only their own workspace.
- **Clients cannot write tables directly.** `apply_changeset()` checks the member's role, upserts rows scoped to the workspace, appends to the immutable ledger and updates levels and lots (FEFO), in one transaction, idempotent on retry.
- **The server** writes through `apply_changeset_service()`, executable by the service role alone, with the same implementation.
- Connector credentials (sealed with `NAU_SECRET_KEY`), API key hashes and webhook secrets live in tables no client role can read.

## Deploy

The build uses Nitro, so the same code deploys to Node, Docker, Vercel or Cloudflare:

```bash
pnpm build && PORT=3000 pnpm start                 # Node
docker compose up -d --build                       # Docker, with the scheduler
NITRO_PRESET=vercel pnpm build                     # Vercel
NITRO_PRESET=cloudflare-module pnpm build          # Cloudflare Workers
```

Security headers and asset caching are set in `vite.config.ts`. Put a rate limit in front of `/api/*` in production — the built-in limiter is per instance. See [SECURITY.md](SECURITY.md).

## Architecture

```
src/
  lib/          domain types, PT rules (NIF, IVA, holidays, AT export), analytics engine, demo seed
  data/         change sets, undo, local + cloud backends, session store, domain commands
  ingest/       the one door: batch format, ingest(), spreadsheets, SAF-T, file reading
  connectors/   catalogue (shared with the browser), safe HTTP, one implementation per system
  agent/        tool schemas, executors, policy and journal, autopilot pass, offline engine, chat runtime
  server/       service-role database access, sync, public API, webhooks, scheduler, headless Operator
  components/   brand, ui primitives, charts, dashboard, operator chat, onboarding, landing
  routes/       TanStack Start file routes (SSR marketing, client-only /app, server API routes)
supabase/       config + migrations
docs/           API, connectors, self-hosting
```

**Stack**: TanStack Start / Router / Query / Table / Virtual / Form, React 19, Supabase, Zustand, Base UI, Tailwind v4 with Radix Colors, Phosphor, GSAP + ScrollTrigger, vgpu (WebGPU), NumberFlow, react-grid-layout, cmdk, Sonner, zod, read-excel-file, Anthropic SDK, Nitro.

## Known gaps

- Each beta connector still has to be run against a real account.
- Sending a purchase order opens the person's mail client. A mail provider is needed before Operator can send one by itself.
- The app is in English; the website and onboarding are in Portuguese.
- The Terms, Privacy Policy and DPA under `/legal` are templates for whoever hosts an installation, and the website shows placeholder contact addresses (`hello@nau.pt`, `privacy@nau.pt`). Replace both before putting an installation in front of other people.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most useful contribution today is a run of a beta connector against a real account.
