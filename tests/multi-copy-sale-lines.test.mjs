import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store, 2026-11-04: a Whatnot buyer took 4 Todd Nauck covers; the sale
// showed +$15.03 profit (one copy's cost) and a $5 "price" with no cost.
// A line's original/adjusted price is the whole line (every copy), its
// cost_basis is per copy, and profit takes every copy's cost.
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.doesNotMatch(w, /adjusted_price: salePrice \/ quantitySold/, 'no per-copy line price left');
assert.equal((w.match(/unit_price: salePrice \/ quantitySold, original_price: salePrice, adjusted_price: salePrice/g) || []).length, 4, 'Whatnot (linked + unlinked) and both eBay order paths');
assert.match(w, /const profit = Math\.round\(\(salePrice - feeAmount - cost \* quantitySold\) \* 100\) \/ 100;/, 'Whatnot / external sales');
assert.match(w, /const profit = Math\.round\(\(salePrice - cost \* quantitySold - feeAmount\) \* 100\) \/ 100;/, 'eBay quantity path');
assert.match(w, /const profit = ebayLineProfit\(m, cost \* quantitySold\);/, 'eBay order sync');
// The Nauck sale, worked: $20, $2.48 Whatnot fee, 4 x $2.49 -> +$7.56.
assert.equal(Math.round((20 - 2.48 - 2.49 * 4) * 100) / 100, 7.56);
console.log('Multi-copy sale lines: line totals, per-copy cost, every copy in profit passed');
