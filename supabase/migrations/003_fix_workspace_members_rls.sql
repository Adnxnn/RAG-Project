-- Fix infinite recursion in workspace_members RLS policies.
-- The previous policies queried workspace_members while PostgreSQL was already
-- evaluating a workspace_members policy.

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace
      and wm.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_admin(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.is_workspace_admin(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;

drop policy if exists "members read workspace members" on public.workspace_members;
drop policy if exists "owners manage workspace members" on public.workspace_members;
drop policy if exists "users read own workspace memberships" on public.workspace_members;
drop policy if exists "admins read workspace memberships" on public.workspace_members;
drop policy if exists "admins insert workspace memberships" on public.workspace_members;
drop policy if exists "admins update workspace memberships" on public.workspace_members;
drop policy if exists "admins delete workspace memberships" on public.workspace_members;

-- A user can always read their own membership row. Workspace owners/admins can
-- read and manage the remaining membership rows through non-recursive helper
-- functions that explicitly bypass RLS while performing the membership check.
create policy "users read own workspace memberships"
on public.workspace_members
for select
to authenticated
using (user_id = auth.uid());

create policy "admins read workspace memberships"
on public.workspace_members
for select
to authenticated
using (public.is_workspace_admin(workspace_id));

create policy "admins insert workspace memberships"
on public.workspace_members
for insert
to authenticated
with check (public.is_workspace_admin(workspace_id));

create policy "admins update workspace memberships"
on public.workspace_members
for update
to authenticated
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

create policy "admins delete workspace memberships"
on public.workspace_members
for delete
to authenticated
using (public.is_workspace_admin(workspace_id));

-- Remove the remaining direct self-query from the workspaces update policy.
drop policy if exists "owners update workspaces" on public.workspaces;
create policy "owners update workspaces"
on public.workspaces
for update
to authenticated
using (public.is_workspace_admin(id))
with check (public.is_workspace_admin(id));

-- Ensure automatic owner creation also executes outside RLS evaluation.
create or replace function public.add_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if new.created_by is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (workspace_id, user_id)
    do update set role = excluded.role;
  end if;
  return new;
end;
$$;
