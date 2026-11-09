# Running Nau

Nau is one Node server (TanStack Start on Nitro) and, when you want more than one browser to share data, a Postgres database behind Supabase. There are no plans, licences keys or paid features: every installation has everything. All configuration comes from the environment (`.env.example` lists every setting).

Pick the row that fits:

| You want | You need | Features |
| --- | --- | --- |
| To try it | Node 22.9+ and pnpm | Everything that works on your own data: imports, Operator (built-in engine, or the model with a key), journal and undo, policy. Data stays in the browser. |
| Everything, on your machine | The above plus Docker and the Supabase CLI | Adds shared accounts, connectors, the API, webhooks and the scheduled Operator. |
| A company server | A Supabase project (their cloud or self-hosted), a host for one container, a scheduler | The same, for your team. |

## 1. Try it (local mode)

```bash
pnpm install
pnpm dev            # http://localhost:3100
```

Nothing else. Accounts and workspaces live in the browser (IndexedDB). Add `ANTHROPIC_API_KEY` to `.env` to give Operator the model.

## 2. Everything on localhost

```bash
supabase start       # Postgres, auth and the rest, in Docker; applies supabase/migrations
pnpm setup:local     # writes the database address, keys and two generated secrets into .env
pnpm dev
```

`setup:local` only fills values that are empty, so your own settings survive. Sign-up emails land in the local mail catcher (`supabase status` shows its address).

The scheduler does not run by itself on localhost. Trigger it when you want a sync, autopilot and rules pass:

```bash
curl -X POST -H "Authorization: Bearer $(grep ^CRON_SECRET= .env | cut -d= -f2-)" http://localhost:3100/api/cron/tick
```

To let connectors and webhooks reach other services on your machine (a test shop on `localhost`), set `NAU_ALLOW_PRIVATE_HOSTS=1`. Leave it empty anywhere else.

## 3. A company server

### Database

Use a Supabase project — hosted, or [self-hosted Supabase](https://supabase.com/docs/guides/self-hosting) on your own infrastructure.

```bash
supabase link --project-ref <ref>     # or point the CLI at your own stack
supabase db push                       # applies supabase/migrations
```

In Supabase Auth:

- set the site URL to your address and add `/auth/callback` and `/reset-password` as redirect URLs;
- configure SMTP so sign-up and password emails are sent from your domain;
- **decide who may register.** Turn off "Allow new users to sign up" to make the installation invitation-only: an admin invites people by email from Settings → Team, and you create their accounts in Supabase Auth.

### Settings

| Variable | Needed for | Notes |
| --- | --- | --- |
| `VITE_SITE_URL` | links, auth redirects, webhook addresses shown in the app | The address people use, e.g. `https://stock.empresa.pt`. Baked into the browser bundle at build time. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | everything shared | Also baked in at build time. |
| `SUPABASE_SERVICE_ROLE_KEY` | connectors, API, webhooks, scheduled Operator | Server only. |
| `NAU_SECRET_KEY` | connectors | `openssl rand -base64 32`. Seals connector credentials (AES-256-GCM). **Changing or losing it means reconnecting every system.** |
| `CRON_SECRET` | the scheduler | Any long random string. |
| `ANTHROPIC_API_KEY` | Operator with the model, standing rules, reading invoices and photos, column mapping | Optional. Without it Operator uses its built-in engine and rules do not run. |
| `NAU_AGENT_MODEL` | | Optional model id. |
| `ANTHROPIC_BASE_URL` | | Optional: send model calls through your own gateway or proxy. |

`VITE_*` values are public by design (they ship to every browser). Everything else stays on the server.

### Run

```bash
docker compose up -d --build        # the app on :3000 and a small service that calls the scheduler
```

or without Docker:

```bash
pnpm install && pnpm build
PORT=3000 pnpm start                 # reads .env from the working directory
```

Put your reverse proxy with TLS in front, and a rate limit on `/api/*` (the built-in limiter is per process). To publish under your own network rules, nothing else is required: Nau makes outbound calls only to the systems you connect, the webhook addresses you add, and the model provider.

### The scheduler

Nothing runs by itself until something calls the tick. Every five minutes:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://stock.empresa.pt/api/cron/tick
```

`docker-compose.yml` includes a service that does this. Any scheduler works: cron, systemd timers, Kubernetes CronJob, or `pg_cron` with `pg_net` inside Supabase. A tick syncs connections that are due, runs autopilot and standing rules for each workspace about once an hour, and delivers webhooks. It is bounded to about a minute; whatever is left waits for the next one.

## Backups and upgrades

- Back up the Postgres database. Everything Nau knows is in it; the ledger (`movements`) is append-only.
- Keep `NAU_SECRET_KEY` with your backups, separately.
- To upgrade: pull, rebuild, `supabase db push`, restart. Migrations only move forward.

## Making it yours

- **Address, database, model, gateway**: the settings above.
- **Who gets in**: Supabase Auth (open sign-up, invitation-only, Google, SSO on Supabase plans that have it).
- **What Operator may do alone**: per workspace, in Autopilot.
- **Systems**: add a connector (`docs/connectors.md`) or post to the API (`docs/api.md`).
- **The website** at `/` is separate from the app at `/app`; replace or remove it for an internal installation.

The licence is AGPL-3.0: if you change Nau and offer it to others over a network, publish your changes under the same licence.
