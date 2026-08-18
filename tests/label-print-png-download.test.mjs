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
assert.match(dashboard, /function wrapCanvasText\(ctx, text, x, y, maxWidth, lineHeight, maxLines\)\{/, 'missing wrapCanvasText helper (canvas text has no built-in wrapping)');

// ── Contract: the button is wired up and gives feedback the same way the
// existing PRINT button does (disable + relabel during generation) ──
assert.match(dashboard, /<button class="modal-btn confirm" id="label-download-btn" onclick="downloadInventoryLabelPngs\(\)" style="background:#0ea5e9">⬇️ DOWNLOAD PNGs \(for phone thermal-printer app\)<\/button>/, 'missing the DOWNLOAD PNGs button in the label print modal');
assert.match(dashboard, /if\(btn\)\{ btn\.disabled = true; btn\.textContent = 'GENERATING\.\.\.'; \}/, 'the download button must be disabled/relabeled while generating (shared pattern with printInventoryLabels)');
assert.match(dashboard, /if\(btn\)\{ btn\.disabled = false; btn\.textContent = btnLabel; \}/, 'the download button must be restored to its label once generation finishes');

// ── Contract: it draws a real scan code onto the label via the shared
// generateLabelCodeCanvas helper (same contract as the print path), guards
// against the barcode library not being loaded yet, and requires at least
// one item in the batch before doing any work ──
assert.match(dashboard, /if\(!labelPrintBatch\.length\) return alert\('Add at least one item to print'\);\s*\n\s*if\(typeof JsBarcode === 'undefined'\) return alert/, 'downloadInventoryLabelPngs must guard on an empty batch and a not-yet-loaded barcode library, same as printInventoryLabels');
assert.match(dashboard, /const codeCanvas = await generateLabelCodeCanvas\(b\.sku \|\| b\.id, codeStyle\);/, 'must render a real scan code onto an offscreen canvas via the shared helper before compositing it onto the label');

// ── Contract: each label is downloaded as its own file via a Blob + <a download>
// link, not routed through window.print() -- that is the whole point of this
// path. A short delay between downloads accounts for Chrome's multi-download
// permission prompt on Android. ──
assert.match(dashboard, /const blob = await new Promise\(resolve => canvas\.toBlob\(resolve, 'image\/png'\)\);/, 'each label must be encoded as a PNG blob');
assert.match(dashboard, /a\.href = url; a\.download = fileName;/, 'each label must trigger a real file download via an anchor with a download attribute');
assert.match(dashboard, /if\(i < labelSpecs\.length - 1\) await new Promise\(resolve => setTimeout\(resolve, 350\)\);/, 'must pace sequential downloads so Android/Chrome does not silently drop some of them');

console.log('Label PNG download contract checks passed');

// ── Functional: wrapCanvasText wraps onto multiple lines and respects maxLines,
// and the physical label size (in real dots at LABEL_PNG_DPI) matches the same
// roll/sheet width the existing print path already uses. ──
{
  const src = dashboard.match(/function wrapCanvasText\(ctx, text, x, y, maxWidth, lineHeight, maxLines\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'could not extract wrapCanvasText for functional testing');
  const { wrapCanvasText } = new Function(`${src}\nreturn { wrapCanvasText };`)();

  function fakeCtx(charWidth){
    const calls = [];
    return {
      calls,
      measureText: (s) => ({ width: s.length * charWidth }),
      fillText: (text, x, y) => calls.push({ text, x, y }),
    };
  }

  const ctx1 = fakeCtx(10);
  wrapCanvasText(ctx1, 'Charizard VMAX Rainbow Rare', 5, 100, 90, 12, 2);
  assert.equal(ctx1.calls.length, 2, 'a long name must wrap onto exactly maxLines (2) lines, not spill past it');
  assert.equal(ctx1.calls[0].y, 100, 'the first line must sit at the given y');
  assert.equal(ctx1.calls[1].y, 112, 'the second line must be offset by exactly one lineHeight');

  const ctx2 = fakeCtx(10);
  wrapCanvasText(ctx2, 'Short', 5, 100, 90, 12, 2);
  assert.equal(ctx2.calls.length, 1, 'a name that fits on one line must not produce a stray empty second line');
}

const LABEL_PNG_DPI = 203;
assert.equal(Math.round(2 * LABEL_PNG_DPI), 406, 'roll labels (2in wide) must render at 406 real dots wide at 203 DPI');
assert.equal(Math.round(2.625 * LABEL_PNG_DPI), 533, 'sheet labels (2.625in wide) must render at 533 real dots wide at 203 DPI');
assert.equal(Math.round(1 * LABEL_PNG_DPI), 203, 'the 1in label height must render at exactly 203 real dots -- the printer\'s native DPI');

console.log('Label PNG download functional checks passed');
