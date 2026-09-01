import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Store report: the /ebay/business-policies endpoint -- backing both the
// EBAY tab's business-policy display and the FOC eBay presale review
// modal's shipping-policy picker -- always returned zero policies, even
// for a store with real ones configured on eBay. Root cause: eBay's
// response wraps each policy list under a camelCase key (fulfillmentPolicies
// / paymentPolicies / returnPolicies), but the handler computed the key as
// `${kind}s` where kind is the underscored URL path segment
// ('fulfillment_policy'), producing 'fulfillment_policys' (and the
// payment/return equivalents) -- neither of which ever exists in eBay's
// real response, so every list silently came back empty regardless of
// what the account actually had. This never surfaced as an "error"
// (the fetch itself succeeds), just an always-empty policies array.
const routeStart = worker.indexOf("if (url.pathname === '/ebay/business-policies') {");
const routeEnd = worker.indexOf('\n    // Core "create inventory item + offer + publish"', routeStart);
const routeBody = worker.slice(routeStart, routeEnd);

assert.ok(routeStart !== -1, '/ebay/business-policies route must exist');
assert.match(routeBody, /const RESPONSE_LIST_KEYS = \{ fulfillment_policy: 'fulfillmentPolicies', payment_policy: 'paymentPolicies', return_policy: 'returnPolicies' \};/,
  'must map each URL path segment to eBay\'s real camelCase response key, not guess by string concatenation');
assert.match(routeBody, /return \{ list: data\[RESPONSE_LIST_KEYS\[kind\]\] \|\| \[\] \};/,
  'must read the policy list back out using the real response key, not a computed guess');

// Functional check against a realistic eBay response shape -- a subtle
// wrong key here silently produces "no policies configured" for every
// store, forever, with no error to notice.
const keysMatch = routeBody.match(/const RESPONSE_LIST_KEYS = (\{[^}]+\});/);
assert.ok(keysMatch, 'RESPONSE_LIST_KEYS literal must be extractable');
const RESPONSE_LIST_KEYS = new Function('return ' + keysMatch[1])();
const ebayFulfillmentResponse = { fulfillmentPolicies: [{ fulfillmentPolicyId: '111', name: 'PreSale Paid Shipping' }] };
const ebayPaymentResponse = { paymentPolicies: [{ paymentPolicyId: '222', name: 'Default Payment' }] };
const ebayReturnResponse = { returnPolicies: [{ returnPolicyId: '333', name: 'Default Returns' }] };
assert.deepEqual(ebayFulfillmentResponse[RESPONSE_LIST_KEYS.fulfillment_policy], ebayFulfillmentResponse.fulfillmentPolicies,
  'a real fulfillment-policy response must actually be found by the computed key');
assert.deepEqual(ebayPaymentResponse[RESPONSE_LIST_KEYS.payment_policy], ebayPaymentResponse.paymentPolicies,
  'a real payment-policy response must actually be found by the computed key');
assert.deepEqual(ebayReturnResponse[RESPONSE_LIST_KEYS.return_policy], ebayReturnResponse.returnPolicies,
  'a real return-policy response must actually be found by the computed key');

console.log('/ebay/business-policies response-key contract checks passed');
