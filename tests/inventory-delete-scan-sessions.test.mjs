import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store report: "Delete failed" deleting inventory. Postgres logs showed
// `violates foreign key constraint "scan_sessions_inventory_item_id_fkey"`
// -- every scanned-in item was undeletable. The scan session stays (it's
// buying history) and just stops pointing at the deleted item.
const sql = fs.readFileSync('supabase-migrations/2026-10-15-scan-sessions-unlink-on-delete.sql', 'utf8');
assert.match(sql, /drop constraint if exists scan_sessions_inventory_item_id_fkey/);
assert.match(sql, /foreign key \(inventory_item_id\) references public\.inventory_items\(id\) on delete set null/);
assert.doesNotMatch(sql, /on delete cascade/i, 'deleting an item must never delete its scan history');
console.log('Inventory delete / scan_sessions unlink checks passed');
