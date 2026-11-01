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
assert.match(routeBody, /= await syncEbayOrdersForStore\(env, storeId, ebayToken, receiptSettings, \{ reconcile, confirmedBy: auth\.user\.id \}\);/, 'the manual route must call the shared function with the real authenticated user as confirmedBy');

assert.match(worker, /async function runScheduledEbayOrderSync\(env\) \{/, 'missing runScheduledEbayOrderSync');
const schedStart = worker.indexOf('async function runScheduledEbayOrderSync(env) {');
// Top level (not nested inside the fetch handler), so scheduled() can reach it.
const schedEnd = worker.indexOf('\n}\n', schedStart);
assert.match(worker, /\nasync function runScheduledEbayOrderSync\(env\) \{/, 'must be a top-level function: nested inside fetch it was undefined in scheduled() and the cron threw');
const schedBody = worker.slice(schedStart, schedEnd);

assert.match(schedBody, /for \(const storeId of await storesWithEbayListings\(env\)\) \{/, 'only stores listing on the connected eBay account sync its orders (one eBay login, several stores)');
assert.match(worker, /async function storesWithEbayListings\(env\) \{[\s\S]*?store_members\?active=eq\.true[\s\S]*?data->>ebaySku\.neq\.,data->>ebayListingId\.neq\./);
assert.match(schedBody, /try \{ ebayToken = await getEbayUserAccessToken\(env\); \} catch \(_\) \{ continue; \}/, 'a store with no/expired eBay connection must be skipped, not abort the whole run');
assert.match(schedBody, /await syncEbayOrdersForStore\(env, storeId, ebayToken, receiptSettings, \{ reconcile: false, confirmedBy: null \}\);/, 'the scheduled run must use confirmedBy:null -- there is no real authenticated user for a cron job, and pos_payments.confirmed_by is a nullable FK for exactly this reason');
assert.match(schedBody, /\} catch \(e\) \{ console\.error\('Scheduled eBay order sync failed for store', storeId, e\.message\); \}/, 'one store failing (e.g. a lookup error) must not block syncing the rest');

// Wired into the same cron handler as the existing scheduled jobs.
assert.match(worker, /await Promise\.allSettled\(\[runScheduledDealScans\(env\), runScheduledEbayReprice\(env\), runScheduledEbayOrderSync\(env\), runScheduledShopifyOrderSync\(env\), runScheduledStorefrontReviewRequests\(env\)(?:, runScheduled\w+\(env\))*\]\);/, 'runScheduledEbayOrderSync must be wired into the scheduled() cron handler alongside the existing jobs');

console.log('eBay scheduled order-sync checks passed');

// Every 10 minutes: new eBay sales only (store, 2026-10-31). The quantity
// check (which emails) and the sold-out presale cleanup stay on the 6-hour run.
{
  const fnSrc = worker.slice(worker.indexOf('async function runScheduledEbayNewSales(env) {'), worker.indexOf('async function runScheduledEbayOrderSync(env) {'));
  assert.match(fnSrc, /await syncEbayOrdersForStore\(env, storeId, ebayToken, [^;]*\{ reconcile: false, confirmedBy: null \}\);/);
  assert.doesNotMatch(fnSrc, /qty-reconcile|end-sold-out-ebay-presales|sendEmail/, 'no emails or cleanup every 10 minutes');
  const sched = worker.slice(worker.indexOf('if (event?.cron === WHATNOT_SYNC_CRON) {'), worker.indexOf('if (event?.cron === WHATNOT_SYNC_CRON) {') + 700);
  assert.match(sched, /const sixHourRun = at\.getUTCMinutes\(\) === 0 && at\.getUTCHours\(\) % 6 === 0;/, "skips the 6-hour run's minute so the two never overlap");
  assert.match(sched, /sixHourRun \? null : runScheduledEbayNewSales\(env\)/);
  // The minute check itself.
  const isSix = iso => { const at = new Date(iso); return at.getUTCMinutes() === 0 && at.getUTCHours() % 6 === 0; };
  assert.equal(isSix('2026-11-01T06:00:00Z'), true);
  assert.equal(isSix('2026-11-01T06:10:00Z'), false);
  assert.equal(isSix('2026-11-01T07:00:00Z'), false);
  console.log('10-minute eBay sale check wiring passed');
}
