import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Store ask: "Added prepaid credits after hitting the daily limit -- PPT still
// not working, need it now." Running out paused PokemonPriceTracker for an
// hour in the worker and another hour on each device, so new credits sat
// unused. Now both pause 5 minutes, then ask PPT again.
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');

assert.ok(worker.includes("await env.LBA_KV.put('ppt_daily_quota_exhausted_until_v3', String(Date.now() + 5 * 60 * 1000), { expirationTtl: 5 * 60 });"), 'worker pauses 5 minutes');
assert.ok(worker.includes("env.LBA_KV.get('ppt_daily_quota_exhausted_until_v3')"), 'reads the new key');
assert.ok(!worker.includes('ppt_daily_quota_exhausted_until_v2'), 'the hour-long lock already set is ignored');

const src = ui.slice(ui.indexOf('function pptQuotaPauseUntil('), ui.indexOf('function migratePokemonPriceTrackerQuotaState('));
const pauseUntil = new Function(src + '; return pptQuotaPauseUntil;')();
const now = Date.now();
const def = pauseUntil({});
assert.ok(def - now >= 5 * 60 * 1000 - 50 && def - now <= 5 * 60 * 1000 + 1000, 'no retry time: 5 minutes');
const at = new Date(now + 3 * 60 * 1000).toISOString();
assert.equal(pauseUntil({ retryAt: at }), Date.parse(at), 'follows the worker');
assert.ok(pauseUntil({ retryAt: new Date(now + 5 * 3600 * 1000).toISOString() }) <= Date.now() + 3600 * 1000, 'never more than an hour');
assert.ok(pauseUntil({ retryAt: new Date(now - 1000).toISOString() }) > now, 'a past retry time still pauses briefly');

assert.equal((ui.match(/localStorage\.setItem\('ppt_quota_exhausted_until', String\(pptQuotaPauseUntil\(data\)\)\);/g) || []).length, 4, 'every out-of-credits path');
assert.ok(!ui.includes("localStorage.setItem('ppt_quota_exhausted_until', String(Date.now() + 60 * 60 * 1000));"), 'no hour-long device pause left');
assert.ok(ui.includes("if(localStorage.getItem('ppt_quota_state_version') !== '4') {") && ui.includes("localStorage.setItem('ppt_quota_state_version', '4');"), 'old device pauses cleared once on load');
console.log('PPT short quota pause passed');
