import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: labelQrPayload prefers an exact TCGplayer/PriceCharting
// product page, but -- unlike the original version of this function -- now
// falls back to a live search on the category-appropriate site rather than
// a bare SKU, since a bare SKU just makes a phone camera (Google Lens etc.)
// offer "search barcode" and go nowhere useful for a customer. Only an item
// with no name at all falls back to the plain SKU/ID. ──
assert.match(dashboard, /function labelQrPayload\(batchEntry\)\{/, 'missing labelQrPayload helper');
assert.match(dashboard, /const item = \(all \|\| \[\]\)\.find\(i => i\.id === batchEntry\.id\) \|\| batchEntry;/, 'labelQrPayload must look up the full live inventory item (batch entries are stripped-down snapshots without tcgPlayerUrl/category/etc.)');
assert.match(dashboard, /const pricedByPriceCharting = key === 'comic' \|\| key === 'sports';/, 'must route comics/sports through PriceCharting and everything else through TCGPlayer');
assert.match(dashboard, /if\(pricedByPriceCharting && \/\^https\?:\\\/\\\/\(www\\\.\)\?pricecharting\\\.com\\\/\/i\.test\(pcUrl\)\)\{/, 'any real PriceCharting URL on file (exact /game/ product OR its own /search-products fallback) must be used for comics/sports');
assert.match(dashboard, /const link = typeof buildTcgExternalLink === 'function' \? buildTcgExternalLink\(item\) : null;/, 'labelQrPayload must reuse the existing buildTcgExternalLink helper, not a separate implementation');
assert.match(dashboard, /if\(link\?\.url\) return link\.url \+ \(link\.url\.includes\('\?'\) \? '&' : '\?'\) \+ 'wo_sku=' \+ encodeURIComponent\(sku\);/, 'any URL buildTcgExternalLink returns (exact product, search fallback, or eBay sold comps for graded items) must be used for non-PriceCharting categories -- not just a genuine /product/ link');
assert.match(dashboard, /pricedByPriceCharting\s*\n\s*\? 'https:\/\/www\.pricecharting\.com\/search-products\?q=' \+ encodeURIComponent\(name\) \+ '&type=prices'\s*\n\s*: 'https:\/\/www\.tcgplayer\.com\/search\/all\/product\?q=' \+ encodeURIComponent\(name\);/, 'when nothing at all is on file, a fresh search must be built from the item\'s own name on the category-appropriate site');
assert.match(dashboard, /return sku;\s*\n\}/, 'labelQrPayload must fall back to the plain SKU/ID only when even a fresh search cannot be built (no name)');

// ── Contract: both label paths only use labelQrPayload for QR style -- a linear
// barcode encoding a ~150-char URL would be absurd/unreadable at label size, so
// barcode style must keep using the plain compact SKU/ID exactly as before ──
assert.match(dashboard, /const canvas = await generateLabelCodeCanvas\(codeStyle === 'qr' \? labelQrPayload\(b\) : \(b\.sku \|\| b\.id\), codeStyle, codeGenSize\);/, 'printInventoryLabels must gate labelQrPayload behind codeStyle === \'qr\'');
assert.match(dashboard, /const codeValue = codeStyle === 'qr' \? labelQrPayload\(b\) : \(b\.sku \|\| b\.id\);/, 'downloadInventoryLabelPngs must gate labelQrPayload behind codeStyle === \'qr\' (resolved once, used by whichever layout branch runs)');

console.log('Label QR TCGPlayer-link contract checks passed');

// ── Functional: reimplement labelQrPayload's decision logic and prove each branch ──
function labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey }){
  const sku = batchEntry.sku || batchEntry.id;
  try {
    const item = (all || []).find(i => i.id === batchEntry.id) || batchEntry;
    const key = typeof qplCategoryKey === 'function' ? qplCategoryKey(item.category || '') : '';
    const pricedByPriceCharting = key === 'comic' || key === 'sports';
    const pcUrl = item.providerUrl || '';
    if(pricedByPriceCharting && /^https?:\/\/(www\.)?pricecharting\.com\//i.test(pcUrl)){
      return pcUrl + (pcUrl.includes('?') ? '&' : '?') + 'wo_sku=' + encodeURIComponent(sku);
    }
    if(!pricedByPriceCharting){
      const link = typeof buildTcgExternalLink === 'function' ? buildTcgExternalLink(item) : null;
      if(link?.url) return link.url + (link.url.includes('?') ? '&' : '?') + 'wo_sku=' + encodeURIComponent(sku);
    }
    const name = String(item.name || batchEntry.name || '').trim();
    if(name){
      const searchUrl = pricedByPriceCharting
        ? 'https://www.pricecharting.com/search-products?q=' + encodeURIComponent(name) + '&type=prices'
        : 'https://www.tcgplayer.com/search/all/product?q=' + encodeURIComponent(name);
      return searchUrl + '&wo_sku=' + encodeURIComponent(sku);
    }
  } catch(e) { /* fall through to plain SKU/ID if link-building fails for any reason */ }
  return sku;
}
const qplCategoryKey = (cat) => /comic/i.test(cat) ? 'comic' : /sport/i.test(cat) ? 'sports' : 'other';

// Matched Pokemon/MTG single -> exact product URL, our SKU appended
{
  const batchEntry = { id:'i1', sku:'WO-2044' };
  const all = [{ id:'i1', category:'Pokemon TCG', tcgPlayerUrl:'https://www.tcgplayer.com/product/654135' }];
  const buildTcgExternalLink = () => ({ url: `https://www.tcgplayer.com/product/654135?page=1&Language=English&Condition=Near+Mint` });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://www.tcgplayer.com/product/654135?page=1&Language=English&Condition=Near+Mint&wo_sku=WO-2044', 'a matched item must encode the exact product+condition URL with our SKU appended');
}

