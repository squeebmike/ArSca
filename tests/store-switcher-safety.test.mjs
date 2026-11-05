// The store switcher (store, 2026-11-05: "Make the switcher. And only my
// account has the switcher. No way the switcher fucks stuff up for either
// store?"). Pulls the real helpers out of the dashboard and runs them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const html = fs.readFileSync('dashboard.html', 'utf8');
const HOME = '0f9dd4bc-42a7-487e-a972-2905d24513e9', OTHER = '11111111-2222-3333-4444-555555555555';
const grab = name => { const i = src.indexOf('function ' + name + '('); assert.ok(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; } return src.slice(i, j + 1); };

// Which store opens: home unless this tab chose to visit the other one.
let visit = null;
const pick = new Function('sessionStorage', `const HOME_STORE_ID='${HOME}',STORE_VISIT_KEY='walkoff_store_visit';${grab('storeVisitAllowed')}${grab('pickActiveStoreId')}return pickActiveStoreId;`)({ getItem: () => visit });
const both = [{ id: HOME }, { id: OTHER }];
assert.equal(pick(both, OTHER), HOME, 'a fresh tab opens The Mana Pocket even if the other store was last');
visit = OTHER; assert.equal(pick(both, OTHER), OTHER, 'this tab chose to visit');
visit = null; assert.equal(pick(both, ''), HOME);
assert.equal(pick([{ id: OTHER }], OTHER), OTHER, "his own account: only his store");
assert.equal(pick([{ id: HOME }], ''), HOME, 'staff: only The Mana Pocket');
assert.equal(pick([], 'x'), 'x');

// Queued saves run only in the store they were made in; old ones are home's.
let active = HOME;
const here = new Function('getActiveStoreId', `const HOME_STORE_ID='${HOME}';${grab('syncItemStore')}${grab('syncItemHere')}return syncItemHere;`)(() => active);
assert.equal(here({}), true); assert.equal(here({ storeId: OTHER }), false);
active = OTHER; assert.equal(here({}), false, "a Mana Pocket save never runs in his store"); assert.equal(here({ storeId: OTHER }), true);
assert.match(src, /const item = \{ storeId:getActiveStoreId\(\) \|\| HOME_STORE_ID, id:/);
assert.match(src, /if\(!syncItemHere\(item\)\) return; \/\/ another store's/);
assert.match(src, /filter\(x => x\.status !== 'done' && syncItemHere\(x\)\)\) await retrySyncItem/);
assert.match(src, /\['supabase-inventory-update','inventory-create'\]\.includes\(x\.type\) && syncItemHere\(x\)\)/);

// Saved-on-this-device data from before stores were separated only ever
// moves into The Mana Pocket's space, never another store's.
assert.match(src, /scoped === 'walkoff:' \+ HOME_STORE_ID \+ ':' \+ key\) \{ rawSet\.call\(this, scoped, oldVal\)/);
for (const k of ['inventory_edit_overrides_v1', 'whatnot_fee_pct', 'price_sync_pending_v1', 'pos_closed_buy_trays']) assert.match(src, new RegExp("'" + k + "'"), k + ' is per store');

// The switch: a visit lasts for this tab; the bar shows only for an account in 2+ stores.
assert.match(src, /if\(storeId === HOME_STORE_ID\) sessionStorage\.removeItem\(STORE_VISIT_KEY\); else sessionStorage\.setItem\(STORE_VISIT_KEY, storeId\)/);
assert.match(src, /const multi = \(session\?\.stores\?\.length \|\| 0\) > 1;\n  if\(!multi\) \{ bar\?\.remove\(\)/);
assert.match(src, /VIEWING \$\{escHtml/);
assert.match(src, /BACK TO THE MANA POCKET/);
assert.match(html, /#store-visit-bar\.away\{background:#ff6a00/);
console.log('store switcher: home by default, per-store queues and saved data, visit bar');
