import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {handleBaseballCatalog} from '../scripts/baseball-catalog-pages.mjs';
import {sportsLookupScript} from '../scripts/sports-card-marketplace.mjs';
const reference={title:'Aaron Judge #66',image:'https://storage.googleapis.com/images.pricecharting.com/example/240.jpg',url:'https://www.sportscardspro.com/game/baseball-cards-2026-bowman-chrome/aaron-judge-66',run:''};
reference.referencePrices={currency:'USD',ungraded:7.5,grade9:25,psa10:80,capturedAt:'2026-10-25T08:00:00Z'};
{
 const auditReference={...reference,consoleId:'baseball-cards-2026-bowman-chrome',productId:'12345'},requests=[];
 const auditEnv={CARD_REFERENCE_ARCHIVE:{idFromName:x=>x,get:()=>({fetch:async input=>{const request=new Request(input);if(new URL(request.url).pathname==='/reference-price'){requests.push(await request.json());return Response.json({referencePrices:reference.referencePrices,queued:false});}return Response.json({cards:[auditReference],archived:true});}})}};
 const auditUrl=new URL('https://www.themanapocket.com/baseball/checklists/2026-bowman-chrome-baseball/cards/2026-bowman-chrome-baseball-66?reference=3&price-refresh=0');
 const response=await handleBaseballCatalog(new Request(auditUrl),auditEnv,auditUrl,{escape:s=>String(s),listItems:async()=>{throw Error('no inventory scan');},available:()=>true});
 assert.equal((await response.json()).reference.productId,'12345');assert.equal(requests.length,1);assert.equal(requests[0].refresh,false,'stored coverage endpoint does not enqueue a price scan');
}
const href='https://www.ebay.com/itm/123?campid=5339046175';
const store=new Map();let inventoryReads=0;
const env={EBAY_PARTNER_CAMPAIGN_ID:'5339046175',LBA_KV:{get:async key=>store.get(key)||null,put:async(key,value)=>store.set(key,JSON.parse(value))},CARD_REFERENCE_ARCHIVE:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json({cards:[reference],archived:true})})}};
const deps={escape:s=>String(s),slug:s=>s,available:()=>true,listItems:async()=>{inventoryReads++;return [];},shell:d=>d.bodyHtml,searchEbay:async()=>({listings:[{itemId:'123',title:'2026 Bowman Chrome Aaron Judge #66 Yankees',imageUrl:'https://i.ebayimg.com/card.jpg',affiliateUrl:href,currency:'USD',price:8}]})};
const url=new URL('https://www.themanapocket.com/baseball/checklists/2026-bowman-chrome-baseball/cards/2026-bowman-chrome-baseball-66?market=1');
const response=await handleBaseballCatalog(new Request(url),env,url,deps),data=await response.json();
assert.equal(data.reference.image,reference.image);assert.equal(data.listing.href,href);assert.equal(inventoryReads,0,'both pictures share the public endpoint without querying inventory');
const {document,window}=parseHTML('<html><body><details class="mp-card-parallels" open><summary>Versions</summary><ul><li class="mp-parallel-card" data-sports-preview="/card?market=1"><a class="mp-parallel-search" href="'+href+'">Search</a></li></ul></details></body></html>');
let observed;class Observer{constructor(cb){observed=cb;}observe(){}unobserve(){}}
document.querySelector('details').open=true;
let payload=data;
vm.runInNewContext(sportsLookupScript.slice(sportsLookupScript.indexOf('<script>')+8).replace(/<\/script>$/,''),{document,AbortController,setTimeout,clearTimeout,window:{IntersectionObserver:Observer},IntersectionObserver:Observer,fetch:async()=>({ok:true,json:async()=>payload})});
const button=document.querySelector('button[data-sports-lookup]');observed([{target:button,isIntersecting:true}]);await new Promise(resolve=>setImmediate(resolve));
assert.equal(document.querySelector('[data-sports-reference-result] img').src,reference.image);
assert.match(document.querySelector('[data-sports-reference-result]').textContent,/Not a copy for sale/);
assert.equal(document.querySelector('[data-sports-result] img').src,data.listing.image);
assert.equal(document.querySelector('[data-sports-result] a').href,href);
assert.equal(document.querySelector('[data-sports-result] a').rel,'noopener sponsored');
assert.match(document.querySelector('[data-sports-result]').textContent,/8\.00 USD/);
assert.match(document.querySelector('.mp-reference-estimate').textContent,/Ungraded\$7.50 USD/);
const grades=document.querySelector('.mp-reference-estimate select');grades.querySelector('option[value="psa10"]').selected=true;grades.onchange();
assert.match(document.querySelector('.mp-reference-estimate').textContent,/PSA 10\$80.00 USD/);
assert.match(document.querySelector('.mp-reference-estimate').textContent,/Collected Oct 25, 2026/);
payload={reference,listing:null};button.dispatchEvent(new window.Event('click',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));
assert.equal(document.querySelector('[data-sports-reference-result] img').src,reference.image,'a disappeared listing does not remove the independent reference');
assert.equal(document.querySelector('[data-sports-result] img'),null);
assert.match(document.querySelector('[data-sports-result]').textContent,/No exact eBay listing/);
const pageUrl=new URL(url);pageUrl.search='';let pageData,unexpectedSourceReads=0;
const pageResponse=await handleBaseballCatalog(new Request(pageUrl),env,pageUrl,{...deps,shell:d=>{pageData=d;return d.bodyHtml;},referenceFetch:async()=>{unexpectedSourceReads++;throw Error('No live provider fetch on HTML request');}});
const initialHtml=await pageResponse.text();
assert.ok(initialHtml.includes('src="'+reference.image+'"'),'verified cloud photo is present without JavaScript');
assert.equal(pageData.jsonLd.image,reference.image,'structured page image matches visible reference');
assert.ok(initialHtml.includes('aria-label="Card checklist navigation"'),'card pages expose ordinary previous/next HTML links');
assert.equal(unexpectedSourceReads,0,'HTML rendering does not crawl the provider');
assert.equal(inventoryReads,1,'one existing inventory load, no per-image inventory reads');
console.log('Reference-first shopping: both exact photos, separate source labels, affiliate offer, crawlable initial photo and expired-listing isolation passed');

