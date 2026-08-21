import assert from 'node:assert/strict';
import fs from 'node:fs';

const offlineBrowser = fs.readFileSync('scripts/pokemon/offline-browser.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// syncImages() already wrote its own lastSyncAt under a per-scope meta key
// (images:all, images:<setId>, ...) every time it ran, but status() never
// read it back out -- the Settings > Offline Catalogs panel had no real
// date to show for "Card images cached on this device" and fell back to a
// hardcoded blank, which rendered as "Not downloaded" directly next to the
// actual cached image count (e.g. "7,270 image files") on the same row --
// self-contradictory to anyone reading it.
assert.match(offlineBrowser, /async function getAllMeta\(\)\{const db=await openDb\(\);return requestPromise\(db\.transaction\('meta','readonly'\)\.objectStore\('meta'\)\.getAll\(\)\);\}/,
  'must be able to enumerate every meta record, not just fetch one key at a time, to find every images:* sync record');

const statusFnStart = offlineBrowser.indexOf('async function status()');
assert(statusFnStart >= 0, 'missing status()');
const statusFnEnd = offlineBrowser.indexOf('\n  async function getImageBlob', statusFnStart);
const statusFn = offlineBrowser.slice(statusFnStart, statusFnEnd);

assert.match(statusFn, /\.filter\(m=>String\(m\?\.key\|\|''\)\.startsWith\('images:'\)\)/, 'must only consider meta records that are actually image-sync records');
assert.match(statusFn, /lastImageSyncAt:imageSyncTimes\.length\?imageSyncTimes\[imageSyncTimes\.length-1\]:''/, 'status() must surface the most recent image-sync timestamp across every scope ever synced on this device');

assert.match(dashboard, /row\('Card images cached on this device', pokemonImagesStatus\?\.cardImageCount \|\| 0, pokemonImagesStatus\?\.lastImageSyncAt \|\| '',/,
  'the dashboard row must use the real last-sync date instead of a hardcoded blank -- otherwise it always shows "Not downloaded" even when images are cached');

console.log('Pokemon offline image sync date checks passed');
