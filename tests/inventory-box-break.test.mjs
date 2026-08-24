import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Field whitelist: box-break metadata must survive both read
// (mapBuiltInItem) and write (builtInDataFromItem) or it silently vanishes
// on the next save, exactly like the pre-existing comicMetadata bug this
// pattern documents (see BUILT_IN_ITEM_SIMPLE_FIELDS's own comment block).
assert.match(dashboard, /\['brokenFromBoxId',''\], \['brokenFromBoxName',''\],/, 'pack-side box-break fields must be registered in BUILT_IN_ITEM_SIMPLE_FIELDS');
assert.match(dashboard, /\['brokenIntoPackIds',\[\],'array'\], \['brokenIntoPackCount',0,'num'\],/, 'box-side box-break fields must be registered in BUILT_IN_ITEM_SIMPLE_FIELDS');
// productType already existed (bundles use it) -- confirm it wasn't
// accidentally re-declared a second time for this feature.
assert.equal((dashboard.match(/\['productType',''\]/g) || []).length, 1, 'productType must not be re-registered -- it already exists in BUILT_IN_ITEM_SIMPLE_FIELDS');

// ── Row menu wiring: only a sealed, in-stock item offers the action ──
assert.match(dashboard, /\(isInStock && item\?\.category==='Sealed'\)\?`<button class="hbtn" style="\$\{btnStyle\};color:var\(--gold\)" onclick="breakBoosterBox\('\$\{id\}'\);closeInvRowMenu\(\)">📦 Break into Packs<\/button>`:'',/, 'row menu must offer Break into Packs only for in-stock Sealed items');

// ── breakBoosterBox: refuses anything but an in-stock source row ──
const fnStart = dashboard.indexOf('async function breakBoosterBox(itemId){');
assert(fnStart >= 0, 'missing breakBoosterBox');
const fnEnd = dashboard.indexOf('\n}\n', fnStart);
const fn = dashboard.slice(fnStart, fnEnd);
assert.match(fn, /if\(box\.status !== 'in_stock'\) return toast_dash\('This item has already sold or is archived and cannot be broken into packs'\);/, 'breakBoosterBox must refuse a box that already sold or was archived');

// ── Pack count: prompted, clamped to a sane range, and a cancel/blank answer is a no-op ──
assert.match(fn, /const packCountRaw = prompt\('Break "' \+ \(box\.name \|\| 'this box'\) \+ '" into how many packs\?', '24'\);/, 'must prompt for the pack count with a sane default');
assert.match(fn, /if\(packCountRaw == null\) return;/, 'cancelling the prompt must leave the box untouched');
assert.match(fn, /const packCount = Math\.max\(1, Math\.min\(200, parseInt\(packCountRaw, 10\) \|\| 0\)\);/, 'pack count must be clamped to a sane range');

// ── Cost basis: the box's cost is split evenly across the new packs, not duplicated ──
assert.match(fn, /const perPackCost = Math\.round\(\(Number\(box\.cost \|\| 0\) \/ packCount\) \* 100\) \/ 100;/, 'each pack must carry an equal share of the box\'s original cost, so the total cost basis is preserved instead of doubling');

// ── Pack rows: created via the same primitives any other new inventory row uses ──
assert.match(fn, /productType: 'pack', brokenFromBoxId: box\.id, brokenFromBoxName: box\.name \|\| '',/, 'each pack must be tagged productType pack and linked back to the source box');
assert.match(fn, /const id = await createBuiltInInventoryItem\(\{\}, packUpdates, 'built_in'\);/, 'packs must be created via the same createBuiltInInventoryItem path as any other new inventory row');
assert.match(fn, /cost: perPackCost, price: 0, market: 0, qty: 1,/, 'each pack must start at qty 1 with its split cost and no price set yet -- pricing packs is a normal follow-up edit, not something this flow should guess');

// ── Source box: archived (not deleted) once at least one pack was created, so purchase history stays auditable ──
assert.match(fn, /if\(!createdIds\.length\) return toast_dash\('No packs were created -- box left untouched'\);/, 'if every pack creation failed, the box must be left alone rather than archived with nothing to show for it');
assert.match(fn, /try \{ await updateBuiltInInventoryItem\(box, \{ status:'archived', archiveReason:'Broken into ' \+ createdIds\.length \+ ' packs', brokenIntoPackIds:createdIds, brokenIntoPackCount:createdIds\.length \}\); \}/, 'the source box must be archived (not deleted) once packs exist, recording which packs it became');

console.log('Inventory box-break contract checks passed');
