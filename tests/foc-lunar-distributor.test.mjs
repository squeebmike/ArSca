import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

// Store request: add Lunar Distribution (single-issue comics) as a second
// FOC source alongside the existing PRH (books) one, kept as its own tab/
// cycle list rather than interleaved with PRH's weeks, plus a staff-only
// estimated-cost line per cover using Lunar's real per-publisher discount
// schedule. Uses a real DOM (linkedom, already a repo devDependency) rather
// than a flat fake-element stub, since this file's render functions nest
// markup and re-query child elements (e.g. renderFamilies() looks up
// #foc-family-list AFTER renderCycle() writes it into the panel's
// innerHTML) -- a fake element with no real HTML parsing can't support
// that and would silently no-op every nested render.

const src = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const { document } = parseHTML('<!doctype html><html><body><div id="foc-panels"></div></body></html>');

const prhCycle = { id:'cyc-prh', store_id:'s1', distributor:'PRH', foc_date:'2026-08-24', customer_cutoff_at:'2026-08-24T07:01:00Z', status:'open', isOpen:true, source_row_count:5, import_report:{families:2,incentives:0} };
const lunarCycle = { id:'cyc-lunar', store_id:'s1', distributor:'Lunar', foc_date:'2026-09-28', customer_cutoff_at:'2026-09-28T07:01:00Z', status:'open', isOpen:true, source_row_count:3, import_report:{families:1,incentives:0} };

const lunarFamily = {
  id:'fam-lunar', distributorFamilyId:'savage dragon #282|282', title:'Savage Dragon #282', publisher:'Image Comics',
  writer:'Erik Larsen', interiorArtist:'Erik Larsen', onSaleDate:'2026-10-21', heat:null, heatCategory:null,
  variants:[{ id:'sku-lunar-1', distributor:'Lunar', publisher:'Image Comics', variantLabel:'Cover A', coverArtist:'Erik Larsen', upc:'70985305211128211', msrpCents:399, priceCents:399, customerQty:0, storeQuantity:0, isIncentive:false, isFoil:false, safetyStockQty:0, customerEnabled:true }],
};
const prhFamily = {
  id:'fam-prh', distributorFamilyId:'852493', title:'Avengers #1', publisher:'Marvel Comics',
  writer:'', interiorArtist:'', onSaleDate:'2026-09-30', heat:null, heatCategory:null,
  variants:[{ id:'sku-prh-1', distributor:'PRH', publisher:'Marvel Comics', variantLabel:'Cover A', coverArtist:'', upc:'75960621456300121', msrpCents:499, priceCents:499, customerQty:0, storeQuantity:0, isIncentive:false, isFoil:false, safetyStockQty:0, customerEnabled:true }],
};

const sandbox = {
  document,
  console,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  getActiveStoreId: () => 's1',
  currentRole: () => 'owner',
  toast_dash: () => {},
  storeWorkerFetch: async (path) => {
    if (path.startsWith('/foc/admin/cycles?store_id=') && !path.includes('cycle_id')) {
      return { ok:true, headers:{ get:()=>'application/json' }, json: async () => ({ ok:true, cycles:[lunarCycle, prhCycle] }) };
    }
    if (path.includes('cycle_id=cyc-lunar')) {
      return { ok:true, headers:{ get:()=>'application/json' }, json: async () => ({ ok:true, cycle:lunarCycle, families:[lunarFamily] }) };
    }
    if (path.includes('cycle_id=cyc-prh')) {
      return { ok:true, headers:{ get:()=>'application/json' }, json: async () => ({ ok:true, cycle:prhCycle, families:[prhFamily] }) };
    }
    throw new Error('unexpected path in this smoke test: ' + path);
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

assert.equal(typeof sandbox.switchFocDistributor, 'function', 'switchFocDistributor must be exposed on window for the tab buttons to call');
assert.equal(typeof sandbox.handleLunarFocImportFile, 'function', 'handleLunarFocImportFile must be exposed on window for the Lunar import button to call');

const panelEl = document.getElementById('foc-panels');

await sandbox.loadFocCycles(false);
assert.match(panelEl.innerHTML, /IMPORT PRH FOC/, 'PRH must be the default distributor tab on first load');
assert.match(panelEl.innerHTML, /Aug 24, 2026/, 'the PRH tab must show the PRH cycle');
assert.doesNotMatch(panelEl.innerHTML, /Sep 28, 2026/, 'the PRH tab must not show the Lunar cycle');

sandbox.switchFocDistributor('Lunar');
assert.match(panelEl.innerHTML, /IMPORT LUNAR FOC/, 'switching to the Lunar tab must swap the import button label');
assert.match(panelEl.innerHTML, /Sep 28, 2026/, 'the Lunar tab must show the Lunar cycle');
assert.doesNotMatch(panelEl.innerHTML, /Aug 24, 2026/, 'the Lunar tab must not show the PRH cycle');

await sandbox.openFocCycle('cyc-lunar');
assert.match(panelEl.innerHTML, /Est\. cost/, 'a Lunar SKU must show the staff-only estimated-cost line');
// Image Comics defaults to 40% off in this file's LUNAR_PUBLISHER_DISCOUNTS
// table -- $3.99 MSRP at 40% off is $2.39 (rounded to the nearest cent).
assert.match(panelEl.innerHTML, /\$2\.39/, 'the estimated cost must reflect the real Image Comics discount rate against MSRP');

await sandbox.openFocCycle('cyc-prh');
assert.doesNotMatch(panelEl.innerHTML, /Est\. cost/, 'a PRH SKU must never show a Lunar cost estimate');

console.log('Lunar FOC distributor tab + cost-estimate smoke checks passed');
