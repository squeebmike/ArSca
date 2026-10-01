import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store report: adding a FOC book to inventory (RECEIVE SHIPMENT or a
// cover's + ADD TO INVENTORY -- both /foc/admin/receive) saved only the
// title, price and cover image. The FOC catalog already has the synopsis,
// writer, artists, cover artist, series, issue and release date.
const { focReceivedInventoryFields } = await import('../scripts/foc-preorders.mjs');
const fields = focReceivedInventoryFields(
  { description: 'BOO . . . FROM THE LAND OF OOO!', cover_artist: 'Sean Dove', writer: '', interior_artist: '', publisher: 'Oni Press', on_sale_date: '2026-09-30', upc: '64985600906700111', variant_label: 'Cover A', isbn: '' },
  { series_name: 'Adventure Time (2025)', issue_number: '1', writer: 'Jeremy Melloul', interior_artist: 'Adam Seats', description: 'family synopsis' },
);
assert.equal(fields.focComicDetail.description, 'BOO . . . FROM THE LAND OF OOO!', 'the cover row\'s own synopsis wins');
assert.deepEqual(fields.focComicDetail.writers, ['Jeremy Melloul'], 'writer falls back to the title family');
assert.deepEqual(fields.focComicDetail.artists, ['Adam Seats']);
assert.deepEqual(fields.focComicDetail.coverArtists, ['Sean Dove']);
assert.equal(fields.focComicDetail.seriesName, 'Adventure Time (2025)');
assert.equal(fields.focComicDetail.number, '1');
assert.equal(fields.focComicDetail.storeDate, '2026-09-30');
assert.equal(fields.series, 'Adventure Time (2025)');
assert.equal(fields.issue, '1');
assert.equal(fields.variant, 'Cover A');
assert.equal(fields.release_date, '2026-09-30');
assert.equal(fields.onSaleDate, '2026-09-30');
assert.equal(fields.year, '2026');
assert.deepEqual(focReceivedInventoryFields({ writer: 'A & B and C', cover_artist: 'D; E' }, null).focComicDetail.writers, ['A', 'B', 'C']);

const service = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const receiveSrc = service.match(/async function receiveShipment\(request,env,deps\)\{[\s\S]*?\n\}/)[0];
assert.match(receiveSrc, /comic_title_families\?id=\$\{inFilter\(familyIds\)\}&select=\*/, 'receiving loads each cover\'s title family');
assert.match(receiveSrc, /\.\.\.focReceivedInventoryFields\(sku,familyById\.get\(sku\.family_id\)\),/, 'the created inventory row carries the FOC comic details');
console.log('FOC receive saves comic details checks passed');

// The dashboard shows those details (list credits line, edit panel, search,
// eBay item specifics) when there's no Metron record.
const dash = fs.readFileSync('dashboard.html', 'utf8');
const start = dash.indexOf('function inventoryComicRecord(');
const end = dash.indexOf('function renderInventoryComicInfo(');
// Browser globals, so a top-level listener/timer that lands in this range
// of dashboard.html doesn't break a test that only reads the helpers.
const ctx = { escHtml: v => String(v), console, window:{ addEventListener(){}, postMessage(){} }, document:{ getElementById(){ return null; } }, setTimeout(){}, setInterval(){}, location:{ origin:'' } };
vm.createContext(ctx);
vm.runInContext(dash.slice(start, end), ctx);
const focItem = { name: 'ADVENTURE TIME HALLOWEEN SPECIAL #1', raw: { focComicDetail: fields.focComicDetail } };
assert.equal(ctx.inventoryComicPeopleLine(focItem), 'Writer: Jeremy Melloul · Artist: Adam Seats · Cover: Sean Dove');
assert.deepEqual([...ctx.comicCreditList(focItem, 'coverArtists')], ['Sean Dove']);
const panel = ctx.inventoryComicInfoHtml(focItem);
assert.match(panel, /FROM THE FOC CATALOG/);
assert.match(panel, /BOO \. \. \. FROM THE LAND OF OOO!/);
assert.match(panel, /<b>Series:<\/b> Adventure Time \(2025\) #1/);
assert.match(panel, /<b>Release date:<\/b> 2026-09-30/);
assert.ok(ctx.inventoryComicSearchFields(focItem).includes('Adventure Time (2025)'));
const metronItem = { comicMetadata: { writers: ['Lonnie Nadler'] }, raw: { focComicDetail: fields.focComicDetail } };
assert.equal(ctx.inventoryComicPeopleLine(metronItem), 'Writer: Lonnie Nadler', 'a Metron record still wins over FOC details');
assert.match(ctx.inventoryComicInfoHtml(metronItem), /SAVED COMIC RECORD/);
console.log('Dashboard FOC comic details display checks passed');
