import assert from 'node:assert/strict';
import fs from 'node:fs';
import { identifyAndResolveCardIntakeItem, resolvePokemonCandidates, resolveMtgCandidates, HIGH_VALUE_CENTS } from '../scripts/card-intake.mjs';

// Store report: Card Intake processing only ran while the browser tab that
// captured a photo stayed open, and the review screen only ever showed a
// single catalog-search price, never a verified live comp. Both are now
// fixed by moving identification+pricing entirely server-side, kicked off
// via a Worker execution context at item-creation time (see createItem/
// scannerUpload in card-intake.mjs) instead of a client-side JS queue.

// ── resolvePokemonCandidates: same-origin call reusing the existing,
// already-battle-tested /pricing/pokemonpricetracker/cards route ──────────
{
  let capturedUrl = null, capturedHeaders = null;
  globalThis.fetch = async (url, opts) => {
    capturedUrl = url; capturedHeaders = opts?.headers;
    return { ok: true, json: async () => ({ ok: true, cards: [
      { name: 'Lucario V', setName: 'Astral Radiance', cardNumber: '78/189', tcgPlayerId: '12345', marketPrice: { price: 4.5 } },
      { name: 'Lucario VSTAR', setName: 'Astral Radiance', cardNumber: '123/189', marketPrice: 12.0 },
    ] }) };
  };
  const card = { game: 'pokemon', name: 'Lucario V', setName: 'Astral Radiance', number: '78/189', year: '', finish: '', confidence: 'high' };
  const result = await resolvePokemonCandidates('https://example.workers.dev', 'store-1', 'Bearer real-user-token', card);
  assert.ok(capturedUrl.startsWith('https://example.workers.dev/pricing/pokemonpricetracker/cards?'), 'must call the existing internal PPT route, not a new one-off endpoint');
  assert.equal(capturedHeaders.Authorization, 'Bearer real-user-token', 'must forward the original caller\'s own auth token -- that route requires requireStoreUser');
  assert.equal(capturedHeaders['X-Store-Id'], 'store-1');
  assert.equal(result.length, 2, 'must return every candidate PPT found, not just the first');
  assert.equal(result[0].name, 'Lucario V');
  assert.equal(result[0].market, 4.5, 'must extract price from the marketPrice.price fallback path');
  assert.equal(result[1].market, 12.0, 'must extract price from the bare marketPrice fallback path');
  assert.equal(result[0].category, 'Pokemon TCG');

  // No auth token (e.g. a scanner-sourced item with no logged-in user) must
  // return no candidates rather than calling the route unauthenticated and
  // getting a confusing 401 deep in a background job.
  capturedUrl = null;
  const noAuthResult = await resolvePokemonCandidates('https://example.workers.dev', 'store-1', '', card);
  assert.deepEqual(noAuthResult, []);
  assert.equal(capturedUrl, null, 'must not even attempt the call without an auth token');
}
console.log('resolvePokemonCandidates checks passed');

// ── resolveMtgCandidates: direct public Scryfall call, no auth needed ────
{
  let capturedUrl = null;
  globalThis.fetch = async (url) => {
    capturedUrl = url;
    return { ok: true, json: async () => ({ data: [
      { name: 'Lightning Bolt', set_name: 'Alpha', collector_number: '161', released_at: '1993-08-05', prices: { usd: '450.00', usd_foil: null } },
    ] }) };
  };
  const card = { game: 'mtg', name: 'Lightning Bolt', setName: 'Alpha', number: '', year: '', finish: '', confidence: 'medium' };
  const result = await resolveMtgCandidates(card);
  assert.ok(capturedUrl.startsWith('https://api.scryfall.com/cards/search?q='), 'must call Scryfall\'s real public search API');
  assert.equal(result.length, 1);
  assert.equal(result[0].market, 450, 'must use the non-foil price when the card isn\'t identified as foil');
  assert.equal(result[0].year, '1993');
  assert.equal(result[0].category, 'Magic: The Gathering');
}
console.log('resolveMtgCandidates checks passed');

