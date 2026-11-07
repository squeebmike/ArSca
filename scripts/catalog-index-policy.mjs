// Which catalog card pages Google should index (store, 2026-11-07: Search
// Console showed 92k "not indexed" pages -- one per checklist card ever
// printed, almost none of them stocked. "Yes build it").
//
// A checklist card page is indexed (and listed in the sitemap) only while the
// shop has a copy of that card for sale. Every other card page still works
// for visitors, site search and ByteRider; it just tells Google noindex,follow
// so crawling goes to the pages that sell. Set, section, team and player pages
// stay indexed. The moment a card is stocked, its page comes back on its own.
import {baseballChecklistInventoryMatches} from './topps/public-checklist-policy.mjs';

const num = v => String(v || '').trim().toLowerCase().replace(/^0+(?=\d)/, '');
const forSale = (i, available) => !!i && Number.isFinite(i.price) && i.price > 0 && (!available || available(i));

export function hasStoreCopy(items, card, set, available) {
  return Array.isArray(items) && items.some(i => forSale(i, available) && baseballChecklistInventoryMatches(i, card, set));
}
// Noindex only when the inventory loaded and has no copy; if it could not be
// read, leave the page as it was (never drop pages over a passing outage).
export const noindexUnstocked = (items, card, set, available) => Array.isArray(items) && !hasStoreCopy(items, card, set, available);

// entries: [{ set, card, path }]. Cheap first pass: a match always needs the
// same card number, so only cards whose number appears on a listed sports
// card are checked in full.
export function stockedCardPaths(entries, items, available) {
  const sports = (Array.isArray(items) ? items : []).filter(i => i && i.categorySlug === 'sports-cards' && forSale(i, available));
  if (!sports.length) return [];
  const numbers = new Set();
  for (const i of sports) {
    numbers.add(num(i.cardNumber));
    for (const m of String(i.name || '').matchAll(/[a-z0-9-]+/gi)) numbers.add(num(m[0]));
  }
  numbers.delete('');
  return entries.filter(({ set, card }) => numbers.has(num(card.cardNumber)) && sports.some(i => baseballChecklistInventoryMatches(i, card, set))).map(e => e.path);
}
