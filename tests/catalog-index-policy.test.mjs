import assert from 'node:assert/strict';
import { handleBaseballCatalog, baseballCardPath, baseballSetPath } from '../scripts/baseball-catalog-pages.mjs';
import { handleFootballCatalog } from '../scripts/football-catalog-pages.mjs';
import { baseballSets } from '../scripts/topps/baseball-seed.mjs';
import { noindexUnstocked, stockedCardPaths } from '../scripts/catalog-index-policy.mjs';

// Store, 2026-11-07: 92k catalog pages "not indexed" -- index card pages only
// while a copy is for sale; everything else stays live but noindex.
const set = baseballSets.find(s => s.cards.length > 10 && s.year && s.displayName && s.cards[3].player);
const card = set.cards[3];
const copy = { id: 'i1', price: 12, categorySlug: 'sports-cards', year: set.year, set: set.displayName, player: card.player, subset: card.section, variant: card.variant, cardNumber: card.cardNumber, name: card.player + ' #' + card.cardNumber };
const entries = set.cards.map(c => ({ set, card: c, path: baseballCardPath(set, c) }));
assert.deepEqual(stockedCardPaths(entries, [copy]), [baseballCardPath(set, card)], 'a stocked card is listed');
assert.deepEqual(stockedCardPaths(entries, [{ ...copy, price: 0 }]), [], 'not for sale: not listed');
assert.deepEqual(stockedCardPaths(entries, null), [], 'inventory unavailable: no card pages');
assert.equal(noindexUnstocked([copy], card, set), false);
assert.equal(noindexUnstocked([], card, set), true);
assert.equal(noindexUnstocked(null, card, set), false, 'never noindex over an inventory outage');

const deps = items => ({ escape: s => String(s).replace(/&/g, '&amp;'), shell: d => JSON.stringify(d), slug: s => s, available: () => true, listItems: async () => items });
const get = async (h, path, items) => { const u = new URL('https://www.themanapocket.com' + path); return (await h(new Request(u), {}, u, deps(items))).text(); };
let xml = await get(handleBaseballCatalog, '/sitemap-baseball.xml', []);
const locs = xml.match(/<loc>/g).length;
assert.ok(locs < 10000 && !xml.includes('sitemapindex'), 'baseball sitemap is one file without the per-card pages: ' + locs);
assert.ok(xml.includes(baseballSetPath(set) + '</loc>'), 'set pages stay');
assert.ok(!xml.includes('/cards/'), 'no unstocked card pages');
xml = await get(handleBaseballCatalog, '/sitemap-baseball.xml', [copy]);
assert.ok(xml.includes(baseballCardPath(set, card) + '</loc>'), 'stocked card comes back');
assert.ok(!(await get(handleFootballCatalog, '/sitemap-football.xml', [])).includes('/cards/'));

// The card page itself: noindex while unstocked, indexed once stocked.
assert.match(await get(handleBaseballCatalog, baseballCardPath(set, card), []), /"robotsNoindex":true/);
assert.match(await get(handleBaseballCatalog, baseballCardPath(set, card), [copy]), /"robotsNoindex":false/);
console.log('Catalog index policy: card pages indexed only while stocked; sets, sections, teams, players stay');
