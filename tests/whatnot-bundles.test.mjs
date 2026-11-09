import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bundlePackage, packageFor } from '../scripts/shipping-package.mjs';
import { whatnotDesired } from '../scripts/whatnot-sync.mjs';
// Store, 2026-11-08: "add breaks, surprise sets etc from dashboard into
// whatnot ... can we do this with connecting covers or runs? To have more
// than one book for sale bundled. And shipping weights etc update?"

// One parcel: the biggest package, everyone's contents, stacked.
const comic = n => ({ data: { name: 'Absolute Batman #' + n, category: 'Comic' }, price: 5 });
const three = bundlePackage([comic(1), comic(2), comic(3)]);
assert.deepEqual([three.kind, three.weightOz, three.length, three.width], ['custom', 14, 12.75, 7.75]);
assert.ok(three.height > packageFor({ name: 'x', category: 'Comic' }).height);
assert.ok(bundlePackage([1, 2, 3, 4, 5, 6].map(comic)).weightOz > three.weightOz);
const etb = bundlePackage([{ data: { name: 'Black Bolt Elite Trainer Box' } }, { data: { name: 'Pikachu', category: 'Pokemon TCG' }, price: 5 }]);
assert.equal(etb.length, 12); assert.ok(etb.weightOz >= 40);
assert.equal(bundlePackage([]), null);

// Whatnot: a bundle lists its contents and ships at its own weight; a
// bundled item comes off Whatnot so it can't sell twice.
const row = { id: '00000000-0000-4000-8000-000000000001', status: 'in_stock', data: { sellOnWhatnot: true, quantity: 1, isBundle: true, name: 'Absolute Batman #25 Connecting Covers', bundleMemberNames: ['ABSOLUTE BATMAN #25 CVR H NICK DRAGOTTA LEFT CONNECTING CARD STOCK VAR -- Cvr H', 'ABSOLUTE BATMAN #25 CVR I NICK DRAGOTTA MIDDLE CONNECTING CARD STOCK VAR'], shipWeightOz: 11, shipDims: '12.75 x 7.75 x 1.5' } };
const w = whatnotDesired(row, { name: row.data.name, price: 24, photos: [], categorySlug: 'comics' });
assert.match(w.description, /^Includes 2 items:\n- ABSOLUTE BATMAN #25 CVR H NICK DRAGOTTA LEFT CONNECTING CARD STOCK VAR\n- ABSOLUTE BATMAN #25 CVR I/);
assert.equal(w.profileKind, ''); assert.deepEqual(w.profile.weight, { value: 11, unit: 'ounce' });
assert.equal(whatnotDesired({ ...row, status: 'bundled', data: { sellOnWhatnot: true, quantity: 1, status: 'bundled' } }, { name: 'x', price: 5, photos: [] }).qty, 0);

// Bundle Brain: connecting covers, all covers of one issue, issue runs.
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const grab = sig => { const i = app.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = app.indexOf('){', i) + 1; for (; j < app.length; j++) { if (app[j] === '{') d++; else if (app[j] === '}' && !--d) break; } return app.slice(i, j + 1); };
const { computeBundleCandidates } = new Function([
  "const qplCategoryKey = c => /comic/i.test(c) ? 'comic' : 'x';", 'const inventoryItemIsSellable = () => true;',
  'const inventoryListPrice = i => i.price || 0;', 'const roundSellPrice = n => Math.round(n);',
  grab('function bundleComicIdentity('), grab('function computeBundlePrice('), grab('function computeBundleCandidates('),
  'return { computeBundleCandidates };'].join('\n'))();
const inv = (name, extra = {}) => ({ id: name, name, category: 'Comic', price: 10, cost: 4, qty: 1, ...extra });
const groups = computeBundleCandidates([
  inv('ABSOLUTE BATMAN #25 CVR H NICK DRAGOTTA LEFT CONNECTING CARD STOCK VAR -- Cvr H', { issue: '25' }),
  inv('ABSOLUTE BATMAN #25 CVR I NICK DRAGOTTA MIDDLE CONNECTING CARD STOCK VAR -- Cvr I', { issue: '25' }),
  inv('ABSOLUTE BATMAN #25 CVR A NICK DRAGOTTA', { issue: '25' }),
  inv('X-Force #1'), inv('X-Force #2'), inv('X-Force #3'),
  inv('Saga #1 Cvr A'), inv('Saga #1 Cvr B'),
]);
const by = t => groups.filter(g => g.type === t).map(g => [g.label, g.items.map(i => i.id).sort()]);
assert.deepEqual(by('connecting'), [['Absolute Batman #25', ['ABSOLUTE BATMAN #25 CVR H NICK DRAGOTTA LEFT CONNECTING CARD STOCK VAR -- Cvr H', 'ABSOLUTE BATMAN #25 CVR I NICK DRAGOTTA MIDDLE CONNECTING CARD STOCK VAR -- Cvr I']]]);
assert.deepEqual(by('issue'), [['Saga #1', ['Saga #1 Cvr A', 'Saga #1 Cvr B']]]);
assert.deepEqual(by('run'), [['X-Force', ['X-Force #1', 'X-Force #2', 'X-Force #3']]]);

// Building a bundle saves its shipping and offers the Whatnot show picker.
assert.match(app, /const ship = await bundleShippingFields\(items\);\n  const containerUpdates = \{\n    name, category, price, market:price, qty:1, cost:totalCost, \.\.\.ship,/);
assert.match(app, /return pkg \? \{ shipWeightOz:pkg\.weightOz, shipDims:`\$\{pkg\.length\} x \$\{pkg\.width\} x \$\{pkg\.height\}` \} : \{\};/);
assert.match(app, /if\(containerId && typeof window\.openWhatnotShowPicker === 'function'\) window\.openWhatnotShowPicker\(\[containerId\],/);
assert.match(app, /\['shipWeightOz',0,'num'\], \['shipDims',''\],/, 'the weight survives later edits');
console.log('Whatnot bundles: shipping, contents, connecting covers and runs passed');
