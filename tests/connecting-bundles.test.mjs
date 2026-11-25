import fs from 'node:fs';
import assert from 'node:assert/strict';
// Store, 2026-11-25: "build the one tap bundle maker. I want to select what goes in each bundle ... mostly for connecting
// sets. What's the easiest way to see all connectors in inventory?" + "Robin Hood won't load in inventory from FOC".
const src = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const a = src.indexOf('function isConnectingCover'), b = src.indexOf('function openConnectingBundleMaker');
const rows = [
  ['ABSOLUTE BATMAN #25 CVR D BRYAN HITCH CONNECTING CARD STOCK VAR', 3], ['ABSOLUTE SUPERMAN #25 CVR D BRYAN HITCH CONNECTING CARD STOCK VAR', 5], ['ABSOLUTE WONDER WOMAN #25 CVR D BRYAN HITCH CONNECTING CARD STOCK VAR', 4],
  ['ABSOLUTE BATMAN #25 CVR H NICK DRAGOTTA LEFT CONNECTING CARD STOCK VAR', 4], ['ABSOLUTE BATMAN #25 CVR I NICK DRAGOTTA MIDDLE CONNECTING CARD STOCK VAR', 5], ['ABSOLUTE BATMAN #25 CVR J NICK DRAGOTTA RIGHT CONNECTING CARD STOCK VAR', 4],
  ['DNX #3 FEDERICO VICENTINI 5-PART CONNECTING VARIANT', 2], ['DNX #4 FEDERICO VICENTINI 5-PART CONNECTING VARIANT', 4],
  ['Power Rangers Green #3 C Tommy Oliver Card Stock Connecting Variant (Full Art, Mooneyham)', 2], ['Power Rangers Green #4 C Tommy Oliver Card Stock Connecting Variant (Full Art, Mooneyham)', 2],
  ['SPIDER-MAN #1 COVER A', 9],
].map(([name, qty], k) => ({ id: 'r' + k, name, qty, market: 10, status: 'in_stock' }));
const groups = new Function('all', 'inventoryItemBundleEligible', 'inventoryAvailableQuantity', src.slice(a, b) + 'return connectingSetGroups();')(rows, () => true, i => i.qty);
const find = k => groups.find(g => g.key === k);
assert.equal(find('BRYAN HITCH CONNECTING').rows.length, 3); assert.equal(find('BRYAN HITCH CONNECTING').complete, true);
assert.equal(find('NICK DRAGOTTA CONNECTING').complete, true);
assert.equal(find('FEDERICO VICENTINI 5 PART CONNECTING').complete, false, '2 of 5');
assert.equal(groups.find(g => /TOMMY OLIVER/.test(g.key)).complete, false, 'one series, no part count: unticked');
assert.ok(!groups.some(g => g.rows.some(r => r.name === 'SPIDER-MAN #1 COVER A')), 'only connecting covers');
const html = fs.readFileSync('dashboard.html', 'utf8');
assert.ok(html.includes("setF('listing','connecting',this)") && html.includes('onclick="openConnectingBundleMaker()"'));
assert.ok(src.includes("if(listing === 'connecting') return isConnectingCover(i)") && src.includes('await createInventoryBundle(items, j.name, j.price); made++;') && src.includes('items.push(...await splitInventoryCopies(it, 1))'));
// Robin Hood: covers that came in go on the shelf while their multi-cover eBay listing waits on a later cover.
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.ok(w.includes('for (const r of live) if (arrived(r.data)) arrivedAhead.push(r);') && w.includes("focArrivedInStock: true") && w.includes("&& d.focArrivedInStock !== true;"));
console.log('Connecting set bundles, the Connecting filter, arrived covers to the shelf: passed');
