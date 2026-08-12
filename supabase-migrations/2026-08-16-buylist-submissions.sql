-- Public "sell to us" buylist submissions: customers submit a list of items
-- they want to sell from a public page (no login), staff reviews remotely
-- and reaches out to make an offer -- instead of walk-in-only intake being
-- the only way a store finds out someone wants to sell something.

create table if not exists public.buylist_submissions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  contact_name text not null,
  contact_email text,
  contact_phone text,
  notes text,
  -- Each item is {description, category, condition, estimatedValue}. Kept
  -- as a single jsonb blob (like consignment_items keeps no separate line-
  -- item table) since a submission is reviewed as a whole, not queried by
  -- individual item field.
  items jsonb not null default '[]'::jsonb,
  status text not null default 'new',
  staff_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_buylist_submissions_store on public.buylist_submissions(store_id, status, created_at desc);

alter table public.buylist_submissions enable row level security;

drop policy if exists buylist_submissions_select_member on public.buylist_submissions;
create policy buylist_submissions_select_member on public.buylist_submissions for select using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
drop policy if exists buylist_submissions_update_employee on public.buylist_submissions;
create policy buylist_submissions_update_employee on public.buylist_submissions for update using (public.current_store_role(store_id) in ('owner','admin','manager','employee')) with check (public.current_store_role(store_id) in ('owner','admin','manager','employee'));

-- Inserts come from the PUBLIC page with no authenticated user at all, so
-- they go through the Worker's service-role key (like storefront_orders'
-- /public/storefront/record-order), not a client-side Supabase insert --
-- no public insert policy is needed or granted here.
