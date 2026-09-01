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
