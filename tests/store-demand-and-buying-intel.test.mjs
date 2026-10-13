import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Store ask: "better buying info" -- (1) what sells at OUR store, (2) don't
// buy new sets at release prices, (3) grading upside -- and "a section in
// reports that has what we should be buying and looking for: sets, cards,
// characters, players."
const require = createRequire(import.meta.url);
const D = require('../scripts/store-demand.js');
const S = require('../scripts/buy-signal.js');
const DAY = 86400000, NOW = Date.UTC(2026, 9, 13);
const ago = d => new Date(NOW - d * DAY).toISOString();

// Who a card is.
for(const [name, who] of [['Charizard ex - 199/165','Charizard'], ["Team Rocket's Mewtwo ex - 213/182",'Mewtwo'], ["Erika's Tangela - 218/217",'Tangela'],
  ['Mega Charizard X ex - 109/094','Charizard'], ['Moltres & Zapdos & Articuno GX','Moltres & Zapdos & Articuno'], ['Primal Kyogre EX (Alpha - 149 Full Art)','Kyogre'],
  ['Bulbasaur - 133/132 (Mega Evolution Stamped)','Bulbasaur'], ['Iron Thorns #98','Iron Thorns'], ['Charmander - 038','Charmander'], ['Lucario VSTAR - SWSH291','Lucario'],
  ['Pikachu with Grey Felt Hat','Pikachu'], ['Pitch Black Booster Box','']]) assert.equal(D.pokemonCharacter(name), who, name);
assert.equal(D.setKey('SV10: Destined Rivals'), D.setKey('Pokemon Destined Rivals'), 'one set however it is written');
assert.equal(D.comicSeries({ name:'X-Men #38 Cover A' }), 'X-Men');
assert.deepEqual(D.groupKeysFor({ name:'Shohei Ohtani 2023 Topps', category:'Sports', set:'2023 Topps Chrome', player:'Shohei Ohtani' }).map(g => g.dim), ['set', 'player']);

