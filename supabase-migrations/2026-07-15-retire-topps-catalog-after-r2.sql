-- DESTRUCTIVE, POST-VERIFICATION ONLY.
-- Before running: back up the database and verify the production R2 catalog on a device offline.
-- In the same SQL session, explicitly opt in with:
--   select set_config('walkoff.allow_topps_retirement', 'verified-r2-backup-complete', false);

do $$
declare
  v_cards bigint;
  v_sets bigint;
begin
  if current_setting('walkoff.allow_topps_retirement', true) <> 'verified-r2-backup-complete' then
    raise exception 'Topps retirement blocked: verify R2, offline device search, and backup first';
  end if;

  if to_regclass('public.topps_checklist_cards') is null and to_regclass('public.topps_sets') is null then
    raise notice 'Topps Supabase catalog is already retired';
    return;
  end if;

  select count(*) into v_cards from public.topps_checklist_cards;
  select count(*) into v_sets from public.topps_sets;
  if v_cards <> 426540 or v_sets <> 740 then
    raise exception 'Topps retirement blocked: Supabase has % cards / % sets; verified R2 has 426540 / 740', v_cards, v_sets;
  end if;
end $$;

create table if not exists public.catalog_retirement_log (
  catalog text primary key,
  retired_at timestamptz not null default now(),
  catalog_version text not null,
  card_count bigint not null,
  set_count bigint not null,
  cards_sha256 text not null,
  sets_sha256 text not null,
  storage text not null default 'cloudflare-r2'
);

insert into public.catalog_retirement_log (
  catalog, catalog_version, card_count, set_count, cards_sha256, sets_sha256
) values (
  'topps', '2026-07-16.1', 426540, 740,
  '5fd4ea1e684e82eda03ba61f07afcb1cf75f597ef650be1b3c610ad0fef25864',
  'c3dcfe044da60d18f68e57b5c501c26163cfe13401e94167654cc93745ebbeb7'
) on conflict (catalog) do update set
  retired_at = now(),
  catalog_version = excluded.catalog_version,
  card_count = excluded.card_count,
  set_count = excluded.set_count,
  cards_sha256 = excluded.cards_sha256,
  sets_sha256 = excluded.sets_sha256,
  storage = excluded.storage;

drop table if exists public.topps_card_market_links;
drop table if exists public.pricecharting_matches_cache;
drop table if exists public.topps_checklist_cards;
drop table if exists public.topps_pdf_sources;
drop table if exists public.topps_sets;
drop table if exists public.topps_import_meta;
