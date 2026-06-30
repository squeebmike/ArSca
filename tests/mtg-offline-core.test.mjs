import assert from 'node:assert/strict';
import { bestPriceChartingMatch, buildLinkRecord, createPriceIndex, moneyFromPennies, normalizePriceChartingRow, normalizeScryfallCard, scorePriceChartingMatch } from '../scripts/mtg/mtg-offline-core.mjs';

const downloadedAt = '2026-06-30T00:00:00.000Z';
const card = normalizeScryfallCard({
  id:'sf-1', oracle_id:'oracle-1', name:'Rhystic Study', set:'wot', set_name:'Wilds of Eldraine: Enchanting Tales',
  collector_number:'71', rarity:'rare', artist:'Rebecca Guay', oracle_text:'Whenever an opponent casts a spell...',
  type_line:'Enchantment', keywords:[], finishes:['nonfoil','foil'], prices:{ usd:'32.50' }, released_at:'2023-09-08',
  image_uris:{ normal:'https://cards.scryfall.io/normal/front/a/b/abc.jpg' }
}, downloadedAt);
assert.equal(card.scryfallId, 'sf-1');
assert.equal(card.normalizedName, 'rhystic study');
assert.match(card.searchText, /rebecca guay/);
assert.equal(moneyFromPennies('3250'), 32.5);

const exactPrice = normalizePriceChartingRow({
  id:'pc-71', 'product-name':'2023 Wilds of Eldraine Enchanting Tales Rhystic Study #71', 'console-name':'Magic Cards',
  'loose-price':'3299', 'graded-price':'5100', 'manual-only-price':'9900', 'condition-17-price':'10500'
}, downloadedAt);
assert.equal(exactPrice.loosePrice, 32.99);
assert.equal(exactPrice.grade9Price, 51);
assert.equal(exactPrice.psa10Price, 99);
assert.equal(exactPrice.cgc10Price, 105);
const scored = scorePriceChartingMatch(card, exactPrice);
assert.ok(scored.confidence >= 95, `expected exact score, got ${scored.confidence}`);
const match = bestPriceChartingMatch(card, createPriceIndex([exactPrice]));
assert.equal(match.price.pricechartingId, 'pc-71');
assert.equal(buildLinkRecord(card, match).scryfallId, 'sf-1');

const wrong = normalizePriceChartingRow({ id:'pc-wrong', 'product-name':'Sol Ring #71', 'console-name':'Magic Cards', 'loose-price':'100' }, downloadedAt);
assert.equal(scorePriceChartingMatch(card, wrong).confidence < 75, true);
assert.equal(bestPriceChartingMatch(card, createPriceIndex([wrong])), null);

const doubleFaced = normalizeScryfallCard({
  id:'sf-dfc', name:'Fire // Ice', set:'mh2', set_name:'Modern Horizons 2', collector_number:'290',
  card_faces:[
    { name:'Fire', oracle_text:'Fire deals 2 damage divided as you choose.', type_line:'Instant', image_uris:{ normal:'front.jpg' } },
    { name:'Ice', oracle_text:'Tap target permanent. Draw a card.', type_line:'Instant', image_uris:{ normal:'back.jpg' } }
  ]
}, downloadedAt);
assert.equal(doubleFaced.cardFaces.length, 2);
assert.match(doubleFaced.searchText, /draw a card/);
console.log('MTG offline core tests passed');
