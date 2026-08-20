import fs from 'node:fs';
import assert from 'node:assert/strict';

const storefront = fs.readFileSync('storefront.html', 'utf8');
const buylist = fs.readFileSync('buylist.html', 'utf8');

// ── Contract: storefront checkout renders an explicit, fully-disclosed
// SMS-consent checkbox -- Twilio A2P review required clear consent wording
// (message type, frequency, "msg & data rates", STOP/HELP, and links to
// Terms/Privacy) directly next to the checkbox. It must also stay OPTIONAL:
// a later Twilio review explicitly rejected gating checkout on this box --
// "Make SMS consent optional...so consumers can complete sign-up without
// opting in to texts." ──
assert.match(storefront, /<input id="ck-sms-consent" name="smsConsent" type="checkbox"/, 'checkout must render a named SMS-consent checkbox');
assert.match(storefront, /Optional: I agree to receive order, pickup, shipping, and customer-care SMS\/text messages/, 'the checkbox label must explicitly say what the customer is consenting to and that consent is optional');
assert.match(storefront, /Message frequency varies based on order activity/, 'the checkbox label must disclose message frequency, per Twilio A2P requirements');
assert.match(storefront, /Reply STOP to opt out or HELP for help/, "the checkbox label must use the required STOP/HELP instructions");
assert.match(storefront, /Consent is not a condition of purchase/, 'checkout must state that SMS consent is not a condition of purchase');
assert.match(storefront, /href="https:\/\/themanapocket\.com\/privacy-policy" target="_blank">Privacy Policy<\/a> and <a href="https:\/\/themanapocket\.com\/terms-and-conditions" target="_blank">Terms<\/a>/, 'the checkbox label must link directly to the real Privacy Policy and Terms pages');
assert.doesNotMatch(storefront, /ck-sms-consent'\)\.checked/, 'checkout submission must never read/require ck-sms-consent -- consent must stay optional, not gate the purchase');

console.log('Storefront SMS-consent contract checks passed');

// ── Contract: buylist ("sell to us") form shows the same fully-disclosed,
// optional consent checkbox once a phone number is entered (no phone means
// no SMS is possible, so nothing to consent to) -- but never blocks
// submission on it either. ──
assert.match(buylist, /<input id="sms-consent" name="smsConsent" type="checkbox"/, 'buylist form must render a named SMS-consent checkbox');
assert.match(buylist, /id="sms-consent-row" style="display:none/, 'the consent row must start hidden -- it only matters once a phone number is entered');
assert.match(buylist, /Optional: I agree to receive submission and customer-care SMS\/text messages/, 'buylist consent must explicitly say what messages are sent and that consent is optional');
assert.match(buylist, /Message frequency varies based on submission activity/, 'the checkbox label must disclose message frequency, per Twilio A2P requirements');
assert.match(buylist, /Reply STOP to opt out or HELP for help/, "the checkbox label must use the required STOP/HELP instructions");
assert.match(buylist, /Consent is not a condition of submitting items/, 'buylist must state that SMS consent is not required to submit items');
assert.match(buylist, /href="https:\/\/themanapocket\.com\/privacy-policy" target="_blank">Privacy Policy<\/a> and <a href="https:\/\/themanapocket\.com\/terms-and-conditions" target="_blank">Terms<\/a>/, 'the checkbox label must link directly to the real Privacy Policy and Terms pages');
assert.match(buylist, /function updateSmsConsentVisibility\(\)\{/, 'updateSmsConsentVisibility must exist to toggle the consent row based on whether a phone was entered');
assert.match(buylist, /oninput="updateSmsConsentVisibility\(\)"/, 'the phone field must trigger the visibility toggle on every keystroke');
assert.doesNotMatch(buylist, /'sms-consent'\)\.checked\)\{ errEl/, 'submitBuylist must never block on the consent checkbox -- it must stay optional');

console.log('Buylist SMS-consent contract checks passed');

// ── Functional: reimplement the visibility toggle -- the checkbox row only
// matters (and only shows) once a phone number exists, but its checked
// state must never factor into whether the form can be submitted. ──
function shouldShowConsentRow(phone){
  return phone.trim().length > 0;
}
function canSubmitBuylist(name, emailOrPhone, itemsCount){
  // Consent-checkbox state is intentionally NOT a parameter -- it must
  // never be able to block submission, regardless of whether a phone was
  // given or the box was checked.
  return !!name && !!emailOrPhone && itemsCount > 0;
}

assert.equal(shouldShowConsentRow(''), false, 'no phone entered -- consent row must stay hidden');
assert.equal(shouldShowConsentRow('555-1234'), true, 'a phone entered -- consent row must show');
assert.equal(canSubmitBuylist('Jane', '555-1234', 1), true, 'a fully valid submission with a phone number must succeed regardless of consent-checkbox state');
assert.equal(canSubmitBuylist('Jane', 'jane@example.com', 1), true, 'an email-only submission must succeed -- there is no consent row to even interact with');
assert.equal(canSubmitBuylist('', '555-1234', 1), false, 'a missing name must still block submission -- only the consent checkbox was made optional');

console.log('SMS-consent visibility/validation functional checks passed');
