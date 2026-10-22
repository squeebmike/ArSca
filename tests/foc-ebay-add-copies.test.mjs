import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ebayItemFromGetItem } from '../scripts/foc-preorders.mjs';

// Store ask: "I pre sold a book. How can I list another without messing up
// the sold one?" A listed cover's LIST MORE ON EBAY button ran into the
// "Already listed" block, so another copy goes on the same listing: + ADD
// COPIES raises what's left for sale, and the sold ones stay sold.
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../scripts/foc-dashboard.js', import.meta.url), 'utf8');
function grab(src, head) {
  const start = src.indexOf(head);
  assert.ok(start >= 0, head);
  // Past the parameters, which can hold { destructuring } of their own.
  const body = /\)\s*\{/.exec(src.slice(start));
  let depth = 0, i = start + body.index + body[0].length - 1;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}

// A multi-cover listing counts a cover's Quantity as sold + left.
{
  const fn = grab(worker, 'async function ebayRevisePresalePriceQuantity(');
  const make = (ebaySold, ebayTreatsAsLeft = false) => {
    const calls = [];
    let total = ebaySold + 0;
    const ebayTradingApiCall = async (_tok, name, body) => {
      calls.push([name, body]);
      if (name === 'ReviseFixedPriceItem') { const q = body.match(/<Quantity>(\d+)<\/Quantity>/); if (q) total = ebayTreatsAsLeft ? Number(q[1]) + ebaySold : Number(q[1]); }
      const left = Math.max(0, total - ebaySold);
      return { raw: `<Item><ItemID>111</ItemID><Variations><Variation><SKU>sku-a</SKU><Quantity>${total}</Quantity><SellingStatus><QuantitySold>${ebaySold}</QuantitySold></SellingStatus><StartPrice>9.99</StartPrice></Variation></Variations></Item>`, left };
    };
    const run = new Function('ebayTradingApiCall', 'ebayItemFromGetItem', 'xmlEscape', 'ebayFetchWithRetry', `return (${fn});`)(ebayTradingApiCall, ebayItemFromGetItem, s => String(s), null);
    return { run, calls, left: () => Math.max(0, total - ebaySold) };
  };
  const d = { ebayApiSystem: 'trading', ebayListingId: '111', ebaySku: 'sku-a' };

  const one = make(1);
  await one.run({}, 'tok', d, { quantity: 1 });
  assert.match(one.calls.find(c => c[0] === 'ReviseFixedPriceItem')[1], /<Quantity>2<\/Quantity>/, '1 presold + 1 more = 2 listed');
  assert.equal(one.left(), 1, 'one copy left for sale, the sold one untouched');

  const asLeft = make(1, true);
  await asLeft.run({}, 'tok', d, { quantity: 1 });
  assert.equal(asLeft.left(), 1, 'if eBay took it as what is left, it is set back');

  const fresh = make(0);
  await fresh.run({}, 'tok', d, { quantity: 3 });
  assert.equal(fresh.calls.filter(c => c[0] === 'ReviseFixedPriceItem').length, 1);
  assert.equal(fresh.left(), 3, 'nothing sold yet: the number goes straight through');

  const priceOnly = make(2);
  await priceOnly.run({}, 'tok', d, { price: 12.5 });
  assert.ok(!priceOnly.calls.some(c => c[0] === 'GetItem'), 'a price change does not read the listing');
  assert.doesNotMatch(priceOnly.calls[0][1], /<Quantity>/);
}

// The card: + ADD COPIES on a listed or sold-out cover, never LIST MORE into a 409.
assert.ok(ui.includes("if((status==='LISTED'||status==='SOLD_OUT')&&v.ebayListingId)action=focEbayEditHtml(v)+'<button"), 'listed and sold-out covers get the edit box plus the button');
assert.ok(ui.includes(`onclick="focEbayAddCopies(\\''+esc(v.id)+'\\')">+ ADD COPIES TO THIS LISTING</button>';`));
{
  const fn = grab(ui, 'function focEbayAddCopies(');
  const field = { value: '0' }, saved = [], toasts = [];
  const run = (answer, el) => new Function('document', 'CSS', 'prompt', 'saveFocEbayEdit', 'toast_dash', `${fn}; return focEbayAddCopies;`)(
    { querySelector: () => el }, { escape: s => s }, () => answer, id => saved.push([id, field.value]), t => toasts.push(t));
  run('2', field)('sku-1');
  assert.deepEqual(saved, [['sku-1', '2']], '0 left + 2 more, saved through the same confirm-and-save as the edit box');
  run('', field)('sku-1');
  assert.equal(saved.length, 1, 'cancel does nothing');
  run('1', null)('sku-1');
  assert.match(toasts[0], /more than one eBay listing/);
}
assert.match(ui, /window\.focEbayAddCopies=focEbayAddCopies;/);
console.log('FOC eBay add copies checks passed');