// No confirmed TCGplayer match -> its own search-URL fallback is now used
// (previously fell back to plain SKU)
{
  const batchEntry = { id:'i2', sku:'WO-3050', name:'Some Card' };
  const all = [{ id:'i2', category:'Pokemon TCG' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/search/pokemon/product?q=some+card' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://www.tcgplayer.com/search/pokemon/product?q=some+card&wo_sku=WO-3050', 'a search-URL fallback still lands on a real, useful site instead of a bare SKU that goes nowhere');
}

// Matched sports card / comic (no TCGPlayer match, real PriceCharting product page) ->
// exact PriceCharting URL, our SKU appended
{
  const batchEntry = { id:'sc1', sku:'WO-7020' };
  const all = [{ id:'sc1', category:'Sports', providerUrl:'https://www.pricecharting.com/game/sports-cards/2023-topps-chrome-shohei-ohtani' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/search/all/product?q=x' }); // must not be used -- comics/sports route through PriceCharting
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://www.pricecharting.com/game/sports-cards/2023-topps-chrome-shohei-ohtani?wo_sku=WO-7020', 'a matched sports card must encode the exact PriceCharting product URL with our SKU appended, joined with a fresh ?');
}

// Same, but the PriceCharting URL already carries its own query string -- must join with &, not a second ?
{
  const batchEntry = { id:'cb1', sku:'WO-7030' };
  const all = [{ id:'cb1', category:'Comic', providerUrl:'https://www.pricecharting.com/game/comic-books/amazing-spider-man-1?edition=cgc' }];
  const buildTcgExternalLink = () => null;
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://www.pricecharting.com/game/comic-books/amazing-spider-man-1?edition=cgc&wo_sku=WO-7030', 'our SKU must be joined with & when the PriceCharting URL already has a query string');
}

// Unmatched comic/sports item -> providerUrl is the generic /search-products
// fallback, which is now used (previously fell back to plain SKU)
{
  const batchEntry = { id:'sc2', sku:'WO-7040' };
  const all = [{ id:'sc2', category:'Sports', providerUrl:'https://www.pricecharting.com/search-products?q=some+card&type=prices' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/search/all/product?q=x' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://www.pricecharting.com/search-products?q=some+card&type=prices&wo_sku=WO-7040', 'a /search-products fallback still lands on the right site instead of a bare SKU');
}

// TCGPlayer match takes priority over a PriceCharting providerUrl for a
// non-comic/sports category
{
  const batchEntry = { id:'both1', sku:'WO-7050' };
  const all = [{ id:'both1', category:'Pokemon TCG', providerUrl:'https://www.pricecharting.com/game/pokemon-cards/some-card' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/product/999999?page=1&Condition=Near+Mint' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://www.tcgplayer.com/product/999999?page=1&Condition=Near+Mint&wo_sku=WO-7050', 'a non-comic/sports category must route through TCGPlayer even if a PriceCharting providerUrl happens to be present');
}

// Graded item -> buildTcgExternalLink returns an eBay sold-comps URL, which
// is now used directly (previously fell back to plain SKU)
{
  const batchEntry = { id:'i3', sku:'WO-4010' };
  const all = [{ id:'i3', category:'Pokemon TCG' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.ebay.com/sch/i.html?_nkw=graded+card&LH_Sold=1' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://www.ebay.com/sch/i.html?_nkw=graded+card&LH_Sold=1&wo_sku=WO-4010', 'eBay sold comps for a graded item is a real, useful landing page and must be used instead of a bare SKU');
}

// Comic with nothing on file at all (no providerUrl) -> a fresh PriceCharting
// search is built from the item's name
{
  const batchEntry = { id:'cb2', sku:'WO-8000', name:'Unlinked Comic #1' };
  const all = [{ id:'cb2', category:'Comic', name:'Unlinked Comic #1' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/search/all/product?q=x' }); // must not be used
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://www.pricecharting.com/search-products?q=Unlinked%20Comic%20%231&type=prices&wo_sku=WO-8000', 'a comic with no PriceCharting link at all must still get a fresh PriceCharting search built from its own name');
}

// Item not found in live inventory (id mismatch) -> falls back to the batch
// entry itself; buildTcgExternalLink still returns a usable url from it
{
  const batchEntry = { id:'i4', sku:'WO-5000' };
  const all = [];
  const buildTcgExternalLink = (item) => item.tcgPlayerUrl ? { url: item.tcgPlayerUrl } : { url: 'https://www.tcgplayer.com/search/all/product?q=x' };
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://www.tcgplayer.com/search/all/product?q=x&wo_sku=WO-5000', 'an item missing from the live inventory array must not crash label generation, and still lands on a real search page');
}

// buildTcgExternalLink throwing, with no name to fall back to -> plain SKU,
// must not propagate the error
{
  const batchEntry = { id:'i5', sku:'WO-6000' };
  const all = [{ id:'i5', category:'Pokemon TCG' }];
  const buildTcgExternalLink = () => { throw new Error('boom'); };
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'WO-6000', 'if buildTcgExternalLink throws and there is no name to build a fresh search from, labelQrPayload must still return a usable plain SKU, not propagate the error');
}

console.log('labelQrPayload functional checks passed');
