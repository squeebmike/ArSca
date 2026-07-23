import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase-migrations/2026-07-22-mana-pocket-storefront.sql', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../the-mana-pocket.html', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');

// --- Worker: public storefront v2 routes exist and stay server-verified ---
assert.match(worker, /\/public\/catalog/);
assert.ok(worker.includes("productMatch = url.pathname.match(/^\\/public\\/product\\/([^/]+)$/)"), 'product detail route is parsed from the path');
assert.match(worker, /\/public\/breaks/);
assert.match(worker, /\/public\/comics/);
assert.match(worker, /\/public\/live/);
assert.match(worker, /\/public\/checkout\/create/);
assert.match(worker, /\/appointments\/request/);
assert.match(worker, /handlePublicStorefrontV2/);

// Never trust browser-provided price/availability: checkout builds Stripe
// line items from the DB-persisted order lines, not from request body prices.
assert.doesNotMatch(worker, /line_items\[\$\{index\}\]\[price_data\]\[unit_amount\]`,\s*String\(body\./, 'Stripe line item price must not read from the request body');
assert.match(worker, /orderLines\.forEach\(\(line, index\)/, 'Stripe checkout line items are built from persisted order lines');
assert.match(worker, /rpc\/create_online_order_with_reservations/, 'reservations are created through the atomic RPC');
assert.match(worker, /rpc\/finalize_online_order_payment/, 'orders are finalized through the atomic RPC');
assert.match(worker, /onlineOrderId && \(event\.type === 'checkout\.session\.completed' \|\| event\.type === 'payment_intent\.succeeded'\)/, 'online orders only finalize on a verified webhook event');

// Private/internal inventory fields must never reach the public v2 payload
// (the returned object literal itself, not merely referenced for a boolean
// badge check like the Consignment badge).
const mapFnStart = worker.indexOf('function mapPublicCatalogItem');
const returnStart = worker.indexOf('return {', mapFnStart);
const returnEnd = worker.indexOf('};', returnStart);
const returnedObjectLiteral = worker.slice(returnStart, returnEnd);
for (const privateField of ['cost:', 'profit:', 'consignor:', 'notes:', 'consignorName:', 'internalNotes:']) {
  assert.ok(!returnedObjectLiteral.includes(privateField), `${privateField} is not a key in the public catalog item`);
}

// --- Migration: RLS everywhere, checkout RPCs are server-only ---
const newTables = [
  'customers', 'customer_addresses', 'customer_wishlist', 'customer_alerts',
  'online_orders', 'online_order_lines', 'inventory_reservations',
  'rewards_ledger', 'store_credit_ledger', 'breaks', 'break_spots',
  'comic_series', 'comic_issues', 'pull_list_subscriptions', 'pull_list_allocations',
  'appointment_requests',
];
for (const table of newTables) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`), `${table} has RLS enabled`);
}
assert.match(migration, /revoke all on function public\.create_online_order_with_reservations\(jsonb, jsonb\) from public;/, 'order creation RPC is not publicly callable');
assert.match(migration, /revoke all on function public\.finalize_online_order_payment/, 'finalize RPC is not publicly callable');
assert.match(migration, /if v_available < v_qty then/, 'reservation RPC checks real availability before reserving');
assert.match(migration, /for update/, 'inventory rows are locked before being reserved/decremented');

// --- Storefront app: theme contract, never a hard-coded brand color ---
for (const cssVar of ['--brand-primary', '--brand-background', '--brand-surface', '--brand-text', '--brand-button-radius', '--brand-font-family']) {
  assert.match(app, new RegExp(cssVar.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')), `${cssVar} is used`);
}
assert.match(app, /function applyBrandTheme/, 'theme is applied at runtime from store_settings.theme');
assert.match(app, /STORE_ID/, 'store id is a configurable placeholder, not hard-coded');
assert.doesNotMatch(app, /window\.MANA_POCKET_STORE_ID\s*=\s*['"][0-9a-f-]{8,}['"]/i, 'no real store id is hard-coded into the shipped app');

// --- Dashboard: new settings section is wired into the existing architecture ---
assert.match(dashboard, /\{id:'manapocket',label:'The Mana Pocket'/, 'settings navigation includes the Mana Pocket section');
assert.match(dashboard, /manapocket:\['manapocket-panel'\]/, 'settings panel map routes to the Mana Pocket panel');
assert.match(dashboard, /function ensureManaPocketPanel/);
assert.match(dashboard, /ensureManaPocketPanel\(backoffice\);/, 'the panel is actually mounted during backoffice render');
assert.match(dashboard, /saveStoreSettingsToSupabase\(\{ modules:\{ \.\.\.getVendorConfig\(\), live:next \} \}\)/, 'live settings persist through the shared store_settings.modules column');

console.log('Mana Pocket storefront contract passed');
