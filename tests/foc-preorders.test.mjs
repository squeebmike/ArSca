import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { normalizePrhRow, loadAllCatalogs } from '../scripts/foc-preorders.mjs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const service = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const dashboard = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-08-17-foc-preorders.sql', 'utf8');

const representative = {
  MainIdentifier:'75960621456300121',
  UPC:'75960621456300121',
  TitleFamilyID:'852493',
  SeriesName:'Avengers',
  SeriesNumber:'1',
  Title:'AVENGERS #1 PRIMARY TITLE',
  PublisherName:'Marvel Comics',
  CoverArtist:'Russell Dauterman',
  FOCDate:'08/24/2026',
  OnSaleDate:'09/30/2026',
  PriceUSD:'$4.99',
  CoverLink:'https://example.com/avengers.jpg',
  CoverAvailable:'Yes',
};
const coverA = normalizePrhRow(representative);
assert.equal(coverA.distributorSku, '75960621456300121', '17-digit identifiers must remain exact strings');
assert.equal(coverA.upc, '75960621456300121');
assert.equal(coverA.distributorFamilyId, '852493');
assert.equal(coverA.variantLabel, 'Cover A', 'PRH Primary Title must be customer-facing Cover A');
assert.equal(coverA.focDate, '2026-08-24');
assert.equal(coverA.msrpCents, 499);
assert.equal(coverA.flags.firstIssue, true);

const incentive = normalizePrhRow({...representative, MainIdentifier:'75960621456300131', UPC:'75960621456300131', Title:'AVENGERS #1 JIM CHEUNG VARIANT', VariantType:'Incentive Variant', OrderRequirement:'1:50', CoverArtist:'Jim Cheung'});
assert.equal(incentive.distributorFamilyId, coverA.distributorFamilyId, 'cover variants must group under TitleFamilyID');
assert.equal(incentive.isIncentive, true);
assert.equal(incentive.ratioThreshold, 50);
assert.equal(incentive.flags.incentive, true);

const foil = normalizePrhRow({...representative, MainIdentifier:'75960621456300141', UPC:'75960621456300141', Title:'AVENGERS #1 FOIL VARIANT', VariantType:'Variant Title'});
assert.equal(foil.flags.foil, true, 'foil covers must be explicitly identified for pricing and filtering');

assert.match(migration, /America\/Los_Angeles/);
assert.match(migration, /p_foc_date::timestamp \+ interval '1 minute'/, 'default cutoff must be 12:01 AM Monday Pacific');
assert.match(migration, /revoke all[\s\S]+from anon/i, 'raw preorder tables must not be anonymous');
assert.match(worker, /handleFocRequest/);
assert.match(service, /Choose a live carrier shipping rate/);
assert.match(service, /ShippoToken/);
assert.match(service, /waitlist-only until the store secures more copies/);
assert.match(service, /p\.isIncentive \|\| p\.flags\.foil/, 'new foils and ratio incentives must import without a guessed selling price');
assert.match(service, /hadCustomPrice/, 'staff selling-price overrides must survive PRH re-imports');
assert.match(service, /customer_price_cents \|\| 0/, 'checkout must never fall back from an unset selling price to distributor MSRP');
assert.match(service, /metadata\[source\].*foc_preorder/s);
assert.match(dashboard, /THE FOC WALL/i);

// ── Bug: a real PRH FOC metadata CSV import failed with "289 row(s) are
// missing an exact identifier, title, or FOC date" -- on EVERY row, despite
// every row genuinely having all three. Root cause: SheetJS's CSV reader
// type-infers date-looking cells and reformats them to a locale short date
// (e.g. "08/31/2026" -> "8/31/26") unless read with raw:true, and the
// server's dateIso() parser requires a 4-digit year, so it silently
// rejected every single row. The same type-inference also rounds big
// numeric-looking identifier strings (17-digit UPCs) through float
// coercion, corrupting the exact identifier this importer depends on. ──
assert.match(dashboard, /XLSX\.read\(buffer,\{type:'array',raw:true\}\)/, 'the PRH FOC import must read the workbook with raw:true, or SheetJS silently reformats date cells (breaking every row\'s FOC date) and corrupts big numeric identifier strings through float rounding');
assert.doesNotMatch(dashboard, /XLSX\.read\(buffer,\{type:'array'\}\)/, 'the old raw-less read call must be gone, not just shadowed by a second one');

