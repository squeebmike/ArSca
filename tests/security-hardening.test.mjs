import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const scanner = readFileSync(new URL('../sca.html', import.meta.url), 'utf8');
const deployWorkflow = readFileSync(new URL('../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');

function route(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing route marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing route boundary: ${end}`);
  return source.slice(from, to);
}

const cart = route(worker, "if (url.pathname === '/cart')", "if (url.pathname.startsWith('/kv/'))");
assert.match(cart, /requireStoreUser\(request, env, storeId\)/);
assert.match(cart, /pos_cart:\$\{safeStoreKey\(storeId\)\}:\$\{registerId\}/);

const invites = route(worker, "if (url.pathname === '/store/invites'", '// Public, read-only storefront');
assert.match(invites, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/);
assert.match(invites, /store_invites\?store_id=eq/);
assert.match(dashboard, /storeWorkerFetch\('\/store\/invites\?store_id='/);
assert.match(invites, /url\.pathname === '\/store\/invites\/send' && request\.method === 'POST'/);
assert.match(invites, /\/auth\/v1\/invite\?redirect_to=/);
assert.match(invites, /\/auth\/v1\/otp\?redirect_to=/);
assert.match(invites, /enforceUsageLimit\(env, `store-invite:/);
assert.match(dashboard, /storeWorkerFetch\('\/store\/invites\/send'/);
assert.match(dashboard, /Invite saved, but email was not sent:/);

const kv = route(worker, "if (url.pathname.startsWith('/kv/'))", "if (url.pathname === '/offline/cache/manifest')");
assert.match(kv, /requireStoreUser\(request, env, storeId\)/);
assert.match(kv, /lba:\$\{safeStoreKey\(storeId\)\}:\$\{key\}/);
assert.match(kv, /KV payload is too large/);
assert.match(deployWorkflow, /anonymous kv write rejected[\s\S]*res\.status === 401 \|\| res\.status === 403/);

const anthropic = route(worker, "if (url.pathname === '/anthropic/messages')", "if (url.pathname === '/upload-image')");
assert.match(anthropic, /requireStoreUser\(request, env, storeId\)/);
assert.match(anthropic, /readJsonWithLimit\(request, 6 \* 1024 \* 1024\)/);
assert.match(anthropic, /enforceUsageLimit/);
assert.match(anthropic, /allowedModels/);

const upload = route(worker, "if (url.pathname === '/upload-image')", "if (url.pathname === '/pos/checkout')");
assert.match(upload, /requireStoreUser\(request, env, storeId\)/);
assert.match(upload, /Unsupported image type/);
assert.match(upload, /enforceUsageLimit/);

const checkout = route(worker, "if (url.pathname === '/pos/checkout')", 'SportsCardsPro: card image lookup');
assert.match(checkout, /requireStoreUser\(request, env, storeId\)/);
assert.match(checkout, /idempotencyKey/);
assert.match(checkout, /const collectionId = WF_PRODUCTS/);
assert.doesNotMatch(checkout, /item\.collectionId/);

const proxy = route(worker, "if (url.pathname.startsWith('/proxy/'))", "if (url.pathname === '/ebay/status')");
assert.match(proxy, /requireStoreUser\(request, env, storeId, allowedRoles\)/);
assert.match(proxy, /\['owner','admin'\]/);

for (const marker of ["'/ebay/status'", "'/ebay/auth-url'", "'/ebay/list'"]) {
  const from = worker.indexOf(`if (url.pathname === ${marker})`);
  assert.notEqual(from, -1, `missing ${marker}`);
  assert.match(worker.slice(from, from + 900), /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/);
}
assert.match(worker, /Missing secure OAuth state/);

for (const marker of ["'/subscription/init-trial'", "'/subscription/checkout'", "'/subscription/customer-portal'"]) {
  const from = worker.indexOf(`if (url.pathname === ${marker}`);
  assert.notEqual(from, -1, `missing ${marker}`);
  assert.match(worker.slice(from, from + 900), /requireStoreUser\(request, env, store_id, \['owner','admin'\]\)/);
}
const subscriptionStatus = route(worker, "if (url.pathname === '/subscription/status'", "if (url.pathname === '/subscription/checkout'");
assert.match(subscriptionStatus, /requireStoreUser\(request, env, storeId\)/);
assert.doesNotMatch(subscriptionStatus, /stripe_customer_id:/);

const legacyPaymentIntent = route(worker, "if (url.pathname === '/stripe/create-payment-intent')", 'JustTCG pricing proxy');
assert.match(legacyPaymentIntent, /requireStoreUser\(request, env, storeId\)/);

const sets = route(worker, "if (url.pathname.startsWith('/sets'))", "return json({ error: 'Not found'",);
assert.match(sets, /if \(!token\) return false/);
assert.match(sets, /secureSecretEqual/);
const textImport = route(sets, "if (url.pathname === '/sets/import-topps-text'", "if (url.pathname === '/sets/import'");
assert.match(textImport, /if \(!await requireAdmin\(\)\)/);

assert.match(dashboard, /async function storeWorkerFetch/);
assert.match(dashboard, /headers\.set\('Authorization', 'Bearer ' \+ session\.access_token\)/);
assert.match(dashboard, /escHtml\(x\.name\|\|'Customer'\)/);
assert.match(dashboard, /escHtml\(x\.contact\|\|''\)/);
assert.match(dashboard, /escHtml\(x\.notes\|\|''\)/);
assert.match(dashboard, /escHtml\(r\[h\]\)/);
assert.doesNotMatch(dashboard, /fetch\([^\n]*(?:WORKER|WORKER_URL)[^\n]*(?:\/proxy\/|\/cart|\/kv\/|\/pos\/checkout|\/upload-image|\/anthropic\/messages|\/ebay\/list|\/subscription\/customer-portal)/);

assert.match(scanner, /async function scannerWorkerFetch/);
assert.match(scanner, /headers\.set\('Authorization', 'Bearer ' \+ session\.access_token\)/);
assert.doesNotMatch(scanner, /fetch\([^\n]*(?:WORKER|WORKER_URL)[^\n]*(?:\/proxy\/|\/cart|\/kv\/|\/pos\/checkout|\/upload-image|\/anthropic\/messages|\/ebay\/list)/);

console.log('Security hardening contract checks passed');
