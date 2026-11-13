// (store, 2026-11-13) "I should be able to select all ... the pagination makes me go to each page" and
// "add the 1 tap from last week's auctions to the bin ... and put them back to the prices in dashboard".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = read('dashboard.html'), app = read('scripts/dashboard-app.js'), wk = read('cloudflare-worker-full.js');
// Select all matching: the button sits right after the count and shows as soon as anything (the page) is selected.
assert.ok(html.includes('<span id="inv-bulk-count"') && html.indexOf('id="inv-bulk-all-btn"') - html.indexOf('<span id="inv-bulk-count"') < 200);
assert.equal((html.match(/toggleInvBulkSelectAllFiltered\(true\)/g) || []).length, 1, 'one select-all-matching button');
assert.ok(app.includes("allBtn.textContent = 'SELECT ALL ' + total + ' MATCHING';") && app.includes("filtered.forEach(i => inventoryBulkSelectedIds.add(i.id));"));
// One tap: ended shows' unsold books back to Buy It Now at dashboard prices.
assert.ok(html.includes('onclick="endedAuctionsToBin()"'));
assert.ok(app.includes("'/whatnot/ended-auctions-to-bin?store_id='") && app.includes('JSON.stringify({ preview })') && app.includes("if(!confirm('Put ' + p.count"));
const i = wk.indexOf("if (url.pathname === '/whatnot/ended-auctions-to-bin' && request.method === 'POST') {"), route = wk.slice(i, wk.indexOf('    // POST /whatnot/show-only', i));
assert.ok(i > 0);
assert.ok(route.includes("requireStoreUser(request, env, storeId, ['owner','admin','manager'])"));
assert.ok(route.includes("for (const sh of await upcomingWhatnotShows(deps.api)) active.add(String(sh.id));") && route.includes("if (cur?.live) active.add(String(cur.id));"), 'scheduled and live shows aren\'t over');
assert.ok(route.includes("if (link?.productId && shows.length && shows.every(id => !active.has(id))) ended.push(r);"), 'only books whose shows are all over');
assert.ok(route.includes("whatnotShowOnly: false") && route.includes('await backToBuyItNow(batch.map(r => r.id), deps)') && route.includes('pushWhatnotItemsNow(env, ctx, storeId, batch.map(r => r.id))'), 'off show-only, into the shop, the dashboard price out now');
assert.ok(route.indexOf("whatnotShowOnly: false") < route.indexOf('backToBuyItNow('), 'show-only is cleared first');
console.log('Select all matching, ended auctions to Buy It Now: passed');
