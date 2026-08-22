import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const storefront = fs.readFileSync('storefront.html', 'utf8');

// ── Contract: labelQrPayload ONLY uses TCGPlayer/PriceCharting when there is
// a genuine product+condition match -- their own SEARCH-URL fallbacks are
// explicitly rejected, since a search can show the wrong card/edition or
// someone else's listing entirely. Anything without an exact match instead
// falls back to our own themanapocket.com listing for this exact item
// (condition, price, ADD TO CART), which is a real specific page rather
// than a third-party guess. ──
assert.match(dashboard, /function labelQrPayload\(batchEntry\)\{/, 'missing labelQrPayload helper');
assert.match(dashboard, /const item = \(all \|\| \[\]\)\.find\(i => i\.id === batchEntry\.id\) \|\| batchEntry;/, 'labelQrPayload must look up the full live inventory item (batch entries are stripped-down snapshots without tcgPlayerUrl/category/etc.)');
assert.match(dashboard, /const pricedByPriceCharting = key === 'comic' \|\| key === 'sports';/, 'must route comics/sports through PriceCharting and everything else through TCGPlayer');
assert.match(dashboard, /if\(pricedByPriceCharting && \/\^https\?:\\\/\\\/\(www\\\.\)\?pricecharting\\\.com\\\/game\\\/\/i\.test\(pcUrl\)\)\{/, 'only a genuine /game/ PriceCharting product page counts -- the /search-products fallback must NOT be treated as a match');
assert.match(dashboard, /const link = typeof buildTcgExternalLink === 'function' \? buildTcgExternalLink\(item\) : null;/, 'labelQrPayload must reuse the existing buildTcgExternalLink helper, not a separate implementation');
assert.match(dashboard, /if\(link\?\.url && \/tcgplayer\\\.com\\\/product\\\/\/i\.test\(link\.url\)\)\{/, 'only a genuine /product/ TCGplayer URL counts -- its /search/ fallback (and the eBay sold-comps fallback for graded items) must NOT be treated as a match');
assert.match(dashboard, /const storefrontUrl = new URL\('https:\/\/themanapocket\.com\/'\);/, 'the fallback for anything without an exact match must be our own storefront, not a third-party search');
assert.match(dashboard, /storefrontUrl\.searchParams\.set\('item', item\.id \|\| batchEntry\.id \|\| ''\);/, 'the storefront link must deep-link to this exact item by id');
assert.match(dashboard, /storefrontUrl\.searchParams\.set\('store', \(typeof getActiveStoreId === 'function' \? getActiveStoreId\(\) : ''\) \|\| ''\);/, 'the storefront link must carry the active store id, matching the existing storefront.html?store= convention used elsewhere');
assert.match(dashboard, /if\(name\) storefrontUrl\.searchParams\.set\('q', name\);/, 'the storefront link should also carry the item name as a search fallback, in case the item id is not (or no longer) on the live catalog');
assert.match(dashboard, /return sku;\s*\n\}/, 'labelQrPayload must fall back to the plain SKU/ID only if building the storefront URL itself throws');

// ── Contract: both label paths only use labelQrPayload for QR style -- a linear
// barcode encoding a ~150-char URL would be absurd/unreadable at label size, so
// barcode style must keep using the plain compact SKU/ID exactly as before ──
assert.match(dashboard, /const canvas = await generateLabelCodeCanvas\(codeStyle === 'qr' \? labelQrPayload\(b\) : \(b\.sku \|\| b\.id\), codeStyle, codeGenSize\);/, 'printInventoryLabels must gate labelQrPayload behind codeStyle === \'qr\'');
assert.match(dashboard, /const codeValue = codeStyle === 'qr' \? labelQrPayload\(b\) : \(b\.sku \|\| b\.id\);/, 'downloadInventoryLabelPngs must gate labelQrPayload behind codeStyle === \'qr\' (resolved once, used by whichever layout branch runs)');

console.log('Label QR contract checks passed');

// ── Contract: storefront.html must actually handle the ?item=/?q= deep link
// the label QR now points at -- otherwise the fallback lands on a plain
// homepage with no indication anything happened ──
assert.match(storefront, /function openDeepLinkFromUrl\(\)\{/, 'storefront.html must handle the item/q deep-link params the QR fallback encodes');
assert.match(storefront, /const wantedItemId=params\.get\('item'\);/, 'must read the item id param');
assert.match(storefront, /if\(wantedItemId && payload\.items\.some\(i=>i\.id===wantedItemId\)\)\{ openItem\(wantedItemId\); return; \}/, 'a matching item id must open that exact item\'s detail view (condition, price, ADD TO CART) -- the whole point of the fallback');
assert.match(storefront, /const wantedQuery=params\.get\('q'\);/, 'must read the q param as a secondary fallback');
assert.match(storefront, /if\(wantedQuery\)\{ const qEl=document\.getElementById\('q'\); if\(qEl\)\{ qEl\.value=wantedQuery; render\(\); \} \}/, 'when the item id isn\'t on the live catalog (sold/unpublished since the label was printed), must still land on a pre-filled search instead of a blank grid');
assert.match(storefront, /render\(\);openDeepLinkFromUrl\(\);\}catch\(e\)\{/, 'openDeepLinkFromUrl must run after the catalog has loaded and rendered, not before payload.items exists');

console.log('storefront.html deep-link contract checks passed');

// ── Functional: reimplement labelQrPayload's decision logic and prove each branch ──
function labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey, getActiveStoreId }){
  const sku = batchEntry.sku || batchEntry.id;
  try {
    const item = (all || []).find(i => i.id === batchEntry.id) || batchEntry;
    const key = typeof qplCategoryKey === 'function' ? qplCategoryKey(item.category || '') : '';
    const pricedByPriceCharting = key === 'comic' || key === 'sports';
    const pcUrl = item.providerUrl || '';
    if(pricedByPriceCharting && /^https?:\/\/(www\.)?pricecharting\.com\/game\//i.test(pcUrl)){
      return pcUrl + (pcUrl.includes('?') ? '&' : '?') + 'wo_sku=' + encodeURIComponent(sku);
    }
    if(!pricedByPriceCharting){
      const link = typeof buildTcgExternalLink === 'function' ? buildTcgExternalLink(item) : null;
      if(link?.url && /tcgplayer\.com\/product\//i.test(link.url)){
        return link.url + '&wo_sku=' + encodeURIComponent(sku);
      }
    }
    const storefrontUrl = new URL('https://themanapocket.com/');
    storefrontUrl.searchParams.set('item', item.id || batchEntry.id || '');
    storefrontUrl.searchParams.set('store', (typeof getActiveStoreId === 'function' ? getActiveStoreId() : '') || '');
    const name = String(item.name || batchEntry.name || '').trim();
    if(name) storefrontUrl.searchParams.set('q', name);
    storefrontUrl.searchParams.set('wo_sku', sku);
    return storefrontUrl.toString();
  } catch(e) { /* fall through to plain SKU/ID if link-building fails for any reason */ }
  return sku;
}
const qplCategoryKey = (cat) => /comic/i.test(cat) ? 'comic' : /sport/i.test(cat) ? 'sports' : 'other';
const getActiveStoreId = () => 'store-123';

// Matched Pokemon/MTG single -> exact product+condition URL, our SKU appended
{
  const batchEntry = { id:'i1', sku:'WO-2044' };
  const all = [{ id:'i1', category:'Pokemon TCG', tcgPlayerUrl:'https://www.tcgplayer.com/product/654135' }];
  const buildTcgExternalLink = () => ({ url: `https://www.tcgplayer.com/product/654135?page=1&Language=English&Condition=Near+Mint` });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey, getActiveStoreId });
  assert.equal(payload, 'https://www.tcgplayer.com/product/654135?page=1&Language=English&Condition=Near+Mint&wo_sku=WO-2044', 'a matched item must encode the exact product+condition URL with our SKU appended');
}

