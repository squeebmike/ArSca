import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report: shows/conventions must never collect sales tax, regardless
// of whether the store's own tax setting is enabled -- different venue,
// often a different tax jurisdiction, and the dealer explicitly decided
// not to handle tax collection at events. createLockedCheckoutSnapshot
// already computes tax from a taxable-only subtotal (see
// checkout-taxable-flag-honored.test.mjs); this guards the additional
// Show Mode gate on top of that.

const fnStart = html.indexOf('function createLockedCheckoutSnapshot(');
const fnEnd = html.indexOf('\nfunction buildLedgerBundle', fnStart);
const fnBody = html.slice(fnStart, fnEnd);

assert.match(fnBody,
  /const taxTotal = settings\.tax\?\.enabled && !getShowMode\(\) && !Number\(normalized\.tax \|\| 0\) \? taxableAfterDiscount \* \(Number\(settings\.tax\.defaultRate \|\| 0\) \/ 100\) : Number\(normalized\.tax \|\| 0\);/,
  'tax auto-calculation must be gated on !getShowMode(), so a sale rung up while Show Mode is active never gets taxed even if the store-wide tax setting is enabled');

// getShowMode() must be a real, already-used helper in this file (not a
// stub) -- confirms the guard reads the same show-active state the rest
// of checkout already keys off (e.g. show_session_id on the same snapshot).
assert.match(html, /function getShowMode\(\)\{/, 'getShowMode helper must exist');
assert.match(fnBody, /show_session_id:getShowSessionId\(getShowMode\(\)\)/, 'the same getShowMode() call already determines show_session_id on this snapshot, confirming this is the right signal to gate tax on');

console.log('Show Mode no-tax contract check passed');
