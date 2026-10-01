import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cachedCatalogSitemap } from '../scripts/sitemap-cache.mjs';

test('catalog XML is reused across query strings and HEAD keeps its body out of the response', async () => {
  const entries = new Map();
  const pending = [];
  const cache = {match:async key => entries.get(key.url)?.clone(),put:async (key,response) => {entries.set(key.url,response);}};
  const ctx = {waitUntil:p => pending.push(p)};
  let calls = 0;
  const generate = async request => {
    calls++;
    assert.equal(request.method, 'GET');
    assert.equal(new URL(request.url).search, '');
    return new Response('<urlset/>', {headers:{'content-type':'application/xml;charset=UTF-8','cache-control':'public, max-age=1800'}});
  };
  const get = (suffix='',method='GET') => cachedCatalogSitemap(new Request('https://www.themanapocket.com/sitemap-books.xml'+suffix,{method}),ctx,generate,cache);
  assert.equal(await (await get('?x=1')).text(), '<urlset/>');
  await Promise.all(pending);
  const head = await get('?x=2','HEAD');
  assert.equal(head.headers.get('X-Mana-Sitemap-Cache'),'HIT');
  assert.equal(await head.text(),'');
  assert.equal(await (await get()).text(),'<urlset/>');
  assert.equal(calls,1);
});

test('errors are never cached and unrelated requests bypass the helper', async () => {
  let puts = 0;
  const cache = {match:async()=>null,put:async()=>{puts++;}};
  const ctx = {waitUntil(){}};
  const error = () => new Response('Unavailable',{status:503});
  assert.equal((await cachedCatalogSitemap(new Request('https://www.themanapocket.com/sitemap-preorders.xml'),ctx,error,cache)).status,503);
  assert.equal(puts,0);
  for (const url of ['https://www.themanapocket.com/account','https://example.com/sitemap-books.xml']) assert.equal(await cachedCatalogSitemap(new Request(url),ctx,error,cache),null);
});
