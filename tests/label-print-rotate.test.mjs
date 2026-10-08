import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report: roll-printer labels kept coming out sideways from the PC
// print dialog, requiring a manual orientation flip in a Mac driver pane
// that's hard to find every single time. Fix: an opt-in, persisted "Rotate
// labels 90°" checkbox in the label print modal that swaps the roll job's
// @page to already match what those drivers expect, so the OS dialog never
// needs touching after the first time.

assert.match(html, /<input type="checkbox" id="label-print-rotate" onchange="localStorage\.setItem\('label_print_rotate', this\.checked \? '1' : '0'\)">/,
  'the rotate checkbox must exist and persist its state to localStorage, same pattern as the other label-print settings');

const modalStart = html.indexOf('id="label-print-modal"');
const modalEnd = html.indexOf('</div>', html.indexOf('label-download-btn', modalStart));
const modalBody = html.slice(modalStart, modalEnd);
assert.match(modalBody, /label-print-code-style[\s\S]*label-print-rotate/, 'the rotate checkbox must live inside the label print modal, after the other format controls');

const openModalStart = html.indexOf('function openLabelPrintModal');
const openModalBody = html.slice(openModalStart, openModalStart + 2000);
assert.match(openModalBody, /localStorage\.getItem\('label_print_rotate'\) === '1'/, 'opening the modal must restore the saved rotate preference, same as size/layout/code-style');

const printFnStart = html.indexOf('async function printInventoryLabels()');
const printFnEnd = html.indexOf('\nasync function ', printFnStart + 10);
const printFnBody = html.slice(printFnStart, printFnEnd);

assert.match(printFnBody, /const rotateForRoll = isRoll && \(document\.getElementById\('label-print-rotate'\)\?\.checked \|\| false\);/,
  'rotation must only ever apply in roll mode -- sheet mode has no single-label @page to mismatch');
assert.match(printFnBody, /labelParts\.push\(rotateForRoll \? `<div class="label-rotate-outer">\$\{labelHtml\}<\/div>` : labelHtml\);/,
  'each label must be wrapped for rotation without altering its own internal layout markup');
assert.match(printFnBody, /@page \{ size: \$\{rotateForRoll \? '1in 2in' : '2in 1in'\}; margin: 0; \}/,
  'the printed @page itself must swap dimensions when rotating, not just the visual content');
assert.match(printFnBody, /\.label-rotate-outer \.label \{ position:absolute; top:50%; left:50%; transform:translate\(-50%,-50%\) rotate\(90deg\); page-break-after:avoid; \}/,
  'rotation must use the standard center-then-rotate technique so a 2in x 1in label renders correctly inside a swapped 1in x 2in page');

// The PNG-download path (for phone Bluetooth thermal-printer apps) never
// goes through the OS print dialog at all, so it must stay untouched --
// rotating it would misinterpret a problem that only exists for the
// browser-print path.
const pngFnStart = html.indexOf('async function downloadInventoryLabelPngs()');
const pngFnEnd = html.indexOf('\nasync function ', pngFnStart + 10);
const pngFnBody = html.slice(pngFnStart, pngFnEnd === -1 ? pngFnStart + 6000 : pngFnEnd);
assert.doesNotMatch(pngFnBody, /rotateForRoll|label-print-rotate/, 'the PNG-download path must not reference the print-dialog rotation setting at all');

console.log('Label print rotation checks passed');
