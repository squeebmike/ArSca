import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: the Twilio Voice JS SDK is loaded like every other CDN library
// in this file, and only actually connects once a staff member opts in ──
assert.match(dashboard, /<script src="https:\/\/sdk\.twilio\.com\/js\/voice\/releases\/[0-9.]+\/twilio\.min\.js" defer><\/script>/, 'missing the Twilio Voice JS SDK script tag');

// ── Contract: PHONE is wired into the tab system the same way every other
// tab is (a MORE_TABS entry, a panel container, a switchTab lazy-render
// hook, and an explicit employee-role allow-list entry -- the allow-list is
// hand-maintained, so a forgotten entry silently locks employees out) ──
assert.match(dashboard, /\['pulllists', 'PULL LISTS'\],\s*\n\s*\['foc', 'COMICS \/ FOC'\],\s*\n\s*\['phone', 'PHONE'\],/, 'PHONE must be registered in MORE_TABS, alongside the other secondary tabs');
assert.match(dashboard, /<div id="tab-phone" class="tab-panel">\s*\n\s*<div class="sec">PHONE<\/div>\s*\n\s*<div id="phone-panels"/, 'missing the #tab-phone panel container / #phone-panels mount point');
assert.match(dashboard, /if\(name === 'phone'\) setTimeout\(ensurePhonePanel, 0\);/, 'switchTab must lazily render the Phone panel the same way every other secondary tab does');
assert.match(dashboard, /else if\(role === 'employee'\) allowed = \[[^\]]*'phone'[^\]]*\]\.includes\(tab\);/, 'employees must be explicitly allow-listed for the phone tab, or roleCanAccessTab silently locks them out');

// ── Contract: core functions exist ──
for (const fn of ['ensurePhonePanel', 'renderPhonePanel', 'renderPhonePanelInto', 'renderPhoneCallsList', 'renderPhoneMessagesList', 'phoneCallStatusLabel', 'savePhoneEndpointSettings', 'sendPhoneSms', 'startCallFromMyPhone', 'initPhoneDevice', 'showIncomingPhoneCall', 'acceptIncomingPhoneCall', 'rejectIncomingPhoneCall', 'closeIncomingPhoneCallModal', 'dialPhoneNumber']) {
  assert.match(dashboard, new RegExp(`function ${fn}\\(`), `missing ${fn}`);
}

