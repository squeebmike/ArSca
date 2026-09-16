import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store gap: only single-offer /ebay/end and the FOC-specific bulk-end
// (adminEndFocEbayListings, a different tool for FOC presale covers) ever
// existed for the general inventory eBay listings -- the dashboard's
// "bulk" eBay UI was bulk CREATE only, so ending a run of regular listings
// (e.g. a dead-stock cleanup pass) had to be done one at a time.

const routeStart = worker.indexOf("if (url.pathname === '/ebay/bulk-end') {");
assert.ok(routeStart !== -1, '/ebay/bulk-end route must exist');
const routeEnd = worker.indexOf('\n    }', worker.indexOf('return json({ ok: true, ended, failed });', routeStart));
const routeBody = worker.slice(routeStart, routeEnd);

assert.match(routeBody, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/, 'ending listings in bulk is consequential -- must be owner/admin only');
assert.match(routeBody, /const offerIds = \[\.\.\.new Set\(\(Array\.isArray\(body\.offerIds\) \? body\.offerIds : \[\]\)\.map\(id => String\(id \|\| ''\)\.trim\(\)\)\.filter\(Boolean\)\)\]\.slice\(0, 200\);/, 'must accept and dedupe an array of offerIds, capped to a sane batch size');
assert.match(routeBody, /if \(!offerIds\.length\) return json\(\{ ok: false, error: 'offerIds \(a non-empty array\) is required' \}, 400\);/, 'must reject an empty/missing offerIds array with a clear error, not silently no-op');
assert.match(routeBody, /for \(const offerId of offerIds\) \{\s*try \{ await withdrawEbayOffer\(env, ebayToken, offerId\); ended\.push\(offerId\); \}\s*catch \(e\) \{ failed\.push\(\{ offerId, error: e\.message \}\); \}\s*\}/, 'one offerId failing (already ended, stale id, etc.) must not block ending the rest of the batch');
assert.match(routeBody, /return json\(\{ ok: true, ended, failed \}\);/, 'must report back exactly which offers ended and which failed, per-item');

console.log('eBay bulk-end backend route checks passed');

// Client wiring: the dashboard must actually expose and use this route --
// a backend endpoint nothing calls is not a fix.
assert.match(dashboard, /function ebayBulkEndableItems\(\)\{/, 'missing ebayBulkEndableItems');
assert.match(dashboard, /return all\.filter\(i => i\.ebayOfferId && i\.lifecycle !== 'archived' && i\.status !== 'sold'\);/, 'must only offer currently-listed, non-archived, unsold items for bulk-end');
assert.match(dashboard, /async function submitEbayBulkEnd\(\)\{/, 'missing submitEbayBulkEnd');
const submitStart = dashboard.indexOf('async function submitEbayBulkEnd(){');
const submitEnd = dashboard.indexOf('\n}', submitStart) + 2;
const submitFn = dashboard.slice(submitStart, submitEnd);
assert.match(submitFn, /if\(!confirm\(/, 'must confirm before ending a batch of live listings');
assert.match(submitFn, /storeWorkerFetch\('\/ebay\/bulk-end', \{method:'POST', headers:\{'Content-Type':'application\/json'\}, body: JSON\.stringify\(\{offerIds\}\)\}\);/, 'must call the new bulk-end route with the selected items\' offerIds');
assert.match(submitFn, /const endedSet = new Set\(data\.ended \|\| \[\]\);/, 'must only clear local eBay state for items the backend actually confirmed ended, not the whole selection blindly');
assert.match(submitFn, /await updateBuiltInInventoryItem\(item, \{ ebayListingId:'', ebayOfferId:'', ebaySku:'', ebayListedAt:'' \}\);/, 'a confirmed-ended item must have its local eBay linkage cleared the same way the single-item end flow already does, so it doesn\'t look falsely still-listed');

console.log('eBay bulk-end client wiring checks passed');

// UI: a real button in the dashboard, not just a JS function nothing calls.
assert.match(dashboard, /id="backoffice-ebay-bulk-end-panel"/, 'missing the EBAY BULK END LISTINGS panel');
assert.match(dashboard, /onclick="submitEbayBulkEnd\(\)">END SELECTED LISTINGS<\/button>/, 'the panel must have a real END SELECTED LISTINGS button wired to submitEbayBulkEnd');

console.log('eBay bulk-end UI wiring checks passed');
