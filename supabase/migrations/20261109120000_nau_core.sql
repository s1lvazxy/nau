-- Nau core schema — multi-tenant stock & inventory with an AI operator.
-- Every workspace table carries workspace_id; RLS restricts access to members.
-- Writes from the app go through apply_changeset(), one transaction per user action.

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────────── Identity ─────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null default '',
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique,
  nif text,
  sector text not null default 'other',
  region text not null default 'continente' check (region in ('continente', 'madeira', 'acores')),
  currency text not null default 'EUR',
  timezone text not null default 'Europe/Lisbon',
  settings jsonb not null default '{}'::jsonb,
  owner_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'invited' check (status in ('active', 'invited')),
  hue integer not null default 24,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- ───────────────────────────── Catalogue ─────────────────────────────

create table public.locations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  code text not null default '',
  kind text not null default 'store' check (kind in ('warehouse', 'store', 'van')),
  address text,
  is_default boolean not null default false,
  unique (workspace_id, id)
);

create table public.categories (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  hue integer not null default 24,
  at_category text not null default 'M' check (at_category in ('M', 'P', 'A', 'S', 'T')),
  unique (workspace_id, id)
);

create table public.suppliers (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  nif text,
  email text,
  phone text,
  contact text,
  lead_time_days integer not null default 5 check (lead_time_days >= 0),
  min_order_value numeric(12, 2) not null default 0,
  payment_terms text,
  notes text,
  order_days integer[],
  unique (workspace_id, id)
);

create table public.items (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sku text not null,
  name text not null,
  barcode text,
  category_id uuid references public.categories (id) on delete set null,
  unit text not null default 'un' check (unit in ('un', 'kg', 'L', 'cx', 'm')),
  cost numeric(12, 4) not null default 0,
  price numeric(12, 4) not null default 0,
  vat_rate numeric(5, 2) not null default 23,
  reorder_point numeric(14, 3),
  reorder_qty numeric(14, 3),
  safety_days numeric(6, 2) not null default 3,
  supplier_id uuid references public.suppliers (id) on delete set null,
  tracks_expiry boolean not null default false,
  archived boolean not null default false,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  hue integer not null default 24,
  unique (workspace_id, id),
  unique (workspace_id, sku)
);
create index items_barcode_idx on public.items (workspace_id, barcode);

create table public.stock_levels (
  workspace_id uuid not null,
  item_id uuid not null,
  location_id uuid not null,
  on_hand numeric(14, 3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (item_id, location_id),
  foreign key (workspace_id, item_id) references public.items (workspace_id, id) on delete cascade,
  foreign key (workspace_id, location_id) references public.locations (workspace_id, id) on delete cascade
);
create index stock_levels_ws_idx on public.stock_levels (workspace_id);

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  item_id uuid not null,
  location_id uuid not null,
  code text not null,
  expires_on date not null,
  qty numeric(14, 3) not null default 0,
  unique (item_id, location_id, code),
  foreign key (workspace_id, item_id) references public.items (workspace_id, id) on delete cascade,
  foreign key (workspace_id, location_id) references public.locations (workspace_id, id) on delete cascade
);
create index batches_ws_idx on public.batches (workspace_id, expires_on);

-- Immutable ledger: corrections are compensating movements, never edits.
create table public.movements (
  id uuid primary key,
  workspace_id uuid not null,
  item_id uuid not null,
  location_id uuid not null,
  type text not null check (type in ('receipt', 'sale', 'adjustment', 'transfer', 'count', 'waste', 'return')),
  qty numeric(14, 3) not null,
  unit_cost numeric(12, 4),
  ref text,
  note text,
  actor jsonb not null default '{"kind":"user","name":""}'::jsonb,
  created_at timestamptz not null default now(),
  group_id uuid,
  reverts_id uuid,
  batch_code text,
  expires_on date,
  foreign key (workspace_id, item_id) references public.items (workspace_id, id) on delete cascade,
  foreign key (workspace_id, location_id) references public.locations (workspace_id, id) on delete cascade
);
create index movements_ws_time_idx on public.movements (workspace_id, created_at desc);
create index movements_item_idx on public.movements (item_id, created_at desc);

-- ───────────────────────────── Documents ─────────────────────────────

