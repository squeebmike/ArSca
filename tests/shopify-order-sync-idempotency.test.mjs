import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// processShopifyOrder is called both by the real-time webhook route and by
// the scheduled reconciliation backstop -- a delivery Shopify redelivers (it
// retries on any non-2xx, or a slow ack) and an order the cron backstop
// re-fetches that the webhook already recorded must both be no-ops, or a
// single sale would double-decrement stock and double-record profit. Mirrors
// syncEbayOrdersForStore's own per-(order, line item) KV dedup key.

assert.match(worker, /async function processShopifyOrder\(env, order\) \{/, 'missing processShopifyOrder');
const fnStart = worker.indexOf('async function processShopifyOrder(env, order) {');
const fnEnd = worker.indexOf('// Shared by /ebay/list and /ebay/update', fnStart);
assert.notEqual(fnEnd, -1, 'could not locate the end of processShopifyOrder');
const fn = worker.slice(fnStart, fnEnd);

assert.match(fn, /const trackKey = `shopify_order_synced:\$\{orderKey\}:\$\{li\.id\}`;/, 'must key idempotency per (order, line item), same granularity as eBay\'s dedup key');
assert.match(fn, /if \(env\.LBA_KV && await env\.LBA_KV\.get\(trackKey\)\) continue;/, 'an already-processed line item must be skipped, not re-recorded');
assert.match(fn, /if \(env\.LBA_KV\) await env\.LBA_KV\.put\(trackKey, '1', \{ expirationTtl: 60 \* 60 \* 24 \* 180 \}\);/, 'must mark the line item processed after recording it, with a long TTL matching eBay\'s dedup window');

// The "already sold / not found" early-out must ALSO mark the track key --
// otherwise a line item matching an item some other path already sold would
// be re-checked (and silently skipped) on every single redelivery/reconcile
// pass forever instead of being marked done once.
assert.match(fn, /if \(!invRow \|\| invRow\.status === 'sold'\) \{ if \(env\.LBA_KV\) await env\.LBA_KV\.put\(trackKey, '1', \{ expirationTtl: 60 \* 60 \* 24 \* 180 \}\); continue; \}/, 'an unmatched or already-sold item must still be marked processed to avoid rechecking it forever');

console.log('Shopify order-sync idempotency checks passed');

// Shared by both the webhook route and the cron backstop -- not two copies
// of the same matching/decrement logic that could drift apart.
const webhookRouteStart = worker.indexOf("if (url.pathname === '/shopify/webhook/orders' && request.method === 'POST') {");
const webhookRouteEnd = worker.indexOf('\n    }', webhookRouteStart);
assert.match(worker.slice(webhookRouteStart, webhookRouteEnd), /await processShopifyOrder\(env, order\);/, 'the webhook route must call the shared order-processing function');

assert.match(worker, /async function runScheduledShopifyOrderSync\(env\) \{/, 'missing runScheduledShopifyOrderSync');
const schedStart = worker.indexOf('async function runScheduledShopifyOrderSync(env) {');
const schedEnd = worker.indexOf('\n}', schedStart) + 2;
const schedBody = worker.slice(schedStart, schedEnd);
assert.match(schedBody, /await processShopifyOrder\(env, normalized\);/, 'the scheduled cron backstop must call the same shared order-processing function');
assert.match(schedBody, /\} catch \(e\) \{ console\.error\('Scheduled Shopify order sync failed for order', order\.id, e\.message\); \}/, 'one order failing must not block processing the rest');

// Wired into the same cron handler as the existing scheduled jobs.
assert.match(worker, /runScheduledEbayOrderSync\(env\), runScheduledShopifyOrderSync\(env\)/, 'runScheduledShopifyOrderSync must be wired into the scheduled() cron handler alongside the existing jobs');

console.log('Shopify scheduled order-sync wiring checks passed');
