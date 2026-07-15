-- DESTRUCTIVE, POST-VERIFICATION ONLY.
-- Before running: back up the database and verify the production R2 catalog on a device offline.
-- In the same SQL session, explicitly opt in with:
--   select set_config('walkoff.allow_topps_retirement', 'verified-r2-backup-complete', false);

do $$
begin
  if current_setting('walkoff.allow_topps_retirement', true) <> 'verified-r2-backup-complete' then
    raise exception 'Topps retirement blocked: verify R2, offline device search, and backup first';
  end if;
end $$;

drop table if exists public.topps_card_market_links;
drop table if exists public.topps_checklist_cards;
drop table if exists public.topps_pdf_sources;
drop table if exists public.topps_sets;
drop table if exists public.topps_import_meta;
