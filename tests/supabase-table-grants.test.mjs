import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Supabase notice (effective 2026-10-30): tables created in "public" no
// longer get Data API access automatically -- supabase-js (the dashboard,
// as `authenticated`), PostgREST and the Worker (`service_role`) all get
// "permission denied" until the migration GRANTs it. Tables that already
// exist keep their grants. So every migration written from now on that
// creates a public table must grant it in the same file. Files that existed
// before the change are listed below and left alone.
const GRANDFATHERED = new Set(["supabase-migrations/2026-06-store-tenant-rls.sql", "supabase-migrations/2026-07-14-atomic-pos-sale.sql", "supabase-migrations/2026-07-15-retire-topps-catalog-after-r2.sql", "supabase-migrations/2026-07-16-verify-store-sales.sql", "supabase-migrations/2026-07-23-storefront-orders.sql", "supabase-migrations/2026-08-10-customers-loyalty-gift-cards.sql", "supabase-migrations/2026-08-11-tournament-events.sql", "supabase-migrations/2026-08-12-pull-lists.sql", "supabase-migrations/2026-08-12-tournament-features.sql", "supabase-migrations/2026-08-13-pull-list-issue-detail.sql", "supabase-migrations/2026-08-13-pull-list-metron-link.sql", "supabase-migrations/2026-08-14-pull-list-upc.sql", "supabase-migrations/2026-08-15-tournament-round-timer.sql", "supabase-migrations/2026-08-16-buylist-submissions.sql", "supabase-migrations/2026-08-16-consignor-stripe-payouts.sql", "supabase-migrations/2026-08-16-grading-submissions.sql", "supabase-migrations/2026-08-17-foc-preorders-policy-tuning.sql", "supabase-migrations/2026-08-17-foc-preorders.sql", "supabase-migrations/2026-08-18-customer-web-accounts.sql", "supabase-migrations/2026-08-19-email-notify-contacts.sql", "supabase-migrations/2026-08-19-fan-club-subscribers.sql", "supabase-migrations/2026-08-19-phone-system.sql", "supabase-migrations/2026-08-19-sms-compliance.sql", "supabase-migrations/2026-08-20-lock-down-contact-tables.sql", "supabase-migrations/2026-08-20-phone-voicemail-business-hours.sql", "supabase-migrations/2026-08-20-revoke-self-signup-store-creation.sql", "supabase-migrations/2026-08-24-foc-order-confirmation-email-status.sql", "supabase-migrations/2026-08-24-price-change-alerts.sql", "supabase-migrations/2026-08-26-foc-safety-stock-and-prh-lock.sql", "supabase-migrations/2026-08-27-repair-foc-presale-inventory-status.sql", "supabase-migrations/2026-08-31-pos-sale-line-taxable.sql", "supabase-migrations/2026-09-08-card-intake.sql", "supabase-migrations/2026-09-08-storefront-notify-requests.sql", "supabase-migrations/2026-09-08-whatnot-shows-intelligence.sql", "supabase-migrations/2026-09-08-whatnot-shows.sql", "supabase-migrations/2026-09-09-daily-task-assignment.sql", "supabase-migrations/2026-09-10-daily-task-cadence-and-reassign.sql", "supabase-migrations/2026-09-19-backlist-catalog.sql", "supabase-migrations/2026-09-20-backlist-featured-shelves.sql", "supabase-migrations/2026-09-20-backlist-picks.sql", "supabase-migrations/2026-09-24-storefront-review-requests.sql", "supabase-migrations/2026-09-26-web-order-loyalty.sql", "supabase-migrations/2026-09-27-database-safe-edits.sql", "supabase-migrations/2026-09-27-web-points-redemption.sql", "supabase-migrations/2026-09-29-backlist-shelf-indexes.sql", "supabase-migrations/2026-10-02-book-alerts.sql", "supabase-migrations/2026-10-02-whatnot-show-report-summary.sql", "supabase-migrations/2026-10-04-store-expenses.sql", "supabase-migrations/2026-10-15-scan-sessions-unlink-on-delete.sql", "supabase-migrations/STEP1-backfill.sql", "supabase-migrations/STEP2-enable-rls.sql", "supabase/auth-user-delete-safety.sql", "supabase/migrations/20260824203612_foc_shippo_shipping_labels.sql", "supabase/migrations/20261009233000_scan_queue_rls_once_per_query.sql", "supabase/platform-admin-support.sql", "supabase/pos-money-ledger.sql", "supabase/price-change-alerts.sql", "supabase/seed.sql", "supabase/stripe-connect-and-consignments.sql", "supabase/topps-checklists-editor-safe.sql", "supabase/topps-checklists.sql", "supabase/walkoff-auth-workspaces.sql"]);

