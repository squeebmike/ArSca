import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pptSourceLabel, pptRouteLabel, pptCreditsFrom, logPptUsage } from '../scripts/ppt-usage.mjs';
import { isServerSyncItem, serverSyncPrice, planRow, nextBatch, runPokemonServerSync, checkedToday, pacificHour } from '../scripts/pokemon-daily-sync.mjs';

// Store ask (2026-10-25): "any way we can see what's using credits and
// when?" and the daily price update should run on the server, not only when
// a dashboard happens to be open after 3 AM.
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../wrangler.deploy.jsonc', import.meta.url), 'utf8');
const deploy = readFileSync(new URL('../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase-migrations/2026-10-25-ppt-usage-log.sql', import.meta.url), 'utf8');

// ── credit log helpers ──
assert.equal(pptSourceLabel('tab:research'), 'tab:research');
assert.equal(pptSourceLabel('<script>'), 'script', 'odd characters stripped');
assert.equal(pptSourceLabel('', 'dashboard'), 'dashboard');
assert.equal(pptRouteLabel('/cards', { tcgPlayerId:'1', includeBoth:'true' }), 'cards:tcgPlayerId+ebay+history');
assert.equal(pptRouteLabel('/cards', { set:'Base', fetchAllInSet:'true' }), 'cards:set');
assert.equal(pptRouteLabel('/cards', { search:'pikachu' }), 'cards:search');
assert.equal(pptRouteLabel('/sealed-products', { tcgPlayerId:'9' }), 'sealed:tcgPlayerId');
assert.equal(pptRouteLabel('/sets', {}), 'sets');
assert.equal(pptCreditsFrom(new Headers({ 'X-API-Calls-Consumed':'7' }), 1, {}), 7, 'PPT header wins');
assert.equal(pptCreditsFrom(new Headers(), 2, { includeBoth:'true' }), 6, 'published rule: cards x (1 + history + eBay)');
assert.equal(pptCreditsFrom(new Headers(), 5, {}), 5);
assert.equal(await logPptUsage({}, { source:'x' }), false, 'no Supabase: nothing logged, nothing thrown');
{
  const realFetch = globalThis.fetch; let sent = null;
  globalThis.fetch = async (url, opts) => { sent = { url, body:JSON.parse(opts.body) }; return new Response(null, { status:201 }); };
  try {
    assert.equal(await logPptUsage({ SUPABASE_URL:'https://db.test/', SUPABASE_SERVICE_ROLE_KEY:'k' }, { storeId:'not-a-uuid', source:'daily-sync', route:'cards:tcgPlayerId', credits:3.2, cards:1, status:200 }), true);
    assert.equal(sent.url, 'https://db.test/rest/v1/ppt_usage_log');
    assert.deepEqual(sent.body, { store_id:null, source:'daily-sync', route:'cards:tcgPlayerId', credits:3, cards:1, status:200 });
    globalThis.fetch = async () => { throw new Error('down'); };
    assert.equal(await logPptUsage({ SUPABASE_URL:'https://db.test', SUPABASE_SERVICE_KEY:'k' }, { source:'x' }), false, 'a logging failure never throws');
  } finally { globalThis.fetch = realFetch; }
}

