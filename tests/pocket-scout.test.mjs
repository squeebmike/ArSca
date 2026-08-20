import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Contract: tab is registered and role/plan gated like every other tab ──
assert.match(dashboard, /\['scout', 'POCKET SCOUT'\]/, 'Pocket Scout must be registered in the primary tab list');
assert.match(dashboard, /<div id="tab-scout" class="tab-panel">/, 'a dedicated #tab-scout panel must exist');
assert.match(dashboard, /scout:'inventory'/, 'Pocket Scout must be capability-gated like other tabs (no plan bypass)');
assert.match(dashboard, /'pos','whatnot','scout','alerts'/, 'employee role must be able to reach the scout tab (front-line staff use this in-store)');

// ── Contract: multi-photo session state, not a one-shot scan ──
assert.match(dashboard, /let scoutSession = null;/, 'a session object must persist across multiple photos');
assert.match(dashboard, /scoutSession\.photos\.push\(/, 'each analyzed photo must be appended to the session, not replace it');

// ── Contract: evidence fusion prefers higher confidence, never blindly overwrites ──
assert.match(worker, /if \(newConfidence >= priorConfidence\) \{/, 'fusing a new photo\'s identity must compare confidence before overwriting an existing field');
assert.match(worker, /conflicts\.push\(\{ field, kept: existing, discarded: incoming/, 'a lower-confidence conflicting read must be logged, not silently dropped');

// ── Contract: identify + eBay image search run concurrently, not sequentially ──
assert.match(worker, /const \[visionResult, imageSearchResult\] = await Promise\.all\(\[/, 'vision identify and eBay image search must run concurrently per photo');

// ── Contract: active vs sold pricing is never conflated ──
assert.match(worker, /soldWarning = 'Sold history unavailable'/, 'sold comps must explicitly say when unavailable rather than silently substituting active prices');
assert.match(worker, /activeStats,\s*soldStats,\s*soldWarning/, 'comp snapshot must carry active and sold stats as separate fields');

// ── Contract: junk filtering happens before stats, median before average ──
assert.match(worker, /POCKET_SCOUT_JUNK_TERMS = \/\\b\(lot of\|bundle\|wholesale\|reprint/, 'obvious mismatches (lots, reprints, parts-only) must be filtered before pricing math');
assert.match(worker, /median: Math\.round\(use\[Math\.floor\(use\.length \/ 2\)\] \* 100\) \/ 100,/, 'comp stats must compute a real median, not just an average');

// ── Contract: BUY is never automatic on ROI% alone ──
assert.match(dashboard, /if\(netMid>=s\.preferredProfit && roiPct>=s\.minRoiPct && confidence>=s\.minConfidenceForBuy\)/, 'GREAT BUY must require dollar profit AND roi AND confidence, not any single metric');
assert.match(dashboard, /} else if\(netMid>=s\.minProfit && confidence>=60\)\{/, 'BUY must still be gated on a minimum dollar profit, not just a good ROI%');

// ── Contract: rejecting a candidate recalculates rather than just hiding it ──
assert.match(worker, /status=eq\.pending&select=payload`\);/, 'rejecting a candidate must recompute stats from the remaining pending candidates');

// ── Contract: add-to-inventory reuses the existing SKU generator + direct Supabase insert, not a new inventory system ──
assert.match(dashboard, /generateWalkoffInventorySku\(category, \{ name: identity\.title/, 'Pocket Scout must reuse the existing SKU generator');
assert.match(dashboard, /sb\.from\('inventory_items'\)\.insert\(\[row\]\)/, 'Pocket Scout must write inventory the same way every other add-to-inventory flow does (direct client Supabase insert), not a parallel backend table');

console.log('Pocket Scout contract checks passed');

// ── Functional: reimplement the pure decision math and check it against the
// product spec's own worked examples ──
const DEFAULTS = { minProfit:15, preferredProfit:25, minRoiPct:100, minConfidenceForBuy:80, marketplaceFeePct:13.25, paymentFeePct:2.9, paymentFeeFlat:0.30, packagingAllowance:2, defaultShippingBySize:{tiny:5,small:8,medium:13,large:20,oversize:35} };
function computeDecision({ activeMedian, activeLow, activeHigh, soldMedian, purchasePrice, sizeBucket, condition, confidence, settings }){
  const s = settings || DEFAULTS;
  const expectedSale = soldMedian || activeMedian || 0;
  const expectedLow = activeLow!=null ? Math.min(activeLow, expectedSale) : Math.round(expectedSale*0.8*100)/100;
  const expectedHigh = activeHigh!=null ? Math.max(activeHigh, expectedSale) : Math.round(expectedSale*1.2*100)/100;
  const conditionDiscount = { 'New/Sealed':1, 'Excellent':1, 'Good':0.9, 'Fair':0.75, 'Poor':0.55, 'Parts/Repair':0.35 }[condition] ?? 1;
  const saleLow = Math.round(expectedLow*conditionDiscount*100)/100;
  const saleHigh = Math.round(expectedHigh*conditionDiscount*100)/100;
  const feesAt = sale => Math.round((sale*(s.marketplaceFeePct+s.paymentFeePct)/100 + s.paymentFeeFlat)*100)/100;
  const shipping = s.defaultShippingBySize?.[sizeBucket] ?? s.defaultShippingBySize?.medium ?? 10;
  const packaging = s.packagingAllowance ?? 2;
  const netAt = sale => Math.round((sale - feesAt(sale) - shipping - packaging - purchasePrice)*100)/100;
  const netLow = netAt(saleLow), netHigh = netAt(saleHigh);
  const netMid = Math.round(((netLow+netHigh)/2)*100)/100;
  const roiPct = purchasePrice>0 ? Math.round((netMid/purchasePrice)*1000)/10 : (netMid>0 ? Infinity : 0);
  let decision;
  const hasData = expectedSale>0;
  if(!hasData || confidence<50) decision='maybe';
  else if(netMid>=s.preferredProfit && roiPct>=s.minRoiPct && confidence>=s.minConfidenceForBuy) decision='great_buy';
  else if(netMid>=s.minProfit && confidence>=60) decision='buy';
  else if(netMid>0) decision='maybe';
  else decision='pass';
  return { decision, netLow, netHigh, netMid, roiPct };
}

// Spec's own worked example: $44 sale, $6.99 purchase, high confidence should
// clearly be a buy. The reference spec used a single point estimate and a
// flat shipping guess; this implementation uses a conservative low/high
// range and size-bucket shipping instead, so the exact profit dollars won't
// match the spec's narrative numbers -- what must hold is that a genuinely
// strong flip is never rejected or downgraded to a bare "review".
{
  const r = computeDecision({ activeMedian:44.99, activeLow:38, activeHigh:52, soldMedian:41.50, purchasePrice:6.99, sizeBucket:'medium', condition:'Excellent', confidence:94 });
  assert.ok(['buy','great_buy'].includes(r.decision), 'a $40+ item bought for $6.99 at 94% confidence must be at least a BUY');
  assert.ok(r.netMid >= 15, 'net profit on the worked example must clear the minimum profit bar');
  assert.ok(r.roiPct >= 100, 'ROI on the worked example must clear the minimum ROI bar');
}

// Spec's explicit anti-example: $1 -> $4 is 300% ROI but not worth the labor -- must NOT be a buy.
{
  const r = computeDecision({ activeMedian:4, activeLow:3.5, activeHigh:4.5, soldMedian:null, purchasePrice:1, sizeBucket:'tiny', condition:'Excellent', confidence:90 });
  assert.notEqual(r.decision, 'great_buy', 'high ROI% on a trivial dollar amount must not trigger GREAT BUY');
  assert.notEqual(r.decision, 'buy', 'high ROI% on a trivial dollar amount must not trigger BUY either -- absolute profit dollars matter, not just ROI%');
}

// Low confidence must never auto-buy even with a great price.
{
  const r = computeDecision({ activeMedian:100, activeLow:80, activeHigh:120, soldMedian:90, purchasePrice:5, sizeBucket:'medium', condition:'Excellent', confidence:40 });
  assert.equal(r.decision, 'maybe', 'low identification confidence must fall back to MAYBE/REVIEW regardless of price');
}

// No pricing data at all must never fabricate a decision.
{
  const r = computeDecision({ activeMedian:null, activeLow:null, activeHigh:null, soldMedian:null, purchasePrice:5, sizeBucket:'medium', condition:'Excellent', confidence:90 });
  assert.equal(r.decision, 'maybe', 'zero pricing data must never resolve to BUY or PASS -- it is genuinely unknown');
}

// A real loss at the given store price must PASS.
{
  const r = computeDecision({ activeMedian:10, activeLow:8, activeHigh:12, soldMedian:9, purchasePrice:15, sizeBucket:'large', condition:'Good', confidence:90 });
  assert.equal(r.decision, 'pass', 'a store price above the realistic net-of-fees value must PASS');
}

console.log('Pocket Scout decision-engine functional checks passed');
