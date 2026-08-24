import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Root cause of "images don't show even online" after the offline-image
// priority fix shipped: live Pokemon/MTG search results swap row.imageUrl
// for a URL.createObjectURL(blob) preview when a bulk-synced offline image
// is found. That blob: URL is only valid inside the tab/document that
// created it. When a search result was added to inventory, that blob: URL
// got baked directly into the persisted imageUrl/thumbnail fields -- dead
// the moment the page reloads (which the user does constantly to stay on
// the latest build), with the real CDN URL already overwritten and lost.
// durableImageUrl() must strip blob: URLs at every point one could leak
// into persisted data or a stale render.

const helperStart = dashboard.indexOf('function durableImageUrl(url=\'\')');
assert(helperStart >= 0, 'durableImageUrl() must exist');
const helperEnd = dashboard.indexOf('\n}', helperStart);
const helper = dashboard.slice(helperStart, helperEnd);
assert.match(helper, /\/\^blob:\/i\.test/, 'must detect blob: URLs specifically');

// ── The edit-modal image-url input must never be pre-filled with a blob:
// preview URL -- typing nothing and saving would otherwise resubmit it.
// Stripping the blob: URL used to just leave this input blank even though
// the row still had a perfectly good live CDN URL available under
// liveImageUrl (see useOfflineRowImage below) -- that's tried next now,
// instead of the field just going empty.
assert.match(dashboard, /value="\$\{escHtml\(durableImageUrl\(r\.imageUrl\) \|\| durableImageUrl\(r\.liveImageUrl\)\)\}"/,
  'the qpl-edit-image-url input must not be pre-filled with a blob: preview URL, and must fall back to the preserved live CDN URL instead of going blank');

// ── The save-to-inventory object must never persist a blob: URL, from
// either the manual input field or the search row it was seeded from --
// and must fall back to the preserved live CDN URL (liveImageUrl) rather
// than saving no image at all when the blob: URL is the only thing r had.
const saveStart = dashboard.indexOf("thumbnail:durableImageUrl(document.getElementById('qpl-edit-image-url')");
assert(saveStart >= 0, 'the inventory save object must sanitize the thumbnail field');
const saveSlice = dashboard.slice(saveStart, saveStart + 700);
assert.match(saveSlice, /imageUrl:durableImageUrl\(document\.getElementById\('qpl-edit-image-url'\)\?\.value\.trim\(\)\) \|\| \(isComic&&r\.userPhotoBlobKey \? r\.externalCoverImageUrl\|\|'' : \(durableImageUrl\(r\.imageUrl\) \|\| durableImageUrl\(r\.liveImageUrl\)\)\)/,
  'the inventory save object must sanitize the imageUrl field the same way, falling back to liveImageUrl');

// ── inventoryImageUrl()'s final CDN-URL fallback must filter every
// candidate individually (not just the winning one), so a dead blob: URL
// sitting in an earlier field can't hide a perfectly good URL in a later
// one, and so previously-corrupted saved items self-heal instead of
// rendering a permanently broken <img>.
const fnStart = dashboard.indexOf('function inventoryImageUrl(item={})');
const fnEnd = dashboard.indexOf('\nfunction inventoryImageSourceLabel', fnStart);
const fn = dashboard.slice(fnStart, fnEnd);
assert.match(fn, /durableImageUrl\(item\.photoDataUrl\) \|\| durableImageUrl\(item\.userPhoto\)/,
  'each fallback candidate must be individually sanitized, not just the final ||-chain result');
assert.match(fn, /durableImageUrl\(raw\.thumbnail\) \|\| durableImageUrl\(raw\.imageUrl\)/,
  'the raw.* fallback candidates must be sanitized too');
assert.match(fn, /durableImageUrl\(item\.liveImageUrl\)/, 'inventoryImageUrl must also fall back to item.liveImageUrl, not just imageUrl/thumbnail');
assert.match(fn, /durableImageUrl\(raw\.liveImageUrl\)/, 'inventoryImageUrl must also fall back to raw.liveImageUrl');

