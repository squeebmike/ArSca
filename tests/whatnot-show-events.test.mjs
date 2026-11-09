import assert from 'node:assert/strict';
import fs from 'node:fs';
import { whatnotShowEventFields, planWhatnotShowEvents, syncWhatnotShowEvents, whatnotEventSlug, EVENTS_ONLINE_TYPE, EVENTS_PORTRAIT } from '../scripts/whatnot-show-events.mjs';
// Store, 2026-11-09: scheduled Whatnot shows fill the homepage's Pocket
// Events (Webflow CMS) and publish on their own.
const now = Date.parse('2026-11-09T12:00:00Z');
const show = { id: 'U2hvd05vZGU6MTIz', title: 'Sunday Pokemon + Comics', scheduled_start_at: '2026-11-15T02:00:00Z' };
const f = whatnotShowEventFields(show);
assert.equal(f.slug, 'whatnot-u2hvd05vzgu6mtiz');
assert.equal(f['event-type'], EVENTS_ONLINE_TYPE, 'Online Live Show');
assert.equal(f['video-orientation'], EVENTS_PORTRAIT);
assert.equal(f['start-date-time'], '2026-11-15T02:00:00.000Z');
assert.equal(f['end-date-time'], '2026-11-15T04:00:00.000Z', 'two hours');
assert.equal(f['location-or-platform'], 'Whatnot');
assert.equal(f['show-on-homepage'], true);
assert.equal(f['watch-or-details-url'], 'https://www.whatnot.com/user/themanapocket', 'the profile when Whatnot gives no show link');
// The API's dashboard edit link becomes the public live page.
assert.equal(whatnotShowEventFields({ id: 'b5b3ca85-cb59-40a2-ba07-419784dc8a5e', title: 'x', scheduled_start_at: '2026-11-11T19:00:00Z', url: 'https://www.whatnot.com/dashboard/lives/edit/b5b3ca85-cb59-40a2-ba07-419784dc8a5e' })['watch-or-details-url'], 'https://www.whatnot.com/live/b5b3ca85-cb59-40a2-ba07-419784dc8a5e');
assert.equal(whatnotShowEventFields({ id: '6278bfce-01ef-4b97-810f-57eceaf89cbd', title: 'x', scheduled_start_at: '2026-11-10T19:20:00Z' })['watch-or-details-url'], 'https://www.whatnot.com/live/6278bfce-01ef-4b97-810f-57eceaf89cbd', 'a UUID show id is enough');
assert.equal(whatnotShowEventFields({ ...show, url: 'https://www.whatnot.com/dashboard/other' })['watch-or-details-url'], 'https://www.whatnot.com/user/themanapocket', 'never a dashboard link');
assert.equal(whatnotShowEventFields({ ...show, url: 'https://evil.example/x' })['watch-or-details-url'], 'https://www.whatnot.com/user/themanapocket', 'only whatnot.com links');
assert.match(f.description, /Sunday Pokemon \+ Comics/);

// Plan: new shows created, changed ones updated, unchanged left alone,
// cancelled future ones taken off the homepage, the store's own items never touched.
const item = (slug, fieldData, extra = {}) => ({ id: 'wf-' + slug, isDraft: false, isArchived: false, fieldData: { slug, ...fieldData }, ...extra });
const moved = { id: 'moved', title: 'Moved show', scheduled_start_at: '2026-11-20T03:00:00Z' };
const items = [
  item(f.slug, f),                                                        // unchanged
  item(whatnotEventSlug('moved'), { ...whatnotShowEventFields({ ...moved, scheduled_start_at: '2026-11-19T03:00:00Z' }) }), // time changed
  item(whatnotEventSlug('gone'), { 'start-date-time': '2026-11-25T03:00:00Z', 'show-on-homepage': true }), // cancelled
  item(whatnotEventSlug('soon'), { 'start-date-time': '2026-11-09T12:30:00Z', 'show-on-homepage': true }), // went live early: keep
  item(whatnotEventSlug('past'), { 'start-date-time': '2026-11-01T03:00:00Z', 'show-on-homepage': true }), // past: keep
  item('twin-oaks-card-show', { 'start-date-time': '2026-11-30T18:00:00Z', 'show-on-homepage': true }),   // hand-made: never touched
];
const plan = planWhatnotShowEvents([show, moved, { id: 'new', title: 'New', scheduled_start_at: '2026-11-22T03:00:00Z' }, { id: 'bad', scheduled_start_at: '' }], items, now);
assert.deepEqual(plan.create.map(c => c.slug), ['whatnot-new']);
assert.deepEqual(plan.update.map(u => u.id), ['wf-whatnot-moved']);
assert.deepEqual(plan.hide.map(h => [h.id, h.fieldData]), [['wf-whatnot-gone', { 'show-on-homepage': false }]]);
// A draft or archived copy of a show is republished.
assert.deepEqual(planWhatnotShowEvents([show], [item(f.slug, f, { isDraft: true })], now).update.map(u => u.id), ['wf-' + f.slug]);

// The sync runs the plan and keeps going past an error.
const calls = [];
const r = await syncWhatnotShowEvents({ shows: async () => [show, moved], listItems: async () => items.slice(1, 3), createLive: async fd => { calls.push(['create', fd.slug]); if (fd.slug === f.slug) throw new Error('nope'); }, updateLive: async (id, fd) => calls.push(['update', id, fd['show-on-homepage']]) }, now);
assert.deepEqual([r.created, r.updated, r.hidden, r.errors.length], [0, 1, 1, 1]);

// Wired into the worker: hourly from the Whatnot run, at once on a show webhook, and a manual sync.
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(w, /runScheduledWhatnotSync\(env, ctx\), runWhatnotShowEventsSync\(env\),/);
assert.match(w, /if \(showId\) await runWhatnotShowEventsSync\(env, \{ force: true \}\)/);
assert.match(w, /if \(Date\.now\(\) - last < 55 \* 60 \* 1000\) return \{ skipped: 'ran recently' \};/);
assert.match(w, /wf\('\/items\/live', \{ method: 'POST'/);
assert.match(w, /url\.pathname === '\/whatnot\/show-events\/sync' && request\.method === 'POST'/);
assert.match(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8'), /scripts\/whatnot-show-events\.mjs/);
console.log('Whatnot shows on the homepage: fields, create/update/hide plan, worker wiring passed');
