-- A store may use The Mana Pocket's PokemonPriceTracker key and nothing else
-- of its (Crull001, 2026-11-05). Off by default; scripts/store-features.mjs.
alter table public.store_features add column if not exists shared_pokemon_key boolean not null default false;
