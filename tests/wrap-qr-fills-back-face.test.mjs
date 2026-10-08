import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report: "qr cuts off a little and needs to take up more space." The
// wrap QR is now placed by the shared canvas drawing at a computed size and
// position inside the back face, so it can never run past the label edge:
// it sits codeMargin above the bottom edge and is centered in the face.
const fnStart = html.indexOf('async function renderInventoryLabelCanvas(');
const fn = html.slice(fnStart, html.indexOf('\n}\n', fnStart) + 2);
assert.match(fn, /codeDraw = \{ canvas: codeCanvas, x: halfW \+ \(halfW - codeSize\) \/ 2, y: h - codeMargin - codeSize, w: codeSize, h: codeSize \};/,
  'the wrap QR is centered in the back face and kept fully inside the label');
assert.match(fn, /ctx\.imageSmoothingEnabled = false;\s*\n\s*ctx\.drawImage\(codeDraw\.canvas, codeDraw\.x, codeDraw\.y, codeDraw\.w, codeDraw\.h\);/,
  'the code is drawn without smoothing, so its modules stay sharp');

// The printed page places that same image at exactly the label's size, so
// nothing about the QR changes between screen, PNG and paper.
const printStart = html.indexOf('async function printInventoryLabels(){');
const printFn = html.slice(printStart, html.indexOf('\n}\n', printStart) + 2);
assert.match(printFn, /img\.label \{ display:block; width:\$\{widthIn\}in; height:\$\{heightIn\}in;/, 'the printed label image is exactly the label size');

console.log('Wrap QR stays inside the back face contract checks passed');
