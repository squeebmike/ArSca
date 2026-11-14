// MTG CHART: JustTCG history only when CHART is tapped, one call per card + range, cached 12 hours.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const app = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const a = app.indexOf("const MTG_CHART_CACHE_KEY = 'mtg_chart_history_v1'"), b = app.indexOf('function closeQplChartModal(){');
const store = {}; let calls = 0;
const ctx = {
  localStorage:{ getItem:k => store[k] ?? null, setItem:(k, v) => { store[k] = String(v); } }, navigator:{ onLine:true }, WORKER:'W', URLSearchParams, Map, Date, JSON, Number, String, Object, Array, Math,
  getActiveStoreId:() => 's1', qplFinishLabel:v => v, mtgFinishPriceFamily:f => f === 'normal' ? 'normal' : f === 'etched_foil' ? 'etched_foil' : 'foil',
  storeWorkerFetch:async url => { calls++; ctx.lastUrl = url; return { ok:true, json:async () => ({ matches:[{ availableVariants:[
    { condition:'NM', finishName:'Normal', priceHistory:[{ p:1.2, t:1730000000 }, { p:1.4, t:1730600000 }] },
    { condition:'LP', finishName:'Normal', priceHistory:[{ p:0.9, t:1730000000 }] },
    { condition:'NM', finishName:'Foil', priceHistory:[{ p:5, t:1730000000 }, { p:6, t:1730600000 }] } ] }] }) }; },
};
vm.createContext(ctx); vm.runInContext(app.slice(a, b) + ';globalThis.f=fetchMtgChartHistory;', ctx);
const card = { tcgplayerId:'123', selectedFinish:'normal' };
const pts = await ctx.f(card, '90d');
assert.equal(calls, 1); assert.match(ctx.lastUrl, /^W\/pricing\/justtcg\/tcgplayer\/123\?priceHistoryDuration=90d/);
assert.deepEqual(JSON.parse(JSON.stringify(pts)), [{ date:'2024-10-27', price:1.2 }, { date:'2024-11-03', price:1.4 }], 'NM regular points, JustTCG {p,t} read');
const foil = await ctx.f({ tcgplayerId:'123', selectedFinish:'foil' }, '90d');
assert.equal(calls, 1, 'the foil chart reuses the same call'); assert.equal(foil[1].price, 6);
await ctx.f(card, '30d'); assert.equal(calls, 2, 'a new range is a new call');
assert.equal(await ctx.f({ selectedFinish:'normal' }, '90d'), null, 'no TCGplayer id -> no call'); assert.equal(calls, 2);
assert.ok(app.includes("const points = await fetchMtgChartHistory(r, r.graphDuration).catch(e =>"), 'CHART on an MTG card asks for the history');
const miss = { tcgplayerId:'123', selectedFinish:'etched_foil' };
assert.equal(await ctx.f(miss, '90d'), null); assert.match(miss._mtgChartMiss, /no etched_foil Near Mint history/i, 'says why there is no chart');
console.log('MTG chart on tap: passed');
// The phone's PriceCharting rows refresh by themselves weekly (no full rebuild), read through pcVersionOf().
{
  const b = readFileSync(new URL('../scripts/mtg/mtg-offline-browser.js', import.meta.url), 'utf8');
  assert.ok(b.includes('const PC_REFRESH_MS=7*86400000;') && b.includes("const target=`pc::${String(pd.sha256).slice(0,16)}`;"));
  assert.equal((b.match(/refreshPriceChartingIfStale\(workerBase,manifest,onProgress\)/g) || []).length, 3, 'defined once, both fast-sync exits check PriceCharting');
  assert.ok(b.includes('linkStore.get([pcVersion,') && b.includes('priceStore.get([pcVersion,') && b.includes('version=pcVersionOf(active);if(!version)return[];'));
  console.log('PriceCharting weekly refresh wiring: passed');
}
