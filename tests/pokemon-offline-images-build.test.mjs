import assert from 'node:assert/strict';
import fs from 'node:fs';

const buildScript = fs.readFileSync('scripts/pokemon/build-pokemon-offline-bundle.mjs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/pokemon-offline-images.yml', 'utf8');

// This script shares its uploadObject() shape (and the exact failure mode
// confirmed live on the MTG image builder -- a transient "fetch request
// failed" mid-upload killing the whole run) with
// scripts/mtg/build-mtg-offline-images.mjs. It must retry the same way.
const uploadObjectStart = buildScript.indexOf('async function uploadObject(objectPath, filePath, attempts = 4) {');
assert(uploadObjectStart >= 0, 'uploadObject() must exist and be async so call sites can await its retries');
const uploadObjectEnd = buildScript.indexOf('\n}', uploadObjectStart);
const uploadObjectFn = buildScript.slice(uploadObjectStart, uploadObjectEnd);
assert.match(uploadObjectFn, /for \(let attempt = 1; attempt <= attempts; attempt\+\+\) \{/, 'uploadObject must retry a transient wrangler failure rather than throwing on the first one');
assert.match(uploadObjectFn, /if \(result\.status === 0\) return;/, 'a successful upload on any attempt must return without retrying further');
assert.match(uploadObjectFn, /if \(attempt === attempts\) throw new Error/, 'only the final exhausted attempt may throw -- an earlier failure must not abort the whole run');

// Every call site must await the now-async uploadObject.
assert.match(buildScript, /if \(fs\.existsSync\(filePath\)\) await uploadObject\(`pokemon\/images\/\$\{id\}\/\$\{size\}\.jpg`, filePath\);/, 'the per-image upload call site must await uploadObject');
assert.match(buildScript, /await uploadObject\(`pokemon\/images\/index-set-\$\{set\.tcgPlayerNumericId\}\.json`, setIndexPath\);/, 'the per-set index upload call site must await uploadObject');
assert.match(buildScript, /await uploadObject\('pokemon\/images\/index-all\.json', allIndexPath\);/, 'the merged all-sets index upload call site must await uploadObject');
assert.match(buildScript, /await uploadObject\(descriptors\.sets\.path, path\.join\(outputRoot, descriptors\.sets\.path\)\);/, 'the sets bundle upload call site must await uploadObject');
assert.match(buildScript, /await uploadObject\('pokemon\/manifest\.json', manifestPath\);/, 'the manifest upload call site must await uploadObject');

console.log('Pokemon offline images build upload-retry checks passed');

// ── Contract: the one-time full-catalog image job used to be a single
// 360-minute job iterating every set in sequence -- the one real run so far
// got cancelled partway through with no way to resume other than starting
// over. It must instead fan out across a matrix like the MTG image
// builder, resolving the real set list from PPT's /sets endpoint up front. ──
assert.match(workflow, /list-sets:/, 'must resolve the real set list before fanning out, same as the MTG image builder');
assert.match(workflow, /https:\/\/www\.pokemonpricetracker\.com\/api\/v2\/sets\?limit=100&offset=/, 'must page through PPT\'s real /sets endpoint rather than assuming a fixed or stale set list');
assert.match(workflow, /const batchSize = 15;/, 'must batch multiple sets per matrix leg to stay under GitHub\'s 256-job cap');
assert.match(workflow, /max-parallel: 4/, 'must cap concurrent legs, same as the MTG image builder');
assert.match(workflow, /matrix:\s*\n\s*batch: \$\{\{ fromJson\(needs\.list-sets\.outputs\.matrix\) \}\}/, 'build-and-publish must consume the batches resolved by list-sets');
assert.match(workflow, /npm run pokemon:build -- --version="\$VERSION" --images="set:\$SETID" --upload/, 'each set in a batch must be built and uploaded individually, reusing the existing pokemon:build script');

console.log('Pokemon offline images workflow fan-out checks passed');