function migrationFiles() {
  const out = [];
  for (const dir of ['supabase-migrations', 'supabase/migrations', 'supabase']) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.sql')) out.push(path.join(dir, f).replaceAll(path.sep, '/'));
  }
  return out;
}
// Tables a file creates in public, and the grants it makes per table.
export function checkMigration(sql) {
  const clean = sql.replace(/--[^\n]*/g, ' ');
  const created = [...clean.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)].map(m => m[1].toLowerCase());
  const grants = [...clean.matchAll(/grant\s+([^;]+?)\s+on\s+(?:table\s+)?([^;]+?)\s+to\s+([^;]+);/gi)].map(m => ({
    privs: m[1].toLowerCase(), tables: m[2].toLowerCase().split(',').map(t => t.trim().replace(/^public\./, '').replace(/"/g, '')), roles: m[3].toLowerCase(),
  }));
  const optOut = new Set([...sql.matchAll(/--[ \t]*grants:[ \t]*service_role only[ \t]+([a-z0-9_.,\t ]+)/gi)].flatMap(m => m[1].split(',').map(t => t.trim().replace(/^public\./, '').toLowerCase())));
  return created.map(table => {
    const has = role => grants.some(g => g.tables.includes(table) && new RegExp('\\b' + role + '\\b').test(g.roles));
    const problems = [];
    if (!has('service_role')) problems.push('no GRANT ... TO service_role (the Worker reads/writes with it)');
    if (!has('authenticated') && !optOut.has(table)) problems.push('no GRANT ... TO authenticated (the dashboard); if only the Worker should touch it, add a comment "-- grants: service_role only ' + table + '"');
    if (!/enable\s+row\s+level\s+security/i.test(clean) || !new RegExp('alter\\s+table\\s+(?:public\\.)?' + table + '\\s+enable\\s+row\\s+level\\s+security', 'i').test(clean)) problems.push('row level security is not enabled');
    return { table, problems };
  });
}

// The checker itself.
{
  const good = `create table if not exists public.widgets (id uuid primary key);
alter table public.widgets enable row level security;
grant select, insert, update, delete on public.widgets to authenticated;
grant select, insert, update, delete on public.widgets to service_role;`;
  assert.deepEqual(checkMigration(good), [{ table:'widgets', problems:[] }]);
  const bad = 'create table public.gadgets (id int);';
  assert.equal(checkMigration(bad)[0].problems.length, 3, 'no grants, no RLS');
  const workerOnly = `-- grants: service_role only gadgets
create table public.gadgets (id int);
alter table public.gadgets enable row level security;
grant all on public.gadgets to service_role;`;
  assert.deepEqual(checkMigration(workerOnly)[0].problems, []);
  const shared = `create table public.a (id int); create table public.b (id int);
alter table public.a enable row level security; alter table public.b enable row level security;
grant select on public.a, public.b to authenticated, service_role;`;
  assert.deepEqual(checkMigration(shared).map(r => r.problems.length), [0, 0], 'one grant can cover several tables and roles');
}

// Every migration added from now on.
const failures = [];
for (const file of migrationFiles()) {
  if (GRANDFATHERED.has(file)) continue;
  for (const r of checkMigration(fs.readFileSync(file, 'utf8'))) if (r.problems.length) failures.push(`${file}: public.${r.table} -- ${r.problems.join('; ')}`);
}
assert.deepEqual(failures, [], 'New tables need explicit grants (Supabase stops auto-granting on 2026-10-30):\n' + failures.join('\n'));
console.log('Supabase table grant checks passed');
