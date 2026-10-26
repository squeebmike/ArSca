-- Per-store features for the second-store pilot (2026-10-26).
--
-- Store ask: let another vendor run the dashboard for their own store
-- without reaching anything tied to The Mana Pocket's accounts (eBay
-- listings, Shopify, the comic/FOC workflow, the website). The Worker reads
-- this table (scripts/store-features.mjs); The Mana Pocket is never looked
-- up and always keeps everything. A store with no row gets the pilot
-- defaults: every feature off and a 10 cent platform fee per card sale.
-- Only platform admins change it, through the Worker's /admin routes.

-- grants: service_role only store_features
create table if not exists public.store_features (
  store_id uuid primary key references public.stores(id) on delete cascade,
  ebay boolean not null default false,
  shopify boolean not null default false,
  comics boolean not null default false,
  website boolean not null default false,
  sms boolean not null default false,
  shared_pricing_keys boolean not null default false,
  consignment boolean not null default false,
  whatnot boolean not null default false,
  platform_fee_fixed_cents integer not null default 10 check (platform_fee_fixed_cents between 0 and 10000),
  platform_fee_bps integer not null default 0 check (platform_fee_bps between 0 and 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.store_features enable row level security;
revoke all on public.store_features from public, anon, authenticated;
grant select, insert, update, delete on public.store_features to service_role;

-- The Mana Pocket's row is only for the admin screen: the Worker never reads
-- it and treats the store as all-on regardless.
insert into public.store_features (store_id, ebay, shopify, comics, website, sms, shared_pricing_keys, consignment, whatnot, platform_fee_fixed_cents, platform_fee_bps)
values ('0f9dd4bc-42a7-487e-a972-2905d24513e9', true, true, true, true, true, true, true, true, 0, 0)
on conflict (store_id) do nothing;
