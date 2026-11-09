// Whatnot shows onto the homepage (store, 2026-11-09: "we have webflow api
// cms for whatnot shows on the homepage ... use the whatnot api to fill in
// those cms items automatically and publish to make our live shows on the
// site").
//
// Every scheduled Whatnot show becomes a published "Pocket Events" item
// (Online Live Show, portrait video), keyed by its slug "whatnot-<show id>"
// so the same show is updated in place, never duplicated. A show that's
// cancelled or no longer scheduled comes off the homepage (show-on-homepage
// off). Items the store made by hand are never touched.

export const EVENTS_ONLINE_TYPE = '0e48e57606ce593dfd869b5fc0babfa0'; // "Online Live Show"
export const EVENTS_PORTRAIT = '8738b855bee8389f8fff41ed74c94069'; // "Portrait"
export const WHATNOT_PROFILE_URL = 'https://www.whatnot.com/user/themanapocket';
const SHOW_HOURS = 2;

export const whatnotEventSlug = id => ('whatnot-' + String(id || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, 120);

// The Pocket Events fields for one Whatnot show.
export function whatnotShowEventFields(show = {}) {
  const start = new Date(Date.parse(show.scheduled_start_at || ''));
  const title = String(show.title || '').trim() || 'Live on Whatnot';
  const url = [show.url, show.web_url, show.share_url, show.permalink].find(u => /^https:\/\/(www\.)?whatnot\.com\//i.test(String(u || ''))) || WHATNOT_PROFILE_URL;
  const about = String(show.description || '').trim();
  return {
    name: title.slice(0, 256),
    slug: whatnotEventSlug(show.id),
    'event-type': EVENTS_ONLINE_TYPE,
    'start-date-time': start.toISOString(),
    'end-date-time': new Date(start.getTime() + SHOW_HOURS * 3600 * 1000).toISOString(),
    'location-or-platform': 'Whatnot',
    description: (about || 'Live on Whatnot: ' + title + '. Follow The Mana Pocket on Whatnot to get a reminder, pre-bid and watch live.').slice(0, 2000),
    'watch-or-details-url': url,
    'show-on-homepage': true,
    'video-orientation': EVENTS_PORTRAIT,
  };
}

const same = (a = {}, b = {}) => Object.keys(a).every(k => {
  if (/date-time/.test(k)) return Date.parse(a[k]) === Date.parse(b[k] || '');
  return String(a[k] ?? '') === String(b[k] ?? '');
});

// What to create, update or take off the homepage. shows: Whatnot's
// scheduled shows; items: the collection's items (staged).
export function planWhatnotShowEvents(shows = [], items = [], now = Date.now()) {
  const bySlug = new Map(items.filter(i => String(i?.fieldData?.slug || '').startsWith('whatnot-')).map(i => [i.fieldData.slug, i]));
  const create = [], update = [], hide = [];
  const wanted = new Set();
  for (const sh of shows) {
    if (!sh?.id || Number.isNaN(Date.parse(sh.scheduled_start_at || ''))) continue;
    const fields = whatnotShowEventFields(sh);
    wanted.add(fields.slug);
    const have = bySlug.get(fields.slug);
    if (!have) create.push(fields);
    else if (have.isArchived || have.isDraft || !same(fields, have.fieldData)) update.push({ id: have.id, fieldData: fields });
  }
  // Ours, still upcoming, still on the homepage, but no longer scheduled on Whatnot (cancelled).
  for (const [slug, item] of bySlug) {
    if (wanted.has(slug)) continue;
    const start = Date.parse(item.fieldData?.['start-date-time'] || '');
    // Only shows 2+ hours out: one that just went live leaves Whatnot's
    // "scheduled" list too, and must stay up.
    if (start > now + 2 * 3600 * 1000 && item.fieldData?.['show-on-homepage'] !== false) hide.push({ id: item.id, fieldData: { 'show-on-homepage': false } });
  }
  return { create, update, hide };
}

// deps: shows() -> Whatnot scheduled shows; listItems() -> collection items;
// createLive(fieldData); updateLive(id, fieldData).
export async function syncWhatnotShowEvents(deps, now = Date.now()) {
  const [shows, items] = await Promise.all([deps.shows(), deps.listItems()]);
  const plan = planWhatnotShowEvents(shows, items, now);
  const out = { created: 0, updated: 0, hidden: 0, errors: [] };
  for (const f of plan.create) { try { await deps.createLive(f); out.created++; } catch (e) { out.errors.push(f.slug + ': ' + e.message); } }
  for (const u of plan.update) { try { await deps.updateLive(u.id, u.fieldData); out.updated++; } catch (e) { out.errors.push(u.id + ': ' + e.message); } }
  for (const h of plan.hide) { try { await deps.updateLive(h.id, h.fieldData); out.hidden++; } catch (e) { out.errors.push(h.id + ': ' + e.message); } }
  return out;
}
