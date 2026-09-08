import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-09-08-whatnot-shows-intelligence.sql', 'utf8');

// Store idea: the Whatnot live intelligence layer -- $1 Auction Risk
// Score, Whatnot vs. eBay Decision, Live Floor-Price Warning, Audience-
// Size Logic, Buyer Momentum / The Bench, Repeat Buyer/Whale Dashboard,
// Loss-Leader Tracking, and the Show Experiment Engine. Built entirely on
// real data this app can actually capture (past Whatnot sales, a manually
// entered room size, a manually entered buyer name) -- never a fabricated
// signal Whatnot's API doesn't actually expose to this app.

// ── Migration ──
assert.match(migration, /alter table public\.whatnot_show_items add column if not exists buyer_customer_id uuid references public\.customers\(id\) on delete set null;/, 'must add real buyer linkage to the existing customers table');
assert.match(migration, /alter table public\.whatnot_shows add column if not exists experiment_tag text;/, 'must add an experiment tag for the Show Experiment Engine');
assert.match(migration, /alter table public\.whatnot_shows add column if not exists peak_audience_size integer;/, 'must track peak audience size for Audience-Size Logic');
console.log('Whatnot live intelligence migration contract checks passed');

// ── $1 Auction Risk Score ──
assert.match(dashboard, /function computeAuctionRiskScore\(item, categoryAvgSalePrice\)\{/, 'missing computeAuctionRiskScore');
const riskStart = dashboard.indexOf('function computeAuctionRiskScore(item, categoryAvgSalePrice){');
const riskEnd = dashboard.indexOf('\n}', riskStart) + 2;
const riskFn = dashboard.slice(riskStart, riskEnd);
assert.match(riskFn, /const benchmark = categoryAvgSalePrice > 0 \? categoryAvgSalePrice : 25;/, 'must prefer the category\'s REAL historical benchmark, falling back to a flat conservative default only with zero history');
assert.match(riskFn, /return \{ level:'SAFE'/, 'must have a SAFE tier');
assert.match(riskFn, /return \{ level:'RISKY'/, 'must have a RISKY tier');
assert.match(riskFn, /return \{ level:'DO NOT \$1 START'/, 'must have a DO NOT $1 START tier -- a $150 card is not automatically safe just because it\'s worth $150');
assert.match(dashboard, /function loadCategoryWhatnotBenchmarks\(\)\{/, 'missing loadCategoryWhatnotBenchmarks');
const benchStart = dashboard.indexOf('async function loadCategoryWhatnotBenchmarks(){');
const benchEnd = dashboard.indexOf('\n}', benchStart) + 2;
const benchFn = dashboard.slice(benchStart, benchEnd);
assert.match(benchFn, /\.eq\('status', 'sold'\)/, 'the benchmark must come from REAL sold Whatnot show items, not planned/list prices');

// ── Whatnot vs. eBay Decision ──
assert.match(dashboard, /function suggestSalesChannel\(item\)\{/, 'missing suggestSalesChannel');
const chanStart = dashboard.indexOf('function suggestSalesChannel(item){');
const chanEnd = dashboard.indexOf('\n}', chanStart) + 2;
const chanFn = dashboard.slice(chanStart, chanEnd);
assert.match(chanFn, /if\(price >= 150\) return \{ channel:'EBAY AUCTION'/, 'a high-value item must be steered to eBay auction, not a thin $1-start room');
assert.match(chanFn, /if\(price < 5\) return \{ channel:'EBAY BIN \/ BUNDLE'/, 'a too-cheap item must not get a standalone-listing recommendation');
assert.match(chanFn, /WHATNOT_SHOW_CATEGORIES\.includes\(item\.category\) && qty <= 1\) return \{ channel:'WHATNOT'/, 'a mid-value single-copy collectible must be recommended for Whatnot');

// ── Live Floor-Price Warning (elevates the existing live profit preview) ──
const priceStart = dashboard.indexOf('function renderWhatnotPrice(){');
const priceEnd = dashboard.indexOf('\n}', priceStart) + 2;
const priceFn = dashboard.slice(priceStart, priceEnd);
assert.match(priceFn, /⚠️ DANGER -- selling at a loss/, 'a negative-profit price must trigger an explicit danger banner, not just red text');
assert.match(priceFn, /break-even ~\$\$\{breakEven\.toFixed\(2\)\}/, 'the warning must show the actual break-even price');

// ── Audience-Size Logic ──
assert.match(dashboard, /const WHATNOT_ANCHOR_MIN_AUDIENCE = 15;/, 'missing the anchor-gating threshold');
assert.match(dashboard, /function setWhatnotAudienceSize\(val\)\{/, 'missing setWhatnotAudienceSize');
const pullStart = dashboard.indexOf('function pullNextShowItem(){');
const pullEnd = dashboard.indexOf('\n}', pullStart) + 2;
const pullFn = dashboard.slice(pullStart, pullEnd);
assert.match(pullFn, /const audienceReady = whatnotCurrentAudienceSize === 0 \|\| whatnotCurrentAudienceSize >= WHATNOT_ANCHOR_MIN_AUDIENCE;/, 'a room size of 0 (never entered) must never gate anything -- this is opt-in');
assert.match(pullFn, /let next = ordered\.find\(r => audienceReady \|\| r\.role !== 'anchor'\);/, 'only anchor-role items get held back for a thin room -- everything else still runs');

// ── Buyer Momentum / The Bench ──
assert.match(dashboard, /function computeShowMomentum\(\)\{/, 'missing computeShowMomentum');
const momStart = dashboard.indexOf('function computeShowMomentum(){');
const momEnd = dashboard.indexOf('\n}', momStart) + 2;
const momFn = dashboard.slice(momStart, momEnd);
assert.match(momFn, /\.filter\(x => x\.count >= 2\)/, 'a single sale must not be treated as a category trend');
assert.match(dashboard, /function pickBenchOrder\(\)\{/, 'missing pickBenchOrder');
const benchOrderStart = dashboard.indexOf('function pickBenchOrder(){');
const benchOrderEnd = dashboard.indexOf('\n}', benchOrderStart) + 2;
const benchOrderFn = dashboard.slice(benchOrderStart, benchOrderEnd);
assert.match(benchOrderFn, /pctOfTarget >= 100/, 'hot categories (100%+ of planned price) must be bumped ahead');
assert.doesNotMatch(benchOrderFn, /\.position\s*=/, 'reordering must be a soft display/pull preference -- must never mutate the stored planned position');

// ── Repeat Buyer / Whale Dashboard ──
assert.match(dashboard, /function openWhaleDashboard\(\)\{/, 'missing openWhaleDashboard');
const whaleStart = dashboard.indexOf('async function renderWhaleDashboard(){');
const whaleEnd = dashboard.indexOf('\n}', whaleStart) + 2;
const whaleFn = dashboard.slice(whaleStart, whaleEnd);
assert.match(whaleFn, /\.not\('buyer_name', 'is', null\)/, 'must only include sales with a real captured buyer, never fabricate buyer identity');
assert.match(whaleFn, /b\.shows\.add\(r\.show_id\)/, 'must track distinct SHOWS attended, not just purchase count -- the roadmap explicitly wants shows-attended as a signal');

// ── Loss-Leader Tracking ──
assert.match(dashboard, /function classifyShowLosses\(soldItems\)\{/, 'missing classifyShowLosses');
const lossStart = dashboard.indexOf('function classifyShowLosses(soldItems){');
const lossEnd = dashboard.indexOf('\n}', lossStart) + 2;
const lossFn = dashboard.slice(lossStart, lossEnd);
assert.match(lossFn, /const buyerOtherProfit = buyerItems\.filter\(x => x\.id !== r\.id\)\.reduce/, 'must check the SAME buyer\'s other purchases in this show, excluding the loss item itself');
assert.match(lossFn, /lossType: \(key && buyerOtherProfit >= loss\) \? 'acquisition' : 'bad_loss'/, 'a loss only counts as acquisition when a buyer is known AND their other spending actually covers it');
assert.match(dashboard, /Loss leaders \(customer acquisition\)/, 'Show P&L must surface the acquisition/bad-loss split, not just a single loss number');

// ── Show Experiment Engine ──
assert.match(dashboard, /function openExperimentComparison\(\)\{/, 'missing openExperimentComparison');
const expStart = dashboard.indexOf('async function renderExperimentComparison(){');
const expEnd = dashboard.indexOf('\n}', expStart) + 2;
const expFn = dashboard.slice(expStart, expEnd);
assert.match(expFn, /\.eq\('status', 'ended'\);/, 'must only compare ENDED shows -- an in-progress show can\'t report a final profit/hour');
assert.match(expFn, /perShow\.filter\(p => p\.show\.experiment_tag\)/, 'the by-tag comparison must exclude untagged shows');
assert.match(expFn, /profitPerHour:\(gross - cogs\) \/ hours/, 'must compare profit per hour, so shows of different lengths are comparable');
assert.match(dashboard, /id="ws-experiment-tag"/, 'the Show Builder modal must have a way to actually tag a show with what\'s being tested');

// ── True Giveaway Cost (giveaway-heavy vs. not, real profit/hour comparison) ──
assert.match(expFn, /giveawayCount: rows\.filter\(r => r\.status === 'giveaway'\)\.length/, 'must count REAL giveaways per show from whatnot_show_items, not a fabricated rate');
assert.match(expFn, /const withGiveaways = perShow\.filter\(p => p\.giveawayCount > 0\);/, 'must actually bucket shows by whether they ran any giveaways');
assert.match(expFn, /GIVEAWAY IMPACT/, 'must surface the giveaway-heavy-vs-not comparison distinctly from the tag comparison');

console.log('Whatnot live intelligence dashboard contract checks passed');

// ── Functional: reimplement the core scoring/classification logic ──
function computeAuctionRiskScore(item, categoryAvgSalePrice){
  const cost = Number(item.cost || 0);
  const benchmark = categoryAvgSalePrice > 0 ? categoryAvgSalePrice : 25;
  if(cost <= 0) return { level:'SAFE' };
  if(cost <= benchmark*0.3) return { level:'SAFE' };
  if(cost <= benchmark*0.8) return { level:'RISKY' };
  return { level:'DO NOT $1 START' };
}
assert.equal(computeAuctionRiskScore({ cost:3 }, 25).level, 'SAFE', 'cheap relative to benchmark -> SAFE');
assert.equal(computeAuctionRiskScore({ cost:15 }, 25).level, 'RISKY', 'close to benchmark -> RISKY');
assert.equal(computeAuctionRiskScore({ cost:40 }, 25).level, 'DO NOT $1 START', 'cost exceeding benchmark -> DO NOT $1 START');
assert.equal(computeAuctionRiskScore({ cost:150 }, 0).level, 'DO NOT $1 START', 'a $150-cost item with no history must NOT be waved through as safe just because it has no benchmark yet');

function classifyShowLosses(soldItems){
  const byBuyer = new Map();
  soldItems.forEach(r => { const key=r.buyer_customer_id||r.buyer_name||''; if(!key)return; if(!byBuyer.has(key))byBuyer.set(key,[]); byBuyer.get(key).push(r); });
  return soldItems.map(r => {
    const priceCents=Number(r.sold_price_cents||0), costCents=Number(r.cost_cents||0);
    const loss = priceCents<costCents ? (costCents-priceCents)/100 : 0;
    if(loss<=0) return { ...r, lossType:null, loss:0 };
    const key = r.buyer_customer_id||r.buyer_name||'';
    const buyerItems = key ? (byBuyer.get(key)||[]) : [];
    const buyerOtherProfit = buyerItems.filter(x=>x.id!==r.id).reduce((s,x)=>s+(Number(x.sold_price_cents||0)-Number(x.cost_cents||0))/100,0);
    return { ...r, lossType: (key && buyerOtherProfit>=loss) ? 'acquisition' : 'bad_loss', loss };
  });
}
{
  // Buyer "Jess" loses $5 on the opener but spends $40 profit elsewhere -> acquisition.
  const items = [
    { id:'1', buyer_name:'Jess', sold_price_cents:100, cost_cents:600 }, // -$5 loss
    { id:'2', buyer_name:'Jess', sold_price_cents:5000, cost_cents:1000 }, // +$40 profit
  ];
  const result = classifyShowLosses(items);
  assert.equal(result.find(x=>x.id==='1').lossType, 'acquisition', 'a loss more than offset by the same buyer\'s other purchases must be acquisition, not a bad loss');
}
{
  // Buyer "Tony" loses $5 with no other purchases -> bad loss.
  const items = [{ id:'1', buyer_name:'Tony', sold_price_cents:100, cost_cents:600 }];
  const result = classifyShowLosses(items);
  assert.equal(result[0].lossType, 'bad_loss', 'a loss with no offsetting purchase must be an unexplained bad loss');
}
{
  // No buyer name captured at all -> can't classify as acquisition even if it happens to look profitable overall.
  const items = [{ id:'1', sold_price_cents:100, cost_cents:600 }];
  const result = classifyShowLosses(items);
  assert.equal(result[0].lossType, 'bad_loss', 'a loss with no captured buyer must never be assumed to be acquisition');
}

console.log('Whatnot live intelligence functional checks passed');
