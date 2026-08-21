import assert from 'node:assert/strict';
import fs from 'node:fs';

const buildScript = fs.readFileSync('scripts/mtg/build-mtg-offline-images.mjs', 'utf8');

// The first real run of "Build MTG Offline Card Images" (scope=fra) failed
// every single image download with HTTP 400 -- 43/43 cards, both small and
// normal sizes, no exceptions. Same GitHub Actions run, same runner IP:
// the bulk-data JSON API call (fetchJson) and the multi-hundred-MB bulk
// download (downloadToFile) both succeeded, and both send a User-Agent
// header. downloadImage() -- the one fetch() call in this file with no
// headers at all -- was the only one that failed, on every card. Scryfall's
// API terms require a real User-Agent on every request; downloadImage()
// just never got one when this script was written.
const downloadImageStart = buildScript.indexOf('async function downloadImage(url, destination, attempts = 2) {');
assert(downloadImageStart >= 0, 'downloadImage() must exist');
const downloadImageEnd = buildScript.indexOf('\nasync function runPool', downloadImageStart);
const downloadImageFn = buildScript.slice(downloadImageStart, downloadImageEnd);
assert.match(downloadImageFn, /fetch\(url, \{ headers: \{ 'User-Agent': 'Walk-Off-MTG-Offline-Builder\/1\.0' \} \}\)/,
  'downloadImage() must send the same User-Agent header as fetchJson()/downloadToFile() in this file -- Scryfall\'s CDN 400s every request missing one');

// A set where every image download fails must still fail cleanly (0 cached,
// index reflects that) rather than crash with ENOENT -- outputRoot was
// previously only ever created as a side effect of a successful download's
// own mkdir, so an all-failed set never got a directory to write its index
// into at all.
const perSetWriteIdx = buildScript.indexOf("const setIndexPath = path.join(outputRoot, `index-set-${setCode}.json`);");
assert(perSetWriteIdx >= 0, 'must build the per-set index path');
const perSetSlice = buildScript.slice(perSetWriteIdx, perSetWriteIdx + 700);
assert.match(perSetSlice, /await fsp\.mkdir\(outputRoot, \{ recursive: true \}\);\s*\n\s*await fsp\.writeFile\(setIndexPath/,
  'must ensure outputRoot exists before writing the per-set index, independent of whether any image in the set actually downloaded');

const allIndexWriteIdx = buildScript.indexOf("const allIndexPath = path.join(outputRoot, 'index-all.json');");
assert(allIndexWriteIdx >= 0, 'must build the all-sets index path');
const allIndexSlice = buildScript.slice(allIndexWriteIdx, allIndexWriteIdx + 300);
assert.match(allIndexSlice, /await fsp\.mkdir\(outputRoot, \{ recursive: true \}\);\s*\n\s*await fsp\.writeFile\(allIndexPath/,
  'must ensure outputRoot exists before writing the merged all-sets index too');

console.log('MTG offline images build fetch-header checks passed');
