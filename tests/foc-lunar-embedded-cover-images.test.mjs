import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { DOMParser } from 'linkedom';

const dashboard = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const preorders = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');

// Store report: "I imported the Lunar FOC and it didn't show images." Lunar's
// real export embeds each cover as a picture object anchored directly to its
// row's cell -- confirmed via a real screenshot: clicking one of those cells
// showed a blank formula bar, ruling out both a plain URL and a =DISPIMG()
// cell-image formula. SheetJS (the XLSX reader this app already uses) only
// ever reads cell VALUES; an anchored drawing object has no cell value at
// all, so this was invisible to every FOC importer, not a wrong column name.
// extractXlsxCellImages reads the XLSX's own zip/XML structure directly
// (the standard OOXML DrawingML anchor format) to recover what SheetJS
// structurally cannot -- this proves it against a real, minimal XLSX file
// built the same way Excel/Google Sheets actually write one.

global.JSZip = JSZip;
global.DOMParser = DOMParser;

function extractFn(name) {
  const start = dashboard.indexOf('async function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  const end = dashboard.indexOf('\n}', start) + 2;
  return dashboard.slice(start, end);
}

const extractXlsxCellImages = new Function(extractFn('extractXlsxCellImages') + '\nreturn extractXlsxCellImages;')();

async function buildFakeXlsxWithCellImages(anchors) {
  const zip = new JSZip();
  const relEntries = anchors.map((a, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${a.mediaFile}"/>`).join('');
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relEntries}</Relationships>`);
  const anchorXml = anchors.map((a, i) => `
    <xdr:twoCellAnchor>
      <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
      <xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
      <xdr:pic><xdr:blipFill><a:blip r:embed="rId${i + 1}"/></xdr:blipFill></xdr:pic>
    </xdr:twoCellAnchor>`).join('');
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchorXml}</xdr:wsDr>`);
  for (const a of anchors) zip.file('xl/media/' + a.mediaFile, Buffer.from('fake-image-bytes-for-' + a.mediaFile));
  return zip.generateAsync({ type: 'nodebuffer' });
}

{
  // Three covers anchored at real (0-indexed sheet) rows, out of order, with
  // a gap (row 7 has none) -- the header/title rows above them in a real
  // Lunar file are exactly why this can't assume image N belongs to data
  // row N; it must read the real anchor position.
  const buffer = await buildFakeXlsxWithCellImages([
    { row: 3, mediaFile: 'image1.png' },
    { row: 5, mediaFile: 'image2.jpg' },
    { row: 9, mediaFile: 'image3.webp' },
  ]);
  const byRow = await extractXlsxCellImages(buffer);
  assert.equal(byRow.size, 3, 'all three anchored images must be found');
  assert.ok(byRow.has(3) && byRow.has(5) && byRow.has(9), 'every anchored row must be recovered exactly, including the gap at row 7');
  assert.equal(byRow.get(3).ext, 'png');
  assert.equal(byRow.get(5).ext, 'jpg');
  assert.equal(byRow.get(9).ext, 'webp');
  const blob = await byRow.get(3).file.async('nodebuffer');
  assert.equal(blob.toString(), 'fake-image-bytes-for-image1.png', 'the actual extracted file must be the real media file the anchor points to, not a different one');
}

{
  // No drawings part at all (a file with no embedded covers) must return an
  // empty map, not throw.
  const zip = new JSZip();
  zip.file('xl/worksheets/sheet1.xml', '<worksheet/>');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const byRow = await extractXlsxCellImages(buffer);
  assert.equal(byRow.size, 0, 'a file with no drawings part must return an empty map, not throw');
}

console.log('Lunar embedded-cover-image extraction functional checks passed');

// ── Structural: the upload step and the import-flow wiring ──
{
  const uploadFnStart = dashboard.indexOf('async function uploadExtractedCoverImages(');
  assert.ok(uploadFnStart >= 0, 'uploadExtractedCoverImages must exist');
  const uploadFn = dashboard.slice(uploadFnStart, dashboard.indexOf('\n}\n', uploadFnStart) + 2);
  assert.match(uploadFn, /api\('\/inventory\/photo\/upload',\{method:'POST',headers:\{'Content-Type':xlsxImageContentType\(info\.ext\)\},body:blob\}\)/,
    'each extracted image must actually be uploaded to get a real hosted URL, reusing the existing photo-upload route');

  const handlerStart = dashboard.indexOf('async function handleFocFileImport(event,config){');
  const handlerEnd = dashboard.indexOf('\nfunction handleImport(event){', handlerStart);
  const handlerFn = dashboard.slice(handlerStart, handlerEnd);
  assert.match(handlerFn, /if\(config\.extractCellImages\)\{/, 'image extraction must only run when the caller opts in (Lunar), not for every distributor');
  assert.match(handlerFn, /var imagesByRow=await extractXlsxCellImages\(buffer\);/, 'must extract images from the same buffer already read for the row data');
  assert.match(handlerFn, /row\.CoverLink=url;/, 'a matched upload must be attached to its row as CoverLink, the same field name PRH\'s own real column already uses');

  assert.match(dashboard, /function handleLunarImport\(event\)\{\s*\n\s*return handleFocFileImport\(event,\{label:'Lunar',query:'\?distributor=Lunar',extractCellImages:true,/,
    'the Lunar import entry point must opt into cell-image extraction');
}
{
  const lunarFnStart = preorders.indexOf('export function normalizeLunarRow(row = {}) {');
  assert.ok(lunarFnStart >= 0, 'normalizeLunarRow must exist');
  const lunarFnEnd = preorders.indexOf('\n}', lunarFnStart) + 2;
  const lunarFn = preorders.slice(lunarFnStart, lunarFnEnd);
  const expectedLine = "coverImageUrl:/^https:\\/\\//i.test(text(row.CoverLink, 2000)) ? text(row.CoverLink, 2000) : '',";
  assert.ok(lunarFn.includes(expectedLine),
    'normalizeLunarRow must read the client-uploaded CoverLink the same way normalizePrhRow already reads its own real CoverLink column');
}

console.log('Lunar embedded-cover-image upload/import-wiring structural checks passed');
