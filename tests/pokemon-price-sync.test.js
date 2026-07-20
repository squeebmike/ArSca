const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `Missing ${name}`);
  const paramsStart = source.indexOf('(', start);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let i = paramsStart; i < source.length; i++) {
    if (source[i] === '(') parenDepth++;
    if (source[i] === ')' && --parenDepth === 0) { paramsEnd = i; break; }
  }
  const bodyStart = source.indexOf('{', paramsEnd);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const context = {
  inventoryCardName: item => item.name || '',
  inventorySetName: item => item.set || '',
  firstMoneyValue: (...values) => values.map(Number).find(value => Number.isFinite(value) && value > 0) || 0,
};
vm.createContext(context);
vm.runInContext(functionSource(dashboard, 'isPokemonSealedInventorySyncItem'), context);
vm.runInContext(functionSource(dashboard, 'pokemonPriceTrackerMarketPrice'), context);

[
  'Phantasmal Flames Pokemon Center Elite Trainer Box (Exclusive)',
  'Surging Sparks Booster Box',
  'Prismatic Evolutions Premium Figure Collection',
  'Mega Charizard X Ex Ultra-Premium Collection',
  'Black Bolt Booster Bundle',
  'Perfect Order Build & Battle Box',
  'Destined Rivals Sleeved Booster Pack',
].forEach(name => assert(context.isPokemonSealedInventorySyncItem({ name }), `Should classify sealed: ${name}`));

assert(!context.isPokemonSealedInventorySyncItem({ name:'Charizard ex - 199/165', set:'Pokemon 151' }), 'A Pokemon single must stay on /cards');
assert.strictEqual(context.pokemonPriceTrackerMarketPrice({ unopenedPrice:325.56 }), 325.56, 'Sealed pricing must use unopenedPrice');
assert(dashboard.includes("await pokemonPriceTrackerSealedProductsRequest(params"), 'Sealed inventory must use the sealed-products request');
assert(dashboard.includes("'/pricing/pokemon/sealed-products?'"), 'Sealed request must use the Worker sealed-products route');
assert(worker.includes("'pokemon:sealed:' + params.get('tcgPlayerId')"), 'Exact sealed IDs need a stable Worker cache key');
assert(worker.includes('await env.LBA_KV.put(cacheKey'), 'Worker must await provider cache writes');

console.log('Pokemon sealed/live price sync regression checks passed');
