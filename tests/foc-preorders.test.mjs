import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { normalizePrhRow } from '../scripts/foc-preorders.mjs';

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
