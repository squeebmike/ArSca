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
// than a third-party guess.
//
// The very first real print of this fallback (item id + store id + item
// name, ~230 chars) came back completely unscannable: a QR auto-sizes its
// module grid to fit the data, so that much text forced a much denser grid
// at the same physical label size than the printer could resolve. The
// fallback URL is now kept to just the item id (and wo_sku only when it
// isn't simply a duplicate of that id) -- short enough to stay in the same
// scannable range as the exact-match URLs that were already working fine.
assert.match(dashboard, /function labelQrPayload\(batchEntry\)\{/, 'missing labelQrPayload helper');
assert.match(dashboard, /const item = \(all \|\| \[\]\)\.find\(i => i\.id === batchEntry\.id\) \|\| batchEntry;/, 'labelQrPayload must look up the full live inventory item (batch entries are stripped-down snapshots without tcgPlayerUrl/category/etc.)');
assert.match(dashboard, /const pricedByPriceCharting = key === 'comic' \|\| key === 'sports';/, 'must route comics/sports through PriceCharting and everything else through TCGPlayer');
assert.match(dashboard, /if\(pricedByPriceCharting && \/\^https\?:\\\/\\\/\(www\\\.\)\?pricecharting\\\.com\\\/game\\\/\/i\.test\(pcUrl\)\)\{/, 'only a genuine /game/ PriceCharting product page counts -- the /search-products fallback must NOT be treated as a match');
assert.match(dashboard, /const link = typeof buildTcgExternalLink === 'function' \? buildTcgExternalLink\(item\) : null;/, 'labelQrPayload must reuse the existing buildTcgExternalLink helper, not a separate implementation');
assert.match(dashboard, /if\(link\?\.url && \/tcgplayer\\\.com\\\/product\\\/\/i\.test\(link\.url\)\)\{/, 'only a genuine /product/ TCGplayer URL counts -- its /search/ fallback (and the eBay sold-comps fallback for graded items) must NOT be treated as a match');
assert.match(dashboard, /const itemId = item\.id \|\| batchEntry\.id \|\| '';/, 'the storefront fallback must key off the item id, computed once and reused');
assert.match(dashboard, /const storefrontUrl = new URL\('https:\/\/themanapocket\.com\/'\);/, 'the fallback for anything without an exact match must be our own storefront, not a third-party search');
assert.match(dashboard, /storefrontUrl\.searchParams\.set\('item', itemId\);/, 'the storefront link must deep-link to this exact item by id');
assert.match(dashboard, /if\(sku !== itemId\) storefrontUrl\.searchParams\.set\('wo_sku', sku\);/, 'wo_sku must be omitted when it is simply a duplicate of the item id already carried by the item= param -- every extra character makes the printed QR denser');
assert.doesNotMatch(dashboard.slice(dashboard.indexOf('function labelQrPayload'), dashboard.indexOf('function labelQrPayload') + 2000), /searchParams\.set\('store'|searchParams\.set\('q'/, 'store and q must NOT be added back to the fallback URL -- they were the exact cause of the unscannable-QR regression');
assert.match(dashboard, /return sku;\s*\n\}/, 'labelQrPayload must fall back to the plain SKU/ID only if building the storefront URL itself throws');

// ── Contract: both label paths only use labelQrPayload for QR style -- a linear
// barcode encoding a ~150-char URL would be absurd/unreadable at label size, so
// barcode style must keep using the plain compact SKU/ID exactly as before ──
assert.match(dashboard, /const canvas = await generateLabelCodeCanvas\(codeStyle === 'qr' \? labelQrPayload\(b\) : \(b\.sku \|\| b\.id\), codeStyle, codeGenSize\);/, 'printInventoryLabels must gate labelQrPayload behind codeStyle === \'qr\'');
assert.match(dashboard, /const codeValue = codeStyle === 'qr' \? labelQrPayload\(b\) : \(b\.sku \|\| b\.id\);/, 'downloadInventoryLabelPngs must gate labelQrPayload behind codeStyle === \'qr\' (resolved once, used by whichever layout branch runs)');

console.log('Label QR contract checks passed');

// ── Contract: storefront.html must actually handle the ?item=/?q= deep link
// the label QR now points at -- otherwise the fallback lands on a plain
// homepage with no indication anything happened. ?q= stays supported here
// even though labelQrPayload no longer sends it, since a manually-typed or
// older-printed link might still use it. ──
assert.match(storefront, /function openDeepLinkFromUrl\(\)\{/, 'storefront.html must handle the item/q deep-link params the QR fallback encodes');
assert.match(storefront, /const wantedItemId=params\.get\('item'\);/, 'must read the item id param');
assert.match(storefront, /if\(wantedItemId && payload\.items\.some\(i=>i\.id===wantedItemId\)\)\{ openItem\(wantedItemId\); return; \}/, 'a matching item id must open that exact item\'s detail view (condition, price, ADD TO CART) -- the whole point of the fallback');
assert.match(storefront, /const wantedQuery=params\.get\('q'\);/, 'must read the q param as a secondary fallback');
assert.match(storefront, /if\(wantedQuery\)\{ const qEl=document\.getElementById\('q'\); if\(qEl\)\{ qEl\.value=wantedQuery; render\(\); \} \}/, 'when the item id isn\'t on the live catalog (sold/unpublished since the label was printed), must still land on a pre-filled search instead of a blank grid');
assert.match(storefront, /render\(\);openDeepLinkFromUrl\(\);\}catch\(e\)\{/, 'openDeepLinkFromUrl must run after the catalog has loaded and rendered, not before payload.items exists');

console.log('storefront.html deep-link contract checks passed');

// ── Functional: reimplement labelQrPayload's decision logic and prove each branch ──
function labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey }){
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
    const itemId = item.id || batchEntry.id || '';
    const storefrontUrl = new URL('https://themanapocket.com/');
    storefrontUrl.searchParams.set('item', itemId);
    if(sku !== itemId) storefrontUrl.searchParams.set('wo_sku', sku);
    return storefrontUrl.toString();
  } catch(e) { /* fall through to plain SKU/ID if link-building fails for any reason */ }
  return sku;
}
const qplCategoryKey = (cat) => /comic/i.test(cat) ? 'comic' : /sport/i.test(cat) ? 'sports' : 'other';

// Matched Pokemon/MTG single -> exact product+condition URL, our SKU appended
{
  const batchEntry = { id:'i1', sku:'WO-2044' };
  const all = [{ id:'i1', category:'Pokemon TCG', tcgPlayerUrl:'https://www.tcgplayer.com/product/654135' }];
  const buildTcgExternalLink = () => ({ url: `https://www.tcgplayer.com/product/654135?page=1&Language=English&Condition=Near+Mint` });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://www.tcgplayer.com/product/654135?page=1&Language=English&Condition=Near+Mint&wo_sku=WO-2044', 'a matched item must encode the exact product+condition URL with our SKU appended');
}

// No confirmed TCGplayer match -> its search-URL fallback must NOT be used,
// and the storefront fallback carries only the item id (no store/q/wo_sku
// duplicate) since sku here IS the item id
{
  const batchEntry = { id:'i2', sku:'i2' };
  const all = [{ id:'i2', category:'Pokemon TCG', name:'Some Card' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/search/pokemon/product?q=some+card' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://themanapocket.com/?item=i2', 'a TCGplayer search fallback (no real product match) must NOT be encoded, and the storefront fallback must stay minimal -- no store/q, and no wo_sku when it duplicates the item id');
}

// Same shape, but the item's real SKU differs from its id -> wo_sku is kept
// (needed for scan-to-cart to find it), everything else still dropped
{
  const batchEntry = { id:'i2b', sku:'UPC-00112233' };
  const all = [{ id:'i2b', category:'Pokemon TCG', name:'Some Other Card' }];
  const buildTcgExternalLink = () => null;
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://themanapocket.com/?item=i2b&wo_sku=UPC-00112233', 'a real SKU distinct from the item id must still be carried for scan-to-cart, but store/q must stay dropped');
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
// fallback, which must NOT be used -- storefront (item id only) is the backup
{
  const batchEntry = { id:'sc2', sku:'sc2' };
  const all = [{ id:'sc2', category:'Sports', name:'Random Card', providerUrl:'https://www.pricecharting.com/search-products?q=some+card&type=prices' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.tcgplayer.com/search/all/product?q=x' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://themanapocket.com/?item=sc2', 'a /search-products fallback (no confirmed PriceCharting product match) must NOT be encoded -- falls back to our own minimal storefront link');
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
// must NOT be used -- it is not an exact card+condition page either
{
  const batchEntry = { id:'i3', sku:'i3' };
  const all = [{ id:'i3', category:'Pokemon TCG', name:'Graded Card' }];
  const buildTcgExternalLink = () => ({ url: 'https://www.ebay.com/sch/i.html?_nkw=graded+card&LH_Sold=1' });
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://themanapocket.com/?item=i3', 'eBay sold comps is not an exact card+condition page and must not be encoded -- falls back to our own storefront');
}

// Item not found in live inventory (id mismatch) -> falls back to the batch
// entry itself; still lands on our own storefront by id, not a crash
{
  const batchEntry = { id:'i4', sku:'i4' };
  const all = [];
  const buildTcgExternalLink = (item) => item.tcgPlayerUrl ? { url: item.tcgPlayerUrl } : { url: 'https://www.tcgplayer.com/search/all/product?q=x' };
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'https://themanapocket.com/?item=i4', 'an item missing from the live inventory array must not crash label generation, and still deep-links to our storefront by id');
}

// buildTcgExternalLink throwing -> must still land on the storefront
// fallback, not propagate the error
{
  const batchEntry = { id:'i5', sku:'i5' };
  const all = [{ id:'i5', category:'Pokemon TCG' }];
  const buildTcgExternalLink = () => { throw new Error('boom'); };
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, 'i5', 'if buildTcgExternalLink throws, the whole try block aborts and labelQrPayload must still return a usable plain SKU, not propagate the error');
}

// ── Regression guard: the exact bug just fixed. A bare internal UUID as
// both id and "sku" (the common case -- most inventory has no real UPC)
// must never produce a payload anywhere near the ~230-char length that
// came back unscannable on a real print. ──
{
  const uuid = '94147ad9-2c6f-4db6-8bf9-abc123456789';
  const batchEntry = { id:uuid, sku:uuid, name:'Zoroark GX - SM84' };
  const all = [{ id:uuid, category:'Pokemon TCG', name:'Zoroark GX - SM84' }];
  const buildTcgExternalLink = () => null;
  const payload = labelQrPayload(batchEntry, { all, buildTcgExternalLink, qplCategoryKey });
  assert.equal(payload, `https://themanapocket.com/?item=${uuid}`, 'a bare-UUID item (no real UPC/SKU, no exact match) must produce the minimal item-id-only link');
  assert.ok(payload.length < 90, `fallback payload must stay short enough to print as a scannable QR at label size (was ${payload.length} chars: ${payload})`);
}

console.log('labelQrPayload functional checks passed');
