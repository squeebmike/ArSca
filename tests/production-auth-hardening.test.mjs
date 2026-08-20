import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const account = fs.readFileSync(new URL('../scripts/customer-account.mjs', import.meta.url), 'utf8');

assert.match(account, /crypto\.getRandomValues\(values\)/, 'phone verification codes must use Web Crypto');
assert.doesNotMatch(account, /Math\.random\(\) \* 900000/, 'phone verification codes must not use Math.random');
assert.match(worker, /Math\.abs\(Date\.now\(\) \/ 1000 - timestampSeconds\) > 300/, 'auth hook signatures must expire');
assert.match(worker, /status:503[\s\S]*Retry-After':'2'/, 'temporary email delivery failures must be retryable by Supabase');
assert.match(worker, /event:'auth_email_hook', status:'sent'/, 'auth-email delivery must emit a structured success log');
assert.match(worker, /url\.pathname === '\/public\/events'/, 'the homepage must have a read-only CMS event endpoint');
assert.match(worker, /collections\/\$\{WF_EVENTS\}\/items\/live\?limit=100/, 'the event endpoint must read published Webflow CMS records');
assert.match(worker, /'start-date-time'/, 'event start timestamps must remain precise');
assert.match(worker, /'video-orientation'/, 'event video orientation must be included');

console.log('Production auth hardening checks passed');
