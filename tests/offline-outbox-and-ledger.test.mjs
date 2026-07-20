import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase-migrations/2026-07-14-atomic-pos-sale.sql', import.meta.url), 'utf8');

assert.match(dashboard, /indexedDB\.open\(SYNC_OUTBOX_DB, 1\)/, 'operational queue must use IndexedDB');
assert.match(dashboard, /await enqueueOrReplaceSync\('pos-ledger-transaction'/, 'checkout must await durable queue storage');
assert.doesNotMatch(dashboard, /sync_queue_v1[^\n]+slice\(0,\s*500\)/, 'operational queue must not silently discard entries');
assert.match(dashboard, /sb\.rpc\('complete_pos_sale'/, 'checkout must prefer the atomic sale RPC');
assert.match(dashboard, /await finalizeCompletedCheckout\(bundle, queued/, 'finalization must happen outside the commit failure path');
assert.match(dashboard, /function resolveResearchInventoryMatch\(item\)/, 'research sales must resolve exact inventory matches');
assert.match(dashboard, /inventoryId:trackedInventoryItem\?\.id \|\| null/, 'matched research results must carry the inventory ID into checkout');
assert.match(dashboard, /This exact item is already sold or out of stock/, 'sold exact matches must be blocked');
assert.match(dashboard, /show_sessions_index/, 'active shows must have a shared store-scoped index');
assert.match(dashboard, /item\.type === 'show-session-kv'/, 'offline show starts and closes must have a retry handler');
assert.match(dashboard, /async function joinShowSession\(id\)/, 'devices must be able to join a shared show');
assert.match(dashboard, /async function joinCashBag\(id/, 'devices must be able to join a shared Cash Bag');
assert.match(dashboard, /id="drawer-name"/, 'multiple shared Cash Bags must have an operator-visible name');
assert.match(dashboard, /\.eq\('show_session_id',show\.id\)\.eq\('status','open'\)/, 'Cash Bags must be loaded under the selected show');
assert.match(dashboard, /async function syncSharedShowTransactions/, 'joined devices must hydrate the shared transaction ledger');
assert.match(dashboard, /paymentBreakdown:tender\.map/, 'shared tender details must retain Cash, Stripe, Venmo, and other methods');
assert.match(dashboard, /!\['cash_sale','sale_void'\]\.includes/, 'automatic cash sale movements must not double-count cloud payment tenders');
assert.match(dashboard, /show\('register-show-panel', cfg\.modules\.show && requireEmployee\(\)\)/, 'employees must be allowed to start or join shows');
assert.match(dashboard, /show\('register-cash-panel', cfg\.modules\.cash && requireEmployee\(\)\)/, 'employees must be allowed to start or join Cash Bags');
assert.match(dashboard, /Join or start a Cash Bag for this show before taking payment/, 'show checkout must be attached to a Cash Bag');
assert.match(worker, /url\.pathname === '\/pos\/drawers\/update'/, 'Worker must expose a store-authenticated shared Cash Bag update route');
assert.match(worker, /Cash Bag not found for this store/, 'Cash Bag updates must enforce store scope');
assert.match(worker, /key\.startsWith\('show_session'\) \? 60 \* 60 \* 24 \* 180/, 'shared show metadata must outlive the short operational KV window');

assert.match(migration, /create or replace function public\.complete_pos_sale/, 'atomic sale migration must define the RPC');
assert.match(migration, /security definer/, 'RPC must own the complete transaction after checking store membership');
assert.match(migration, /if exists \(select 1 from public\.pos_sales/, 'RPC must be idempotent by sale ID');
assert.match(migration, /update public\.inventory_items/, 'inventory changes must be in the sale transaction');
assert.match(migration, /v_next_qty := greatest\(0, v_current_qty/, 'tracked inventory must decrement instead of always becoming sold');
assert.match(migration, /create table if not exists public\.customer_receipts/, 'receipt capture table must be installed');
assert.match(migration, /create table if not exists public\.customer_wants/, 'customer wants table must be installed');
assert.match(migration, /email_status text not null default 'not_sent'/, 'invite email delivery status must be installed');
assert.match(migration, /notify pgrst, 'reload schema'/, 'PostgREST must reload after the migration');
assert.match(migration, /update public\.pos_drawer_sessions/, 'drawer totals must be in the sale transaction');
assert.match(migration, /grant execute on function public\.complete_pos_sale\(jsonb\) to authenticated/, 'only authenticated clients may call the RPC');

console.log('Operational durability contract checks passed');
