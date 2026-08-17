import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const storefront = fs.readFileSync('storefront.html', 'utf8');

// ── Contract: SHIPPO_API_TOKEN is documented + surfaced in /health ──
assert.match(worker, / \*   SHIPPO_API_TOKEN\r?\n/, 'SHIPPO_API_TOKEN must be documented in the secrets header comment');
assert.match(worker, /shippo: !!env\.SHIPPO_API_TOKEN,/, '/health must report whether SHIPPO_API_TOKEN is configured');

console.log('Secrets documentation contract checks passed');

// ── Contract: buildShippingParcel picks an envelope only for small
// all-raw-singles orders, a box otherwise ──
const parcelFnSrc = worker.slice(worker.indexOf('function buildShippingParcel'), worker.indexOf('// Calls Shippo for a real'));
assert.match(parcelFnSrc, /const useEnvelope = allRawSingles && totalQuantity <= 3 && weightOz <= 6;/, 'envelope selection must require raw singles, low quantity, and low weight all at once');
assert.match(parcelFnSrc, /distance_unit:'in', weight:\(weightOz \/ 16\)\.toFixed\(2\), mass_unit:'lb'/, 'weight must be converted from ounces to pounds for both parcel shapes');

console.log('Parcel-builder contract checks passed');

// ── Contract: computeRealShippingFeeCents fails closed when Shippo or the
// ship-from address is unavailable; it must never invent a flat charge ──
const feeFnSrc = worker.slice(worker.indexOf('async function computeRealShippingFeeCents'), worker.indexOf('// ── Public storefront item shaping'));
assert.doesNotMatch(feeFnSrc, /300|700|fallback/, 'the real-rate function must not contain the legacy $3/$7 fallback');
assert.match(feeFnSrc, /if \(!token\) return \{ error:'Shipping is not configured yet\./, 'missing SHIPPO_API_TOKEN must make shipping unavailable');
assert.match(feeFnSrc, /if \(!origin \|\| !origin\.street1 \|\| !origin\.city \|\| !origin\.state \|\| !origin\.zip\) return \{ error:'Shipping is not configured yet\./, 'an incomplete ship-from address must make shipping unavailable');
assert.match(feeFnSrc, /} catch \(e\) \{\s*return \{ error:'A live shipping rate could not be retrieved\./, 'Shippo network failures must be caught and returned as a safe unavailable state');
assert.match(feeFnSrc, /Authorization': `ShippoToken \$\{token\}`/, 'Shippo auth must use the ShippoToken scheme, not Bearer');
assert.match(feeFnSrc, /rates\.sort\(\(a, b\) => a\.cost - b\.cost\);/, 'rates must be sorted so the cheapest one is charged');

console.log('Real shipping fee contract checks passed');

// ── Contract: checkout charges the real fee, and the
// same fee computation is reused for the customer-facing quote route ──
const checkoutRouteSrc = worker.slice(worker.indexOf("url.pathname === '/public/storefront/checkout'"), worker.indexOf("url.pathname === '/public/storefront/shipping-quote'"));
assert.match(checkoutRouteSrc, /const shippingQuote = method !== 'shipping' \? \{ cents: 0, real: false \} : await computeRealShippingFeeCents\(env, storeId, shippingAddress, totalQuantity, allRawSingles, totalWeightOz\);/, 'checkout must call computeRealShippingFeeCents for shipping orders and skip it entirely for pickup');
assert.match(checkoutRouteSrc, /if \(shippingQuote\.error\) return json\(\{ ok:false, error:shippingQuote\.error \}, shippingQuote\.status \|\| 503\);/, 'checkout must stop before payment when no verified live rate is available');

const quoteRouteSrc = worker.slice(worker.indexOf("url.pathname === '/public/storefront/shipping-quote'"), worker.indexOf("url.pathname === '/public/storefront/record-order'"));
assert.match(quoteRouteSrc, /request\.method === 'POST'/, 'the quote route must be POST');
assert.match(quoteRouteSrc, /const quote = await computeRealShippingFeeCents\(env, storeId, shippingAddress, cart\.totalQuantity, cart\.allRawSingles, cart\.totalWeightOz\);/, 'the quote route must call the exact same fee function checkout uses');
assert.match(quoteRouteSrc, /enforceUsageLimit\(env, `storefront-shipquote:\$\{storeId\}:\$\{ip\}`, 30, 3600\)/, 'the public quote route must be rate-limited like other public storefront routes');

console.log('Checkout + quote route wiring contract checks passed');

// ── Contract: dashboard exposes a Shipping Origin settings panel that
// round-trips through the same receipt_settings upsert as every other
// vendor-profile field (both writers, since either can fire last) ──
assert.match(dashboard, /shippingOrigin:\{ name:'', street1:'', street2:'', city:'', state:'', zip:'', phone:'' \},/, 'vendor profile defaults must include a structured shippingOrigin object');
const saveVendorProfileSrc = worker; // n/a, just keeping symmetry below
assert.match(dashboard, /shippingOrigin:next\.shippingOrigin \|\| \{\},/g, 'shippingOrigin must be present in the receipt_settings payload');
const shippingOriginWriteCount = (dashboard.match(/shippingOrigin:next\.shippingOrigin \|\| \{\},/g) || []).length;
assert.equal(shippingOriginWriteCount, 2, 'both saveVendorProfile and savePaymentSettings must carry shippingOrigin in their receipt_settings upsert, or one save will silently erase it');
assert.match(dashboard, /function saveShippingOriginSettings\(\)\{/, 'saveShippingOriginSettings must exist');
assert.match(dashboard, /const so = \{ name:'', street1:'', street2:'', city:'', state:'', zip:'', phone:'', \.\.\.\(p\.shippingOrigin \|\| \{\}\) \};/, 'renderVendorProfilePanel must merge shippingOrigin over safe defaults for rendering');

console.log('Dashboard shipping-origin settings contract checks passed');

// ── Contract: storefront.html requests a live real-rate quote as the
// customer fills in their address, and blocks payment until a verified rate
// is available ──
assert.match(storefront, /async function fetchLiveShippingQuote\(\)\{/, 'fetchLiveShippingQuote must exist');
assert.match(storefront, /const liveShippingQuoteDebounced=debounce\(fetchLiveShippingQuote, 600\);/, 'the live quote fetch must be debounced so every keystroke does not fire a network call');
assert.match(storefront, /oninput="liveShippingQuoteDebounced\(\)"/, 'address fields must trigger the debounced live quote on input');
assert.doesNotMatch(storefront, /function fallbackShippingFee\(\)\{/, 'the storefront must not retain the old flat-rate fallback');
assert.match(storefront, /btn\.disabled=needsQuote;/, 'shipping payment must stay disabled until a live quote is returned');
assert.match(storefront, /storeId:currentStoreId,\s*\n\s*items:cart\.map\(c=>\(\{itemId:c\.id, quantity:c\.qty\}\)\),\s*\n\s*destination:\{line1, line2:document\.getElementById\('ck-addr2'\)\?\.value\.trim\(\)\|\|'', city, state, zip\},/, 'the quote request body must carry the current cart and destination address');

console.log('Storefront live-quote wiring contract checks passed');

// ── Functional: reimplement buildShippingParcel and verify envelope vs box
// selection, and the oz->lb weight conversion ──
function buildShippingParcel(totalQuantity, allRawSingles, totalWeightOz){
  const weightOz = totalWeightOz + 2;
  const useEnvelope = allRawSingles && totalQuantity <= 3 && weightOz <= 6;
  return useEnvelope
    ? { length:'9', width:'6', height:'1', distance_unit:'in', weight:(weightOz / 16).toFixed(2), mass_unit:'lb' }
    : { length:'10', width:'8', height:String(Math.min(12, Math.max(3, Math.ceil(totalQuantity / 8) + 2))), distance_unit:'in', weight:(weightOz / 16).toFixed(2), mass_unit:'lb' };
}

const envelopeCase = buildShippingParcel(2, true, 2.4);
assert.equal(envelopeCase.length, '9', 'a small all-raw-singles order must use the padded envelope shape');
assert.equal(envelopeCase.weight, (4.4 / 16).toFixed(2), 'envelope weight must be raw item weight plus 2oz packaging, converted to lb');

const boxCase = buildShippingParcel(2, false, 12);
assert.equal(boxCase.length, '10', 'a sealed/graded item must use the box shape even at low quantity');

const bigOrderCase = buildShippingParcel(30, true, 40);
assert.equal(bigOrderCase.length, '10', 'a large order must use the box shape even if all raw singles, since it exceeds the weight/qty envelope limits');
assert.ok(Number(bigOrderCase.height) <= 12, 'box height must be capped at 12in regardless of order size');

console.log('Parcel-builder functional checks passed');

// ── Functional: reimplement the cheapest-rate selection from a Shippo-shaped
// rates array, filtering out zero/invalid amounts ──
function pickCheapestRate(rates){
  const clean = (rates || [])
    .filter(r => r && r.amount && Number(r.amount) > 0)
    .map(r => ({ cost: Number(r.amount), carrier: r.provider || '', serviceName: r.servicelevel?.name || '' }));
  if (!clean.length) return null;
  clean.sort((a, b) => a.cost - b.cost);
  return clean[0];
}

const shippoRates = [
  { amount: '9.40', provider: 'UPS', servicelevel: { name: 'Ground' } },
  { amount: '5.15', provider: 'USPS', servicelevel: { name: 'Priority Mail' } },
  { amount: '0', provider: 'FedEx', servicelevel: { name: 'Broken Rate' } },
  { amount: null, provider: 'DHL', servicelevel: { name: 'No Amount' } },
];
const cheapest = pickCheapestRate(shippoRates);
assert.equal(cheapest.carrier, 'USPS', 'the cheapest valid rate must win, matching the shop actually shipping mostly light USPS-eligible items');
assert.equal(cheapest.cost, 5.15);
assert.equal(pickCheapestRate([]), null, 'no rates must yield null so the caller can fall back');
assert.equal(pickCheapestRate([{ amount: '0' }]), null, 'a zero-amount rate must be treated as invalid, not free shipping');

console.log('Cheapest-rate selection functional checks passed');
