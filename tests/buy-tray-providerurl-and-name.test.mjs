import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Trade-credit bonus label ──
// Store report: the buy-accept screen showed "PAY CUSTOMER $11.00" and,
// right below it, "APPLY $12.65 TO PURCHASE" with no explanation -- that
// second figure is the SAME offer with the trade-credit bonus multiplier
// (1.15x) applied, not a different/wrong number, but nothing on screen said
// so. Now labeled with the actual bonus percentage.
assert(dashboard.includes("APPLY $${tradeTotal.toFixed(2)} TO PURCHASE${total>0?` (+${Math.round((tradeTotal/total-1)*100)}% TRADE BONUS)`:''}"),
  'the trade-credit "Apply to Purchase" button must explain the bonus percentage, not just show a bigger unexplained number');

// ── Print run in the item name ──
// Store report: a numbered parallel's print run was captured into the
// Serial #/Numbered field but never shown in the item's own name/title.
assert.match(dashboard, /function nameWithPrintRun\(name, printRun\)\{/, 'missing nameWithPrintRun helper');
{
  const fnStart = dashboard.indexOf('function nameWithPrintRun(name, printRun){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /if\(!run \|\| !cleanName\) return cleanName;/, 'must no-op cleanly with no print run or no name');
  assert.match(fn, /if\(new RegExp\('\/\\\\s\*' \+ run \+ '\\\\b'\)\.test\(cleanName\)\) return cleanName;/, 'must never double-append when the print run is already spelled out in the name');
}
assert.match(dashboard, /value="\$\{escHtml\(nameWithPrintRun\(r\.name, r\.printRun\)\)\}"/,
  'the Research "selected card" name field must prefill with the print run appended');
assert.match(dashboard, /name: nameWithPrintRun\(match\?\.name \|\| identity\.title \|\| 'Pocket Scout item', match\?\.printRun\), category, subcategory/,
  'scoutBuyAddInventory (direct buy+add) must append the print run to the saved name');
assert.match(dashboard, /name: nameWithPrintRun\(match\?\.name \|\| identity\.title \|\| 'Pocket Scout item', match\?\.printRun\),\s*\n\s*\/\/ market is the tray's 100% basis/,
  'scoutSendToBuyTab (queue to buy tray) must append the print run to the queued name');

console.log('Trade-bonus label and print-run-in-name contract checks passed');

// ── Functional: nameWithPrintRun ──
{
  const fnStart = dashboard.indexOf('function nameWithPrintRun(name, printRun){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const nameWithPrintRun = new Function(dashboard.slice(fnStart, fnEnd) + '\nreturn nameWithPrintRun;')();
  assert.equal(nameWithPrintRun('Julio Rodriguez [Purple] #91', '250'), 'Julio Rodriguez [Purple] #91 /250', 'must append the print run when missing');
  assert.equal(nameWithPrintRun('Julio Rodriguez [Purple] #91 /250', '250'), 'Julio Rodriguez [Purple] #91 /250', 'must not double-append when already present');
  assert.equal(nameWithPrintRun('Julio Rodriguez [Purple] #91', ''), 'Julio Rodriguez [Purple] #91', 'must no-op with no print run at all');
  assert.equal(nameWithPrintRun('', '250'), '', 'must no-op with no name at all');
}

console.log('nameWithPrintRun functional checks passed');

// ── Buy Tray hand-offs must not drop providerUrl/serial_number ──
// Store report (recurrence after the earlier providerUrl fix): a card added
// via Research -> "Add to Buy Offer" still had no PriceCharting link once
// accepted into inventory. selectedQuickLookupItem() already resolves
// providerUrl correctly, but addSelectedQuickLookupToBuyOffer's own
// buy-tray-item builder never read it -- a third occurrence of the same gap
// already fixed for the Pocket/Mana Scout hand-off and the restock-merge
// paths.
{
  const fnStart = dashboard.indexOf('function addSelectedQuickLookupToBuyOffer(idx){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /providerUrl:item\.providerUrl \|\| '',/, 'Research -> Add to Buy Offer must carry providerUrl through to the buy-tray item');
  assert.match(fn, /serial_number:item\.serial_number \|\| \(item\.printRun \? '\/' \+ item\.printRun : ''\),/, 'Research -> Add to Buy Offer must also carry the print run through as serial_number');
}

// scanToBuyItem (phone-scan queue -> buy list, shared by acceptScanToBuyList/
// addAllScansToBuyList/addResearchQueueItemToBuy/bulkAddScanInboxToInventory)
// must not drop it either.
{
  const fnStart = dashboard.indexOf('function scanToBuyItem(scan){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /providerUrl: scan\.providerUrl \|\| '',/, 'scanToBuyItem must carry providerUrl through from the scan');
}

console.log('Buy Tray hand-off providerUrl/serial_number contract checks passed');
