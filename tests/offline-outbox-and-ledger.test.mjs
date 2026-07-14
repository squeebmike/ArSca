import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase-migrations/2026-07-14-atomic-pos-sale.sql', import.meta.url), 'utf8');

assert.match(dashboard, /indexedDB\.open\(SYNC_OUTBOX_DB, 1\)/, 'operational queue must use IndexedDB');
assert.match(dashboard, /await enqueueOrReplaceSync\('pos-ledger-transaction'/, 'checkout must await durable queue storage');
assert.doesNotMatch(dashboard, /sync_queue_v1[^\n]+slice\(0,\s*500\)/, 'operational queue must not silently discard entries');
assert.match(dashboard, /sb\.rpc\('complete_pos_sale'/, 'checkout must prefer the atomic sale RPC');
assert.match(dashboard, /await finalizeCompletedCheckout\(bundle, queued/, 'finalization must happen outside the commit failure path');

assert.match(migration, /create or replace function public\.complete_pos_sale/, 'atomic sale migration must define the RPC');
assert.match(migration, /security definer/, 'RPC must own the complete transaction after checking store membership');
assert.match(migration, /if exists \(select 1 from public\.pos_sales/, 'RPC must be idempotent by sale ID');
assert.match(migration, /update public\.inventory_items/, 'inventory changes must be in the sale transaction');
assert.match(migration, /update public\.pos_drawer_sessions/, 'drawer totals must be in the sale transaction');
assert.match(migration, /grant execute on function public\.complete_pos_sale\(jsonb\) to authenticated/, 'only authenticated clients may call the RPC');

console.log('Operational durability contract checks passed');
