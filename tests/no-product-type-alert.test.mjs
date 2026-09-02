import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Quick filter chip (top of Inventory tab) ──────────────────────────────
assert.match(dashboard, /<button class="fb" data-filter-group="flag" onclick="setF\('flag','no_config',this\)">No Product Type<\/button>/, 'missing the No Product Type quick filter chip');

// ── Health summary computation ────────────────────────────────────────────
assert.match(dashboard, /noConfig:inStock\.filter\(i=>!i\.configuration\)\.length,/, 'inventoryHealthSummary must count in-stock items missing a Product Type');

// ── Health dashboard card ─────────────────────────────────────────────────
assert.match(dashboard, /\['no_config','No Product Type',h\.noConfig,'needs Single\/Booster\/etc'\],/, 'renderInventoryHealthPanel must show a No Product Type card wired to h.noConfig');

// ── inventoryMatchesFlag() predicate (was a single filterTable() branch on
// the old shared activeF before the multi-select filter rework -- now its
// own independently-combinable group, see inventoryMatchesFlag) ──
assert.match(dashboard, /if\(flag === 'no_config'\) return !i\.configuration;/, 'inventoryMatchesFlag must filter to in-stock items with no Product Type when this quick filter is active');

console.log('No Product Type inventory alert checks passed');

// ── Functional: the underlying predicate itself ───────────────────────────
function inStockNoConfig(items){
  return items.filter(i => i.status === 'in_stock' && !i.configuration);
}
const sample = [
  { status:'in_stock', configuration:'Booster Pack' },
  { status:'in_stock', configuration:'' },
  { status:'in_stock' },
  { status:'sold', configuration:'' },
  { status:'in_stock', configuration:'Single' },
];
assert.equal(inStockNoConfig(sample).length, 2, 'must catch only in-stock items with a blank/missing Product Type, not sold items or ones that already have one');

console.log('No Product Type predicate functional checks passed');
