import fs from 'node:fs';
import assert from 'node:assert/strict';

// Weekly database check (2026-10-09): the scan inbox read was the slowest
// regular request. Its row-level rules looked up the user's store role once
// per row -- 14,771 "pending" rows, nearly all Pocket Scout eBay comp
// candidates sharing the table -- and the inbox's newest 50 were all comps,
// not phone scans.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const start = dashboard.indexOf('async function readScanInbox(');
const fn = dashboard.slice(start, dashboard.indexOf('\n}\n', start));
assert.match(fn, /\.eq\('status', 'pending'\)\s*\n(?:\s*\/\/[^\n]*\n)*\s*\.is\('session_id', null\)/, 'the inbox reads phone-scanner hand-offs only');

const sca = fs.readFileSync('sca.html', 'utf8');
const send = sca.slice(sca.indexOf('async function sendHandoffToSupabase('), sca.indexOf("from('scan_queue').insert(payload)"));
assert.doesNotMatch(send, /session_id/, 'phone hand-offs are the rows with no session_id');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /store_id: storeId, session_id: sessionId, status: 'pending'/, 'Pocket Scout candidates always carry their session');

const sql = fs.readFileSync('supabase/migrations/20261009233000_scan_queue_rls_once_per_query.sql', 'utf8');
assert.match(sql, /create or replace function public\.my_store_ids\(roles public\.store_role\[\]\)[\s\S]*security definer[\s\S]*sm\.user_id = auth\.uid\(\)[\s\S]*sm\.active = true[\s\S]*sm\.role = any\(roles\)/);
const policy = name => { const s = sql.indexOf('alter policy ' + name); assert.ok(s >= 0, name); return sql.slice(s, sql.indexOf(');\n', s)); };
for (const name of ['scan_queue_select_member_limited', 'scan_queue_update_employee', 'scan_queue_insert_scanner']) {
  const p = policy(name);
  assert.doesNotMatch(p, /current_store_role|can_sell_or_scan/, name + ' no longer looks up the role per row');
  assert.doesNotMatch(p, /[^(]select\s*\)|(?<!select )auth\.uid\(\)/, name + ' reads auth.uid() once');
  assert.match(p, /store_id in \(select public\.my_store_ids\(/);
}
assert.match(policy('scan_queue_select_member_limited'), /array\['owner','admin','manager','employee'\]::public\.store_role\[\]\)\)\s*or created_by = \(select auth\.uid\(\)\)/, 'select: staff of the store, or your own rows');
assert.match(policy('scan_queue_insert_scanner'), /array\['owner','admin','manager','employee','scanner_only'\]::public\.store_role\[\]\)\)\s*and created_by = \(select auth\.uid\(\)\)/, 'insert: scanner-only accounts too, only as yourself');
assert.match(sql, /create index if not exists scan_queue_phone_pending_idx\s*on public\.scan_queue \(store_id, created_at desc\)\s*where status = 'pending' and session_id is null;/);

console.log('Scan queue inbox + row rules checks passed');
