-- Per-store pricing API keys for the second-store pilot (2026-10-26).
--
-- Store ask: "I'd also want them to be able to plug in their own API keys in
-- the dashboard so they can use their own credits." A store other than The
-- Mana Pocket enters its PokemonPriceTracker, PriceCharting and JustTCG keys
-- in Settings -> PRICING APIS; the Worker encrypts them (AES-GCM, see
-- scripts/store-api-keys.mjs) before they land here and never returns more
-- than the last 4 characters. Only the Worker (service_role) reads the table.

-- grants: service_role only store_api_keys
create table if not exists public.store_api_keys (
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null check (provider in ('pokemonprice', 'pricecharting', 'justtcg')),
  ciphertext text not null,
  last4 text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (store_id, provider)
);
alter table public.store_api_keys enable row level security;
revoke all on public.store_api_keys from public, anon, authenticated;
grant select, insert, update, delete on public.store_api_keys to service_role;
