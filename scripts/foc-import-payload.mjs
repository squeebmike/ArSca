import fs from 'node:fs';
import crypto from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { normalizePrhRow } from './foc-preorders.mjs';

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Usage: node scripts/foc-import-payload.mjs <prh.csv>');

const source = fs.readFileSync(sourcePath);
const rows = parse(source, { columns:true, bom:true, skip_empty_lines:true, relax_column_count:true });
const normalized = rows.map((row, index) => ({ row, line:index + 2, parsed:normalizePrhRow(row) }));
const invalid = normalized.filter(entry => !entry.parsed.distributorSku || !entry.parsed.upc || !entry.parsed.focDate || !entry.parsed.title);
if (invalid.length) throw new Error(`Invalid PRH rows: ${invalid.slice(0,20).map(entry => entry.line).join(', ')}`);
const focDates = [...new Set(normalized.map(entry => entry.parsed.focDate))];
if (focDates.length !== 1) throw new Error(`Expected one FOC date, found: ${focDates.join(', ')}`);

const families = new Map();
for (const { parsed:p } of normalized) {
  if (!families.has(p.distributorFamilyId)) families.set(p.distributorFamilyId, {
    distributor_family_id:p.distributorFamilyId,
    title:p.title,
    series_name:p.seriesName || null,
    issue_number:p.issueNumber || null,
    publisher:p.publisher || null,
    imprint:p.imprint || null,
    comic_type:p.comicType || null,
    description:p.description || null,
    writer:p.writer || null,
    interior_artist:p.interiorArtist || null,
    on_sale_date:p.onSaleDate,
    is_first_issue:p.issueNumber === '1',
    is_new_series:!!p.flags.newSeries,
  });
}

const skus = normalized.map(({ row, parsed:p }) => ({
  distributor_family_id:p.distributorFamilyId,
  distributor_sku:p.distributorSku,
  upc:p.upc,
  isbn:p.isbn || null,
  title:p.sourceTitle || p.title,
  subtitle:p.subtitle || null,
  variant_label:p.variantLabel || null,
  variant_type:p.variantType || null,
  order_requirement:p.orderRequirement || null,
  order_requirement_upc:p.orderRequirementUpc || null,
  ratio_threshold:p.ratioThreshold,
  is_incentive:p.isIncentive,
  cover_artist:p.coverArtist || null,
  cover_image_url:p.coverImageUrl || null,
  cover_available:p.coverAvailable,
  writer:p.writer || null,
  interior_artist:p.interiorArtist || null,
  publisher:p.publisher || null,
  imprint:p.imprint || null,
  description:p.description || null,
  foc_date:p.focDate,
  on_sale_date:p.onSaleDate,
  msrp_cents:p.msrpCents,
  customer_price_cents:p.msrpCents,
  raw_distributor_data:row,
  row_sha256:crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex'),
  flags:p.flags,
}));

const payload = {
  focDate:focDates[0],
  sourceFilename:sourcePath.replace(/^.*[\\/]/, ''),
  sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),
  sourceRowCount:rows.length,
  report:{processed:rows.length,families:families.size,newSkus:rows.length,updatedSkus:0,unchanged:0,errors:0,incentives:skus.filter(row => row.is_incentive).length},
  families:[...families.values()],
  skus,
};

const mode = process.argv[3] || 'all';
if (mode === 'summary') process.stdout.write(JSON.stringify({ ...payload, families:undefined, skus:undefined }));
else if (mode === 'families') process.stdout.write(JSON.stringify(payload.families));
else if (mode === 'skus') {
  const offset = Math.max(0, Number(process.argv[4] || 0));
  const limit = Math.min(100, Math.max(1, Number(process.argv[5] || 40)));
  process.stdout.write(JSON.stringify(payload.skus.slice(offset, offset + limit)));
} else process.stdout.write(JSON.stringify(payload));
