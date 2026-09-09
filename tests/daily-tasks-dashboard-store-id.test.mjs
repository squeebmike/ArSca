import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = fs.readFileSync('scripts/daily-tasks-dashboard.js', 'utf8');

// Store report: the TASKS tab just showed "Loading..." forever, then an
// error, on every single action -- because the backend
// (scripts/daily-tasks.mjs) requires storeId explicitly, either as a
// ?store_id= query param (GET/DELETE routes) or a storeId field in the
// JSON body (POST/PATCH routes), the same convention card-intake-dashboard.js
// already follows. This file's api() helper only ever sent the
// Authorization/X-Store-Id headers via storeWorkerFetch -- the backend
// route handlers never read X-Store-Id at all, so every request 400'd with
// "storeId is required" before it ever reached Supabase (confirmed no
// daily_task_* queries were reaching Postgres at all). Every api() call
// site in this file must carry storeId one of these two ways, or the same
// silent-everywhere-break comes back.
const callLines = src.split('\n').filter(line => /\bapi\(/.test(line) && !/^async function api\(/.test(line.trim()));
assert.ok(callLines.length >= 11, `sanity check: expected at least 11 lines calling api(), found ${callLines.length}`);

for (const line of callLines) {
  const isWrite = /method\s*:\s*['"](POST|PATCH)['"]/.test(line);
  if (isWrite) {
    assert.match(line, /storeId\s*:\s*getActiveStoreId\(\)/,
      `POST/PATCH api() call must send storeId:getActiveStoreId() in its body -- the backend route reads it from body.storeId: ${line.trim().slice(0, 100)}...`);
  } else {
    // GET (query string only) and DELETE (query string) both read storeId
    // from the URL's store_id param on this route table.
    assert.match(line, /store_id=['"]?\+encodeURIComponent\(getActiveStoreId\(\)\)/,
      `GET/DELETE api() call must include store_id=...getActiveStoreId()... in its URL -- the backend route reads it from url.searchParams.get('store_id'): ${line.trim().slice(0, 100)}...`);
  }
}

console.log('Daily tasks dashboard storeId-on-every-request checks passed');
