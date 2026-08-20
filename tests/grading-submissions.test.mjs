import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-08-16-grading-submissions.sql', 'utf8');

// ── Migration: table, columns, RLS ──────────────────────────────────
assert.match(migration, /create table if not exists public\.grading_submissions/, 'migration missing grading_submissions table');
for (const col of ['store_id', 'inventory_id', 'item_name', 'grader', 'submission_cost', 'declared_value', 'submitted_at', 'expected_return_at', 'actual_return_at', 'status', 'grade_result', 'cert_number', 'market_value_after']) {
  assert.match(migration, new RegExp(`\\b${col}\\b`), `migration missing ${col} column`);
}
assert.match(migration, /grading_submissions_select_member/, 'grading_submissions missing a select RLS policy');
assert.match(migration, /grading_submissions_insert_employee/, 'grading_submissions missing an insert RLS policy');
assert.match(migration, /grading_submissions_update_employee/, 'grading_submissions missing an update RLS policy');
assert.match(migration, /alter table public\.grading_submissions enable row level security/, 'grading_submissions must have RLS enabled');

console.log('Grading submissions migration checks passed');

// ── Tab plumbing: registered with the role/plan gate system ────────
assert.match(dashboard, /id="tab-grading"/, 'grading tab panel must exist');
assert.match(dashboard, /\['grading', 'GRADING'\]/, 'grading must be reachable from the tab nav (MORE_TABS)');
assert.match(dashboard, /grading:'inventory'/, 'grading tab must be registered in TAB_CAPABILITY (gated with other inventory-tier features)');
assert.match(dashboard, /'overview','display','browse','inventory','research','pos','whatnot','scout','alerts','wantlist','locations','restock','grading','sets','events','pulllists'/, 'employees must be able to reach the grading tab');
assert.match(dashboard, /if\(name === 'grading'\) setTimeout\(ensureGradingPanel, 0\);/, 'switching to the grading tab must trigger a render');
assert.match(dashboard, /id="grading-submission-modal"/, 'missing the new-submission modal');

console.log('Grading submissions tab plumbing checks passed');

// ── Core functions exist ────────────────────────────────────────────
for (const fn of ['loadGradingSubmissionsFromSupabase', 'ensureGradingPanel', 'renderGradingPanel', 'renderGradingListInto',
  'saveGradingSubmissionFromForm', 'updateGradingSubmission', 'markGradingReturned', 'cancelGradingSubmission',
  'gradingDaysBetween', 'gradingSubmissionRoi', 'applyGradingInventoryLink']) {
  assert.match(dashboard, new RegExp(`function ${fn}\\(`), `missing ${fn}`);
}

// Offline outbox: writes must be retryable, matching the pull-list convention.
assert.match(dashboard, /if\(item\.type === 'grading-submission-upsert'\) \{[\s\S]*?sb\.from\('grading_submissions'\)\.upsert\(item\.payload, \{ onConflict:'id' \}\)/, 'grading submission inserts must be retryable via the offline outbox');
assert.match(dashboard, /if\(item\.type === 'grading-submission-status'\) \{[\s\S]*?sb\.from\('grading_submissions'\)\.update\(item\.payload\.updates\)\.eq\('id', item\.payload\.id\)\.eq\('store_id', item\.payload\.store_id\)/, 'grading submission status updates must be retryable via the offline outbox');
assert.match(dashboard, /enqueueSync\('grading-submission-upsert', 'Queued grading submission', record, e\.message\)/, 'a failed grading submission insert must fall back to the offline outbox, not silently fail');
assert.match(dashboard, /enqueueOrReplaceSync\('grading-submission-status', id,/, 'a failed grading submission status update must fall back to the offline outbox');

console.log('Grading submissions core function + offline-sync checks passed');

// ── Functional checks: gradingDaysBetween + gradingSubmissionRoi ───
{
  const daysSrc = dashboard.match(/function gradingDaysBetween\(a, b\)\{[\s\S]*?\n\}/)?.[0];
  const roiSrc = dashboard.match(/function gradingSubmissionRoi\(g\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(daysSrc && roiSrc, 'could not extract grading helper functions for functional testing');
  const { gradingDaysBetween, gradingSubmissionRoi } = new Function(`${daysSrc}\n${roiSrc}\nreturn { gradingDaysBetween, gradingSubmissionRoi };`)();

  assert.equal(gradingDaysBetween(null), null, 'gradingDaysBetween must return null with no start date');
  assert.equal(gradingDaysBetween('2026-08-01', '2026-08-15'), 14, 'gradingDaysBetween must compute whole days between two dates');

  assert.equal(gradingSubmissionRoi({ submission_cost:20, declared_value:100 }), null, 'ROI must be null until market_value_after is known');
  const roi = gradingSubmissionRoi({ submission_cost:20, declared_value:100, market_value_after:180 });
  assert.ok(roi, 'ROI must be computed once market_value_after is set');
  assert.equal(roi.profit, 60, 'ROI profit = value back - (declared value + submission cost)');
  assert.equal(Math.round(roi.pct), 50, 'ROI pct = profit / (declared value + submission cost) * 100');
}

console.log('Grading submissions functional checks passed');
