import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Live repro: a FOC presale published with the store's generic default
// shipping policy ("USPS Ground Adv") instead of its own presale-specific
// clone -- even though that exact clone ("...- FOC 40D Handling") already
// existed and was actively in use on 20 other listings, right after a
// bulk-listing run (many listings back to back). Every failure branch in
// resolveFocPresaleBasePolicyId/getFocPresaleFulfillmentPolicyId silently
// returned the generic fallback with zero logging, so there was no way to
// tell from outside which of several possible causes actually happened.
// The most likely one: eBay's Business Policy API rejects creating a
// second policy with a name that already exists on the account, and the
// per-(baseId,bucket) KV cache is the only thing normally preventing a
// repeat create attempt for the same bucket -- if that cache write ever
// failed to land even once, every later listing needing that bucket would
// hit a duplicate-name rejection and silently lose its presale-specific
// shipping setup.

assert.match(worker, /async function resolveFocPresaleBasePolicyId\(env, ebayToken\) \{/, 'missing resolveFocPresaleBasePolicyId');
{
  const fnStart = worker.indexOf('async function resolveFocPresaleBasePolicyId(env, ebayToken) {');
  const fnEnd = worker.indexOf('\n}', fnStart) + 2;
  const fn = worker.slice(fnStart, fnEnd);
  assert.match(fn, /console\.error\('resolveFocPresaleBasePolicyId: fulfillment_policy list failed'/, 'a failed policy-list fetch must be logged, not silently swallowed');
  assert.match(fn, /console\.error\('resolveFocPresaleBasePolicyId: no policy with "presale" in its name found'/, 'no matching presale-named policy must be logged, not silently swallowed');
  assert.match(fn, /console\.error\('resolveFocPresaleBasePolicyId: threw'/, 'a thrown exception must be logged, not silently swallowed');
}

console.log('resolveFocPresaleBasePolicyId logging contract checks passed');

assert.match(worker, /async function getFocPresaleFulfillmentPolicyId\(env, ebayToken, handlingDaysNeeded, basePolicyIdOverride\) \{/, 'missing getFocPresaleFulfillmentPolicyId');
{
  const fnStart = worker.indexOf('async function getFocPresaleFulfillmentPolicyId(env, ebayToken, handlingDaysNeeded, basePolicyIdOverride) {');
  const fnEnd = worker.indexOf('\nasync function findEbayFulfillmentPolicyIdByName', fnStart);
  const fn = worker.slice(fnStart, fnEnd);
  assert.match(fn, /console\.error\('getFocPresaleFulfillmentPolicyId: base policy lookup failed'/, 'a failed base-policy lookup must be logged');
  assert.match(fn, /console\.error\('getFocPresaleFulfillmentPolicyId: create clone failed'/, 'a failed clone-create call must be logged, including eBay\'s own error response');
  assert.match(fn, /const existingId = await findEbayFulfillmentPolicyIdByName\(env, ebayToken, cloneName\);/,
    'a failed create must attempt to find the already-existing policy of that exact name instead of immediately giving up -- eBay rejects duplicate policy names, so "create failed" very often means "it already exists"');
  assert.match(fn, /if \(existingId\) \{\s*\n\s*if \(env\.LBA_KV\) await env\.LBA_KV\.put\(kvKey, existingId,/,
    'a recovered existing-policy id must be cached the same way a freshly-created one would be, so this recovery path only has to run once per bucket');
  assert.match(fn, /console\.error\('getFocPresaleFulfillmentPolicyId: create response had no fulfillmentPolicyId'/, 'a malformed create response must be logged');
  assert.match(fn, /console\.error\('getFocPresaleFulfillmentPolicyId: threw'/, 'a thrown exception must be logged');
  // Store report: the warning shown for a clone-create failure ("LSAS
  // validation failed.") got truncated right at the useful part -- a flat
  // 150-char slice of the raw error JSON cut off before eBay's own
  // `parameters` array (which names the actual offending field) ever
  // appeared. Must extract longMessage + parameters specifically instead
  // of blindly truncating the raw text, so the real cause is diagnosable
  // from the dashboard warning itself.
  assert.match(fn, /const errText = \(await createRes\.text\(\)\.catch\(\(\) => ''\)\)\.substring\(0, 1000\);/,
    'must capture enough of the raw error body to actually reach eBay\'s parameters array, not just its opening fields');
  assert.match(fn, /const parsed = JSON\.parse\(errText\);/, 'must attempt to parse the structured eBay error body');
  assert.match(fn, /const params = \(firstError\.parameters \|\| \[\]\)\.map\(p => `\$\{p\.name\}=\$\{p\.value\}`\)\.join\(', '\);/,
    'must surface eBay\'s own named parameters (the actual invalid field) when present, not just the generic top-level message');
  assert.match(fn, /catch \(_\) \{ \/\* not JSON -- fall back to the raw truncated text above \*\/ \}/,
    'a non-JSON or unexpectedly-shaped error body must fall back to the raw text, not throw and lose the whole listing warning');
}

console.log('getFocPresaleFulfillmentPolicyId logging and recovery contract checks passed');

assert.match(worker, /async function findEbayFulfillmentPolicyIdByName\(env, ebayToken, name\) \{/, 'missing findEbayFulfillmentPolicyIdByName');
{
  const fnStart = worker.indexOf('async function findEbayFulfillmentPolicyIdByName(env, ebayToken, name) {');
  const fnEnd = worker.indexOf('\n}', fnStart) + 2;
  const fn = worker.slice(fnStart, fnEnd);
  assert.match(fn, /const match = \(list\.fulfillmentPolicies \|\| \[\]\)\.find\(p => p\.name === name\);/, 'must match by exact name, not a fuzzy/partial match, to find the specific clone that already exists');
}

console.log('findEbayFulfillmentPolicyIdByName contract check passed');
