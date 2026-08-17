import fs from 'node:fs';
import assert from 'node:assert/strict';

const storefront = fs.readFileSync('storefront.html', 'utf8');
const buylist = fs.readFileSync('buylist.html', 'utf8');

// ── Contract: storefront checkout requires an explicit SMS-consent checkbox
// before an order (which always collects a phone number) can be submitted --
// Twilio A2P registration was rejected for lacking this exact requirement:
// "explicitly ask consumers to consent" to receiving texts, not just collect
// a phone number for general service. ──
assert.match(storefront, /<input id="ck-sms-consent" type="checkbox"/, 'checkout must render an SMS-consent checkbox');
assert.match(storefront, /I agree to receive text messages about this order/, 'the checkbox label must explicitly say what the customer is consenting to');
assert.match(storefront, /Reply STOP to opt out/, 'the checkbox label must include opt-out instructions');
assert.match(storefront, /if\(!document\.getElementById\('ck-sms-consent'\)\.checked\)\{ showCheckoutError\('Please confirm you agree to receive text messages about your order\.'\); return; \}/, 'submitCheckout must block submission until the consent checkbox is checked');

console.log('Storefront SMS-consent contract checks passed');

// ── Contract: buylist ("sell to us") form requires the same explicit
// consent, but only when a phone number is actually provided -- consent to
// texting is meaningless (and shouldn't block submission) for an email-only
// submitter who will never receive an SMS from this form. ──
assert.match(buylist, /<input id="sms-consent" type="checkbox"/, 'buylist form must render an SMS-consent checkbox');
assert.match(buylist, /id="sms-consent-row" style="display:none/, 'the consent row must start hidden -- it only matters once a phone number is entered');
assert.match(buylist, /function updateSmsConsentVisibility\(\)\{/, 'updateSmsConsentVisibility must exist to toggle the consent row based on whether a phone was entered');
assert.match(buylist, /oninput="updateSmsConsentVisibility\(\)"/, 'the phone field must trigger the visibility toggle on every keystroke');
assert.match(buylist, /if\(contactPhone && !document\.getElementById\('sms-consent'\)\.checked\)\{ errEl\.textContent='Please confirm you agree to receive text messages about this submission'; errEl\.classList\.add\('on'\); return; \}/, 'submitBuylist must block submission when a phone was given but consent was not checked');

console.log('Buylist SMS-consent contract checks passed');

// ── Functional: reimplement the buylist visibility/validation logic and
// verify the exact behavior matrix -- email-only submitters are never
// blocked by a consent checkbox that was never shown to them, phone
// submitters always are until checked. ──
function shouldShowConsentRow(phone){
  return phone.trim().length > 0;
}
function canSubmitBuylist(phone, consentChecked){
  if (!phone.trim()) return true; // no phone -- consent row never shown, nothing to block on
  return consentChecked;
}

assert.equal(shouldShowConsentRow(''), false, 'no phone entered -- consent row must stay hidden');
assert.equal(shouldShowConsentRow('555-1234'), true, 'a phone entered -- consent row must show');
assert.equal(canSubmitBuylist('', false), true, 'email-only submission must never be blocked by an unchecked, never-shown consent box');
assert.equal(canSubmitBuylist('555-1234', false), false, 'a phone number was given but consent was not checked -- submission must be blocked');
assert.equal(canSubmitBuylist('555-1234', true), true, 'phone number given and consent checked -- submission must be allowed');

console.log('SMS-consent visibility/validation functional checks passed');
