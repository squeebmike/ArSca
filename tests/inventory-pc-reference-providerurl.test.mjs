import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: "we always have the url -- even if it's a copy and paste"
// for sports cards. The store's actual workflow pins a card by pasting its
// numeric PriceCharting ID into the "PriceCharting Product ID... VERIFY"
// field (a pasted URL is deliberately rejected there -- PriceCharting/
// SportsCardsPro URLs never contain that id). verifyInventoryPriceChartingReference
// fetches the real product and stores its page URL (verified.url), but
// inventoryPcReferencePatch -- the function whose return value actually
// gets merged into what gets saved -- only ever returned
// pricechartingProductId/pricechartingProductName, silently dropping the
// one field (providerUrl) the store cared about. A fourth occurrence of
// this same class of bug, in the one place that was actually causing it.
assert.match(dashboard, /async function inventoryPcReferencePatch\(item = \{\}\)\{/, 'missing inventoryPcReferencePatch');
{
  const fnStart = dashboard.indexOf('async function inventoryPcReferencePatch(item = {}){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /providerUrl:verified\?\.url \|\| item\.providerUrl \|\| '',/,
    'inventoryPcReferencePatch must return providerUrl from the verified PriceCharting product, or the store\'s standard sports-card workflow never saves a link at all');
}

// Both callers (add-new-from-Research and edit-existing) must actually
// apply this patch to what gets saved, not just compute it and discard it.
const addCallStart = dashboard.indexOf("pcReferencePatch = await inventoryPcReferencePatch(item);");
assert(addCallStart > -1, 'inventoryPcReferencePatch must still be called from the add/edit save flow');
const spreadAfterAdd = dashboard.indexOf('...pcReferencePatch,', addCallStart);
assert(spreadAfterAdd > -1 && spreadAfterAdd - addCallStart < 4000, 'the computed pcReferencePatch must be spread into the saved item/updates in the same save function');

console.log('PriceCharting reference providerUrl contract checks passed');
