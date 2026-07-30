const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const browser = fs.readFileSync('scripts/mtg/mtg-offline-browser.js', 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `Missing ${name}`);
  const bodyStart = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const context = {
  pokemonPptConditionCode: value => String(value || 'NM').toUpperCase(),
  firstMoneyValue: (...values) => values.map(Number).find(value => Number.isFinite(value) && value > 0) || 0,
  qplFinishLabel: value => value,
  normalizeQplFinish: value => String(value || 'normal').trim().toLowerCase().replace(/[\s-]+/g, '_'),
};
vm.createContext(context);
vm.runInContext(functionSource(dashboard, 'mtgInventoryFinish'), context);
vm.runInContext(functionSource(dashboard, 'mtgFinishPriceFamily'), context);
vm.runInContext(functionSource(dashboard, 'resolveMtgOfflineCardPrice'), context);
vm.runInContext(functionSource(dashboard, 'scryfallTreatmentLabel'), context);

assert.equal(context.resolveMtgOfflineCardPrice({ condition:'NM' }, { prices:{ usd:10 } }).price, 10);
// Scryfall/the offline snapshot only ever have one real price per finish (no
// condition tiers) -- a non-NM condition must never get a percent-of-NM
// guess, it must come back unpriced so the caller can report "no real price"
// instead of silently faking one.
assert.equal(context.resolveMtgOfflineCardPrice({ condition:'LP', selectedFinish:'Foil' }, { prices:{ usd:10, usd_foil:20 } }).price, 0, 'LP must not get a fabricated percent-of-NM price');
assert.equal(context.resolveMtgOfflineCardPrice({ condition:'MP', selectedFinish:'Etched Foil' }, { prices:{ usd_etched:25 } }).price, 0, 'MP must not get a fabricated percent-of-NM price');
assert.equal(context.resolveMtgOfflineCardPrice({ condition:'NM', selectedFinish:'Surge Foil' }, { prices:{ usd_foil:31 } }).price, 31);
assert.equal(context.resolveMtgOfflineCardPrice({ condition:'NM', selectedFinish:'Rainbow Foil' }, { prices:{ usd_foil:32 } }).price, 32);
assert.equal(context.resolveMtgOfflineCardPrice({ condition:'NM', selectedFinish:'Halo Foil' }, { prices:{ usd_foil:33 } }).price, 33);
assert.equal(context.resolveMtgOfflineCardPrice({ condition:'NM', selectedFinish:'Oil Slick Foil' }, { prices:{ usd_foil:34 } }).price, 34);
assert.equal(context.resolveMtgOfflineCardPrice({ condition:'NM', selectedFinish:'Textured Foil' }, { prices:{ usd_foil:35 } }).price, 35);
assert.equal(context.resolveMtgOfflineCardPrice({}, { prices:{}, offlinePriceLink:{confidence:98}, offlinePrice:{loosePrice:12} }).price, 12);
assert.equal(context.resolveMtgOfflineCardPrice({ selectedFinish:'Foil' }, { prices:{}, offlinePriceLink:{confidence:99}, offlinePrice:{loosePrice:12} }).price, 0, 'A generic raw guide must not be applied to a foil');
assert.equal(context.scryfallTreatmentLabel({ frame_effects:['showcase'], promo_types:['surgefoil'] }), 'surge_foil');
assert.equal(context.scryfallTreatmentLabel({ promo_types:['confettifoil'] }), 'rainbow_foil');
assert.equal(context.scryfallTreatmentLabel({ promo_types:['textured'] }), 'textured_foil');

assert.match(browser, /async function findExact\(ref=\{\}\)/);
assert.match(browser, /exact Scryfall ID/);
assert.match(browser, /exact TCGplayer ID/);
assert.match(browser, /exact set \+ collector number/);
assert.match(browser, /search,findExact,searchPrices/);
assert.match(dashboard, /id="price-sync-mtg-btn"/);
assert.match(dashboard, /async function buildOfflineMtgPriceSyncProposal/);
assert.match(dashboard, /async function runOfflineMtgPriceSync/);
assert.match(dashboard, /mode:live\?'mtg-live':'mtg-offline'/);
assert.match(dashboard, /async function fetchLiveMtgInventoryPrice/);
assert.match(dashboard, /SYNC MTG PRICES/);
assert.match(dashboard, /mtgOfflinePriceUpdatedAt/);
assert.match(dashboard, /No exact offline MTG match/);
assert.match(dashboard, /function openInventoryTcgplayer/);
assert.match(dashboard, /🛒 TCGplayer/);
assert.match(dashboard, /async function refreshResearchPrice/);
assert.match(dashboard, /onclick="refreshResearchPrice\(\$\{idx\}\)"/);

console.log('MTG offline inventory price sync checks passed');
