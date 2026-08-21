import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');

assert.match(worker, /function supabaseEmailRedirectUrl\(action, requestedRedirectTo\)/, 'auth email redirects should be selected centrally');
assert.match(worker, /https:\/\/themanapocket\.com\/account-profile/, 'password recovery should open account settings');
assert.match(worker, /https:\/\/themanapocket\.com\/account/, 'signup confirmations should open account overview');
assert.match(worker, /redirect_to=\$\{encodeURIComponent\(supabaseEmailRedirectUrl\(action, data\.redirect_to\)\)\}/, 'verification links should use the centrally-selected redirect, passing through what the caller actually requested');

const hookStart = worker.indexOf('async function handleSupabaseEmailHook');
const hookEnd = worker.indexOf('\n// Picks the channel', hookStart);
const hook = worker.slice(hookStart, hookEnd);
assert.doesNotMatch(hook, /redirect_to \|\| site_url/, 'auth hook must not trust an obsolete Supabase Site URL');

// Dashboard staff logins and storefront customer accounts share one
// Supabase Auth project, so this same hook fires for both -- the dashboard's
// own RESET PASSWORD button (resetSupabasePassword() in dashboard.html)
// passes an explicit redirectTo of its GitHub Pages URL, which Auth Hooks
// echo back as email_data.redirect_to. That must be trusted (recovery links
// need to land back in the dashboard's update-password screen, not the
// storefront's customer account page), but only because it's checked against
// an explicit allowlist -- not because any caller-supplied redirect_to is
// trusted blindly.
const redirectFnStart = worker.indexOf('function supabaseEmailRedirectUrl(action, requestedRedirectTo)');
const redirectFnEnd = worker.indexOf('\nasync function handleSupabaseEmailHook', redirectFnStart);
const redirectFn = worker.slice(redirectFnStart, redirectFnEnd);
assert.match(redirectFn, /TRUSTED_EMAIL_REDIRECT_ORIGINS/, 'requestedRedirectTo must be checked against an explicit allowlist, not trusted unconditionally');
assert.match(worker, /TRUSTED_EMAIL_REDIRECT_ORIGINS\s*=\s*\[['"]https:\/\/themanapocket\.com['"],\s*['"]https:\/\/squeebmike\.github\.io['"]\]/, 'allowlist must cover both the customer storefront and the staff dashboard origins');

console.log('auth email redirect tests passed');
