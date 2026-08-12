import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-08-16-consignor-stripe-payouts.sql', 'utf8');

// ── Migration ────────────────────────────────────────────────────────
assert.match(migration, /alter table public\.consignor_people add column if not exists stripe_account_id text;/, 'missing consignor_people.stripe_account_id');
assert.match(migration, /alter table public\.consignor_people add column if not exists stripe_onboarding_status text not null default 'not_started';/, 'missing consignor_people.stripe_onboarding_status');
assert.match(migration, /alter table public\.consignor_people add column if not exists stripe_transfers_enabled boolean not null default false;/, 'missing consignor_people.stripe_transfers_enabled');
assert.match(migration, /alter table public\.consignment_items add column if not exists stripe_transfer_id text;/, 'missing consignment_items.stripe_transfer_id');
assert.match(migration, /alter table public\.consignment_items add column if not exists paid_via text;/, 'missing consignment_items.paid_via');

console.log('Consignor Stripe payout migration checks passed');

// ── Worker: routes exist, gated owner/admin (money-moving) ────────────
for (const path of ['/stripe/connect/consignor-account', '/stripe/connect/consignor-onboarding-link', '/stripe/connect/consignor-payout']) {
  assert.match(worker, new RegExp(`if \\(path === '${path.replace(/\//g, '\\/')}'\\) \\{`), `missing worker route ${path}`);
}
// All three start with /stripe/connect/, which the shared ownerOnly gate already covers -- confirm that gate exists and covers this prefix.
assert.match(worker, /const ownerOnly = path\.startsWith\('\/stripe\/connect\/'\) \|\| path === '\/stripe\/refunds\/create';/, 'consignor Stripe routes must be covered by the existing owner/admin-only gate for /stripe/connect/*');

console.log('Consignor Stripe payout route registration checks passed');

