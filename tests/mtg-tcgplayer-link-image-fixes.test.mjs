import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report: MTG cards (and every other non-Pokemon game -- Yu-Gi-Oh,
// Lorcana, One Piece, sports, comics) could never save a TCGplayer
// reference that needed "verification" -- inventoryTcgReferencePatch()
// gated the save behind verifyInventoryTcgplayerReference(), which only
// ever calls Pokemon-specific product-lookup APIs (PokemonPriceTracker /
// sealed product exact-match). That call can never succeed for a non-
// Pokemon product, so any add/edit whose parsed TCGplayer id didn't
// already match the trusted original id permanently failed with "Verify
// the changed TCGplayer product before saving." -- with no way to
// satisfy it. Fixed by only requiring that Pokemon-only verification for
// Pokemon TCG items; every other category trusts the parsed id as-is,
// same as this app already does everywhere else it has no verification
// API to call.
const patchStart = html.indexOf('async function inventoryTcgReferencePatch(item = {}){');
const patchEnd = html.indexOf('\n\n', html.indexOf('externalRefs:{ ...(item.externalRefs || {}), tcgPlayerId:id, tcgplayerProductId:id, tcgPlayerUrl:url },', patchStart));
const patchBody = html.slice(patchStart, patchEnd);

assert.ok(patchStart !== -1, 'inventoryTcgReferencePatch must exist');
assert.match(patchBody, /const category = document\.getElementById\('edit-category'\)\?\.value \|\| item\.category \|\| '';/,
  'must know the item\'s category to decide whether Pokemon-only verification even applies');
assert.match(patchBody, /const isPokemonCategory = category === 'Pokemon TCG';/,
  'must gate the verification requirement on being a Pokemon TCG item specifically');
assert.match(patchBody, /if\(isPokemonCategory && !verified && id !== inventoryTcgReferenceState\.originalId\) verified = await verifyInventoryTcgplayerReference\(\);/,
  'must only attempt the Pokemon-only verification call for Pokemon items');
assert.match(patchBody, /if\(isPokemonCategory && !verified && id !== inventoryTcgReferenceState\.originalId\) throw new Error\('Verify the changed TCGplayer product before saving\.'\);/,
  'must only block the save on missing verification for Pokemon items -- every other category has no verification API to satisfy');
assert.match(patchBody, /const url = verified\?\.url \|\| item\.tcgPlayerUrl \|\| item\.tcgUrl \|\| 'https:\/\/www\.tcgplayer\.com\/product\/' \+ id;/,
  'must fall back to item.tcgUrl (the field name some result rows only ever set) before reconstructing a generic product URL from the bare id');

// Store report: the main universal search's Scryfall row builder
// (fetchScryfallCatalog, used by Quick Lookup for MTG cards outside the
// dedicated Set Browser) only ever set tcgUrl, never tcgPlayerUrl -- its
// sibling row builder (scryfallCardToQplRow, used by the MTG Set Browser)
// always sets both. Most downstream consumers do fall back from
// tcgPlayerUrl to tcgUrl, but not every one does (inventoryTcgReferencePatch
// itself didn't, before the fix above), so a card found via the main
// search could still lose its TCGplayer link at whichever read site
// forgot the fallback. Setting both at the source removes the whole class
// of "which fallback chain does this particular read site have" bugs.
const catalogRowStart = html.indexOf("priceSource:'Scryfall market',\n      tcgUrl:c.purchase_uris?.tcgplayer");
assert.ok(catalogRowStart !== -1, 'fetchScryfallCatalog\'s Scryfall row builder must exist');
const catalogRowSnippet = html.slice(catalogRowStart, catalogRowStart + 400);
assert.match(catalogRowSnippet, /tcgPlayerUrl:c\.purchase_uris\?\.tcgplayer \|\| \(c\.tcgplayer_id \? 'https:\/\/www\.tcgplayer\.com\/product\/' \+ encodeURIComponent\(c\.tcgplayer_id\) : ''\) \|\| c\.scryfall_uri \|\| '',/,
  'the universal-search Scryfall row must set tcgPlayerUrl the same way its Set Browser sibling (scryfallCardToQplRow) already does, not just tcgUrl');

// Store report: a card's cover image wasn't sticking when added through
// the Buy tray -- buyItemToInventoryUpdates() only ever wrote image/images,
// never imageUrl/thumbnail, which is the field name inventoryImageUrl()
// and every edit/display path check FIRST. The image/images fallback at
// the bottom of that chain does eventually pick it up once the row is
// reloaded fresh from Supabase (mapBuiltInItem falls back to d.image),
// but not before that reload, and not every read path has that same
// fallback -- so the image was inconsistently missing depending on
// exactly when/where it was displayed.
const buyUpdatesStart = html.indexOf('function buyItemToInventoryUpdates(item){');
const buyUpdatesEnd = html.indexOf('\n\nlet buyInventoryFinalizing', buyUpdatesStart);
const buyUpdatesBody = html.slice(buyUpdatesStart, buyUpdatesEnd);
assert.ok(buyUpdatesStart !== -1, 'buyItemToInventoryUpdates must exist');
assert.match(buyUpdatesBody, /imageUrl:item\.imageUrl \|\| item\.images\?\.\[0\] \|\| '',/,
  'must set imageUrl explicitly, not rely on every read path falling back to image/images');
assert.match(buyUpdatesBody, /thumbnail:item\.imageUrl \|\| item\.images\?\.\[0\] \|\| '',/,
  'must set thumbnail explicitly too, since that is the first field inventoryImageUrl() checks');
assert.match(buyUpdatesBody, /image:item\.imageUrl \|\| item\.images\?\.\[0\] \|\| '',/,
  'must keep setting image/images as well for back-compat with anything still keying off them');

console.log('MTG TCGplayer-link and buy-tray image fix contract checks passed');
