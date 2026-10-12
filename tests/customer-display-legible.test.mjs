import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store asks: the customer screen "needs to be legible for any bg image I
// use"; the after-payment steps were badly formatted; and "I'd like to not
// have that nagger for the what are you looking for."
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };

// Content sits on frosted cards in the theme's surface color with the
// theme's text color ("use the theme picker"), whatever the background
// photo or overlay opacity.
assert.match(dashboard, /#customer-display\.customer-payment-screen\{--cd-ink:var\(--app-text\);--cd-dim:color-mix\(in srgb,var\(--app-text\) 70%,transparent\);--dim:var\(--cd-dim\);color:var\(--cd-ink\);\}/);
assert.match(dashboard, /#customer-display \.customer-pay-brand,#customer-display \.customer-pay-scroll,#customer-display \.customer-pay-footer\{background:color-mix\(in srgb,var\(--app-surface\) 93%,transparent\);-webkit-backdrop-filter:blur\(10px\);backdrop-filter:blur\(10px\);/);
assert.match(dashboard, /#customer-display \.customer-method-btn\{background:var\(--app-surface-2\);color:var\(--cd-ink\);border-color:var\(--app-border\);/, 'payment buttons follow the theme too');
assert.match(dashboard, /\.receipt-capture-screen \.receipt-send\{background:var\(--app-primary\);color:var\(--app-button-text\);/);
const after = dashboard.slice(dashboard.indexOf('/* Readable over any background image, in the store'), dashboard.indexOf('.receipt-capture-screen .receipt-skip{'));
assert.doesNotMatch(after, /:(?:#101319|#4b5563|#fff)[;}]|rgba\(255,255,255,\.93\)/, 'no fixed light-theme colors left in the customer-screen rules');
assert.match(extractFn('ensureCheckoutRuntimeMarkup'), /<div class="customer-pay-footer">Thank you for shopping with us\.<\/div>/);

// After payment, the receipt step takes the card on its own.
assert.match(dashboard, /\.customer-pay-scroll:has\(\.receipt-capture-screen\.on,\.wants-capture-screen\.on\)>:not\(\.receipt-capture-screen\):not\(\.wants-capture-screen\)\{display:none;\}/);
const receipt = extractFn('showReceiptCaptureScreen');
assert.match(receipt, /<div class="receipt-done">✓ Payment complete/);
assert.match(receipt, /<input id="receipt-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Phone number">/);
assert.match(receipt, /<label class="receipt-consent"><input id="receipt-sms-consent" type="checkbox"><span>I agree[\s\S]*Terms<\/a>\.<\/span><\/label>/, 'consent copy is one wrapped block beside the box');
assert.match(receipt, /class="hbtn receipt-send" onclick="saveReceiptCapture\(\)">SEND RECEIPT<\/button><button class="hbtn receipt-skip" onclick="showWantsCaptureScreen\(\)">NO THANKS<\/button>/);

// "What are you looking for?" is off unless the store turns it on.
assert.match(extractFn('showWantsCaptureScreen'), /if\(s\.customerDisplay\?\.askWantsAfterPayment !== true\) return finishLockedCheckout\(\);/);
assert.match(dashboard, /showStoreLogo:true, askWantsAfterPayment:false, checkoutTimeoutMinutes:10 \}/);
assert.doesNotMatch(dashboard, /wantsCaptureEnabled/);
console.log('Customer display legibility + after-payment checks passed');
