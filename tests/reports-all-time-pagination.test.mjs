import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report: "we need sales data going back to day 1." The Reports
// tab's pos_sales query had no .limit() and no pagination -- fine for a
// short date range, but for an ALL TIME report (or any range spanning
// more than one page of results) it silently relied on whatever the
// Supabase project's default max-rows happens to be, truncating history
// without any error. This guards the fix: paginate with .range() until a
// short page comes back, so every sale in the selected range is counted.

const fnStart = html.indexOf('async function runReportsQuery');
const fnEnd = html.indexOf('\n    const saleMap = new Map', fnStart);
const fnBody = html.slice(fnStart, fnEnd);

assert.ok(fnStart !== -1, 'runReportsQuery must exist');
assert.match(fnBody, /for\(let offset = 0; ; offset \+= 1000\)\{/, 'must loop across pages, not fetch once');
assert.match(fnBody, /\.range\(offset, offset \+ 999\)/, 'must page through pos_sales with .range(), not rely on the server default row cap');
assert.match(fnBody, /saleRows\.push\(\.\.\.\(pageRows \|\| \[\]\)\);/, 'must accumulate every page into the full result set');
assert.match(fnBody, /if\(!pageRows \|\| pageRows\.length < 1000\) break;/, 'must stop once a short page confirms there is nothing left, not loop forever');
assert.doesNotMatch(fnBody, /\.select\('id,subtotal,discount_total,tax_total,total,status,completed_at'\)\s*\n\s*\.eq\('store_id', storeId\)\s*\n\s*\.in\('status', \['completed','succeeded'\]\)\s*\n\s*\.gte\('completed_at', fromISO\)\s*\n\s*\.lte\('completed_at', toISO\)\s*\n\s*\.order\('completed_at', \{ascending:true\}\);/,
  'the old single-shot (no .range()) query must be gone, not left dangling as dead code alongside the paginated version');

// The ALL TIME preset and Year grouping that make day-1 data practical to
// look at (a multi-year range grouped by month would be unusably long).
assert.match(html, /else if\(preset === 'all_time'\)\{/, 'ALL TIME preset must exist');
assert.match(html, /onclick="setReportsRangePreset\('all_time'\)">ALL TIME</, 'ALL TIME button must be wired up');
assert.match(html, /if\(groupBy === 'year'\) return `\$\{d\.getFullYear\(\)\}`;/, 'Year grouping must exist for reportsPeriodKey, or an all-time range has no practical way to group its output');
assert.match(html, /<option value="year">Year<\/option>/, 'Year must be a selectable Group By option');

console.log('Reports ALL TIME pagination contract check passed');
