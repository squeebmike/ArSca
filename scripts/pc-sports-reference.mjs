// PriceCharting's API as the last word on a sports checklist card's photo
// and price (store, 2026-11-09: the 2024 Topps Big League Autographs
// "Julio Rodriguez #BLA-JR" page showed no photo and no price while
// SportsCardsPro had both). The checklist pages look in the set's main
// SportsCardsPro list; inserts and autographs live in their own lists
// ("2024 Topps Big League Baseball Autograph"), so they were never found.
// PriceCharting's product search covers every list.
//
// One exact match only: the card number, the player and the year must all
// agree, and a parallel ("[Gold]") is never taken for the plain card.
// Cached a week (misses a day) so a busy page doesn't spend API calls.
import { apiReferencePrices } from './reference-price-refresh.mjs';

const fold = v => String(v || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slug = v => fold(v).replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const lastName = p => fold(p).replace(/\b(jr|sr|ii|iii|iv)\.?$/, '').trim().split(/\s+/).pop() || '';

export function pickPcProduct(products = [], set = {}, card = {}) {
  const number = fold(card.cardNumber).replace(/^#/, '');
  const year = String(set.year || '');
  const sport = set.sport === 'football' || /football/i.test(set.displayName) ? 'football' : set.sport === 'basketball' ? 'basketball' : set.sport === 'hockey' ? 'hockey' : 'baseball';
  const last = lastName(card.player);
  const wantsParallel = !!card.parallelRule || /refractor|foil|parallel|\/\d+/i.test(String(card.variant || ''));
  const hits = products.filter(p => {
    const name = fold(p['product-name']), cons = fold(p['console-name']);
    return new RegExp('#' + number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9-])').test(name)
      && (!last || name.includes(last))
      && (!year || cons.includes(year))
      && cons.includes(sport)
      && (wantsParallel || !/\[[^\]]+\]/.test(name));
  });
  // Same card in one list only; two different products is not "exact".
  const ids = [...new Set(hits.map(p => String(p.id)))];
  return ids.length === 1 ? hits[0] : null;
}

export const PC_DAILY_LOOKUPS = 120;
// fetchPc(path, params) -> parsed JSON (the coordinated, rate-limited PriceCharting API).
// note: { pc } -- why there's no photo (shown with an empty reference, for support).
export async function pcSportsReference(set, card, { kv, fetchPc, now = Date.now(), note = {} } = {}) {
  if (!fetchPc || !card?.cardNumber || !card?.player) { note.pc = 'skipped'; return null; }
  const key = 'pc-sports-ref-v2:' + set.id + ':' + card.id;
  const cached = kv ? await kv.get(key, 'json').catch(() => null) : null;
  if (cached) { note.pc = cached.miss ? 'cached-miss:' + (cached.why || '') : 'cached'; return cached.miss ? null : cached; }
  // The website shares PriceCharting with the store's own price sync: card
  // pages get at most PC_DAILY_LOOKUPS new lookups a day, and none for two
  // hours after PriceCharting says "too many requests" (2026-11-09).
  if (kv) {
    if (await kv.get('pc-sports-ref-paused').catch(() => null)) { note.pc = 'paused'; return null; }
    const dayKey = 'pc-sports-ref-calls:' + new Date(now).toISOString().slice(0, 10);
    const used = Number(await kv.get(dayKey).catch(() => 0)) || 0;
    if (used >= PC_DAILY_LOOKUPS) { note.pc = 'daily-limit'; return null; }
    await kv.put(dayKey, String(used + 1), { expirationTtl: 2 * 86400 }).catch(() => {});
  }
  const q = [card.player, '#' + card.cardNumber, set.year, String(set.displayName || '').replace(/\b(baseball|football|basketball|hockey)\b/gi, '').replace(/\b\d{4}\b/, '').trim()].filter(Boolean).join(' ');
  let ref = null, why = '';
  try {
    const list = (await fetchPc('/api/products', { q }))?.products || [];
    const found = pickPcProduct(list, set, card);
    why = found ? '' : list.length ? 'no-exact-match:' + list.slice(0, 3).map(p => String(p['product-name'] || '') + ' / ' + String(p['console-name'] || '')).join(' | ').slice(0, 300) : 'no-results';
    if (found) {
      const full = await fetchPc('/api/product', { id: String(found.id) }).catch(() => found) || found;
      const raw = full['image-url'] || full.image || '';
      const image = /^\/\//.test(raw) ? 'https:' + raw : /^\//.test(raw) ? 'https://www.pricecharting.com' + raw : /^https:\/\//.test(raw) ? raw : '';
      ref = {
        productId: String(found.id), title: String(full['product-name'] || found['product-name']), image,
        url: 'https://www.sportscardspro.com/game/' + slug(full['console-name'] || found['console-name']) + '/' + slug(full['product-name'] || found['product-name']),
        referencePrices: apiReferencePrices(full, now), source: 'PriceCharting / SportsCardsPro', referenceOnly: true,
      };
    }
  } catch (e) {
    note.pc = 'error:' + String(e?.message || e).slice(0, 120);
    if (kv && /429|paused/i.test(String(e?.message || ''))) await kv.put('pc-sports-ref-paused', '1', { expirationTtl: 2 * 3600 }).catch(() => {});
    return null;
  }
  note.pc = ref ? 'found' : why;
  // A miss is kept 6 hours (a card PriceCharting adds later shows up soon).
  if (kv) await kv.put(key, JSON.stringify(ref || { miss: true, why }), { expirationTtl: ref ? 7 * 86400 : 6 * 3600 }).catch(() => {});
  return ref;
}