// No confirmed TCGplayer match -> its search-URL fallback must NOT be used
// -- our own storefront listing is the backup instead
{
  const batchEntry = { id:'i2', sku:'WO-3050', name:'Some Card' };
  const all = [{ id:'i2', category:'Pokemon TCG', name:'Some Card' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/search/pokemon/product?q=some+card' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey, getActiveStoreId });
  assert.equal(payload, 'https://themanapocket.com/?item=i2&store=store-123&q=Some+Card&wo_sku=WO-3050', 'a TCGplayer search fallback (no real product match) must NOT be encoded -- our own storefront listing is the backup, never a third-party search');
}

// Matched sports card / comic (no TCGPlayer match, real PriceCharting product page) ->
// exact PriceCharting URL, our SKU appended
{
  const batchEntry = { id:'sc1', sku:'WO-7020' };
  const all = [{ id:'sc1', category:'Sports', providerUrl:'https://www.pricecharting.com/game/sports-cards/2023-topps-chrome-shohei-ohtani' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/search/all/product?q=x' }); // must not be used -- comics/sports route through PriceCharting
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey, getActiveStoreId });
  assert.equal(payload, 'https://www.pricecharting.com/game/sports-cards/2023-topps-chrome-shohei-ohtani?wo_sku=WO-7020', 'a matched sports card must encode the exact PriceCharting product URL with our SKU appended, joined with a fresh ?');
}

// Same, but the PriceCharting URL already carries its own query string -- must join with &, not a second ?
{
  const batchEntry = { id:'cb1', sku:'WO-7030' };
  const all = [{ id:'cb1', category:'Comic', providerUrl:'https://www.pricecharting.com/game/comic-books/amazing-spider-man-1?edition=cgc' }];
  const buildTcgExternalLink = () => null;
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey, getActiveStoreId });
  assert.equal(payload, 'https://www.pricecharting.com/game/comic-books/amazing-spider-man-1?edition=cgc&wo_sku=WO-7030', 'our SKU must be joined with & when the PriceCharting URL already has a query string');
}

