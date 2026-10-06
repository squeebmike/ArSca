import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Receiving a FOC shipment flips eBay presales to in stock: the " - PRESALE"
// comes off the title and item name, and multi-cover (Trading API) listings
// are switched too instead of being skipped.
const src = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const grab = re => { const m = src.match(re); assert.ok(m, 'missing ' + re); return m[0]; };

const calls = [];
let failTitle = false;
const ctx = { String, calls, get failTitle() { return failTitle; } };
vm.createContext(ctx);
vm.runInContext([
  grab(/function stripPresaleSuffix\(name\) \{[\s\S]*?\n\}/),
  grab(/function xmlUnescape\(s\) \{[\s\S]*?\n\}/),
  grab(/    function xmlEscape\(s\) \{[\s\S]*?\n    \}/),
  `async function ebayTradingApiCall(token, callName, body) {
     calls.push({ callName, body });
     if (callName === 'GetItem') return { raw: '<Item><ItemID>9</ItemID><Title>X-MEN #38 DNX &amp; FRIENDS - PRESALE</Title></Item>' };
     if (failTitle && body.includes('<Title>')) throw new Error('title locked');
     return { raw: '<Ack>Success</Ack>' };
   }`,
  grab(/    async function convertEbayVariationListingToInStockTrading\(ebayToken, listingId, fulfillmentPolicyId\) \{[\s\S]*?\n    \}/),
].join('\n') + ';this.strip=stripPresaleSuffix;this.convert=convertEbayVariationListingToInStockTrading;', ctx);

assert.equal(ctx.strip('Daybreak, Vol. 3 - PRESALE'), 'Daybreak, Vol. 3');
assert.equal(ctx.strip('X-MEN #38 -PRESALE '), 'X-MEN #38');
assert.equal(ctx.strip('Presale Pals #1'), 'Presale Pals #1', 'only the ending comes off');

{
  const r = await ctx.convert('tok', '9', 'pol1');
  assert.equal(r.titleChanged, true);
  const revise = calls.find(c => c.callName === 'ReviseFixedPriceItem');
  assert.match(revise.body, /<Title>X-MEN #38 DNX &amp; FRIENDS<\/Title>/);
  assert.match(revise.body, /<ShippingProfileID>pol1<\/ShippingProfileID>/);
}
{
  calls.length = 0; failTitle = true;
  const r = await ctx.convert('tok', '9', 'pol1');
  assert.equal(r.titleChanged, false);
  assert.match(r.titleError, /title locked/);
  const last = calls[calls.length - 1];
  assert.doesNotMatch(last.body, /<Title>/, 'retries with shipping only');
  assert.match(last.body, /<ShippingProfileID>pol1<\/ShippingProfileID>/);
  failTitle = false;
}

// Route wiring.
const route = grab(/if \(url\.pathname === '\/foc\/ebay\/convert-to-instock'\) \{[\s\S]*?\n    \}\n/);
assert.match(route, /d\.ebayApiSystem !== 'trading' && d\.ebaySku && d\.ebayOfferId/, 'single-cover path unchanged for REST rows');
assert.match(route, /tradingGroups\.set\(d\.ebayListingId, list\)/, 'multi-cover rows grouped by listing');
assert.match(route, /convertEbayVariationListingToInStockTrading\(ebayToken, listingId, normalFulfillmentPolicyId\)/);
assert.match(route, /const inStockName = stripPresaleSuffix\(d\.name\) \|\| 'Comic';/);
assert.match(route, /title: inStockName,/);
assert.match(route, /data: \{ \.\.\.d, name: inStockName, status: 'in_stock'/);
assert.match(route, /if \(d\.source === 'foc_presale_bundle' \|\| !\(Number\(d\.qty \?\? d\.quantity \?\? 0\) > 0\)\) continue;/, 'bundle option never becomes stock');
console.log('Presale to in-stock conversion checks passed');
