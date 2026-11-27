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
