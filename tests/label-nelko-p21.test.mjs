import assert from 'node:assert/strict';
import fs from 'node:fs';
// Store, 2026-11-08: Dave's Nelko P21 label maker (14 mm tape, prints images
// from the Nelko phone app). The label screen offers it as a size; it saves
// PNGs at the printer's 203 dpi instead of opening the print dialog.
const html = fs.readFileSync('dashboard.html', 'utf8'), app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.match(html, /<option value="nelko-14x40">Nelko P21 -- 14 x 40 mm/);
assert.match(html, /<option value="nelko-14x50">Nelko P21 -- 14 x 50 mm/);
assert.match(app, /const NELKO_P21_SIZES = \{ 'nelko-14x40':\{ tapeMm:14, lengthMm:40 \}, 'nelko-14x50':\{ tapeMm:14, lengthMm:50 \} \};/);
assert.match(app, /if\(nelko\) return \{ isRoll:true, isWrap:false, nelko:true, codeStyle:'qr', widthIn:nelko\.lengthMm \/ 25\.4, heightIn:nelko\.tapeMm \/ 25\.4,/);
assert.match(app, /async function printInventoryLabels\(\)\{\n[^\n]*\n  if\(isNelkoLabelSize\(\)\) return downloadInventoryLabelPngs\(\);/);
assert.match(app, /if\(opts\.nelko\)\{\n\s*\/\/ Nelko P21: square QR at the left/);
// 40 x 14 mm at 203 dpi.
assert.equal(Math.round(40 / 25.4 * 203), 320); assert.equal(Math.round(14 / 25.4 * 203), 112);
console.log('Nelko P21 label size: 14 mm PNGs for the Nelko app passed');