// ── Functional: reproduce the exact bug end-to-end against the real xlsx
// library (same version loaded from CDN in production), using the exact
// read options string extracted from the shipped source -- so this test
// actually breaks if the raw:true fix is ever reverted, instead of just
// asserting a string is present. ──
{
  const XLSX = (await import('xlsx')).default ?? await import('xlsx');
  const readOptsSrc = dashboard.match(/XLSX\.read\(buffer,(\{[^}]*\})\)/)?.[1];
  assert.ok(readOptsSrc, 'could not extract the XLSX.read() options object from scripts/foc-dashboard.js');
  const readOpts = new Function('return ' + readOptsSrc)();

  // A minimal PRH-shaped CSV: real column names, a date-looking FOCDate,
  // and a 17-digit UPC-like identifier long enough to lose precision if
  // SheetJS ever coerces it to a Number instead of keeping it a string.
  const csv = 'MainIdentifier,UPC,Title,FOCDate\n' +
    '75960621456300121,75960621456300121,AVENGERS #1 PRIMARY TITLE,08/31/2026\n';
  const buffer = Buffer.from(csv, 'utf8');
  const wb = XLSX.read(buffer, { ...readOpts, type:'buffer' }); // type:'buffer' swaps in for the browser's ArrayBuffer path; raw stays whatever the source specifies
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval:'', raw:false });
  assert.equal(rows[0].FOCDate, '08/31/2026', 'FOCDate must survive the read as the exact original string, not get reformatted to a 2-digit-year short date ("8/31/26") that the server\'s strict dateIso() parser then rejects');
  assert.equal(rows[0].MainIdentifier, '75960621456300121', 'a 17-digit identifier must survive the read as an exact string, not get coerced through a float and lose precision');
  const normalized = normalizePrhRow(rows[0]);
  assert.ok(normalized.distributorSku && normalized.upc && normalized.focDate && normalized.title, 'the row must pass the server\'s import validation now (all four required fields present) -- this is the exact check that failed on all 289 rows before the fix');
}

console.log('PRH FOC CSV date/identifier reformatting fix (real xlsx library) verified.');

