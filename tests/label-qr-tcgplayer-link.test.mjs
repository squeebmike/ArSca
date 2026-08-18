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

// ── Contract: sports cards and comics (priced via PriceCharting, not TCGPlayer)
// get the same treatment -- item.providerUrl only counts as exact when it's a real
// /game/ product page, never the generic /search-products search fallback ──
assert.match(dashboard, /const pcUrl = item\.providerUrl \|\| '';/, 'labelQrPayload must check the PriceCharting-sourced providerUrl for sports/comics items');
assert.match(dashboard, /if\(\/pricecharting\\\.com\\\/game\\\/\/i\.test\(pcUrl\)\)\{/, 'only a genuine /game/ URL counts as exact -- the /search-products fallback for an unmatched item must NOT be treated as exact');
assert.match(dashboard, /return pcUrl \+ \(pcUrl\.includes\('\?'\) \? '&' : '\?'\) \+ 'wo_sku=' \+ encodeURIComponent\(sku\);/, 'a real PriceCharting product link must carry our own SKU as an extra query param, correctly joined whether or not the URL already has a query string');

assert.match(dashboard, /return sku;\s*\n\}/, 'labelQrPayload must fall back to the plain SKU/ID when there is no exact match on either site');

// ── Contract: both label paths only use labelQrPayload for QR style -- a linear
// barcode encoding a ~150-char URL would be absurd/unreadable at label size, so
// barcode style must keep using the plain compact SKU/ID exactly as before ──
assert.match(dashboard, /const canvas = await generateLabelCodeCanvas\(codeStyle === 'qr' \? labelQrPayload\(b\) : \(b\.sku \|\| b\.id\), codeStyle, codeGenSize\);/, 'printInventoryLabels must gate labelQrPayload behind codeStyle === \'qr\'');
assert.match(dashboard, /const codeValue = codeStyle === 'qr' \? labelQrPayload\(b\) : \(b\.sku \|\| b\.id\);/, 'downloadInventoryLabelPngs must gate labelQrPayload behind codeStyle === \'qr\' (resolved once, used by whichever layout branch runs)');

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
    const pcUrl = item.providerUrl || '';
    if(/pricecharting\.com\/game\//i.test(pcUrl)){
      return pcUrl + (pcUrl.includes('?') ? '&' : '?') + 'wo_sku=' + encodeURIComponent(sku);
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

// Matched sports card / comic (no TCGPlayer match, real PriceCharting product page) ->
// exact PriceCharting URL, our SKU appended
{
  const batchEntry = { id:'sc1', sku:'WO-7020' };
  const all = [{ id:'sc1', providerUrl:'https://www.pricecharting.com/game/sports-cards/2023-topps-chrome-shohei-ohtani' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/search/all/product?q=x' }); // no TCGPlayer match for a sports card
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink });
  assert.equal(payload, 'https://www.pricecharting.com/game/sports-cards/2023-topps-chrome-shohei-ohtani?wo_sku=WO-7020', 'a matched sports card must encode the exact PriceCharting product URL with our SKU appended, joined with a fresh ?');
}

// Same, but the PriceCharting URL already carries its own query string -- must join with &, not a second ?
{
  const batchEntry = { id:'cb1', sku:'WO-7030' };
  const all = [{ id:'cb1', providerUrl:'https://www.pricecharting.com/game/comic-books/amazing-spider-man-1?edition=cgc' }];
  const buildTcgExternalLink = () => null;
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink });
  assert.equal(payload, 'https://www.pricecharting.com/game/comic-books/amazing-spider-man-1?edition=cgc&wo_sku=WO-7030', 'our SKU must be joined with & when the PriceCharting URL already has a query string');
}

// Unmatched comic/sports item -> providerUrl is the generic /search-products fallback,
// which must NOT be treated as exact
{
  const batchEntry = { id:'sc2', sku:'WO-7040' };
  const all = [{ id:'sc2', providerUrl:'https://www.pricecharting.com/search-products?q=some+card&type=prices' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/search/all/product?q=x' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink });
  assert.equal(payload, 'WO-7040', 'a /search-products fallback (no confirmed PriceCharting product match) must not be encoded -- plain SKU only');
}

// TCGPlayer match takes priority over a PriceCharting providerUrl when somehow both exist
{
  const batchEntry = { id:'both1', sku:'WO-7050' };
  const all = [{ id:'both1', providerUrl:'https://www.pricecharting.com/game/pokemon-cards/some-card' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/product/999999?page=1&Condition=Near+Mint' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink });
  assert.equal(payload, 'https://www.tcgplayer.com/product/999999?page=1&Condition=Near+Mint&wo_sku=WO-7050', 'TCGPlayer must be checked first and win when both a TCGPlayer and a PriceCharting exact match exist');
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
