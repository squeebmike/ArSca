begin;

-- Additive to 2026-08-17-foc-preorders.sql: a per-SKU safety-stock reserve
-- (protects against damage/short-ship/allocation mistakes once a shipment
-- is received) and an immutable snapshot of a submitted PRH order, so later
-- customer/eBay sales can never silently change what a historical PRH
-- order actually asked for.

alter table public.comic_skus
  add column if not exists safety_stock_qty integer not null default 0 check (safety_stock_qty >= 0);

create table if not exists public.foc_prh_submissions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  cycle_id uuid not null references public.foc_cycles(id) on delete cascade,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  -- One row per SKU as it stood at submit time: {skuId, upc, title,
  -- variantLabel, coverArtist, msrpCents, ourCostCents, finalQty,
  -- websitePresold, ebayPresold, whatnotStoreQty}. Frozen on write; later
  -- edits to comic_skus never retroactively change this.
  line_items jsonb not null default '[]'::jsonb,
  total_skus integer not null default 0 check (total_skus >= 0),
  total_units integer not null default 0 check (total_units >= 0),
  estimated_wholesale_cents integer not null default 0 check (estimated_wholesale_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (cycle_id)
);

create index if not exists idx_foc_prh_submissions_store on public.foc_prh_submissions(store_id);

alter table public.foc_prh_submissions enable row level security;

create policy foc_prh_submissions_staff_select on public.foc_prh_submissions for select to authenticated
  using (public.current_store_role(store_id) in ('owner','admin','manager','employee'));
create policy foc_prh_submissions_staff_insert on public.foc_prh_submissions for insert to authenticated
  with check (public.current_store_role(store_id) in ('owner','admin'));

commit;
