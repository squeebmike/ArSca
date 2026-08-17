import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Contract: /pricing/justtcg/variants/batch parallelizes its per-card
// lookups instead of a sequential for-loop, despite being named "batch" ──
const batchRouteSrc = worker.slice(worker.indexOf('if (batchVariantMatch) {'), worker.indexOf("if (searchMatch) {"));
assert.match(batchRouteSrc, /const results = await Promise\.all\(ids\.slice\(0, 10\)\.map\(async id => \{/, 'batch card lookups must run concurrently via Promise.all, not a sequential for-loop');
assert.doesNotMatch(batchRouteSrc, /for \(const id of ids\.slice\(0, 10\)\)/, 'the old sequential for-loop must be gone');
assert.match(batchRouteSrc, /return json\(\{ ok: true, success: true, source: 'justtcg', matches: results\.filter\(Boolean\) \}\);/, 'null results (no card found) must still be filtered out of the final matches array');

console.log('JustTCG batch parallelization contract checks passed');

// ── Contract: pcFetch is edge-cached like the other PriceCharting lookups in
// this file, matching the same cf:{cacheTtl,...} shape used nearby ──
const pcFetchSrc = worker.slice(worker.indexOf('function pcFetch(path, params = {}) {'), worker.indexOf('const comicPcQuery ='));
assert.match(pcFetchSrc, /cf: \{ cacheTtl: 300, cacheEverything: false \}/, 'pcFetch must set a Cloudflare edge cache TTL on its upstream fetch');
assert.match(pcFetchSrc, /const res = await fetch\(pcUrl\(path\) \+ '\?' \+ qs\.toString\(\), \{ headers: \{ 'Accept': 'application\/json' \}, cf: \{ cacheTtl: 300, cacheEverything: false \} \}\);/, 'the cf option must be attached to the actual upstream request, not a separate no-op call');

console.log('PriceCharting pcFetch caching contract checks passed');

// ── Functional: reimplement the parallelized batch-lookup shape and verify
// concurrent execution ordering + null-filtering semantics ──
async function fakeJustFetch(id, shouldFail){
  await new Promise(resolve => setTimeout(resolve, id === 'slow' ? 30 : 5));
  if(shouldFail) throw new Error('not found');
  return { card: { id, name: 'Card ' + id } };
}

async function runBatch(ids){
  const results = await Promise.all(ids.map(async id => {
    const data = await fakeJustFetch(id, id === 'missing').catch(() => null);
    if(!data) return null;
    return data.card;
  }));
  return results.filter(Boolean);
}

const started = Date.now();
const out = await runBatch(['a', 'slow', 'b', 'missing']);
const elapsed = Date.now() - started;
assert.deepEqual(out.map(c => c.id), ['a', 'slow', 'b'], 'the missing card must be filtered out while the others succeed');
// A sequential version of this batch would take >= 5+30+5+5 = 45ms; running
// concurrently should finish close to the slowest single call (~30ms), not
// the sum of all four.
assert.ok(elapsed < 45, `parallel batch lookups took ${elapsed}ms -- expected well under the ~45ms a sequential loop would take`);

console.log('Batch parallelization functional checks passed');
