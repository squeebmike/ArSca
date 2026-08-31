import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Cart items already carry a `taxable` flag (gift cards and event entry
// fees are explicitly set to `taxable:false`), but checkout used to ignore
// it completely -- createLockedCheckoutSnapshot taxed the WHOLE post-discount
// subtotal in one shot, so a "non-taxable" gift card still got taxed. This
// guards the fix: tax must be computed from a taxable-only subtotal, and the
// flag must actually survive into the persisted sale line so a report can
// tell taxable and exempt lines apart.

assert.match(html,
  /const taxableSubtotal = rawItems\.filter\(i => i\.taxable !== false\)\.reduce\(\(s,i\) => s \+ Number\(i\.price \|\| 0\), 0\);/,
  'createLockedCheckoutSnapshot must compute a taxable-only subtotal from lines where taxable !== false');

assert.match(html,
  /const taxableAfterDiscount = Math\.max\(0, taxableSubtotal - taxableSubtotal \* discountRatio\);/,
  'the taxable subtotal must have the same proportional discount applied as every other line');

assert.match(html,
  /const taxTotal = settings\.tax\?\.enabled && !Number\(normalized\.tax \|\| 0\) \? taxableAfterDiscount \* \(Number\(settings\.tax\.defaultRate \|\| 0\) \/ 100\) : Number\(normalized\.tax \|\| 0\);/,
  'taxTotal must be computed from taxableAfterDiscount, not the whole cart subtotal minus discount');

assert.doesNotMatch(html,
  /const taxTotal = settings\.tax\?\.enabled && !Number\(normalized\.tax \|\| 0\) \? Math\.max\(0, subtotal - discountTotal\) \* \(Number\(settings\.tax\.defaultRate \|\| 0\) \/ 100\)/,
  'the old flat-rate-over-everything tax calculation must be gone, not left as dead code alongside the fix');

assert.match(html, /taxable:item\.taxable !== false,/,
  'customerSafeLine must persist the taxable flag onto the sale line sent to Supabase, or a Reports query has no way to tell taxable/exempt lines apart');

console.log('Checkout taxable-flag contract checks passed');
