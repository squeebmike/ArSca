import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store report: Research Queue showed 51 items all labeled generic
// "Research item" with a "SCAN" placeholder box instead of a photo, even
// though they were real eBay comp candidates from Pocket Scout scan
// sessions. Root cause: the worker persists each candidate's payload with
// `title` and `image` fields (see cloudflare-worker-full.js, the
// scan_queue insert in the pocket-scout photo route), but the drawer's
// renderer and getScanImageUrl() never checked those exact field names --
// only name/queryUsed/rawExtractedText for the title, and a list of image
// aliases that didn't include `image`. Real data was sitting right there
// in the payload; the reader just wasn't looking for it.

const dashboardSrc = fs.readFileSync('dashboard.html', 'utf8');

const rendererMatch = dashboardSrc.match(/async function renderResearchQueue\(\)\{[\s\S]*?\n\}\n/);
assert.ok(rendererMatch, 'expected to find renderResearchQueue()');
const titleLineMatch = rendererMatch[0].match(/const title = ([^;]+);/);
assert.ok(titleLineMatch, 'expected to find the research-queue-list title fallback chain inside renderResearchQueue()');
assert.match(
  titleLineMatch[1],
  /s\.title/,
  'Research Queue title fallback must check s.title -- that is the field Pocket Scout actually writes for each eBay comp candidate (cloudflare-worker-full.js scan_queue insert), so without it every real candidate falls back to the generic "Research item" label'
);

const getScanImageUrlMatch = dashboardSrc.match(/function getScanImageUrl\(scan\)\{\s*return ([^;]+);\s*\}/);
assert.ok(getScanImageUrlMatch, 'expected to find getScanImageUrl()');
assert.match(
  getScanImageUrlMatch[1],
  /scan\?\.image\b(?!Url|_url)/,
  'getScanImageUrl must check scan.image -- that is the exact field name Pocket Scout writes (payload.image = l.imageUrl), so without this alias every real candidate photo is silently dropped in favor of the SCAN placeholder box'
);

// The same field-name mismatch existed one layer deeper: the queue's own
// action buttons (Open / Buy / Cart) each rebuild a name/query from the
// scan object independently, and none of those three checked scan.title
// either -- so even once the card *displayed* a real title, clicking Open
// searched nothing, and Buy/Cart added a generic "Phone scan" line item.

const openFnMatch = dashboardSrc.match(/async function openScanInResearch\(scanId\)\{[\s\S]*?\n\}\n/);
assert.ok(openFnMatch, 'expected to find openScanInResearch()');
const qLineMatch = openFnMatch[0].match(/const q = ([^;]+);/);
assert.ok(qLineMatch, 'expected to find the search-query fallback chain inside openScanInResearch()');
assert.match(
  qLineMatch[1],
  /scan\.title/,
  'openScanInResearch\'s query fallback must check scan.title -- otherwise clicking Open on a Pocket Scout candidate runs an empty search'
);

const addToCartFnMatch = dashboardSrc.match(/function addScanToCart\(scan\)\{[\s\S]*?\n\}\n/);
assert.ok(addToCartFnMatch, 'expected to find addScanToCart()');
assert.match(
  addToCartFnMatch[0],
  /name:\s*scan\.name \|\| scan\.title \|\| 'Phone scan'/,
  'addScanToCart\'s name fallback must check scan.title -- otherwise the Cart button adds a generic "Phone scan" line item for every Pocket Scout candidate'
);

const buyItemFnMatch = dashboardSrc.match(/function scanToBuyItem\(scan\)\{[\s\S]*?\n\}\n/);
assert.ok(buyItemFnMatch, 'expected to find scanToBuyItem()');
assert.match(
  buyItemFnMatch[0],
  /name:\s*scan\.name \|\| scan\.title \|\| scan\.player \|\| 'Phone scan'/,
  'scanToBuyItem\'s name fallback must check scan.title -- otherwise the Buy button adds a generic "Phone scan" line item for every Pocket Scout candidate'
);
assert.match(
  buyItemFnMatch[0],
  /providerUrl:\s*scan\.providerUrl \|\| scan\.sourceUrl \|\| ''/,
  'scanToBuyItem\'s providerUrl fallback must check scan.sourceUrl -- that is the field Pocket Scout writes for the actual eBay listing link, so without it the buy offer loses the source link entirely'
);

console.log('Research Queue payload mapping checks passed');
