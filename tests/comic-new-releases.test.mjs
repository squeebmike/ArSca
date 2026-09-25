import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleFocRequest, mondayOfWeekContaining, currentReleaseWeekStart } from '../scripts/foc-preorders.mjs';

const service = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');

// --- Week-boundary math ------------------------------------------------------
// New comic book day is a national Wednesday street date anchored to Eastern
// time -- these check the plain calendar-date math (Monday-of-week, and
// "what week does Eastern 'now' fall in") independent of the machine's own
// local timezone.

assert.equal(mondayOfWeekContaining('2026-09-28'), '2026-09-28', 'a Monday is its own week start');
assert.equal(mondayOfWeekContaining('2026-10-01'), '2026-09-28', 'a Thursday belongs to that week\'s Monday');
assert.equal(mondayOfWeekContaining('2026-10-04'), '2026-09-28', 'a Sunday belongs to the Monday that started it, not the next one');
assert.equal(mondayOfWeekContaining('2026-01-01'), '2025-12-29', 'a week can span a year boundary');

// A UTC instant late enough in the day that naive local-time handling on a
// machine west of Eastern could roll it back a calendar day -- the Eastern
// calendar date must still come out as the correct Wednesday.
const lateUtcWednesday = new Date('2026-10-01T03:30:00Z'); // 2026-09-30T23:30 Eastern (EDT, UTC-4)
assert.equal(currentReleaseWeekStart(lateUtcWednesday), '2026-09-28', 'must read "now" as an Eastern calendar date, not the raw UTC date');

console.log('Comic new-release week-boundary math checks passed');

// --- Route wiring -------------------------------------------------------------

assert.match(service, /\/public\/comics\/new-releases/, 'new-releases route must be reachable inside handleFocRequest\'s own router');

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /\/comic-new-releases-the-mana-pocket/, 'the real Webflow page URL must be listed in sitemap-pages.xml');

