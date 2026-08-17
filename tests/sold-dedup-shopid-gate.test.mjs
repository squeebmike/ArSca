import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: the hasSupabaseItems gate that skipped precise shopId matching is gone ──
assert.doesNotMatch(dashboard, /const hasSupabaseItems = all\.some\(i => i\.source === 'built_in'\);\s*\n\s*if\(!hasSupabaseItems\) return dedupeTransactionRows\(txRows, inventorySoldItems\);/, 'the gate that skipped shopId matching for non-Supabase stores must be removed -- it forced fuzzy (exact-price) matching for every store not currently showing a built_in item, which is exactly the case that broke on a discounted sale');
assert.match(dashboard, /function getUnlinkedTransactionRows\(inventorySoldItems\)\{\s*\n\s*const txRows = transactionSoldRows\(\);/, 'getUnlinkedTransactionRows must go straight into building txRows with no early-return branch before it');
assert.match(dashboard, /const soldIds = new Set\(inventorySoldItems\.map\(i => i\.id \|\| i\.localId \|\| i\.shopId\)\.filter\(Boolean\)\);/, 'shopId-based precise matching must run unconditionally now, regardless of inventory source');

console.log('Sold dedup shopId-gate contract checks passed');

// ── Functional: shopId matching now excludes a duplicate even when its price doesn't match ──
function getUnlinkedTransactionRowsSim(txRows, inventorySoldItems){
  const soldIds = new Set(inventorySoldItems.map(i => i.id || i.localId || i.shopId).filter(Boolean));
  const oneOff = txRows.filter(r => r.sourceType === 'one_off');
  const linkedWithShopId = txRows.filter(r => r.sourceType && r.sourceType !== 'one_off' && r.shopId);
  const keptLinked = linkedWithShopId.filter(r => !soldIds.has(r.shopId));
  const linkedIds = new Set(linkedWithShopId.map(r => r.id));
  const remainder = txRows.filter(r => r.sourceType !== 'one_off' && !linkedIds.has(r.id));
  return [...oneOff, ...keptLinked, ...remainder];
}

// The exact reported bug: a real inventory-sold record shows the WRONG (stale
// pre-sale list) price, while the ledger row for the same item -- tagged with
// the same shopId -- shows the real discounted price. Fuzzy price matching
// would never catch this; shopId matching must, regardless of price.
const inventorySold = [{ id:'item_1', name:'Celebi & Venusaur GX SM167', salePrice:22, soldAt:'2026-08-17' }];
const txRows = [{ id:'tx_1_item_1', name:'Celebi & Venusaur GX SM167', shopId:'item_1', sourceType:'inventory', salePrice:20, soldAt:'2026-08-17' }];
const result = getUnlinkedTransactionRowsSim(txRows, inventorySold);
assert.equal(result.length, 0, 'a ledger row whose shopId matches a real sold inventory record must be excluded even when its recorded price differs from that record\'s displayed price -- this is the exact discounted-sale duplicate the user reported');

// A row with no shopId at all (legacy, pre-tagging) must still fall through to fuzzy matching, unaffected.
const legacyTxRows = [{ id:'tx_legacy', name:'Untagged Old Sale', shopId:'', sourceType:'', salePrice:15, soldAt:'2020-01-01' }];
const legacyResult = getUnlinkedTransactionRowsSim(legacyTxRows, []);
assert.equal(legacyResult.length, 1, 'a legacy row with no shopId must still survive to the fuzzy-match fallback, not be silently dropped');

console.log('Sold dedup shopId-gate functional checks passed');
