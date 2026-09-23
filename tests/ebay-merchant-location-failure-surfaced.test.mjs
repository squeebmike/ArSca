import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ensureEbayMerchantLocation's location-create POST used to be wrapped in
// `.catch(() => {})` with no check of res.ok -- a rejected create (bad
// address format, duplicate key conflict, etc.) still returned success,
// and createAndPublishEbayListing went on to publish an offer referencing
// a merchantLocationKey that might not actually exist or hold stale data.
// The resulting failure only ever surfaced later as an opaque eBay error
// on the offer/publish call, far from its real, already-known cause.
//
// A first fix checked `locationRes.status !== 409` to tolerate "already
// exists" -- but a real store hit "Could not create/verify eBay merchant
// location: ...merchantLocationKey already exists..." on every single
// listing, because eBay actually returns that condition as HTTP 400 with
// errorId 25803 in the body, never a 409. The status-only check treated
// every relist (i.e. every listing after the very first) as a hard
// failure. Detection now reads the actual error body instead of trusting
// the HTTP status to say what kind of failure this is.

const start = worker.indexOf('async function ensureEbayMerchantLocation');
assert.ok(start !== -1, 'ensureEbayMerchantLocation must exist');
const end = worker.indexOf('async function createAndPublishEbayListing', start);
const body = worker.slice(start, end);

assert.doesNotMatch(body, /\}\)\.catch\(\(\) => \{\}\);/, 'the merchant-location create must not silently swallow every failure with an empty catch');
assert.match(body, /if \(!locationRes\.ok\) \{/, 'must check the response status instead of assuming success');
assert.match(body, /new Error\('Could not create\/verify eBay merchant location: /, 'a real location-create failure must throw with a clear, specific message instead of proceeding silently');
assert.match(body, /if \(!alreadyExists\) \{[\s\S]*?throw e;/, 'the location-create failure must actually be thrown, not just constructed');
// "Already exists" (expected on every call after the first) must be
// detected from eBay's real error body (errorId 25803 / message text),
// not assumed to always arrive as HTTP 409 -- eBay does not use 409 for
// this condition in practice.
assert.match(body, /err\?\.errorId === 25803/, 'must detect "already exists" from the real eBay errorId, not just an assumed HTTP status');
assert.match(body, /already exists/i, 'must also fall back to matching eBay\'s "already exists" message text');
// A literal 409 must still be tolerated too, in case eBay ever does send one.
assert.match(body, /locationRes\.status === 409/, 'a 409 (if eBay ever sends one) must still be tolerated, not treated as a failure');

console.log('eBay merchant-location failure-surfacing checks passed');