// Table: service role only, RLS on, 35-day cleanup; summary route for owners.
assert.match(migration, /-- grants: service_role only ppt_usage_log/);
assert.match(migration, /alter table public\.ppt_usage_log enable row level security;/);
assert.match(migration, /grant execute on function public\.ppt_usage_summary\(timestamptz, integer\) to service_role;/);
assert.ok(worker.includes("url.pathname === '/pricing/ppt-usage'") && worker.includes("rpc/ppt_usage_summary"), 'usage report route');
assert.ok(worker.includes("const hours = askedHours > 0 ? Math.min(24 * 30, Math.max(1, askedHours)) : 0;"), 'no ?hours: since the PPT reset, not the last hour');
assert.ok(worker.includes("pptSourceLabel(url.searchParams.get('ppt_src'), 'dashboard')"), 'proxy logs who asked');
assert.ok(worker.includes("source:'website:'+(path==='/sets'?'sets':'set-cards')") || readFileSync(new URL('../scripts/public-pokemon-sets.mjs', import.meta.url), 'utf8').includes("source:'website:'"), 'website pages log their calls');
assert.ok(/runScheduledPointsHoldSweep\(env\), runScheduledPptUsageCleanup\(env\)/.test(worker), 'cleanup is scheduled');
assert.ok(ui.includes("'ppt_src=' + encodeURIComponent(pptCallSource())"), 'dashboard tags every PPT call');
assert.ok(ui.includes("storeWorkerFetch('/pricing/ppt-usage'") && ui.includes('function loadPptUsageReport('), 'CREDIT USE report');
{
  const src = ui.slice(ui.indexOf('function pptCallSource('), ui.indexOf('function getAuthSession('));
  const make = (running, modalOpen, tab) => new Function('document', 'dailyPriceSyncRunning', src + '; return pptCallSource;')({
    getElementById: () => ({ classList:{ contains: () => modalOpen } }),
    querySelector: () => tab ? { id:'tab-' + tab } : null,
  }, running);
  assert.equal(make(true, true, 'research')(), 'daily-sync');
  assert.equal(make(false, true, 'research')(), 'price-sync');
  assert.equal(make(false, false, 'research')(), 'tab:research');
  assert.equal(make(false, false, '')(), 'dashboard');
}

// ── server daily sync ──
const NOW = Date.parse('2026-10-25T17:00:00Z'); // 10 AM Pacific
assert.equal(pacificHour(NOW), 10);
const card = (id, extra = {}) => ({ id:'r' + id, status:'in_stock', data:{ name:'Card ' + id, category:'Pokemon', tcgPlayerId:String(id), condition:'Near Mint', marketPrice:10, ...extra } });
assert.equal(isServerSyncItem(card(1)), true);
assert.equal(isServerSyncItem(card(1, { category:'Magic' })), false, 'Pokémon only');
assert.equal(isServerSyncItem(card(1, { tcgPlayerId:'' })), false, 'needs its exact product id');
assert.equal(isServerSyncItem(card(1, { name:'Charizard PSA 10' })), false, 'slabs stay on PriceCharting');
assert.equal(isServerSyncItem(card(1, { dropship:true })), false);
assert.equal(isServerSyncItem({ ...card(1), status:'sold' }), false);

assert.equal(serverSyncPrice({ marketPrice:12.345 }, {}), 12.35, 'NM: market price');
assert.equal(serverSyncPrice({ prices:{ variants:{ Normal:{ 'Lightly Played':{ price:8 } } } } }, { condition:'LP' }), 8, 'other conditions: the variant price');
assert.equal(serverSyncPrice({ prices:{ variants:{ 'Unlimited Holofoil':{ 'Near Mint':{ price:40 } }, '1st Edition Holofoil':{ 'Near Mint':{ price:400 } } } } }, { name:'Charizard', selectedPrinting:'1st Edition Holofoil' }), 400, 'WotC edition kept');
assert.equal(serverSyncPrice({ prices:{ variants:{ 'Unlimited Holofoil':{ 'Near Mint':{ price:40 } }, '1st Edition Holofoil':{ 'Near Mint':{ price:400 } } } } }, { name:'Charizard' }), 40, 'Unlimited by default');
assert.equal(serverSyncPrice({ unopenedPrice:150, marketPrice:2 }, { name:'Evolving Skies Booster Box' }), 150, 'sealed: unopened price');

const small = planRow(card(1, { priceRule:{ pct:10 } }), { marketPrice:10.5 }, NOW);
assert.equal(small.kind, 'applied', 'under 10%: saved');
assert.equal(small.data.marketPrice, 10.5);
assert.equal(small.data.salePrice, 12, 'list price follows the rule');
assert.equal(small.data.previousMarketPrice, 10);
assert.equal(small.data.priceSyncCheckedAt, new Date(NOW).toISOString());
const locked = planRow(card(1, { priceOverride:30, salePrice:30 }), { marketPrice:10.5 }, NOW);
assert.equal(locked.data.salePrice, 30, 'a locked price is kept');
const big = planRow(card(1), { marketPrice:15 }, NOW);
assert.equal(big.kind, 'review', '10% or more: waits for review');
assert.equal(big.data.marketPrice, 10, 'the price is not touched');
assert.equal(big.proposal.newPrice, 15);
assert.equal(big.proposal.deltaPct, 50);
assert.equal(planRow(card(1), { marketPrice:10 }, NOW).kind, 'unchanged');
assert.equal(planRow(card(1), null, NOW).kind, 'no-price');
assert.equal(planRow(card(1), null, NOW).data.priceSyncCheckedAt, new Date(NOW).toISOString(), 'no price still counts as checked');

