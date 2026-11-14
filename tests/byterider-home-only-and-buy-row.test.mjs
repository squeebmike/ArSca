// (store, 2026-11-14) "Does Dave have the ByteRider_97 on the dash? He shouldn't" and "paste gets cut off on mobile".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const app = read('scripts/dashboard-app.js'), wk = read('cloudflare-worker-full.js'), html = read('dashboard.html');
assert.ok(app.includes("async function mountDashByteRider(){\n  // The Mana Pocket's own mascot") && app.includes("if(getActiveStoreId() !== HOME_STORE_ID){ document.getElementById('byterider-dash')?.remove(); window.byteRiderDash = null; return; }"), 'the dashboard mascot: The Mana Pocket only');
assert.ok(app.includes("function openStaffByteRider(){\n  if(getActiveStoreId() !== HOME_STORE_ID) return;"));
const i = wk.indexOf("if (url.pathname === '/staff/byterider/ask' && request.method === 'POST') {"), route = wk.slice(i, i + 1600);
assert.ok(route.includes("if (storeId !== ITEM_DETAIL_STORE_ID) return json({ ok: false, error: 'ByteRider is only available for The Mana Pocket.' }, 403);"), 'the server refuses other stores');
assert.ok(route.indexOf('requireStoreUser') < route.indexOf('ITEM_DETAIL_STORE_ID') && route.indexOf('ITEM_DETAIL_STORE_ID') < route.indexOf('ANTHROPIC_API_KEY'));
assert.match(wk, /const ITEM_DETAIL_STORE_ID = '0f9dd4bc-42a7-487e-a972-2905d24513e9'; \/\/ The Mana Pocket/);
assert.ok(html.includes('.buy-add-row{display:flex;gap:6px;margin-bottom:12px;align-items:center;flex-wrap:wrap;}') && html.includes('.buy-add-row #bl-input{flex:1 1 100% !important;min-width:0}'), 'the buy row wraps on a phone');
console.log('ByteRider for The Mana Pocket only, buy row wraps on phones: passed');
