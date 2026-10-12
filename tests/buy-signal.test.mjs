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
const run = (points, extra = {}) => S.evaluateBuySignal({ points, buyPct:60, ...extra });

// Still falling (the post's Venusaur): down 24% and a new low today -> buy low, deeper discount.
{
  const s = run(series(i => i < 60 ? 120 : 120 - (i - 60)));
  assert.equal(s.verdict, 'BUY_LOW');
  assert.deepEqual(s.flags, ['falling']);
  assert.ok(s.buyPctUsed <= 40 && s.maxPrice > 0 && s.maxPrice < s.metrics.price * 0.6);
  assert.match(s.reasons[0].text, /^Down 24\.2% in 30 days and set a new 30-day low today -- still falling/);
}
// Fall that stalled (the post's Psyduck): off its high, no new low for two weeks -> buy.
{
  const s = run(series(i => i < 60 ? 68 : i < 75 ? 68 - (i - 60) * 0.73 : 57.2 + (i - 75) * 0.07));
  assert.equal(s.verdict, 'BUY');
  assert.deepEqual(s.flags, ['bottoming']);
  assert.match(s.reasons[0].text, /below its 30-day high, but no new low in 14 days -- the fall looks like it has stalled/);
  assert.equal(s.maxPrice, Math.floor(s.metrics.price * 0.6 * 4) / 4, 'normal buy % when nothing is wrong');
}
// Spike -> pass, and a sell hint for anything already in stock.
{
  const s = run(series(i => i < 80 ? 40 : 40 + (i - 80) * 2.2));
  assert.equal(s.verdict, 'PASS'); assert.equal(s.maxPrice, 0);
  assert.match(s.reasons[0].text, /^Up 49\.5% in 14 days -- buying into a spike/);
  assert.match(s.sellHint, /good time to sell/);
}
// Steady, sells well -> buy at the normal %.
{
  const s = run(series(i => 25 + Math.sin(i / 5) * 0.4, 12));
  assert.equal(s.verdict, 'BUY'); assert.deepEqual(s.flags, []);
  assert.ok(s.reasons.some(r => /Sells about 84 a week/.test(r.text)));
}
// Slow and dead sellers.
assert.equal(run(series(() => 30, 0.3)).verdict, 'BUY_LOW', 'about 2 a week: pay less');
assert.equal(run(series(() => 30, 0.05)).verdict, 'PASS', 'barely sells');
// Thin margin: a $4 card can't clear $3 after fees.
{
  const s = run(series(() => 4, 20));
  assert.equal(s.verdict, 'PASS'); assert.ok(s.flags.includes('thin'));
  assert.match(s.reasons.at(-1).text, /Resale clears about \$3\.07 after fees/);
}
// Stock on hand: some -> pay less; a pile -> pass.
assert.equal(run(series(() => 50, 10), { stockQty:2 }).verdict, 'BUY_LOW');
assert.equal(run(series(() => 50, 10), { stockQty:4 }).verdict, 'PASS');
// Our own sales and want list show up as reasons.
{
  const s = run(series(() => 50, 10), { ourSales:{ soldCount:3, avgDays:11.6 }, wants:2 });
  assert.ok(s.reasons.some(r => r.text === "You've sold 3 of these before, in about 12 days on average."));
  assert.ok(s.reasons.some(r => r.text === '2 customer wants on the want list.'));
}
// Thin history: no trend call, never a confident BUY; no price -> nothing.
{
  const s = run(series(() => 50, 10, 8));
  assert.equal(s.metrics, null); assert.equal(s.verdict, 'BUY_LOW');
  assert.match(s.reasons[0].text, /^Not enough price history/);
  assert.equal(S.evaluateBuySignal({ points:[] }).verdict, 'NO_DATA');
}
// Dates in any shape the providers send (ISO, unix seconds, [date, price]).
assert.equal(S.cleanPoints([{ t:1760000000, p:5 }, ['2025-10-10', 6], { date:'2025-10-11T03:00:00Z', market:7 }, { date:'bad', price:9 }]).length, 3);

// Backtest: on a market that keeps falling after spikes and new lows,
// PASS should score worse than BUY.
{
  const cards = [];
  for(let c = 0; c < 30; c++){
    const base = 20 + c;
    cards.push(series(i => i < 40 ? base : i < 46 ? base * (1 + (i - 40) * 0.07) : base * Math.max(0.6, 1.42 - (i - 46) * 0.02), 6, 150));
    cards.push(series(i => base + Math.sin(i / 6 + c) * 0.3, 6, 150));
  }
  const bt = S.backtestBuySignal(cards, { buyPct:60 });
  assert.ok(bt.samples > 500, 'enough samples');
  const pass = bt.rows.find(r => r.verdict === 'PASS'), buy = bt.rows.find(r => r.verdict === 'BUY');
  assert.ok(pass && buy && pass.avgChange < buy.avgChange && bt.passWorse);
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
