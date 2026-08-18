import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const sca = fs.readFileSync('sca.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const authSchema = fs.readFileSync('supabase/walkoff-auth-workspaces.sql', 'utf8');
const revokeMigration = fs.readFileSync('supabase-migrations/2026-08-20-revoke-self-signup-store-creation.sql', 'utf8');

// ── This app has no self-signup, no self-serve store creation, and no demo
// mode -- access is by invite only. Every assertion below either proves a
// removed surface is really gone (not just hidden), or proves the surfaces
// that should still work (login, password reset, invite acceptance) do. ──

// ── Contract: no signup surface anywhere in the app ──
for (const gone of ['signupSupabaseAccount', 'createSupabaseStore', "showAuthMode('signup')", "showAuthMode(\"signup\")"]) {
  assert.ok(!dashboard.includes(gone), `dashboard.html must not contain ${gone} -- self-signup must not exist in any form`);
}
assert.ok(!/>\s*SIGN UP\s*</i.test(dashboard), 'dashboard.html must not render a SIGN UP button anywhere');
assert.ok(!/sb\.auth\.signUp\(/.test(dashboard), 'dashboard.html must never call Supabase auth.signUp() -- that is the entire self-signup surface');

// ── Contract: no demo mode anywhere in dashboard.html ──
for (const gone of [
  'loginDemoAccount', 'WALKOFF_DEMO_STORES', 'WALKOFF_DEMO_USER',
  'DEMO_INVENTORY_SEED', 'seedDemoDataIfNeeded', 'repairDemoSessionIfNeeded',
  'showDemoModeBanner', 'hideDemoModeBanner', 'updateDataModeBanner',
  'populateLoginStores', 'demo-mode-banner', 'TRY DEMO', 'SWITCH TO DEMO MODE',
  'RESET DEMO DATA', 'REPAIR SESSION',
]) {
  assert.ok(!dashboard.includes(gone), `dashboard.html must not contain ${gone} -- demo mode must be fully removed, not just hidden`);
}

// ── Contract: the one thing that replaces demo-mode's old boot-time repair
// step is a purge, not a repair -- any leftover demoMode:true session (e.g.
// from before this change, or from sca.html's old inconsistent demo login)
// must be logged out, never silently continued ──
assert.match(dashboard, /function purgeLegacyDemoSessionIfNeeded\(\)\{/, 'missing purgeLegacyDemoSessionIfNeeded');
assert.match(dashboard, /if\(!session\?\.demoMode\) return false;/, 'purgeLegacyDemoSessionIfNeeded must no-op when there is no demo session to clear');
assert.match(dashboard, /localStorage\.removeItem\(WALKOFF_AUTH_SESSION_KEY\);/, 'purgeLegacyDemoSessionIfNeeded must clear the auth session, not repair it into a still-functioning demo store');
assert.match(dashboard, /purgeLegacyDemoSessionIfNeeded\(\);\s*\n\s*if\(!\(await ensureAuthReady\(\)\)\) return;/, 'purgeLegacyDemoSessionIfNeeded must run at boot, before ensureAuthReady touches any storeId');

// ── Contract: the login screen keeps LOGIN and RESET PASSWORD, and nothing
// else -- no way in except a real Supabase credential ──
assert.match(dashboard, /<button class="hbtn" id="auth-primary-btn" onclick="loginSupabaseAccount\(\)">LOGIN<\/button>/, 'the LOGIN button must still work');
assert.match(dashboard, /<button class="hbtn" onclick="showAuthMode\('reset'\)">RESET PASSWORD<\/button>/, 'the RESET PASSWORD button must still work');

// ── Contract: a Supabase user with no store membership and no pending
// invite lands on a dead-end "no access" screen -- not a self-serve store
// creation form ──
assert.match(dashboard, /showAuthMode\('no-access', 'Your account is not attached to a store yet\. Contact your store owner\/admin for an invite\.'\);/, 'a user with no store access must be shown a dead-end message, not a way to create their own store');
assert.match(dashboard, /mode === 'no-access' \? 'NO STORE ACCESS'/, "showAuthMode must handle the 'no-access' mode");
assert.match(dashboard, /primary\.style\.display = mode === 'no-access' \? 'none' : '';/, 'no-access mode must hide the primary action button entirely -- there is no action to take');

// ── Contract: password reset + recovery flow is untouched and still wired
// correctly (this was never actually broken -- see PHONE_SYSTEM_PLAN-style
// investigation; the missing-email bug is a Supabase project setting, not
// a code bug) ──
assert.match(dashboard, /async function resetSupabasePassword\(\)\{/, 'missing resetSupabasePassword');
assert.match(dashboard, /sb\.auth\.resetPasswordForEmail\(email, \{ redirectTo: AUTH_REDIRECT_URL \}\);/, 'resetSupabasePassword must call the real Supabase resetPasswordForEmail API');
assert.match(dashboard, /async function updateSupabasePassword\(\)\{/, 'missing updateSupabasePassword (the "set new password" landing flow)');
assert.match(dashboard, /async function handleAuthRecoveryRedirect\(\)\{/, 'missing handleAuthRecoveryRedirect');

console.log('dashboard.html auth-lockdown contract checks passed');

// ── Contract: sca.html's own (previously inconsistent) demo login is gone too ──
for (const gone of ['scannerDemoLogin', 'START DEMO SCANNER']) {
  assert.ok(!sca.includes(gone), `sca.html must not contain ${gone}`);
}
assert.match(sca, /Log in on the dashboard first\. Access is by invite only\./, 'sca.html must point locked-out visitors back to the real login, not offer a demo fallback');

console.log('sca.html demo-removal contract checks passed');

// ── Contract: the Pokemon Price Tracker paywall gate no longer treats a
// missing/blank X-Store-Id header as a free "demo" pass -- that was a real
// unauthenticated-access hole, not just a demo-mode leftover ──
assert.ok(!worker.includes("startsWith('demo')"), "cloudflare-worker-full.js must not contain any storeId.startsWith('demo') check -- demo mode does not exist as a concept the Worker should special-case");
assert.ok(!/isDemo2?\b/.test(worker), 'cloudflare-worker-full.js must not contain any isDemo/isDemo2 variable -- both Pokemon pricing paywall bypass checks must be gone');
assert.match(worker, /if \(!bypassIds2\.includes\(pptStoreId2\) && !ownerIds2\.includes\(pptStoreId2\) && env\.LBA_KV\) \{/, '/pricing/pokemon/export must gate on bypass/owner store ids only -- no demo/empty-storeId exemption');
assert.match(worker, /if \(!isBypassed && env\.LBA_KV\) \{\s*\n\s*const pptAuth = await requireStoreUser\(request, env, pptStoreId\);/, '/pricing/pokemonpricetracker/* must always run requireStoreUser when not bypassed -- a missing store id must fail closed via requireStoreUser, not skip auth entirely');

console.log('Worker paywall-bypass fix contract checks passed');

// ── Contract: the self-provisioning RPC is revoked from authenticated users,
// both in the live-database migration and in the schema source file (so a
// future re-application of the source file doesn't reopen the hole) ──
assert.match(revokeMigration, /revoke execute on function public\.create_store_for_current_user\(text, text\) from authenticated;/, 'missing the revoke statement for create_store_for_current_user');
assert.ok(!authSchema.includes('grant execute on function public.create_store_for_current_user(text, text) to authenticated;'), 'walkoff-auth-workspaces.sql must not re-grant create_store_for_current_user to authenticated -- that is the exact self-provisioning hole being closed');

// invite_store_member must still be properly gated (owner/admin of the
// TARGET store only) -- this is the one remaining way to grant access, so
// it must not be loosened by this change.
assert.match(authSchema, /create or replace function public\.invite_store_member\(/, 'missing invite_store_member');
assert.match(authSchema, /if not public\.can_manage_store\(target_store_id\) then\s*\n\s*raise exception 'Only owner\/admin can invite members';/, 'invite_store_member must still require the caller to already manage the target store');
assert.match(authSchema, /grant execute on function public\.invite_store_member\(uuid, text, public\.store_role\) to authenticated;/, 'invite_store_member must remain callable -- it is the only legitimate way to add someone to a store, and it self-gates via can_manage_store()');

console.log('Self-provisioning RPC lockdown contract checks passed');
