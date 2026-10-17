import assert from 'node:assert/strict';
import {handleBaseballCatalog,baseballSetPath,baseballCardPath} from '../scripts/baseball-catalog-pages.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
let lastPage;
const deps={escape,slug:s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-'),available:i=>i.quantity>0,listItems:async()=>[],shell:p=>{lastPage=p;return '<title>'+escape(p.title)+'</title><link rel="canonical" href="https://www.themanapocket.com'+p.canonicalPath+'">'+(p.robotsNoindex?'<meta name="robots" content="noindex,follow">':'')+'<script type="application/ld+json">'+JSON.stringify(p.jsonLd)+'</script>'+p.bodyHtml;}};
const get=(path,env={},method='GET')=>handleBaseballCatalog(new Request('https://www.themanapocket.com'+path,{method}),env,new URL('https://www.themanapocket.com'+path),deps);
assert.equal((await get('/baseball')).status,200);
let res=await get('/sitemap-baseball.xml'),xml=await res.text();
const paths=[...xml.matchAll(/<loc>https:\/\/www.themanapocket.com([^<]+)<\/loc>/g)].map(m=>m[1]);
assert.equal(paths.length,1023);assert.equal(new Set(paths).size,paths.length);
const titles=new Set(),h1s=new Set();
for(const set of baseballSets) {
 const numbers=new Set(set.cards.map(c=>c.cardNumber));assert.equal(numbers.size,set.cards.length);
 assert.equal(set.cards.length,set.id.endsWith('update')?329:330);
 for(let page=1;page<=6;page++) {
  const path=baseballSetPath(set)+(page>1?'?page='+page:'');
  assert.equal((await get(path)).status,200);assert.equal(lastPage.canonicalPath,path);
 }
 assert.equal((await get(baseballSetPath(set)+'?page=7')).status,404);
 for(const card of set.cards) {
  const path=baseballCardPath(set,card);assert.ok(paths.includes(path));
  res=await get(path);const body=await res.text();assert.equal(res.status,200);
  assert.equal(lastPage.canonicalPath,path);assert.ok(!lastPage.robotsNoindex);
  assert.ok(!body.includes('"offers"'));assert.ok(!body.includes('partnernetwork')&&!body.includes('campid='));
  const h1=body.match(/<h1>(.*?)<\/h1>/)[1];assert.ok(!h1s.has(h1));h1s.add(h1);
  assert.ok(!titles.has(lastPage.title));titles.add(lastPage.title);
 }
}
const set=baseballSets[0],card=set.cards[0];
res=await get(baseballCardPath(set,card),{EBAY_PARTNER_CAMPAIGN_ID:'1234567890'});
let body=await res.text();assert.ok(body.includes('rel="noopener sponsored"'));assert.ok(body.includes('Affiliate link:'));assert.ok(body.includes('campid=1234567890'));
deps.listItems=async()=>[{id:'exact',categorySlug:'sports-cards',name:'Store copy',year:2023,set:set.displayName,player:card.player,cardNumber:card.cardNumber,subset:'Base',variant:'Base',price:3,quantity:1},{id:'wrong-parallel',categorySlug:'sports-cards',name:'Wrong gold copy',year:2023,set:set.displayName,player:card.player,cardNumber:card.cardNumber,subset:'Base',variant:'Gold',price:8,quantity:1}];
body=await(await get(baseballCardPath(set,card))).text();assert.ok(body.includes('/item/exact/'));assert.ok(!body.includes('/item/wrong-parallel/'));
body=await(await get(baseballSetPath(set)+'?q=Juan')).text();assert.ok(body.includes('noindex,follow'));assert.ok(body.includes('Juan Soto'));assert.equal(lastPage.canonicalPath,baseballSetPath(set));
assert.equal((await get('/baseball/checklists/unknown')).status,404);
assert.equal((await get('/baseball',{},'HEAD')).status,200);
assert.equal(await(await get('/baseball',{},'HEAD')).text(),'');
assert.equal(await get('/unrelated'),null);
deps.listItems=async()=>{throw Error('Temporary inventory outage');};
body=await(await get(baseballCardPath(set,card))).text();assert.ok(body.includes('Store availability is temporarily unavailable'));assert.ok(!body.includes('No exact matching copy'));
console.log('1023 sitemap URLs, 989 unique card pages, HTML pagination, search, stock matching and affiliate gates passed');
