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

for(const path of ['/sitemap-preorders.xml','/preorder/11111111-1111-4111-8111-111111111111/cover']) {
 for(const failingFetch of [async()=>({data:null,response:new Response('Unavailable',{status:503})}),async()=>{throw Error('Network unavailable');}]) {
  const result=await handleFocRequest(request,{},new URL('https://www.themanapocket.com'+path),{...deps,mtgPageShell:page=>'<link rel="canonical" href="https://www.themanapocket.com'+page.canonicalPath+'">'+page.bodyHtml,supabaseAdminFetch:failingFetch});
  assert.equal(result.status,503);assert.equal(result.headers.get('Cache-Control'),'no-store');assert.equal(result.headers.get('Retry-After'),'60');assert.ok(!(await result.text()).includes('Preorder not found'));
 }
}

const partialSitemap=await handleFocRequest(request,{},new URL('https://www.themanapocket.com/sitemap-preorders.xml'),{...deps,supabaseAdminFetch:async(_,path)=>path.includes('offset=0')?{data:rows.slice(0,1000)}:{data:null,response:new Response('Unavailable',{status:503})}});
assert.equal(partialSitemap.status,503,'a failed later page must not publish a truncated sitemap');
const scopedDetail=await handleFocRequest(request,{},new URL('https://www.themanapocket.com/preorder/11111111-1111-4111-8111-111111111111/cover'),{...deps,supabaseAdminFetch:async(_,path)=>{assert.ok(path.includes('store_id=eq.store'));return {data:[]};},mtgPageShell:page=>page.bodyHtml});
assert.equal(scopedDetail.status,404,'successful empty lookup remains a genuine missing cover');

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
  const home = await get('/index.html?utm_source=legacy');
  assert.equal(home.status, 301);
  assert.equal(home.headers.get('location'), 'https://www.themanapocket.com/?utm_source=legacy');
  const preorder = await get('/preorders?sku=abd35ca7-7aa5-4bb9-8353-521f3248bda0&utm_source=legacy');
  assert.equal(preorder.status, 301);
  assert.equal(preorder.headers.get('location'), 'https://www.themanapocket.com/preorder/abd35ca7-7aa5-4bb9-8353-521f3248bda0?utm_source=legacy');
  assert.notEqual((await get('/preorders?sku=%2Fevil')).status, 301);
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
