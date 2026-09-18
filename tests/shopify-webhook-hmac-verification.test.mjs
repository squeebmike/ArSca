import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// The Shopify order webhook has no staff login to authenticate against --
// Shopify signs each delivery with HMAC-SHA256/base64 over the raw body
// (X-Shopify-Hmac-Sha256 header) using the app's webhook secret instead.
// Without verifying this, anyone who found the webhook URL could POST a
// forged "order paid" payload and mark real inventory sold for free.

assert.match(worker, /async function verifyShopifyWebhookSignature\(body, signatureHeader, secret\) \{/, 'missing verifyShopifyWebhookSignature');
const fnStart = worker.indexOf('async function verifyShopifyWebhookSignature(body, signatureHeader, secret) {');
const fnEnd = worker.indexOf('\n}', fnStart) + 2;
const fn = worker.slice(fnStart, fnEnd);
assert.match(fn, /crypto\.subtle\.importKey/, 'must use Web Crypto HMAC, not a hand-rolled implementation');
assert.match(fn, /name: ?'HMAC', ?hash: ?'SHA-256'/, 'must sign with HMAC-SHA256');

const verifyShopifyWebhookSignature = new Function('crypto', 'btoa', fn + '\nreturn verifyShopifyWebhookSignature;')(
  globalThis.crypto,
  (s) => Buffer.from(s, 'binary').toString('base64'),
);

const secret = 'whsec_test_shared_secret';
const body = JSON.stringify({ id: 12345, line_items: [{ sku: 'abc', quantity: 1 }] });
const validSignature = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');

// Functional: a correctly-signed body verifies.
assert.equal(await verifyShopifyWebhookSignature(body, validSignature, secret), true, 'a validly-signed webhook body must verify');

// Functional: a tampered body, a wrong secret, and a missing signature must
// all be rejected.
assert.equal(await verifyShopifyWebhookSignature(body + 'x', validSignature, secret), false, 'a tampered body must fail verification');
assert.equal(await verifyShopifyWebhookSignature(body, validSignature, 'wrong_secret'), false, 'a signature computed with the wrong secret must fail verification');
assert.equal(await verifyShopifyWebhookSignature(body, '', secret), false, 'a missing signature header must fail verification, not be treated as unsigned-and-ok');
assert.equal(await verifyShopifyWebhookSignature(body, validSignature, ''), false, 'a missing configured secret must fail closed, not accept anything');

console.log('Shopify webhook HMAC verification checks passed');

// Wired into the route: unverified requests must be rejected with 401
// before the body is ever parsed/trusted as a real order.
const routeStart = worker.indexOf("if (url.pathname === '/shopify/webhook/orders' && request.method === 'POST') {");
assert.notEqual(routeStart, -1, 'missing /shopify/webhook/orders route');
const routeEnd = worker.indexOf('\n    }', routeStart);
const routeBody = worker.slice(routeStart, routeEnd);
assert.match(routeBody, /verifyShopifyWebhookSignature\(body, request\.headers\.get\('x-shopify-hmac-sha256'\)/, 'route must verify the X-Shopify-Hmac-Sha256 header');
assert.match(routeBody, /if \(!verified\) return new Response\('Invalid Shopify signature', \{ status: 401 \}\);/, 'an unverified request must be rejected with 401 before the order is processed');

console.log('Shopify webhook route wiring checks passed');
