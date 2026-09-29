import assert from 'node:assert/strict';
import { handleFocRequest } from '../scripts/foc-preorders.mjs';
import { handleBacklistRequest } from '../scripts/backlist-catalog.mjs';

const request = new Request('https://www.themanapocket.com/');
const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const deps = { publicStoreId: 'store', mtgEscapeHtml: esc, mtgSlugify: s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-') };
const rows = Array.from({length: 1205}, (_, i) => ({ id: `sku-${i}`, family_id: `family-${i}`, title: 'Same title', variant_label: 'Cover A' }));
let familyRequests = 0;
const response = await handleFocRequest(request, {}, new URL('https://www.themanapocket.com/sitemap-preorders.xml'), {
  ...deps,
  supabaseAdminFetch: async (_, path) => {
    const url = new URL('https://db.test/' + path);
    if (url.pathname === '/comic_skus') {
      assert.equal(url.searchParams.get('order'), 'updated_at.desc,id.asc');
      const offset = Number(url.searchParams.get('offset'));
      return {data: rows.slice(offset, offset + 1000)};
    }
    const ids = url.searchParams.get('id').slice(3, -1).split(',').map(id => id.replaceAll('"', ''));
    assert.ok(ids.length <= 100, 'family lookup must stay bounded to avoid HTTP 414');
    familyRequests++;
    return {data: ids.map(id => ({id, series_name: id, issue_number: '1'}))};
  },
});
assert.equal(response.status, 200);
const xml = await response.text();
assert.equal(familyRequests, 13);
assert.equal([...xml.matchAll(/<loc>/g)].length, 1206);
assert.match(xml, /family-1204-1-cover-a/);

const book = {id:'book-1',title:'Same title'};
const books = await handleBacklistRequest(request, {}, new URL('https://www.themanapocket.com/sitemap-books.xml'), {
  ...deps,
  supabaseAdminFetch: async (_, path) => {
    assert.match(path, /order=title.asc,id.asc/);
    return {data:[book, book]};
  },
});
assert.equal([...(await books.text()).matchAll(/\/book\/book-1\//g)].length, 1);

const oldFetch = globalThis.fetch;
globalThis.caches = {default:{match:async()=>null,put:async()=>{}}};
globalThis.fetch = async () => new Response('User-agent: *\nDisallow: /private\nSitemap: https://www.themanapocket.com/sitemap.xml\n', {headers:{'content-type':'text/plain'}});
try {
  const {default: worker} = await import('../cloudflare-worker-full.js');
  const get = path => worker.fetch(new Request('https://www.themanapocket.com'+path), {}, {waitUntil(){}});
  const redirect = await get('/bcw?item=59d79df5-6ed0-8db0-8174-2fc51ecaa9ff');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), 'https://www.themanapocket.com/item/59d79df5-6ed0-8db0-8174-2fc51ecaa9ff');
  assert.equal((await get('/bcw?item=%2Fevil')).status, 400);
  const robots = await get('/robots.txt');
  const text = await robots.text();
  assert.match(text, /Disallow: \/private/);
  for (const name of ['sitemap.xml','sitemap-items.xml','sitemap-preorders.xml','sitemap-books.xml','sitemap-pages.xml']) assert.ok(text.includes('Sitemap: https://www.themanapocket.com/'+name));
} finally {globalThis.fetch = oldFetch;}
console.log('SEO discovery regressions passed: large sitemap, stable paging, deduplication, canonical redirects and robots preservation');
