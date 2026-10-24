import assert from 'node:assert/strict';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {handleBaseballCatalog} from '../scripts/baseball-catalog-pages.mjs';
import {sectionsForSet,relatedParallelLinks} from '../scripts/baseball-section-pages.mjs';
import {sportsListingMatches,sportsListings} from '../scripts/sports-card-marketplace.mjs';
import {parallelPrograms,cardParallelProgram,selectedParallelCard,matchesParallelPrinting,cardNumberingLabel} from '../scripts/sports-parallels.mjs';
import {sportsSectionCollections} from '../scripts/sports-checklist-ui.mjs';
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const set=baseballSets.find(s=>s.id==='2021-topps-series-1-baseball'),base=set.cards.find(c=>c.cardNumber==='43');
const links=relatedParallelLinks(set,base,esc);
for(const value of ['gold','black','memorial-day-camo','printing-plates'])assert.ok(links.includes('?parallel='+value));
for(const value of ['/2021','/70','/50','/25','1/1','/10'])assert.ok(links.includes(value),value);
assert.ok(links.includes('base-cards-clear-variation'));
const ordinary=set.cards.find(c=>!sectionsForSet(set).find(g=>g.id==='base-cards-clear-variation').cards.some(v=>v.cardNumber===c.cardNumber));
assert.ok(!relatedParallelLinks(set,ordinary,esc).includes('base-cards-clear-variation'),'Clear /10 is limited to its printed subject list');
const gold=selectedParallelCard(set,base,'gold'),black=selectedParallelCard(set,base,'black');
assert.ok(matchesParallelPrinting('Jo Adell Gold #43 123/2021',gold.parallelRule,gold.parallelSiblings));
assert.ok(!matchesParallelPrinting('Jo Adell Gold Foil #43 123/2021',gold.parallelRule,gold.parallelSiblings));
assert.ok(!matchesParallelPrinting('Jo Adell Black #43 12/50',black.parallelRule,black.parallelSiblings));
assert.ok(!matchesParallelPrinting('Jo Adell Black #43 71/70',black.parallelRule,black.parallelSiblings));
assert.ok(!matchesParallelPrinting('Jo Adell Black #43',black.parallelRule,black.parallelSiblings));
const one=selectedParallelCard(set,base,'70th-anniversary');
assert.ok(!matchesParallelPrinting('70th Anniversary Jo Adell ebay 1/1',one.parallelRule,one.parallelSiblings));
const chrome=baseballSets.find(s=>s.id==='2025-topps-chrome-baseball'),bobby=sectionsForSet(chrome).find(g=>g.id==='base-card-image-variation').cards.find(c=>c.player==='Bobby Witt Jr.');
const imageGroup=sectionsForSet(chrome).find(g=>g.id==='base-card-image-variation');
assert.ok(!sportsListingMatches({title:'2025 Topps Chrome Sapphire Bobby Witt Jr. Image Variation #93 Royals'},bobby,chrome,imageGroup));
assert.ok(sportsListingMatches({title:'2025 Topps Chrome Bobby Witt Jr. Image Variation #93 Royals'},bobby,chrome,imageGroup));
const chromeBase=chrome.cards[0],red=selectedParallelCard(chrome,chromeBase,'red-refractor');
assert.ok(matchesParallelPrinting('Red Refractor 2/5',red.parallelRule,red.parallelSiblings));
assert.ok(!matchesParallelPrinting('Red RayWave Refractor 2/5',red.parallelRule,red.parallelSiblings));
assert.ok(!matchesParallelPrinting('Red Wave Refractor 2/5',red.parallelRule,red.parallelSiblings));
const frozen=selectedParallelCard(chrome,chromeBase,'frozenfractor');
assert.equal(cardNumberingLabel(chrome,frozen),'/-5');
assert.ok(matchesParallelPrinting('Frozenfractor -2/-5',frozen.parallelRule,frozen.parallelSiblings));
assert.ok(!matchesParallelPrinting('Frozenfractor 2/5',frozen.parallelRule,frozen.parallelSiblings));
for(const [id,p] of Object.entries(parallelPrograms)){
 const release=baseballSets.find(s=>s.id===id);assert.ok(release,id);
 assert.match(p.source,/^https:\/\/(?:ripped\.topps\.com|www\.blowoutcards\.net)\//);
 const sections=new Set(sectionsForSet(release).map(g=>g.id));
 for(const [section,spec] of Object.entries(p.sections)){assert.ok(sections.has(section),id+'/'+section);assert.equal(new Set((spec.variants||[]).map(v=>v.id)).size,(spec.variants||[]).length);}
}
assert.ok(!cardParallelProgram(set,{section:'Unknown Insert'}).variants.length,'do not inherit the base rainbow into unrelated inserts');
for(const id of ['2023-topps-series-1','2023-topps-series-2']){
 const release=baseballSets.find(s=>s.id===id),groups=sectionsForSet(release);
 const aceGroup=groups.find(g=>g.id==='all-aces'),ace=aceGroup.cards[0];
 assert.equal(cardParallelProgram(release,ace).variants.find(v=>v.id==='gold').printRun,75,'All Aces Gold differs from base Gold');
 assert.match(relatedParallelLinks(release,ace,esc),/market=1&amp;parallel=gold/);
 assert.equal(cardParallelProgram(release,release.cards[0]).variants.find(v=>v.id==='black').printRun,72);
 assert.equal(cardParallelProgram(release,groups.find(g=>g.id==='base-cards-clear-variation').cards[0]).printRun,10);
 assert.equal(groups.find(g=>g.id==='base-cards-clear-variation').cards.length,100);
 const notClear=release.cards.find(c=>!groups.find(g=>g.id==='base-cards-clear-variation').cards.some(v=>v.cardNumber===c.cardNumber));
 assert.ok(!relatedParallelLinks(release,notClear,esc).includes('base-cards-clear-variation'),'Clear remains restricted to published subjects');
 assert.equal(cardParallelProgram(release,groups.find(g=>g.id==='heavy-lumber').cards[0]).variants.length,0,'do not invent a Heavy Lumber rainbow');
 assert.ok(!cardParallelProgram(release,groups.find(g=>g.id==='1988-topps-baseball').cards[0]).variants.some(v=>v.id==='the-real-one'));
}
const series23=baseballSets.find(s=>s.id==='2023-topps-series-1');
assert.equal(cardParallelProgram(series23,series23.cards[0]).variants.find(v=>v.id==='gold').printRun,2023);
const series232=baseballSets.find(s=>s.id==='2023-topps-series-2');
assert.ok(!cardParallelProgram(series232,series232.cards[0]).variants.some(v=>v.id==='gold'),'do not publish the contradictory /2022 Series 2 solicitation');
assert.equal(cardParallelProgram(set,sectionsForSet(set).find(g=>g.id==='topps-reverence-autograph-patch-cards').cards[0]).variants.find(v=>v.name==='Red').printRun,5);
const all=sportsSectionCollections(sectionsForSet(set),set).find(g=>g.id==='all-parallels');
assert.ok(all.cards.some(c=>c.id===base.id));assert.equal(new Set(all.cards.map(c=>c.id)).size,all.cards.length);
let page,loads=0,queries=[];
const own={id:'ours',set:set.displayName,year:2021,categorySlug:'sports-cards',player:base.player,name:base.player+' [Gold] #43 /2021',cardNumber:'43',subset:'Base',variant:'Gold',price:10,quantity:1};
const env={EBAY_PARTNER_CAMPAIGN_ID:'5339046175',LBA_KV:{get:async()=>null,put:async()=>{}}};
const deps={escape:esc,slug:s=>s,available:i=>i.quantity>0,listItems:async()=>{loads++;return [own,{...own,id:'wrong',name:base.player+' Black #43 /70',variant:'Black'}];},shell:p=>{page=p;return p.bodyHtml;},searchEbay:async q=>{queries.push(q);return {listings:[]};}};
const path='/baseball/checklists/'+set.id+'/cards/'+base.id;
const get=p=>handleBaseballCatalog(new Request('https://www.themanapocket.com'+p),env,new URL('https://www.themanapocket.com'+p),deps);
let res=await get(path+'?parallel=gold');assert.equal(res.status,200);const html=await res.text();
assert.ok(html.includes('/item/ours/'));assert.ok(!html.includes('/item/wrong/'));assert.ok(html.includes('Gold /2021'));
assert.equal(page.canonicalPath,path);assert.ok(page.robotsNoindex);
assert.match(html,/market=1&amp;parallel=gold/);assert.match(html,/campid=5339046175/);
assert.equal((await get(path+'?parallel=made-up')).status,404);
const before=loads;res=await get(path+'?market=1&parallel=gold');assert.equal(res.status,200);assert.equal(loads,before,'parallel marketplace calls never query inventory');
assert.ok(queries.some(q=>q.includes('Gold')&&q.includes('/2021')));
const familyHtml=await(await get('/baseball/checklists/'+set.id+'/sections/all-parallels')).text();
assert.match(familyHtml,/\?parallel=gold/);assert.match(familyHtml,/Select a parallel above/);
for(const m of familyHtml.matchAll(/data-sports-lookup="([^\"]+)"/g)){
 const url=new URL('https://www.themanapocket.com'+m[1].replaceAll('&amp;','&'));
 if(set.cards.some(c=>url.pathname.endsWith('/'+c.id)))assert.ok(url.searchParams.has('parallel'),'base-family photos must use a specific finish');
}
assert.match(familyHtml,/mp-parallel-gallery/);
assert.match(familyHtml,/data-mp-sports-lookup-runtime/);
const beforeBase=loads;await get(path);assert.equal(loads,beforeBase+1,'all inline variants reuse the single inventory read');
assert.match(page.bodyHtml,/data-mp-sports-lookup-runtime/);
const ownWithPhoto={...own,image:'https://example.test/our-gold-photo.jpg'};
const stockedPanel=relatedParallelLinks(set,base,esc,{inventory:[ownWithPhoto],deps});
assert.match(stockedPanel,/our-gold-photo\.jpg/);assert.match(stockedPanel,/Buy our copy/);
const ownTile=stockedPanel.match(/<li class="mp-parallel-card">[\s\S]*?href="[^\"]*\?parallel=gold"[\s\S]*?<\/li>/)?.[0];
assert.ok(ownTile?.includes('/item/ours/'));assert.ok(!ownTile?.includes('market=1&amp;parallel=gold"'),'an exact store photo avoids an unnecessary eBay lookup');
const insert=sectionsForSet(set).find(g=>g.id==='1986-topps-baseball').cards[0];
const insertHtml=relatedParallelLinks(set,insert,esc);assert.match(insertHtml,/mp-parallel-gallery/);assert.match(insertHtml,/market=1&amp;parallel=red/);assert.match(insertHtml,/\/10/);
const clearGroup=sectionsForSet(set).find(g=>g.id==='base-cards-clear-variation'),clear=clearGroup.cards[0];
assert.ok(!sportsListingMatches({title:'2021 Topps Series 1 '+clear.player+' Clear #'+clear.cardNumber+' /25'},clear,set,clearGroup));
assert.ok(sportsListingMatches({title:'2021 Topps Series 1 '+clear.player+' Clear #'+clear.cardNumber+' /10'},clear,set,clearGroup));
// In-place images must retain affiliate attribution and show actual asking prices.
{
 const vm=await import('node:vm');const {sportsLookupScript,withSportsLookups}=await import('../scripts/sports-card-marketplace.mjs');
 const el=tag=>({tag,style:{},children:[],append(...c){this.children.push(...c);},replaceChildren(){this.children=[];},closest(){return {};}});
 const target=el('result'),button={disabled:false,isConnected:true,dataset:{sportsLookup:path+'?market=1&parallel=gold'},parentElement:{querySelector:()=>target}};
 let callback,fetches=0;
 class Observer{constructor(fn){callback=fn;}observe(){}unobserve(){}}
 const doc={hidden:false,addEventListener(){},querySelectorAll:()=>[button],createElement:el};
 const listing={title:'2021 Topps Series 1 Jo Adell #43 Gold /2021 PSA 9',href:'https://www.ebay.com/itm/123?campid=5339046175',image:'https://i.ebayimg.com/card.jpg',price:9.99};
 vm.runInNewContext(sportsLookupScript.slice(sportsLookupScript.indexOf('<script>')+8).replace(/<\/script>$/,''),{document:doc,window:{IntersectionObserver:Observer},IntersectionObserver:Observer,fetch:async()=>{fetches++;return {ok:true,json:async()=>({listing})};}});
 assert.equal(fetches,0,'a collapsed/offscreen finish must not fetch');callback([{target:button,isIntersecting:true}]);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(fetches,1);assert.equal(target.children[0].href,listing.href);assert.equal(target.children[0].rel,'noopener sponsored');
 assert.equal(target.children[0].children[0].src,listing.image);assert.equal(target.children[1].textContent,'eBay · $9.99 USD');
 assert.match(target.children[2].textContent,/Seller title: PSA 9/);
 assert.ok(!button.disabled);
 const once=withSportsLookups({bodyHtml:'<button data-sports-lookup="/lookup"></button>'});
 assert.equal(withSportsLookups(once).bodyHtml,once.bodyHtml,'only one queue per page');
}
console.log('Numbered card families, subset-specific print runs, strict serial/edition matching, affiliate URLs and stock isolation passed');
