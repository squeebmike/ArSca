-- Prevent Auth user deletion from cascading into an entire store workspace.
-- Also remove direct auth.users reads from invite RLS policies.
-- Safe to re-run in Supabase SQL Editor.

begin;

alter table public.stores alter column owner_user_id drop not null;
alter table public.stores drop constraint if exists stores_owner_user_id_fkey;
alter table public.stores
  add constraint stores_owner_user_id_fkey
  foreign key (owner_user_id) references auth.users(id) on delete set null;

drop policy if exists store_invites_select on public.store_invites;
drop policy if exists store_invites_select_owner_admin_or_self on public.store_invites;
create policy store_invites_select_owner_admin_or_self
on public.store_invites for select
using (
  public.can_manage_store(store_id)
  or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

drop policy if exists store_invites_update on public.store_invites;
drop policy if exists store_invites_update_owner_admin on public.store_invites;
create policy store_invites_update_owner_admin
on public.store_invites for update
using (public.can_manage_store(store_id))
with check (public.can_manage_store(store_id));

commit;