// Price and source survive missing artwork and an image load failure.
payload={reference:{...reference,image:null},listing:null};button.dispatchEvent(new window.Event('click',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));
assert.match(document.querySelector('[data-sports-reference-result]').textContent,/Reference photo unavailable/);
assert.equal(document.querySelector('[data-sports-reference-result] a').href,reference.url);
assert.match(document.querySelector('.mp-reference-estimate').textContent,/7.50 USD/);
payload={reference,listing:null};button.dispatchEvent(new window.Event('click',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));
document.querySelector('[data-sports-reference-result] img').onerror();
assert.equal(document.querySelector('[data-sports-reference-result] a').href,reference.url);
assert.match(document.querySelector('.mp-reference-estimate').textContent,/7.50 USD/);

// Section grids must expose stored insert photos before JavaScript runs.
const {handleBaseballSections}=await import('../scripts/baseball-section-pages.mjs');
const {baseballSets}=await import('../scripts/topps/baseball-seed.mjs');
let archiveReads=0;
const insertRef={...reference,title:'Ronald Acuna Jr #RC-1',cardNumber:'RC-1',consoleId:'baseball-cards-2020-topps-big-league-roll-call'};
const gridEnv={...env,CARD_REFERENCE_ARCHIVE:{idFromName:x=>x,get:id=>({fetch:async()=>{archiveReads++;return Response.json({cards:id==='console:'+insertRef.consoleId?[insertRef]:[],archived:true});}})}};
const gridUrl=new URL('https://www.themanapocket.com/baseball/checklists/2020-topps-big-league-baseball/sections/roll-call');
const gridResponse=await handleBaseballSections(new Request(gridUrl),gridEnv,gridUrl,{...deps,referenceFetch:async()=>{throw Error('No provider fetch for grid');}},baseballSets,d=>new Response(d.bodyHtml),()=>new Response('',{status:404}));
const gridHtml=await gridResponse.text();assert(gridHtml.includes('src="'+reference.image+'"'),'collected insert photo renders in section HTML');
assert(gridHtml.includes('data-sports-reference='),'other cards retain viewport reference loading');
assert(archiveReads<=12,'only six visible cards read at most two stored source families each');

// Stored-reference audits must distinguish an archive outage from a missing card.
for(const failure of ['http','throw','empty']){
 const env={CARD_REFERENCE_ARCHIVE:{idFromName:x=>x,get:()=>({fetch:async()=>{if(failure==='throw')throw Error('private failure detail');return failure==='http'?new Response('private failure detail',{status:503}):Response.json({cards:[],archived:true});}})}};
 const url=new URL('https://www.themanapocket.com/baseball/checklists/2026-bowman-chrome-baseball/cards/2026-bowman-chrome-baseball-66?reference=3&price-refresh=0');
 const r=await handleBaseballCatalog(new Request(url),env,url,{escape:s=>String(s),listItems:async()=>{throw Error('no inventory scan');},available:()=>true});
 assert.equal(r.status,failure==='empty'?200:503);const j=await r.json();if(failure==='empty')assert.equal(j.reference,null);else{assert.equal(j.retryable,true);assert.equal(r.headers.get('Cache-Control'),'no-store');assert(!JSON.stringify(j).includes('private failure detail'));}
}
