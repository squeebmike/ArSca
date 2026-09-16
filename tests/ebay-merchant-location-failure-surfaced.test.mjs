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

const start = worker.indexOf('async function ensureEbayMerchantLocation');
assert.ok(start !== -1, 'ensureEbayMerchantLocation must exist');
const end = worker.indexOf('async function createAndPublishEbayListing', start);
const body = worker.slice(start, end);

assert.doesNotMatch(body, /\}\)\.catch\(\(\) => \{\}\);/, 'the merchant-location create must not silently swallow every failure with an empty catch');
assert.match(body, /if \(!locationRes\.ok && locationRes\.status !== 409\) \{/, 'must check the response status instead of assuming success');
assert.match(body, /new Error\('Could not create\/verify eBay merchant location: /, 'a real location-create failure must throw with a clear, specific message instead of proceeding silently');
assert.match(body, /if \(!locationRes\.ok && locationRes\.status !== 409\) \{[\s\S]*?throw e;/, 'the location-create failure must actually be thrown, not just constructed');
// 409 (location already exists, expected on every call after the first)
// must NOT be treated as an error, or every relist would break.
assert.match(body, /locationRes\.status !== 409/, 'a 409 (location already exists) must be tolerated, not treated as a failure');

console.log('eBay merchant-location failure-surfacing checks passed');
