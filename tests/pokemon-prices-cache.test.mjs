import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Cards+sealed price snapshots now get pulled from PPT once a day
// (pokemon-prices-daily.yml -> build-pokemon-prices-bundle.mjs) into our own
// R2 copy under pokemon/prices-manifest.json, deliberately separate from
// pokemon/manifest.json (sets+images) so the two daily builds never collide.
// Devices should sync cards/sealed from these routes instead of hitting
// /pricing/pokemon/export live and spending PPT's shared 2-exports-a-day cap.
assert.match(worker, /const POKEMON_PRICES_FILE_TYPES = new Set\(\['cards', 'sealed'\]\);/,
  'POKEMON_PRICES_FILE_TYPES must only cover cards+sealed -- eBay/population stay live-only');

const manifestRouteStart = worker.indexOf("url.pathname === '/catalog/pokemon/prices/manifest'");
assert(manifestRouteStart >= 0, 'Missing /catalog/pokemon/prices/manifest route');
const downloadRouteStart = worker.indexOf("url.pathname === '/catalog/pokemon/prices/download'");
assert(downloadRouteStart > manifestRouteStart, 'Missing /catalog/pokemon/prices/download route');
const downloadRouteEnd = worker.indexOf("url.pathname === '/catalog/pokemon/images/manifest'", downloadRouteStart);
assert(downloadRouteEnd > downloadRouteStart, 'Could not bound the prices routes source');
const pricesRoutes = worker.slice(manifestRouteStart, downloadRouteEnd);

assert.match(pricesRoutes, /env\.MTG_CATALOG_R2\.get\('pokemon\/prices-manifest\.json'/,
  'prices manifest route must read the separate pokemon/prices-manifest.json key, not the sets/images manifest');
assert.match(pricesRoutes, /if \(!POKEMON_PRICES_FILE_TYPES\.has\(type\)\) return json\(\{ ok: false, error: 'file must be cards or sealed' \}, 400\);/,
  'download route must reject any file type other than cards/sealed');
assert.match(pricesRoutes, /if \(!key\.startsWith\('pokemon\/prices\/'\) \|\| !key\.endsWith\('\.jsonl\.gz'\)\)/,
  'download route must only ever serve a path back out of the manifest it just read, never a caller-supplied path');
assert.match(pricesRoutes, /manifest\?\.status === 'ready' \? manifest\.files\?\.\[type\] : null/,
  'download route must refuse to serve a descriptor unless the manifest reports status ready');

console.log('Pokemon prices cache route contract checks passed');
