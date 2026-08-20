import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Worker: send helpers ────────────────────────────────────────────
assert.match(worker, /async function sendSms\(env, to, body\) \{/, 'missing sendSms');
assert.match(worker, /async function sendEmail\(env, to, subject, text\) \{/, 'missing sendEmail');
assert.match(worker, /async function sendContactNotification\(env, storeId, contact, subject, message, hasConsent\) \{/, 'missing sendContactNotification (storeId + hasConsent are required for SMS consent/opt-out gating)');

// SMS goes through Twilio's Messages API with Basic auth (Account SID/Auth Token).
assert.match(worker, /https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/\$\{env\.TWILIO_ACCOUNT_SID\}\/Messages\.json/, 'must POST to the Twilio Messages API');
assert.match(worker, /if \(!env\.TWILIO_ACCOUNT_SID \|\| !env\.TWILIO_AUTH_TOKEN \|\| !env\.TWILIO_FROM_NUMBER\) throw new Error\('SMS is not configured yet'\);/, 'sendSms must fail clearly (not silently) when Twilio secrets are not configured');

// Email goes through Twilio's Comms Email API with the same account-level
// Basic authentication already used for calling and SMS. The existing
// sender-address secret is accepted as a migration alias, but a SendGrid API
// key must never be required or sent to the Twilio endpoint.
assert.match(worker, /https:\/\/comms\.twilio\.com\/v1\/Emails/, 'must POST to the Twilio Comms Email API');
assert.match(worker, /const auth = btoa\(`\$\{env\.TWILIO_ACCOUNT_SID\}:\$\{env\.TWILIO_AUTH_TOKEN\}`\);[\s\S]*Authorization: `Basic \$\{auth\}`/, 'Twilio Email must use Account SID and Auth Token Basic authentication');
assert.match(worker, /const fromAddress = env\.TWILIO_EMAIL_FROM_ADDRESS \|\| env\.SENDGRID_FROM_EMAIL;/, 'sendEmail must accept the existing sender-address secret during migration');
assert.match(worker, /if \(!env\.TWILIO_ACCOUNT_SID \|\| !env\.TWILIO_AUTH_TOKEN \|\| !fromAddress\) throw new Error\('Email is not configured yet'\);/, 'sendEmail must fail clearly when Twilio email credentials are not configured');
assert.match(worker, /from: \{ address: fromAddress, name: fromName \},[\s\S]*to: \[\{ address: to \}\],[\s\S]*content: \{ subject, text \}/, 'Twilio Email payload must use the Comms API address/content shape');
assert.doesNotMatch(worker, /https:\/\/api\.sendgrid\.com\/v3\/mail\/send/, 'the Worker must not call the separately billed SendGrid endpoint');

// Channel selection: '@' means email, otherwise SMS -- same rule the
// existing device-link notify buttons already use.
assert.match(worker, /if \(clean\.includes\('@'\)\) \{/, 'sendContactNotification must route email-shaped contacts down the email branch');
assert.match(worker, /await sendSms\(env, clean, message\);\s*\n\s*return 'sms';/, 'sendContactNotification must route everything else to sendSms');

// ── A2P 10DLC / CTIA compliance: promotional SMS must never send without
// consent, and must always honor an opt-out on file, regardless of what the
// caller claims. ──
assert.match(worker, /async function smsConsentStatus\(env, storeId, phoneNumber\) \{/, 'missing smsConsentStatus helper');
assert.match(worker, /if \(status\.optedOut\) \{ const err = new Error\('This customer has opted out of text messages \(replied STOP\)\. Contact them another way\.'\); err\.code = 'opted_out'; throw err; \}/, 'sendContactNotification must refuse to send to an opted-out number even if the caller claims consent');
assert.match(worker, /if \(!hasConsent\) \{ const err = new Error\('No SMS consent on file for this contact -- check the consent box before texting them\.'\); err\.code = 'no_consent'; throw err; \}/, 'sendContactNotification must require the caller to assert consent for this specific outreach');

// ── CAN-SPAM: promotional email doesn't need prior consent (unlike SMS),
// but must always honor an opt-out and carry a working unsubscribe link. ──
assert.match(worker, /async function emailNotifyContact\(env, storeId, email\) \{/, 'missing emailNotifyContact helper');
assert.match(worker, /if \(contactRow\.optedOut\) \{ const err = new Error\('This customer has unsubscribed from emails\. Contact them another way\.'\); err\.code = 'opted_out'; throw err; \}/, 'sendContactNotification must refuse to email an address that has unsubscribed');
assert.match(worker, /const footer = await emailUnsubscribeFooter\(env, storeId, contactRow\.unsubscribeToken\);/, 'every promotional email sent through this path must get an unsubscribe footer appended');
assert.match(worker, /await sendEmail\(env, clean, subject, message \+ footer\);/, 'the unsubscribe footer must actually be included in the sent message, not just built');
assert.match(worker, /async function emailUnsubscribeFooter\(env, storeId, unsubscribeToken\) \{/, 'missing emailUnsubscribeFooter helper');
assert.match(worker, /if \(url\.pathname === '\/notify\/email-unsubscribe' && request\.method === 'GET'\) \{/, 'missing /notify/email-unsubscribe route');
assert.match(worker, /await supabaseAdminFetch\(env, `email_notify_contacts\?id=eq\.\$\{encodeURIComponent\(row\.id\)\}`, \{ method: 'PATCH', headers: \{ Prefer: 'return=minimal' \}, body: JSON\.stringify\(\{ opted_out: true, opted_out_at: new Date\(\)\.toISOString\(\) \}\) \}\);/, 'the unsubscribe route must actually flip the opted_out flag');

console.log('Notification-provider helper checks passed');

// ── Worker: /notify/send route ──────────────────────────────────────
assert.match(worker, /if \(url\.pathname === '\/notify\/send'\) \{/, 'missing /notify/send route');
assert.match(worker, /const auth = await requireStoreUser\(request, env, storeId, \['owner','admin','manager','employee'\]\);/, 'notify/send must require an authenticated store user (any staff role)');
assert.match(worker, /const rateError = await enforceUsageLimit\(env, `notify-send:\$\{storeId\}`, 100, 3600\);/, 'notify/send must be rate-limited to prevent runaway SMS/email costs from a bug or abuse');
assert.match(worker, /if \(!contact \|\| !message\) return json\(\{ ok:false, error:'contact and message are required' \}, 400\);/, 'notify/send must require both contact and message');
assert.match(worker, /const channel = await sendContactNotification\(env, storeId, contact, String\(body\.subject \|\| 'Message from your store'\)\.slice\(0, 200\), message, body\.consent === true\);/, 'notify/send must pass the caller-asserted consent flag through, not assume consent');
assert.match(worker, /const status = e\.code === 'opted_out' \? 409 : e\.code === 'no_consent' \? 403 : 502;/, 'notify/send must map opted-out/no-consent to distinct status codes so the UI never falls back to a bypass');

console.log('/notify/send route checks passed');

// ── Dashboard: notifyWant sends for real, with graceful fallback ────
assert.match(dashboard, /async function notifyWant\(id\)\{/, 'notifyWant must be async now that it calls the Worker');
assert.match(dashboard, /const res = await storeWorkerFetch\('\/notify\/send', \{ method:'POST', headers:\{'Content-Type':'application\/json'\}, body:JSON\.stringify\(\{ storeId:getActiveStoreId\(\), contact:w\.contact, subject:'Your Want List Item is In Stock!', message:msg, consent:w\.smsConsent===true \}\) \}\);/, 'notifyWant must call the real /notify/send route and pass the want-list entry\'s own consent flag');
// A 403 (no consent on file) or 409 (opted out) means the app itself
// refused to send -- that must never fall through to opening the staff's
// own personal texting app below, since that would send the exact text the
// backend just refused via a channel the compliance check can't see.
assert.match(dashboard, /if\(res\.status===403\|\|res\.status===409\)\{ toast_dash\(data\.error\|\|'Cannot text this customer\.'\); return; \}/, 'notifyWant must not fall back to a device link when the backend refuses on consent grounds');
// Only real technical failures (Twilio not configured, network error, etc)
// still fall back to the old device-link behavior.
assert.match(dashboard, /\} catch\(e\) \{\s*\n\s*if\(w\.contact\.includes\('@'\)\) window\.open\('mailto:'\+w\.contact/, 'notifyWant must fall back to a device mailto: link if the real send fails for a non-consent reason');
assert.match(dashboard, /else window\.open\('sms:'\+w\.contact\.replace\(\/\\D\/g,''\)\+'\?body='\+encodeURIComponent\(msg\)\);/, 'notifyWant must fall back to a device sms: link if the real send fails for a non-consent reason');
// Consent capture: a checkbox in the add-want form, read into the want-list
// entry, so /notify/send has something real to check against per item.
assert.match(dashboard, /<input type="checkbox" id="wl-sms-consent">/, 'the add-want form must render an SMS-consent checkbox');
assert.match(dashboard, /const smsConsent = document\.getElementById\('wl-sms-consent'\)\.checked;/, 'addWantItem must read the consent checkbox');
assert.match(dashboard, /item, customer, contact, maxprice, category, notes, smsConsent,/, 'addWantItem must store the consent flag on the want-list entry');
// A successful send must be recorded so staff can see it already went out.
assert.match(dashboard, /w\.notifiedAt = new Date\(\)\.toISOString\(\);\s*\n\s*w\.notifiedVia = data\.channel;/, 'a successful send must record notifiedAt/notifiedVia on the want record');
assert.match(dashboard, /\$\{w\.notifiedAt\?`<div style="font-size:8px;color:var\(--blue\)">✓ Notified via/, 'the want list row must show when/how a customer was already notified');

console.log('Dashboard notifyWant wiring checks passed');
