-- Scanner queue: role check once per query, not once per row.
--
-- Weekly health check (2026-10-09): the dashboard's scan-inbox read was the
-- slowest regular request (~0.9 s mean, 4.7 s worst). Each row-level
-- policy called current_store_role(store_id) and auth.uid() for every row
-- -- 14,771 pending rows, almost all Pocket Scout eBay comp candidates
-- (they carry a session_id; phone-scanner hand-offs don't).
--
-- Same access as before:
--   select/update: owner, admin, manager or employee of the row's store, or
--                  the row's creator
--   insert:        any of those roles or scanner_only, as yourself
-- "Has an active membership with one of these roles" is the same test as
-- "current_store_role() is one of these roles": that function returns the
-- member's highest role, and every role it ranks is in the enum order
-- owner > admin > manager > employee > scanner_only.
--
-- Applied 2026-10-09. Measured as the store owner, the inbox read went
-- from 327 ms (role lookup run 14,771 times) to 12 ms, and to 1.7 ms
-- with the dashboard asking for phone hand-offs only.

create or replace function public.my_store_ids(roles public.store_role[])
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select sm.store_id
  from public.store_members sm
  where sm.user_id = auth.uid()
    and sm.active = true
    and sm.role = any(roles);
$$;
revoke all on function public.my_store_ids(public.store_role[]) from public;
grant execute on function public.my_store_ids(public.store_role[]) to authenticated, service_role;

-- ALTER POLICY edits each rule in place (no moment with the rule missing).
alter policy scan_queue_select_member_limited on public.scan_queue
  using (
    store_id in (select public.my_store_ids(array['owner','admin','manager','employee']::public.store_role[]))
    or created_by = (select auth.uid())
  );

alter policy scan_queue_update_employee on public.scan_queue
  using (
    store_id in (select public.my_store_ids(array['owner','admin','manager','employee']::public.store_role[]))
    or created_by = (select auth.uid())
  )
  with check (
    store_id in (select public.my_store_ids(array['owner','admin','manager','employee']::public.store_role[]))
    or created_by = (select auth.uid())
  );

alter policy scan_queue_insert_scanner on public.scan_queue
  with check (
    store_id in (select public.my_store_ids(array['owner','admin','manager','employee','scanner_only']::public.store_role[]))
    and created_by = (select auth.uid())
  );

-- The dashboard inbox only wants phone-scanner hand-offs (no session_id).
create index if not exists scan_queue_phone_pending_idx
  on public.scan_queue (store_id, created_at desc)
  where status = 'pending' and session_id is null;
