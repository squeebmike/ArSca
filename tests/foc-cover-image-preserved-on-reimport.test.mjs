import assert from 'node:assert/strict';
import { handleFocRequest } from '../scripts/foc-preorders.mjs';

// Store report: "I imported the Lunar FOC and it didn't show images" --
// investigation found two separate things. First, Lunar's own distributor
// feed simply has no cover-image column at all (a known, pre-existing
// limitation with its own manual-paste fallback already built). Second,
// and the real regression here: once staff pastes a cover image in by
// hand, a LATER re-import (an updated file for the same cycle, or PRH's
// own feed occasionally missing CoverLink for a row) silently wiped that
// manually-set image back to blank, because the SKU upsert always wrote
// whatever the new row's parsed coverImageUrl was, including empty,
// clobbering whatever the store had already set. This proves the fix:
// a blank new value must fall back to whatever cover_image_url was
// already saved, mirroring the existing hadCustomPrice preservation the
// price field already gets.

function mockRequest(body, storeId) {
  return {
    method: 'POST',
    headers: { get: (k) => k === 'X-Store-Id' ? storeId : null },
    json: async () => body,
  };
}

function mockDeps(db) {
  return {
    json: (data, status = 200) => ({ status, data }),
    readJsonWithLimit: async (request) => ({ data: await request.json() }),
    requireStoreUser: async () => ({ user: { id: 'user-1' } }),
    supabaseAdminFetch: db,
  };
}

// One already-imported cover with a staff-pasted cover_image_url, and one
// new row for the same SKU whose freshly-parsed data has no image at all
// (Lunar's real-world case) -- re-importing must not erase it.
function buildDb(skuUpsertCalls, existingCoverImageUrl) {
  return async (env, path, options = {}) => {
    if (path.startsWith('foc_cycles?store_id=')) return { data: [] };
    if (path.startsWith('foc_cycles?on_conflict=')) return { data: [{ id: 'cycle-1', status: 'open', customer_cutoff_at: null }] };
    if (path.startsWith('comic_title_families?on_conflict=')) {
      const sent = JSON.parse(options.body);
      return { data: sent.map((f, i) => ({ ...f, id: 'fam-' + i })) };
    }
    if (path.startsWith('comic_skus?cycle_id=eq.cycle-1&select=')) {
      return { data: [{ id: 'sku-1', distributor_sku: 'LUNAR-SKU-1', row_sha256: 'stale-hash', msrp_cents: 399, customer_price_cents: 399, cover_image_url: existingCoverImageUrl }] };
    }
    if (path.startsWith('comic_skus?on_conflict=')) {
      skuUpsertCalls.push(JSON.parse(options.body));
      return { data: [] };
    }
    if (path.startsWith('foc_cycles?id=eq.')) return { data: [] };
    return { data: [] };
  };
}

const lunarRow = {
  ProductCode: 'LUNAR-SKU-1', UPC: '70985305211128211', Title: 'Savage Dragon #282',
  Publisher: 'Image Comics', RetailCost: '3.99', FinalOrderCutoff: '08/24/2026', InstoreDate: '09/30/2026',
};

{
  const skuUpsertCalls = [];
  const deps = mockDeps(buildDb(skuUpsertCalls, 'https://example.com/staff-pasted-cover.jpg'));
  const res = await handleFocRequest(mockRequest({ rows: [lunarRow] }, 'store-1'), {}, new URL('https://x/foc/admin/import?distributor=Lunar'), deps);
  assert.equal(res.data.ok, true, JSON.stringify(res.data));
  assert.equal(skuUpsertCalls.length, 1, 'the SKU upsert must have been called exactly once');
  const row = skuUpsertCalls[0].find(r => r.distributor_sku === 'LUNAR-SKU-1');
  assert.ok(row, 'the re-imported SKU must be in the upsert payload');
  assert.equal(row.cover_image_url, 'https://example.com/staff-pasted-cover.jpg', 'a re-import with no image data of its own must preserve the staff-pasted cover image instead of wiping it to null');
}

{
  // A store with nothing pasted yet (existing cover_image_url is null) must
  // still get null, not throw or coerce to some other falsy value.
  const skuUpsertCalls = [];
  const deps = mockDeps(buildDb(skuUpsertCalls, null));
  const res = await handleFocRequest(mockRequest({ rows: [lunarRow] }, 'store-1'), {}, new URL('https://x/foc/admin/import?distributor=Lunar'), deps);
  assert.equal(res.data.ok, true, JSON.stringify(res.data));
  const row = skuUpsertCalls[0].find(r => r.distributor_sku === 'LUNAR-SKU-1');
  assert.equal(row.cover_image_url, null, 'with nothing ever saved, a blank re-import must stay null, not become an empty string or throw');
}

console.log('Cover image preserved across a Lunar re-import functional checks passed');
