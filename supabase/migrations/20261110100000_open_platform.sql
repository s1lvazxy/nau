-- Open platform: the Operator journal with undo, standing rules, connectors, the public API,
-- outbound webhooks and a service-side write path for the headless agent.
--
-- Trust model
--   · Browsers still write only through apply_changeset() under their own role.
--   · The server (connectors, API keys, the scheduled agent) writes through apply_changeset_service(),
--     executable by the service role alone. Both share one implementation, so the ledger, lots
--     and idempotency behave identically.
--   · Connector secrets, API key hashes and webhook signing secrets live in tables that no client
--     role can read: row-level security is on and there is no policy.

-- ───────────────────────────── Scheduler ─────────────────────────────
-- When the headless Operator last ran for a workspace.

alter table public.workspaces add column agent_ran_at timestamptz;

-- ───────────────────────────── Journal and rules ─────────────────────────────

create table public.actions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null,
  risk text not null default 'reversible' check (risk in ('reversible', 'money', 'outbound')),
  title text not null,
  lines jsonb not null default '[]'::jsonb,
  impact_eur numeric(12, 2),
  cs jsonb not null default '{}'::jsonb,
  undo jsonb,
  status text not null default 'pending' check (status in ('pending', 'applied', 'undone', 'rejected')),
  source text not null default 'operator' check (source in ('operator', 'autopilot', 'integration', 'import', 'api', 'rule')),
  actor jsonb not null default '{"kind":"agent","name":"Operator"}'::jsonb,
  -- Who approved it; null when Operator ran it alone (only those count against the daily limit)
  approved_by text,
  reason text,
  link text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index actions_ws_idx on public.actions (workspace_id, status, created_at desc);

create table public.rules (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  instruction text not null check (char_length(instruction) between 1 and 2000),
  "trigger" text not null default 'daily' check ("trigger" in ('hourly', 'daily', 'weekly', 'on_sync', 'on_receipt')),
  enabled boolean not null default true,
  created_by text not null default 'user' check (created_by in ('user', 'agent')),
  created_at timestamptz not null default now(),
  last_run_at timestamptz,
  last_result text
);
create index rules_ws_idx on public.rules (workspace_id);

alter table public.actions enable row level security;
alter table public.rules enable row level security;
create policy "actions: members read" on public.actions for select to authenticated using (public.is_member(workspace_id));
create policy "rules: members read" on public.rules for select to authenticated using (public.is_member(workspace_id));
revoke insert, update, delete on public.actions, public.rules from anon, authenticated;
alter publication supabase_realtime add table public.actions;

-- ───────────────────────────── Connectors, API keys, webhooks (server only) ─────────────────────────────

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  connector text not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'error')),
  config jsonb not null default '{}'::jsonb,
  cursor jsonb not null default '{}'::jsonb,
  -- AES-256-GCM, sealed by the server with NAU_SECRET_KEY
  secrets text,
  -- Shared secret for inbound webhooks from the connected system
  hook_secret text,
  last_sync_at timestamptz,
  last_error text,
  last_report jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index integrations_ws_idx on public.integrations (workspace_id);

create table public.integration_links (
  integration_id uuid not null references public.integrations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('item', 'supplier', 'location', 'doc')),
  external_ref text not null,
  internal_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (integration_id, kind, external_ref)
);
create index integration_links_internal_idx on public.integration_links (workspace_id, kind, internal_id);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  prefix text not null,
  -- SHA-256 of the key; the key itself is shown once and never stored
  hash text not null unique,
  scopes text[] not null default '{read}',
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_ws_idx on public.api_keys (workspace_id);

create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  url text not null check (url ~ '^https://'),
  secret text not null,
  events text[] not null default '{*}',
  active boolean not null default true,
  -- Events after this instant are still to be delivered
  cursor timestamptz not null default now(),
  failures integer not null default 0,
  last_status integer,
  last_delivery_at timestamptz,
  created_at timestamptz not null default now()
);
create index webhooks_ws_idx on public.webhooks (workspace_id);

