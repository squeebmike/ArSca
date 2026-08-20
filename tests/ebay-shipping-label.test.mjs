import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: sell.logistics must NOT be in the actively-requested OAuth
// scope list. eBay validates every requested scope atomically -- an app
// whose production keyset hasn't separately been approved for a given
// scope gets the ENTIRE /oauth2/authorize request rejected with
// invalid_scope before the seller ever sees a login screen, which blocks
// reconnecting every other eBay feature too, not just this one. A store
// that connected before Logistics scope approval must instead be told to
// reconnect once buy-label actually needs it (via needsReconnect below),
// never by breaking OAuth outright. ──
assert.doesNotMatch(worker, /const EBAY_SCOPES = \[[\s\S]*?sell\.logistics[\s\S]*?\]\.join\(' '\);/, 'EBAY_SCOPES must not request sell.logistics until it is approved for the production keyset, or reconnecting eBay breaks entirely with invalid_scope');

console.log('eBay Logistics OAuth scope contract checks passed');

// ── Contract: all four Logistics routes exist with the right method/shape ──
assert.match(worker, /if \(url\.pathname === '\/ebay\/orders\/shipping-quote' && request\.method === 'POST'\)/, 'shipping-quote route must exist');
assert.match(worker, /if \(url\.pathname === '\/ebay\/orders\/buy-label' && request\.method === 'POST'\)/, 'buy-label route must exist');
assert.match(worker, /const ebayLabelFileMatch = url\.pathname\.match\(\/\^\\\/ebay\\\/orders\\\/shipping-label\\\/\(\[\^\/\]\+\)\$\/\);/, 'label file download route must match /ebay/orders/shipping-label/:shipmentId');
assert.match(worker, /const ebayLabelCancelMatch = url\.pathname\.match\(\/\^\\\/ebay\\\/orders\\\/shipping-label\\\/\(\[\^\/\]\+\)\\\/cancel\$\/\);/, 'label cancel route must match /ebay/orders/shipping-label/:shipmentId/cancel');

console.log('eBay Logistics route existence contract checks passed');

// ── Contract: the request/response shapes match what the eBay Logistics API
// actually expects/returns (endpoint paths, field names) ──
const quoteRouteSrc = worker.slice(worker.indexOf("url.pathname === '/ebay/orders/shipping-quote'"), worker.indexOf("url.pathname === '/ebay/orders/buy-label'"));
assert.match(quoteRouteSrc, /EBAY_LOGISTICS_BASE \+ '\/shipping_quote'/, 'quote request must hit the shipping_quote resource');
assert.match(quoteRouteSrc, /JSON\.stringify\(\{ orders: \[\{ orderId \}\], packageSpecification \}\)/, 'quote request body must nest orderId under an orders array and include packageSpecification');
assert.match(quoteRouteSrc, /rateId: r\.rateId,/, 'each returned rate must carry its rateId, required to later purchase it');
assert.match(quoteRouteSrc, /cost: Number\(r\.baseShippingCost\?\.value \|\| 0\),/, 'rate cost must come from baseShippingCost.value');

const buyRouteSrc = worker.slice(worker.indexOf("url.pathname === '/ebay/orders/buy-label'"), worker.indexOf("const ebayLabelFileMatch"));
assert.match(buyRouteSrc, /EBAY_LOGISTICS_BASE \+ '\/shipment\/create_from_shipping_quote'/, 'purchase request must hit the create_from_shipping_quote resource');
assert.match(buyRouteSrc, /JSON\.stringify\(\{ shippingQuoteId, rateId \}\)/, 'purchase request body must carry shippingQuoteId and rateId');
assert.match(buyRouteSrc, /await pushEbayTrackingBestEffort\(ebayToken, orderId, lineItemIds, trackingNumber, carrierCode\);/, 'a successful purchase must also push tracking back to eBay');

console.log('eBay Logistics request/response shape contract checks passed');

