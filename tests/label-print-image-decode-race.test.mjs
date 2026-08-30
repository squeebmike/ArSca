import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Live bug: a real direct print (browser Print -> Bluetooth MUNBYN) came out
// with the entire QR/barcode area blank -- name, price, condition, meta all
// printed correctly, only the code was missing, on a device that already
// had both code libraries loaded (the #348 library guard passed clean).
// Root cause: printInventoryLabels wrote the whole label sheet (including
// several large inline data: URI QR images for the wrap layout) into a new
// window via document.write(), with window.print() as the very next thing
// the parser executed -- no wait for the browser to actually decode/paint
// those already-embedded images first. Generating the QR canvas and calling
// print() are two completely different stages; #348 only fixed the first.

{
  const fnStart = html.indexOf('async function printInventoryLabels(){');
  const fnEnd = html.indexOf('\n}', fnStart) + 2;
  const fn = html.slice(fnStart, fnEnd);

  assert.doesNotMatch(fn, /<script>window\.print\(\);<\\\/script>/,
    'must not fire print() from an inline trailing script the instant the parser reaches it -- that raced image decode');

  assert.match(fn, /w\.document\.close\(\);/, 'must still close the document after writing it');

  const closeIdx = fn.indexOf('w.document.close();');
  const after = fn.slice(closeIdx);
  assert.match(after, /const printImgs = Array\.from\(w\.document\.images\);/,
    'must collect every image in the print window before printing');
  assert.match(after, /await Promise\.all\(printImgs\.map\(img => img\.decode \? img\.decode\(\)\.catch\(\(\) => \{\}\) : Promise\.resolve\(\)\)\);/,
    'must wait for every image to actually finish decoding (not just the load event, which can fire before a large image is fully rasterized) before printing');
  assert.match(after, /w\.print\(\);/, 'must explicitly call print() only after the decode wait resolves');

  // Order matters: the decode-wait must come after opening/writing the
  // window and before the actual print() call, or it accomplishes nothing.
  const decodeIdx = fn.indexOf('await Promise.all(printImgs.map');
  const printIdx = fn.indexOf('w.print();');
  assert.ok(closeIdx < decodeIdx && decodeIdx < printIdx,
    'the decode wait must sit between closing the document and calling print(), not before or after');
}

console.log('Label print image-decode race contract checks passed');
