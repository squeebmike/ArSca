import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store risk: /ebay/orders/sync was manual-only -- a real eBay sale made
// directly through eBay's own app/site sat unrecorded in local inventory
// and profit stats until a staffer remembered to click SYNC EBAY ORDERS.
// Meanwhile the same card could still show as available in-store, or get
// sold again on eBay itself, until someone happened to notice and sync.
// This adds it to the same 6h cron the deal-scan and auto-reprice jobs
// already run on.

// The route and the scheduled job must share one implementation, not two
// copies of the same order-matching/fee/inventory-decrement logic that can
// drift apart.
assert.match(worker, /async function syncEbayOrdersForStore\(env, storeId, ebayToken, receiptSettings, \{ reconcile, confirmedBy \}\) \{/, 'missing syncEbayOrdersForStore');
const routeStart = worker.indexOf("if (url.pathname === '/ebay/orders/sync') {");
const routeEnd = worker.indexOf('async function syncEbayOrdersForStore', routeStart);
const routeBody = worker.slice(routeStart, routeEnd);
assert.match(routeBody, /return json\(await syncEbayOrdersForStore\(env, storeId, ebayToken, receiptSettings, \{ reconcile, confirmedBy: auth\.user\.id \}\)\);/, 'the manual route must call the shared function with the real authenticated user as confirmedBy');

assert.match(worker, /async function runScheduledEbayOrderSync\(env\) \{/, 'missing runScheduledEbayOrderSync');
const schedStart = worker.indexOf('async function runScheduledEbayOrderSync(env) {');
const schedEnd = worker.indexOf('\n    }', worker.indexOf('await syncEbayOrdersForStore(env, storeId, ebayToken, receiptSettings', schedStart));
const schedBody = worker.slice(schedStart, schedEnd);

assert.match(schedBody, /const \{ data: members \} = await supabaseAdminFetch\(env, `store_members\?active=eq\.true&select=store_id`\);/, 'must iterate every active store, same pattern as runScheduledEbayReprice/runScheduledDealScans');
assert.match(schedBody, /try \{ ebayToken = await getEbayUserAccessToken\(env\); \} catch \(_\) \{ continue; \}/, 'a store with no/expired eBay connection must be skipped, not abort the whole run');
assert.match(schedBody, /await syncEbayOrdersForStore\(env, storeId, ebayToken, receiptSettings, \{ reconcile: false, confirmedBy: null \}\);/, 'the scheduled run must use confirmedBy:null -- there is no real authenticated user for a cron job, and pos_payments.confirmed_by is a nullable FK for exactly this reason');
assert.match(schedBody, /\} catch \(e\) \{ console\.error\('Scheduled eBay order sync failed for store', storeId, e\.message\); \}/, 'one store failing (e.g. a lookup error) must not block syncing the rest');

// Wired into the same cron handler as the existing scheduled jobs.
assert.match(worker, /ctx\.waitUntil\(Promise\.all\(\[runScheduledDealScans\(env\), runScheduledEbayReprice\(env\), runScheduledEbayOrderSync\(env\)\]\)\);/, 'runScheduledEbayOrderSync must be wired into the scheduled() cron handler alongside the existing jobs');

console.log('eBay scheduled order-sync checks passed');
