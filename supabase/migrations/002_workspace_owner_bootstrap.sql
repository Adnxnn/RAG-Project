create or replace function public.add_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (workspace_id, user_id) do update set role = 'owner';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_owner_after_insert on public.workspaces;
create trigger workspace_owner_after_insert
after insert on public.workspaces
for each row execute function public.add_workspace_owner();

create policy "creators can read newly created workspaces" on public.workspaces
for select using (created_by = auth.uid() or public.is_workspace_member(id));
