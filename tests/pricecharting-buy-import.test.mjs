import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importRows, parseCsv, categoryFrom } from '../scripts/pricecharting-buy-import.mjs';
// Store, 2026-11-09: PriceCharting's photo scanner puts cards in a
// collection; its CSV export comes into the Buy tab.
const pc = [
  'id,product-name,console-name,price-in-pennies,include-string,condition-string,condition-id,sku,notes,cost-basis-in-pennies,quantity,date-entered,date-purchased,grading-company,grading-cert-id,folder',
  '5605716,Gloom #198,Pokemon Obsidian Flames,1999,Ungraded,Normal wear,1,,,0,1,2026-06-04,2026-06-04,,,',
  '111,"Latias EX #87",Pokemon Roaring Skies,18851,PSA 10,Normal wear,1,,"note, with comma",0,2,2026-06-04,2026-06-04,PSA,12345678,',
  '222,Umbreon ex #217,Pokemon Chinese SV8a,42000,Ungraded,Normal wear,1,,,0,1,,,,,',
  '333,Altaria #74,Pokemon Dragon Majesty,2371,Graded 9.5,Normal wear,1,,,0,1,,,Beckett,,',
].join('\n');
const r = importRows(pc);
assert.equal(r.format, 'PriceCharting');
assert.equal(r.items.length, 4);
assert.deepEqual(r.items[0], { name: 'Gloom #198', set: 'Obsidian Flames', category: 'Pokemon TCG', card_number: '198', language: '', condition: 'NM', grade: '', grader: '', cert_number: '', quantity: 1, market: 19.99, pricechartingProductId: '5605716', providerUrl: 'https://www.pricecharting.com/game/pokemon-obsidian-flames/gloom-198', notes: '', source: 'PriceCharting export' });
assert.deepEqual([r.items[1].grader, r.items[1].grade, r.items[1].condition, r.items[1].quantity, r.items[1].cert_number, r.items[1].notes], ['PSA', '10', 'Graded', 2, '12345678', 'note, with comma']);
assert.deepEqual([r.items[2].set, r.items[2].language, r.items[2].market], ['SV8a', 'Chinese', 420]);
assert.deepEqual([r.items[3].grader, r.items[3].grade], ['Beckett', '9.5']);

// Collectr's export too.
const c = importRows('Portfolio Name,Category,Set,Product Name,Card Number,Rarity,Variance,Grade,Card Condition,Average Cost Paid,Quantity,Market Price (As of 2026-11-04),Price Override,Watchlist,Date Added,Notes\nbuying,Pokemon,Black Bolt,Black Bolt Elite Trainer Box,,,Normal,Ungraded,Near Mint,0,2,154.42,0,false,2026-05-06,\nbuying,Pokemon,151,Charizard ex,199/165,,Holofoil,PSA 10,Near Mint,0,1,$397.00,0,false,2026-05-06,');
assert.equal(c.format, 'Collectr');
assert.deepEqual(c.items.map(i => [i.name, i.quantity, i.market, i.condition, i.grader, i.grade]), [['Black Bolt Elite Trainer Box', 2, 154.42, 'NM', '', ''], ['Charizard ex', 1, 397, 'Graded', 'PSA', '10']]);
assert.equal(importRows('a,b\n1,2').format, '', 'anything else is refused');
assert.deepEqual(parseCsv('a,"b ""q"" c"\r\n1,2\r\n'), [['a', 'b "q" c'], ['1', '2']]);
assert.equal(categoryFrom('Magic Zendikar Rising'), 'Magic: The Gathering');
assert.equal(categoryFrom('Baseball Cards 2024 Topps'), 'Sports Card');

// The Buy tab: an IMPORT button and the importer.
const html = fs.readFileSync('dashboard.html', 'utf8'), app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.match(html, /<input type="file" id="bl-import-file" accept="\.csv,text\/csv,\.txt,text\/plain" style="display:none" onchange="importCollectionToBuyList\(this\.files\[0\]\);this\.value=''">/);
assert.match(app, /async function importCollectionToBuyList\(file\)\{/);
assert.match(app, /const \{ format, items, skipped \} = mod\.importRows\(fileText\);/);
assert.match(app, /if\(copies > 1000\) return toast_dash/);
console.log('PriceCharting / Collectr export into the Buy tab passed');
