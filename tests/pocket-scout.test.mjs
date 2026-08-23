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

// ── Contract: a bulk sourcing trip can queue scouted items into the Buy
// List tray (Intake tab) instead of writing to inventory one at a time --
// reusing the existing buy/trade-in tray + accept flow rather than a new
// bulk-insert path. Unlike BUY + ADD INVENTORY (an immediate purchase that
// needs a real known cost), queueing to the tray does NOT require a store
// price -- the tray's own offer % does that math once accepted. What it
// does need is a comp price (the 100% basis that % is applied against),
// which the operator can see prefilled and can edit before sending. ──
assert.match(dashboard, /<button class="hbtn" id="scout-buy-tab-btn" onclick="scoutSendToBuyTab\(\)"/, 'a SEND TO BUY TAB button must exist alongside BUY + ADD INVENTORY');
assert.match(dashboard, /<input id="scout-comp-price" type="number"/, 'an editable comp-price field must exist so the operator controls the 100% basis sent to the buy tray');
assert.match(dashboard, /function scoutSendToBuyTab\(\)\{/, 'a dedicated handler must queue the scouted item into the buy tray');
assert.match(dashboard, /const compPrice = Number\(compPriceEl\?\.value\) \|\| scoutSession\.lastDecision\?\.expectedSale \|\| 0;/, 'sending to the buy tray must use the editable comp price (falling back to the computed expected sale), not the store-price field');
assert.match(dashboard, /if\(!\(compPrice>0\)\)\{ toast_dash\('Enter a comp price first'\)/, 'sending to the buy tray must require a comp price, not a store price');
assert.doesNotMatch(dashboard.slice(dashboard.indexOf('function scoutSendToBuyTab'), dashboard.indexOf('function scoutSendToBuyTab') + 2500), /manualOfferOverride/, 'the queued item must use the tray\'s normal percent-of-market offer math (buyItemOfferValue), not a manual override that bypasses the buy %');
assert.match(dashboard, /market: compPrice,/, 'the queued item\'s market must be the chosen comp price, so the tray\'s offer % (e.g. 80% of $100 = $80) applies to it like any other buy-tray item');
assert.match(dashboard, /imageUrl: photoUrls\[0\] \|\| '', images: photoUrls,/, 'every photo taken in the scout session, not just the first, must ride along to the buy tray so it survives into the eventual inventory record');
assert.match(dashboard, /buyList\.push\(item\);\s*\n\s*saveBuyList\(\);\s*\n\s*logOpsEvent\('buy_item_added', 'Sent Pocket Scout item to buy tray/, 'sending to the buy tray must reuse the existing buyList array + saveBuyList persistence, not a separate bulk-buy data model');
assert.match(dashboard, /sb\.from\('inventory_items'\)\.insert\(\[row\]\)/, 'Pocket Scout must write inventory the same way every other add-to-inventory flow does (direct client Supabase insert), not a parallel backend table');

// ── Contract: photos taken in a scout session become the inventory item's
// images (all of them, not just the first) whether the item goes straight
// to inventory (BUY + ADD INVENTORY) or via the buy tray -- and that image
// data must actually reach the final inventory row's data, not get dropped
// by buyItemToInventoryUpdates() along the way (a real pre-existing gap:
// that function built the inventory update object from scratch and never
// carried image/imageUrl over at all). ──
assert.match(dashboard, /image: scoutSession\.photos\?\.\[0\]\?\.url \|\| '',\s*\n\s*images: \(scoutSession\.photos\|\|\[\]\)\.map\(p=>p\.url\)\.filter\(Boolean\),/, 'BUY + ADD INVENTORY must save every scout photo, not just the first, as the item\'s images');
assert.match(dashboard, /image:item\.imageUrl \|\| item\.images\?\.\[0\] \|\| '',\s*\n\s*images:\(item\.images && item\.images\.length\) \? item\.images : \(item\.imageUrl \? \[item\.imageUrl\] : \[\]\),/, 'buyItemToInventoryUpdates must explicitly carry the buy-tray item\'s photo(s) into the inventory update, not rely on an incidental object-spread that only works when the item has no .scan');

// ── Contract: trading cards / sports cards / comics get a real handoff into
// the Research tab's PriceCharting/TCGPlayer lookup instead of just a text
// hint telling the operator to go redo the search by hand there. Research's
// existing ADD TO BUY (addSelectedQuickLookupToBuyOffer) already queues into
// the same buyList tray using the real catalog market price with no manual
// price entry (manualOfferOverride:false), so this handoff only needs to
// get the operator there with the identified title already searched. ──
assert.match(dashboard, /function scoutSearchInResearch\(\)\{/, 'a dedicated handoff function into Research must exist');
assert.match(dashboard, /switchTab\('research'\);/, 'the handoff must switch to the actual Research tab');
assert.match(dashboard, /if\(input\) input\.value = query;\s*\n\s*runPriceLookup\(\);/, 'the handoff must pre-fill the Research search box and actually run the lookup, not just switch tabs and leave the operator to retype it');
assert.match(dashboard, /onclick="scoutSearchInResearch\(\)"/, 'the routeToCardPipeline hint must offer a clickable handoff, not just inert text');
{
  const makeBuyItemStart = dashboard.indexOf('const makeBuyItem = copyIndex => ({');
  assert(makeBuyItemStart >= 0, 'Research\'s ADD TO BUY must build its buy-tray item via a makeBuyItem factory');
  const makeBuyItemSlice = dashboard.slice(makeBuyItemStart, makeBuyItemStart + 1500);
  assert.match(makeBuyItemSlice, /market:item\.market,/, 'Research\'s own ADD TO BUY must already use the real catalog market price');
  assert.match(makeBuyItemSlice, /manualOfferOverride:false,/, 'Research\'s ADD TO BUY must not manually override cost, so the handoff needs no extra buy-tray plumbing of its own');
}

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
