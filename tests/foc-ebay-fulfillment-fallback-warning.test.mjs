import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store report: "i also made a shipping policy literally called foc, it
// started doing a foc 30 day... but then it went back to ground vantage
// after a few listings to ebay that did use the correct one." The dealer
// had explicitly picked the "FOC" policy in the review screen, and the
// first several listings correctly cloned it into a "... - FOC 30D
// Handling" handling-time variant -- but partway through the same run,
// listings silently started using the store's generic default policy
// ("Ground Advantage") instead, with no warning anywhere. Root cause:
// getFocPresaleFulfillmentPolicyId's every failure branch (base policy
// lookup failing, clone creation being rejected, etc) returned the bare
// `fallback` policy id -- a real, non-empty id (the store's own normal
// default) -- so the caller's old `fulfillmentPolicyId ? [] : [warn]`
// check saw what looked like a perfectly valid policy and stayed silent,
// even though it was silently the WRONG one.

// ---------------------------------------------------------------------
// getFocPresaleFulfillmentPolicyId must report usedFallback, not just an id
// ---------------------------------------------------------------------
const fnStart = worker.indexOf('async function getFocPresaleFulfillmentPolicyId');
assert.ok(fnStart !== -1, 'getFocPresaleFulfillmentPolicyId must exist');
const fnEnd = worker.indexOf('async function findEbayFulfillmentPolicyIdByName', fnStart);
const fnBody = worker.slice(fnStart, fnEnd);

// Every return path must be a {id, usedFallback, reason} object -- a bare
// string return anywhere here would silently break every caller's ability
// to tell "got the real FOC-bucket policy" from "silently substituted the
// generic default".
assert.match(fnBody, /return \{ id: '', usedFallback: true, reason: 'no FOC\/presale-specific shipping policy is configured/, 'the "no base and no fallback at all" path must report usedFallback');
assert.match(fnBody, /return \{ id: cached, usedFallback: false, reason: '' \};/, 'a KV cache hit is always a real previously-created clone, never a fallback substitution');
assert.match(fnBody, /return \{ id: fallback, usedFallback: true, reason: `could not look up the picked shipping policy to clone its handling time from/, 'a failed base-policy lookup must report usedFallback with a real reason, not just a bare fallback id');
assert.match(fnBody, /return \{ id: existingId, usedFallback: false, reason: '' \};/, 'recovering an already-existing clone by name (duplicate-name rejection path) is still the real policy, not a fallback');
assert.match(fnBody, /return \{ id: fallback, usedFallback: true, reason: `eBay rejected creating the "\$\{cloneName\}" handling-time policy/, 'a rejected clone-creation call (and no existing clone found to recover) must report usedFallback');
assert.match(fnBody, /return \{ id: fallback, usedFallback: true, reason: `eBay accepted the "\$\{cloneName\}" handling-time policy but did not return its id` \};/, 'a create response with no id must report usedFallback');
assert.match(fnBody, /return \{ id: newId, usedFallback: false, reason: '' \};/, 'a genuinely successful fresh clone must report usedFallback:false');
assert.match(fnBody, /return \{ id: fallback, usedFallback: true, reason: 'error while creating the handling-time policy: ' \+ e\.message \};/, 'a thrown exception anywhere in this function must still report usedFallback, not silently swallow into a bare id');

assert.doesNotMatch(fnBody, /^\s*return (cached|fallback|newId|existingId|'');\s*$/m, 'no return statement in this function may be a bare value anymore -- every path must return the {id, usedFallback, reason} shape or a caller\'s warning check silently breaks');

// ---------------------------------------------------------------------
// Both FOC create-presale routes must actually surface the fallback warning
// ---------------------------------------------------------------------
const singleCreateStart = worker.indexOf("url.pathname === '/foc/ebay/create-presale' || url.pathname === '/foc/ebay/presale-preview'");
const singleCreateEnd = worker.indexOf("if (url.pathname === '/foc/ebay/presale-group-preview'", singleCreateStart);
const singleCreateBody = worker.slice(singleCreateStart, singleCreateEnd);
assert.match(singleCreateBody, /const fulfillmentResult = await getFocPresaleFulfillmentPolicyId\(env, ebayToken, handlingBusinessDays, basePolicyId\);/, 'the single-cover create route must capture the full result, not just the bare id');
assert.match(singleCreateBody, /fulfillmentResult\.usedFallback/, 'the single-cover create route must check usedFallback when building its warnings');
assert.match(singleCreateBody, /This listing published under the store's normal default shipping policy, NOT the FOC handling-time policy you picked/, 'the single-cover create route must warn the dealer by name when this happens, not stay silent like before the fix');

const groupCreateStart = worker.indexOf("url.pathname === '/foc/ebay/presale-group-preview'");
const groupCreateEnd = worker.indexOf("if (url.pathname === '/foc/ebay/convert-to-instock')", groupCreateStart);
const groupCreateBody = worker.slice(groupCreateStart, groupCreateEnd);
assert.match(groupCreateBody, /const fulfillmentResult = await getFocPresaleFulfillmentPolicyId\(env, ebayToken, handlingBusinessDays, basePolicyId\);/, 'the multi-cover group create route must capture the full result too, not just the bare id');
assert.match(groupCreateBody, /fulfillmentResult\.usedFallback/, 'the multi-cover group create route must check usedFallback when building its warnings');

// ---------------------------------------------------------------------
// Store report (same screenshot): "Volume discount setup failed (400): A
// valid entry is required for 'marketplaceId'." -- unlike the Sell
// Inventory API calls elsewhere in this file, the Sell Marketing API's
// createItemPromotion requires marketplaceId as its own top-level field on
// the promotion body, which was missing entirely.
// ---------------------------------------------------------------------
const volumeFnStart = worker.indexOf('async function createEbayVolumeDiscount');
const volumeFnEnd = worker.indexOf('async function endEbayVolumeDiscount', volumeFnStart);
const volumeFnBody = worker.slice(volumeFnStart, volumeFnEnd);
assert.match(volumeFnBody, /const body = \{\s*\n\s*marketplaceId: 'EBAY_US',/, 'the volume-discount promotion body must include marketplaceId, or eBay rejects the whole call with "A valid entry is required for \'marketplaceId\'"');

console.log('FOC eBay fulfillment-policy silent-fallback warning + volume-discount marketplaceId fix checks passed');
