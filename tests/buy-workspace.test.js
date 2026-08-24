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
  assert.match(renderBuyListFn, /pctLbl\.textContent = Math\.round\(\(totalMkt > 0 \? \(offer \/ totalMkt\) : pct\) \* 100\) \+ '%';/, 'Offer % must show the EFFECTIVE blended rate (offer/totalMkt), not the raw slider target, so it always cross-multiplies with Market Value');
  const updateBuyListOfferFn = html.slice(html.indexOf('function updateBuyListOffer(){'), html.indexOf('\nfunction setBuyOfferPct('));
  assert.doesNotMatch(updateBuyListOfferFn, /lbl\.textContent = pct \+ '%';/, 'updateBuyListOffer must not still write the raw slider % onto bl-pct-lbl -- renderBuyList is the single owner of that stat now');
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
