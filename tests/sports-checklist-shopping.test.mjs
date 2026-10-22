import assert from 'node:assert/strict';
import {footballSets} from '../scripts/topps/football-seed.mjs';
import {footballSections} from '../scripts/topps/football-sections.mjs';
import {sportsChecklistNavigation,sportsChecklistRedirect} from '../scripts/sports-checklist-ui.mjs';
import {sportsListings,sportsListingMatches,sportsListingHtml} from '../scripts/sports-card-marketplace.mjs';
import {handleFootballCatalog} from '../scripts/football-catalog-pages.mjs';
import {baseballChecklistInventoryMatches} from '../scripts/topps/public-checklist-policy.mjs';
import {footballOddsHtml,footballOdds} from '../scripts/football-odds.mjs';
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const set=footballSets.find(s=>s.id==='2025-topps-chrome-football'),groups=footballSections[0].sections;
assert.equal(groups.length,40);assert.equal(groups.reduce((n,g)=>n+g.cards.length,0),1975);
const all=groups.flatMap(g=>g.cards);assert.equal(new Set(all.map(c=>c.id)).size,all.length);
const dual=groups.find(g=>g.id==='dual-autographs');assert.equal(dual.cards.length,13);assert.equal(dual.cards.find(c=>c.cardNumber==='DA-AK').subjects.length,2);
assert.ok(!groups.some(g=>g.id==='fanatics-authentics-redemption-cards'),'unnumbered memorabilia redemption subjects are not invented card numbers');
const group=groups.find(g=>g.id==='kaiju'),card=group.cards[0];
const nav=sportsChecklistNavigation(set,groups,esc,{sport:'football',current:group.id});
assert.ok(nav.includes('value="kaiju" selected')&&nav.includes('<optgroup label="Autographs">')&&nav.includes('Pack / box odds'));
assert.ok(nav.includes('/football/checklists/'+set.id+'/sections/kaiju'));
const redirect=sportsChecklistRedirect(new URL('https://example.com/?view=kaiju'),set,groups,'football');assert.equal(redirect.status,303);assert.equal(redirect.headers.get('Location'),'/football/checklists/'+set.id+'/sections/kaiju');
assert.equal(sportsChecklistRedirect(new URL('https://example.com/?view=https://evil.test'),set,groups,'football').status,404);
const listing={itemId:'123',title:'2025 Topps Chrome Football Tom Brady Kaiju KAI-1',imageUrl:'https://i.ebayimg.com/images/card.jpg',affiliateUrl:'https://www.ebay.com/itm/123?campid=5339046175',price:75,currency:'USD'};
assert.ok(sportsListingMatches(listing,card,set,group));
for(const suffix of [' custom',' facsimile',' replica',' proxy'])assert.ok(!sportsListingMatches({...listing,title:listing.title+suffix},card,set,group));
assert.ok(sportsListingMatches({...listing,title:'2025 Topps Chrome Tom Brady Kaiju #KAI-1'},card,set,group),'exact prefixed card identity plus named insert permits seller title without the redundant sport word');
for(const title of ['2025 Topps Chrome Baseball Tom Brady Kaiju KAI-1','2025 Topps Chrome Football Tom Brady KAI-11','2025 Topps Chrome Football Patrick Mahomes KAI-1','2024 Topps Chrome Football Tom Brady KAI-1','2025 Topps Chrome Football Tom Brady KAI-1 LOT','2025 Topps Chrome Tom Brady KAI-1'])assert.ok(!sportsListingMatches({...listing,title},card,set,group),title);
const variation=groups.find(g=>g.id==='base-cards-team-camo-variation'),v=variation.cards[0];
assert.ok(!sportsListingMatches({...listing,title:'2025 Topps Chrome Football '+v.player+' #'+v.cardNumber},v,set,variation));
assert.ok(sportsListingMatches({...listing,title:'2025 Topps Chrome Football '+v.player+' Team Camo #'+v.cardNumber},v,set,variation));
const own={id:'our-kaiju',name:card.player+' #'+card.cardNumber,player:card.player,set:'Football Cards 2025 Topps Chrome',cardNumber:card.cardNumber,categorySlug:'sports-cards',price:60,quantity:1};
assert.ok(baseballChecklistInventoryMatches(own,card,set));assert.ok(!baseballChecklistInventoryMatches({...own,set:'Baseball Cards 2025 Topps Chrome'},card,set));
const mem=new Map(),tasks=[];let searches=0,inventoryLoads=0;
const env={EBAY_PARTNER_CAMPAIGN_ID:'5339046175',LBA_KV:{get:async k=>mem.get(k)||null,put:async(k,v)=>mem.set(k,JSON.parse(v))}};
const deps={ctx:{waitUntil:p=>tasks.push(p)},escape:esc,slug:s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-'),shell:p=>p.bodyHtml,available:i=>i.quantity>0,listItems:async()=>{inventoryLoads++;return [own];},searchEbay:async()=>{searches++;return {listings:[listing]};}};
assert.deepEqual(await sportsListings(env,deps.ctx,set,group,deps),[]);await Promise.all(tasks);
const cached=await sportsListings(env,deps.ctx,set,group,deps);assert.equal(cached.length,1);assert.equal(searches,1);assert.ok(sportsListingHtml(cached[0],esc).includes('eBay asking price: $75.00 USD'));
const root='/football/checklists/'+set.id,path=root+'/sections/kaiju';
const request=async path=>handleFootballCatalog(new Request('https://www.themanapocket.com'+path),env,new URL('https://www.themanapocket.com'+path),deps);
const page=await(await request(path)).text();assert.ok(page.includes('/item/our-kaiju/')&&page.includes('eBay asking price: $75.00 USD'));
assert.ok(page.indexOf('/item/our-kaiju/')<page.indexOf('ebay.com/itm/123'));
const loads=inventoryLoads;const lookup=await request(root+'/cards/'+card.id+'?market=1');assert.equal(lookup.status,200);assert.equal((await lookup.json()).listing.itemId,'123');assert.equal(inventoryLoads,loads,'marketplace lookup never queries inventory');
assert.equal((await request(root+'?view=kaiju')).status,303);
const odds=footballOddsHtml(set.id,esc);assert.ok(odds.includes('1:2,559')&&odds.includes('1:4,813')&&odds.includes('6392')&&odds.includes('name="sports-odds-format"'));
assert.equal(footballOdds[set.id].rows.find(r=>r.name==='Kaiju').odds[3],null);
console.log('Mobile section navigation, 1,975 numbered football references, exact card identity, store-first shopping, bounded affiliate lookup and source odds passed');

for(const section of groups){
 const r=await handleFootballCatalog(new Request('https://www.themanapocket.com'+root+'/sections/'+section.id),{EBAY_PARTNER_CAMPAIGN_ID:'5339046175'},new URL('https://www.themanapocket.com'+root+'/sections/'+section.id),deps);
 assert.equal(r.status,200);const body=await r.text();
 assert.ok(body.includes('value="'+section.id+'" selected'));
 for(const c of [section.cards[0],section.cards.at(-1)]){
  const u=root+'/cards/'+c.id;const res=await handleFootballCatalog(new Request('https://www.themanapocket.com'+u),{EBAY_PARTNER_CAMPAIGN_ID:'5339046175'},new URL('https://www.themanapocket.com'+u),deps);
  assert.equal(res.status,200);assert.ok((await res.text()).includes(esc(c.cardNumber)));
 }
}

// Holiday's entire printed non-base checklist is native, not a PDF destination.
{
 const {holidayBaseballSections}=await import('../scripts/topps/holiday-baseball-sections.mjs');
 const {holidayOddsRows}=await import('../scripts/topps/holiday-baseball-odds-data.mjs');
 const {baseballSets}=await import('../scripts/topps/baseball-seed.mjs');
 const {handleBaseballCatalog}=await import('../scripts/baseball-catalog-pages.mjs');
 const {sportsMarketplaceNotice,sportsLookupScript}=await import('../scripts/sports-card-marketplace.mjs');
 const holiday=baseballSets.find(s=>s.id==='2026-topps-holiday-baseball'),groups=holidayBaseballSections[0].sections;
 assert.equal(groups.length,11);const cards=groups.flatMap(g=>g.cards);assert.equal(cards.length,440);assert.equal(new Set(cards.map(c=>c.id)).size,440);
 assert.ok(cards.some(c=>c.player==='José Ramírez'));assert.ok(!JSON.stringify(cards).includes('\ufffd'));
 const nav=sportsChecklistNavigation(holiday,groups,esc);
 assert.ok(nav.includes('All non-base cards (440)'));assert.ok(!nav.includes('Autographs (publisher PDF)'));
 assert.equal(sportsChecklistRedirect(new URL('https://example.com/?view=all-non-base'),holiday,groups).headers.get('Location'),'/baseball/checklists/'+holiday.id+'/sections/all-non-base');
 const dep={escape:esc,slug:s=>s,shell:p=>p.bodyHtml,listItems:async()=>[],available:()=>true};
 const get=p=>handleBaseballCatalog(new Request('https://www.themanapocket.com'+p),{},new URL('https://www.themanapocket.com'+p),dep);
 for(const c of cards){const r=await get('/baseball/checklists/'+holiday.id+'/cards/'+c.id);assert.equal(r.status,200,c.id);}
 const page=await(await get('/baseball/checklists/'+holiday.id+'/sections/all-non-base')).text();
 assert.match(page,/440 publisher checklist entries/);assert.match(page,/IntersectionObserver/);assert.match(page,/active<2/);assert.match(page,/data-sports-lookup/);
 assert.match(page,/not independently verified/);assert.match(page,/eBay 1\/1/);
 const chrome=groups.find(g=>g.id==='base-cards-chrome-variation'),c=chrome.cards[0];
 const offer={title:'2026 Topps Holiday Baseball Bobby Witt Jr Chrome HC1'};
 assert.ok(sportsListingMatches(offer,c,holiday,chrome));assert.ok(!sportsListingMatches({title:'2026 Topps Holiday Baseball Bobby Witt Jr H1'},c,holiday,chrome));
 const root=await(await get('/baseball/checklists/'+holiday.id)).text();assert.match(root,/Browse non-base cards/);assert.match(root,/All 440 named non-base entries/);
 assert.equal(holidayOddsRows.length,66);assert.equal(holidayOddsRows.find(r=>r.name==='Base Cards Holiday Lights').odds[1],'4:1');
 let query='';const qenv={EBAY_PARTNER_CAMPAIGN_ID:'5339046175',LBA_KV:{get:async()=>null,put:async()=>{}}};
 await sportsListings(qenv,null,holiday,chrome,{searchEbay:async q=>{query=q;return {listings:[]};}},{card:c,wait:true});
 assert.match(query,/Bobby Witt Jr/);assert.match(query,/HC1/);assert.ok(!query.includes('Base Cards Chrome Variation'),'printed section headings must not over-constrain seller searches');
 assert.ok(sportsMarketplaceNotice.includes('not authentication'));assert.ok(sportsLookupScript.includes('document.hidden'));
}

// The real browser queue must never launch one request per card simultaneously.
{
 const vm=await import('node:vm');const {sportsLookupScript}=await import('../scripts/sports-card-marketplace.mjs');
 const events={},buttons=Array.from({length:5},(_,i)=>({disabled:false,isConnected:true,dataset:{sportsLookup:'/card/'+i+'?market=1'},parentElement:{querySelector:()=>({replaceChildren(){},textContent:''})}}));
 let callback,active=0,maximum=0;const releases=[],calls=[];
 const document={hidden:false,addEventListener:(type,fn)=>events[type]=fn,querySelectorAll:()=>buttons};
 class Observer{constructor(cb){callback=cb;}observe(){}unobserve(){}}
 const fetch=url=>{calls.push(url);active++;maximum=Math.max(maximum,active);return new Promise(resolve=>releases.push(()=>{active--;resolve({ok:true,json:async()=>({listing:null})});}));};
 vm.runInNewContext(sportsLookupScript.slice(sportsLookupScript.indexOf('<script>')+8).replace(/<\/script>$/,''),{document,window:{IntersectionObserver:Observer},IntersectionObserver:Observer,fetch});
 callback(buttons.map(target=>({target,isIntersecting:true})));assert.equal(calls.length,2);
 releases[0]();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,3);
 document.hidden=true;releases[1]();releases[2]();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,3,'hidden pages do not start more lookups');
 document.hidden=false;events.visibilitychange();assert.equal(calls.length,5);releases[3]();releases[4]();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(maximum,2);assert.ok(buttons.every(b=>!b.disabled));
}