// Ratings from our own sales.
{
  const sold = [], stock = [];
  const sale = (name, set, days, price, cost, addedDaysBefore) => sold.push({ name, category:'Pokemon TCG', set, salePrice:price, cost, soldAt:ago(days), addedAt:ago(days + addedDaysBefore) });
  for(let k = 0; k < 6; k++) sale('Eevee ex - 167/131', 'Prismatic Evolutions', 5 + k * 10, 40, 28, 12);   // fast, 30% margin
  for(let k = 0; k < 3; k++) sale('Pikachu ex', 'Destined Rivals', 10 + k * 20, 20, 15, 10);              // sells...
  for(let k = 0; k < 30; k++) stock.push({ name:'Card ' + k, category:'Pokemon TCG', set:'SV10: Destined Rivals', qty:1, price:5, addedAt:ago(20) }); // ...but 30 on the shelf
  for(let k = 0; k < 5; k++) stock.push({ name:'Old ' + k, category:'Pokemon TCG', set:'Surging Sparks', qty:1, price:3, addedAt:ago(70) });   // never sold, 70 days
  for(let k = 0; k < 5; k++) stock.push({ name:'New ' + k, category:'Pokemon TCG', set:'Brand New Set', qty:1, price:3, addedAt:ago(5) });     // never sold, just arrived
  sale('Groudon V', 'Old Set', 30, 30, 20, 80); sale('Groudon ex', 'Other Set', 60, 30, 20, 70);
  const d = D.buildStoreDemand({ sold, stock, now:NOW });
  const g = label => d.list.find(x => x.label === label);
  assert.equal(g('Eevee').rating, 'hot'); assert.equal(g('Prismatic Evolutions').rating, 'hot');
  assert.equal(g('Eevee').avgDays, 12); assert.equal(g('Eevee').marginPct, 30);
  assert.equal(g('Destined Rivals').rating, 'plenty', '3 sold but 30 on the shelf');
  assert.ok(g('Destined Rivals').monthsOfStock >= 4);
  assert.equal(g('Surging Sparks').rating, 'slow', '5 sitting 70 days, none sold');
  assert.equal(g('Brand New Set').rating, 'thin', 'new arrivals are not "slow" yet');
  assert.equal(g('Groudon').rating, 'slow', 'takes 60+ days to sell');
  assert.equal(D.demandFor({ name:'Eevee VMAX', category:'Pokemon', set:'Evolving Skies' }, d).label, 'Eevee', 'character evidence beats an unknown set');
  assert.match(D.demandSentence(g('Eevee'), d.spanDays), /^You've sold 6 Eevee in the last \d+ days, about 12 days each, at 30% profit\.$/);
}

// Buy signal: what sells here moves the margin; new sets pay less; grading is flagged.
const series = (fn, vol = 2, days = 90) => Array.from({ length:days }, (_, i) => ({ date:new Date(NOW - (days - 1 - i) * DAY).toISOString(), price:+fn(i).toFixed(2), volume:vol }));
const base = { points:series(() => 50), category:'Pokemon' };
{
  const plain = S.evaluateBuySignal(base);
  const hot = S.evaluateBuySignal({ ...base, storeDemand:{ rating:'hot', label:'Eevee', sentence:"You've sold 6 Eevee." } });
  const slow = S.evaluateBuySignal({ ...base, storeDemand:{ rating:'slow', label:'X', sentence:'Sits.' } });
  assert.equal(plain.marginPct, 20); assert.equal(hot.marginPct, 15); assert.equal(slow.marginPct, 25);
  assert.ok(hot.maxPrice > plain.maxPrice && slow.maxPrice < plain.maxPrice);
  assert.equal(hot.verdict, 'BUY'); assert.equal(slow.verdict, 'BUY_LOW');
  assert.ok(hot.reasons.some(r => r.text === "Sells well here: You've sold 6 Eevee."));
  assert.match(hot.math[2], /^Pay up to 85% \(sells fast, liquid Pokémon, \+5% sells well here\)/);
  assert.equal(S.evaluateBuySignal({ ...base, storeDemand:{ rating:'plenty', sentence:'Lots.' } }).verdict, 'BUY_LOW');
}
{
  const fresh = S.evaluateBuySignal({ ...base, setReleaseDate:ago(35) });
  assert.ok(fresh.flags.includes('newSet')); assert.equal(fresh.marginPct, 25); assert.equal(fresh.verdict, 'BUY_LOW');
  assert.ok(fresh.reasons.some(r => /^Set came out 5 weeks ago -- new sets usually keep easing/.test(r.text)));
  assert.ok(!S.evaluateBuySignal({ ...base, setReleaseDate:ago(200) }).flags.includes('newSet'), 'older sets: no rule');
}
{
  const g = S.evaluateBuySignal({ ...base, rules:{ gradingCost:25 }, grading:{ psa10:300, psa9:90, count10:12 } });
  assert.ok(g.flags.includes('grade')); assert.deepEqual(g.grading, { psa9:90, psa10:300, cost:75, upside10:225 });
  assert.equal(g.maxPrice, S.evaluateBuySignal(base).maxPrice, 'grading never changes the price');
  assert.match(g.reasons.at(-1).text, /^Grading candidate: PSA 10 sells about \$300\.00, PSA 9 about \$90\.00 -- vs \$50\.00 raw \+ \$25\.00 grading/);
  assert.equal(S.evaluateBuySignal({ ...base, grading:{ psa10:300, psa9:60, count10:12 } }).grading, null, 'PSA 9 must cover raw + grading');
  assert.equal(S.evaluateBuySignal({ ...base, grading:{ psa10:300, psa9:90, count10:1 } }).grading, null, 'too few PSA 10 sales');
}

// Dashboard wiring.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };
assert.match(dashboard, /<script src="scripts\/store-demand\.js\?v=[^"]+" defer><\/script>\n<script src="scripts\/buy-signal\.js/);
assert.match(extractFn('buySignalFor'), /storeDemand:buySignalStoreDemand\(r\), setReleaseDate:group === 'pokemon' \? pokemonSetReleaseDate\(/);
assert.match(extractFn('buySignalFor'), /grading:buySignalGrading\(r\)/);
assert.match(extractFn('renderReportsPanel'), /<div id="what-to-buy-panel"><\/div>`;\s*runReportsQuery\(\);\s*renderWhatToBuyPanel\(\);/);
assert.match(extractFn('renderWhatToBuyPanel'), /🟢 BUY MORE[\s\S]*🟡 HAVE PLENTY[\s\S]*🔴 GO EASY[\s\S]*CUSTOMERS ARE ASKING FOR[\s\S]*GRADING CANDIDATES IN STOCK/);
assert.match(extractFn('storeDemandSnapshot'), /if\(id && soldIds\.has\(id\)\) return;/, 'a checkout line for a sold inventory row is not counted twice');
assert.match(dashboard, /<label>GRADING COST \$\$\{cell\('bt-gradingCost', t\.gradingCost\)\}<\/label>/);
// Buy targets read as Pay % (stored as the margin kept, 100 - pay).
assert.match(dashboard, /<b>Pay % fast<\/b><b>Pay % avg<\/b><b>Pay % slow<\/b><b>Trade %<\/b>/);
assert.match(dashboard, /cell\('bt-'\+key\+'-fast', 100 - t\[key\]\.fast\)/);
assert.match(extractFn('saveBuyTargetsFromForm', 'async function '), /const pay = num\(`bt-\$\{key\}-\$\{f\}`, 5, 100\); next\[key\]\[f\] = pay == null \? t\[key\]\[f\] : 100 - pay;/);
{
  const html = new Function('escHtml', extractFn('whatToBuyRowsHtml') + '\nreturn whatToBuyRowsHtml;')(v => String(v))(
    [{ label:'Eevee', dim:'character', sold:6, avgDays:12, marginPct:30, stockQty:4, monthsOfStock:2.1 }], 'none');
  assert.match(html, /<td><b>Eevee<\/b><span>Pokémon<\/span><\/td>\s*<td>6<\/td><td>12d<\/td><td>30%<\/td>\s*<td>4<span>2 mo<\/span><\/td>/);
}
console.log('Store demand + buying intelligence checks passed');