// ── Contract: the label download proxies the correct Accept header per
// requested format and streams the file back as binary, not JSON ──
const labelFileRouteSrc = worker.slice(worker.indexOf('const ebayLabelFileMatch'), worker.indexOf('const ebayLabelCancelMatch'));
assert.match(labelFileRouteSrc, /const acceptType = format === 'zpl' \? 'application\/zpl' : 'application\/pdf';/, 'the Accept header must switch between PDF and ZPL based on the requested format');
assert.match(labelFileRouteSrc, /'Accept': acceptType/, 'the Accept header must actually be sent on the upstream eBay request');
assert.match(labelFileRouteSrc, /return new Response\(buf, \{/, 'the label file must be returned as a raw binary Response, not wrapped in json()');

console.log('eBay label file proxy contract checks passed');

// ── Contract: a purchase failure must never block on the best-effort
// tracking push -- pushEbayTrackingBestEffort must swallow its own errors ──
const helperSrc = worker.slice(worker.indexOf('async function pushEbayTrackingBestEffort'), worker.indexOf('// POST /ebay/orders/shipping-quote'));
assert.match(helperSrc, /catch \(e\) \{ \/\* best-effort -- the label purchase already succeeded \*\/ \}/, 'pushEbayTrackingBestEffort must catch and discard its own errors so a tracking-push failure never fails the label purchase response');

console.log('Best-effort tracking push contract checks passed');

// ── Contract: dashboard wiring -- BUY LABEL only appears for orders that
// still need shipping, and the full modal flow is present ──
assert.match(dashboard, /onclick="openBuyLabelModal\(\\''\+escHtml\(o\.orderId\)\+'\\'\)">BUY LABEL<\/button>/, 'a BUY LABEL button must exist per-order');
assert.match(dashboard, /\$\{needsShip \? ' · <button class="hbtn" style="padding:2px 7px;font-size:9px;color:var\(--gold\)" onclick="openBuyLabelModal/, 'BUY LABEL must only render for orders that still need shipping, same gating as MARK SHIPPED');
assert.match(dashboard, /async function fetchEbayShippingRates\(\)\{/, 'fetchEbayShippingRates must exist');
assert.match(dashboard, /function renderEbayShippingRates\(\)\{/, 'renderEbayShippingRates must exist');
assert.match(dashboard, /async function confirmBuyEbayLabel\(\)\{/, 'confirmBuyEbayLabel must exist');
assert.match(dashboard, /async function printEbayLabel\(shipmentId, format\)\{/, 'printEbayLabel must exist');
assert.match(dashboard, /if\(rate && !confirm\(`Buy this \$\{rate\.serviceName\|\|rate\.carrierCode\} label for \$\$\{rate\.cost\.toFixed\(2\)\}\? This charges your eBay account\.`\)\) return;/, 'buying a label must require an explicit confirm naming the real charge amount before it fires -- nothing should purchase silently');

// ── Contract: since sell.logistics is deliberately not requested during
// OAuth, a needsReconnect response from the quote/buy-label routes must
// never tell the seller that clicking CONNECT EBAY again will fix it --
// that message would be false until the scope is actually approved. ──
assert.match(dashboard, /d\.needsReconnect \? 'eBay has not approved this store for the Logistics API \(shipping labels\) yet -- reconnecting will not fix this until that scope is approved in the eBay Developer Portal' : \(d\.error \|\| 'Could not get shipping rates'\)/, 'the shipping-quote failure message must not claim reconnecting will fix a missing Logistics scope');
assert.match(dashboard, /d\.needsReconnect \? 'eBay has not approved this store for the Logistics API \(shipping labels\) yet -- reconnecting will not fix this until that scope is approved in the eBay Developer Portal' : \(d\.error \|\| 'Label purchase failed'\)/, 'the buy-label failure message must not claim reconnecting will fix a missing Logistics scope');

console.log('Dashboard wiring contract checks passed');

// ── Functional: reimplement the rate-list sort (cheapest first) ──
function sortRates(rates){
  return rates.slice().sort((a, b) => a.cost - b.cost);
}
const rawRates = [
  { rateId:'r2', cost:12.50 },
  { rateId:'r1', cost:4.85 },
  { rateId:'r3', cost:8.10 },
];
assert.deepEqual(sortRates(rawRates).map(r => r.rateId), ['r1', 'r3', 'r2'], 'rates must be presented cheapest-first so the seller sees the best options up top');

// ── Functional: reimplement the packageSpecification builder -- dimensions
// are only attached when ALL THREE (length/width/height) are present,
// matching the actual worker logic, so a partially-filled dimension set
// never gets silently dropped down to one or two fields ──
function buildPackageSpec(weightValue, weightUnit, dims){
  const spec = { weight: { value: String(weightValue), unit: String(weightUnit || 'POUND').toUpperCase() } };
  if (Number(dims.length) > 0 && Number(dims.width) > 0 && Number(dims.height) > 0) {
    spec.dimensions = { length: String(dims.length), width: String(dims.width), height: String(dims.height), unit: String(dims.unit || 'INCH').toUpperCase() };
  }
  return spec;
}
assert.deepEqual(buildPackageSpec(1.5, 'pound', {}), { weight: { value:'1.5', unit:'POUND' } }, 'weight-only input must not include a dimensions block at all');
assert.deepEqual(
  buildPackageSpec(2, 'POUND', { length:8, width:5, height:2 }),
  { weight:{ value:'2', unit:'POUND' }, dimensions:{ length:'8', width:'5', height:'2', unit:'INCH' } },
  'a fully-specified package must include both weight and dimensions'
);
assert.deepEqual(
  buildPackageSpec(2, 'POUND', { length:8, width:5, height:0 }),
  { weight:{ value:'2', unit:'POUND' } },
  'a partially-filled dimension (missing height) must be dropped entirely rather than sent as a broken partial object'
);

console.log('Package spec / rate sort functional checks passed');

// ── Functional: reimplement the last-used-package localStorage round trip ──
function makeFakeLocalStorage(){
  const store = {};
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
  };
}
const fakeLS = makeFakeLocalStorage();
function saveLastPackage(ls, pkg){ ls.setItem('ebay_label_last_package', JSON.stringify(pkg)); }
function lastPackage(ls){ try { return JSON.parse(ls.getItem('ebay_label_last_package') || 'null') || {}; } catch(e) { return {}; } }

assert.deepEqual(lastPackage(fakeLS), {}, 'no prior package must yield an empty object, never throw');
saveLastPackage(fakeLS, { weightValue:3, weightUnit:'POUND', length:'10', width:'6', height:'3' });
assert.deepEqual(lastPackage(fakeLS), { weightValue:3, weightUnit:'POUND', length:'10', width:'6', height:'3' }, 'a saved package must round-trip exactly, so re-opening BUY LABEL later pre-fills the same box the seller used last time');

console.log('Last-used-package persistence functional checks passed');
