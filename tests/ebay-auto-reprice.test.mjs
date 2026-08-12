import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Auto-reprice must only ever touch the OFFER (price), never the item ──
// eBay's Inventory API has no partial-update endpoint -- both inventory_item
// and offer PUTs are full-replace. buildEbayAspects rebuilds aspects from
// granular category-specific fields (sport/year/set/etc), not from a flat
// dict, so there's no safe way to reconstruct the item side from live data
// without risking silently overwriting real condition/description/aspects
// with guessed defaults. The offer side has no such risk -- everything it
// needs comes back verbatim from GET /sell/inventory/v1/offer/{offerId}.

assert.match(worker, /async function ebayReviseOfferPrice\(env, offerId, newPrice\) \{/, 'missing ebayReviseOfferPrice');
assert.doesNotMatch(worker, /ebayReviseOfferPrice[\s\S]{0,2000}?buildEbayInventoryItemBody/, 'auto-reprice must never call buildEbayInventoryItemBody (would touch title/condition/aspects/images)');
assert.match(worker, /const body = buildEbayOfferBody\(\{[\s\S]*?description: offer\.listingDescription,\s*\n\s*price: newPrice,/, 'auto-reprice must build the offer body from the live offer, changing only price');

console.log('eBay auto-reprice safety-boundary checks passed');

// ── Scheduled job: opt-in per store, real guardrails, resilient ──────────
assert.match(worker, /async function runScheduledEbayReprice\(env\) \{/, 'missing runScheduledEbayReprice');
assert.match(worker, /ctx\.waitUntil\(Promise\.all\(\[runScheduledDealScans\(env\), runScheduledEbayReprice\(env\)\]\)\)/, 'runScheduledEbayReprice must be wired into the scheduled() cron handler alongside the existing deal scan job');
assert.match(worker, /const cfg = settingsRows\?\.\[0\]\?\.receipt_settings\?\.ebayAutoReprice;\s*\n\s*if \(!cfg \|\| !cfg\.enabled\) continue;/, 'auto-reprice must be opt-in per store, skipped entirely when not explicitly enabled');
assert.match(worker, /if \(repriceCount >= maxDrops\) \{ summary\.skipped\+\+; continue; \}/, 'auto-reprice must respect a max-drops-per-item cap');
assert.match(worker, /const floor = cost > 0 \? cost \* \(1 \+ minMarginPct \/ 100\) : 0;/, 'auto-reprice must compute a cost-based price floor');
assert.match(worker, /if \(newPrice <= 0 \|\| \(floor > 0 && newPrice < floor\)\) \{ summary\.skipped\+\+; continue; \}/, 'auto-reprice must refuse to drop a price below its floor rather than clamp/force it');
assert.match(worker, /if \(ageMs < cutoffMs\) \{ summary\.skipped\+\+; continue; \}/, 'auto-reprice must only touch listings old enough per the configured day threshold');
assert.match(worker, /\} catch \(e\) \{\s*\n\s*summary\.errors\+\+;\s*\n\s*\}\s*\n\s*\}\s*\n\s*\} catch \(e\) \{\s*\n\s*summary\.errors\+\+;\s*\n\s*\}\s*\n\s*if \(env\.LBA_KV\)/, 'a single item or store failure must not abort the whole scheduled run');

console.log('eBay auto-reprice scheduled-job checks passed');

// ── Status route + dashboard settings wiring ──────────────────────────
assert.match(worker, /if \(url\.pathname === '\/ebay\/reprice\/status'\) \{/, 'missing /ebay/reprice/status route');
assert.match(dashboard, /function ebayAutoRepriceSettingsHtml\(p\)\{/, 'missing ebayAutoRepriceSettingsHtml');
assert.match(dashboard, /function saveEbayAutoRepriceSettings\(\)\{/, 'missing saveEbayAutoRepriceSettings');
assert.match(dashboard, /function loadEbayRepriceStatus\(\)\{/, 'missing loadEbayRepriceStatus');
assert.match(dashboard, /id="ear-enabled" type="checkbox"/, 'missing the auto-reprice enable checkbox');
// Off by default -- must never silently start repricing a store's real listings.
assert.match(dashboard, /const cfg = \{ enabled:false, days:60, pct:10, minMarginPct:10, maxDrops:5, \.\.\.\(p\.ebayAutoReprice \|\| \{\}\) \};/, 'auto-reprice must default to disabled with sane conservative defaults');

// receipt_settings is a full-replace column written from two places
// (saveVendorProfile + savePaymentSettings) -- the new field must be in
// BOTH explicit whitelists or one of them will silently wipe it out.
const ebayAutoRepriceInWhitelist = (dashboard.match(/ebayAutoReprice:next\.ebayAutoReprice \|\| \{\},/g) || []).length;
assert.equal(ebayAutoRepriceInWhitelist, 2, 'ebayAutoReprice must be carried in both receipt_settings whitelists (saveVendorProfile and savePaymentSettings), or one will erase the other\'s write');

console.log('eBay auto-reprice settings + status wiring checks passed');
