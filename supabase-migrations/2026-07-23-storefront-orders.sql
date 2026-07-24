-- Storefront checkout orders: local pickup / shipping purchases made through
-- the public storefront (storefront.html), paid via Stripe Connect.
-- Run after pos-money-ledger.sql (needs public.pos_sales) and
-- walkoff-auth-workspaces.sql (needs public.stores, public.store_members).

create table if not exists public.storefront_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id text not null references public.pos_sales(id) on delete cascade,
  confirmation_number text not null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  fulfillment_method text not null, -- 'pickup_fedway' | 'pickup_kitsap' | 'shipping'
  shipping_address jsonb,
  shipping_fee_cents integer not null default 0,
  fulfillment_status text not null default 'pending', -- 'pending' | 'fulfilled' | 'canceled'
  notes text,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  fulfilled_by uuid references auth.users(id) on delete set null
);

create unique index if not exists storefront_orders_confirmation_idx
  on public.storefront_orders (store_id, confirmation_number);
create index if not exists storefront_orders_store_idx
  on public.storefront_orders (store_id, created_at desc);
create index if not exists storefront_orders_sale_idx
  on public.storefront_orders (sale_id);

alter table public.storefront_orders enable row level security;

-- All writes happen server-side from the Worker via the service-role key
-- (bypasses RLS), same as pos_sales/pos_payments. Authenticated store staff
-- can only read and update (mark fulfilled) their own store's orders.
drop policy if exists "store members read own storefront orders" on public.storefront_orders;
create policy "store members read own storefront orders" on public.storefront_orders
  for select using (
    exists (
      select 1 from public.store_members m
      where m.store_id = storefront_orders.store_id
        and m.user_id = auth.uid()
        and m.active = true
    )
  );

drop policy if exists "store members update own storefront orders" on public.storefront_orders;
create policy "store members update own storefront orders" on public.storefront_orders
  for update using (
    exists (
      select 1 from public.store_members m
      where m.store_id = storefront_orders.store_id
        and m.user_id = auth.uid()
        and m.active = true
    )
  );
