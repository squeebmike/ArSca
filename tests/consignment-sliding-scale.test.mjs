import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Store ask: set the normal consignment percents as the default for everyone
// consigned from now on, and "what would I set the number to so the person's
// item sells and they get 100 percent?" (0 -- the number is what the store
// keeps; Shawn Warner's items were at 100, so the store kept everything).
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const pick = name => { const start = ui.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return ui.slice(start, ui.indexOf('\n', start)); };
const tiersLine = ui.slice(ui.indexOf('const CONSIGN_SPLIT_TIERS='), ui.indexOf('\n', ui.indexOf('const CONSIGN_SPLIT_TIERS=')));

// The sliding scale.
const make = directory => new Function('consignmentOwnerDirectory', [tiersLine, pick('consignTierSplit'), pick('consignTiersText'), pick('consignSplitFor'), pick('consignSplitValue')].join('\n') + '; return { consignTierSplit, consignSplitFor, consignSplitValue, consignTiersText };')(() => directory);
{
  const { consignTierSplit, consignSplitValue } = make([]);
  for (const [price, split] of [[0, 30], [23, 30], [49.99, 30], [50, 25], [153, 25], [249.99, 25], [250, 20], [453, 20], [999.99, 20], [1000, 15], [5000, 15]]) assert.equal(consignTierSplit(price), split, '$' + price);
  assert.equal(consignSplitValue('0', 25), 0, '0 means the owner gets it all -- never swapped for 25');
  assert.equal(consignSplitValue('', 25), 25);
  assert.equal(consignSplitValue('150', 25), 100);
  assert.equal(consignSplitValue('-5', 25), 0);
}
// A person's own percent wins only when they have one.
{
  const { consignSplitFor } = make([{ name: 'Sean C', split: 33, customSplit: false }, { name: 'Partner', split: 0, customSplit: true }, { name: 'Ten', split: 10, customSplit: true }]);
  assert.equal(consignSplitFor('Sean C', 453), 20, 'no percent of his own: the scale');
  assert.equal(consignSplitFor('sean c', 23), 30);
  assert.equal(consignSplitFor('Partner', 453), 0, 'custom 0 stays 0');
  assert.equal(consignSplitFor('Ten', 40), 10);
  assert.equal(consignSplitFor('Someone New', 1200), 15);
}

// The add form and the people list say which way the number goes.
assert.match(html, /Store Keeps % <span style="opacity:\.7">\(0 = owner gets it all\)<\/span><\/label>/);
assert.match(html, /id="cs-split" value="30"[^>]*oninput="this\.dataset\.manual='1'"/);
assert.match(html, /id="cs-price"[^>]*oninput="consignFormSplitAuto\(\)"/);
assert.match(html, /id="cs-owner"[^>]*oninput="consignFormSplitAuto\(\)"/);
assert.match(html, /id="cs-person-split"[^>]*value="" placeholder="Store keeps % · blank = sliding scale"/);
assert.ok(!/id="cs-split" value="25"/.test(html), 'no 25% default');
assert.ok(ui.includes("const split = consignSplitValue(document.getElementById('cs-split').value, consignSplitFor(owner, price));"), 'a 0 typed in is kept');
assert.ok(!ui.includes("parseFloat(document.getElementById('cs-split').value)||25"), 'the old 0 -> 25 swap is gone');
assert.ok(ui.includes("${p.customSplit?'store keeps '+Number(p.split??25)+'%':'sliding scale'}</button>"));
// Editing a person's percent changes what's still for sale -- never a sold item's payout.
assert.ok(ui.includes("c.status==='active'?{split:customSplit?split:consignTierSplit(c.price)}:{}"));
assert.ok(ui.includes('custom_split:!!p.customSplit,') && ui.includes('customSplit:!!p.custom_split,'), 'saved with the person');

// Only rows this device changed are written back.
{
  const src = ['consignRowKey', 'rememberConsignCloudRows', 'syncConsignmentsToCloud'].map(n => { const s = ui.indexOf((n === 'syncConsignmentsToCloud' ? 'async ' : '') + 'function ' + n + '('); return ui.slice(s, ui.indexOf('\n', s)); }).join('\n');
  const seenLine = ui.slice(ui.indexOf('const consignCloudSeen='), ui.indexOf('\n', ui.indexOf('const consignCloudSeen=')));
  const upserts = [];
  const sb = { from: table => ({ upsert: async rows => { upserts.push([table, rows.map(r => r.id)]); return { error: null }; } }) };
  const items = [{ id: 'cs_1', owner: 'Sean C', split: 20 }, { id: 'cs_2', owner: 'Sean C', split: 30 }];
  const api = new Function('getSupabaseClient', 'getActiveStoreId', 'adoptCloudSoldConsignments', 'consignorPeople', 'consignItems', 'getConsignmentAlerts', 'consignPersonToCloud', 'consignItemToCloud', 'consignAlertToCloud', 'consignmentCloudReady',
    seenLine + '\n' + src + '; return { syncConsignmentsToCloud, rememberConsignCloudRows };')(
    () => sb, () => 'store-1', async () => {}, [], items, () => [], p => p, c => ({ id: c.id, owner_name: c.owner, store_split_percent: c.split, updated_at: String(Math.random()) }), a => a, true);
  api.rememberConsignCloudRows('consignment_items', items.map(c => ({ id: c.id, owner_name: c.owner, store_split_percent: c.split })));
  await api.syncConsignmentsToCloud();
  assert.deepEqual(upserts, [], 'nothing changed here: nothing written (updated_at alone is not a change)');
  items[1].split = 25;
  await api.syncConsignmentsToCloud();
  assert.deepEqual(JSON.parse(JSON.stringify(upserts)), [['consignment_items', ['cs_2']]], 'only the row changed here');
  await api.syncConsignmentsToCloud();
  assert.equal(upserts.length, 1, 'and only once');
}
assert.ok(ui.includes("rememberConsignCloudRows('consignment_items',consignItems.map(consignItemToCloud));"), 'remembered when loaded');
console.log('Consignment sliding scale checks passed');
