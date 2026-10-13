import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Store ask: "a buy it or not thing within the research tab ... explains
// why it's a buy or pass, and then a quick buy or not next to prices. Can
// it help us not buy bad cards?" Dealer rules: don't buy a spike, price a
// card that's still falling for where it's heading, pay less for slow or
// jumpy sellers and things already in stock, pass on thin margins.
const S = createRequire(import.meta.url)('../scripts/buy-signal.js');
const DAY = 86400000, END = Date.UTC(2026, 9, 8);
const series = (fn, vol = 5, days = 90) => Array.from({ length:days }, (_, i) => ({ date:new Date(END - (days - 1 - i) * DAY).toISOString(), price:+fn(i).toFixed(2), volume:typeof vol === 'function' ? vol(i) : vol }));
const run = (points, extra = {}) => S.evaluateBuySignal({ points, category:'Pokemon', ...extra });
// Target = expected resale - fees (3% in-store card fees) - margin by speed:
// 20% liquid Pokemon, 25% other fast, 35% average, 45% slow/jumpy, +5% when
// stocked, never under $3 profit; open at 88% of the walk-away price; trade
// credit up to min(80% of resale on Pokemon, walk-away x 1.15).

// Still falling (the post's Venusaur): valued as if it keeps sliding at half last month's pace.
{
  const s = run(series(i => i < 60 ? 120 : 120 - (i - 60)));
  assert.equal(s.verdict, 'BUY_LOW');
  assert.deepEqual(s.flags, ['falling', 'fast']);
  assert.equal(s.resale, 80); // $91 less another 12%
  assert.equal(s.maxPrice, 62); assert.equal(s.openPrice, 54.5); assert.equal(s.tradeMax, 64);
  assert.equal(s.label, 'BUY LOW · ≤ $62.00');
  assert.deepEqual(s.math, [
    "Resale: $91.00 less another 12% -- still falling, so valued as if it keeps sliding at half last month's pace",
    'After 3% card fees: $77.60',
    'Keep 20% (sells fast, liquid Pokémon): walk away above $62.00',
    'Open at $54.50 · trade credit up to $64.00 (80% of resale)',
  ]);
  assert.match(s.reasons[0].text, /^Down 24\.2% in 30 days and set a new 30-day low today -- still falling/);
}
// Fall that stalled (the post's Psyduck): a plain BUY at the liquid-Pokemon margin.
{
  const s = run(series(i => i < 60 ? 68 : i < 75 ? 68 - (i - 60) * 0.73 : 57.2 + (i - 75) * 0.07));
  assert.equal(s.verdict, 'BUY'); assert.deepEqual(s.flags, ['bottoming', 'fast']); assert.equal(s.marginPct, 20);
  assert.match(s.reasons[0].text, /below its 30-day high, but no new low in 14 days -- the fall looks like it has stalled/);
}
// Trade credit has its own %: 80% of resale for a fast Pokemon, dropping by
// as many points as the cash margin rises, never below the cash walk-away.
{
  const slow = run(series(() => 30, 0.3));
  assert.equal(slow.tradePctUsed, 55); assert.equal(slow.tradeMax, 16.5);
  const fast = run(series(() => 30, 2));
  assert.equal(fast.tradePctUsed, 80); assert.equal(fast.tradeMax, 24);
}
// Per-category targets from Settings arrive as rule overrides.
{
  const rules = { marginFastPokemon:30, marginFast:30, marginAvg:40, marginSlow:50, tradePctPokemon:70, tradePctOther:70, minProfit:5, feePct:0, marginStocked:10 };
  const s = run(series(() => 40, 2), { category:'Sports', rules });
  assert.equal(s.marginPct, 30); assert.equal(s.maxPrice, 28); assert.equal(s.tradeMax, 28);
  assert.equal(s.math[1], 'No fees (in-store): $40.00');
  assert.equal(run(series(() => 40, 2), { category:'Sports', rules, stockQty:1 }).marginPct, 40);
}
// Margins by speed and category.
assert.equal(run(series(() => 30, 2)).marginPct, 20, 'liquid Pokemon');
assert.equal(run(series(() => 30, 2), { category:'Magic' }).marginPct, 25, 'other fast sellers');
assert.equal(run(series(() => 30, 1)).marginPct, 35, 'average pace');
{
  const s = run(series(() => 30, 0.3));
  assert.equal(s.verdict, 'BUY_LOW'); assert.equal(s.marginPct, 45); assert.equal(s.maxPrice, 16);
}
assert.equal(run(series(() => 30, 0.05)).verdict, 'PASS', 'barely sells');
// Spike -> pass, and a sell hint for anything already in stock.
{
  const s = run(series(i => i < 80 ? 40 : 40 + (i - 80) * 2.2));
  assert.equal(s.verdict, 'PASS'); assert.equal(s.maxPrice, 0); assert.deepEqual(s.math, []);
  assert.match(s.reasons[0].text, /^Up 49\.5% in 14 days -- buying into a spike/);
  assert.match(s.sellHint, /good time to sell/);
}
// Cheap cards: $3 minimum profit; under $1 left to pay -> bulk it.
{
  const four = run(series(() => 4, 20));
  assert.equal(four.verdict, 'PASS'); assert.ok(four.flags.includes('thin'));
  assert.match(four.reasons.at(-1).text, /^Resale nets about \$3\.88 -- after \$3\.00 profit there's only \$0\.75 left to pay\. Bulk it or pass\./);
  const eight = run(series(() => 8, 20));
  assert.equal(eight.verdict, 'BUY_LOW'); assert.equal(eight.maxPrice, 4.75);
  assert.match(eight.reasons.at(-1).text, /the \$3\.00 minimum profit sets the price/);
}
// Our own recent sales set the resale when there are enough of them.
{
  const s = run(series(() => 50, 5), { ourSales:{ soldCount:4, recentSold:3, recentAvgSale:55, avgDays:11.6 }, wants:2 });
  assert.equal(s.resale, 55); assert.equal(s.math[0], 'Resale: your last 3 sales (avg $55.00)');
  assert.equal(s.maxPrice, 42.5);
  assert.ok(s.reasons.some(r => r.text === "You've sold 4 of these before, in about 12 days on average."));
  assert.ok(s.reasons.some(r => r.text === '2 customer wants on the want list.'));
  assert.equal(run(series(() => 50, 5), { ourSales:{ recentSold:3, recentAvgSale:90 } }).resale, 57.5, 'capped at 115% of market');
  assert.equal(run(series(() => 50, 5), { ourSales:{ recentSold:1, recentAvgSale:90 } }).resale, 50, 'one sale is not enough');
}
// Stock on hand: some -> +5% margin; a pile -> pass.
{
  const s = run(series(() => 50, 10), { stockQty:2 });
  assert.equal(s.verdict, 'BUY_LOW'); assert.equal(s.marginPct, 25);
  assert.match(s.math[2], /^Keep 25% \(sells fast, liquid Pokémon, \+5% since you have some\): walk away above \$36\.25$/);
  assert.equal(run(series(() => 50, 10), { stockQty:4 }).verdict, 'PASS');
}
// Thin history: no trend call, standard margin, never a confident BUY; no price -> nothing.
{
  const s = run(series(() => 50, 10, 8));
  assert.equal(s.metrics, null); assert.equal(s.verdict, 'BUY_LOW'); assert.equal(s.marginPct, 35);
  assert.match(s.reasons[0].text, /^Not enough price history/);
  assert.equal(S.evaluateBuySignal({ points:[] }).verdict, 'NO_DATA');
}
// Dates in any shape the providers send (ISO, unix seconds, [date, price]).
assert.equal(S.cleanPoints([{ t:1760000000, p:5 }, ['2025-10-10', 6], { date:'2025-10-11T03:00:00Z', market:7 }, { date:'bad', price:9 }]).length, 3);

// Backtest: on a market that keeps falling after spikes, PASS should score
// worse than BUY, and report whether buys at the target still made money.
{
  const cards = [];
  for(let c = 0; c < 30; c++){
    const base = 20 + c;
    cards.push(series(i => i < 40 ? base : i < 46 ? base * (1 + (i - 40) * 0.07) : base * Math.max(0.6, 1.42 - (i - 46) * 0.02), 6, 150));
    cards.push(series(i => base + Math.sin(i / 6 + c) * 0.3, 6, 150));
  }
  const bt = S.backtestBuySignal(cards, { category:'Pokemon' });
  assert.ok(bt.samples > 500, 'enough samples');
  const pass = bt.rows.find(r => r.verdict === 'PASS'), buy = bt.rows.find(r => r.verdict === 'BUY');
  assert.ok(pass && buy && pass.avgChange < buy.avgChange && bt.passWorse);
  assert.ok(buy.heldUp >= 75 && buy.heldUp <= 100, 'most buys at the target still clear $3 a month later');
}

// Dashboard wiring.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };
assert.match(dashboard, /<script src="scripts\/buy-signal\.js\?v=[^"]+" defer><\/script>/);
assert.match(extractFn('buySignalPoints'), /const series = pokemonPptAllHistorySeries\(r\);\s*const sel = series\.find\(s => s\.selected\) \|\| series\[0\];/, 'reads the same series the chart draws');
assert.match(extractFn('openQplChartModal', 'async function '), /const panel = buySignalPanelHtml\(r, idx\);\s*if\(panel\) modal\.querySelector\('\.qpl-chart-card'\)\?\.insertAdjacentHTML\('beforeend', panel\);/);
assert.match(dashboard, /<div class="qpl-meta">\$\{escHtml\(meta \|\| r\.note \|\| r\.category \|\| ''\)\}<\/div>\s*\$\{buySignalPillHtml\(buySignalFor\(r\), idx\)\}/, 'big verdict pill at the top of every research card');
assert.doesNotMatch(dashboard, /<div class="qpl-price">\$\$\{Number\(r\.market \|\| 0\)\.toFixed\(2\)\}<\/div>\s*\$\{buySignalChipHtml/, 'no second chip under the price');
{
  const pill = new Function(extractFn('buySignalPillHtml') + '\nreturn buySignalPillHtml;')();
  assert.match(pill({ verdict:'BUY', maxPrice:45, metrics:{} }, 3), /^<button type="button" class="buy-sig-pill buy" onclick="openQplChartModal\(3\)"[^>]*>🟢 BUY<span>up to <b>\$45\.00<\/b><\/span><i>WHY ›<\/i><\/button>$/);
  assert.match(pill({ verdict:'PASS', maxPrice:0, metrics:{} }, 0), /🔴 PASS<i>WHY ›<\/i>/);
  assert.match(pill({ verdict:'BUY_LOW', maxPrice:20, metrics:null }, 0), /class="buy-sig-pill na"[^>]*>⚪ NO TREND YET<span>up to <b>\$20\.00/);
  assert.equal(pill(null), '');
}
assert.match(extractFn('selectedQuickLookupItem'), /signalHistory:isComic \? \[\] : buySignalHistorySnapshot\(r\),/);
assert.match(extractFn('renderBuyList'), /\$\{buyTraySignalHtml\(i, offerVal\)\}/);
assert.match(extractFn('buyItemToInventoryUpdates'), /buySignal = \{ verdict:sig\.verdict, maxPrice:sig\.maxPrice, market, paid:cost, flags:sig\.flags, at:new Date\(\)\.toISOString\(\) \}/);
assert.match(dashboard, /\['buySignal', null\],\n\];/, 'saved on the inventory row');
// Settings > Buy targets: per category, saved with the store profile (both
// receipt_settings writers carry it, or one save would erase the other's).
assert.equal((dashboard.match(/      buyTargets:next\.buyTargets \|\| \{\},\n/g) || []).length, 2);
assert.match(dashboard, /\$\{buyTargetsSettingsHtml\(\)\}/);
assert.match(extractFn('buySignalFor'), /rules:buyTargetRules\(group\)/);
{
  const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
  const consts = app.slice(app.indexOf('const BUY_TARGET_GROUPS = ['), app.indexOf('};\n', app.indexOf('const DEFAULT_BUY_TARGETS = {')) + 3);
  assert.ok(app.indexOf('const BUY_TARGET_GROUPS') < app.indexOf('function renderVendorProfilePanel'), 'defined before anything renders');
  let profile = {};
  const api = new Function('getVendorProfile', 'qplResultCategoryKey', 'qplCategoryKey', 'isPokemonChartCandidate', consts + [extractFn('buyTargetsSettings'), extractFn('buyTargetGroup'), extractFn('buyTargetRules'), extractFn('buyTargetSummary')].join('\n') + '\nreturn { buyTargetsSettings, buyTargetGroup, buyTargetRules, buyTargetSummary };')(
    () => profile, r => r.key || '', c => /magic/i.test(c) ? 'mtg' : /yu-gi/i.test(c) ? 'yugioh' : '', r => r.key === 'pokemon');
  assert.equal(api.buyTargetGroup({ key:'pokemon' }), 'pokemon');
  assert.equal(api.buyTargetGroup({ category:'Magic' }), 'mtg');
  assert.equal(api.buyTargetGroup({ category:'Baseball', sport:'Baseball' }), 'sports');
  assert.equal(api.buyTargetGroup({ category:'Yu-Gi-Oh!' }), 'tcg');
  assert.equal(api.buyTargetGroup({ category:'Funko' }), 'other');
  assert.deepEqual(api.buyTargetRules('pokemon'), { marginFastPokemon:20, marginFast:20, marginAvg:35, marginSlow:45, tradePctPokemon:80, tradePctOther:80, minProfit:3, feePct:3, marginStocked:5, gradingCost:25 });
  profile = { buyTargets:{ sports:{ fast:30, trade:70 }, minProfit:4 } };
  assert.deepEqual(api.buyTargetRules('sports'), { marginFastPokemon:30, marginFast:30, marginAvg:35, marginSlow:45, tradePctPokemon:70, tradePctOther:70, minProfit:4, feePct:3, marginStocked:5, gradingCost:25 }, 'saved values over the defaults, per field');
  assert.equal(api.buyTargetRules('mtg').marginFast, 25, 'other categories keep their defaults');
  assert.match(api.buyTargetSummary('sports'), /^Sports cards margins: 30% fast sellers, 35% average, 45% slow or jumpy, \+5% if you already have some; never under \$4\.00 profit; trade credit 70% of resale on fast sellers$/);
}
// Chip only when there's history to judge, or a reason to pass.
{
  const chip = new Function('escHtml', extractFn('buySignalChipHtml') + '\nreturn buySignalChipHtml;')(v => String(v));
  assert.equal(chip({ verdict:'BUY_LOW', label:'BUY LOW · max $5.00', metrics:null, reasons:[] }), '');
  assert.match(chip({ verdict:'PASS', label:'PASS', metrics:null, reasons:[{ tone:'bad', text:'You already have 4 in stock.' }] }), /buy-sig-chip pass" title="You already have 4 in stock\.">🔴 PASS/);
  assert.match(chip({ verdict:'BUY', label:'BUY', metrics:{}, reasons:[{ tone:'good', text:'Steady' }] }, { onclick:'x()' }), /class="buy-sig-chip buy" title="Steady" onclick="x\(\)">🟢 BUY</);
}
console.log('Buy signal checks passed');
