import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store report (screenshots): SYNC MTG PRICES proposed Enduring Vitality at
// $7.80 and Birds of Paradise (DMR) at $6.37 while TCGplayer showed a $16.87
// / $11.59 NM market, and the review list also showed Pokemon changes left
// pending from an earlier sync.

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
function extractFn(name, prefix = 'function ') {
  const start = dashboard.indexOf(prefix + name + '(');
  assert.ok(start >= 0, name + ' must exist in dashboard.html');
  return dashboard.slice(start, dashboard.indexOf('\n}', start) + 2);
}

// ── NM MTG singles price from TCGplayer's own Market Price ──
{
  const requests = [];
  const pricepoints = [
    { printingType:'Foil', marketPrice:20.07, listedMedianPrice:22 },
    { printingType:'Normal', marketPrice:16.87, listedMedianPrice:17.63 },
  ];
  const fetchStub = async url => { requests.push(url); return { ok:true, json:async () => ({ ok:true, pricepoints }) }; };
  const fn = new Function('fetch', 'navigator', 'WORKER', 'pokemonPptConditionCode', 'mtgInventoryFinish', 'mtgFinishPriceFamily', 'firstMoneyValue', 'qplFinishLabel',
    extractFn('fetchMtgTcgplayerPricepointPrice', 'async function ') + '\nreturn fetchMtgTcgplayerPricepointPrice;')(
    fetchStub, { onLine:true }, 'https://worker.test',
    c => /light|lp/i.test(c) ? 'LP' : 'NM',
    i => /foil/i.test(i.finish || '') ? 'foil' : 'normal',
    f => f === 'normal' ? 'normal' : 'foil',
    (...v) => v.map(Number).find(n => n > 0) || 0,
    f => f === 'normal' ? 'Normal' : 'Foil',
  );
  const normal = await fn({ condition:'NM' }, '578080');
  assert.equal(normal.price, 16.87, 'NM normal uses the TCGplayer Normal market price');
  assert.match(requests[0], /\/pricing\/tcgplayer\/product\/578080$/);
  const foil = await fn({ condition:'NM', finish:'Foil' }, '578080');
  assert.equal(foil.price, 20.07, 'NM foil uses the TCGplayer Foil market price');
  assert.equal(await fn({ condition:'LP' }, '578080'), null, 'non-NM conditions stay on the per-condition provider');
  assert.equal(requests.length, 2, 'no request is made for a non-NM card');

  const live = extractFn('fetchLiveMtgInventoryPrice', 'async function ');
  assert.ok(live.indexOf('fetchMtgTcgplayerPricepointPrice') < live.indexOf('resolveExactTcgplayerProduct'),
    'TCGplayer Market Price is tried before the JustTCG variant price');
  console.log('MTG NM TCGplayer market price checks passed');
}

// ── Review list only shows the category just synced ──
{
  const src = [
    'let _priceSyncProposal = [];',
    dashboard.match(/let _priceSyncView = null;\n/)[0],
    extractFn('priceSyncProposalGroup'),
    extractFn('isPriceSyncProposalVisible'),
    extractFn('visiblePriceSyncProposals'),
    'return { set:(p, v) => { _priceSyncProposal = p; _priceSyncView = v; }, visible:visiblePriceSyncProposals, group:priceSyncProposalGroup };',
  ].join('\n');
  const api = new Function(src)();
  const pending = [
    { mode:'live', item:{ name:'Dark Vaporeon' } },
    { mode:'mtg-live', provider:'mtg', item:{ name:'Enduring Vitality' } },
    { mode:'comic-live', provider:'comic', item:{ name:'TMNT' } },
    { mode:'other-live', item:{ name:'Ohtani' } },
  ];
  api.set(pending, 'mtg');
  assert.deepEqual(api.visible().map(p => p.item.name), ['Enduring Vitality'], 'MTG sync shows only MTG changes');
  api.set(pending, null);
  assert.equal(api.visible().length, 4, 'reopening the modal shows every pending change');
  assert.deepEqual(pending.map(api.group), ['pokemon', 'mtg', 'comic', 'other']);

  const apply = extractFn('applySelectedPriceSyncUpdates', 'async function ');
  assert.match(apply, /visiblePriceSyncProposals\(\)\.filter\(p => p\.selected\)/, 'UPDATE SELECTED never applies hidden changes');
  const pokemonLive = extractFn('runLivePokemonPriceSync', 'async function ');
  assert.match(pokemonLive, /priceSyncProposalGroup\(p\) !== 'pokemon'/, 'a Pokemon run keeps pending MTG/comic changes');
  console.log('Price sync review list category scoping checks passed');
}