create table public.receipts (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  number text not null,
  supplier_id uuid references public.suppliers (id) on delete set null,
  location_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'posted')),
  doc_ref text,
  doc_date date not null default current_date,
  lines jsonb not null default '[]'::jsonb,
  source text not null default 'manual',
  po_id uuid,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  note text,
  foreign key (workspace_id, location_id) references public.locations (workspace_id, id) on delete cascade
);
create index receipts_ws_idx on public.receipts (workspace_id, created_at desc);

create table public.purchase_orders (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  number text not null,
  supplier_id uuid not null,
  location_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'partial', 'received', 'cancelled')),
  lines jsonb not null default '[]'::jsonb,
  expected_on date,
  created_by text not null default 'user' check (created_by in ('user', 'agent')),
  note text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (workspace_id, location_id) references public.locations (workspace_id, id) on delete cascade,
  foreign key (supplier_id) references public.suppliers (id) on delete cascade
);
create index purchase_orders_ws_idx on public.purchase_orders (workspace_id, created_at desc);

create table public.counts (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  location_id uuid not null,
  status text not null default 'open' check (status in ('open', 'review', 'closed')),
  lines jsonb not null default '[]'::jsonb,
  blind boolean not null default true,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key (workspace_id, location_id) references public.locations (workspace_id, id) on delete cascade
);

-- ───────────────────────────── Operator & autopilot ─────────────────────────────

create table public.proposals (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('reorder', 'transfer', 'markdown', 'count', 'deadstock', 'price')),
  title text not null,
  summary text not null default '',
  rationale jsonb not null default '[]'::jsonb,
  impact_eur numeric(12, 2),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  source text not null default 'autopilot' check (source in ('autopilot', 'operator')),
  fingerprint text not null default ''
);
create index proposals_ws_idx on public.proposals (workspace_id, status, created_at desc);

create table public.playbooks (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null,
  name text not null,
  description text not null default '',
  cadence text not null default 'daily' check (cadence in ('hourly', 'daily', 'weekly')),
  enabled boolean not null default true,
  last_run_at timestamptz,
  unique (workspace_id, key)
);

create table public.dashboards (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  widgets jsonb not null default '[]'::jsonb,
  owner_id uuid,
  position integer not null default 0
);

create table public.events (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null,
  title text not null,
  detail text,
  actor jsonb not null default '{"kind":"system","name":"Nau"}'::jsonb,
  created_at timestamptz not null default now(),
  link text
);
create index events_ws_idx on public.events (workspace_id, created_at desc);

-- ───────────────────────────── Access helpers ─────────────────────────────

create or replace function public.member_role(p_workspace uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.workspace_members
  where workspace_id = p_workspace and user_id = (select auth.uid()) and status = 'active'
  limit 1
$$;

create or replace function public.is_member(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.member_role(p_workspace) is not null $$;

create or replace function public.can_write(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(public.member_role(p_workspace) in ('owner', 'admin', 'member'), false) $$;

create or replace function public.is_admin(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(public.member_role(p_workspace) in ('owner', 'admin'), false) $$;

-- ───────────────────────────── Row level security ─────────────────────────────

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "profiles: read self and teammates" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or exists (
    select 1 from public.workspace_members a join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = (select auth.uid()) and b.user_id = profiles.id
  ));
create policy "profiles: update self" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "workspaces: members read" on public.workspaces for select to authenticated using (public.is_member(id));
create policy "workspaces: admins update" on public.workspaces for update to authenticated using (public.is_admin(id)) with check (public.is_admin(id));

create policy "members: read" on public.workspace_members for select to authenticated using (public.is_member(workspace_id));
create policy "members: admins insert" on public.workspace_members for insert to authenticated with check (public.is_admin(workspace_id));
create policy "members: admins update" on public.workspace_members for update to authenticated using (public.is_admin(workspace_id)) with check (public.is_admin(workspace_id));
create policy "members: admins delete" on public.workspace_members for delete to authenticated using (public.is_admin(workspace_id) and role <> 'owner');

do $$
declare t text;
begin
  foreach t in array array['locations','categories','suppliers','items','stock_levels','batches','movements','receipts','purchase_orders','counts','proposals','playbooks','dashboards','events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%1$s: members read" on public.%1$I for select to authenticated using (public.is_member(workspace_id))', t);
    if t <> 'movements' then
      execute format('create policy "%1$s: writers insert" on public.%1$I for insert to authenticated with check (public.can_write(workspace_id))', t);
      execute format('create policy "%1$s: writers update" on public.%1$I for update to authenticated using (public.can_write(workspace_id)) with check (public.can_write(workspace_id))', t);
      execute format('create policy "%1$s: writers delete" on public.%1$I for delete to authenticated using (public.can_write(workspace_id))', t);
    else
      -- the ledger is append-only
      execute format('create policy "%1$s: writers insert" on public.%1$I for insert to authenticated with check (public.can_write(workspace_id))', t);
    end if;
  end loop;
end $$;

-- ───────────────────────────── Auth hooks ─────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)), coalesce(new.email, ''))
  on conflict (id) do nothing;
  -- Accept pending invitations for this email
  update public.workspace_members
     set user_id = new.id, status = 'active', name = coalesce(nullif(name, ''), new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))
   where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────── RPC: create workspace ─────────────────────────────

