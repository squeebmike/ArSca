import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Contract: manual search gets the same voice-input pattern used elsewhere, not a bespoke one ──
assert.match(dashboard, /<button class="hbtn" title="Speak search" aria-label="Voice search Pocket Scout" onclick="startVoiceInput\('scout-manual-query', scoutManualSearch\)"/, 'Pocket Scout manual search must get a mic button wired through the existing startVoiceInput helper');

// ── Contract: sold comps must never call the flaky legacy eBay Finding API directly --
// they must go through a helper that tries the dedicated sold-comps provider first,
// exactly like the already-proven /comps/sold route does. ──
assert.match(worker, /async function fetchSoldCompsWithFallback\(env, query, limit = 40\) \{/, 'a shared provider-first fallback helper must exist');
assert.match(worker, /fetchSoldCompsWithFallback[\s\S]{0,200}let result = await fetchSoldCompsProvider\(env, query, limit\);/, 'the fallback helper must try the dedicated sold-comps provider first');
assert.doesNotMatch(worker, /soldResult = await fetchEbaySoldComps\(env, textQuery, 30\)/, 'the Pocket Scout photo route must no longer call the legacy eBay API directly');
assert.doesNotMatch(worker, /\[activeResult, soldResult\] = await Promise\.all\(\[\s*fetchEbayActiveListings\(env, textQuery, \{ limit: 20 \}\)\.catch\(\(\) => \(\{ listings: \[\] \}\)\),\s*fetchEbaySoldComps\(env, textQuery, 30\)/, 'the Pocket Scout manual-search route must no longer call the legacy eBay API directly');
assert.match(worker, /\[activeResult, soldResult\] = await Promise\.all\(\[\s*textQuery \? fetchEbayActiveListings\(env, textQuery, \{ limit: 20 \}\)\.catch\(\(\) => \(\{ listings: \[\] \}\)\) : Promise\.resolve\(\{ listings: \[\] \}\),\s*textQuery \? fetchSoldCompsWithFallback\(env, textQuery, 30\)/, 'the photo route must use the shared fallback helper for sold comps, run concurrently with the active-listings lookup rather than awaited sequentially');
assert.match(worker, /fetchSoldCompsWithFallback\(env, textQuery, 30\)\.catch\(\(\) => \(\{ comps: \[\], warning: 'Sold comp lookup failed' \}\)\),\s*\]\);/, 'the manual-search route must use the shared fallback helper for sold comps');

// ── Contract: the eBay search query used at scan time is persisted onto the item so a
// later sync can re-run it -- registered through the one array that makes any field
// actually round-trip through read/write/sync, per this codebase's own established rule. ──
assert.match(dashboard, /\['pocketScoutQuery',''\]/, 'pocketScoutQuery must be registered in BUILT_IN_ITEM_SIMPLE_FIELDS or it will never actually save');
assert.match(dashboard, /\['pocketScoutLastSync',''\]/, 'pocketScoutLastSync must be registered in BUILT_IN_ITEM_SIMPLE_FIELDS');
assert.match(dashboard, /\['activeCompSnapshot',null,'raw'\]/, 'activeCompSnapshot must be registered so applySelectedPriceSyncUpdates can persist a refreshed snapshot');
assert.match(dashboard, /\['soldCompSnapshot',null,'raw'\]/, 'soldCompSnapshot must be registered so applySelectedPriceSyncUpdates can persist a refreshed snapshot');
assert.match(dashboard, /pocketScoutQuery: scoutSession\.compSnapshot\?\.textQuery \|\| identity\.title \|\| '', pocketScoutLastSync: new Date\(\)\.toISOString\(\),/, 'scoutBuyAddInventory must save the scan-time eBay query onto the new inventory row');

// ── Contract: a dedicated proposal-builder + run function exist, following the exact
// pattern of the other price-sync buttons (comic/mtg), reusing the shared proposal
// review/apply flow rather than a parallel one ──
assert.match(dashboard, /function pocketScoutPriceSyncItems\(\)\{/, 'a items-selector function must exist for Pocket Scout price sync');
assert.match(dashboard, /String\(i\.pocketScoutQuery\|\|''\)\.trim\(\)/, 'Pocket Scout price sync must only pick up items carrying a saved query (no stable catalog ID exists to key off otherwise)');
assert.match(dashboard, /async function buildPocketScoutPriceSyncProposal\(options = \{\}\)\{/, 'a proposal-builder function must exist');
assert.match(dashboard, /storeWorkerFetch\('\/comps\/sold\?q='\+encodeURIComponent\(q\)\+'&limit=40'\)/, 'the proposal builder must re-run the saved query against the real /comps/sold route (provider-first, eBay-fallback) rather than a bespoke lookup');
assert.match(dashboard, /async function runPocketScoutPriceSync\(\)\{/, 'a run function wired to a modal button must exist');
assert.match(dashboard, /id="price-sync-scout-btn" onclick="runPocketScoutPriceSync\(\)">SYNC POCKET SCOUT PRICES</, 'the price sync modal must have a SYNC POCKET SCOUT PRICES button');

// ── Contract: applying an update writes back through the same shared apply path,
// with mode-appropriate provider fields (not the Pokemon-tracker defaults) ──
assert.match(dashboard, /const isPocketScoutSync = p\.mode === 'pocket-scout' \|\| p\.provider === 'pocket_scout';/, 'applySelectedPriceSyncUpdates must recognize the pocket-scout mode');
assert.match(dashboard, /\} : isPocketScoutSync \? \{\s*pocketScoutLastSync:lastUpdated,/, 'applying a Pocket Scout price change must write pocketScoutLastSync, not unrelated Pokemon-tracker fields');

console.log('Pocket Scout enhancements contract checks passed');

// ── Functional: reimplement fetchSoldCompsWithFallback's decision logic and confirm
// it only falls back to the legacy eBay API when the dedicated provider comes up empty ──
async function fetchSoldCompsWithFallback(providerFn, ebayFn, query, limit = 40) {
  let result = await providerFn(query, limit);
  if (!result.comps.length) {
    const ebay = await ebayFn(query, limit).catch(() => ({ comps: [], warning: 'Sold comp lookup failed' }));
    if (ebay.comps.length) result = ebay;
    else if (ebay.warning && !result.warning) result = { ...result, warning: ebay.warning };
  }
  return result;
}

{
  let ebayCalled = false;
  const provider = async () => ({ source: 'soldcomps', comps: [{ total: 12 }], warning: null });
  const ebay = async () => { ebayCalled = true; return { source: 'ebay', comps: [{ total: 9 }], warning: null }; };
  const result = await fetchSoldCompsWithFallback(provider, ebay, 'test query', 30);
  assert.equal(ebayCalled, false, 'the legacy eBay API must never be called when the dedicated provider already found comps');
  assert.equal(result.source, 'soldcomps', 'a successful provider result must be used as-is');
}

{
  let ebayCalled = false;
  const provider = async () => ({ source: 'soldcomps', comps: [], warning: 'SOLDCOMPS_API_KEY not set' });
  const ebay = async () => { ebayCalled = true; return { source: 'ebay', comps: [{ total: 9 }], warning: null }; };
  const result = await fetchSoldCompsWithFallback(provider, ebay, 'test query', 30);
  assert.equal(ebayCalled, true, 'the legacy eBay API must be tried when the dedicated provider returns no comps');
  assert.equal(result.source, 'ebay', 'a successful eBay fallback result must be used when the provider came up empty');
}

{
  const provider = async () => ({ source: 'soldcomps', comps: [], warning: 'SOLDCOMPS_API_KEY not set' });
  const ebay = async () => ({ source: 'ebay', comps: [], warning: 'eBay unavailable' });
  const result = await fetchSoldCompsWithFallback(provider, ebay, 'test query', 30);
  assert.equal(result.comps.length, 0, 'no comps from either source must surface as an empty result, not throw');
  assert.equal(result.warning, 'SOLDCOMPS_API_KEY not set', 'when both sources are empty, the original provider warning is kept');
}

console.log('Pocket Scout enhancements functional checks passed');
