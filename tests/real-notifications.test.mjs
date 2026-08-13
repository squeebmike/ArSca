import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Worker: send helpers ────────────────────────────────────────────
assert.match(worker, /async function sendSms\(env, to, body\) \{/, 'missing sendSms');
assert.match(worker, /async function sendEmail\(env, to, subject, text\) \{/, 'missing sendEmail');
assert.match(worker, /async function sendContactNotification\(env, contact, subject, message\) \{/, 'missing sendContactNotification');

// SMS goes through Twilio's Messages API with Basic auth (Account SID/Auth Token).
assert.match(worker, /https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/\$\{env\.TWILIO_ACCOUNT_SID\}\/Messages\.json/, 'must POST to the Twilio Messages API');
assert.match(worker, /if \(!env\.TWILIO_ACCOUNT_SID \|\| !env\.TWILIO_AUTH_TOKEN \|\| !env\.TWILIO_FROM_NUMBER\) throw new Error\('SMS is not configured yet'\);/, 'sendSms must fail clearly (not silently) when Twilio secrets are not configured');

// Email goes through SendGrid's v3 mail/send API with Bearer auth.
assert.match(worker, /https:\/\/api\.sendgrid\.com\/v3\/mail\/send/, 'must POST to the SendGrid mail/send API');
assert.match(worker, /if \(!env\.SENDGRID_API_KEY \|\| !env\.SENDGRID_FROM_EMAIL\) throw new Error\('Email is not configured yet'\);/, 'sendEmail must fail clearly when SendGrid secrets are not configured');

// Channel selection: '@' means email, otherwise SMS -- same rule the
// existing device-link notify buttons already use.
assert.match(worker, /if \(clean\.includes\('@'\)\) \{ await sendEmail\(env, clean, subject, message\); return 'email'; \}/, 'sendContactNotification must route email-shaped contacts to sendEmail');
assert.match(worker, /await sendSms\(env, clean, message\);\s*\n\s*return 'sms';/, 'sendContactNotification must route everything else to sendSms');

console.log('Notification-provider helper checks passed');

// ── Worker: /notify/send route ──────────────────────────────────────
assert.match(worker, /if \(url\.pathname === '\/notify\/send'\) \{/, 'missing /notify/send route');
assert.match(worker, /const auth = await requireStoreUser\(request, env, storeId, \['owner','admin','manager','employee'\]\);/, 'notify/send must require an authenticated store user (any staff role)');
assert.match(worker, /const rateError = await enforceUsageLimit\(env, `notify-send:\$\{storeId\}`, 100, 3600\);/, 'notify/send must be rate-limited to prevent runaway SMS/email costs from a bug or abuse');
assert.match(worker, /if \(!contact \|\| !message\) return json\(\{ ok:false, error:'contact and message are required' \}, 400\);/, 'notify/send must require both contact and message');

console.log('/notify/send route checks passed');

// ── Dashboard: notifyWant sends for real, with graceful fallback ────
assert.match(dashboard, /async function notifyWant\(id\)\{/, 'notifyWant must be async now that it calls the Worker');
assert.match(dashboard, /const res = await storeWorkerFetch\('\/notify\/send', \{ method:'POST', headers:\{'Content-Type':'application\/json'\}, body:JSON\.stringify\(\{ storeId:getActiveStoreId\(\), contact:w\.contact, subject:'Your Want List Item is In Stock!', message:msg \}\) \}\);/, 'notifyWant must call the real /notify/send route');
// Must still fall back to the old device-link behavior on failure (e.g.
// SMS/email not configured yet) rather than just breaking the button.
assert.match(dashboard, /\} catch\(e\) \{\s*\n\s*if\(w\.contact\.includes\('@'\)\) window\.open\('mailto:'\+w\.contact/, 'notifyWant must fall back to a device mailto: link if the real send fails');
assert.match(dashboard, /else window\.open\('sms:'\+w\.contact\.replace\(\/\\D\/g,''\)\+'\?body='\+encodeURIComponent\(msg\)\);/, 'notifyWant must fall back to a device sms: link if the real send fails');
// A successful send must be recorded so staff can see it already went out.
assert.match(dashboard, /w\.notifiedAt = new Date\(\)\.toISOString\(\);\s*\n\s*w\.notifiedVia = data\.channel;/, 'a successful send must record notifiedAt/notifiedVia on the want record');
assert.match(dashboard, /\$\{w\.notifiedAt\?`<div style="font-size:8px;color:var\(--blue\)">✓ Notified via/, 'the want list row must show when/how a customer was already notified');

console.log('Dashboard notifyWant wiring checks passed');
