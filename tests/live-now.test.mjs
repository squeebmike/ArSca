import fs from 'node:fs';
import assert from 'node:assert/strict';
// 2026-11-27: the website's LIVE ON WHATNOT banner -- the Worker notes the live show in KV, the site asks /public/live-now.
const L = await import('../scripts/live-now.mjs');
const id = '0b6a1f3e-1111-4222-8333-444455556666';
const kv = { m: new Map(), writes: 0, async get(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }, async put(k, v) { this.writes++; this.m.set(k, v); }, async delete(k) { this.writes++; this.m.delete(k); } };
assert.equal(L.pickLiveShow([{ showId: 'a', status: 'planning' }, { showId: id, status: 'live', title: 'Wednesday New Releases' }]).showId, id);
assert.equal(L.pickLiveShow([{ showId: 'a', status: 'ended' }]), null);
const t0 = Date.parse('2026-11-27T01:00:00Z');
assert.equal((await L.noteLiveNow(kv, 's', { showId: id, title: 'NCBD' }, { now: t0 })).changed, true);
assert.equal((await L.noteLiveNow(kv, 's', { showId: id, title: 'NCBD' }, { now: t0 + 600000 })).changed, false, 'no write every 10 minutes');
assert.equal(kv.writes, 1);
const pub = L.publicLiveNow(await kv.get(L.liveNowKey('s')), t0 + 60000);
assert.deepEqual(pub, { live: true, title: 'NCBD', url: 'https://www.whatnot.com/live/' + id, since: new Date(t0).toISOString() });
assert.equal(L.publicLiveNow(await kv.get(L.liveNowKey('s')), t0 + 9 * 3600000).live, false, 'a stale note is never shown');
assert.equal((await L.noteLiveNow(kv, 's', null, { onlyIfShowId: 'other' })).changed, false, "another show's end leaves it");
assert.equal((await L.noteLiveNow(kv, 's', null, { onlyIfShowId: id })).changed, true);
assert.deepEqual(L.publicLiveNow(null), { live: false });
assert.equal(L.liveShowUrl('nope'), L.WHATNOT_PROFILE);
// Wiring: the public route, the webhook, the 10-minute sync, refreshWhatnotShow's title.
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8'), sync = fs.readFileSync('scripts/whatnot-sync.mjs', 'utf8');
assert.ok(w.includes("if (url.pathname === '/public/live-now' && request.method === 'GET') {"));
assert.ok(w.includes("if (shown?.status === 'live') await noteLiveNow(") && w.includes("if (shown?.status === 'ended') await noteLiveNow("));
assert.ok(w.includes('pickLiveShow(synced.shows)'));
assert.ok(sync.includes('return { showId: show.id, status, title: row.title };'));
assert.ok(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8').includes('scripts/live-now.mjs'));
console.log('Live on Whatnot banner (Worker): passed');
// 2026-11-28: the homepage said "The live show is happening now" after the show ended -- a Whatnot show on the
// schedule is live only while Whatnot says so, and a live one links straight to the show.
{ const now = Date.parse('2026-11-28T16:50:00Z');
  const sched = id => ({ id: 'ev-' + id, start: '2026-11-28T16:00:00.000Z', end: '2026-11-28T18:00:00.000Z', title: 'Shed Show', type: 'Online Live Show', online: true, href: 'https://www.whatnot.com/live/' + id });
  const a = '11111111-2222-4333-8444-555566667777', b = '99999999-2222-4333-8444-555566667777';
  const off = L.eventsWithLiveNow([sched(a)], null, now);
  assert.ok(Date.parse(off[0].end) < now, 'not live on Whatnot: its window is over, so the card goes off air');
  const rec = { showId: a, title: 'Shed Show', since: new Date(now - 600000).toISOString() };
  const on = L.eventsWithLiveNow([sched(a)], rec, now);
  assert.ok(Date.parse(on[0].start) <= now && Date.parse(on[0].end) > now && on[0].live === true && on[0].href === 'https://www.whatnot.com/live/' + a);
  const extra = L.eventsWithLiveNow([sched(b)], rec, now);
  assert.equal(extra.length, 2); assert.ok(Date.parse(extra.find(e => e.href.includes(b)).end) < now, 'the other scheduled show is not live');
  assert.equal(extra.find(e => e.live).href, 'https://www.whatnot.com/live/' + a, 'a live show not on the schedule still shows');
  const later = { ...sched(a), start: '2026-12-01T16:00:00.000Z', end: '2026-12-01T18:00:00.000Z' };
  assert.deepEqual(L.eventsWithLiveNow([later], null, now), [later], 'future shows untouched');
  const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
  assert.ok(w.includes('const events = eventsWithLiveNow(loaded, liveRec);'));
  console.log('Homepage live card follows Whatnot: passed'); }
