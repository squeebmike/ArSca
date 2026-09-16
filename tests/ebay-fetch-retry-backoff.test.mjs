import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store risk: nothing in the eBay integration retried a rate-limited (429)
// response -- a bulk operation that loops per-item (scheduled auto-reprice
// and order-sync over many listings, group photo repair over every live
// group listing on file) had no built-in throttling, so a single 429
// partway through just failed that one item permanently instead of backing
// off and trying again. This adds a shared retry/backoff helper and wires
// it into exactly those loop-driven call sites.

assert.match(worker, /async function ebayFetchWithRetry\(url, options, maxRetries = 2\) \{/, 'missing ebayFetchWithRetry');
const fnStart = worker.indexOf('async function ebayFetchWithRetry(url, options, maxRetries = 2) {');
const fnEnd = worker.indexOf('\n}', fnStart) + 2;
const fn = worker.slice(fnStart, fnEnd);
assert.match(fn, /if \(lastRes\.status !== 429 \|\| attempt === maxRetries\) return lastRes;/, 'must only retry on 429, and must not retry past maxRetries');
assert.match(fn, /Retry-After/, 'must honor a Retry-After header when eBay sends one, not just a fixed backoff');
assert.match(fn, /500 \* Math\.pow\(2, attempt\)/, 'must fall back to exponential backoff when no Retry-After header is present');

// Functional: verify the retry/backoff behavior directly against a fake
// fetch (429 then 200; Retry-After header honored; gives up after maxRetries).
{
  const ebayFetchWithRetry = new Function('fetch', 'setTimeout', fn + '\nreturn ebayFetchWithRetry;')(
    // fake global fetch used only inside this eval'd copy
    (() => {
      let calls = 0;
      const impl = async () => {
        calls++;
        if (calls === 1) return { status: 429, headers: { get: h => h === 'Retry-After' ? '0' : null } };
        return { status: 200, ok: true };
      };
      impl.calls = () => calls;
      return impl;
    })(),
    (fn2) => fn2(), // run the backoff delay immediately, no real waiting in tests
  );
  const res = await ebayFetchWithRetry('https://example.invalid', {});
  assert.equal(res.status, 200, 'must retry after a 429 and return the eventual success response');
}
{
  let calls = 0;
  const alwaysRateLimited = async () => { calls++; return { status: 429, headers: { get: () => null } }; };
  const ebayFetchWithRetry = new Function('fetch', 'setTimeout', fn + '\nreturn ebayFetchWithRetry;')(alwaysRateLimited, (fn2) => fn2());
  const res = await ebayFetchWithRetry('https://example.invalid', {}, 2);
  assert.equal(res.status, 429, 'must give up and return the last 429 response after maxRetries, not retry forever');
  assert.equal(calls, 3, 'must attempt exactly maxRetries+1 times (the initial call plus maxRetries retries)');
}

console.log('eBay fetch retry/backoff helper checks passed');

// Wired into the loop-driven call sites: scheduled auto-reprice (price AND
// quantity revise -- both run per-item over potentially many listings) and
// the group photo repair (GET + PUT, run per live group listing on file).
// NOT applied to single-shot interactive routes -- a staff member clicking
// one button is better served by an immediate real error than a silent
// multi-second retry.
const repriceStart = worker.indexOf('async function ebayReviseOfferPrice(env, offerId, newPrice) {');
const repriceEnd = worker.indexOf('\n}', repriceStart) + 2;
assert.match(worker.slice(repriceStart, repriceEnd), /ebayFetchWithRetry\(`https:\/\/api\.ebay\.com\/sell\/inventory\/v1\/offer/, 'ebayReviseOfferPrice (used by the scheduled auto-reprice loop) must use the retrying fetch');

const qtyStart = worker.indexOf('async function ebayReviseOfferQuantity(env, ebayToken, offerId, newQuantity) {');
const qtyEnd = worker.indexOf('\n}', qtyStart) + 2;
assert.match(worker.slice(qtyStart, qtyEnd), /ebayFetchWithRetry\(`https:\/\/api\.ebay\.com\/sell\/inventory\/v1\/offer/, 'ebayReviseOfferQuantity must use the retrying fetch');

const repairStart = worker.indexOf('async function repairEbayGroupListingImages(env, ebayToken, storeId, groupKey, rows) {');
const repairEnd = worker.indexOf('// Ends (withdraws) an ENTIRE multi-variation listing at once', repairStart);
const repairBody = worker.slice(repairStart, repairEnd);
assert.match(repairBody, /ebayFetchWithRetry\(`https:\/\/api\.ebay\.com\/sell\/inventory\/v1\/inventory_item_group/, 'repairEbayGroupListingImages (run in a loop over every live group listing) must use the retrying fetch for both its GET and PUT calls');
assert.equal((repairBody.match(/ebayFetchWithRetry\(/g) || []).length, 2, 'both the GET (load current state) and PUT (save corrected images) calls must use the retrying fetch');

const syncStart = worker.indexOf('async function syncEbayOrdersForStore(env, storeId, ebayToken, receiptSettings, { reconcile, confirmedBy }) {');
const syncEnd = worker.indexOf('async function runScheduledEbayOrderSync', syncStart);
assert.match(worker.slice(syncStart, syncEnd), /ebayFetchWithRetry\('https:\/\/api\.ebay\.com\/sell\/fulfillment\/v1\/order\?filter=/, 'syncEbayOrdersForStore (run per store on the scheduled cron) must use the retrying fetch for its order lookup');

console.log('eBay retry/backoff call-site wiring checks passed');
