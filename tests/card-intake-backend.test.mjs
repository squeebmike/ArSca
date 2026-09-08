import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyAcquisitionTiers, defaultAcquisitionTiers, promoteItemToInventory, HIGH_VALUE_CENTS, handleCardIntakeRequest } from '../scripts/card-intake.mjs';

// ── Acquisition tiers: configurable, market-weighted, never a flat % ──────
assert.equal(HIGH_VALUE_CENTS, 25000, 'high-value alert threshold must be $250 per the store spec');

{
  const tiers = defaultAcquisitionTiers();
  assert.equal(applyAcquisitionTiers(tiers, 50), Math.round(50 * 0.20), 'a $0.50 card falls in the lowest tier');
  assert.equal(applyAcquisitionTiers(tiers, 300), Math.round(300 * 0.30), 'a $3 card falls in the $1-5 tier');
  assert.equal(applyAcquisitionTiers(tiers, 1500), Math.round(1500 * 0.50), 'a $15 card falls in the $5-20 tier');
  assert.equal(applyAcquisitionTiers(tiers, 5000), Math.round(5000 * 0.65), 'a $50 card falls in the $20-100 tier');
  assert.equal(applyAcquisitionTiers(tiers, 20000), Math.round(20000 * 0.70), 'a $200 card falls in the $100+ tier');
}

{
  // A custom store-configured rule set must actually be used instead of the
  // hardcoded defaults -- this is the "must be configurable" requirement.
  const customTiers = [{ minCents: 0, maxCents: null, pct: 40 }];
  assert.equal(applyAcquisitionTiers(customTiers, 10000), 4000, 'a custom single-tier rule must override the default tiers');
}

console.log('Card intake acquisition-tier math checks passed');

// ── promoteItemToInventory: market-weighted cost, provenance retained ────
{
  const calls = [];
  const db = async (path, opts) => {
    calls.push({ path, opts });
    if (opts?.method === 'POST' && path === 'inventory_items') {
      return { data: [{ id: 'inv-123' }] };
    }
    return { data: [] };
  };
  const item = {
    id: 'item-1', batch_id: 'batch-1', collection_buy_id: null,
    front_image_url: 'https://example.com/front.jpg', back_image_url: '',
    condition: null, cost_cents: null, market_cents: 12000,
    best_match: { name: 'Julio Rodriguez Refractor', set: 'Topps Chrome', number: '44', year: '2024', category: 'Sports Card', market: 120 },
    final_fields: null,
  };
  const inventoryItemId = await promoteItemToInventory(db, 'store-1', item, { allocatedCostCents: 4200 });
  assert.equal(inventoryItemId, 'inv-123');
  const insertCall = calls.find(c => c.path === 'inventory_items' && c.opts?.method === 'POST');
  assert.ok(insertCall, 'must insert into inventory_items');
  const [row] = JSON.parse(insertCall.opts.body);
  assert.equal(row.store_id, 'store-1');
  assert.equal(row.status, 'in_stock');
  assert.equal(row.data.name, 'Julio Rodriguez Refractor');
  assert.equal(row.data.cost, 42, 'allocated cost must be used (in dollars) instead of the item\'s own market-based default');
  assert.equal(row.data.qty, 1, 'card intake always promotes one physical copy at a time');
  assert.equal(row.data.source, 'card_intake');
  assert.equal(row.data.cardIntakeBatchId, 'batch-1', 'origin batch must be retained on the promoted inventory row');
  assert.equal(row.data.cardIntakeAllocatedCostCents, 4200, 'allocated cost must be retained for accounting');

  const patchCall = calls.find(c => c.opts?.method === 'PATCH');
  assert.ok(patchCall, 'must patch the card_intake_items row with the resulting inventory_item_id');
  const patchBody = JSON.parse(patchCall.opts.body);
  assert.equal(patchBody.inventory_item_id, 'inv-123');
  assert.equal(patchBody.status, 'approved');
}

{
  // Idempotency: an item that already has an inventory_item_id must never
  // be promoted twice (e.g. a retried purchase-collection call).
  const calls = [];
  const db = async (path, opts) => { calls.push({ path, opts }); return { data: [] }; };
  const already = { id: 'item-2', inventory_item_id: 'inv-already' };
  const result = await promoteItemToInventory(db, 'store-1', already);
  assert.equal(result, 'inv-already');
  assert.equal(calls.length, 0, 'must not touch the database again for an already-promoted item');
}

console.log('promoteItemToInventory checks passed');

// ── Route table sanity: every documented endpoint is actually wired up ───
const routePaths = [
  ['/card-intake/batches', 'POST'], ['/card-intake/batches', 'GET'], ['/card-intake/batches', 'PATCH'],
  ['/card-intake/items', 'POST'], ['/card-intake/items', 'GET'], ['/card-intake/items', 'PATCH'],
  ['/card-intake/attempts', 'POST'], ['/card-intake/review', 'POST'],
  ['/card-intake/acquisition-rules', 'GET'], ['/card-intake/acquisition-rules', 'PUT'],
  ['/card-intake/scanner-workstations', 'POST'], ['/card-intake/scanner-upload', 'POST'],
  ['/collections', 'POST'], ['/collections', 'GET'], ['/collections', 'PATCH'], ['/collections/purchase', 'POST'],
];
for (const [path, method] of routePaths) {
  const url = new URL('https://example.com' + path);
  const request = { method, headers: { get: () => '' } };
  const deps = { json: (body, status) => ({ __json: body, status }), readJsonWithLimit: async () => ({ data: {} }), requireStoreUser: async () => ({ error: { __json: { ok: false }, status: 401 } }), supabaseAdminFetch: async () => ({ data: [] }) };
  const res = await handleCardIntakeRequest(request, {}, url, deps);
  assert.notEqual(res?.__json?.error, 'Card intake route not found', `${method} ${path} must be a registered route`);
}
console.log('Card intake route table checks passed');

// ── Approve-vs-collection branching lives in the source, not just docs ──
const src = fs.readFileSync('scripts/card-intake.mjs', 'utf8');
assert.match(src, /if\s*\(!item\.collection_buy_id\)/, 'a standalone intake item (no collection) must promote to inventory immediately on approve');
assert.match(src, /patch\.status\s*=\s*'approved'/, 'a collection-buy item must stop at approved, not promote, until the collection is purchased');

console.log('Card intake backend contract checks passed');
