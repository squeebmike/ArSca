import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Contract: every new authenticated route is gated by requireStoreUser
// with the same operational role set used elsewhere (excludes scanner_only,
// matching the existing app-wide convention -- no new granular permission
// system was invented for this one feature) ──
for (const path of ['/api/phone/token', '/phone/endpoints', '/phone/calls', '/phone/messages', '/phone/sms/send', '/phone/call-from-my-phone', '/phone/settings', '/phone/voicemails', '/phone/voicemails/mark-heard', '/phone/voicemail-audio']) {
  const escaped = path.replace(/[/]/g, '\\/');
  const re = new RegExp(`url\\.pathname === '${escaped}' && request\\.method === '(POST|GET)'\\) \\{[\\s\\S]{0,320}?const storeId = requestStoreId\\(request, url\\);\\s*\\n\\s*const auth = await requireStoreUser\\(request, env, storeId, \\['owner','admin','manager','employee'\\]\\);\\s*\\n\\s*if \\(auth\\.error\\) return auth\\.error;`);
  assert.match(worker, re, `${path} must be gated by requireStoreUser with the standard operational roles, same as every other operational route`);
}

// POST /phone/settings is the one write route on this narrower gate --
// ring-group policy (hours, voicemail, greeting) is a store-wide decision,
// not a per-employee one, so it's owner/admin only unlike every other phone
// route (which every operational role can use).
assert.match(worker, /if \(url\.pathname === '\/phone\/settings' && request\.method === 'POST'\) \{[\s\S]{0,320}?const auth = await requireStoreUser\(request, env, storeId, \['owner','admin'\]\);/, 'POST /phone/settings must be gated owner/admin only -- ring-group/voicemail/hours policy is a store-wide decision, not something every employee should be able to change');

// GET /phone/endpoints specifically must scope the query to the caller's OWN
// user_id -- it returns a personal cell number (approved_mobile).
assert.match(worker, /if \(url\.pathname === '\/phone\/endpoints' && request\.method === 'GET'\) \{/, 'missing GET /phone/endpoints (the dashboard needs to read back the caller\'s own saved settings)');
assert.match(worker, /phone_endpoints\?store_id=eq\.\$\{encodeURIComponent\(storeId\)\}&user_id=eq\.\$\{encodeURIComponent\(auth\.user\.id\)\}&select=enabled,approved_mobile&limit=1/, 'GET /phone/endpoints must scope the query to the authenticated caller\'s own user_id -- approved_mobile is a personal number, not for other staff to see');

// ── Contract: /api/phone/token issues a Twilio Access Token for the
// authenticated caller's own deterministic identity ──
assert.match(worker, /const identity = phoneIdentityForUser\(auth\.user\.id\);\s*\n\s*try \{\s*\n\s*const token = await buildTwilioAccessToken\(env, identity\);\s*\n\s*return json\(\{ ok:true, token, identity \}\);/, '/api/phone/token must build the identity from the authenticated user, not a client-supplied value, and return it alongside the token so the dashboard can label the call correctly');

// ── Contract: /phone/endpoints upserts the caller's OWN row (identity is
// server-derived, never client-supplied) ──
assert.match(worker, /const row = \{ store_id:storeId, user_id:auth\.user\.id, identity, enabled:body\.enabled === true, updated_at:new Date\(\)\.toISOString\(\) \};/, '/phone/endpoints must key the upsert on the authenticated user\'s own id and server-derived identity');
assert.match(worker, /Prefer:'resolution=merge-duplicates,return=minimal'/, '/phone/endpoints must upsert (merge on the unique store_id+user_id index), not blindly insert duplicate rows on every save');

// ── Contract: the toll-fraud guard on Call From My Phone -- the bridge-back
// number is a server-side lookup of the AUTHENTICATED employee's own saved
// approved_mobile, never taken from the request body. This is the entire
// security property the original spec called out as the real risk surface. ──
assert.match(worker, /if \(!\/\^\\\+\?\[0-9\(\)\\-\.\\s\]\{7,20\}\$\/\.test\(customerNumber\)\) return json\(\{ ok:false, error:'A valid customer phone number is required' \}, 400\);/, 'call-from-my-phone must validate the customer number shape before ever touching Twilio');
assert.match(worker, /const \{ data \} = await supabaseAdminFetch\(env, `phone_endpoints\?store_id=eq\.\$\{encodeURIComponent\(storeId\)\}&user_id=eq\.\$\{encodeURIComponent\(auth\.user\.id\)\}&select=approved_mobile&limit=1`\);/, 'the bridge-back number must be looked up server-side, scoped to the AUTHENTICATED user\'s own row -- never read from the request body');
assert.ok(!/approvedMobile\s*=.*limited\.data/.test(worker), 'approvedMobile must never be assignable from the parsed request body -- that would defeat the entire toll-fraud guard');
assert.match(worker, /if \(!approvedMobile\) return json\(\{ ok:false, error:'Set your mobile number in Phone settings first' \}, 400\);/, 'call-from-my-phone must refuse to proceed if the employee has not set their own approved mobile -- never fall back to a client-supplied number instead');
assert.match(worker, /const callParams = new URLSearchParams\(\{ To: approvedMobile, From: env\.TWILIO_FROM_NUMBER, Url: bridgeUrl \}\);/, 'the first leg must dial the server-looked-up approved mobile, not anything from the request');
assert.match(worker, /const bridgeUrl = `\$\{url\.origin\}\/twilio\/voice-bridge-to-customer\?store=\$\{encodeURIComponent\(storeId\)\}&customer=\$\{encodeURIComponent\(customerNumber\)\}`;/, 'the bridge TwiML URL must carry the customer number as a query param so the second leg (a separate Twilio-signed webhook) knows who to dial');

// ── Contract: outbound SMS persists exactly like inbound, crediting the
// sending staff member ──
assert.match(worker, /const result = await sendSms\(env, to, body\);\s*\n\s*await persistMessageRecord\(env, \{\s*\n\s*store_id: storeId, message_sid: result\?\.sid \|\| null, direction: 'outbound',/, 'outbound SMS must reuse the existing sendSms() helper and persist a matching message record');

// ── Contract: the TwiML App's own voice webhook (for direct browser dial via
// device.connect()) validates the destination before dialing and sets
// caller ID to the business number, same as the Call From My Phone bridge --
// this is what makes the Access Token's voice.outgoing grant actually work,
// rather than pointing at a TwiML App with no functioning webhook ──
assert.match(worker, /if \(url\.pathname === '\/twilio\/voice-outbound-app'\) \{/, 'missing /twilio/voice-outbound-app -- the TwiML App\'s Voice Request URL has nowhere to point without it');
assert.match(worker, /const to = String\(params\.To \|\| ''\)\.trim\(\);\s*\n\s*if \(!\/\^\\\+\?\[0-9\(\)\\-\.\\s\]\{7,20\}\$\/\.test\(to\) \|\| !env\.TWILIO_FROM_NUMBER\) return twimlResponse\('<Response><Say>This call could not be connected\.<\/Say><\/Response>'\);\s*\n\s*return twimlResponse\(`<Response><Dial callerId="\$\{escapeXmlText\(env\.TWILIO_FROM_NUMBER\)\}"><Number>\$\{escapeXmlText\(to\)\}<\/Number><\/Dial><\/Response>`\);/, 'voice-outbound-app must validate the destination and set callerId to the business number before dialing');

console.log('Phone system backend route contract checks passed');

// ── Contract: helper functions exist with the expected shape ──
assert.match(worker, /function phoneIdentityForUser\(userId\) \{/, 'missing phoneIdentityForUser');
assert.match(worker, /function base64UrlEncode\(bytes\) \{/, 'missing base64UrlEncode');
assert.match(worker, /async function buildTwilioAccessToken\(env, identity\) \{/, 'missing buildTwilioAccessToken');
assert.match(worker, /function normalizePhoneDigits\(s\) \{/, 'missing normalizePhoneDigits');
assert.match(worker, /async function lookupCustomerIdByPhone\(env, storeId, phoneNumber\) \{/, 'missing lookupCustomerIdByPhone');
assert.match(worker, /async function persistCallRecord\(env, record\) \{/, 'missing persistCallRecord');
assert.match(worker, /async function updateCallRecordBySid\(env, callSid, patch\) \{/, 'missing updateCallRecordBySid');
assert.match(worker, /async function persistMessageRecord\(env, record\) \{/, 'missing persistMessageRecord');
assert.match(worker, /async function persistVoicemailRecord\(env, record\) \{/, 'missing persistVoicemailRecord');
assert.match(worker, /function defaultPhoneSettings\(\) \{/, 'missing defaultPhoneSettings');
assert.match(worker, /async function getPhoneSettings\(env, storeId\) \{/, 'missing getPhoneSettings');
assert.match(worker, /function isStoreOpenNow\(businessHours, timezone\) \{/, 'missing isStoreOpenNow');
// Every persistence helper must swallow its own errors -- a Twilio webhook
// or the call/SMS itself must never fail because logging failed.
for (const fn of ['persistCallRecord', 'updateCallRecordBySid', 'persistMessageRecord', 'persistVoicemailRecord']) {
  const re = new RegExp(`async function ${fn}\\([^)]*\\) \\{\\s*\\n\\s*try \\{[\\s\\S]{0,260}?\\}\\s*\\n\\s*catch \\(e\\) \\{ \\/\\* best-effort \\*\\/ \\}`);
  assert.match(worker, re, `${fn} must catch and swallow its own errors -- a Supabase hiccup must never surface as a webhook/route failure`);
}

// ── Contract: getPhoneSettings fails open to the milestone-one defaults on
// any Supabase error -- a phone_settings hiccup must never stop the store
// from ringing (isStoreOpenNow's own always-open default only helps if the
// settings it's fed are also a safe fallback) ──
assert.match(worker, /async function getPhoneSettings\(env, storeId\) \{\s*\n\s*try \{[\s\S]{0,700}?\} catch \(e\) \{ return defaultPhoneSettings\(\); \}/, 'getPhoneSettings must fall back to defaultPhoneSettings() on any error, not throw and break the voice webhook');

// ── Contract: the voicemail-audio proxy fetches Twilio's recording with the
// account's own Basic-Auth credentials -- the dashboard never holds the
// Twilio Auth Token client-side, same pattern as sendSms()/call-from-my-phone ──
assert.match(worker, /if \(url\.pathname === '\/phone\/voicemail-audio' && request\.method === 'GET'\) \{/, 'missing GET /phone/voicemail-audio');
assert.match(worker, /const audioRes = await fetch\(`\$\{recordingUrl\}\.mp3`, \{ headers: \{ Authorization: `Basic \$\{basicAuth\}` \} \}\);/, 'voicemail-audio must fetch the recording from Twilio with Basic-Auth credentials, requesting the .mp3 rendition');

// ── Contract: mark-heard validates the voicemail id and scopes the update to
// this store (a UUID from another store must not be patchable) ──
assert.match(worker, /if \(url\.pathname === '\/phone\/voicemails\/mark-heard' && request\.method === 'POST'\) \{/, 'missing POST /phone/voicemails/mark-heard');
assert.match(worker, /voicemails\?id=eq\.\$\{encodeURIComponent\(id\)\}&store_id=eq\.\$\{encodeURIComponent\(storeId\)\}/, 'mark-heard must scope its PATCH to both the voicemail id AND this store -- never let one store mark another store\'s voicemail heard');

// ── Contract: /phone/settings POST validates business-hours time strings
// (HH:MM, 24-hour) before writing them -- malformed input must not silently
// become an always-closed or always-open day ──
assert.match(worker, /const open = \/\^\(\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d\$\/\.test\(d\.open\) \? d\.open : null;/, '/phone/settings POST must validate each day\'s open time against a strict HH:MM 24-hour pattern');

console.log('Phone system helper function contract checks passed');

// ── Functional: normalizePhoneDigits pulls the last 10 digits regardless of
// how the number was formatted, so a Twilio E.164 number and a hand-typed
// customer record can be matched despite different formatting ──
{
  const src = worker.match(/function normalizePhoneDigits\(s\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'could not extract normalizePhoneDigits for functional testing');
  const { normalizePhoneDigits } = new Function(`${src}\nreturn { normalizePhoneDigits };`)();

  assert.equal(normalizePhoneDigits('+15551234567'), '5551234567', 'a Twilio E.164 number must reduce to its last 10 digits');
  assert.equal(normalizePhoneDigits('(555) 123-4567'), '5551234567', 'a hand-formatted number with punctuation must match the same digits');
  assert.equal(normalizePhoneDigits('555.123.4567'), '5551234567', 'dot-separated formatting must normalize the same way');
  assert.equal(normalizePhoneDigits('1-555-123-4567'), '5551234567', 'a leading country-code digit must be dropped by keeping only the last 10');
  assert.equal(normalizePhoneDigits(''), '', 'an empty/missing number must normalize to an empty string, not throw');
  assert.equal(normalizePhoneDigits(null), '', 'a null number must normalize to an empty string, not throw');
}

// ── Functional: phoneIdentityForUser produces a Twilio-Client-safe identity
// string (alphanumeric only) deterministically from a user id ──
{
  const src = worker.match(/function phoneIdentityForUser\(userId\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'could not extract phoneIdentityForUser for functional testing');
  const { phoneIdentityForUser } = new Function(`${src}\nreturn { phoneIdentityForUser };`)();

  const identity = phoneIdentityForUser('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  assert.equal(identity, 'staff_a1b2c3d4e5f67890abcdef1234567890', 'a UUID user id must have its dashes stripped and a stable staff_ prefix added');
  assert.match(identity, /^[a-zA-Z0-9_]+$/, 'the identity must only contain characters Twilio Client identities allow');
  assert.equal(phoneIdentityForUser('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), phoneIdentityForUser('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), 'the same user id must always produce the same identity -- /api/phone/token and /twilio/voice\'s <Client> nouns must agree');
  assert.notEqual(phoneIdentityForUser('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), phoneIdentityForUser('11111111-2222-3333-4444-555555555555'), 'different user ids must produce different identities');
}

console.log('Phone system functional checks (normalizePhoneDigits, phoneIdentityForUser) passed');

// ── Functional: buildTwilioAccessToken produces a real, independently
// verifiable Twilio Access Token -- a three-part JWT, HS256-signed with the
// API Key Secret, carrying the voice grant Twilio's Voice JS SDK requires ──
{
  const src = worker.match(/function base64UrlEncode\(bytes\) \{[\s\S]*?\n\}\n(?:\/\/[^\n]*\n)*async function buildTwilioAccessToken\(env, identity\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'could not extract base64UrlEncode + buildTwilioAccessToken for functional testing');
  const { buildTwilioAccessToken } = new Function(`${src}\nreturn { buildTwilioAccessToken };`)();

  const env = {
    TWILIO_API_KEY_SID: 'SKtest0000000000000000000000000',
    TWILIO_API_KEY_SECRET: 'test-api-key-secret',
    TWILIO_ACCOUNT_SID: 'ACtest0000000000000000000000000',
    TWILIO_TWIML_APP_SID: 'APtest0000000000000000000000000',
  };
  const token = await buildTwilioAccessToken(env, 'staff_abc123');
  const parts = token.split('.');
  assert.equal(parts.length, 3, 'a Twilio Access Token must be a standard three-part JWT (header.payload.signature)');

  const b64urlToJson = (part) => JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  const header = b64urlToJson(parts[0]);
  const payload = b64urlToJson(parts[1]);

  assert.equal(header.alg, 'HS256', 'the token must be HS256-signed');
  assert.equal(header.typ, 'JWT');
  assert.equal(header.cty, 'twilio-fpa;v=1', 'the header must carry Twilio\'s Access Token content-type marker');
  assert.equal(payload.iss, env.TWILIO_API_KEY_SID, 'iss must be the API Key SID');
  assert.equal(payload.sub, env.TWILIO_ACCOUNT_SID, 'sub must be the Account SID');
  assert.equal(payload.grants.identity, 'staff_abc123', 'the grants.identity must match the identity passed in, not the raw user id');
  assert.equal(payload.grants.voice.outgoing.application_sid, env.TWILIO_TWIML_APP_SID, 'the voice grant must name the TwiML App that handles browser-initiated outgoing calls');
  assert.equal(payload.grants.voice.incoming.allow, true, 'the voice grant must allow incoming <Client> calls, or the ring-group <Client> noun would never actually ring the browser');
  assert.ok(payload.exp > payload.iat, 'the token must have a real expiry after its issued-at time');

  // Independently re-derive the signature the exact way Twilio verifies it,
  // and confirm it matches -- proves the function signs correctly, not just
  // that it produces JWT-shaped output.
  const signingInput = `${parts[0]}.${parts[1]}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TWILIO_API_KEY_SECRET), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const expectedSigBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput)));
  let bin = ''; for (const b of expectedSigBytes) bin += String.fromCharCode(b);
  const expectedSig = Buffer.from(bin, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(parts[2], expectedSig, 'the token\'s signature must match an independently computed HMAC-SHA256 over header.payload using the API Key Secret');

  // Missing config must fail loudly, not silently issue a broken/unsigned token.
  await assert.rejects(() => buildTwilioAccessToken({}, 'staff_abc123'), /not configured/, 'buildTwilioAccessToken must refuse to run without all four Twilio env vars set, not produce a token that will fail against a real account');
}

console.log('Twilio Access Token (buildTwilioAccessToken) functional checks passed');

// ── Functional: isStoreOpenNow -- back-compat default (empty config = always
// open), day-of-week + time-window gating, and safe-fail behavior ──
{
  const src = worker.match(/function isStoreOpenNow\(businessHours, timezone\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'could not extract isStoreOpenNow for functional testing');
  const { isStoreOpenNow } = new Function(`${src}\nreturn { isStoreOpenNow };`)();

  assert.equal(isStoreOpenNow({}, 'America/New_York'), true, 'an empty business_hours object must mean always-open -- the exact milestone-one behavior, so a store that never visits the settings panel sees no change');
  assert.equal(isStoreOpenNow(null, 'America/New_York'), true, 'a null/missing business_hours must also mean always-open');

  // Build a window that is definitely open right now, and one that
  // definitely is not, in a fixed timezone -- avoids any real-clock flakiness
  // by deriving both windows from the current instant.
  const tz = 'America/New_York';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const dayKey = parts.find(p => p.type === 'weekday').value.toLowerCase().slice(0, 3);
  let hour = Number(parts.find(p => p.type === 'hour').value);
  if (hour === 24) hour = 0;
  const minute = Number(parts.find(p => p.type === 'minute').value);
  const pad = (n) => String(n).padStart(2, '0');

  const openAllDay = { [dayKey]: { open: '00:00', close: '23:59', closed: false } };
  assert.equal(isStoreOpenNow(openAllDay, tz), true, 'a configured window spanning the whole current day must read as open');

  const closedToday = { [dayKey]: { closed: true } };
  assert.equal(isStoreOpenNow(closedToday, tz), false, 'a day explicitly marked closed must read as closed even if a time window is never checked');

  const otherDayOnly = { [dayKey === 'mon' ? 'tue' : 'mon']: { open: '00:00', close: '23:59', closed: false } };
  assert.equal(isStoreOpenNow(otherDayOnly, tz), false, 'a non-empty config that omits today entirely must read as closed today, not fall back to always-open');

  // A window that has already ended (closes at the current hour:minute, so
  // "now" is not strictly before close) must read as closed.
  const justClosed = { [dayKey]: { open: '00:00', close: `${pad(hour)}:${pad(minute)}`, closed: false } };
  assert.equal(isStoreOpenNow(justClosed, tz), false, 'a window whose close time is not after the current time must read as closed (half-open interval)');

  assert.equal(isStoreOpenNow({ [dayKey]: { open: 'garbage', close: 'garbage', closed: false } }, tz), true, 'unparseable open/close values must fail OPEN, not silently stop the phone from ringing');

  console.log('isStoreOpenNow functional checks passed');
}
