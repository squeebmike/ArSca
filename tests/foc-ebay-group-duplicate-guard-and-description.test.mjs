import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store report: clicking LIST ALL COVERS twice created two separate live
// eBay listings for the same 7 covers -- confirmed directly in the
// database (two distinct ebayListingId groups, same focSkuIds, 10 minutes
// apart) -- a real double-sell risk against the same physical stock, not
// just a cosmetic duplicate.

const createStart = worker.indexOf("if (url.pathname === '/foc/ebay/presale-group-preview' || url.pathname === '/foc/ebay/create-presale-group')");
assert.ok(createStart !== -1, 'the group create/preview route must exist');
const createEnd = worker.indexOf("if (url.pathname === '/foc/ebay/convert-to-instock')", createStart);
assert.ok(createEnd > createStart, 'must find the next route boundary after create-presale-group');
const createBody = worker.slice(createStart, createEnd);

const isPreviewReturnIdx = createBody.indexOf('if (isPreview)');
const builtLoopIdx = createBody.indexOf('const built = [];');
const guardIdx = createBody.indexOf('alreadyListedRows');
assert.ok(isPreviewReturnIdx !== -1 && builtLoopIdx !== -1 && guardIdx !== -1, 'preview branch, built-covers loop, and duplicate guard must all exist');
assert.ok(guardIdx > builtLoopIdx, 'the duplicate-listing guard must run after the chosen covers are resolved, so it knows exactly which skuIds are about to be (re-)published');
assert.ok(guardIdx > isPreviewReturnIdx, 'the duplicate-listing guard must live on the create path, after the preview branch already returned -- preview must keep working even when covers are already listed, so staff can still see status');

assert.match(createBody, /status=in\.\(presale,in_stock\)/, 'the duplicate check must look at currently-live inventory rows (presale or in_stock), not archived/sold ones');
assert.match(createBody, /d\.focSkuId && d\.ebayListingId && built\.some\(v => v\.skuId === d\.focSkuId\)/, 'a cover only counts as "already listed" if it is one of the covers actually being published now AND already carries a live ebayListingId');
assert.match(createBody, /return json\(\{ ok: false, error: `Already listed on eBay/, 'an already-listed cover must block the whole create with a clear, actionable error instead of silently creating a duplicate listing');

console.log('Duplicate eBay group-listing guard checks passed');

// Store request: "the listing should include the info on all covers ratio
// ect so it gets views" -- eBay only indexes a shared listing's description
// text, not per-variant metadata, so a buyer searching for a specific
// incentive ratio ("1:100 variant") can only find this listing if that
// ratio is spelled out in the description itself.

assert.match(createBody, /const descriptionBase = \(typeof body\.description/, 'the original description (default or custom template) must still be computed first');
assert.match(createBody, /const coversListText = 'This listing includes '/, 'a covers/ratio summary must be built from the covers actually being published');
assert.match(createBody, /built\.map\(v => `- \$\{v\.label\} -- \$\$\{v\.price\}`\)/, 'every published cover\'s own label (which carries its incentive ratio, e.g. "CVR D INC 1:10...") and price must appear in the description');
assert.match(createBody, /const description = \[descriptionBase, coversListText\]\.filter\(Boolean\)\.join\('\\n\\n'\)\.substring\(0, 4000\)/, 'the covers list must be appended to whatever description is actually used, so it survives a custom template instead of being silently dropped by it');

console.log('eBay group-listing covers/ratio description checks passed');
