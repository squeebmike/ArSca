// LIVE ON WHATNOT, on the website (store, 2026-11-27: "can we get the actual show that's playing to stream across over
// to the website?" -- the seller API has no video, so the site shows a "We're LIVE on Whatnot" banner with a WATCH
// NOW button instead). The Worker notes the live show in KV when Whatnot says it went live (webhook, and the 10-minute
// sync as a backstop); the site asks GET /public/live-now, edge-cached, so no database is touched.
export const liveNowKey = storeId => 'whatnot-live-now:' + storeId;
export const WHATNOT_PROFILE = 'https://www.whatnot.com/user/themanapocket';
const MAX_SHOW_MS = 8 * 3600 * 1000; // a note never outlives a long show, even if the "ended" never reaches us

export function liveShowUrl(showId) {
  return /^[0-9a-f-]{36}$/i.test(String(showId || '')) ? 'https://www.whatnot.com/live/' + String(showId).toLowerCase() : WHATNOT_PROFILE;
}

// shows: [{ showId, status, title }] from refreshWhatnotShow. The live one, or null.
export function pickLiveShow(shows = []) {
  const sh = (shows || []).find(x => x && x.status === 'live' && x.showId);
  return sh ? { showId: String(sh.showId), title: String(sh.title || '').slice(0, 140) } : null;
}

// Writes only on a change. show: { showId, title } or null (nothing live). onlyIfShowId: an "ended" for one show
// clears the note only if it's that show.
export async function noteLiveNow(kv, storeId, show, { now = Date.now(), onlyIfShowId = '' } = {}) {
  const key = liveNowKey(storeId);
  const have = await kv.get(key, 'json').catch(() => null);
  if (!show) {
    if (!have || (onlyIfShowId && have.showId !== onlyIfShowId)) return { changed: false };
    await kv.delete(key); return { changed: true, live: false };
  }
  if (have && have.showId === show.showId && (have.title || '') === (show.title || '') && now - Date.parse(have.since) < MAX_SHOW_MS) return { changed: false };
  const rec = { showId: show.showId, title: show.title || '', since: have?.showId === show.showId ? have.since : new Date(now).toISOString() };
  await kv.put(key, JSON.stringify(rec), { expirationTtl: MAX_SHOW_MS / 1000 });
  return { changed: true, live: true };
}

// What the website gets: no ids beyond the public show link.
export function publicLiveNow(rec, now = Date.now()) {
  if (!rec?.showId || !(now - Date.parse(rec.since) < MAX_SHOW_MS)) return { live: false };
  return { live: true, title: rec.title || 'Live on Whatnot', url: liveShowUrl(rec.showId), since: rec.since };
}

// THE HOMEPAGE'S LIVE CARD (store, 2026-11-28: "we're not live. The show had ended. So how do we get this off the
// website when there isn't a live show? ... if there is a live show, ... that link that takes you right to the show").
// The homepage called a Whatnot show live for its whole scheduled window. Now a Whatnot show on the schedule is live
// only while Whatnot says so: not live -> its window is over (the card goes back to off air and the next show);
// live -> it runs now, linked straight to the show (one that isn't on the schedule gets its own entry).
const WHATNOT_LIVE = /^https:\/\/(www\.)?whatnot\.com\/live\/([0-9a-f-]{36})/i;
export function eventsWithLiveNow(events = [], rec, now = Date.now()) {
  const live = publicLiveNow(rec, now), liveId = live.live ? String(rec.showId).toLowerCase() : '';
  const soon = new Date(now + 15 * 60000).toISOString(), past = new Date(now - 1000).toISOString();
  let matched = false;
  const out = (events || []).map(e => {
    const id = (String(e?.href || '').match(WHATNOT_LIVE) || [])[2]?.toLowerCase();
    if (!id) return e;
    if (id === liveId) { matched = true; return { ...e, start: Date.parse(e.start) < now ? e.start : new Date(now - 60000).toISOString(), end: soon, href: live.url, live: true }; }
    const start = Date.parse(e.start), end = Date.parse(e.end);
    return start <= now && now <= end ? { ...e, end: past } : e;
  });
  if (live.live && !matched) out.push({ id: 'whatnot-live-now', date: new Date(now).toISOString().slice(0, 10), start: new Date(now - 60000).toISOString(), end: soon, allDay: false,
    kicker: 'Online live show', type: 'Online Live Show', title: live.title, location: 'Whatnot', copy: 'Live on Whatnot now: ' + live.title, href: live.url, mapsUrl: '', videoOrientation: 'portrait', online: true, live: true });
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
