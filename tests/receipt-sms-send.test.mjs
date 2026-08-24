import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: text receipts must actually get texted. Before this fix,
// saveReceiptCapture() only ever inserted a customer_receipts row with
// sms_status:'requested' -- nothing anywhere in the codebase read that
// table and dispatched anything, so every customer who opted in got told
// "receipt sent" and received nothing, silently, forever. ──
const saveReceiptCapture = dashboard.slice(dashboard.indexOf('async function saveReceiptCapture(){'), dashboard.indexOf('\n// Loyalty accrual reuses the phone'));
assert.ok(saveReceiptCapture, 'saveReceiptCapture function was not found');
assert.match(saveReceiptCapture, /storeWorkerFetch\('\/notify\/send', \{ method:'POST', headers:\{'Content-Type':'application\/json'\}, body:JSON\.stringify\(\{ contact:phone, subject:'Your receipt', message, consent:true \}\) \}\)/, 'a consented receipt must actually be sent through the existing /notify/send route, not just recorded');
assert.match(saveReceiptCapture, /if\(d\?\.ok\) \{ markReceiptStatus\('sent'\); \}/, 'a successful send must update the row\'s own sms_status field, since that field exists to answer whether it went out');
assert.match(saveReceiptCapture, /markReceiptStatus\('failed'\)/, 'a failed send must be recorded, not silently swallowed');

// ── Contract: the consent checkbox actually gates the send -- an
// unchecked box must not attempt to text anyone, and the DB row must
// reflect that instead of implying a text was requested. ──
assert.match(saveReceiptCapture, /const consented = document\.getElementById\('receipt-sms-consent'\)\?\.checked === true;/, 'the send must be gated on an explicit consent checkbox, not implied by typing a phone number');
assert.match(saveReceiptCapture, /sms_status: consented \? 'requested' : 'skipped_no_consent',/, 'the stored status must distinguish a real request from a phone number entered without consent');
assert.match(saveReceiptCapture, /if\(consented\) \{/, 'the send attempt must be skipped entirely when consent was not given');

// ── Contract: the consent checkbox must be fully disclosed, mirroring the
// already-established storefront.html/buylist.html wording (message type,
// frequency, msg&data rates, STOP/HELP, Privacy/Terms links) for
// consistency with this store's registered Twilio A2P campaign, rather
// than inventing new, unreviewed consent language. ──
const showReceiptCaptureScreen = dashboard.slice(dashboard.indexOf('function showReceiptCaptureScreen(){'), dashboard.indexOf('\nasync function saveReceiptCapture('));
assert.ok(showReceiptCaptureScreen, 'showReceiptCaptureScreen function was not found');
assert.match(showReceiptCaptureScreen, /<input id="receipt-sms-consent" type="checkbox"/, 'a named SMS-consent checkbox must be rendered on the receipt-capture screen');
assert.match(showReceiptCaptureScreen, /Message frequency varies based on order activity\. Msg &amp; data rates may apply\. Reply STOP to opt out or HELP for help\./, 'the checkbox label must disclose frequency, rates, and STOP/HELP per Twilio A2P requirements');
assert.match(showReceiptCaptureScreen, /href="https:\/\/themanapocket\.com\/privacy-policy" target="_blank">Privacy Policy<\/a> and <a href="https:\/\/themanapocket\.com\/terms-and-conditions" target="_blank">Terms<\/a>/, 'the checkbox label must link to the real Privacy Policy and Terms pages');

console.log('Receipt SMS-send contract checks passed');
