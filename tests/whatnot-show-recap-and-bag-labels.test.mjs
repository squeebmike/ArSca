import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Ending a live show: profit counts giveaway cost, the summary is kept on the
// show for PAST SHOWS (unless an imported report already saved the real one),
// and the recap links to the pack list and per-buyer 2x1 bag labels. Random /
// mystery sales captured live never take a specific book.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const fn = name => { const a = dashboard.indexOf(name); assert.ok(a >= 0, 'missing ' + name); return dashboard.slice(a, dashboard.indexOf('\n}\n', a) + 3); };

const end = fn('async function endWhatnotShow(){');
assert.match(end, /const profit = gross - cogs - estFees - giveawayCost;/, 'giveaways come off the show profit');
assert.match(end, /if\(!cur\?\.\[0\]\?\.report_summary\)/, 'a saved report summary is never overwritten by the live estimate');
assert.match(end, /report_summary:\{ source:'live'/);
assert.match(end, /opener\.printWhatnotBagLabels\(/);
assert.match(end, /opener\.openWhatnotPackList\(/);
assert.doesNotMatch(end, /<script>window\.print\(\);/, 'the recap no longer forces the print dialog over its buttons');

const ctx = { escHtml: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])) };
vm.createContext(ctx);
vm.runInContext(fn('function whatnotPackListGroups(rows = []){') + fn('function whatnotBagLabelsHtml(groups, show){'), ctx);
const groups = ctx.whatnotPackListGroups([
  { name:'A', status:'sold', sold_price_cents:500, buyer_name:'alice' },
  { name:'B', status:'giveaway', sold_price_cents:0, buyer_name:'Alice' },
  { name:'C', status:'sold', sold_price_cents:900, buyer_name:'bob' },
]);
const html = ctx.whatnotBagLabelsHtml(groups, { title:'Friday comics', started_at:'2026-10-02T23:00:00Z' });
assert.match(html, /@page\{size:2in 1in;margin:0\}/, '2x1 labels');
assert.equal((html.match(/class="l"/g) || []).length, 2, 'one label per buyer');
assert.match(html, /@alice<\/div><div class="m">2 items · incl\. giveaway/);
assert.match(html, /@bob<\/div><div class="m">1 item</);
assert.match(html, /Friday comics/);
assert.match(dashboard, /onclick="printWhatnotBagLabels\(\)">BAG LABELS<\/button>/);

const live = fn('async function recordWhatnotLiveSale(sale){');
assert.match(live, /isRandom \? \(typeof W\.whatnotRandomPoolItem === 'function'/, 'a random live sale only ever uses the random pool');
// Scanning price stickers into a show entry: the same scan screen in 'show'
// mode adds each scanned item to ENTER A SHOW, any sellable item, not only in-stock.
const scan = fn('async function handleCartScanValue(rawValue){');
assert.match(scan, /cartScanMode==='show'\?inventoryItemIsSellable\(i\):i\.status==='in_stock'/);
assert.match(scan, /window\.WB\.entryAdd\(item\.id\)/);
assert.match(fn('function openCartScanModal(mode){'), /cartScanMode==='show'\?'SCAN INTO SHOW'/);
console.log('Whatnot show recap and bag label checks passed');