// ── Contract: demo mode is blocked (calling/texting need a live store and
// live Worker routes, same reasoning as storeWorkerFetch's own demo guard) ──
assert.match(dashboard, /async function renderPhonePanel\(\)\{\s*\n\s*const container = document\.getElementById\('phone-panels'\);\s*\n\s*if\(!container\) return;\s*\n\s*if\(getAccountContext\(\)\.isDemo\)\{/, 'renderPhonePanel must check demo mode before hitting any live Worker route');

// ── Contract: the toll-fraud guard has no client-side counterpart that could
// undermine it -- startCallFromMyPhone must send only the customer number,
// never anything resembling a bridge-back/callback number ──
assert.match(dashboard, /storeWorkerFetch\('\/phone\/call-from-my-phone', \{ method:'POST', body:JSON\.stringify\(\{ customerNumber \}\) \}\);/, 'the dashboard must only ever send customerNumber to call-from-my-phone -- the bridge-back number must stay a pure server-side lookup');

// ── Contract: the browser device is a persistent module-level variable, not
// re-created on every Phone-tab visit, so an already-registered device keeps
// ringing while the user is elsewhere in the app ──
assert.match(dashboard, /async function initPhoneDevice\(\)\{\s*\n\s*if\(_phoneDevice\) return;/, 'initPhoneDevice must be a no-op if a device already exists -- switching tabs must never tear down and rebuild a live connection');
assert.match(dashboard, /_phoneDevice\.on\('incoming', \(call\) => showIncomingPhoneCall\(call\)\);/, 'missing the incoming-call handler wiring');
assert.match(dashboard, /_phoneDevice\.on\('tokenWillExpire',/, 'missing token-refresh handling -- an Access Token expiring mid-session would silently drop the browser out of the ring group');

console.log('Phone system dashboard wiring contract checks passed');

// ── Functional: phoneCallStatusLabel maps every real call status to a
// human-readable label, and falls back safely for anything unrecognized ──
{
  const src = dashboard.match(/function phoneCallStatusLabel\(call\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'could not extract phoneCallStatusLabel for functional testing');
  const escHtml = (s) => String(s == null ? '' : s);
  const { phoneCallStatusLabel } = new Function('escHtml', `${src}\nreturn { phoneCallStatusLabel };`)(escHtml);

  assert.equal(phoneCallStatusLabel({ status:'answered' }), 'Answered');
  assert.equal(phoneCallStatusLabel({ status:'no-answer' }), 'No answer');
  assert.equal(phoneCallStatusLabel({ status:'busy' }), 'Busy');
  assert.equal(phoneCallStatusLabel({ status:'failed' }), 'Failed');
  assert.equal(phoneCallStatusLabel({ status:'ringing' }), 'Ringing...');
  assert.equal(phoneCallStatusLabel({ status:'some-future-status' }), 'some-future-status', 'an unrecognized status must still render as text, not blank out or throw');
  assert.equal(phoneCallStatusLabel({ status:'' }), '', 'a missing status must not throw');
}

// ── Functional: the calls/messages lists render every row, distinguish
// inbound/outbound, and never throw on a partially-null row ──
{
  const listSrc = dashboard.match(/function renderPhoneCallsList\(\)\{[\s\S]*?\n\}/)?.[0];
  const statusSrc = dashboard.match(/function phoneCallStatusLabel\(call\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(listSrc && statusSrc, 'could not extract renderPhoneCallsList for functional testing');
  const escHtml = (s) => String(s == null ? '' : s);
  const calls = [
    { direction:'inbound', from_number:'+15551112222', status:'answered', duration_seconds:42, created_at:'2026-08-19T12:00:00Z' },
    { direction:'outbound', to_number:'+15553334444', status:'no-answer', duration_seconds:null, created_at:'2026-08-19T13:00:00Z' },
  ];
  const { renderPhoneCallsList } = new Function('escHtml', '_phoneCalls', `${statusSrc}\n${listSrc}\nreturn { renderPhoneCallsList };`)(escHtml, calls);
  const html = renderPhoneCallsList();
  assert.ok(html.includes('+15551112222') && html.includes('+15553334444'), 'both calls must render');
  assert.ok(html.includes('↓') && html.includes('↑'), 'inbound and outbound calls must render with distinct direction markers');
  assert.ok(html.includes('42s'), 'a known duration must render');
  assert.ok(html.includes('Answered') && html.includes('No answer'), 'both call statuses must render their human-readable label');

  const { renderPhoneCallsList: emptyList } = new Function('escHtml', '_phoneCalls', `${statusSrc}\n${listSrc}\nreturn { renderPhoneCallsList };`)(escHtml, []);
  assert.ok(emptyList().includes('No calls yet'), 'an empty call history must render a friendly empty state, not a blank panel');

  assert.ok(html.includes(`dialPhoneNumber('+15551112222')`) && html.includes(`dialPhoneNumber('+15553334444')`), 'every call\'s number must be click-to-call, wired to dialPhoneNumber');
}

console.log('Phone system dashboard functional checks passed');

// ── Contract: dialPhoneNumber prefers a live browser device (direct
// device.connect(), routed through /twilio/voice-outbound-app) and falls
// back to filling the number into Call From My Phone rather than doing
// nothing when browser calling isn't connected ──
assert.match(dashboard, /function dialPhoneNumber\(number\)\{\s*\n\s*if\(!number\) return;\s*\n\s*if\(_phoneDevice && _phoneDevice\.state === 'registered'\)\{\s*\n\s*try \{ _phoneDevice\.connect\(\{ params:\{ To:number \} \}\); toast_dash\('Calling ' \+ number \+ '\.\.\.'\); return; \}/, 'dialPhoneNumber must prefer a live registered device and dial directly via device.connect()');
assert.match(dashboard, /const input = document\.getElementById\('phone-cfmp-number'\);\s*\n\s*if\(input\)\{ input\.value = number;/, 'dialPhoneNumber must fall back to filling the Call From My Phone box when browser calling is off, not silently do nothing');

console.log('Phone system dashboard click-to-call checks passed');
