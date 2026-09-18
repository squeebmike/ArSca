import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// A card can end up listed on both eBay and mirrored to Shopify/Whatnot at
// once -- selling it on either channel must pull it off the other
// immediately, or the same physical (often 1-of-1, graded) item could sell
// twice. This checks all three places that can deplete an item's stock each
// carry the reciprocal withdrawal.

// 1) An eBay sale (syncEbayOrdersForStore) must withdraw a mirrored Shopify
//    listing when it depletes the item.
{
  const start = worker.indexOf('async function syncEbayOrdersForStore(env, storeId, ebayToken, receiptSettings, { reconcile, confirmedBy }) {');
  const end = worker.indexOf('async function runScheduledEbayOrderSync', start);
  const body = worker.slice(start, end);
  assert.match(body, /if \(d\.shopifyProductId && !d\.shopifyWithdrawnAt\) \{/, 'an eBay sale must check for a mirrored, still-live Shopify listing on the same item');
  assert.match(body, /await withdrawShopifyListing\(env, d\);/, 'an eBay sale depleting the item must withdraw its Shopify listing');
}

// 2) A Shopify/Whatnot sale (processShopifyOrder) must withdraw a live eBay
//    listing when it depletes the item.
{
  const start = worker.indexOf('async function processShopifyOrder(env, order) {');
  const end = worker.indexOf('// Shared by /ebay/list and /ebay/update', start);
  const body = worker.slice(start, end);
  assert.match(body, /if \(d\.ebayOfferId && !d\.ebayWithdrawnAt\) \{/, 'a Shopify/Whatnot sale must check for a live eBay listing on the same item');
  assert.match(body, /\/sell\/inventory\/v1\/offer\/\$\{encodeURIComponent\(d\.ebayOfferId\)\}\/withdraw/, 'a Shopify/Whatnot sale depleting the item must withdraw its eBay listing');
}

// 3) A manually-recorded external sale (/inventory/record-external-sale --
//    e.g. today's manual "sold on Whatnot" entry) must close the same gap
//    both ways, since it's the one sale-recording path that predates any
//    automated channel sync.
{
  const start = worker.indexOf("if (url.pathname === '/inventory/record-external-sale' && request.method === 'POST') {");
  const end = worker.indexOf("\n    // POST /ebay/orders/ship", start);
  assert.notEqual(start, -1, 'missing /inventory/record-external-sale route');
  const body = worker.slice(start, end);
  assert.match(body, /await withdrawShopifyListing\(env, d\);/, 'a manually-recorded sale depleting the item must withdraw its Shopify listing');
  assert.match(body, /\/sell\/inventory\/v1\/offer\/\$\{encodeURIComponent\(d\.ebayOfferId\)\}\/withdraw/, 'a manually-recorded sale depleting the item must withdraw its eBay listing');
}

console.log('Shopify/eBay cross-channel oversell-guard checks passed');
