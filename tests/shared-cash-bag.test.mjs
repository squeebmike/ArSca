import assert from 'node:assert/strict';
import fs from 'node:fs';
// Store, 2026-11-08: the show's Cash Bag was opened on the other login, so on
// this phone a trade's $50 cash back and four cash sales never reached it.
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const grab = sig => { const i = app.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = app.indexOf('){', i) + 1; for (; j < app.length; j++) { if (app[j] === '{') d++; else if (app[j] === '}' && !--d) break; } return app.slice(i, j + 1); };

// Which bag: this show's, else the only open one (last 16 h); never a guess.
const make = (rows, { show = null, local = null } = {}) => {
  const calls = [];
  const sb = { from: () => { const q = { select: () => q, eq: (k, v) => (calls.push([k, v]), q), gte: (k, v) => (calls.push([k, v]), q), order: () => q, limit: async () => ({ data: rows, error: null }) }; return q; } };
  const f = new Function('getSupabaseClient', 'getShowMode', 'getActiveStoreId', 'getAccountContext', 'drawerState',
    'let sharedOpenBag = null;\n' + grab('async function refreshSharedOpenBag(') + '\nreturn refreshSharedOpenBag;')(() => sb, () => show, () => 'store', () => ({}), local);
  return { f, calls };
};
const a = { id: 'bag-a', show_session_id: 'show-1' }, b = { id: 'bag-b', show_session_id: 'show-2' };
assert.equal((await make([a]).f())?.id, 'bag-a', 'the only open bag');
assert.equal(await make([a, b]).f(), null, 'two open bags and no show: no guess');
assert.equal((await make([a, b], { show: { id: 'show-2' } }).f())?.id, 'bag-b', "this device's show's bag");
assert.equal(await make([a], { local: { id: 'mine' } }).f(), null, 'a device in its own bag keeps it');
const { f, calls } = make([a]); await f();
assert.deepEqual(calls.find(c => c[0] === 'status'), ['status', 'open']);
assert.equal(calls.find(c => c[0] === 'opened_at')[0], 'opened_at', 'only recently opened bags');

// Sales and payouts use it.
assert.match(app, /drawer_session_id:drawerState\?\.id \|\| sharedOpenBag\?\.id \|\| null,/);
assert.match(app, /show_session_id:getShowSessionId\(getShowMode\(\)\) \|\| \(!drawerState && sharedOpenBag \? sharedOpenBag\.show_session_id \|\| null : null\),/);
assert.match(app, /if\(!drawerState\)\{ payoutToSharedBagWithToast\(amount, 'trade_in_cash_payout',/);
assert.match(app, /payoutToSharedBagWithToast\(Number\(session\.cashOfferTotal \|\| 0\), 'cash_buy_payout',/);
assert.match(app, /const bag = await refreshSharedOpenBag\(\);\n  if\(!bag\) return null;/);
console.log('Shared Cash Bag: payouts and cash sales reach the open bag from any device passed');
