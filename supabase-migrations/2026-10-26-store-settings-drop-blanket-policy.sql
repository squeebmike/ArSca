-- Second-store pilot dry run (2026-10-26): close a cross-store leak.
--
-- Signed in as the test store, its owner could read and edit every store's
-- store_settings row (The Mana Pocket's payment handles, forward-to numbers
-- and eBay policies included) because of a blanket "authenticated full
-- access" policy that was never in this repo. The store-scoped policies
-- (store_settings_select_member, store_settings_insert_owner_admin,
-- store_settings_update_owner_admin) already cover every real use: the
-- dashboard reads and upserts only its own store's row.
--
-- Applied to production by hand in the SQL Editor on 2026-10-26.
-- Undo: create policy "authenticated full access" on public.store_settings
--   for all to authenticated using (true) with check (true);

drop policy if exists "authenticated full access" on public.store_settings;