// handleFocRequest's own internal router isn't enough on its own -- the
// top-level Worker dispatcher decides which paths ever reach it at all
// (matched live: this route 404'd in production because it was added to
// handleFocRequest's router but never added to this dispatcher condition,
// so every request fell through to the Worker's generic "Not found").
const dispatchMatch = worker.match(/if \(url\.pathname === '\/public\/preorders'[\s\S]{0,400}?return await handleFocRequest/);
assert.ok(dispatchMatch, 'must find the dispatcher condition that forwards requests to handleFocRequest');
assert.match(dispatchMatch[0], /\/public\/comics\/new-releases/, 'the top-level Worker dispatcher must actually forward /public/comics/new-releases to handleFocRequest, not just handleFocRequest\'s own internal router');

// --- Catalog endpoint ---------------------------------------------------------

const storeId = 'store-1';
const familyOngoing = { id:'fam-1', series_name:'Avengers', title:'Avengers', issue_number:'1', writer:'Jed MacKay', comic_type:'Ongoing', description:'A synopsis.' };
const familyGraphicNovel = { id:'fam-2', series_name:'Some Collection', title:'Some Collection Vol. 1', comic_type:'SOFTCOVER', description:'A collection.' };
const familyMerch = { id:'fam-3', series_name:'Fourth Wing Tote', title:'Fourth Wing Tote Bag', comic_type:null };

const skuOpenCycle = {
  id:'sku-open', family_id:'fam-1', cycle_id:'cycle-open', distributor:'PRH', distributor_sku:'AVG1A',
  upc:'759600000001', title:'Avengers #1', variant_label:'Cover A', variant_type:'Primary Title',
  cover_artist:'Russell Dauterman', cover_image_url:'https://example.com/avg1a.jpg', flags:{},
  on_sale_date:'2026-10-01', customer_price_cents:499, is_incentive:false, customer_enabled:true, description:'',
};
const skuInStock = {
  id:'sku-stock', family_id:'fam-1', cycle_id:'cycle-closed', distributor:'PRH', distributor_sku:'AVG1B',
  upc:'759600000002', title:'Avengers #1', variant_label:'Cover B', variant_type:'Variant Title',
  cover_artist:'Jim Cheung', cover_image_url:'https://example.com/avg1b.jpg', flags:{ foil:true },
  on_sale_date:'2026-10-01', customer_price_cents:699, is_incentive:false, customer_enabled:true, description:'',
};
const skuBacklist = {
  id:'sku-backlist', family_id:'fam-1', cycle_id:'cycle-closed', distributor:'PRH', distributor_sku:'AVG1C',
  upc:'759600000003', title:'Avengers #1', variant_label:'Cover C', variant_type:'Variant Title',
  cover_artist:'Alex Ross', cover_image_url:'https://example.com/avg1c.jpg', flags:{},
  on_sale_date:'2026-10-01', customer_price_cents:899, is_incentive:false, customer_enabled:true, description:'',
};
const skuNoMatch = {
  id:'sku-none', family_id:'fam-1', cycle_id:'cycle-closed', distributor:'PRH', distributor_sku:'AVG1D',
  upc:'759600000004', title:'Avengers #1', variant_label:'Cover D', variant_type:'Variant Title',
  cover_artist:'TBA', cover_image_url:'', flags:{},
  on_sale_date:'2026-10-01', customer_price_cents:0, is_incentive:true, ratio_threshold:25, customer_enabled:true, description:'',
};
const skuGraphicNovel = { id:'sku-gn', family_id:'fam-2', cycle_id:'cycle-closed', distributor:'PRH', upc:'759600000005', title:'Some Collection Vol. 1', variant_label:'Cover A', customer_enabled:true, on_sale_date:'2026-10-01', customer_price_cents:1999 };
const skuMerch = { id:'sku-merch', family_id:'fam-3', cycle_id:'cycle-closed', distributor:'PRH', upc:'759600000006', title:'Fourth Wing Tote Bag', variant_label:'Cover A', customer_enabled:true, on_sale_date:'2026-10-01', customer_price_cents:2000 };

function depsFor(rows) {
  return {
    json:(data, status = 200) => ({ status, data }),
    publicStoreId: storeId,
    supabaseAdminFetch: async (env, path) => {
      if (path.startsWith('comic_skus?')) return { data: rows.skus };
      if (path.startsWith('comic_title_families?')) return { data: rows.families };
      if (path.startsWith('foc_cycles?')) return { data: rows.cycles };
      if (path.startsWith('inventory_items?') && path.includes('data->>upc')) return { data: rows.invByUpc || [] };
      if (path.startsWith('inventory_items?') && path.includes('data->>barcode')) return { data: rows.invByBarcode || [] };
      if (path.startsWith('backlist_skus?') && path.includes('&upc=')) return { data: rows.backlistByUpc || [] };
      if (path.startsWith('backlist_skus?') && path.includes('&isbn=')) return { data: rows.backlistByIsbn || [] };
      return { data: [] };
    },
    addBusinessDays: (date) => date,
  };
}

{
  const deps = depsFor({
    skus: [skuOpenCycle, skuInStock, skuBacklist, skuNoMatch, skuGraphicNovel, skuMerch],
    families: [familyOngoing, familyGraphicNovel, familyMerch],
    cycles: [
      { id:'cycle-open', status:'open', customer_cutoff_at:new Date(Date.now() + 3600000).toISOString() },
      { id:'cycle-closed', status:'open', customer_cutoff_at:new Date(Date.now() - 3600000).toISOString() },
    ],
    invByBarcode: [{ id:'inv-1', status:'in_stock', data:{ barcode:'759600000002' } }],
    backlistByUpc: [{ id:'bl-1', upc:'759600000003', title_id:'title-1' }],
  });
  const res = await handleFocRequest({ method:'GET' }, {}, new URL(`https://x/public/comics/new-releases?store_id=${storeId}&week=2026-09-28`), deps);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.weekStart, '2026-09-28');
  assert.equal(res.data.weekEndExclusive, '2026-10-05');
  const covers = res.data.covers;

  assert.equal(covers.some(c => c.id === 'sku-gn'), false, 'a SOFTCOVER collection must not appear -- this is single-issue periodicals only');
  assert.equal(covers.some(c => c.id === 'sku-merch'), false, 'a merch item with no comic_type must not appear');
  assert.equal(covers.length, 4, 'only the four real periodical covers should remain');

  const byId = Object.fromEntries(covers.map(c => [c.id, c]));
  assert.equal(byId['sku-open'].linkType, 'preorder', 'a cover still inside an open FOC cycle must link to the preorder page');
  assert.equal(byId['sku-open'].linkHref, '/preorders?sku=sku-open');
  assert.equal(byId['sku-stock'].linkType, 'shop', 'a cover with a real in-stock inventory match must link into the shop');
  assert.equal(byId['sku-stock'].linkHref, '/shop?item=inv-1');
  assert.equal(byId['sku-backlist'].linkType, 'backlist', 'a cover PRH can still reorder as backlist must link to /books');
  assert.equal(byId['sku-none'].linkType, null, 'a cover with no open cycle, no stock, and no backlist match must have no link');
  assert.equal(byId['sku-none'].linkHref, null);

  // Whatnot-show info fields must be present without any click.
  assert.equal(byId['sku-stock'].coverArtist, 'Jim Cheung');
  assert.equal(byId['sku-none'].ratioThreshold, 25);
  assert.equal(byId['sku-none'].isIncentive, true);
  assert.equal(byId['sku-open'].seriesName, 'Avengers');
  assert.equal(byId['sku-open'].issueNumber, '1');
}

