# Store-scoped cloud consignments

Consignor people, consignment items, payout alerts, sale links, and payout state are persisted in Supabase by `store_id`. Row-level security allows active members of that store to read the records; managers can maintain them, and only Owner/Admin can permanently delete people/items.

The dashboard loads the active store's cloud records after login and store selection. Browser storage is an offline cache, not the system of record. The first successful cloud load merges existing device records and uploads them once, preserving earlier consignment work.

Apply `supabase/stripe-connect-and-consignments.sql` before expecting cross-device sync. If the migration is missing or the device is offline, the dashboard keeps working from its local cache and logs the sync failure without mixing data from another store.

Tables:

- `consignor_people`
- `consignment_items`
- `consignment_alerts`

Every query and mutation includes the active `store_id`; changing stores reloads the page and therefore reloads the selected store's cloud dataset.

