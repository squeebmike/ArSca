// "The FOC eBay shipping is going back to Ground Advantage sometimes, even with FOC selected" (store, 2026-11-13):
// MANAGE EBAY LISTING's update rebuilt the whole offer without a shipping policy, so eBay's full-replace PUT got the
// store default. The live offer's shipping policy and store categories now carry through unless the caller names new ones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const wk = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const i = wk.indexOf('async function reviseEbayListing(b, ebayToken, env) {'), body = wk.slice(i, wk.indexOf("if (url.pathname === '/ebay/update')", i));
assert.ok(i > 0 && body.length > 0);
assert.ok(body.includes("if (!b.fulfillmentPolicyId || !Array.isArray(b.storeCategoryNames)) {"), 'reads the live offer when the caller sends no policy');
assert.ok(body.includes("liveOffer?.listingPolicies?.fulfillmentPolicyId ? { fulfillmentPolicyId: liveOffer.listingPolicies.fulfillmentPolicyId }"), 'keeps its shipping policy');
assert.ok(body.includes("Array.isArray(liveOffer?.storeCategoryNames) ? { storeCategoryNames: liveOffer.storeCategoryNames }"), 'keeps its store categories');
assert.ok(body.includes("const offerBody = buildEbayOfferBody({ ...b, ...keep }, sku, locationKey, env);"));
assert.ok(body.indexOf('liveOffer') < body.indexOf("method: 'PUT',\n        headers: { 'Authorization': 'Bearer ' + ebayToken, 'Content-Type': 'application/json', 'Content-Language': 'en-US' },\n        body: JSON.stringify(offerBody)"), 'read before the offer PUT');
// The other offer rewrites already carry the live policy through.
assert.equal((wk.match(/fulfillmentPolicyId: offer\.listingPolicies\?\.fulfillmentPolicyId \|\| ''/g) || []).length, 2, 'price and quantity revises keep it too');
console.log('eBay update keeps the FOC shipping policy: passed');
