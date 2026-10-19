import assert from 'node:assert/strict';
import {footballSets} from '../scripts/topps/football-seed.mjs';
import {footballChecklistPublicationProblems} from '../scripts/topps/public-checklist-policy.mjs';
import {handleFootballCatalog,footballSetPath,footballCardPath} from '../scripts/football-catalog-pages.mjs';
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
let output,stock=[];
const deps={escape,slug:s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-'),available:i=>i.quantity>0,listItems:async()=>stock,shell:p=>{output=p;return p.bodyHtml;}};
const get=(path,method='GET')=>handleFootballCatalog(new Request('https://www.themanapocket.com'+path,{method}),{EBAY_PARTNER_CAMPAIGN_ID:'5339046175'},new URL('https://www.themanapocket.com'+path),deps);
assert.equal(footballSets.length,8);
assert.equal(footballSets.reduce((n,s)=>n+s.cards.length,0),2150);
const xml=await(await get('/sitemap-football.xml')).text();
const urls=[...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
assert.equal(urls.length,2159);assert.equal(new Set(urls).size,urls.length);
const titles=new Set(),h1s=new Set();
for(const set of footballSets){
 assert.deepEqual(footballChecklistPublicationProblems(set),[]);
 assert.ok(footballChecklistPublicationProblems({...set,licensedFootball:false}).length);
 assert.ok(footballChecklistPublicationProblems({...set,displayName:'Panini Football'}).length);
 assert.equal(new Set(set.cards.map(c=>c.cardNumber)).size,set.cards.length);
 const linked=new Set();
 for(let p=1;p<=Math.ceil(set.cards.length/60);p++){
  const path=footballSetPath(set)+(p>1?'?page='+p:'');
  const res=await get(path);assert.equal(res.status,200);const body=await res.text();assert.equal(output.canonicalPath,path);
  for(const c of set.cards)if(body.includes('href="'+footballCardPath(set,c)+'"'))linked.add(c.id);
 }
 assert.equal(linked.size,set.cards.length);
 assert.equal((await get(footballSetPath(set)+'?page=999')).status,404);
 for(const card of set.cards){
  assert.ok(card.player.trim());const path=footballCardPath(set,card);
  assert.ok(urls.includes('https://www.themanapocket.com'+path));
  const res=await get(path);assert.equal(res.status,200);const body=await res.text();
  assert.equal(output.canonicalPath,path);assert.ok(!output.robotsNoindex);assert.equal(output.jsonLd['@type'],'WebPage');assert.ok(!output.jsonLd.offers);
  assert.ok(body.includes('campid=5339046175')&&body.includes('rel="noopener sponsored"'));
  const h1=body.match(/<h1>(.*?)<\/h1>/)[1];assert.ok(!h1s.has(h1));h1s.add(h1);assert.ok(!titles.has(output.title));titles.add(output.title);
 }
}
const set=footballSets[0],card=set.cards[0];
const exact={id:'exact',name:'Exact store copy',categorySlug:'sports-cards',year:set.year,set:set.displayName,player:card.player,cardNumber:card.cardNumber,subset:'Base',variant:'Base',quantity:1,price:5};
stock=[exact,{...exact,id:'wrong',variant:'Gold'},{...exact,id:'sold',quantity:0},{...exact,id:'unpriced',price:0}];
const body=await(await get(footballCardPath(set,card))).text();assert.ok(body.includes('/item/exact/'));assert.ok(body.includes('/item/wrong/')&&body.includes('Gold')&&body.includes('may include parallels'));for(const id of ['sold','unpriced'])assert.ok(!body.includes('/item/'+id+'/'));
await get(footballSetPath(set)+'?q=Kyler');assert.ok(output.robotsNoindex);assert.equal(output.canonicalPath,footballSetPath(set));
assert.equal((await get('/football','HEAD')).status,200);assert.equal(await(await get('/football','HEAD')).text(),'');
assert.equal(await get('/other'),null);
const heritage=footballSets.find(s=>s.id==='2026-topps-heritage-football');assert.equal(heritage.cards.find(c=>c.cardNumber==='331').player,'2026 AFC Championship Game');
console.log('Football: 2,150 card pages, pagination, sitemaps, identity, affiliate and licensing checks passed');
