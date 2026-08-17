import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Worker: routing ──────────────────────────────────────────────────
assert.match(worker, /if \(\(url\.pathname === '\/twilio\/voice' \|\| url\.pathname === '\/twilio\/sms'\) && request\.method === 'POST'\) \{\s*\n\s*return handleTwilioWebhook\(request, env, url\);/, 'must route both /twilio/voice and /twilio/sms POSTs to handleTwilioWebhook');

// ── Worker: signature verification is mandatory ─────────────────────
assert.match(worker, /async function verifyTwilioSignature\(fullUrl, params, signatureHeader, authToken\) \{/, 'missing verifyTwilioSignature');
assert.match(worker, /if \(!authToken \|\| !signatureHeader\) return false;/, 'verifyTwilioSignature must reject when auth token or signature header is missing');
assert.match(worker, /const sigOk = await verifyTwilioSignature\(request\.url, params, request\.headers\.get\('X-Twilio-Signature'\) \|\| '', env\.TWILIO_AUTH_TOKEN\);/, 'handleTwilioWebhook must verify the X-Twilio-Signature header');
assert.match(worker, /if \(!sigOk\) return new Response\('Invalid signature', \{ status: 403 \}\);/, 'unsigned/forged requests must be rejected with 403, not processed');

// ── Worker: voice -- simultaneous ring to all forward numbers ───────
assert.match(worker, /if \(url\.pathname === '\/twilio\/voice'\) \{/, 'missing /twilio/voice branch');
assert.match(worker, /if \(!numbers\.length\) return twimlResponse\('<Response><Say>Sorry, no one is available to take your call right now\.<\/Say><\/Response>'\);/, 'voice must gracefully handle no forwarding numbers configured');
assert.match(worker, /const dialNumbers = numbers\.map\(n => `<Number>\$\{escapeXmlText\(n\)\}<\/Number>`\)\.join\(''\);/, 'voice must build a <Number> per forwarding number');
assert.match(worker, /return twimlResponse\(`<Response><Dial timeout="20">\$\{dialNumbers\}<\/Dial><\/Response>`\);/, 'voice must Dial all numbers inside one <Dial> so they ring simultaneously (first to answer wins)');

// ── Worker: sms -- relay inbound texts to all forward numbers ───────
assert.match(worker, /if \(url\.pathname === '\/twilio\/sms'\) \{/, 'missing /twilio/sms branch');
assert.match(worker, /for \(const num of numbers\) \{\s*\n\s*try \{ await sendSms\(env, num, `Text from \$\{from\}: \$\{text\}`\); \} catch \(e\) \{ \/\* one bad forward number shouldn't block the rest \*\/ \}/, 'sms webhook must relay the inbound text to every forwarding number, independently of failures');

// ── Worker: numbers are read from the SAME receipt_settings column ──
assert.match(worker, /numbers = \(settings\?\.\[0\]\?\.receipt_settings\?\.notifyForwardNumbers \|\| \[\]\)\.filter\(Boolean\)\.slice\(0, 5\);/, 'forward numbers must come from store_settings.receipt_settings.notifyForwardNumbers');

console.log('Worker Twilio voice+SMS webhook checks passed');

// ── Dashboard: notifyForwardNumbers persisted in BOTH receipt_settings whitelists ──
const whitelistOccurrences = dashboard.match(/notifyForwardNumbers:Array\.isArray\(next\.notifyForwardNumbers\) \? next\.notifyForwardNumbers\.slice\(0,3\) : \[\],/g) || [];
assert.equal(whitelistOccurrences.length, 2, 'notifyForwardNumbers must be whitelisted in both saveVendorProfile() and savePaymentSettings() receipt_settings payloads, or one save silently erases what the other wrote');

// ── Dashboard: settings UI wiring ────────────────────────────────────
assert.match(dashboard, /const twilioVoiceUrl = WORKER \+ '\/twilio\/voice\?store=' \+ encodeURIComponent\(getActiveStoreId\(\)\);/, 'missing twilioVoiceUrl webhook link');
assert.match(dashboard, /const twilioSmsUrl = WORKER \+ '\/twilio\/sms\?store=' \+ encodeURIComponent\(getActiveStoreId\(\)\);/, 'missing twilioSmsUrl webhook link');
assert.match(dashboard, /\$\{\[0,1,2\]\.map\(i => vendorInput\('notifyForward'\+i, 'Phone '\+\(i\+1\), \(p\.notifyForwardNumbers\|\|\[\]\)\[i\] \|\| '', 'tel', '\+15551234567'\)\)\.join\(''\)\}/, 'must render 3 phone number inputs from the saved notifyForwardNumbers');
assert.match(dashboard, /onclick="saveNotifyForwardNumbers\(\)"/, 'must have a save button wired to saveNotifyForwardNumbers()');

assert.match(dashboard, /function saveNotifyForwardNumbers\(\)\{/, 'missing saveNotifyForwardNumbers function');
assert.match(dashboard, /const notifyForwardNumbers=\[0,1,2\]\.map\(i=>document\.getElementById\('vp-notifyForward'\+i\)\?\.value\.trim\(\)\)\.filter\(Boolean\);/, 'saveNotifyForwardNumbers must read from the vp-notifyForward0/1/2 inputs (vendorInput() prefixes ids with vp-)');
assert.match(dashboard, /saveVendorProfile\(\{notifyForwardNumbers\}\);/, 'saveNotifyForwardNumbers must persist via saveVendorProfile');

console.log('Dashboard call-forwarding/SMS-relay settings UI checks passed');

// ── Functional: verifyTwilioSignature computes a real Twilio-compatible signature ──
const workerBody = worker
  .replace(/^import\s*\{[^}]*\}\s*from\s*'[^']*';?\r?$/gm, '')
  .replace(/^export default/m, 'const __worker =');
const workerModule = new Function(`${workerBody}\nreturn { verifyTwilioSignature, escapeXmlText, constantTimeEqualHex };`);
const { verifyTwilioSignature, escapeXmlText } = workerModule();

const authToken = 'test-auth-token-123';
const fullUrl = 'https://example.com/twilio/sms?store=demo';
const params = { From: '+15551112222', Body: 'hello there' };

// Build the expected signature the same way Twilio itself does: fullUrl +
// sorted key/value pairs concatenated, HMAC-SHA1 with the auth token, base64.
let data = fullUrl;
for (const key of Object.keys(params).sort()) data += key + params[key];
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
const validSignature = btoa(String.fromCharCode(...new Uint8Array(signed)));

assert.equal(await verifyTwilioSignature(fullUrl, params, validSignature, authToken), true, 'a correctly computed Twilio signature must verify as valid');
assert.equal(await verifyTwilioSignature(fullUrl, params, 'forged-signature==', authToken), false, 'a forged/mismatched signature must be rejected');
assert.equal(await verifyTwilioSignature(fullUrl, params, '', authToken), false, 'a missing signature must be rejected');
assert.equal(await verifyTwilioSignature(fullUrl, params, validSignature, ''), false, 'verification must fail closed when TWILIO_AUTH_TOKEN is not configured');

assert.equal(escapeXmlText('+1 555 <hack> & "quote" \'s\''), '+1 555 &lt;hack&gt; &amp; &quot;quote&quot; &apos;s&apos;', 'escapeXmlText must escape XML-significant characters before embedding into TwiML');

console.log('Twilio signature verification + XML escaping functional checks passed');
