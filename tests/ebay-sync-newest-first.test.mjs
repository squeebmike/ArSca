import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store report (10/2): a $11.06 presale sold on eBay never reached Sales,
// Today or Recent Activity, while the previous day's sale did (recorded by the
// 6-hour cron). eBay lists orders oldest first and presales stay unshipped for
// weeks, so the dashboard's sync reached a new sale last, after a lookup per
// older open order, and a page refresh cut the request off before it got there.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');

const fn = worker.slice(worker.indexOf('async function syncEbayOrdersForStore('), worker.indexOf('async function runScheduledEbayOrderSync('));
const sortAt = fn.search(/orders\.sort\(\(a, b\) => String\(b\.creationDate/);
assert(sortAt > 0, 'orders must be handled newest first');
assert(sortAt < fn.indexOf('for (const order of orders)'), 'the sort must happen before the recording loop');
assert.match(fn, /Promise\.all\(chunk\.map\(k => env\.LBA_KV\.get\(k\)/, 'already-recorded lines must be read in parallel, not one KV call per line');
assert.match(fn, /if \(alreadySynced\.has\(trackKey\)\)/, 'the recording loop must use the preloaded set');
assert.match(fn, /if \(anyUnlinked\) await linkRecordedEbaySale/, 'the per-line link lookup must only run while an unlinked eBay sale exists');
// The dedup key itself must not change, or every past sale would be recorded again.
assert.match(fn, /`ebay_order_synced:\$\{storeId\}:\$\{order\.orderId\}:\$\{String\(li\.sku \|\| ''\) \|\| li\.lineItemId \|\| 'noid'\}`/, 'dedup key must stay order + sku (or line id)');

const route = worker.slice(worker.indexOf("if (url.pathname === '/ebay/orders/sync') {"), worker.indexOf('// POST /shopify/sync-item'));
assert.match(route, /ctx\.waitUntil\(run\.catch\(\(\) => \{\}\)\)/, 'the sync must keep running after the page disconnects');

const client = dashboard.slice(dashboard.indexOf('async function syncEbayOrders(silent, reconcile){'), dashboard.indexOf('setInterval(() => { if(!document.hidden) syncEbayOrders(true); }'));
assert.match(client, /await loadInventory\(\)\.catch\(\(\)=>\{\}\);\n\s+if\(!\(data\.matched > 0\)\) renderPulse\(\)/, 'a recorded sale must redraw Today / Recent Activity right away');

console.log('eBay sync newest-first checks passed');
