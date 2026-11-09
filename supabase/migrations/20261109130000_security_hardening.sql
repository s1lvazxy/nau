-- Security hardening
-- All writes go through security-definer RPCs (apply_changeset, create_workspace, delete_workspace).
-- Direct table writes from clients are removed so members cannot edit stock without a ledger entry
-- or change rows outside the role checks those functions make.

drop policy if exists "workspaces: admins update" on public.workspaces;
drop policy if exists "members: admins insert" on public.workspace_members;
drop policy if exists "members: admins update" on public.workspace_members;
drop policy if exists "members: admins delete" on public.workspace_members;

do $$
declare t text;
begin
  foreach t in array array['locations','categories','suppliers','items','stock_levels','batches','movements','receipts','purchase_orders','counts','proposals','playbooks','dashboards','events'] loop
    execute format('drop policy if exists "%1$s: writers insert" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: writers update" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: writers delete" on public.%1$I', t);
  end loop;
end $$;

-- Belt and braces: no table-level write privileges for client roles either.
revoke insert, update, delete on all tables in schema public from anon, authenticated;
grant update (name) on public.profiles to authenticated;
