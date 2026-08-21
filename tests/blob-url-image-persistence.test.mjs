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
assert.match(dashboard, /value="\$\{escHtml\(durableImageUrl\(r\.imageUrl\)\)\}"/,
  'the qpl-edit-image-url input must not be pre-filled with a blob: preview URL');

// ── The save-to-inventory object must never persist a blob: URL, from
// either the manual input field or the search row it was seeded from.
const saveStart = dashboard.indexOf("thumbnail:durableImageUrl(document.getElementById('qpl-edit-image-url')");
assert(saveStart >= 0, 'the inventory save object must sanitize the thumbnail field');
const saveSlice = dashboard.slice(saveStart, saveStart + 600);
assert.match(saveSlice, /imageUrl:durableImageUrl\(document\.getElementById\('qpl-edit-image-url'\)\?\.value\.trim\(\)\) \|\| \(isComic&&r\.userPhotoBlobKey \? r\.externalCoverImageUrl\|\|'' : durableImageUrl\(r\.imageUrl\)\)/,
  'the inventory save object must sanitize the imageUrl field the same way');

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

console.log('Blob-URL image persistence checks passed');
