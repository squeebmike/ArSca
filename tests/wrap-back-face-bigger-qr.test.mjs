import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report: the wrap label's QR looked small, and "THE MANA POCKET"
// wrapped to two lines on a real print. Both labels -- PRINT and DOWNLOAD
// PNGs -- now come from one canvas drawing (renderInventoryLabelCanvas), so
// these hold for both: the shop name is drawn as one line of text, and the
// QR is the largest square the back face has room for below it.
const fnStart = html.indexOf('async function renderInventoryLabelCanvas(');
assert.ok(fnStart >= 0, 'renderInventoryLabelCanvas must exist');
const fn = html.slice(fnStart, html.indexOf('\n}\n', fnStart) + 2);

assert.match(fn, /tctx\.fillText\('THE MANA POCKET', halfW \+ halfW \/ 2, shopPad\);/, 'the shop name is one line of text centered on the back face');
assert.match(fn, /const codeSize = Math\.min\(h - logoBottom - codeMargin \* 2, halfW - codeMargin \* 2\);/,
  'the QR is as large as the room left below the shop name and the face width allow');
assert.match(fn, /const codeCanvas = await generateLabelCodeCanvas\(codeValue, codeStyle, Math\.round\(codeSize\)\);/,
  'the QR is generated at that exact size, never scaled');

console.log('Wrap back face shop name / QR size contract checks passed');
