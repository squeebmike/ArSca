import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const storefront = fs.readFileSync('storefront.html', 'utf8');
const account = fs.readFileSync('scripts/customer-account.mjs', 'utf8');

// Bug: a storefront checkout interrupted mid-Stripe-payment (closed tab,
// dropped connection, walked away) left pos_sales.status='pending' with no
// way back -- /public/storefront/checkout only ever creates a brand-new
// sale from cart items, and nothing else touched a pending one. The
// account "Orders" tab didn't even show a status field, so the order
// looked identical to a normal paid one. Same shape as the FOC preorder
// resume-payment fix (resumePreorderPayment in scripts/foc-preorders.mjs).

// ── Worker route ────────────────────────────────────────────────────────
const routeStart = worker.indexOf("if (url.pathname === '/public/storefront/resume' && request.method === 'POST') {");
assert(routeStart >= 0, 'POST /public/storefront/resume route must exist');
const routeEnd = worker.indexOf("if (url.pathname === '/public/storefront/shipping-quote'", routeStart);
assert(routeEnd > routeStart, 'could not bound the resume route source');
const routeSrc = worker.slice(routeStart, routeEnd);

assert.match(routeSrc, /const auth = await requireAuthenticatedUser\(request, env\);/, 'resuming payment must require a signed-in account -- checkout itself is guest/unauthenticated, but resume must not be');
assert.match(routeSrc, /const emailMatches = !!email && String\(order\.customer_email \|\| ''\)\.toLowerCase\(\) === email;/, 'must verify the signed-in account actually owns this order by email');
assert.match(routeSrc, /const customer = await findLinkedCustomer\(db, storeId, auth\.user\.id\);/, 'must also check the account\'s SMS-linked phone against the order, not just email -- most guest checkouts never had an email captured at all');
assert.match(routeSrc, /if \(!emailMatches && !phoneMatches\) return json\(\{ ok:false, error:'This order does not belong to your account' \}, 403\);/, 'an order belonging to a different customer must be rejected outright, not exposed to whoever guesses an orderId');
assert.match(routeSrc, /if \(sale\.status !== 'pending'\) return json\(\{ ok:false, error:`This order is already \$\{sale\.status\}; there is nothing to pay\.` \}, 409\);/, 'an already-resolved sale (completed/refunded/etc) must never be re-chargeable through this route');
assert.match(routeSrc, /const RESUMABLE_INTENT_STATUSES = new Set\(\['requires_payment_method', 'requires_confirmation', 'requires_action'\]\);/, 'must only reuse a PaymentIntent Stripe still considers payable, never one already succeeded/canceled');
assert.match(routeSrc, /idempotencyKey:`arsca-storefront-resume-\$\{mode\}-\$\{sale\.id\}-\$\{Date\.now\(\)\}`/, 'the resume path\'s idempotency key must differ from the original checkout\'s (arsca-storefront-${mode}-${saleId}, no Date.now()) -- reusing that exact key would make Stripe hand back the original, already-dead intent');
assert.match(routeSrc, /await db\('pos_payments', \{ method:'POST'/, 'a freshly-minted intent must get its own pos_payments row, or the Stripe webhook (which looks payments up by stripe_payment_intent_id) could never mark the resumed sale fulfilled on success');

// ── Import wiring ───────────────────────────────────────────────────────
assert.match(worker, /import \{ handleAccountRequest, findLinkedCustomer \} from '\.\/scripts\/customer-account\.mjs';/, 'findLinkedCustomer must be imported from the same module the account tab already uses, not reimplemented');
assert.match(account, /export async function findLinkedCustomer\(db, storeId, userId\) \{/, 'findLinkedCustomer must be exported for the worker to import');

console.log('Storefront resume-payment route contract checks passed');

// ── Account orders API must surface real payment status ────────────────
// Bug: accountOrders() selected only id,total from pos_sales -- the
// customer-facing Orders tab had literally no field to know an order was
// stuck unpaid, so it rendered identically to a completed one.
const ordersFnStart = account.indexOf('async function accountOrders(request, env, deps, url) {');
assert(ordersFnStart >= 0, 'accountOrders must exist');
const ordersFnEnd = account.indexOf('\n}', account.indexOf('return deps.json({ ok:true, orders:withItems });', ordersFnStart));
const ordersFnSrc = account.slice(ordersFnStart, ordersFnEnd);
assert.match(ordersFnSrc, /select=id,total,status/, 'must fetch pos_sales.status, not just total');
assert.match(ordersFnSrc, /paymentStatus:sale\?\.status \|\| null,/, 'the API response must expose the real payment status per order');
assert.match(ordersFnSrc, /canResumePayment:sale\?\.status === 'pending',/, 'the API response must flag exactly which orders are actually resumable');

console.log('Account orders payment-status contract checks passed');

// ── Frontend: the Orders tab must actually render the stuck state and a
// working Pay Now action, not just have the data available unused. ──
const orderCardStart = storefront.indexOf('function orderCardHtml(o){');
const orderCardEnd = storefront.indexOf('\nasync function resumeOrderPayment', orderCardStart);
assert(orderCardEnd > orderCardStart, 'could not bound orderCardHtml source');
const orderCardSrc = storefront.slice(orderCardStart, orderCardEnd);
assert.match(orderCardSrc, /const pending=o\.canResumePayment===true;/, 'the order card must check the real canResumePayment flag from the API');
assert.match(orderCardSrc, /Payment not completed/, 'a stuck order must be visibly labeled, not look identical to a paid one');
assert.match(orderCardSrc, /onclick="resumeOrderPayment\('\$\{esc\(o\.id\)\}'\)"/, 'a stuck order must expose an actual Pay Now action wired to the real order id');

const resumeFnStart = storefront.indexOf('async function resumeOrderPayment(orderId){');
assert(resumeFnStart >= 0, 'resumeOrderPayment must exist');
const resumeFnEnd = storefront.indexOf('\n}', resumeFnStart);
const resumeFnSrc = storefront.slice(resumeFnStart, resumeFnEnd);
assert.match(resumeFnSrc, /\$\{WORKER\}\/public\/storefront\/resume/, 'must call the new resume route');
assert.match(resumeFnSrc, /Authorization:'Bearer '\+accountSession\.access_token/, 'the resume call must be authenticated the same way every other /public/account/* call already is');
assert.match(resumeFnSrc, /mountStripePayment\(data\);/, 'a successful resume must actually mount Stripe Elements with the returned clientSecret, reusing the same flow the original checkout uses -- not just report success with nothing to pay with');

console.log('Storefront Orders tab resume-payment UI checks passed');
