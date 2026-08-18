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
for (const fn of ['ensurePhonePanel', 'renderPhonePanel', 'renderPhonePanelInto', 'renderPhoneCallsList', 'renderPhoneMessagesList', 'phoneCallStatusLabel', 'savePhoneEndpointSettings', 'sendPhoneSms', 'startCallFromMyPhone', 'initPhoneDevice', 'showIncomingPhoneCall', 'acceptIncomingPhoneCall', 'rejectIncomingPhoneCall', 'closeIncomingPhoneCallModal', 'dialPhoneNumber', 'renderVoicemailsList', 'playPhoneVoicemail', 'renderPhoneSettingsPanelHtml', 'togglePhoneHoursRow', 'togglePhoneHoursEnabled', 'savePhoneSettings']) {
  assert.match(dashboard, new RegExp(`function ${fn}\\(`), `missing ${fn}`);
}

// ── Contract: PHONE SETTINGS (business hours / voicemail policy) is
// owner/admin gated, matching the same requireOwnerAdmin() convention used
// elsewhere (e.g. Stripe Connect setup) -- it must not render its HTML at
// all for other roles, not just hide it with CSS ──
assert.match(dashboard, /function renderPhoneSettingsPanelHtml\(\)\{\s*\n\s*if\(!requireOwnerAdmin\(\)\) return '';/, 'renderPhoneSettingsPanelHtml must refuse to render anything for non-owner/admin roles');

// ── Contract: leaving the business-hours master toggle off must write an
// EMPTY businessHours object (always-open, the milestone-one default) --
// never a per-day config assembled from stale/default input values the user
// never actually reviewed ──
assert.match(dashboard, /const hoursEnabled = document\.getElementById\('phone-settings-hours-enabled'\)\?\.checked === true;\s*\n\s*const businessHours = \{\};\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if\(hoursEnabled\)\{/, 'savePhoneSettings must only populate businessHours when the master toggle is explicitly on');

// ── Contract: the voicemail-audio proxy is fetched through storeWorkerFetch
// (carries the auth header a bare <audio src> tag could never send), not
// pointed at directly ──
assert.match(dashboard, /const res = await storeWorkerFetch\(`\/phone\/voicemail-audio\?id=\$\{encodeURIComponent\(id\)\}`\);/, 'playPhoneVoicemail must fetch the recording through the authenticated storeWorkerFetch proxy');
assert.match(dashboard, /storeWorkerFetch\('\/phone\/voicemails\/mark-heard', \{ method:'POST', body:JSON\.stringify\(\{ id \}\) \}\)\.catch\(\(\) => \{\}\);/, 'playing a voicemail must mark it heard');

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
  assert.equal(phoneCallStatusLabel({ status:'voicemail' }), 'Left voicemail', 'a call that ended in voicemail must render distinctly from a plain no-answer');
  assert.equal(phoneCallStatusLabel({ status:'after-hours' }), 'After hours', 'a call rejected by business-hours gating must render distinctly from a live no-answer');
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

// ── Functional: renderVoicemailsList renders every voicemail, marks unheard
// ones NEW, and wires click-to-call/click-to-play ──
{
  const listSrc = dashboard.match(/function renderVoicemailsList\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(listSrc, 'could not extract renderVoicemailsList for functional testing');
  const escHtml = (s) => String(s == null ? '' : s);
  const voicemails = [
    { id:'vm-1', from_number:'+15551112222', heard:false, duration_seconds:12, created_at:'2026-08-20T12:00:00Z' },
    { id:'vm-2', from_number:'+15553334444', heard:true, duration_seconds:30, created_at:'2026-08-20T13:00:00Z' },
  ];
  const { renderVoicemailsList } = new Function('escHtml', '_phoneVoicemails', `${listSrc}\nreturn { renderVoicemailsList };`)(escHtml, voicemails);
  const html = renderVoicemailsList();
  assert.ok(html.includes('+15551112222') && html.includes('+15553334444'), 'both voicemails must render');
  assert.ok(html.includes(`playPhoneVoicemail('vm-1'`) && html.includes(`playPhoneVoicemail('vm-2'`), 'every voicemail must have a play button wired to playPhoneVoicemail');
  assert.ok(html.includes(`dialPhoneNumber('+15551112222')`), 'the caller number must be click-to-call');
  const unheardIdx = html.indexOf('+15551112222');
  const heardIdx = html.indexOf('+15553334444');
  assert.ok(html.slice(unheardIdx, heardIdx).includes('NEW'), 'the unheard voicemail must show a NEW badge');
  assert.ok(!html.slice(heardIdx).includes('NEW'), 'an already-heard voicemail must not show the NEW badge');

  const { renderVoicemailsList: emptyList } = new Function('escHtml', '_phoneVoicemails', `${listSrc}\nreturn { renderVoicemailsList };`)(escHtml, []);
  assert.ok(emptyList().includes('No voicemails yet'), 'an empty voicemail inbox must render a friendly empty state');
}

// ── Functional: renderPhoneSettingsPanelHtml is owner/admin-gated, defaults
// to the always-open/voicemail-on state, and reflects a saved config ──
{
  const settingsSrc = dashboard.match(/function renderPhoneSettingsPanelHtml\(\)\{[\s\S]*?\n\}/)?.[0];
  const daysSrc = dashboard.match(/const PHONE_HOURS_DAYS = \[.*\];/)?.[0];
  const tzSrc = dashboard.match(/const PHONE_TIMEZONES = \[.*\];/)?.[0];
  assert.ok(settingsSrc && daysSrc && tzSrc, 'could not extract renderPhoneSettingsPanelHtml + its constants for functional testing');
  const escHtml = (s) => String(s == null ? '' : s);

  const buildFn = (requireOwnerAdmin, phoneSettings) => new Function(
    'escHtml', 'requireOwnerAdmin', '_phoneSettings',
    `${daysSrc}\n${tzSrc}\n${settingsSrc}\nreturn { renderPhoneSettingsPanelHtml };`
  )(escHtml, requireOwnerAdmin, phoneSettings).renderPhoneSettingsPanelHtml;

  assert.equal(buildFn(() => false, null)(), '', 'a non-owner/admin role must get no settings panel HTML at all');

  const defaultHtml = buildFn(() => true, null)();
  assert.ok(defaultHtml.includes('id="phone-settings-voicemail-enabled" checked'), 'with no saved settings, voicemail must default to enabled (milestone-one behavior)');
  assert.ok(defaultHtml.includes(`id="phone-settings-hours-enabled" `) && !defaultHtml.includes('id="phone-settings-hours-enabled" checked'), 'with no saved settings, the business-hours master toggle must default OFF -- always-open, not a surprise restriction');
  assert.ok(defaultHtml.includes('display:none') , 'the day-by-day hours rows must stay hidden while the master toggle is off');

  const configured = { voicemailEnabled:false, greetingMessage:'Leave a message', closedMessage:'We are closed', timezone:'America/Chicago', businessHours:{ mon:{ open:'09:00', close:'17:00', closed:false }, sun:{ closed:true } } };
  const configuredHtml = buildFn(() => true, configured)();
  assert.ok(!configuredHtml.includes('id="phone-settings-voicemail-enabled" checked'), 'a saved voicemailEnabled:false must render unchecked');
  assert.ok(configuredHtml.includes('id="phone-settings-hours-enabled" checked'), 'a non-empty saved businessHours must show the master toggle ON');
  assert.ok(!configuredHtml.slice(configuredHtml.indexOf('phone-hours-rows'), configuredHtml.indexOf('phone-hours-rows') + 40).includes('display:none'), 'the hours rows container must be visible once the master toggle is on');
  assert.ok(configuredHtml.includes('id="phone-hours-mon-open" value="09:00"'), 'a configured day\'s saved open time must round-trip into its input');
  assert.ok(configuredHtml.includes('id="phone-hours-sun-closed" checked'), 'a day explicitly marked closed must render its Closed checkbox checked');
  assert.ok(configuredHtml.includes('Chicago'), 'the saved timezone must be reflected in the timezone select');
}

console.log('Phone system dashboard voicemail + settings functional checks passed');
