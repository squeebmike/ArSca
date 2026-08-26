import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// index-all.json and pokemon/manifest.json's setsCovered/allSetsCovered fields
// are both written only once, after every set in a run finishes -- the
// "Build Pokemon Offline Card Images" Action can run for hours across
// hundreds of sets and get killed by its own timeout before ever reaching
// that last step, even though each finished set's own index-set-<id>.json
// already landed in R2 along the way (confirmed: the one real run so far
// hit its 300-minute timeout and was cancelled). The manifest route for
// set=all must fall back to merging whatever per-set indexes already exist
// in R2 instead of 404ing just because index-all.json specifically is
// missing.
const manifestRouteStart = worker.indexOf("url.pathname === '/catalog/pokemon/images/manifest'");
assert(manifestRouteStart >= 0, 'Missing /catalog/pokemon/images/manifest route');
const manifestRouteEnd = worker.indexOf("url.pathname === '/catalog/pokemon/image'", manifestRouteStart);
assert(manifestRouteEnd > manifestRouteStart, 'Could not bound the manifest route source');
const manifestRoute = worker.slice(manifestRouteStart, manifestRouteEnd);

assert.match(manifestRoute, /env\.MTG_CATALOG_R2\.list\(\s*\{\s*prefix:\s*'pokemon\/images\/index-set-'/,
  'set=all must fall back to listing per-set indexes when index-all.json is missing');
assert.match(manifestRoute, /cachedAllIndex/, 'set=all must still prefer the precomputed index-all.json when it exists, for the common fast path');
assert.match(manifestRoute, /listing\.truncated/, 'the R2 list() fallback must page through truncated results, not just the first page');
assert.match(manifestRoute, /if \(!mergedIds\.size\) return json\(\{ ok: false, error: 'All-sets image index not built yet/,
  'must only 404 once the merge finds zero ids across every per-set index (i.e. genuinely nothing built yet)');

// /pricing/pokemon/export (the device-facing bulk CSV pull) was removed
// entirely -- it shared PPT's one account-wide 2-downloads/day count with
// the daily cron that builds our own R2 cloud copy, and any device hitting
// it could burn both of that day's slots before the cron got a turn. A
// time-window reservation was tried first and wasn't enough (GitHub
// Actions scheduling jitter, plus anything landing after the window
// closed, still shut the cron out on the very next run). Devices now have
// no path to PPT's export endpoint at all; only the cron calls it,
// directly with the server-side key, never through this Worker.
assert.doesNotMatch(worker, /https:\/\/www\.pokemonpricetracker\.com\/api\/v2\/export/,
  'the Worker must never call PPT\'s bulk export endpoint itself -- only the cron script does, directly, outside this file');
assert.match(worker, /if \(url\.pathname === '\/pricing\/pokemon\/export'\) \{\s*\n\s*return json\(\{ ok: false, error: 'Removed/,
  '/pricing/pokemon/export must be hard-removed and return an unambiguous error, not silently 404 or hang');

console.log('Pokemon offline images manifest + export removal contract checks passed');