alter table public.integrations enable row level security;
alter table public.integration_links enable row level security;
alter table public.api_keys enable row level security;
alter table public.webhooks enable row level security;
revoke all on public.integrations, public.integration_links, public.api_keys, public.webhooks from anon, authenticated;

-- ───────────────────────────── One write path, two doors ─────────────────────────────

create or replace function public._apply_changeset(p_workspace uuid, p_changes jsonb, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tbl text;
  v_rows jsonb;
  v_cols text;
  v_select text;
  v_insert_cols text;
  v_m jsonb;
  v_inserted uuid;
  v_qty numeric;
  v_tracks boolean;
  v_remaining numeric;
  v_lot record;
  v_take numeric;
begin
  if p_role is null or p_role = 'viewer' then
    raise exception 'You don’t have write access to this workspace' using errcode = '42501';
  end if;

  if p_changes ? 'workspace' then
    if p_role not in ('owner', 'admin') then
      raise exception 'Only owners and admins can change workspace settings' using errcode = '42501';
    end if;
    update public.workspaces w set
      name = coalesce(p_changes -> 'workspace' ->> 'name', w.name),
      nif = case when (p_changes -> 'workspace') ? 'nif' then nullif(p_changes -> 'workspace' ->> 'nif', '') else w.nif end,
      sector = coalesce(p_changes -> 'workspace' ->> 'sector', w.sector),
      region = coalesce(p_changes -> 'workspace' ->> 'region', w.region),
      settings = coalesce(p_changes -> 'workspace' -> 'settings', w.settings)
    where w.id = p_workspace;
    -- `slug` is fixed at creation.
  end if;

  -- Tables are walked in dependency order: per table, upserts first, then removals.
  foreach v_tbl in array array['workspace_members','locations','categories','suppliers','items','batches','receipts','purchase_orders','counts','proposals','playbooks','dashboards','events','actions','rules'] loop
    v_rows := p_changes -> 'upserts' -> v_tbl;
    if v_rows is not null and jsonb_typeof(v_rows) = 'array' and jsonb_array_length(v_rows) > 0 then
      if v_tbl = 'workspace_members' and p_role not in ('owner', 'admin') then
        raise exception 'Only owners and admins can manage the team' using errcode = '42501';
      end if;
      -- Columns missing from the payload fall back to their database defaults.
      select string_agg(format('%I = excluded.%I', column_name, column_name), ', ') filter (where column_name not in ('id', 'workspace_id', 'user_id')),
             string_agg(case when column_default is not null then format('coalesce(r.%I, %s)', column_name, column_default) else format('r.%I', column_name) end, ', ' order by ordinal_position),
             string_agg(format('%I', column_name), ', ' order by ordinal_position)
        into v_cols, v_select, v_insert_cols
        from information_schema.columns
       where table_schema = 'public' and table_name = v_tbl;
      execute format(
        'insert into public.%1$I as t (%2$s) select %3$s from jsonb_populate_recordset(null::public.%1$I, $1) r
           on conflict (id) do update set %4$s where t.workspace_id = excluded.workspace_id',
        v_tbl, v_insert_cols, v_select, v_cols)
      using (
        select jsonb_agg((case when v_tbl = 'workspace_members' then e - 'user_id' else e end) || jsonb_build_object('workspace_id', p_workspace))
        from jsonb_array_elements(v_rows) e
      );
    end if;

    v_rows := p_changes -> 'removes' -> v_tbl;
    if v_rows is not null and jsonb_typeof(v_rows) = 'array' and jsonb_array_length(v_rows) > 0 then
      if v_tbl = 'workspace_members' and p_role not in ('owner', 'admin') then
        raise exception 'Only owners and admins can manage the team' using errcode = '42501';
      end if;
      execute format(
        'delete from public.%I where workspace_id = $1 and id in (select (jsonb_array_elements_text($2))::uuid)%s',
        v_tbl, case when v_tbl = 'workspace_members' then ' and role <> ''owner''' else '' end)
      using p_workspace, v_rows;
    end if;
  end loop;

  -- Stock movements: append to the ledger, then update levels and lots (FEFO on outflows).
  if jsonb_typeof(p_changes -> 'movements') = 'array' then
    for v_m in select value from jsonb_array_elements(p_changes -> 'movements') loop
      insert into public.movements
        select * from jsonb_populate_record(null::public.movements, v_m || jsonb_build_object('workspace_id', p_workspace))
      on conflict (id) do nothing
      returning id into v_inserted;
      continue when v_inserted is null; -- idempotent retries

      v_qty := (v_m ->> 'qty')::numeric;
      insert into public.stock_levels (workspace_id, item_id, location_id, on_hand)
      values (p_workspace, (v_m ->> 'item_id')::uuid, (v_m ->> 'location_id')::uuid, v_qty)
      on conflict (item_id, location_id) do update
        set on_hand = public.stock_levels.on_hand + excluded.on_hand, updated_at = now();

      select tracks_expiry into v_tracks from public.items where id = (v_m ->> 'item_id')::uuid and workspace_id = p_workspace;
      if coalesce(v_tracks, false) then
        if v_qty > 0 and nullif(v_m ->> 'batch_code', '') is not null then
          insert into public.batches (workspace_id, item_id, location_id, code, expires_on, qty)
          values (p_workspace, (v_m ->> 'item_id')::uuid, (v_m ->> 'location_id')::uuid, v_m ->> 'batch_code',
                  coalesce((v_m ->> 'expires_on')::date, current_date + 30), v_qty)
          on conflict (item_id, location_id, code) do update
            set qty = public.batches.qty + excluded.qty,
                expires_on = coalesce((v_m ->> 'expires_on')::date, public.batches.expires_on);
        elsif v_qty < 0 then
          v_remaining := -v_qty;
          for v_lot in
            select id, qty from public.batches
             where item_id = (v_m ->> 'item_id')::uuid and location_id = (v_m ->> 'location_id')::uuid and qty > 0
               and (nullif(v_m ->> 'batch_code', '') is null or code = v_m ->> 'batch_code')
             order by expires_on
             for update
          loop
            exit when v_remaining <= 0;
            v_take := least(v_lot.qty, v_remaining);
            update public.batches set qty = qty - v_take where id = v_lot.id;
            v_remaining := v_remaining - v_take;
          end loop;
        end if;
      end if;
    end loop;
    delete from public.batches where workspace_id = p_workspace and qty <= 0.0001;
  end if;

  if jsonb_typeof(p_changes -> 'events') = 'array' and jsonb_array_length(p_changes -> 'events') > 0 then
    insert into public.events
      select * from jsonb_populate_recordset(null::public.events,
        (select jsonb_agg(e || jsonb_build_object('workspace_id', p_workspace)) from jsonb_array_elements(p_changes -> 'events') e))
    on conflict (id) do nothing;
  end if;
end $$;

create or replace function public.apply_changeset(p_workspace uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._apply_changeset(p_workspace, p_changes, public.member_role(p_workspace));
end $$;

-- The server acts with an admin's reach inside the one workspace it was asked to touch.
create or replace function public.apply_changeset_service(p_workspace uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.workspaces where id = p_workspace) then
    raise exception 'Unknown workspace' using errcode = 'P0002';
  end if;
  perform public._apply_changeset(p_workspace, p_changes, 'admin');
end $$;

revoke execute on function public._apply_changeset(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.apply_changeset_service(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_changeset_service(uuid, jsonb) to service_role;
revoke execute on function public.apply_changeset(uuid, jsonb) from public, anon;
grant execute on function public.apply_changeset(uuid, jsonb) to authenticated;