// ── Bug: the customer-facing preorder page can only ever show ONE FOC
// week -- loadCatalog() always fetches just the single most recent cycle.
// A new Monday import doesn't delete the prior week from the database (the
// dashboard's FOC Wall still lists both), but the live site had no way to
// ask for anything but "the latest one", so from a customer's perspective
// older weeks just vanished the moment a new week was imported. ──
assert.match(service, /export async function loadAllCatalogs\(db, storeId, includeAdmin = false\) \{/, 'loadAllCatalogs must exist and be exported for the multi-week public route to use');
assert.match(service, /status=neq\.archived&order=foc_date\.desc&limit=26/, 'loadAllCatalogs must fetch multiple non-archived cycles, not just the single latest one');
assert.match(worker, /handleFocRequest/, 'sanity: the worker still wires up the FOC route handler');
assert.match(service, /if\(path==='\/public\/preorders\/weeks'&&request\.method==='GET'\)\{/, 'a public route to list every FOC week must exist alongside the existing single-week /public/preorders route');
assert.match(service, /const cycles=await loadAllCatalogs\(db,storeId,false\);return deps\.json\(\{ok:true,cycles\}\);/, 'the weeks route must return every open/closed cycle\'s catalog, not just the newest');

console.log('Multi-week FOC public route contract checks passed');

// ── Functional: loadAllCatalogs against a mock two-cycle store (the exact
// shape of the real bug report -- an Aug 31 and an Aug 24 cycle both open)
// -- confirms both weeks come back, newest first, each with only its own
// families/SKUs (no cross-week bleed), and that an archived third week is
// excluded. ──
{
  const cycleAug31 = { id:'cycle-aug31', store_id:'store1', distributor:'PRH', foc_date:'2026-08-31', customer_cutoff_at:'2026-08-31T07:01:00Z', status:'open' };
  const cycleAug24 = { id:'cycle-aug24', store_id:'store1', distributor:'PRH', foc_date:'2026-08-24', customer_cutoff_at:'2026-08-24T07:01:00Z', status:'open' };
  const familyAug31 = { id:'fam-aug31', cycle_id:'cycle-aug31', distributor_family_id:'f1', title:'Sabrina the Teenage Witch #1' };
  const familyAug24 = { id:'fam-aug24', cycle_id:'cycle-aug24', distributor_family_id:'f2', title:'Uncanny X-Men #36' };
  const skuAug31 = { id:'sku-aug31', family_id:'fam-aug31', cycle_id:'cycle-aug31', distributor_sku:'111', upc:'111', title:'Sabrina the Teenage Witch #1', variant_label:'Cover A', customer_price_cents:499 };
  const skuAug24 = { id:'sku-aug24', family_id:'fam-aug24', cycle_id:'cycle-aug24', distributor_sku:'222', upc:'222', title:'Uncanny X-Men #36', variant_label:'Cover A', customer_price_cents:499 };

  const db = async (path) => {
    if (path.startsWith('foc_cycles?')) {
      assert.ok(path.includes('status=neq.archived'), 'must exclude archived cycles at the query level');
      return { data:[cycleAug31, cycleAug24] }; // newest first, as order=foc_date.desc would return
    }
    if (path.startsWith('comic_title_families?cycle_id=eq.cycle-aug31')) return { data:[familyAug31] };
    if (path.startsWith('comic_title_families?cycle_id=eq.cycle-aug24')) return { data:[familyAug24] };
    if (path.startsWith('comic_skus?cycle_id=eq.cycle-aug31')) return { data:[skuAug31] };
    if (path.startsWith('comic_skus?cycle_id=eq.cycle-aug24')) return { data:[skuAug24] };
    if (path.startsWith('foc_preorder_orders?')) return { data:[] };
    throw new Error('unexpected db call: ' + path);
  };

  const cycles = await loadAllCatalogs(db, 'store1', false);
  assert.equal(cycles.length, 2, 'both open weeks must be returned, not just the newest');
  assert.equal(cycles[0].cycle.id, 'cycle-aug31', 'weeks must come back newest-first, matching the order cycles were fetched in');
  assert.equal(cycles[1].cycle.id, 'cycle-aug24', 'the older week must still be present, not dropped');
  assert.equal(cycles[0].families.length, 1);
  assert.equal(cycles[0].families[0].title, 'Sabrina the Teenage Witch #1', 'the Aug 31 week must only contain its own family, not the other week\'s');
  assert.equal(cycles[1].families[0].title, 'Uncanny X-Men #36', 'the Aug 24 week must only contain its own family, not the other week\'s');
  assert.equal(cycles[0].families[0].variants.length, 1);
  assert.equal(cycles[0].families[0].variants[0].sku, '111', 'each week\'s SKUs must stay scoped to that week\'s cycle_id, not merge across weeks');
}

console.log('loadAllCatalogs multi-week functional checks passed');

// On the store workstation, also validate the full supplied PRH export. CI
// remains deterministic when that private distributor file is absent.
const actualPath = 'C:/Users/Sales/Downloads/2026-08-24_PRH_FOC_metadata_full (1).csv';
if (fs.existsSync(actualPath)) {
  const rows = parse(fs.readFileSync(actualPath), { columns:true, bom:true, skip_empty_lines:true, relax_column_count:true });
  const normalized = rows.map(normalizePrhRow);
  assert.equal(rows.length, 249, 'the supplied FOC file should contain 249 products');
  assert.equal(new Set(normalized.map(row => row.distributorFamilyId)).size, 133, 'the supplied file should group into 133 title families');
  assert.equal(normalized.filter(row => row.isIncentive).length, 32, 'the supplied file should contain 32 ratio incentives');
  assert.ok(normalized.every(row => typeof row.distributorSku === 'string' && /^(?:\d{13}|\d{17})$/.test(row.distributorSku)), 'all supplied UPC/ISBN identifiers must remain exact digit strings');
  const avengers = normalized.filter(row => row.distributorFamilyId === '852493');
  assert.ok(avengers.length >= 8, 'Avengers #1 covers should share one stable family');
  assert.ok(avengers.some(row => row.variantLabel === 'Cover A'));
  assert.deepEqual(avengers.filter(row => row.isIncentive).map(row => row.ratioThreshold).sort((a,b)=>a-b), [25,50,100,200]);
}

console.log('FOC preorder normalization, security, checkout, and real-rate shipping contracts passed.');
