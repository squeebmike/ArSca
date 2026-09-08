-- Lets a customer self-report "notify me about this" directly from the
-- public storefront (storefront.html), instead of that only being
-- possible today by calling/messaging the store so staff can type it into
-- the existing Want List. That Want List is KV-backed (see
-- pos_wantlist / /kv/wantlist in dashboard.html) and replaces its
-- *entire* array on every save -- the client reads the full list,
-- mutates it, and POSTs the whole thing back. That's fine for one
-- authenticated staff device at a time, but unsafe to expose to anonymous
-- public writes: two concurrent customer submissions (or a malformed/
-- malicious POST) could clobber the whole store's want list.
--
-- This gets its own real table instead. The public route only ever
-- INSERTs a row, via the Worker's service-role key (same pattern as
-- storefront_orders/checkout -- see 2026-07-23-storefront-orders.sql) --
-- anonymous customers never get a direct table grant. Staff review
-- requests from the dashboard and convert whichever ones they want into
-- a real Want List entry (which still goes through the existing,
-- already-trusted add-want flow) -- this table never talks to Want List
-- directly, so neither system can corrupt the other.

create table if not exists public.storefront_notify_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  item_text text not null,
  contact_email text not null,
  status text not null default 'new' check (status in ('new','converted','dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists storefront_notify_requests_store_status
  on public.storefront_notify_requests (store_id, status, created_at desc);

alter table public.storefront_notify_requests enable row level security;

-- All writes happen server-side from the Worker via the service-role key
-- (bypasses RLS), same as storefront_orders/pos_sales. Authenticated store
-- staff can only read and update (convert/dismiss) their own store's
-- requests -- no direct insert policy, since customers are anonymous.
drop policy if exists storefront_notify_requests_select_member on public.storefront_notify_requests;
create policy storefront_notify_requests_select_member on public.storefront_notify_requests
  for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

drop policy if exists storefront_notify_requests_update_employee on public.storefront_notify_requests;
create policy storefront_notify_requests_update_employee on public.storefront_notify_requests
  for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee'))
  with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