// ── identifyAndResolveCardIntakeItem: the full server-side pipeline ──────
{
  const calls = [];
  const db = async (path, opts) => {
    calls.push({ path, opts: opts ? { ...opts, body: opts.body ? JSON.parse(opts.body) : undefined } : undefined });
    return { data: [] };
  };
  const fakeR2 = { get: async (key) => (key === 'inventory-photos/store-1/card.jpg' ? { arrayBuffer: async () => new TextEncoder().encode('fake-jpeg-bytes').buffer } : null) };
  const env = { MTG_CATALOG_R2: fakeR2 };
  const deps = {
    identifyCardsFromImageBase64: async () => ([{ game: 'pokemon', name: 'Charizard', setName: 'Base Set', number: '4/102', year: '', finish: 'holo', specialMarkings: '', confidence: 'high' }]),
  };
  const item = { id: 'item-1', store_id: 'store-1', front_image_url: 'https://worker.example/inventory/photo/inventory-photos/store-1/card.jpg' };

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, cards: [{ name: 'Charizard', setName: 'Base Set', cardNumber: '4/102', marketPrice: 350 }] }) });

  await identifyAndResolveCardIntakeItem(db, env, deps, item, { originUrl: 'https://worker.example', storeId: 'store-1', authToken: 'Bearer tok' });

  const statusPatches = calls.filter(c => c.path.startsWith('card_intake_items?') && c.opts?.method === 'PATCH').map(c => c.opts.body);
  assert.ok(statusPatches.some(b => b.status === 'processing'), 'must mark the item processing before doing any work');
  const finalPatch = statusPatches[statusPatches.length - 1];
  assert.equal(finalPatch.category, 'Pokemon TCG');
  assert.ok(finalPatch.best_match && finalPatch.best_match.name === 'Charizard', 'must land a real resolved catalog match, not just the raw extracted fields');
  assert.equal(finalPatch.market_cents, 35000, 'must convert the resolved dollar price into cents');
  assert.equal(finalPatch.high_value, 35000 >= HIGH_VALUE_CENTS);

  const attemptInsert = calls.find(c => c.path === 'card_identification_attempts');
  assert.ok(attemptInsert, 'must log an identification_attempts row for history, same as the store\'s own identification-history requirement');

  const pricingInsert = calls.find(c => c.path === 'pricing_snapshots');
  assert.ok(pricingInsert, 'a resolved priced match must write a pricing_snapshots row -- that table existed but nothing wrote to it before this fix');
  assert.equal(pricingInsert.opts.body[0].price_cents, 35000);
  assert.equal(pricingInsert.opts.body[0].provider, 'pokemonpricetracker');
}
console.log('identifyAndResolveCardIntakeItem (pokemon, happy path) checks passed');

// ── Sports/One Piece: honest scope -- identity captured, no fabricated price ──
{
  const calls = [];
  const db = async (path, opts) => { calls.push({ path, opts: opts ? { ...opts, body: opts.body ? JSON.parse(opts.body) : undefined } : undefined }); return { data: [] }; };
  const fakeR2 = { get: async () => ({ arrayBuffer: async () => new TextEncoder().encode('bytes').buffer }) };
  const env = { MTG_CATALOG_R2: fakeR2 };
  const deps = { identifyCardsFromImageBase64: async () => ([{ game: 'sports', name: 'Julio Rodriguez', setName: 'Topps Chrome', number: '44', year: '2024', finish: 'Refractor', specialMarkings: 'Rookie', confidence: 'high' }]) };
  const item = { id: 'item-2', store_id: 'store-1', front_image_url: 'https://worker.example/inventory/photo/x.jpg' };
  await identifyAndResolveCardIntakeItem(db, env, deps, item, { originUrl: 'https://worker.example', storeId: 'store-1', authToken: '' });
  const patches = calls.filter(c => c.path.startsWith('card_intake_items?') && c.opts?.method === 'PATCH').map(c => c.opts.body);
  const finalPatch = patches[patches.length - 1];
  assert.equal(finalPatch.market_cents, 0, 'sports must never get a fabricated price -- no live text-search catalog is wired in server-side for it yet');
  assert.equal(finalPatch.best_match.name, 'Julio Rodriguez', 'the raw extracted identity must still be captured and saved, not discarded');
  assert.match(finalPatch.error, /no live price source/, 'must clearly explain WHY there\'s no price, not just silently show $0');
  assert.equal(calls.some(c => c.path === 'pricing_snapshots'), false, 'must never write a pricing_snapshots row for a $0/unverified price');
}
console.log('identifyAndResolveCardIntakeItem (sports, honest scope) checks passed');

// ── Never leaves an item silently stuck: a hard failure still resolves ───
{
  const calls = [];
  const db = async (path, opts) => { calls.push({ path, opts: opts ? { ...opts, body: opts.body ? JSON.parse(opts.body) : undefined } : undefined }); return { data: [] }; };
  const env = { MTG_CATALOG_R2: { get: async () => null } }; // stored image missing
  const deps = { identifyCardsFromImageBase64: async () => { throw new Error('should not be reached'); } };
  const item = { id: 'item-3', store_id: 'store-1', front_image_url: 'https://worker.example/inventory/photo/missing.jpg' };
  await identifyAndResolveCardIntakeItem(db, env, deps, item, { originUrl: 'https://worker.example', storeId: 'store-1', authToken: '' });
  const patches = calls.filter(c => c.path.startsWith('card_intake_items?') && c.opts?.method === 'PATCH').map(c => c.opts.body);
  const finalPatch = patches[patches.length - 1];
  assert.equal(finalPatch.status, 'failed');
  assert.match(finalPatch.error, /not found/i);
}
console.log('identifyAndResolveCardIntakeItem (failure never silently stuck) checks passed');

// ── Frontend no longer does any of this itself -- calling it from both
// sides would double the identification cost and race-overwrite results ──
const frontendSrc = fs.readFileSync('scripts/card-intake-dashboard.js', 'utf8');
assert.doesNotMatch(frontendSrc, /callOwnCardIdentify/, 'the dashboard module must not run its own client-side identification anymore -- that now happens once, server-side');
assert.doesNotMatch(frontendSrc, /function processCardIntakeItem\(/, 'the old client-side per-item processor must be gone, not just unused');
assert.match(frontendSrc, /startScanLabPolling/, 'Scan Lab must still poll for the server-driven status updates so thumbnails update live');

console.log('Card intake frontend/backend processing-ownership checks passed');
