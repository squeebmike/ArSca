import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const module = fs.readFileSync('scripts/fan-club.mjs', 'utf8');

// ── Wired into the main router ──────────────────────────────────────
assert.match(worker, /import \{ handleFanClubRequest \} from '\.\/scripts\/fan-club\.mjs';/, 'missing fan-club module import');
assert.match(worker, /if \(url\.pathname\.startsWith\('\/public\/fan-club\/'\)\) \{/, 'missing /public/fan-club/ route');
assert.match(worker, /return await handleFanClubRequest\(request, env, url, \{/, 'route must call handleFanClubRequest');

// ── Subscribe: validated, rate-limited, no payment involved ────────
assert.match(module, /async function subscribe\(request, env, deps\) \{/, 'missing subscribe handler');
assert.match(module, /const EMAIL_RE = \/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$\/;/, 'missing email format validation');
assert.match(module, /if \(!storeId \|\| !EMAIL_RE\.test\(email\)\) return deps\.json\(\{ ok:false, error:'Enter a valid email address\.' \}, 400\);/, 'subscribe must reject missing/invalid email');
assert.match(module, /const rateError = await deps\.enforceUsageLimit\(env, `fan-club-subscribe:\$\{storeId\}`, 50, 3600\);/, 'subscribe must be rate-limited to prevent signup-form abuse');
assert.doesNotMatch(module, /amountCents|priceCents|Stripe|stripeApi|paymentIntent/i, 'this is a free notify list -- no payment amount or Stripe integration should be involved');

// ── Re-subscribing after an opt-out clears the flag instead of erroring ─
assert.match(module, /if \(existing\[0\]\.unsubscribed\) \{/, 'subscribe must handle a former unsubscriber signing up again');
assert.match(module, /unsubscribed:false, unsubscribed_at:null, subscribed_at:new Date\(\)\.toISOString\(\)/, 'resubscribing must clear the unsubscribed flag');

// ── CAN-SPAM: every subscriber gets a real, working unsubscribe link ───
assert.match(module, /async function unsubscribe\(request, env, deps, url\) \{/, 'missing unsubscribe handler');
assert.match(module, /fan_club_subscribers\?unsubscribe_token=eq\.\$\{encodeURIComponent\(token\)\}&limit=1/, 'unsubscribe must look the subscriber up by their unique token');
assert.match(module, /unsubscribed:true, unsubscribed_at:new Date\(\)\.toISOString\(\)/, 'unsubscribe must actually flip the unsubscribed flag');
assert.match(module, /if \(path === '\/public\/fan-club\/unsubscribe' && request\.method === 'GET'\) return unsubscribe/, 'unsubscribe must be reachable via a plain GET link (no auth, no JS) so it works from any email client');

console.log('Fan club subscribe/unsubscribe contract checks passed');
