import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lunarCoverImageUrl } from '../scripts/foc-preorders.mjs';

// Store report (eBay screenshots): Lunar covers showed tiny next to another
// seller's. The Lunar FOC spreadsheet only embeds small thumbnails; Lunar's
// media server has the large cover at /images/covers/Large/<item code>.jpg.
const origin = 'https://worker.example';
const thumb = origin + '/inventory/photo/inventory-photos/store/1-a.jpeg';
assert.equal(lunarCoverImageUrl(origin, '0926de0734', thumb, null), origin + '/foc/lunar-cover/0926DE0734.jpg', 'new import: the large cover');
assert.equal(lunarCoverImageUrl(origin, '0926DE0734', '', thumb), origin + '/foc/lunar-cover/0926DE0734.jpg', 're-import of a cover that had a thumbnail');
assert.equal(lunarCoverImageUrl(origin, '0926DE0734', thumb, origin + '/foc/lunar-cover/0926DE0734.jpg'), origin + '/foc/lunar-cover/0926DE0734.jpg');
assert.equal(lunarCoverImageUrl(origin, '0926DE0734', thumb, 'https://i.example/big.jpg'), 'https://i.example/big.jpg', 'a cover pasted in by hand is kept');
assert.equal(lunarCoverImageUrl(origin, '0926DE0734', '', null), null, 'no thumbnail to fall back on: left empty, as before');
assert.equal(lunarCoverImageUrl(origin, 'weird code', thumb, null), thumb, 'not a Lunar item code: the thumbnail');
const service = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
assert.match(service, /const coverImageUrl = lunarCoverImageUrl\(origin, p\.distributorSku, p\.coverImageUrl, before\?\.cover_image_url\);/);

// The Worker route: the large cover when Lunar has it, else the thumbnail.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const start = worker.indexOf('    const lunarCoverMatch = ');
const block = worker.slice(start, worker.indexOf('    const inventoryPhotoMatch = ', start));
const run = new Function('url', 'request', 'env', 'ctx', 'CORS', 'caches', 'fetch', 'supabaseAdminFetch', `return (async () => {\n${block}\nreturn 'fell through';\n})();`);
function setup({ lunar }) {
  const fetched = [], stored = new Map(), dbPaths = [];
  const caches = { default: { match: async r => stored.get(r.url) || null, put: async (r, res) => { stored.set(r.url, res); } } };
  const fetchStub = async u => { fetched.push(u); return lunar ? new Response(new Uint8Array(50000), { headers: { 'Content-Type': 'image/jpeg' } }) : new Response('nope', { status: 404, headers: { 'Content-Type': 'text/html' } }); };
  const db = async (e, p) => { dbPaths.push(p); return { data: [{ link: origin + '/inventory/photo/inventory-photos/store/thumb.jpeg' }] }; };
  const env = { MTG_CATALOG_R2: { get: async k => (k === 'inventory-photos/store/thumb.jpeg' ? { body: 'THUMB', httpMetadata: { contentType: 'image/jpeg' } } : null) } };
  const waits = [];
  const go = path => run(new URL(origin + path), new Request(origin + path), env, { waitUntil: p => waits.push(p) }, {}, caches, fetchStub, db);
  return { go, fetched, stored, dbPaths, waits };
}
{
  const t = setup({ lunar: true });
  const res = await t.go('/foc/lunar-cover/0926de0734.jpg');
  assert.equal(res.status, 200);
  assert.equal((await res.arrayBuffer()).byteLength, 50000, 'the large cover');
  assert.deepEqual(t.fetched, ['https://media.lunardistribution.com/images/covers/Large/0926DE0734.jpg']);
  assert.match(res.headers.get('Cache-Control'), /max-age=604800/);
  await Promise.all(t.waits);
  assert.ok(t.stored.size === 1, 'cached at the edge');
  assert.equal(t.dbPaths.length, 0);
}
{
  const t = setup({ lunar: false });
  const res = await t.go('/foc/lunar-cover/0926DE0999.jpg');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'THUMB', 'Lunar has no large cover: the spreadsheet thumbnail');
  assert.match(t.dbPaths[0], /comic_skus\?distributor_sku=eq\.0926DE0999&raw_distributor_data->>CoverLink=like\.https\*/);
}
assert.equal(await setup({ lunar: true }).go('/foc/lunar-cover/../../etc.jpg'), 'fell through', 'only Lunar item codes');
console.log('Lunar large cover checks passed');
