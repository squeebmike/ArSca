import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMorningHealth, nextJobHealth, MORNING_HOUR } from '../scripts/morning-health.mjs';

// Store, 2026-11-01: "do the morning health summary". PriceCharting refused
// every price update for ~12 hours and nobody knew; this email says so.
const now = Date.parse('2026-11-02T15:17:00Z'); // 7:17 AM Pacific
const iso = ms => new Date(ms).toISOString();
const run = (h, r) => ({ started_at: iso(now - h * 3600000), result: { checked: 80, applied: 3, review: 1, coverPrice: 0, left: 100, ...r } });
const healthy = {
  now, storeName: 'The Mana Pocket', whatnotConnected: true,
  priceRuns: [run(1, { left: 0 }), run(2, {}), run(3, { coverPrice: 1 })],
  whatnotLast: { at: iso(now - 5 * 60000) }, whatnotRuns: [{ result: { orders: [{}, {}] } }],
  health: { ebay: { at: iso(now - 9 * 60000), ok: true }, pokemon: { at: iso(now - 3600000), ok: true, detail: { checked: 40 } } },
  payments: [{ provider: 'whatnot', amount: 20 }, { provider: 'whatnot', amount: 42.5 }, { provider: 'ebay', amount: 24.95 }, { method: 'cash', amount: 10 }],
  openWebOrders: 1, oldWebOrders: 0, reviewWaiting: 3, day: 'last 24 hours',
};
let m = buildMorningHealth(healthy);
assert.equal(m.subject, 'Morning check: All good -- The Mana Pocket');
assert.deepEqual(m.problems, []);
assert.match(m.body, /3 runs · 240 checked · 9 updated · 3 waiting for review · 1 given a cover-price default/);
assert.match(m.body, /0 still to check today/);
assert.match(m.body, /Whatnot: 2 · \$62\.50/);
assert.match(m.body, /eBay: 1 · \$24\.95/);
assert.match(m.body, /Total: \$97\.45/);
assert.match(m.body, /2 orders recorded by the sync/);
assert.match(m.body, /3 price changes waiting in PRICE SYNC/);

// The night PriceCharting refused, Whatnot stopped, eBay sign-in broke, an old order waits.
const refused = { stopReason: 'PriceCharting unavailable: Price provider temporarily paused (PriceCharting HTTP 429)', checked: 0, applied: 0, review: 0 };
m = buildMorningHealth({ ...healthy,
  priceRuns: [run(1, refused), run(2, refused), run(3, refused), run(4, {})],
  whatnotLast: { at: iso(now - 3 * 3600000) },
  health: { ...healthy.health, ebay: { at: iso(now - 60000), ok: false, error: 'eBay sign-in failed: token expired', failingSince: iso(now - 5 * 3600000) } },
  oldWebOrders: 1 });
assert.match(m.subject, /^Morning check: 4 things need a look/);
assert.match(m.body, /^NEEDS A LOOK/);
assert.ok(m.problems.some(p => /PriceCharting refused most comic\/sports price updates \(3 of 4 runs\): Price provider temporarily paused \(PriceCharting HTTP 429\)/.test(p)));
assert.ok(m.problems.some(p => /Whatnot sync last ran 3 h ago/.test(p)));
assert.ok(m.problems.some(p => /eBay sale checks: eBay sign-in failed: token expired/.test(p)));
assert.ok(m.problems.some(p => /1 paid website order over 2 days old/.test(p)));
// One refused run out of many isn't a problem, just a line.
m = buildMorningHealth({ ...healthy, priceRuns: [run(1, refused), run(2, {}), run(3, {}), run(4, {})] });
assert.deepEqual(m.problems, []);assert.match(m.body, /Stopped early on 1 of 4 runs/);
// No runs at all is.
assert.ok(buildMorningHealth({ ...healthy, priceRuns: [] }).problems.some(p => /did not run/.test(p)));

// Job notes: written on a change, else at most hourly.
let h = nextJobHealth(null, '', 1000);
assert.equal(h.write, true);assert.equal(h.value.ok, true);
let again = nextJobHealth(h.value, '', 1000 + 10 * 60000);
assert.equal(again.write, false, 'a check every 10 minutes is not written every time');
assert.equal(nextJobHealth(h.value, '', 1000 + 51 * 60000).write, true, 'but at least hourly');
const bad = nextJobHealth(h.value, 'boom', 1000 + 60000);
assert.equal(bad.write, true);assert.equal(bad.value.failingSince, iso(1000 + 60000));
assert.equal(nextJobHealth(bad.value, 'boom', 1000 + 120000).value.failingSince, bad.value.failingSince, 'failing since the first failure');
assert.equal(nextJobHealth(bad.value, '', 1000 + 180000).write, true, 'recovery is written at once');

// Wiring: after the hourly price runs, once a day at 7 AM Pacific, to the FOC email.
assert.equal(MORNING_HOUR, 7);
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /await Promise\.allSettled\(\[runScheduledPokemonServerSync\(env\)\]\); await Promise\.allSettled\(\[runScheduledMorningHealth\(env\)\]\); return; \}/);
assert.match(worker, /morning-health-sent:\$\{storeId\}:\$\{pacificToday\(new Date\(now\)\)\}/);
assert.match(worker, /finally \{ await noteJobHealth\(env, 'ebay:' \+ storeId, problem\); \}/);
assert.match(worker, /noteJobHealth\(env, 'pokemon:' \+ storeId/);
assert.match(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8'), /scripts\/morning-health\.mjs/);
console.log('Morning health summary: all-good, problems first, job notes and wiring checks passed');