{
  // A sold/archived inventory row must never be offered as "in stock."
  const deps = depsFor({
    skus: [skuInStock], families: [familyOngoing], cycles: [{ id:'cycle-closed', status:'open', customer_cutoff_at:new Date(Date.now() - 3600000).toISOString() }],
    invByBarcode: [{ id:'inv-sold', status:'sold', data:{ barcode:'759600000002' } }],
  });
  const res = await handleFocRequest({ method:'GET' }, {}, new URL(`https://x/public/comics/new-releases?store_id=${storeId}&week=2026-09-28`), deps);
  assert.equal(res.data.covers[0].linkType, null, 'a sold-out inventory row must not be treated as purchasable');
}

// --- Lunar periodical filtering (distributor-branched signal) -----------------
// Lunar's own comic_type column is populated from CoverType, a paper-stock
// attribute -- every Lunar row is just SOFTCOVER/HARDCOVER regardless of
// whether it's a real single issue or a collected edition, so it can't be
// used to find periodicals for Lunar the way it can for PRH. issue_number
// (parsed from a "#123" pattern in the title) is the reliable signal there.
{
  const familyLunarIssue = { id:'fam-l1', series_name:'Radiant Black', title:'Radiant Black #25', issue_number:'25', writer:'Kyle Higgins', comic_type:'SOFTCOVER', description:'A synopsis.' };
  const familyLunarCollection = { id:'fam-l2', series_name:'Radiant Black', title:'Radiant Black TP Vol 01', issue_number:null, comic_type:'SOFTCOVER', description:'A collection.' };
  const skuLunarIssue = {
    id:'sku-lunar-issue', family_id:'fam-l1', cycle_id:'cycle-open', distributor:'Lunar', distributor_sku:'RB25',
    upc:'850000000001', title:'Radiant Black #25', variant_label:'Cover A', variant_type:'Primary Title',
    cover_artist:'Marcelo Costa', cover_image_url:'https://example.com/rb25.jpg', flags:{},
    on_sale_date:'2026-10-01', customer_price_cents:399, is_incentive:false, customer_enabled:true, description:'',
  };
  const skuLunarCollection = {
    id:'sku-lunar-collection', family_id:'fam-l2', cycle_id:'cycle-open', distributor:'Lunar', distributor_sku:'RBV1',
    upc:'850000000002', title:'Radiant Black TP Vol 01', variant_label:'Cover A', customer_enabled:true,
    on_sale_date:'2026-10-01', customer_price_cents:1699, description:'',
  };
  const deps = depsFor({
    skus: [skuLunarIssue, skuLunarCollection],
    families: [familyLunarIssue, familyLunarCollection],
    cycles: [{ id:'cycle-open', status:'open', customer_cutoff_at:new Date(Date.now() + 3600000).toISOString() }],
  });
  const res = await handleFocRequest({ method:'GET' }, {}, new URL(`https://x/public/comics/new-releases?store_id=${storeId}&week=2026-09-28&distributor=Lunar`), deps);
  assert.equal(res.data.distributor, 'Lunar');
  assert.equal(res.data.covers.some(c => c.id === 'sku-lunar-issue'), true, 'a Lunar single issue (has issue_number) must appear even though comic_type is mislabeled SOFTCOVER');
  assert.equal(res.data.covers.some(c => c.id === 'sku-lunar-collection'), false, 'a Lunar collection (no issue_number) must not appear, regardless of comic_type');
}

console.log('Comic new-releases catalog endpoint checks passed');
