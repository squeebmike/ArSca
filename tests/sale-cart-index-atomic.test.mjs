import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Worker: server-side atomic-ish upsert/remove routes exist ──────────────
assert.match(worker, /if \(url\.pathname === '\/kv\/sale-cart-index\/upsert' \|\| url\.pathname === '\/kv\/sale-cart-index\/remove'\) \{/, 'worker must expose dedicated sale-cart-index routes');
assert.match(worker, /const scopedKey = `lba:\$\{safeStoreKey\(storeId\)\}:sale_carts_index`;/, 'the new routes must operate on the SAME kv key the old generic /kv/sale_carts_index route used, so it is a drop-in replacement');
assert.match(worker, /const idx = index\.findIndex\(e => e\.id === entry\.id\);\s*\n\s*if \(idx >= 0\) index\[idx\] = entry; else index\.push\(entry\);/, 'upsert must replace-by-id or append, matching the previous client-side logic');
assert.match(worker, /index = index\.filter\(e => e\.id !== id\);/, 'remove must filter out the given id');
assert.match(worker, /index = index\.filter\(e => e && e\.status === 'open'\)\.slice\(0, 100\);/, 'both routes must only keep open carts, matching the previous behavior');

// ── Dashboard: client no longer does its own GET-then-POST read-modify-write ──
assert.match(dashboard, /storeWorkerFetch\(scopedWorkerPath\('\/kv\/sale-cart-index\/upsert'\)/, 'upsertSaleCartIndexEntry must call the new atomic upsert route');
assert.match(dashboard, /storeWorkerFetch\(scopedWorkerPath\('\/kv\/sale-cart-index\/remove'\)/, 'removeSaleCartFromIndex must call the new atomic remove route');
assert.doesNotMatch(dashboard, /await storeWorkerFetch\(scopedWorkerPath\('\/kv\/sale_carts_index'\), \{\s*\n\s*method:'POST'/, 'the old racy client-side read-then-POST-the-whole-blob pattern must be gone from the upsert/remove paths');

console.log('Sale cart index atomicity checks passed');
