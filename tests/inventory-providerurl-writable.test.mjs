import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Store report: a card's PriceCharting/SportsCardsPro product link wasn't
// saving when added through Pocket/Mana Scout -> Buy Tray -> "accept all".
// Traced the whole chain (search match / pasted URL -> scoutSendToBuyTab ->
// buyItemToInventoryUpdates -> createInventoryRecord) and every hop already
// correctly threaded providerUrl through -- the actual break was deeper:
// providerUrl (and card_number) were never added to
// BUILT_IN_ITEM_SIMPLE_FIELDS/ALIASED_FIELDS or builtInDataFromItem's own
// object literal, so no UPDATE path (saveInventoryEdit, or the sealed/comic
// restock-merge paths) could ever persist them -- only the raw {...item,
// ...updates} spread at initial row creation did. A card that merged into
// an existing "restock" row (same sealed product, or same raw comic
// issue+cover+condition) silently lost its freshly-found link every time.
assert.match(dashboard, /\['providerUrl',''\], \['card_number',''\],/,
  'providerUrl and card_number must be real passthrough fields so saveInventoryEdit/updateBuiltInInventoryItem can actually persist them on an existing row, not just at initial creation');

// The restock-merge paths must actually backfill these (and the other
// scan-identity fields) onto an existing row when it's missing them --
// never overwriting a link/serial a human already set or an earlier scan
// already found.
assert.match(dashboard, /function mergeIdentityMetadataUpdates\(existing, item, updates\)\{/, 'missing mergeIdentityMetadataUpdates');
{
  const fnStart = dashboard.indexOf('function mergeIdentityMetadataUpdates(existing, item, updates){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const fn = dashboard.slice(fnStart, fnEnd);
  assert.match(fn, /\['providerUrl','sourceProductId','sourceVariantId','tcgplayerSkuId','tcgPlayerId','tcgPlayerUrl','serial_number','card_number'\]/,
    'must cover every scan-identity field the merge paths previously dropped');
  assert.match(fn, /if\(!existing\[field\] && merged\[field\]\) out\[field\] = merged\[field\];/,
    'must only fill a field the existing row is missing, never overwrite one it already has');
}
assert.match(dashboard, /await updateBuiltInInventoryItem\(existing, \{ qty:mergedQty, cost:mergedCost, notes, \.\.\.mergeIdentityMetadataUpdates\(existing, item, updates\) \}\);\s*\n\s*logOpsEvent\('inventory_sealed_restock'/,
  'the sealed-product restock merge must apply the identity-metadata backfill');
assert.match(dashboard, /await updateBuiltInInventoryItem\(existing, \{ qty:mergedQty, cost:mergedCost, notes, \.\.\.mergeIdentityMetadataUpdates\(existing, item, updates\) \}\);\s*\n\s*logOpsEvent\('inventory_comic_restock'/,
  'the raw-comic restock merge must apply the identity-metadata backfill');

console.log('Inventory providerUrl/card_number writability contract checks passed');

// ── Functional: mergeIdentityMetadataUpdates only fills blanks ──
{
  const fnStart = dashboard.indexOf('function mergeIdentityMetadataUpdates(existing, item, updates){');
  const fnEnd = dashboard.indexOf('\n}', fnStart) + 2;
  const mergeIdentityMetadataUpdates = new Function(dashboard.slice(fnStart, fnEnd) + '\nreturn mergeIdentityMetadataUpdates;')();

  const existingBlank = { providerUrl:'', card_number:'', serial_number:'' };
  const incomingItem = { providerUrl:'https://www.pricecharting.com/game/pokemon/charizard', card_number:'4' };
  const incomingUpdates = { serial_number:'/250' };
  const filled = mergeIdentityMetadataUpdates(existingBlank, incomingItem, incomingUpdates);
  assert.equal(filled.providerUrl, incomingItem.providerUrl, 'a blank existing providerUrl must be backfilled from the incoming scan');
  assert.equal(filled.card_number, '4', 'a blank existing card_number must be backfilled');
  assert.equal(filled.serial_number, '/250', 'a blank existing serial_number must be backfilled from updates too, not just item');

  const existingAlreadyLinked = { providerUrl:'https://www.pricecharting.com/game/pokemon/blastoise', card_number:'2' };
  const notOverwritten = mergeIdentityMetadataUpdates(existingAlreadyLinked, incomingItem, incomingUpdates);
  assert.equal(notOverwritten.providerUrl, undefined, 'an existing row that already has a providerUrl must never have it overwritten by a merge');
  assert.equal(notOverwritten.card_number, undefined, 'an existing row that already has a card_number must never have it overwritten by a merge');
}

console.log('Inventory providerUrl/card_number writability functional checks passed');
