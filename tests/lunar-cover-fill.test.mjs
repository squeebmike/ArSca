import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store ask: the 474 Lunar covers with no picture at all get Lunar's large
// cover -- but only where Lunar has one, so nothing shows a broken image.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const grab = sig => { const s = worker.indexOf(sig); assert.ok(s >= 0, sig); return worker.slice(s, worker.indexOf('\n}\n', s) + 2); };
const line = sig => { const s = worker.indexOf(sig); return worker.slice(s, worker.indexOf('\n', s) + 1); };
function setup(rows, hasLarge) {
  const patches = [], fetched = [], reads = [];
  const db = async (env, path, options = {}) => {
    if ((options.method || 'GET') === 'GET') { reads.push(path); return { response: { ok: true }, data: rows }; }
    patches.push([decodeURIComponent(path.match(/id=eq\.([^&]+)/)[1]), JSON.parse(options.body)]); return { response: { ok: true }, data: null };
  };
  const fetchStub = async u => { fetched.push(u); const code = u.match(/Large\/(.+)\.jpg/)[1]; return hasLarge.includes(code) ? new Response(new Uint8Array(40000), { headers: { 'Content-Type': 'image/jpeg' } }) : new Response('<html>not found</html>', { status: 404, headers: { 'Content-Type': 'text/html' } }); };
  const fill = new Function('supabaseAdminFetch', 'fetch', line('const LUNAR_COVER_ORIGIN =') + grab('async function fillMissingLunarCovers(') + '; return fillMissingLunarCovers;')(db, fetchStub);
  return { fill, patches, fetched, reads };
}
{
  const t = setup([{ id: 'a', distributor_sku: '1026de0717', flags: { mature: false } }, { id: 'b', distributor_sku: '1026DE0999', flags: null }, { id: 'c', distributor_sku: 'junk', flags: {} }], ['1026DE0717']);
  const r = await t.fill({}, { storeId: 's1', origin: 'https://w.example', limit: 20 });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { checked: 3, found: 1, missing: 2, more: false });
  assert.deepEqual(t.patches[0], ['a', { cover_image_url: 'https://w.example/foc/lunar-cover/1026DE0717.jpg' }], 'Lunar has it: the large cover');
  assert.equal(t.patches[1][0], 'b'); assert.ok(t.patches[1][1].flags.lunarCoverMissingAt, 'Lunar has none: marked, no image set');
  assert.equal(t.patches[1][1].cover_image_url, undefined);
  assert.equal(t.patches[2][0], 'c', 'a non-Lunar code is marked too, so it is not picked again');
  assert.deepEqual(t.fetched, ['https://media.lunardistribution.com/images/covers/Large/1026DE0717.jpg', 'https://media.lunardistribution.com/images/covers/Large/1026DE0999.jpg'], 'only real item codes are looked up');
  assert.match(t.reads[0], /^comic_skus\?distributor=eq\.Lunar&cover_image_url=is\.null&store_id=eq\.s1&or=\(flags->>lunarCoverMissingAt\.is\.null,flags->>lunarCoverMissingAt\.lt\."\d{4}-[^"]+"\)&select=id,distributor_sku,flags&order=on_sale_date\.desc\.nullslast,id\.asc&limit=20$/, 'covers with no picture, not checked in the last week');
}
{
  const t = setup(Array.from({ length: 2 }, (_, i) => ({ id: 'x' + i, distributor_sku: '1026DE07' + (10 + i), flags: {} })), []);
  assert.equal((await t.fill({}, { limit: 2 })).more, true, 'a full batch means there may be more');
}
// Wired: route, every-6-hours run, and the FOC screen button for Lunar weeks.
assert.match(worker, /if \(url\.pathname === '\/foc\/lunar-covers\/fill'\) \{[\s\S]{0,400}requireStoreUser\(request, env, storeId, \['owner','admin','manager'\]\)[\s\S]{0,200}fillMissingLunarCovers\(env, \{ storeId, origin: url\.origin \}\)/);
assert.match(worker, /runScheduledStockHealthCheck\(env\), runScheduledLunarCoverFill\(env\)\]\)\);/);
assert.match(dash, /c\.distributor==='Lunar'\?'<button class="hbtn"[^>]*onclick="fillLunarCovers\(\)">FIND LUNAR COVERS<\/button>'/);
assert.match(dash, /window\.fillLunarCovers=fillLunarCovers;/);
console.log('Lunar cover fill checks passed');
