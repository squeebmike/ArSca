import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Ending a live show: profit counts giveaway cost, the summary is kept on the
// show for PAST SHOWS (unless an imported report already saved the real one),
// and the recap prints.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const fn = name => { const a = dashboard.indexOf(name); assert.ok(a >= 0, 'missing ' + name); return dashboard.slice(a, dashboard.indexOf('\n}\n', a) + 3); };

const end = fn('async function endWhatnotShow(){');
assert.match(end, /const profit = gross - cogs - estFees - giveawayCost;/, 'giveaways come off the show profit');
assert.match(end, /if\(!cur\?\.\[0\]\?\.report_summary\)/, 'a saved report summary is never overwritten by the live estimate');
assert.match(end, /report_summary:\{ source:'live'/);
// The sticker helper's show pack list / bag labels were removed 2026-11-02.
assert.doesNotMatch(end, /opener\.printWhatnotBagLabels\(|opener\.openWhatnotPackList\(/);
assert.doesNotMatch(end, /<script>window\.print\(\);/, 'the recap no longer forces the print dialog over its buttons');

// Scanning price stickers into a show entry: the same scan screen in 'show'
// mode adds each scanned item to ENTER A SHOW, any sellable item, not only in-stock.
const scan = fn('async function handleCartScanValue(rawValue){');
assert.match(scan, /cartScanMode==='show'\?inventoryItemIsSellable\(i\):i\.status==='in_stock'/);
assert.match(scan, /window\.WB\.entryAdd\(item\.id\)/);
assert.match(fn('function openCartScanModal(mode){'), /cartScanMode==='show'\?'SCAN INTO SHOW'/);
console.log('Whatnot show recap and bag label checks passed');
