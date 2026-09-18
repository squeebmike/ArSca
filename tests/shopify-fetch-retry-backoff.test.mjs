import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Shopify's GraphQL Admin API throttles by request cost, not a flat 429 like
// eBay -- a throttled call still returns HTTP 200 with a THROTTLED user error
// and an extensions.cost.throttleStatus block. A bulk push or the order-sync
// cron looping over many items needs this same retry/backoff protection
// ebayFetchWithRetry already gives the eBay integration, or a single 429/
// THROTTLED response partway through a batch just fails that one item
// permanently instead of backing off and trying again.

assert.match(worker, /async function shopifyFetchWithRetry\(url, options, maxRetries = 2\) \{/, 'missing shopifyFetchWithRetry');
const fnStart = worker.indexOf('async function shopifyFetchWithRetry(url, options, maxRetries = 2) {');
const fnEnd = worker.indexOf('\n}', fnStart) + 2;
const fn = worker.slice(fnStart, fnEnd);
assert.match(fn, /THROTTLED/, 'must detect Shopify GraphQL cost-throttling user errors, not just HTTP 429');
assert.match(fn, /attempt === maxRetries/, 'must not retry past maxRetries');
assert.match(fn, /throttleStatus/, 'must honor Shopify\'s throttleStatus.restoreRate when present');
assert.match(fn, /500 \* Math\.pow\(2, attempt\)/, 'must fall back to exponential backoff when no throttleStatus is present');

function fakeRes(status, body) {
  const res = {
    status,
    ok: status < 400,
    clone() { return res; },
    json: async () => body,
  };
  return res;
}

// Functional: a THROTTLED GraphQL error (HTTP 200) is retried, and the
// eventual success response is returned.
{
  let calls = 0;
  const impl = async () => {
    calls++;
    if (calls === 1) return fakeRes(200, { errors: [{ extensions: { code: 'THROTTLED' } }], extensions: { cost: { throttleStatus: { restoreRate: 50 } } } });
    return fakeRes(200, { data: {} });
  };
  const shopifyFetchWithRetry = new Function('fetch', 'setTimeout', fn + '\nreturn shopifyFetchWithRetry;')(impl, (f) => f());
  const res = await shopifyFetchWithRetry('https://example.invalid', {});
  assert.equal(calls, 2, 'must retry once after a THROTTLED response');
  const body = await res.json();
  assert.ok(!body.errors, 'must return the eventual success response');
}

// Functional: gives up after maxRetries and returns the last throttled response.
{
  let calls = 0;
  const alwaysThrottled = async () => { calls++; return fakeRes(429, {}); };
  const shopifyFetchWithRetry = new Function('fetch', 'setTimeout', fn + '\nreturn shopifyFetchWithRetry;')(alwaysThrottled, (f) => f());
  const res = await shopifyFetchWithRetry('https://example.invalid', {}, 2);
  assert.equal(res.status, 429, 'must give up and return the last 429 response after maxRetries');
  assert.equal(calls, 3, 'must attempt exactly maxRetries+1 times');
}

console.log('Shopify fetch retry/backoff helper checks passed');

// Wired into the loop-driven Shopify call sites (push/bulk push, order-sync
// cron) via shopifyGraphQL -- not a raw fetch -- so every Shopify GraphQL
// call automatically gets this protection without each call site opting in
// separately.
assert.match(worker, /async function shopifyGraphQL\(env, query, variables = \{\}\) \{[\s\S]*?await shopifyFetchWithRetry\(/, 'shopifyGraphQL must route every call through the retrying fetch');

console.log('Shopify retry/backoff call-site wiring checks passed');
