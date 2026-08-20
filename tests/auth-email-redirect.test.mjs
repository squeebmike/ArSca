import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');

assert.match(worker, /function supabaseEmailRedirectUrl\(action\)/, 'auth email redirects should be selected centrally');
assert.match(worker, /https:\/\/themanapocket\.com\/account-profile/, 'password recovery should open account settings');
assert.match(worker, /https:\/\/themanapocket\.com\/account/, 'signup confirmations should open account overview');
assert.match(worker, /redirect_to=\$\{encodeURIComponent\(supabaseEmailRedirectUrl\(action\)\)\}/, 'verification links should use the canonical customer redirect');

const hookStart = worker.indexOf('async function handleSupabaseEmailHook');
const hookEnd = worker.indexOf('\n// Picks the channel', hookStart);
const hook = worker.slice(hookStart, hookEnd);
assert.doesNotMatch(hook, /redirect_to \|\| site_url/, 'auth hook must not trust an obsolete Supabase Site URL');
assert.doesNotMatch(hook, /squeebmike\.github\.io/, 'customer auth email links must never target GitHub Pages');

console.log('auth email redirect tests passed');
