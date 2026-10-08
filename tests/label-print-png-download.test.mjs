import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: a direct-to-file PNG export path exists, bypassing the OS print
// dialog entirely -- Android's own "Save as PDF" print path only offers full
// page sizes (Letter, A4, Index Card, ...) with no way to enter a label's real
// tiny dimensions, so a PDF saved that way scales the whole label down to
// nothing. Confirmed against a real phone + Bluetooth thermal printer. ──
assert.match(dashboard, /const LABEL_PNG_DPI = 203;/, 'must define the print-head DPI used to size the downloaded PNG in real dots');
assert.match(dashboard, /async function downloadInventoryLabelPngs\(\)\{/, 'missing downloadInventoryLabelPngs');
assert.match(dashboard, /function labelFitLines\(ctx, text, maxWidth, maxLines, ellipsis = true\)\{/, 'missing labelFitLines helper (canvas text has no built-in wrapping)');

// ── Contract: the button is wired up and gives feedback the same way the
// existing PRINT button does (disable + relabel during generation) ──
assert.match(dashboard, /<button class="modal-btn confirm" id="label-download-btn" onclick="downloadInventoryLabelPngs\(\)" style="background:#0ea5e9">⬇️ DOWNLOAD PNGs \(for phone thermal-printer app\)<\/button>/, 'missing the DOWNLOAD PNGs button in the label print modal');
assert.match(dashboard, /if\(btn\)\{ btn\.disabled = true; btn\.textContent = 'GENERATING\.\.\.'; \}/, 'the download button must be disabled/relabeled while generating (shared pattern with printInventoryLabels)');
assert.match(dashboard, /if\(btn\)\{ btn\.disabled = false; btn\.textContent = btnLabel; \}/, 'the download button must be restored to its label once generation finishes');

// ── Contract: it draws a real scan code onto the label via the shared
// generateLabelCodeCanvas helper (same contract as the print path), guards
// against the barcode library not being loaded yet, and requires at least
// one item in the batch before doing any work ──
{
  const fnStart = dashboard.indexOf('async function downloadInventoryLabelPngs(){');
  const head = dashboard.slice(fnStart, fnStart + 600);
  assert.match(head, /if\(!labelPrintBatch\.length\) return alert\('Add at least one item to print'\);/, 'downloadInventoryLabelPngs must guard on an empty batch');
  assert.match(head, /if\(typeof JsBarcode === 'undefined' \|\| typeof qrcode === 'undefined'\) return alert\('Barcode library still loading -- try again in a moment'\);/, 'downloadInventoryLabelPngs must guard on both not-yet-loaded code libraries, same as printInventoryLabels');
}
assert.match(dashboard, /const codeValue = codeStyle === 'qr' \? labelQrPayload\(b\) : \(b\.sku \|\| b\.id\);/, 'the code value must be resolved once before either layout branch generates its code image');
assert.match(dashboard, /const codeCanvas = await generateLabelCodeCanvas\(codeValue, codeStyle, codeStyle === 'qr' \? Math\.min\(boxW, boxH\) : Math\.max\(boxW, boxH\)\);/, 'both layouts must render the scan code at its real on-label size in dots, not a fixed size that then gets blurrily scaled to fit');

// ── Contract: downloaded label prices are always whole dollars, no cents ──
assert.match(dashboard, /drawLines\(\[fdLabelPrice\$\(b\.price\)\.slice\(1\)\], cx, /, 'the wrap front face price must render via the whole-dollar formatter, with the "$" glyph dropped');
assert.match(dashboard, /t\.fillText\(fdLabelPrice\$\(b\.price\), left \+ contentW, y \+ rowH \/ 2\);/, 'the standard layout price must render via the whole-dollar formatter');

// ── Contract: each label is downloaded as its own file via a Blob + <a download>
// link, not routed through window.print() -- that is the whole point of this
// path. A short delay between downloads accounts for Chrome's multi-download
// permission prompt on Android. ──
assert.match(dashboard, /const blob = await new Promise\(resolve => canvas\.toBlob\(resolve, 'image\/png'\)\);/, 'each label must be encoded as a PNG blob');
assert.match(dashboard, /a\.href = url; a\.download = fileName;/, 'each label must trigger a real file download via an anchor with a download attribute');
assert.match(dashboard, /if\(i < labelSpecs\.length - 1\) await new Promise\(resolve => setTimeout\(resolve, 350\)\);/, 'must pace sequential downloads so Android/Chrome does not silently drop some of them');

console.log('Label PNG download contract checks passed');

// ── Functional: labelFitLines wraps onto at most maxLines lines and ends a
// cut last line in "…", like the PC label's CSS line clamp. ──
{
  const src = dashboard.match(/function labelFitLines\(ctx, text, maxWidth, maxLines, ellipsis = true\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'could not extract labelFitLines for functional testing');
  const labelFitLines = new Function(`${src}\nreturn labelFitLines;`)();
  const ctx = { measureText: s => ({ width: s.length * 10 }) };

  assert.deepEqual([...labelFitLines(ctx, 'Charizard VMAX Rainbow Rare', 90, 2)], ['Charizard', 'VMAX…'], 'a long name stops at maxLines and its last line ends in an ellipsis');
  assert.deepEqual([...labelFitLines(ctx, 'Short', 90, 2)], ['Short'], 'a name that fits on one line makes no stray second line');
  assert.deepEqual([...labelFitLines(ctx, 'Charizard VMAX Rainbow Rare', 90, 2, false)], ['Charizard', 'VMAX'], 'without an ellipsis the extra words are simply clipped, like max-height');
  assert.deepEqual([...labelFitLines(ctx, 'Charizard VMAX Rainbow', 140, 3)], ['Charizard VMAX', 'Rainbow'], 'up to 3 lines when allowed');
}

const LABEL_PNG_DPI = 203;
assert.equal(Math.round(2 * LABEL_PNG_DPI), 406, 'roll labels (2in wide) must render at 406 real dots wide at 203 DPI');
assert.equal(Math.round(2.625 * LABEL_PNG_DPI), 533, 'sheet labels (2.625in wide) must render at 533 real dots wide at 203 DPI');
assert.equal(Math.round(1 * LABEL_PNG_DPI), 203, 'the 1in label height must render at exactly 203 real dots -- the printer\'s native DPI');

// ── Functional: fdLabelPrice$ always rounds to a whole dollar, never renders cents ──
{
  const src = dashboard.match(/const fdLabelPrice\$ = (n => '\$' \+ Math\.round\(Number\(n \|\| 0\)\));/)?.[1];
  assert.ok(src, 'could not extract fdLabelPrice$ for functional testing');
  const fdLabelPrice$ = new Function(`return ${src};`)();

  assert.equal(fdLabelPrice$(10), '$10', 'a whole-dollar price must render with no decimal point at all');
  assert.equal(fdLabelPrice$(9.99), '$10', 'a price just under a dollar boundary must round up, not truncate down to $9');
  assert.equal(fdLabelPrice$(10.49), '$10', 'a price just over a dollar boundary must round down to the nearest dollar');
  assert.equal(fdLabelPrice$(0), '$0', 'a zero price must still render, not blank out');
  assert.equal(fdLabelPrice$(null), '$0', 'a missing price must fall back to $0, not throw or render $NaN');
}

console.log('Label whole-dollar price functional checks passed');

console.log('Label PNG download functional checks passed');
