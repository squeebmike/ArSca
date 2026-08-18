import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: labelQrPayload exists, uses the same buildTcgExternalLink() helper
// already used for the "view on TCGPlayer" button, only accepts a genuine
// /product/ deep link (never the search-URL fallback that same helper can also
// return), and tacks our own SKU onto it as an extra query param so scan-to-cart
// can still find the item. Anything else falls back to the plain SKU/ID. ──
assert.match(dashboard, /function labelQrPayload\(batchEntry\)\{/, 'missing labelQrPayload helper');
assert.match(dashboard, /const item = \(all \|\| \[\]\)\.find\(i => i\.id === batchEntry\.id\) \|\| batchEntry;/, 'labelQrPayload must look up the full live inventory item (batch entries are stripped-down snapshots without tcgPlayerUrl/category/etc.)');
assert.match(dashboard, /const link = typeof buildTcgExternalLink === 'function' \? buildTcgExternalLink\(item\) : null;/, 'labelQrPayload must reuse the existing buildTcgExternalLink helper, not a separate implementation');
assert.match(dashboard, /if\(link\?\.url && \/tcgplayer\\\.com\\\/product\\\/\/i\.test\(link\.url\)\)\{/, 'only a genuine /product/ URL counts -- buildTcgExternalLink\'s search-URL fallback (when there is no confirmed match) must NOT be treated as "exact"');
assert.match(dashboard, /return link\.url \+ '&wo_sku=' \+ encodeURIComponent\(sku\);/, 'a real product link must carry our own SKU as an extra query param');
assert.match(dashboard, /return sku;\s*\n\}/, 'labelQrPayload must fall back to the plain SKU/ID when there is no exact TCGPlayer match');

// ── Contract: both label paths only use labelQrPayload for QR style -- a linear
// barcode encoding a ~150-char URL would be absurd/unreadable at label size, so
// barcode style must keep using the plain compact SKU/ID exactly as before ──
const qrPayloadCallSites = dashboard.match(/generateLabelCodeCanvas\(codeStyle === 'qr' \? labelQrPayload\(b\) : \(b\.sku \|\| b\.id\), codeStyle\);/g) || [];
assert.equal(qrPayloadCallSites.length, 2, 'both printInventoryLabels and downloadInventoryLabelPngs must gate labelQrPayload behind codeStyle === \'qr\'');

console.log('Label QR TCGPlayer-link contract checks passed');

// ── Functional: reimplement labelQrPayload's decision logic and prove each branch ──
function labelQrPayload(batchEntry, { all, buildTcgExternalLink }){
  const sku = batchEntry.sku || batchEntry.id;
  try {
    const item = (all || []).find(i => i.id === batchEntry.id) || batchEntry;
    const link = typeof buildTcgExternalLink === 'function' ? buildTcgExternalLink(item) : null;
    if(link?.url && /tcgplayer\.com\/product\//i.test(link.url)){
      return link.url + '&wo_sku=' + encodeURIComponent(sku);
    }
  } catch(e) { /* fall through to plain SKU/ID if link-building fails for any reason */ }
  return sku;
}

// Matched Pokemon/MTG single -> exact product URL, our SKU appended
{
  const batchEntry = { id:'i1', sku:'WO-2044' };
  const all = [{ id:'i1', tcgPlayerUrl:'https://www.tcgplayer.com/product/654135' }];
  const buildTcgExternalLink = (item) => ({ url: `https://www.tcgplayer.com/product/654135?page=1&Language=English&Condition=Near+Mint` });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink });
  assert.equal(payload, 'https://www.tcgplayer.com/product/654135?page=1&Language=English&Condition=Near+Mint&wo_sku=WO-2044', 'a matched item must encode the exact product+condition URL with our SKU appended');
}

// No confirmed match (comics, sports, sealed, or unmatched) -> buildTcgExternalLink
// returns its search-URL fallback, which must NOT be treated as exact
{
  const batchEntry = { id:'i2', sku:'WO-3050' };
  const all = [{ id:'i2' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/search/pokemon/product?q=some+card' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink });
  assert.equal(payload, 'WO-3050', 'a search-URL fallback (no real product match) must not be encoded -- plain SKU only, since a search is not "exact"');
}

// Graded item -> buildTcgExternalLink returns an eBay sold-comps URL, not TCGPlayer
{
  const batchEntry = { id:'i3', sku:'WO-4010' };
  const all = [{ id:'i3' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.ebay.com/sch/i.html?_nkw=graded+card&LH_Sold=1' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink });
  assert.equal(payload, 'WO-4010', 'a non-TCGPlayer URL (e.g. the eBay sold-comps fallback for graded items) must not be encoded -- plain SKU only');
}

// Item not found in live inventory (id mismatch) -> falls back to the batch
// entry itself, which has no tcgPlayerUrl, so buildTcgExternalLink still
// can't produce an exact link -- must not throw, must fall back to plain SKU
{
  const batchEntry = { id:'i4', sku:'WO-5000' };
  const all = [];
  const buildTcgExternalLink = (item) => item.tcgPlayerUrl ? { url: item.tcgPlayerUrl } : { url: 'https://www.tcgplayer.com/search/all/product?q=x' };
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink });
  assert.equal(payload, 'WO-5000', 'an item missing from the live inventory array must not crash label generation -- falls back to plain SKU');
}

// buildTcgExternalLink throwing must not break label generation
{
  const batchEntry = { id:'i5', sku:'WO-6000' };
  const all = [{ id:'i5' }];
  const buildTcgExternalLink = () => { throw new Error('boom'); };
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink });
  assert.equal(payload, 'WO-6000', 'if buildTcgExternalLink throws for any reason, labelQrPayload must still return a usable plain SKU, not propagate the error');
}

console.log('labelQrPayload functional checks passed');