console.log('Blob-URL image persistence checks passed');

// ── Root cause (found investigating "image doesn't load sometimes even
// while online, started when we added ppt offline"): durableImageUrl()
// correctly stripped a dead blob: URL at render/save time, but nothing
// upstream ever PRESERVED the real CDN URL it was replacing -- the swap
// sites overwrote row.imageUrl directly and threw the original away, so
// once the offline-image swap ran there was nothing left to fall back to,
// online or not. useOfflineRowImage() fixes that at the source: every site
// that swaps in a synced offline blob must go through it instead of
// setting row.imageUrl directly, so row.liveImageUrl always keeps the real
// CDN URL alive for the fallbacks above (and the two save-to-inventory
// sites) to find. ──
{
  const helperStart2 = dashboard.indexOf('function useOfflineRowImage(row, blob){');
  assert(helperStart2 >= 0, 'useOfflineRowImage() must exist');
  const helperEnd2 = dashboard.indexOf('\n}', helperStart2);
  const helper2 = dashboard.slice(helperStart2, helperEnd2);
  assert.match(helper2, /row\.liveImageUrl = row\.liveImageUrl \|\| row\.imageUrl \|\| '';/, 'must preserve whatever imageUrl held before overwriting it');
  assert.match(helper2, /row\.imageUrl = URL\.createObjectURL\(blob\);/, 'must still perform the actual swap');
}
// Every Pokemon/MTG live-search site that used to overwrite row.imageUrl
// directly (five of them: offline-cache search, parse-title hydration,
// sealed products, the main documented-card search, and MTG's own) must
// now go through the helper instead -- a bare `row.imageUrl =
// URL.createObjectURL(blob)` anywhere outside the helper's own definition
// means a new call site reintroduced the exact bug this fixes.
const bareAssignCount = (dashboard.match(/\brow\.imageUrl = URL\.createObjectURL\(blob\);/g) || []).length;
assert.equal(bareAssignCount, 1, 'exactly one bare "row.imageUrl = URL.createObjectURL(blob)" may exist in the whole file -- inside useOfflineRowImage itself; every call site must go through the helper instead');
assert.doesNotMatch(dashboard, /\bh\.imageUrl = URL\.createObjectURL\(blob\);/, 'the parse-title hydration site must also go through useOfflineRowImage, not set h.imageUrl directly');
{
  const searchCacheFn = dashboard.slice(dashboard.indexOf('const store = sealedIntent ? \'ppt_sealed\' : \'ppt_cards\';'), dashboard.indexOf('const store = sealedIntent ? \'ppt_sealed\' : \'ppt_cards\';') + 900);
  assert.match(searchCacheFn, /useOfflineRowImage\(row, blob\);/, 'the offline-cache search path must use the helper');
}
assert.match(dashboard, /const blob = await window\.ArsCaPokemonOfflineImages\?\.getImageBlob\(row\.tcgPlayerId, '400'\)\.catch\(\(\) => null\);\s*\n\s*useOfflineRowImage\(h, blob\);/, 'the parse-title hydration path must use the helper');
assert.match(dashboard, /if\(blob\) \{ useOfflineRowImage\(row, blob\); return; \}/, 'the MTG offline-only image swap must use the helper too, not just the Pokemon paths');

// ── The direct "add Research result to Buy tray" path had the exact same
// gap -- imageUrl:item.imageUrl with no sanitization or liveImageUrl
// fallback at all. ──
assert.match(dashboard, /imageUrl:durableImageUrl\(item\.imageUrl\) \|\| durableImageUrl\(item\.liveImageUrl\) \|\| '',\s*\n\s*priceSource:item\.priceSource,/, 'adding a Research result straight to the Buy tray must sanitize imageUrl and fall back to liveImageUrl, not persist a raw blob: URL');

console.log('useOfflineRowImage rescue checks passed');
