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
  COND_MULTIPLIER: { NM:1, LP:.8, MP:.64, HP:.4, DMG:.25 },
  qplFinishLabel: value => value,
};
vm.createContext(context);
vm.runInContext(functionSource(dashboard, 'mtgInventoryFinish'), context);
vm.runInContext(functionSource(dashboard, 'resolveMtgOfflineCardPrice'), context);

assert.equal(context.resolveMtgOfflineCardPrice({ condition:'NM' }, { prices:{ usd:10 } }).price, 10);
assert.equal(context.resolveMtgOfflineCardPrice({ condition:'LP', selectedFinish:'Foil' }, { prices:{ usd:10, usd_foil:20 } }).price, 16);
assert.equal(context.resolveMtgOfflineCardPrice({ condition:'MP', selectedFinish:'Etched Foil' }, { prices:{ usd_etched:25 } }).price, 16);
assert.equal(context.resolveMtgOfflineCardPrice({}, { prices:{}, offlinePriceLink:{confidence:98}, offlinePrice:{loosePrice:12} }).price, 12);
assert.equal(context.resolveMtgOfflineCardPrice({ selectedFinish:'Foil' }, { prices:{}, offlinePriceLink:{confidence:99}, offlinePrice:{loosePrice:12} }).price, 0, 'A generic raw guide must not be applied to a foil');

assert.match(browser, /async function findExact\(ref=\{\}\)/);
assert.match(browser, /exact Scryfall ID/);
assert.match(browser, /exact TCGplayer ID/);
assert.match(browser, /exact set \+ collector number/);
assert.match(browser, /search,findExact,searchPrices/);
assert.match(dashboard, /id="price-sync-mtg-btn"/);
assert.match(dashboard, /async function buildOfflineMtgPriceSyncProposal/);
assert.match(dashboard, /async function runOfflineMtgPriceSync/);
assert.match(dashboard, /mode:'mtg-offline'/);
assert.match(dashboard, /mtgOfflinePriceUpdatedAt/);
assert.match(dashboard, /No exact offline MTG match/);

console.log('MTG offline inventory price sync checks passed');
