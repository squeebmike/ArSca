import fs from 'node:fs';
import assert from 'node:assert/strict';

// Found while checking a comic price sync: every edit to an inventory item
// (applying a synced price, a printed sticker, a quick price change) saved
// data.source as 'built_in', overwriting where the item came from. Received
// FOC books then looked hand-added to FOC receiving and sell-through, and a
// presale stopped converting to in stock (the switch reads foc_presale).
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const start = dashboard.indexOf('function builtInDataFromItem(');
const fn = dashboard.slice(start, dashboard.indexOf('\n}\n', start) + 2);
assert.match(fn, /source:item\.raw\?\.source \|\| 'built_in',/, 'the saved item keeps its own source');
assert.doesNotMatch(fn, /\n\s*source:'built_in',/, 'no edit overwrites it with built_in any more');
assert.match(fn, /\.\.\.\(item\.raw \|\| \{\}\),/, 'everything else on the saved row is carried over too');

const build = new Function('BUILT_IN_ITEM_SIMPLE_FIELDS', 'BUILT_IN_ITEM_ALIASED_FIELDS', 'mergeBuiltInSimpleField', 'catalogImageFromIds', 'APP_VERSION',
  fn + '\nreturn builtInDataFromItem;')([], [], () => '', () => '', 'test');
for (const source of ['foc_receive', 'foc_presale', 'foc_presale_bundle', 'dropship_import']) {
  const out = build({ id:'x', name:'Book', raw:{ source, focSkuId:'sku-1' } }, { market:9.99 });
  assert.equal(out.source, source, source + ' survives an edit');
  assert.equal(out.focSkuId, 'sku-1');
  assert.equal(out.market, 9.99);
}
assert.equal(build({ id:'y', name:'Card', raw:{} }, {}).source, 'built_in', 'an item with no source on record is a built-in item, as before');
console.log('Inventory edits keep the item\'s source checks passed');
