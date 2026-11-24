import fs from 'node:fs';
import assert from 'node:assert/strict';
// Store, 2026-11-24: "I can bundle books from the inventory ... push it to Whatnot ... when that bundle sells it takes
// off 1 of each book ... calcs correct cost and profit". Do both fixes: books marked sold when a bundle sells anywhere,
// and a BUNDLE THESE button on the bulk bar.
const { bundleMembersToSettle, settleSoldBundleMembers, BUNDLE_SOLD } = await import('../scripts/bundle-settle.mjs');
const B = '11111111-1111-1111-1111-111111111111', C = '22222222-2222-2222-2222-222222222222';
const members = [{ id: 'm1', data: { name: 'A #1', bundledIntoId: B, cost: 2 } }, { id: 'm2', data: { name: 'A #2', bundledIntoId: B } }, { id: 'm3', data: { bundledIntoId: C } }];
const out = bundleMembersToSettle(members, [{ id: B, status: 'sold', data: { soldAt: '2026-11-24T10:00:00Z', saleId: 's1' } }, { id: C, status: 'in_stock', data: {} }]);
assert.deepEqual(out.map(o => o.id), ['m1', 'm2'], 'only books in a sold bundle');
assert.equal(out[0].data.status, 'sold'); assert.equal(out[0].data.soldAt, '2026-11-24T10:00:00Z'); assert.equal(out[0].data.saleId, 's1'); assert.equal(out[0].data.cost, 2, 'keeps its cost');
assert.ok(BUNDLE_SOLD.includes('sold_pending_shipment'), 'a Whatnot/website sale waiting to ship counts');
// The sweep: reads only bundled rows and the sold bundles, writes each book once (guarded on still-bundled).
const calls = [];
const db = async (path, init) => { calls.push([path, init]); if (/status=eq\.bundled&select/.test(path)) return { data: members }; if (/status=in\.\(/.test(path)) return { data: [{ id: B, status: 'sold_pending_shipment', soldAt: '2026-11-24T10:00:00Z', saleId: 's9' }] }; return { data: null }; };
const r = await settleSoldBundleMembers('0f9dd4bc-42a7-487e-a972-2905d24513e9', db);
assert.equal(r.settled, 2);
const writes = calls.filter(([, i]) => i?.method === 'PATCH');
assert.equal(writes.length, 2); assert.ok(writes.every(([p]) => p.includes('&status=eq.bundled')));
assert.equal(JSON.parse(writes[0][1].body).status, 'sold');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.ok(worker.includes("import { settleSoldBundleMembers } from './scripts/bundle-settle.mjs';") && worker.includes('await settleSoldBundleMembers(storeId,'), 'runs with every Whatnot sync (every 10 minutes)');
const html = fs.readFileSync('dashboard.html', 'utf8'), app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.ok(html.includes('onclick="bundleSelectedItems()"') && html.includes('🎁 BUNDLE THESE'));
assert.ok(app.includes('function bundleSelectedItems(){') && /ok = picked\.filter\(inventoryItemBundleEligible\)/.test(app) && app.includes('openBundleBuilderModal();\n}'));
console.log('Bundles: books sold with the bundle on every channel; BUNDLE THESE: passed');