const doneToday = card(2, { priceSyncCheckedAt:new Date(NOW - 3600e3).toISOString() });
const doneYesterday = card(3, { priceSyncCheckedAt:'2026-10-24T17:00:00Z' });
assert.equal(checkedToday(doneToday.data, NOW), true);
assert.deepEqual(nextBatch([doneToday, card(4), doneYesterday], NOW, 5).map(r => r.id), ['r4', 'r3'], 'never-checked first, skip today');
assert.equal(nextBatch(Array.from({ length:100 }, (_, i) => card(i + 10)), NOW).length, 60, 'one hourly batch');

function fakeDeps(rows, answer) {
  const patches = [], calls = [], kv = new Map();
  return { patches, calls, kv, deps:{
    db: async (path, opts) => { if (opts?.method === 'PATCH') { patches.push({ path, body:JSON.parse(opts.body) }); return { data:null }; } return { data:rows }; },
    ppt: async (path, params) => { calls.push({ path, params }); return answer(params); },
    kvGet: async k => kv.get(k) || null,
    kvPut: async (k, v) => { kv.set(k, v); },
  } };
}
{
  const before = fakeDeps([card(1)], () => ({ ok:true, status:200, card:{ marketPrice:11 } }));
  assert.deepEqual(await runPokemonServerSync('s1', before.deps, Date.parse('2026-10-25T09:00:00Z')), { skipped:'before 3 AM' });
  assert.equal(before.calls.length, 0);
}
{
  const rows = [card(1), card(2, { marketPrice:5 }), card(1, { name:'Card 1 second copy' }), card(5, { category:'Magic' })];
  rows[2].id = 'r1b';
  const f = fakeDeps(rows, p => ({ ok:true, status:200, card:{ marketPrice:p.tcgPlayerId === '1' ? 10.4 : 9 } }));
  const out = await runPokemonServerSync('s1', f.deps, NOW);
  assert.equal(f.calls.length, 2, 'one call per product, copies share it');
  assert.equal(f.calls[0].params.limit, '1');
  assert.ok(!('includeBoth' in f.calls[0].params) && !('includeEbay' in f.calls[0].params), 'one credit a card');
  assert.equal(out.checked, 3); assert.equal(out.applied, 2); assert.equal(out.review, 1);
  assert.equal(f.patches.length, 3, 'every checked row stamped');
  const queue = f.kv.get('price-sync-review:s1');
  assert.equal(queue.length, 1); assert.equal(queue[0].itemId, 'r2'); assert.equal(queue[0].newPrice, 9);
}
{
  const f = fakeDeps([card(1), card(2), card(3)], () => ({ ok:false, status:429 }));
  const out = await runPokemonServerSync('s1', f.deps, NOW);
  assert.equal(f.calls.length, 1, 'out of credits: stop, try next hour');
  assert.equal(f.patches.length, 0, 'nothing stamped, so they are retried');
  assert.equal(out.failed, 1);
}

// Wiring: hourly trigger, review hand-off, dashboard skip.
assert.match(wrangler, /"17 \* \* \* \*"/, 'hourly trigger');
assert.ok(worker.includes("const POKEMON_SYNC_CRON = '17 * * * *';") && worker.includes('if (event?.cron === POKEMON_SYNC_CRON) { ctx.waitUntil(runScheduledPokemonServerSync(env)); return; }'), 'hourly trigger runs only the sync');
assert.ok(worker.includes("source: 'server-daily-sync'"), 'server calls are logged');
assert.ok(worker.includes("url.pathname === '/price-sync/review'"), 'review queue route');
assert.ok(deploy.includes('scripts/ppt-usage.mjs') && deploy.includes('scripts/pokemon-daily-sync.mjs'), 'deploys on change');
assert.ok(ui.includes('if(dailyPriceSyncRunning) items = items.filter(i => !serverPriceCheckedToday(i));'), 'dashboard daily run skips server-checked cards');
assert.ok(ui.includes("storeWorkerFetch('/price-sync/review'"), 'server review queue shown in PRICE SYNC');

console.log('pokemon server sync + credit log tests passed');
