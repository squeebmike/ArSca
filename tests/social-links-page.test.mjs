import assert from 'node:assert/strict';
import fs from 'node:fs';
import {storeOrganization} from '../scripts/storefront-seo.mjs';
const savedFetch=globalThis.fetch,savedCaches=globalThis.caches;
globalThis.caches={default:{match:async()=>null,put:async()=>{}}};
globalThis.fetch=async input=>{
  assert.equal(String(input.url||input),'https://www.themanapocket.com/privacy-policy','social page needs no inventory or customer queries');
  return new Response('<html><body>No chrome</body></html>');
};
try {
  const {default:api}=await import('../cloudflare-worker-full.js');
  const get=(path,method='GET')=>api.fetch(new Request('https://www.themanapocket.com'+path,{method}),{},{waitUntil(){}});
  const response=await get('/links');
  assert.equal(response.status,200);
  const html=await response.text();
  assert.equal([...html.matchAll(/<h1\b/g)].length,1);
  assert.match(html,/<link rel="canonical" href="https:\/\/www.themanapocket.com\/links">/);
  assert.doesNotMatch(html,/<meta name="robots" content="noindex/);
  for(const href of storeOrganization.sameAs)assert.ok(html.includes(href.replaceAll('&','&amp;')),'verified social profile available in initial HTML');
  for(const href of ['/shop','/preorders','/articles','/pokemon','/mtg'])assert.ok(html.includes('href="'+href+'"'));
  assert.match(html,/target="_blank" rel="noopener noreferrer"/);
  const schema=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1]));
  assert.equal(schema.find(x=>x['@type']==='CollectionPage').mainEntity.itemListElement.length,3);
  assert.equal(schema.filter(x=>x['@type']==='Organization').length,1);
  const redirect=await get('/links/?utm_source=instagram');
  assert.equal(redirect.status,301);
  assert.equal(redirect.headers.get('location'),'https://www.themanapocket.com/links?utm_source=instagram');
  const head=await get('/links','HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await get('/links','POST')).status,405);
  const config=fs.readFileSync('wrangler.deploy.jsonc','utf8');
  assert.ok(config.includes('www.themanapocket.com/links"'));
  assert.ok(config.includes('www.themanapocket.com/links/"'));
} finally {globalThis.fetch=savedFetch;globalThis.caches=savedCaches;}
console.log('Social link page: public HTML, verified destinations, canonical, schema, methods and redirects checked');
