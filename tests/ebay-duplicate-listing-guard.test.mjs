import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// /foc/ebay/create-presale-group already refuses to re-publish a cover that
// is still live under a different eBay listing (see
// foc-ebay-group-duplicate-guard-and-description.test.mjs). The single-cover
// /foc/ebay/create-presale route and the general /ebay/list route had no
// equivalent check -- a double-click, a retried slow response, or two staff
// acting on the same item could create a second live eBay listing against
// the same physical stock. These assertions cover the guard added to both.

const singleStart = worker.indexOf("if (url.pathname === '/foc/ebay/create-presale' || url.pathname === '/foc/ebay/presale-preview')");
assert.ok(singleStart !== -1, 'the single-cover create/preview route must exist');
const singleEnd = worker.indexOf("if (url.pathname === '/foc/ebay/presale-group-preview'", singleStart);
assert.ok(singleEnd > singleStart, 'must find the next route boundary after create-presale');
const singleBody = worker.slice(singleStart, singleEnd);

assert.match(singleBody, /d\.focSkuId === sku\.id && d\.ebayListingId && !d\.ebayWithdrawnAt/, 'single-cover create-presale must block publishing a SKU that already has a live, non-withdrawn eBay listing');
assert.match(singleBody, /return json\(\{ ok: false, error: `Already listed on eBay \(listing \$\{alreadyListed\.data\.ebayListingId\}\)/, 'single-cover create-presale must return a clear 409 instead of silently creating a duplicate listing');

const genericStart = worker.indexOf("if (url.pathname === '/ebay/list') {");
assert.ok(genericStart !== -1, 'the general /ebay/list route must exist');
const genericEnd = worker.indexOf('\n    }', worker.indexOf('createAndPublishEbayListing(b, ebayToken, env, storeId)', genericStart));
const genericBody = worker.slice(genericStart, genericEnd);

assert.match(genericBody, /if \(b\.itemId\) \{/, '/ebay/list must check for an existing listing when the client supplies the inventory row id');
assert.match(genericBody, /existing\.ebayListingId && !existing\.ebayWithdrawnAt/, '/ebay/list must treat a live, non-withdrawn ebayListingId on that row as already listed');
assert.match(genericBody, /return json\(\{ ok: false, error: `Already listed on eBay/, '/ebay/list must refuse the duplicate create with a clear error');

// The client must actually send itemId, or the Worker-side check above can
// never fire.
assert.match(dashboard, /payload\.itemId = item\.supabaseRowId \|\| item\.id;[\s\S]{0,300}?Creating eBay listing/, 'submitDashboardEbayListing must send itemId so the Worker can detect a duplicate');
assert.match(dashboard, /itemId: item\.supabaseRowId \|\| item\.id,\s*\n\s*title,/, 'submitEbayBulkReviewItem must also send itemId on the bulk-listing path');

console.log('eBay duplicate-listing guard checks passed (single-cover FOC + general /ebay/list)');
