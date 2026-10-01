import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store asks: (1) Research must show TCGplayer's own NM market for a pasted
// TCGplayer link, not JustTCG's lower number; (2) an MTG sync of 24 items said
// "Sealed checked: 18" -- singles from sets like "Secret Lair Drop" were
// treated as sealed; (3) dynamic pricing for a sealed Lorcana bundle and a
// Star Wars Unlimited premium collection.

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
function extractFn(name, prefix = 'function ') {
  const start = dashboard.indexOf(prefix + name + '(');
  assert.ok(start >= 0, name + ' must exist in dashboard.html');
  return dashboard.slice(start, dashboard.indexOf('\n}', start) + 2);
}
const nameOf = i => i.name || '', setOf = i => i.set || '';

// ── (2) MTG sealed detection ──
{
  const isSealed = new Function('mtgInventoryScryfallId', 'inventoryCardNumber', 'inventoryCardName', 'inventorySetName',
    extractFn('isMtgSealedInventorySyncItem') + '\nreturn isMtgSealedInventorySyncItem;')(
    i => i.scryfallId || '', i => i.card_number || '', nameOf, setOf);
  assert.equal(isSealed({ name:'Lightning Bolt', set:'Secret Lair Drop', card_number:'123' }), false, 'a Secret Lair single is a single');
  assert.equal(isSealed({ name:'Sol Ring', set:'Commander Decks', scryfallId:'abc' }), false);
  assert.equal(isSealed({ name:'Llanowar Elves', set:'Bundle Promos' }), false, 'the set name alone never makes it sealed');
  assert.equal(isSealed({ name:'Duskmourn Play Booster Box' }), true);
  assert.equal(isSealed({ name:'Secret Lair: Angels' }), true);
  assert.equal(isSealed({ name:'Anything', is_sealed:true, card_number:'1' }), true, 'an explicit sealed flag wins');
  assert.equal(isSealed({ name:'Duskmourn Play Booster Box', productType:'single' }), false);
}

// ── (1) TCGplayer NM market helper + Research paste path ──
{
  const fetchStub = async () => ({ ok:true, json:async () => ({ ok:true, pricepoints:[{ printingType:'Normal', marketPrice:16.87 }, { printingType:'Foil', marketPrice:20.07 }] }) });
  const markets = await new Function('fetch', 'navigator', 'WORKER', 'firstMoneyValue',
    extractFn('fetchTcgplayerNmMarkets', 'async function ') + '\nreturn fetchTcgplayerNmMarkets;')(
    fetchStub, { onLine:true }, 'https://worker.test', (...v) => v.map(Number).find(n => n > 0) || 0)('578080');
  assert.deepEqual(markets, { normal:16.87, foil:20.07 });
  const resolve = extractFn('resolveExactTcgplayerProduct', 'async function ');
  assert.match(resolve, /fetchTcgplayerNmMarkets\(product\.productId\)/, 'a pasted TCGplayer link prices NM from TCGplayer market');
  assert.match(resolve, /pokemonPptConditionCode\(v\.condition\|\|'NM'\)!=='NM'\)return v;/, 'LP/MP/HP keep their own provider price');
}

// ── (3) other-TCG sync: pinned products of any category, sealed never takes a card price ──
{
  const src = [
    dashboard.match(/const SPORTS_PC_CONSOLE = [^\n]+\n/)[0],
    extractFn('sportsPcSlug'), extractFn('sportsPcLinkForItem'), extractFn('qplCategoryKey'),
    extractFn('isOtherTcgSportsInventorySyncItem'),
    'return isOtherTcgSportsInventorySyncItem;',
  ].join('\n');
  const inSync = new Function('isMtgInventorySyncItem', 'isPokemonInventorySyncItem', 'isPriceSyncMerchCategory', 'isSportsCardCategory', 'inventorySetName', 'inventoryCardName', src)(
    () => false, () => false, c => /plush|supplies/i.test(c), c => /^sports?$/i.test(c), setOf, nameOf);
  assert.equal(inSync({ name:'Best Buddies Bundle', category:'Disney Lorcana' }), true);
  assert.equal(inSync({ name:'Ashes of the Empire Premium Collection', category:'Star Wars Unlimited', pricechartingProductId:'123' }), true,
    'a pinned Star Wars Unlimited product gets dynamic pricing');
  assert.equal(inSync({ name:'Ashes of the Empire Premium Collection', category:'Star Wars Unlimited' }), false, 'unpinned, nothing to price it from');
  assert.equal(inSync({ name:'Spawn #1', category:'Comic', pricechartingProductId:'9' }), false, 'comics keep their own sync');

  const live = extractFn('fetchOtherTcgOrSportsLivePrice', 'async function ');
  assert.ok(live.indexOf('sportsPcLinkForItem(item)') < live.indexOf('isOtherSyncSealedItem(item)'), 'a pinned sealed product is still priced from its link');
  assert.ok(live.indexOf('isOtherSyncSealedItem(item)) return null') < live.indexOf('/pricing/justtcg/'), 'unpinned sealed never reaches the card-only searches');
  assert.ok(live.indexOf('fetchTcgplayerNmMarkets(tcgPlayerId)') < live.indexOf('/pricing/justtcg/tcgplayer/'), 'NM singles use TCGplayer market first');
}

// ── (3) a sealed Lorcana result from Research keeps its game ──
assert.match(dashboard, /\/lorcana\/i\.test\(r\.set\) \? 'Disney Lorcana'/);
console.log('TCGplayer market + sealed sync checks passed');

// ── other games: JustTCG rows and name-search syncs take TCGplayer's NM market ──
{
  const hydrate = extractFn('hydrateQplVariantMatrix', 'async function ');
  assert.match(hydrate, /withTcgplayerNmMarket\(qplResults\[idx\]/, 'opening a Yu-Gi-Oh/Lorcana/One Piece card prices NM from TCGplayer');
  assert.match(dashboard, /tcgPlayerId:m\.tcgplayerId \? String\(m\.tcgplayerId\) : '',/, 'JustTCG search rows keep the TCGplayer id');
  const live = extractFn('fetchOtherTcgOrSportsLivePrice', 'async function ');
  assert.match(live, /fetchTcgplayerNmMarkets\(match\.tcgplayerId\)/, 'a name-search match uses TCGplayer market for NM');
  const calls = [];
  const withMarket = new Function('fetchTcgplayerNmMarkets', 'pokemonPptConditionCode', 'normalizeQplFinish', 'applyQplSelectedVariant',
    extractFn('withTcgplayerNmMarket', 'async function ') + '\nreturn withTcgplayerNmMarket;')(
    async id => { calls.push(id); return { normal:4.5, foil:9 }; }, c => /lp/i.test(c) ? 'LP' : 'NM', f => /foil/i.test(f) ? 'foil' : 'normal', r => r);
  const row = await withMarket({ availableVariants:[{ condition:'NM', finish:'normal', marketPrice:2 }, { condition:'NM', finish:'foil', marketPrice:5 }, { condition:'LP', finish:'normal', marketPrice:1.5 }] }, '12345');
  assert.deepEqual(row.availableVariants.map(v => v.marketPrice), [4.5, 9, 1.5]);
  assert.equal(row.tcgPlayerId, '12345');
}
console.log('Other-TCG TCGplayer market checks passed');