// Mobile type collections and subject-aware filters must preserve exact cards.
{
 const {sportsSectionCollections}=await import('../scripts/sports-checklist-ui.mjs');
 const {sportsSectionFilters}=await import('../scripts/sports-section-filters.mjs');
 const collections=sportsSectionCollections(groups),autos=collections.find(g=>g.id==='all-autographs');
 assert.equal(autos.cards.length,groups.filter(g=>/auto/i.test(g.kind)).reduce((n,g)=>n+g.cards.length,0));
 assert.ok(nav.includes('/sections/all-autographs'),'Autos opens all autograph sections');
 const page=await(await request(root+'/sections/all-autographs')).text();
 assert.match(page,/name="player"/);assert.match(page,/name="team"/);assert.match(page,/Next →/);
 assert.match(page,/Dual Autographs/);
 const fixture={cards:[{cardNumber:'DA-1',player:'A / B',subjects:[{name:'A',team:'Team A'},{name:'B',team:'Team B'}]},...Array.from({length:61},(_,i)=>({cardNumber:String(i),player:'A',subjects:[{name:'A',team:'Team A'}]}))]};
 const url=p=>new URL('https://example.com/section'+p);
 assert.equal(sportsSectionFilters(url('?player=A&team=Team+B'),fixture,'/section',esc).cards.length,0,'player and team must belong to the same printed subject');
 const filtered=sportsSectionFilters(url('?player=A&team=Team+A&page=2'),fixture,'/section',esc);
 assert.equal(filtered.cards.length,62);assert.match(filtered.href(1),/player=A&team=Team\+A/);assert.ok(filtered.filtered);
 assert.equal(sportsSectionFilters(url('?page=3'),fixture,'/section',esc),null);
 assert.ok(!sportsSectionFilters(url(''),fixture,'/section',esc).form.includes('id="set-checklist" open'),'filters start compact');
 let numericQuery='';await sportsListings({EBAY_PARTNER_CAMPAIGN_ID:'5339046175',LBA_KV:{get:async()=>null,put:async()=>{}}},null,set,variation,{searchEbay:async q=>{numericQuery=q;return {listings:[]};}},{card:v,wait:true});
 assert.match(numericQuery,/Team Camo/,'numeric IDs need the parallel identity in the marketplace query');
}

// Parallel links require the same printed number and subject identity.
{
 const {relatedParallelLinks}=await import('../scripts/baseball-section-pages.mjs');
 const base=set.cards.find(c=>c.cardNumber==='1');
 const links=relatedParallelLinks(set,base,esc);
 assert.match(links,/Parallels &amp; variations/);
 assert.match(links,/Team Camo/);
 assert.equal(relatedParallelLinks(set,{...base,player:'Unrelated Player',subjects:[{name:'Unrelated Player'}]},esc),'');
 assert.equal(relatedParallelLinks(set,{...base,cardNumber:'NO-SUCH-NUMBER'},esc),'');
 const {manaLoaderStyle}=await import('../scripts/mana-loader.mjs');
 assert.match(manaLoaderStyle,/prefers-reduced-motion/);
}
