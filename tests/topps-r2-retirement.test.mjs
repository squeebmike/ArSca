import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const browser = fs.readFileSync('scripts/topps/offline-browser.js', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const retirement = fs.readFileSync('supabase-migrations/2026-07-15-retire-topps-catalog-after-r2.sql', 'utf8');

assert.match(dashboard, /2026\.07\.16\.15-topps-r2-only/);
assert.match(dashboard, /Supabase catalog fallback is retired/);
assert.doesNotMatch(searchFunction(dashboard), /from\('topps_checklist_cards'\)/);
assert.match(browser, /checksum mismatch/);
assert.match(browser, /record count mismatch/);
assert.match(worker, /\/catalog\/topps\/manifest/);
assert.match(worker, /\/catalog\/topps\/download/);
assert.match(retirement, /walkoff\.allow_topps_retirement/);
assert.match(retirement, /verified-r2-backup-complete/);

function searchFunction(source) {
  const start = source.indexOf('async function searchToppsSportsChecklist');
  const end = source.indexOf('\nfunction pcPriceFromMatch', start);
  return source.slice(start, end);
}

console.log('Topps R2 retirement contract passed');
