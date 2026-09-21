import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: "why are Pokemon plush showing in price sync for Pokemon?
// There's categories in place. A pokemon hat shouldn't sync with a pokemon
// card." isPokemonInventorySyncItem used to search the item's own NAME/
// brand/manufacturer for the word "pokemon" with no regard for the item's
// own, real, specific category (Collectibles, Funko, etc) -- so a plush or
// hat correctly filed under a non-card category still matched purely
// because its product name said "Pokemon", exactly like isMtgInventorySyncItem
// already guards against for Magic. Category must now be the definitive
// answer once it's a real, specific (non-blank, non-legacy-"TCG") value.

function extractFn(name) {
  const start = dashboard.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist in dashboard.html');
  const end = dashboard.indexOf('\n}', start) + 2;
  return dashboard.slice(start, end);
}

const isPokemonInventorySyncItem = new Function(
  extractFn('inventoryCardName') + '\n' +
  extractFn('inventorySetName') + '\n' +
  extractFn('isPokemonInventorySyncItem') + '\n' +
  'return isPokemonInventorySyncItem;'
)();

{
  const plush = { category:'Collectibles', name:'Pokemon Center Pikachu Plush', brand:'Pokemon', manufacturer:'The Pokemon Company' };
  assert.equal(isPokemonInventorySyncItem(plush), false, 'a Pokemon-branded plush correctly filed under Collectibles must never sync as a Pokemon card, whatever its name/brand say');

  const hat = { category:'Collectibles', name:'Pokemon Trainer Hat' };
  assert.equal(isPokemonInventorySyncItem(hat), false, 'a Pokemon-branded hat correctly filed under Collectibles must never sync as a Pokemon card');

  const funko = { category:'Collectibles', name:'Funko Pop! Pokemon Pikachu #553' };
  assert.equal(isPokemonInventorySyncItem(funko), false, 'a Pokemon-branded Funko must never sync as a Pokemon card');

  const realCard = { category:'Pokemon TCG', name:'Charizard', setName:'Base Set' };
  assert.equal(isPokemonInventorySyncItem(realCard), true, 'an item actually filed under the Pokemon TCG category must still sync');

  const sportsCard = { category:'Sports', name:'2023 Panini Prizm' };
  assert.equal(isPokemonInventorySyncItem(sportsCard), false, 'a Sports-categorized item must never sync as Pokemon, category wins over any sniffing');

  // Legacy/uncategorized rows (added before the Sports/Pokemon TCG category
  // split existed) must still fall back to the old name/set sniffing --
  // this is the one case category can't answer on its own.
  const legacyBlank = { category:'', name:'Pokemon Pikachu', setName:'Evolving Skies' };
  assert.equal(isPokemonInventorySyncItem(legacyBlank), true, 'a blank-category legacy Pokemon card must still be found by name/set sniffing');
  const legacyGenericTcg = { category:'TCG', name:'Pokemon Pikachu', setName:'Evolving Skies' };
  assert.equal(isPokemonInventorySyncItem(legacyGenericTcg), true, 'a legacy generic "TCG" category (predates the game-specific split) must still fall back to sniffing');
}

console.log('Pokemon price-sync category-authority functional checks passed');

// Store report: "syncing prices for sports cards says there is nothing in
// PriceCharting connected to it" even though a PriceCharting link was
// explicitly pinned. The pinned-id lookup used to be gated behind
// qplCategoryKey(item.category) === 'sports' -- a sports card with a blank
// category, or one whose category names a specific sport qplCategoryKey
// doesn't recognize (Hockey, Soccer, MMA -- it only knows sport/baseball/
// football/basketball), never even reached the code that reads the pinned
// id, and silently fell through to the JustTCG/TCGplayer search instead,
// which has no sports data and always reports no match. The pinned-id
// check must run before, and regardless of, that category gate.
{
  const fnStart = dashboard.indexOf('async function fetchOtherTcgOrSportsLivePrice(item){');
  assert.ok(fnStart >= 0, 'fetchOtherTcgOrSportsLivePrice must exist');
  const fnEnd = dashboard.indexOf('\nasync function runOtherLivePriceSync', fnStart);
  const fn = dashboard.slice(fnStart, fnEnd);
  const pcIdIdx = fn.indexOf('const pcId = String(item.pricechartingProductId');
  const keyIdx = fn.indexOf("const key = qplCategoryKey(item.category || '');");
  const sportsGateIdx = fn.indexOf("if(key === 'sports'){");
  assert.ok(pcIdIdx >= 0, 'the pinned PriceCharting id lookup must still exist');
  assert.ok(keyIdx >= 0 && sportsGateIdx >= 0, 'the category-based sports gate must still exist for the non-pinned fallback path');
  assert.ok(pcIdIdx < keyIdx && pcIdIdx < sportsGateIdx, 'the pinned-id lookup must run before the category check, so it is tried regardless of how (or whether) the item is categorized');
}

console.log('Sports price-sync pinned-id-before-category-gate structural check passed');

// Store report (follow-up): "the sync is dumb still, its in there!" -- a
// card with a verified, pinned PriceCharting/SportsCardsPro link still got
// the exact same generic "Could not find a confident price match ... via
// CardSight/PriceCharting/JustTCG" wording as a card with no link at all,
// reading as if the pin was never even checked. What actually happens for
// a newer/low-profile card: PriceCharting resolves the pinned product
// fine, it just has no ungraded guide value on file yet. The pinned-id
// branch must surface that distinction (pinnedNoPrice) instead of falling
// through to a message that implies nothing was matched at all.
{
  const fnStart = dashboard.indexOf('async function fetchOtherTcgOrSportsLivePrice(item){');
  const fnEnd = dashboard.indexOf('\nasync function runOtherLivePriceSync', fnStart);
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /return \{ market:0, pinnedNoPrice:true, source:'PriceCharting \(pinned #' \+ pcId \+ '\)', productName:data\.product\.productName \|\| '', productUrl:data\.product\.url \|\| '' \};/,
    'a pinned id that resolves to a real product with no ungraded price must be flagged pinnedNoPrice, not silently treated the same as no match at all');

  const buildStart = dashboard.indexOf('async function buildOtherTcgSportsPriceSyncProposal(options = {}){');
  const buildEnd = dashboard.indexOf('\nasync function runOtherLivePriceSync', buildStart);
  const buildFn = dashboard.slice(buildStart, buildEnd);
  assert.match(buildFn, /live\?\.pinnedNoPrice/, 'the sync proposal builder must check for the pinnedNoPrice case');
  assert.match(buildFn, /title:'Pinned match found — no guide value yet'/, 'a pinned-but-priceless card must get an honest, distinct title instead of the generic "No live match found"');
}

console.log('Sports price-sync pinned-but-priceless distinction checks passed');
