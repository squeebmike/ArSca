import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store asks: the customer screen "needs to be legible for any bg image I
// use"; the after-payment steps were badly formatted; and "I'd like to not
// have that nagger for the what are you looking for."
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };

// Content sits on frosted light cards with fixed dark text, whatever the
// theme's overlay opacity or colors.
assert.match(dashboard, /#customer-display\.customer-payment-screen\{--dim:#4b5563;color:#101319;\}/);
assert.match(dashboard, /#customer-display \.customer-pay-brand,#customer-display \.customer-pay-scroll,#customer-display \.customer-pay-footer\{background:rgba\(255,255,255,\.93\);-webkit-backdrop-filter:blur\(10px\);backdrop-filter:blur\(10px\);/);
assert.match(dashboard, /#customer-display \.customer-pay-total b\{color:color-mix\(in srgb,var\(--g\) 70%,#101319\);\}/, 'the total keeps the brand color, darkened enough to read on white');
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
