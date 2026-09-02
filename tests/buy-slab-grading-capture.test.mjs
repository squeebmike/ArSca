import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: no way existed to mark an item as a graded slab (PSA/BGS/
// CGC/SGC/CBCS) until AFTER it had already become real inventory -- neither
// the Buy Tray itself, nor either Pocket Scout save path (BUY + ADD
// INVENTORY / SEND TO BUY TAB), ever captured grader/grade/cert#. On top of
// that, buyItemToInventoryUpdates (the function that actually carries a
// buy-tray item's fields into the new inventory row) read a field called
// 'grading_company' that nothing anywhere else in the app ever wrote --
// the Edit Item modal's own grading fields save as 'grader' -- so even a
// buy-tray item that somehow HAD grading data set would have silently lost
// it on the way into inventory.

// ── buyItemToInventoryUpdates field-name fix ──
const buItuStart = dashboard.indexOf('function buyItemToInventoryUpdates(item){');
const buItuEnd = dashboard.indexOf('\n\nlet buyInventoryFinalizing', buItuStart);
const buItuBody = dashboard.slice(buItuStart, buItuEnd);
assert.ok(buItuStart !== -1, 'buyItemToInventoryUpdates must exist');
assert.doesNotMatch(buItuBody, /grading_company:/, 'the dead grading_company field must be gone as an actual object key -- nothing else in the app ever wrote it');
assert.match(buItuBody, /grader:item\.grader \|\| '',/, 'must read item.grader -- the same field name the Edit Item modal itself saves grading data as');

// ── Buy Tray row: graded toggle + fields ──
assert.match(dashboard, /let buyItemGradedRowsOpen = new Set\(\);/, 'missing buyItemGradedRowsOpen UI-state set');
assert.match(dashboard, /function toggleBuyItemGradedRow\(id\)\{/, 'missing toggleBuyItemGradedRow');
const renderBuyListStart = dashboard.indexOf('function renderBuyList(){');
const renderBuyListEnd = dashboard.indexOf('\nfunction printBuyOffer', renderBuyListStart);
const renderBuyListBody = dashboard.slice(renderBuyListStart, renderBuyListEnd);
assert.ok(renderBuyListStart !== -1, 'renderBuyList must exist');
assert.match(renderBuyListBody, /const gradedOpen = buyItemGradedRowsOpen\.has\(i\.id\) \|\| !!\(i\.grader \|\| i\.grade \|\| i\.cert_number\);/, 'a row with already-set grading data must show the fields open by default, not hide data that already exists');
assert.match(renderBuyListBody, /onchange="updateBuyItem\('\$\{i\.id\}','grader',this\.value\)"/, 'buy-tray row must have a grader input wired through the normal generic updateBuyItem setter');
assert.match(renderBuyListBody, /onchange="updateBuyItem\('\$\{i\.id\}','grade',this\.value\)"/, 'buy-tray row must have a grade input');
assert.match(renderBuyListBody, /onchange="updateBuyItem\('\$\{i\.id\}','cert_number',this\.value\)"/, 'buy-tray row must have a cert_number input, matching the canonical field name (not cert or certNumber)');

// ── Pocket Scout: graded toggle + fields, on BOTH save paths ──
assert.match(dashboard, /<input type="checkbox" id="scout-is-graded" onchange="toggleScoutGradedRow\(\)">/, 'Pocket Scout panel must have a graded checkbox');
assert.match(dashboard, /function toggleScoutGradedRow\(\)\{/, 'missing toggleScoutGradedRow');
assert.match(dashboard, /function readScoutGradingFields\(\)\{/, 'missing readScoutGradingFields');
{
  const fnStart = dashboard.indexOf('function readScoutGradingFields(){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /grader: graded \? \(document\.getElementById\('scout-grader'\)\?\.value\.trim\(\) \|\| ''\) : '',/, 'must clear grader when unchecked, matching readEditGradingFields\' un-grade behavior');
}
const scoutBuyStart = dashboard.indexOf('async function scoutBuyAddInventory(){');
const scoutBuyEnd = dashboard.indexOf('\n}', dashboard.indexOf("catch(e){ toast_dash('Could not add to inventory", scoutBuyStart)) + 2;
const scoutBuyBody = dashboard.slice(scoutBuyStart, scoutBuyEnd);
assert.ok(scoutBuyStart !== -1, 'scoutBuyAddInventory must exist');
assert.match(scoutBuyBody, /\.\.\.readScoutGradingFields\(\),/, 'BUY + ADD INVENTORY (immediate path) must carry grading fields into the new inventory row');
const scoutSendStart = dashboard.indexOf('function scoutSendToBuyTab(){');
const scoutSendEnd = dashboard.indexOf('\nfunction ', scoutSendStart + 10);
const scoutSendBody = dashboard.slice(scoutSendStart, scoutSendEnd);
assert.ok(scoutSendStart !== -1, 'scoutSendToBuyTab must exist');
assert.match(scoutSendBody, /\.\.\.readScoutGradingFields\(\),/, 'SEND TO BUY TAB (queued path) must carry grading fields into the buy-tray item');
// The reset function must clear the grading fields between scans too, or a
// PSA 9 slab's grade would silently bleed into the next (possibly raw) item.
const resetStart = dashboard.indexOf('function scoutResetSessionFields(){');
const resetEnd = dashboard.indexOf('\n}', resetStart) + 2;
const resetBody = dashboard.slice(resetStart, resetEnd);
assert.match(resetBody, /\['scout-grader','scout-grade','scout-cert'\]\.forEach/, 'scoutResetSessionFields must clear the grading inputs between scans');
assert.match(resetBody, /toggleScoutGradedRow\(\);/, 'scoutResetSessionFields must collapse the graded row back closed between scans');

console.log('Buy/Scout slab-grading capture contract checks passed');

// ── PSA error detail surfacing ──
// Store report (screenshot): FETCH PSA SLAB PHOTO showed only "PSA API
// error 403" -- the Worker route already captures PSA's own response body
// as `detail`, it just never reached the screen, hiding the actual reason
// (expired token, permission scope, etc) from both the operator and anyone
// debugging it afterward.
const psaThrowPattern = /throw new Error\(\[data\.error \|\| 'PSA lookup failed', data\.detail\]\.filter\(Boolean\)\.join\(' — '\)\);/g;
const psaThrowCount = (dashboard.match(psaThrowPattern) || []).length;
assert.equal(psaThrowCount, 3, 'all three PSA-cert-fetch call sites (fetchPsaCertPhotoForEditItem, resolvePsaCertRow, verifyQplPsaCert) must surface the detail field, not just the bare status-code error');

console.log('PSA error-detail surfacing contract checks passed');

// ── Functional: the detail-join logic itself ──
function psaErrorMessage(data) {
  return [data.error || 'PSA lookup failed', data.detail].filter(Boolean).join(' — ');
}
assert.equal(psaErrorMessage({ error: 'PSA API error 403', detail: 'invalid_token: token expired' }), 'PSA API error 403 — invalid_token: token expired', 'the real PSA-side reason must be appended to the status-code error');
assert.equal(psaErrorMessage({ error: 'PSA API error 403' }), 'PSA API error 403', 'a response with no detail must not show a dangling separator');
assert.equal(psaErrorMessage({}), 'PSA lookup failed', 'a completely empty error response must still fall back to a readable message');

console.log('PSA error-detail functional checks passed');
