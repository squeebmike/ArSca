import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report: voiding a sale on one device never told any OTHER device's
// local pos_transactions cache -- confirmVoidSale() only purges the cache
// on the device that clicks void (see void-sale-purges-local-cache.test.mjs).
// syncSharedShowTransactions only ever pulls completed/succeeded sales, so
// a voided sale simply stops appearing in its result -- indistinguishable,
// from absence alone, from a legitimately-older sale that just fell outside
// the pull's most-recent-1000 window. This guards the fix: check the real
// status of those absent-but-previously-cached rows directly, and only drop
// the ones that are actually no longer completed/succeeded.

const fnStart = html.indexOf('async function syncSharedShowTransactions');
const fnEnd = html.indexOf('\nfunction startShowSessionSyncLoop', fnStart);
const fnBody = html.slice(fnStart, fnEnd);

assert.ok(fnStart !== -1, 'syncSharedShowTransactions must exist');

assert.match(fnBody, /const idsInThisPull=new Set\(cloud\.map\(row=>String\(row\.id\)\)\);/,
  'must know which ids this pull actually refreshed, to find the ones it did NOT (the ambiguous case)');

assert.match(fnBody,
  /const staleCandidates=localRows\.filter\(row=>\(row\.source==='supabase-ledger'\|\|row\.source==='supabase-shared-show'\)&&!idsInThisPull\.has\(String\(row\.id\)\)\)\.map\(row=>String\(row\.id\)\);/,
  "candidates must be limited to rows already confirmed synced to Supabase ('supabase-ledger' or 'supabase-shared-show') -- an offline-queued row that hasn't reached the cloud yet must never be treated as a reconciliation candidate");

assert.match(fnBody, /sb\.from\('pos_sales'\)\.select\('id,status'\)\.eq\('store_id',getActiveStoreId\(\)\)\.in\('id',batch\)/,
  'must check the real current status of stale candidates directly, not assume absence from the pull means voided');

assert.match(fnBody,
  /const stillLive=new Set\(\(statusRows\|\|\[\]\)\.filter\(row=>\['completed','succeeded'\]\.includes\(row\.status\)\)\.map\(row=>String\(row\.id\)\)\);/,
  'must only keep candidates whose live status is still completed/succeeded -- everything else (voided, or gone entirely) gets dropped');

assert.match(fnBody, /batch\.forEach\(id=>\{if\(!stillLive\.has\(id\)\)merged\.delete\(id\);\}\);/,
  'must actually remove the no-longer-live rows from the merged result before it gets saved back to localStorage');

console.log('Cross-device void reconciliation contract check passed');
