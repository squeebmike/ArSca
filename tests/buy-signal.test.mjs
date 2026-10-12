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
    'Open at $54.50 · trade credit up to $64.00',
  ]);
  assert.match(s.reasons[0].text, /^Down 24\.2% in 30 days and set a new 30-day low today -- still falling/);
}
// Fall that stalled (the post's Psyduck): a plain BUY at the liquid-Pokemon margin.
{
  const s = run(series(i => i < 60 ? 68 : i < 75 ? 68 - (i - 60) * 0.73 : 57.2 + (i - 75) * 0.07));
  assert.equal(s.verdict, 'BUY'); assert.deepEqual(s.flags, ['bottoming', 'fast']); assert.equal(s.marginPct, 20);
  assert.match(s.reasons[0].text, /below its 30-day high, but no new low in 14 days -- the fall looks like it has stalled/);
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
assert.match(dashboard, /<div class="qpl-price">\$\$\{Number\(r\.market \|\| 0\)\.toFixed\(2\)\}<\/div>\s*\$\{buySignalChipHtml\(buySignalFor\(r\), \{ onclick:`openQplChartModal\(\$\{idx\}\)` \}\)\}/);
assert.match(extractFn('selectedQuickLookupItem'), /signalHistory:isComic \? \[\] : buySignalHistorySnapshot\(r\),/);
assert.match(extractFn('renderBuyList'), /\$\{buyTraySignalHtml\(i, offerVal\)\}/);
assert.match(extractFn('buyItemToInventoryUpdates'), /buySignal = \{ verdict:sig\.verdict, maxPrice:sig\.maxPrice, market, paid:cost, flags:sig\.flags, at:new Date\(\)\.toISOString\(\) \}/);
assert.match(dashboard, /\['buySignal', null\],\n\];/, 'saved on the inventory row');
// Chip only when there's history to judge, or a reason to pass.
{
  const chip = new Function('escHtml', extractFn('buySignalChipHtml') + '\nreturn buySignalChipHtml;')(v => String(v));
  assert.equal(chip({ verdict:'BUY_LOW', label:'BUY LOW · max $5.00', metrics:null, reasons:[] }), '');
  assert.match(chip({ verdict:'PASS', label:'PASS', metrics:null, reasons:[{ tone:'bad', text:'You already have 4 in stock.' }] }), /buy-sig-chip pass" title="You already have 4 in stock\.">🔴 PASS/);
  assert.match(chip({ verdict:'BUY', label:'BUY', metrics:{}, reasons:[{ tone:'good', text:'Steady' }] }, { onclick:'x()' }), /class="buy-sig-chip buy" title="Steady" onclick="x\(\)">🟢 BUY</);
}
console.log('Buy signal checks passed');