create or replace function public.create_workspace(
  p_id uuid,
  p_name text,
  p_slug text,
  p_nif text,
  p_sector text,
  p_region text,
  p_settings jsonb,
  p_owner_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_slug text := coalesce(nullif(p_slug, ''), 'workspace');
begin
  if v_uid is null then
    raise exception 'Sign in to create a workspace' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if exists (select 1 from public.workspaces where slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 5);
  end if;
  insert into public.workspaces (id, name, slug, nif, sector, region, settings, owner_id)
  values (coalesce(p_id, gen_random_uuid()), p_name, v_slug, nullif(p_nif, ''), coalesce(p_sector, 'other'), coalesce(p_region, 'continente'), coalesce(p_settings, '{}'::jsonb), v_uid)
  returning id into p_id;
  insert into public.workspace_members (workspace_id, user_id, name, email, role, status)
  values (p_id, v_uid, coalesce(p_owner_name, ''), coalesce(v_email, ''), 'owner', 'active');
  return p_id;
end $$;

-- ───────────────────────────── RPC: apply a change set atomically ─────────────────────────────

create or replace function public.apply_changeset(p_workspace uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.member_role(p_workspace);
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
  if v_role is null or v_role = 'viewer' then
    raise exception 'You don’t have write access to this workspace' using errcode = '42501';
  end if;

  if p_changes ? 'workspace' then
    if v_role not in ('owner', 'admin') then
      raise exception 'Only owners and admins can change workspace settings' using errcode = '42501';
    end if;
    update public.workspaces w set
      name = coalesce(p_changes -> 'workspace' ->> 'name', w.name),
      nif = case when (p_changes -> 'workspace') ? 'nif' then nullif(p_changes -> 'workspace' ->> 'nif', '') else w.nif end,
      sector = coalesce(p_changes -> 'workspace' ->> 'sector', w.sector),
      region = coalesce(p_changes -> 'workspace' ->> 'region', w.region),
      slug = w.slug,
      settings = coalesce(p_changes -> 'workspace' -> 'settings', w.settings)
    where w.id = p_workspace;
  end if;

  foreach v_tbl in array array['workspace_members','locations','categories','suppliers','items','batches','receipts','purchase_orders','counts','proposals','playbooks','dashboards','events'] loop
    v_rows := p_changes -> 'upserts' -> v_tbl;
    if v_rows is not null and jsonb_typeof(v_rows) = 'array' and jsonb_array_length(v_rows) > 0 then
      if v_tbl = 'workspace_members' and v_role not in ('owner', 'admin') then
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
      if v_tbl = 'workspace_members' and v_role not in ('owner', 'admin') then
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

-- ───────────────────────────── RPC: delete workspace ─────────────────────────────

create or replace function public.delete_workspace(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.member_role(p_workspace) is distinct from 'owner' then
    raise exception 'Only the owner can delete a workspace' using errcode = '42501';
  end if;
  delete from public.workspaces where id = p_workspace;
end $$;

-- ───────────────────────────── Grants ─────────────────────────────

revoke execute on function public.apply_changeset(uuid, jsonb) from public, anon;
revoke execute on function public.create_workspace(uuid, text, text, text, text, text, jsonb, text) from public, anon;
revoke execute on function public.delete_workspace(uuid) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.apply_changeset(uuid, jsonb) to authenticated;
grant execute on function public.create_workspace(uuid, text, text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.delete_workspace(uuid) to authenticated;

-- ───────────────────────────── Realtime ─────────────────────────────

alter publication supabase_realtime add table
  public.movements, public.proposals, public.purchase_orders, public.receipts,
  public.counts, public.items, public.dashboards, public.events;
