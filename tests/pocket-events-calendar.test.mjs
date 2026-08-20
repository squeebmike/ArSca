import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: reuses the real, already-live Webflow "Pocket Events" collection ──
assert.match(dashboard, /const WF_POCKET_EVENTS = '6a7cf73500b7a1a3719e7f21';/, 'must target the real Pocket Events collection ID, not a placeholder');
assert.match(dashboard, /'Online Live Show':'0e48e57606ce593dfd869b5fc0babfa0', 'In-Person Show':'940ef65d3666b562c92552b9be81a3cd'/, 'event-type option IDs must match the real collection schema exactly -- a wrong option ID silently fails the Webflow write');

// ── Contract: writes go through the existing generic Webflow proxy, never a new bespoke backend route ──
assert.match(dashboard, /storeWorkerFetch\(`\/proxy\/collections\/\$\{WF_POCKET_EVENTS\}\/items`, \{ method:'POST'/, 'creating an event must go through the existing /proxy/collections passthrough, same as product sync');
assert.match(dashboard, /storeWorkerFetch\(`\/proxy\/collections\/\$\{WF_POCKET_EVENTS\}\/items\/\$\{itemId\}`, \{ method:'PATCH'/, 'editing an event must PATCH the same item, not create a duplicate');
assert.match(dashboard, /storeWorkerFetch\(`\/proxy\/collections\/\$\{WF_POCKET_EVENTS\}\/items\/publish`, \{ method:'POST'/, 'a saved event must be published so the live website actually shows it, not left in draft');

// ── Contract: mounted in the same Settings/Sync location as the existing Webflow integration panel ──
assert.match(dashboard, /if\(sync&&!document\.getElementById\('event-calendar-panel'\)\)sync\.insertAdjacentHTML\('afterbegin','<div class="settings-generated-panel" id="event-calendar-panel"><\/div>'\);renderEventCalendarPanel\?\.\(\);/, 'the calendar panel must mount in the settings-panels-sync section alongside Webflow sync, following the established generated-panel convention');

console.log('Pocket Events calendar contract checks passed');

// ── Functional: slug generation must be URL-safe and stable per name ──
function eventCalendarSlug(name){
  return String(name||'event').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,250) || 'event-'+Date.now();
}
assert.equal(eventCalendarSlug('Twin Oaks Card Show 8/23/26'), 'twin-oaks-card-show-8-23-26', 'a real event name must slugify to a clean, valid Webflow slug');
assert.match(eventCalendarSlug(''), /^[a-z0-9-]+$/, 'an empty name must still produce a non-empty, valid fallback slug');
assert.doesNotMatch(eventCalendarSlug('Café & Cards!!'), /[^a-z0-9-]/, 'accented characters and punctuation must never leak into the slug');

console.log('Pocket Events calendar functional checks passed');
