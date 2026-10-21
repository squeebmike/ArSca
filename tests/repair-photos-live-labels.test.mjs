import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ebayItemFromGetItem } from '../scripts/foc-preorders.mjs';

// REPAIR LISTING PHOTOS binds each cover's photo to its "Cover" value on
// eBay, which must match the live listing exactly. It rebuilt that value
// from comic_skus.variant_label -- which misses whenever the listing went up
// with a different text: withRatioWord's "Ratio" on ratio covers, labels made
// unique for Lunar's shared artist names, or covers relabeled since. It now
// reads each SKU's value from the live listing.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const grab = sig => { const s = worker.indexOf(sig); assert.ok(s >= 0, sig); return worker.slice(s, worker.indexOf('\n    }\n', s) + 6); };
const sent = [];
const getItemXml = '<GetItemResponse><Item><ItemID>178522216917</ItemID><Title>Robin Hood</Title><Variations>'
  + '<Variation><SKU>grp-0</SKU><Quantity>2</Quantity><VariationSpecifics><NameValueList><Name>Cover</Name><Value>Cvr M 1:20 Ratio David Nakayama Virgin</Value></NameValueList></VariationSpecifics><SellingStatus><QuantitySold>0</QuantitySold></SellingStatus></Variation>'
  + '<Variation><SKU>grp-1</SKU><Quantity>1</Quantity><VariationSpecifics><NameValueList><Name>Cover</Name><Value>Phil Hester</Value></NameValueList></VariationSpecifics><SellingStatus><QuantitySold>0</QuantitySold></SellingStatus></Variation>'
  + '</Variations></Item></GetItemResponse>';
function load(getItemOk) {
  return new Function('ebayTradingApiCall', 'ebayItemFromGetItem', 'xmlEscape', 'supabaseAdminFetch', 'setEbayVariationSpecificPhotos', [
    grab('    async function liveEbayVariationLabels('), grab('    async function repairEbayTradingGroupListingPhotos('),
    'return repairEbayTradingGroupListingPhotos;',
  ].join('\n'))(
    async (token, call) => { assert.equal(call, 'GetItem'); if (!getItemOk) throw new Error('eBay down'); return { raw: getItemXml }; },
    ebayItemFromGetItem, s => s,
    async () => ({ data: [{ id: 'sku-m', variant_label: 'Cvr M 1:20 David Nakayama Virgin' }, { id: 'sku-k', variant_label: 'Cvr K 1:10 Phil Hester Virgin' }] }),
    async (token, listingId, photos) => { sent.push(photos.map(p => [p.sku, p.label])); return { skipped: [] }; });
}
const rows = [
  { data: { ebayListingId: '178522216917', ebaySku: 'grp-0', focSkuId: 'sku-m', image: 'https://x/m.jpg' } },
  { data: { ebayListingId: '178522216917', ebaySku: 'grp-1', focSkuId: 'sku-k', image: 'https://x/k.jpg' } },
];
await load(true)({}, 'tok', 'grp', rows);
assert.deepEqual(sent.pop(), [['grp-0', 'Cvr M 1:20 Ratio David Nakayama Virgin'], ['grp-1', 'Phil Hester']], "each photo goes on the listing's own Cover value");
await load(false)({}, 'tok', 'grp', rows);
assert.deepEqual(sent.pop(), [['grp-0', 'Cvr M 1:20 David Nakayama Virgin'], ['grp-1', 'Cvr K 1:10 Phil Hester Virgin']], 'eBay unreadable: the saved labels, as before');
// The Inventory API path uses the live values too.
assert.match(worker, /const liveLabels = await liveEbayVariationLabels\(ebayToken, listingId\);\n\s*const variantPhotos = variantSKUs\.map\(sku => \(\{\n\s*sku,\n\s*label: liveLabels\.get\(sku\) \|\|/);
console.log('Repair listing photos uses live eBay cover values checks passed');
