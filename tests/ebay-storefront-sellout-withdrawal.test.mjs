import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store risk: an item that sold out through the store's own storefront
// (Stripe-webhook-driven, via fulfillStorefrontOrderInventory) kept its
// live eBay listing running -- a buyer could still purchase it on eBay
// after it was already gone, forcing a cancellation. The in-store POS
// checkout path already withdraws the eBay listing on sellout (see
// markInventoryRecordSold in dashboard.html, which calls /ebay/end); this
// closes the same gap for storefront sales, which never go through that
// client code at all.

const fnStart = worker.indexOf('async function fulfillStorefrontOrderInventory(env, saleId, storeId) {');
assert.ok(fnStart !== -1, 'fulfillStorefrontOrderInventory must exist');
const fnEnd = worker.indexOf('\nasync function syncStripeWebhookPayment', fnStart);
assert.ok(fnEnd > fnStart, 'must find the end of fulfillStorefrontOrderInventory');
const fnBody = worker.slice(fnStart, fnEnd);

assert.match(fnBody, /if \(depleted && data\.ebayOfferId && !data\.ebayWithdrawnAt\) \{/, 'must only attempt to withdraw when the row actually sold out and carries a live, non-withdrawn eBay offer');
assert.match(fnBody, /await withdrawEbayOffer\(env, ebayToken, data\.ebayOfferId\);/, 'a depleted row with a live eBay offer must have that offer withdrawn');
assert.match(fnBody, /data\.ebayWithdrawnAt = soldAt;/, 'a successful withdrawal must be recorded on the row so duplicate-listing guards and future sales don\'t re-attempt it');
// Best-effort: an eBay/token failure must never block recording the sale.
assert.match(fnBody, /\} catch \(e\) \{ console\.warn\('Could not auto-end eBay listing after storefront sale:', itemId, e\.message\); \}/, 'an eBay withdrawal failure must be caught and logged, never thrown, so it cannot block the storefront sale itself');
// Token fetched once, lazily -- not once per line/linked-stock-id.
assert.match(fnBody, /let ebayTokenPromise = null;/, 'the eBay token must be fetched lazily and cached for the whole fulfillment run, not refetched per row');
assert.match(fnBody, /function getEbayTokenOnce\(\) \{/, 'must expose a single getEbayTokenOnce helper reused by every decrementInventoryRow call');

console.log('eBay storefront-sellout withdrawal checks passed');
