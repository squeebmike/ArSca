const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'dashboard.html'), 'utf8');

assert.match(html, /function buyPriceOptionsFromResearch\(/, 'Research price matrix must be carried into Buy');
assert.match(html, /field === 'priceOption'/, 'Buy must resolve condition\/finish selections locally');
assert.match(html, /manualMarketOverride = false/, 'Researched price selection must clear market overrides');
assert.match(html, /manualOfferOverride = false/, 'Researched price selection must clear offer overrides');

const updateBuyItem = html.match(/function updateBuyItem\([\s\S]*?\r?\n}\r?\n\r?\nfunction resetBuyItemPricing/)?.[0] || '';
assert.ok(updateBuyItem, 'updateBuyItem function was not found');
assert.doesNotMatch(updateBuyItem, /\bfetch\s*\(/, 'Buy dropdown changes must not call an API');

const selectedQuickResult = html.match(/async function selectQuickLookupResult\([\s\S]*?\r?\n}\r?\n\r?\nfunction normalizeQuickCategory/)?.[0] || '';
assert.ok(selectedQuickResult, 'selectQuickLookupResult function was not found');
assert.match(selectedQuickResult, /const inventoryUnavailable = r\.source === 'inventory'/, 'Selected Research result must define its inventory availability before rendering cart actions');

assert.match(html, /APPLY \$\$\{tradeTotal\.toFixed\(2\)\} TO PURCHASE/, 'Accepted buys must offer a direct trade-in-toward-purchase action');
assert.match(html, /pos_pending_trade_purchase/, 'Trade-in purchase handoff must persist until checkout');
assert.match(html, /trade_credit_same_visit/, 'Trade-in value must apply to the same visit only, never a persisted store-credit ledger entry');
assert.doesNotMatch(html, /function issueStoreCredit/, 'Trade-in buys must not create a persisted, redeemable-later store credit record');
assert.match(html, /id="bl-trade-btn"[^>]+onclick="acceptBuyAsTrade\(\)"/, 'Buy screen must expose a direct Trade to Sale action');
assert.match(html, /async function acceptBuyAsTrade\(/, 'Direct trade workflow must accept the buy without a second payout modal');
assert.match(html, /switchTab\('display'\)/, 'Direct trade workflow must open the Sell screen');
assert.match(html, /TRADE CREDIT/, 'Sell screen must label pending trade credit');
assert.match(html, /trade\.applied\.toFixed\(2\)/, 'Sell screen must visibly subtract the calculated trade credit');
assert.match(html, /selectedTenderLines = \[\{ method:'trade_credit'/, 'Checkout must automatically carry the pending trade credit tender');
assert.match(html, /Accept the offer before adding this item to inventory/, 'A staged Buy item must be blocked from inventory conversion before acceptance');
assert.match(html, /class="buy-tray-offer-only"/, 'Open Buy trays must label staged rows as offer-only instead of exposing +INV');
assert.match(html, /\/kv\/sale_carts_index/, 'Open sale carts must publish a shared cross-device index');
assert.match(html, /\/kv\/sale_cart_/, 'Each customer sale cart must have its own shared Worker record');
assert.match(html, /function switchSaleCart\(/, 'Registers must be able to join another customer sale cart');
assert.match(html, /tradeCredit:cartData\.tradeCredit \?\? current\.tradeCredit/, 'Trade credit must persist inside the shared sale cart');
const liveDealerCart = html.slice(html.lastIndexOf('function renderDealerCartTools('), html.indexOf('async function lockCheckoutForPayment()', html.lastIndexOf('function renderDealerCartTools(')));
assert.match(liveDealerCart, /i\.imageUrl/, 'Sell lines must render the stored imageUrl fallback');
assert.match(liveDealerCart, /dealer-price-breakdown/, 'Sell lines must render an editable price breakdown');
assert.doesNotMatch(liveDealerCart, /dealer-profit|\bCost\b|\bProfit\b/, 'Sell screen must not render cost or profit');

assert.match(html, /function renderCustomerLiveCart\(/, 'Customer display must support live cart review');
assert.match(html, /image_url:item\.img \|\| item\.image/, 'Checkout snapshot must retain item images');
assert.match(html, /function rollbackSpreadsheetImport\(/, 'Device CSV imports must be rollback-capable');
assert.match(html, /value="skip">Skip duplicates/, 'CSV import must default to safe duplicate handling');

// The Offer % stat sits next to Market Value/Your Offer/Profit Spread as if
// it's a fourth fact about the same tray total -- but it used to just echo
// the raw slider position, which any item with a manual per-item cashOffer
// override (buyItemOfferValue) ignores. That let it show e.g. 100% while
// Your Offer/Profit Spread reflected a lower blended rate, looking like
// broken math (confirmed live: $91.25 market, "100%", but an $82 offer).
{
  const renderBuyListFn = html.slice(html.indexOf('function renderBuyList(){'), html.indexOf('\nfunction printBuyOffer('));
  assert.ok(renderBuyListFn, 'renderBuyList function was not found');
  assert.match(renderBuyListFn, /const effectivePct = Math\.round\(\(totalMkt > 0 \? \(offer \/ totalMkt\) : pct\) \* 100\);/, 'Offer % must show the EFFECTIVE blended rate (offer/totalMkt), not the raw slider target, so it always cross-multiplies with Market Value');
  assert.match(renderBuyListFn, /if\(pctLbl\) pctLbl\.textContent = effectivePct \+ '%';/, 'the effective % must actually be written to bl-pct-lbl');
  // The raw slider position (bl-pct) is a genuinely separate control (the
  // default % for NEW items) that a manual per-item offer can legitimately
  // diverge from -- surface that only when it actually does. A first attempt
  // compared the slider % against effectivePct, which flickered on for
  // almost any fractional market price with NO override at all: a single
  // $36.88 item at a 100% slider already lands effectivePct on 98% purely
  // from buyItemOfferValue's own floor-to-whole-dollar rounding. A RESET ALL
  // button added alongside that noisy check made it worse, not better --
  // the store explicitly does not want a bulk reset, and flooring the basis
  // price before the % math (see buyItemPricingBasis below) makes the
  // effective rate match the slider exactly in the common case anyway.
  // Checking the real per-item flag directly is the correct, non-flickering
  // signal for whether the note should show at all.
  assert.match(renderBuyListFn, /if\(sliderNote\) sliderNote\.style\.display = buyList\.some\(i => i\.manualOfferOverride\) \? '' : 'none';/, 'the slider note must only show when a real per-item override exists, not from an effectivePct comparison that can flicker on ordinary rounding');
  assert.doesNotMatch(renderBuyListFn, /const diverges/, 'must not reintroduce the percentage-comparison divergence heuristic');
  assert.match(html, /id="bl-pct-slider-note"/, 'a note explaining the slider is a separate "default for new items" control must exist near it');
  assert.doesNotMatch(html, /bl-reset-all-offers|resetAllBuyOffersToSlider/, 'the RESET ALL button and its handler must not exist -- store policy is no bulk reset of manual offers');
  const updateBuyListOfferFn = html.slice(html.indexOf('function updateBuyListOffer(){'), html.indexOf('\nfunction setBuyOfferPct('));
  assert.doesNotMatch(updateBuyListOfferFn, /lbl\.textContent = pct \+ '%';/, 'updateBuyListOffer must not still write the raw slider % onto bl-pct-lbl -- renderBuyList is the single owner of that stat now');
}

// Store buy policy: the guide/market price used as the basis for an offer
// rounds DOWN to the nearest whole dollar FIRST, before the slider % is
// applied -- not multiplied while fractional and only rounded at the end.
// Confirmed live: a $36.88 item at a 100% slider used to compute
// floor(36.88 * 1.00) = $36.00, an $0.88 "profit" on paper for a full-value
// offer, purely from leftover fractional cents.
{
  assert.match(html, /function buyItemPricingBasis\(item\)\{/, 'missing buyItemPricingBasis');
  const basisFn = html.slice(html.indexOf('function buyItemPricingBasis(item){'), html.indexOf('\nfunction ', html.indexOf('function buyItemPricingBasis(item){') + 1));
  assert.match(basisFn, /return raw > 0 \? Math\.floor\(raw\) : 0;/, 'buyItemPricingBasis must floor the raw market price to a whole dollar');
  const offerValueFn = html.slice(html.indexOf('function buyItemOfferValue(item){'), html.indexOf('\nfunction buyItemMarketValue('));
  assert.match(offerValueFn, /return roundBuyOffer\(buyItemPricingBasis\(item\) \* pct\);/, 'buyItemOfferValue must apply the slider % to the whole-dollar basis, not the raw fractional market price');
  // Bargain-bin bracket: any card under $2 guide value skips the normal %
  // math -- a percentage of a bulk common at $0.10-$0.35, or of a
  // $1.01-$1.99 card, doesn't land on a sane whole-dollar number either
  // way. Store policy: a flat $1.00 at a full (100%) offer, $0.50 below
  // that -- confirmed explicitly by the store owner for both sub-$1 bulk
  // commons and the $1.01-$1.99 range as one unified bracket.
  assert.match(offerValueFn, /if\(raw > 0 && raw < 2\) return pct >= 1 \? 1 : 0\.5;/, 'buyItemOfferValue must apply the flat $1.00/$0.50 bargain-bin bracket for any item under $2, before falling through to the normal whole-dollar-basis % math');
  // The bracket returns a real $0.50 half-dollar -- every place that shows
  // an offer amount must format it with cents (toFixed(2)), not Math.round(),
  // which rounds 0.5 UP to 1 (JS round-half-up) and would silently turn a
  // $0.50 bargain-bin offer into a displayed $1.00.
  // (tradeCreditOffer's Math.round(buyItemOfferValue(i) * 1.15 * 100) / 100
  // is a safe cents-preserving round, not the whole-dollar-corrupting kind.)
  assert.doesNotMatch(html, /Math\.round\(buyItemOfferValue\(i\)\)/, 'no display site may wrap buyItemOfferValue in a bare Math.round() -- it corrupts a real $0.50 bracket offer up to $1 on screen');
  assert.doesNotMatch(html, /Math\.round\(offer\)/, 'the Your Offer stat must not Math.round() the tray total -- use toFixed(2) so a $0.50 contribution displays correctly');
  assert.doesNotMatch(html, /Math\.round\(total\)/, 'the PAY CUSTOMER total must not Math.round() -- use toFixed(2) so a $0.50 bracket contribution displays correctly');
  assert.doesNotMatch(html, /Math\.round\(totals\.offerTotal/, 'no buy-session total display may Math.round() totals.offerTotal -- use toFixed(2)');
  assert.doesNotMatch(html, /Math\.round\(p\.total\)/, 'the tray switcher pill must not Math.round() a tray total -- use toFixed(2)');
}

// A card research genuinely can't find a price for still has to be
// buyable -- staff type the customer's offer straight into the $offer
// field with no researched market behind it. Market Value only ever
// summed item.market, so that item's offer counted on the "Your Offer"
// side of Profit Spread and nothing on the "Market Value" side --
// confirmed this could silently zero out the whole tray's displayed
// spread even with healthy margin on every other item.
{
  assert.match(html, /function buyItemMarketValue\(item\)\{/, 'missing buyItemMarketValue');
  const marketValueFn = html.slice(html.indexOf('function buyItemMarketValue(item){'), html.indexOf('\nfunction ', html.indexOf('function buyItemMarketValue(item){') + 1));
  assert.match(marketValueFn, /if\(basis > 0\) return basis;/, 'buyItemMarketValue must use the whole-dollar basis (buyItemPricingBasis) when a real market price exists, so Market Value/Offer/Spread all derive from the same rounded number');
  assert.match(marketValueFn, /return item\.manualOfferOverride \? buyItemOfferValue\(item\) : 0;/, 'an unpriced item must fall back to its own manual offer as a stand-in market value (net $0 spread contribution), not silently contribute $0 to Market Value while its offer still counts toward Your Offer');
  // All three places that sum a tray's market total must use the shared
  // helper -- a raw Number(i.market||0) sum anywhere reintroduces the bug.
  assert.doesNotMatch(html, /reduce\(\(a,i\)\s*=>\s*a\+Number\(i\.market\|\|0\),0\)/, 'no market-total sum may bypass buyItemMarketValue');
  assert.doesNotMatch(html, /reduce\(\(a,i\)\s*=>\s*a\+\(Number\(i\.market\)\s*\|\|\s*0\),\s*0\)/, 'no market-total sum may bypass buyItemMarketValue');
  assert.match(html, /const marketTotal = Math\.round\(items\.reduce\(\(a,i\)=>a\+buyItemMarketValue\(i\),0\) \* 100\) \/ 100;/, 'snapshotBuySession (accepted-offer totals) must use buyItemMarketValue');
  assert.match(html, /const totalMkt = buyList\.reduce\(\(a,i\) => a \+ buyItemMarketValue\(i\), 0\);/, 'renderBuyList (live tray display) must use buyItemMarketValue');
  assert.match(html, /const marketTotal = buyList\.reduce\(\(a,i\)=>a\+buyItemMarketValue\(i\),0\);/, 'getBuyOfferTotals (logged buy-offer totals) must use buyItemMarketValue');
  assert.match(html, /tray\.marketTotal = Math\.round\(buyList\.reduce\(\(a,i\)=>a\+buyItemMarketValue\(i\),0\) \* 100\) \/ 100;/, 'saveBuyList (the synced tray record) must use buyItemMarketValue');
}

// ── Contract: TEXT OFFER's sms: handoff to the staff device's own
// messaging app must keep working unchanged (free, needs no setup), but a
// second option must exist to actually send through Twilio for real --
// gated on an explicit, fully-disclosed SMS-consent checkbox, same pattern
// as the receipt-capture screen. ──
assert.match(html, /<button class="hbtn" onclick="textBuyOffer\(\)" style="font-size:10px">📱 Text Offer<\/button>/, 'the original native sms: TEXT OFFER button must be unchanged');
assert.match(html, /<input id="bl-sms-consent" type="checkbox"/, 'a named SMS-consent checkbox must exist next to the buy-offer phone field');
assert.match(html, /Reply STOP to opt out or HELP for help\. Consent is not a condition of any purchase or sale\./, 'the buy-offer consent checkbox must disclose STOP/HELP and that consent is not a condition of the sale');
assert.match(html, /<button class="hbtn" onclick="textBuyOfferViaTwilio\(\)"/, 'an Auto-Text Offer button must exist to actually send through Twilio');
{
  const fnStart = html.indexOf('async function textBuyOfferViaTwilio(){');
  assert(fnStart >= 0, 'textBuyOfferViaTwilio function was not found');
  const fnEnd = html.indexOf('\n}', fnStart);
  const fn = html.slice(fnStart, fnEnd);
  assert.match(fn, /if\(document\.getElementById\('bl-sms-consent'\)\?\.checked !== true\)\{ toast_dash\('Check the SMS-consent box above first'\); return; \}/, 'the Twilio send must be gated on the consent checkbox, not implied by entering a phone number');
  assert.match(fn, /storeWorkerFetch\('\/notify\/send', \{ method:'POST', headers:\{'Content-Type':'application\/json'\}, body:JSON\.stringify\(\{ contact:phone, subject:'Your buy offer', message:buildBuyOfferText\(\), consent:true \}\) \}\)/, 'the Twilio send must reuse the existing /notify/send route and the same buildBuyOfferText() content TEXT OFFER and PRINT OFFER already use, not a separate message builder');
}

console.log('Buy workspace contract checks passed');
