-- Walk-Off Topps Checklist Catalog
-- SQL Editor safe version: no dollar-quoted functions.
-- Safe to rerun. Public read, service-role/admin import.

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.topps_import_meta (
  id text primary key default 'topps_checklists',
  imported_at timestamptz not null default now(),
  status text not null default 'ready',
  schema_version integer not null default 1,
  set_count integer not null default 0,
  card_count integer not null default 0,
  source_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.topps_pdf_sources (
  source_id text primary key,
  file_name text not null default '',
  original_path text not null default '',
  pdf_url text not null default '',
  pdf_hash text not null default '',
  page_count integer not null default 0,
  text_length integer not null default 0,
  raw_text text not null default '',
  parsed_set_id text not null default '',
  imported_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.topps_sets (
  id text primary key,
  year text not null default '',
  brand text not null default 'Topps',
  product text not null default '',
  sport text not null default '',
  set_name text not null default '',
  release_name text not null default '',
  source_ids text[] not null default '{}',
  card_count integer not null default 0,
  search_text text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.topps_checklist_cards (
  id text primary key,
  set_id text not null references public.topps_sets(id) on delete cascade,
  source_id text references public.topps_pdf_sources(source_id) on delete set null,
  year text not null default '',
  brand text not null default 'Topps',
  product text not null default '',
  sport text not null default '',
  set_name text not null default '',
  release_name text not null default '',
  card_number text not null default '',
  card_number_prefix text not null default '',
  card_number_sort integer not null default 999999,
  player text not null default '',
  subject text not null default '',
  team text not null default '',
  notes text not null default '',
  section text not null default 'Checklist',
  section_sort integer not null default 5,
  flags jsonb not null default '{}'::jsonb,
  parse_confidence numeric not null default 0,
  search_text text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.pricecharting_matches_cache (
  card_id text primary key references public.topps_checklist_cards(id) on delete cascade,
  query text not null default '',
  queries jsonb not null default '[]'::jsonb,
  category text not null default 'Sports Cards',
  player_name text not null default '',
  matches jsonb not null default '[]'::jsonb,
  best jsonb,
  cached_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);

create index if not exists idx_topps_sets_year_sport on public.topps_sets(year desc, sport, product);
create index if not exists idx_topps_sets_search_trgm on public.topps_sets using gin (search_text gin_trgm_ops);
create index if not exists idx_topps_cards_set_sort on public.topps_checklist_cards(set_id, section_sort, section, card_number_sort, card_number);
create index if not exists idx_topps_cards_year_sport on public.topps_checklist_cards(year desc, sport, product);
create index if not exists idx_topps_cards_number on public.topps_checklist_cards(card_number);
create index if not exists idx_topps_cards_player_trgm on public.topps_checklist_cards using gin (player gin_trgm_ops);
create index if not exists idx_topps_cards_team_trgm on public.topps_checklist_cards using gin (team gin_trgm_ops);
create index if not exists idx_topps_cards_search_trgm on public.topps_checklist_cards using gin (search_text gin_trgm_ops);
create index if not exists idx_topps_cards_flags on public.topps_checklist_cards using gin (flags);

alter table public.topps_import_meta enable row level security;
alter table public.topps_pdf_sources enable row level security;
alter table public.topps_sets enable row level security;
alter table public.topps_checklist_cards enable row level security;
alter table public.pricecharting_matches_cache enable row level security;

drop policy if exists topps_import_meta_public_read on public.topps_import_meta;
create policy topps_import_meta_public_read on public.topps_import_meta for select using (true);

drop policy if exists topps_pdf_sources_public_read on public.topps_pdf_sources;
create policy topps_pdf_sources_public_read on public.topps_pdf_sources for select using (true);

drop policy if exists topps_sets_public_read on public.topps_sets;
create policy topps_sets_public_read on public.topps_sets for select using (true);

drop policy if exists topps_cards_public_read on public.topps_checklist_cards;
create policy topps_cards_public_read on public.topps_checklist_cards for select using (true);

drop policy if exists pricecharting_cache_public_read on public.pricecharting_matches_cache;
create policy pricecharting_cache_public_read on public.pricecharting_matches_cache for select using (true);

grant select on public.topps_import_meta to anon, authenticated;
grant select on public.topps_pdf_sources to anon, authenticated;
grant select on public.topps_sets to anon, authenticated;
grant select on public.topps_checklist_cards to anon, authenticated;
grant select on public.pricecharting_matches_cache to anon, authenticated;

commit;