// ── Worker: payout route safety properties ─────────────────────────────
// Idempotency key derived from the item id ALONE (not a per-attempt counter)
// so a double-click or retried request can never double-pay the same item.
assert.match(worker, /idempotencyKey:`arsca-consignor-payout-\$\{itemId\}`/, 'payout idempotency key must be derived from the item id alone, so retries cannot double-pay');
// Must refuse to pay an item that isn't actually sold yet.
assert.match(worker, /if\(item\.status!=='sold'\|\|item\.sale_price==null\)return json\(\{ok:false,error:'This item has not been recorded as sold yet'\},409\);/, 'payout must refuse items not marked sold');
// Must refuse to pay an already-paid item.
assert.match(worker, /if\(item\.paid_out\)return json\(\{ok:false,error:'This item has already been paid out'\},409\);/, 'payout must refuse to re-pay an already-paid-out item');
// Must refuse when the consignor has no connected account.
assert.match(worker, /if\(!consignor\?\.stripe_account_id\)return json\(\{ok:false,error:'This consignor has not connected Stripe yet'\},409\);/, 'payout must refuse when the consignor has not connected Stripe');
// Must refuse when the store's own Stripe account cannot send money.
assert.match(worker, /if\(!storeRow\?\.connected_account_id\|\|!storeRow\.charges_enabled\)return json\(\{ok:false,error:'Store Stripe account is not ready to send payouts'\},409\);/, 'payout must refuse when the store Stripe account is not ready');
// Must refuse a zero/negative payout rather than send a bogus transfer.
assert.match(worker, /if\(cents<=0\)return json\(\{ok:false,error:'Nothing owed to this consignor on this item'\},409\);/, 'payout must refuse a non-positive amount');
// The transfer must be created AS the store's connected account (Stripe-Account
// header = store's account id) so the store's OWN balance is debited, not the
// platform's -- money from a direct-charge POS sale lands in the store's
// connected account, not the platform account.
assert.match(worker, /account:storeRow\.connected_account_id,idempotencyKey:`arsca-consignor-payout-\$\{itemId\}`,params:new URLSearchParams\(\{amount:String\(cents\),currency:'usd',destination:consignor\.stripe_account_id,/, 'transfer must be created acting as the store account, moving money to the consignor account');

console.log('Consignor Stripe payout safety-property checks passed');

// ── Functional check: safeConsignorStripeAccount ────────────────────
{
  const src = worker.match(/function safeConsignorStripeAccount\(account, mode\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'could not extract safeConsignorStripeAccount for functional testing');
  const { safeConsignorStripeAccount } = new Function(`${src}\nreturn { safeConsignorStripeAccount };`)();

  const noAccount = safeConsignorStripeAccount(null, 'test');
  assert.equal(noAccount.transfersEnabled, false, 'a null account must not be treated as transfer-ready');
  assert.equal(noAccount.onboardingStatus, 'incomplete', 'a null account must be incomplete, not restricted or ready');

  const pending = safeConsignorStripeAccount({ id:'acct_1', details_submitted:true, capabilities:{ transfers:'pending' } }, 'test');
  assert.equal(pending.transfersEnabled, false, 'a pending (not active) transfers capability must not count as enabled');
  assert.equal(pending.onboardingStatus, 'restricted', 'details submitted but capability not active must be restricted, not ready');

  const ready = safeConsignorStripeAccount({ id:'acct_1', details_submitted:true, capabilities:{ transfers:'active' } }, 'test');
  assert.equal(ready.transfersEnabled, true, 'an active transfers capability must count as enabled');
  assert.equal(ready.onboardingStatus, 'ready', 'an active transfers capability must be ready');
  assert.equal(ready.stripeConnectedAccountId, 'acct_1', 'must carry through the connected account id');
}

console.log('safeConsignorStripeAccount functional checks passed');

// ── Dashboard: consignor onboarding + payout wiring ──────────────────
for (const fn of ['payConsignorViaStripe', 'connectConsignorStripe']) {
  assert.match(dashboard, new RegExp(`async function ${fn}\\(`), `missing ${fn}`);
}
// Both money-affecting actions must be owner/admin gated on the client too
// (defense in depth -- the server gate is the real one, but a staff-visible
// button that immediately 403s is a bad experience and a tell that the gate
// was forgotten somewhere).
assert.match(dashboard, /async function payConsignorViaStripe\(id\)\{\s*\n\s*if\(!requireOwnerAdmin\(\)\) return;/, 'payConsignorViaStripe must be owner/admin gated client-side');
assert.match(dashboard, /async function connectConsignorStripe\(personId\)\{\s*\n\s*if\(!requireOwnerAdmin\(\)\) return;/, 'connectConsignorStripe must be owner/admin gated client-side');
// A real transfer is irreversible from this app -- must require explicit confirmation.
assert.match(dashboard, /if\(!confirm\(`Pay \$\{c\.owner\} via Stripe for "\$\{c\.item\}"\? This sends a real bank transfer through Stripe and cannot be undone from here\.`\)\) return;/, 'paying a consignor via Stripe must require explicit confirmation, it cannot be undone from this app');

// The payout button must only appear for sold+unpaid items whose consignor
// has actually completed Stripe onboarding -- never offered as a dead end.
assert.match(dashboard, /const stripeReadyOwners = new Set\(consignmentOwnerDirectory\(\)\.filter\(p => p\.stripeOnboardingStatus === 'ready' && p\.stripeTransfersEnabled\)\.map\(p => p\.name\.toLowerCase\(\)\)\);/, 'must compute which consignors are actually ready for a Stripe payout before offering the button');
assert.match(dashboard, /c\.status==='sold'&&!c\.paidOut&&stripeReadyOwners\.has\(String\(c\.owner\|\|''\)\.toLowerCase\(\)\)\?`<button class="ra"[\s\S]{0,200}onclick="payConsignorViaStripe\('\$\{c\.id\}'\)">/, 'the Pay via Stripe button must only render for sold, unpaid items whose consignor is Stripe-ready');

// Cloud round-trip: fields written by the Worker must actually be read back
// into the dashboard's local state, or the UI can never show "ready".
assert.match(dashboard, /stripeAccountId:p\.stripe_account_id\|\|'',stripeOnboardingStatus:p\.stripe_onboarding_status\|\|'not_started',stripeTransfersEnabled:!!p\.stripe_transfers_enabled/, 'consignor Stripe status must be read back from Supabase into local state (consignPersonFromCloud)');
assert.match(dashboard, /stripeTransferId:c\.stripe_transfer_id\|\|'',paidVia:c\.paid_via\|\|''/, 'consignment item Stripe payout record must be read back from Supabase into local state (consignItemFromCloud)');

console.log('Consignor Stripe payout dashboard wiring checks passed');