// Unmatched comic/sports item -> providerUrl is the generic /search-products
// fallback, which must NOT be used -- storefront is the backup instead
{
  const batchEntry = { id:'sc2', sku:'WO-7040', name:'Random Card' };
  const all = [{ id:'sc2', category:'Sports', name:'Random Card', providerUrl:'https://www.pricecharting.com/search-products?q=some+card&type=prices' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/search/all/product?q=x' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey, getActiveStoreId });
  assert.equal(payload, 'https://themanapocket.com/?item=sc2&store=store-123&q=Random+Card&wo_sku=WO-7040', 'a /search-products fallback (no confirmed PriceCharting product match) must NOT be encoded -- falls back to our own storefront');
}

// TCGPlayer match takes priority over a PriceCharting providerUrl for a
// non-comic/sports category
{
  const batchEntry = { id:'both1', sku:'WO-7050' };
  const all = [{ id:'both1', category:'Pokemon TCG', providerUrl:'https://www.pricecharting.com/game/pokemon-cards/some-card' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/product/999999?page=1&Condition=Near+Mint' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey, getActiveStoreId });
  assert.equal(payload, 'https://www.tcgplayer.com/product/999999?page=1&Condition=Near+Mint&wo_sku=WO-7050', 'a non-comic/sports category must route through TCGPlayer even if a PriceCharting providerUrl happens to be present');
}

// Graded item -> buildTcgExternalLink returns an eBay sold-comps URL, which
// must NOT be used -- it is not an exact card+condition page either
{
  const batchEntry = { id:'i3', sku:'WO-4010', name:'Graded Card' };
  const all = [{ id:'i3', category:'Pokemon TCG', name:'Graded Card' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.ebay.com/sch/i.html?_nkw=graded+card&LH_Sold=1' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey, getActiveStoreId });
  assert.equal(payload, 'https://themanapocket.com/?item=i3&store=store-123&q=Graded+Card&wo_sku=WO-4010', 'eBay sold comps is not an exact card+condition page and must not be encoded -- falls back to our own storefront');
}

// Item not found in live inventory (id mismatch) -> falls back to the batch
// entry itself; still lands on our own storefront by id, not a crash
{
  const batchEntry = { id:'i4', sku:'WO-5000' };
  const all = [];
  const buildTcgExternalLink = (item) => item.tcgPlayerUrl ? { url: item.tcgPlayerUrl } : { url: 'https://www.tcgplayer.com/search/all/product?q=x' };
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey, getActiveStoreId });
  assert.equal(payload, 'https://themanapocket.com/?item=i4&store=store-123&wo_sku=WO-5000', 'an item missing from the live inventory array must not crash label generation, and still deep-links to our storefront by id');
}

// No active store id -> the store param is simply empty (storefront.html
// falls back to its own DEFAULT_STORE_ID for a bare custom-domain URL)
{
  const batchEntry = { id:'i6', sku:'WO-9000' };
  const all = [{ id:'i6', category:'Pokemon TCG' }];
  const buildTcgExternalLink = () => null;
  const noStore = () => '';
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey, getActiveStoreId:noStore });
  assert.equal(payload, 'https://themanapocket.com/?item=i6&store=&wo_sku=WO-9000', 'an empty active store id must not crash link-building -- storefront.html\'s own DEFAULT_STORE_ID fallback handles it');
}

// buildTcgExternalLink throwing -> must still land on the storefront
// fallback, not propagate the error
{
  const batchEntry = { id:'i5', sku:'WO-6000' };
  const all = [{ id:'i5', category:'Pokemon TCG' }];
  const buildTcgExternalLink = () => { throw new Error('boom'); };
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey, getActiveStoreId });
  assert.equal(payload, 'WO-6000', 'if buildTcgExternalLink throws, the whole try block aborts and labelQrPayload must still return a usable plain SKU, not propagate the error');
}

console.log('labelQrPayload functional checks passed');
