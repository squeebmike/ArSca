import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// New "Reports" tab (sales tax owed / P&L / year-end CSV export) --
// dashboard.html:6271 already had a roadmap comment calling this out as
// "not built yet." Guards the nav wiring so it doesn't silently regress:
// present in the MORE_TABS menu, gated to the same plan capability as
// Sales, and NOT in the employee tab whitelist (owner/admin/manager only,
// matching how the Sales tab itself is gated).

assert.match(html, /\['reports', 'REPORTS'\]/, 'REPORTS must be registered in MORE_TABS or it never appears in the nav menu');

assert.match(html, /const TAB_CAPABILITY = \{[^}]*\breports:'sales'/,
  'reports must have a TAB_CAPABILITY entry (reusing the sales capability) or planCanAccessTab silently blocks it for every plan');

{
  const employeeMatch = html.match(/else if\(role === 'employee'\) allowed = \[([^\]]*)\]\.includes\(tab\);/);
  assert.ok(employeeMatch, 'could not find the employee tab whitelist in roleCanAccessTab');
  const employeeTabs = employeeMatch[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.ok(!employeeTabs.includes('reports'),
    'reports must NOT be in the employee whitelist -- this is a financial report and should stay owner/admin/manager only, same as the sales tab');
}

assert.match(html, /if\(name === 'reports'\) setTimeout\(ensureReportsPanel, 0\);/,
  'switchTab must lazy-init the panel on first visit, or the tab renders empty');

assert.match(html, /<div id="tab-reports" class="tab-panel">/, 'the tab-reports static container must exist for switchTab to toggle .on against');

for (const fn of ['ensureReportsPanel', 'renderReportsPanel', 'runReportsQuery', 'aggregateReportsData', 'renderReportsResults', 'exportReportsCSV', 'setReportsRangePreset']) {
  assert.ok(html.includes(`function ${fn}(`) || html.includes(`async function ${fn}(`),
    `missing expected Reports function: ${fn}`);
}

// Must read from Supabase pos_sales/pos_sale_lines directly, not the local
// pos_transactions cache (which has no tax_total, caps at 1000 rows, and
// never purges voided sales) -- and must exclude voided sales.
{
  const fnStart = html.indexOf('async function runReportsQuery(');
  assert.ok(fnStart !== -1, 'runReportsQuery not found');
  const fnEnd = html.indexOf('\nfunction aggregateReportsData', fnStart);
  const fnBody = html.slice(fnStart, fnEnd === -1 ? fnStart + 4000 : fnEnd);
  assert.match(fnBody, /sb\.from\('pos_sales'\)/, 'must query pos_sales directly via the Supabase client');
  assert.match(fnBody, /\.in\('status', \['completed','succeeded'\]\)/, 'must filter to completed/succeeded sales, excluding voids, same as syncSharedShowTransactions');
  assert.match(fnBody, /sb\.from\('pos_sale_lines'\)/, 'must query pos_sale_lines directly for COGS/taxable breakdown');
}

console.log('Reports panel wiring contract checks passed');
