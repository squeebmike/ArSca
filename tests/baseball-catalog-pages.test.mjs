import assert from 'node:assert/strict';
import {handleBaseballCatalog,baseballSetPath,baseballCardPath} from '../scripts/baseball-catalog-pages.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {baseballTeams} from '../scripts/baseball-team-pages.mjs';
import {baseballPlayers} from '../scripts/baseball-player-pages.mjs';
import {baseballSectionSitemapPaths,sectionsForSet} from '../scripts/baseball-section-pages.mjs';
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
let lastPage;
const deps={escape,slug:s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-'),available:i=>i.quantity>0,listItems:async()=>[],shell:p=>{lastPage=p;return '<title>'+escape(p.title)+'</title><link rel="canonical" href="https://www.themanapocket.com'+p.canonicalPath+'">'+(p.robotsNoindex?'<meta name="robots" content="noindex,follow">':'')+'<script type="application/ld+json">'+JSON.stringify(p.jsonLd)+'</script>'+p.bodyHtml;}};
const get=(path,env={},method='GET')=>handleBaseballCatalog(new Request('https://www.themanapocket.com'+path,{method}),env,new URL('https://www.themanapocket.com'+path),deps);
assert.equal((await get('/baseball')).status,200);
let res=await get('/sitemap-baseball.xml'),xml=await res.text();
assert.match(xml,/<sitemapindex/);let combined='';
for(const m of xml.matchAll(/<loc>https:\/\/www.themanapocket.com([^<]+)<\/loc>/g)){const child=await get(m[1]);assert.equal(child.status,200);const part=await child.text();assert.ok((part.match(/<url>/g)||[]).length<=40000);combined+=part;}xml=combined;
assert.equal((await get('/sitemap-baseball.xml?part=0')).status,404);assert.equal((await get('/sitemap-baseball.xml?part=99')).status,404);
const paths=[...xml.matchAll(/<loc>https:\/\/www.themanapocket.com([^<]+)<\/loc>/g)].map(m=>m[1]);
assert.equal(paths.length,3+baseballSets.length+baseballSets.reduce((n,s)=>n+s.cards.length,0)+baseballTeams(baseballSets).length+baseballPlayers(baseballSets).length+baseballSectionSitemapPaths(baseballSets).length);assert.equal(new Set(paths).size,paths.length);
const titles=new Set(),h1s=new Set();
for(const set of baseballSets) {
 const identities=new Set(set.cards.map(c=>c.cardNumber+'|'+c.player));assert.equal(identities.size,set.cards.length);
 const numbers=new Set(set.cards.map(c=>c.cardNumber));if(set.id==='2024-topps-five-star-baseball')assert.equal(numbers.size,131,'Five Star reuses seven codes for distinct players');else assert.equal(numbers.size,set.cards.length);
 const expectedCounts={'2024-topps-five-star-baseball':138,'2020-topps-baseball-series-1':350,'2020-topps-baseball-series-2':350,'2020-topps-updates-baseball':300,'2021-topps-series-1-baseball':330,'2021-topps-series-2-baseball':330,'2021-topps-updates-baseball':330,'2026-topps-chrome-baseball':300,'2024-topps-cosmic-chrome-baseball':200,'2024-topps-stadium-club-baseball':300,'2022-topps-cosmic-chrome':200,'2022-topps-stadium-club-chrome':400,'2021-bowman-draft-baseball':200,'2025-topps-holiday-baseball':200,'2026-topps-heritage-baseball':400,'2024-topps-archives-baseball':300,'2025-topps-heritage-baseball':500,'2022-topps-gallery-baseball':200,'2024-topps-baseball-series-1':350,'2024-topps-baseball-series-2':350,'2022-topps-update-baseball':330,'2023-bowman-sterling-baseball':100,'2024-bowman-baseball':100,'2024-bowman-chrome-baseball':100,'2023-bowman-s-best-baseball':70,'2023-topps-chrome-update-series-baseball':220,'2025-topps-chrome-baseball':300,'2022-topps-chrome-platinum-anniversary':500,'2022-topps-chrome-updates-baseball':200,'2023-topps-cosmic-chrome-baseball':200,'2024-topps-chrome-baseball':300,'2024-topps-chrome-update-series-baseball':200,'2022-topps-chrome-baseball-sonic-edition':220,'2023-topps-finest-baseball':100,'2023-topps-pristine-baseball':300,'2019-topps-series-1-baseball':350,'2019-topps-series-2-baseball':350,'2023-topps-series-1':330,'2023-topps-series-2':330,'2023-topps-update':329,'2019-topps-chrome':204,'2023-bowman':100,'2023-bowman-chrome':100,'2023-topps-chrome':220,'2025-topps-series-1-baseball':350,'2026-topps-series-1-baseball':350,'2025-topps-update-series-baseball':350,'2026-topps-series-2-baseball':350,'2025-topps-series-2-baseball':350,'2026-topps-update-series-baseball':350,'2025-bowman-baseball':100,'2026-bowman-baseball':100,'2025-bowman-draft-baseball':200,'2026-bowman-chrome-baseball':100,'2026-topps-holiday-baseball':200};
 assert.equal(set.cards.length,expectedCounts[set.id]);
 for(let page=1;page<=Math.ceil(set.cards.length/60);page++) {
  const path=baseballSetPath(set)+(page>1?'?page='+page:'');
  assert.equal((await get(path)).status,200);assert.equal(lastPage.canonicalPath,path);
 }
 assert.equal((await get(baseballSetPath(set)+'?page='+(Math.ceil(set.cards.length/60)+1))).status,404);
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
body=await(await get(baseballCardPath(set,card))).text();assert.ok(body.includes('/item/exact/'));assert.ok(body.includes('/item/wrong-parallel/'));assert.ok(body.includes('Gold')&&body.includes('may include parallels'),'card-family links identify the actual parallel');
body=await(await get(baseballSetPath(set)+'?q=Juan')).text();assert.ok(body.includes('noindex,follow'));assert.ok(body.includes('Juan Soto'));assert.equal(lastPage.canonicalPath,baseballSetPath(set));
assert.equal((await get('/baseball/checklists/unknown')).status,404);
assert.equal((await get('/baseball',{},'HEAD')).status,200);
assert.equal(await(await get('/baseball',{},'HEAD')).text(),'');
assert.equal(await get('/unrelated'),null);
deps.listItems=async()=>{throw Error('Temporary inventory outage');};
body=await(await get(baseballCardPath(set,card))).text();assert.ok(body.includes('Store availability is temporarily unavailable'));assert.ok(!body.includes('No exact matching copy'));
deps.listItems=async()=>[];
const chrome=baseballSets.find(s=>s.id==='2023-topps-chrome'),sections=sectionsForSet(chrome);
assert.deepEqual(sections.slice(0,6).map(g=>g.cards.length),[15,129,20,10,25,30]);
assert.equal(sections.find(g=>g.id==='future-stars').cards.find(c=>c.cardNumber==='FS-13').player,'Julio Rodríguez');
assert.equal(sections.find(g=>g.id==='topps-chrome-expose').cards.at(-1).cardNumber,'TCE-30');
assert.equal(new Set(sections.slice(0,6).flatMap(g=>g.cards.map(c=>c.id))).size,229);
for(const path of baseballSectionSitemapPaths(baseballSets)){
 assert.ok(paths.includes(path));res=await get(path,{EBAY_PARTNER_CAMPAIGN_ID:'5339046175'});body=await res.text();assert.equal(res.status,200);assert.ok(body.includes('campid=5339046175')||(path.endsWith('/sections/all-parallels')&&body.includes('?parallel=')));assert.ok(!body.includes('"offers"'));assert.equal(lastPage.canonicalPath,path);
}
const auto=sections[1].cards[0],autoPath=baseballCardPath(chrome,auto);
deps.listItems=async()=>[{id:'auto-copy',categorySlug:'sports-cards',name:'Alec Burleson autograph',year:2023,set:chrome.displayName,player:auto.player,cardNumber:auto.cardNumber,subset:auto.section,variant:'Base',price:12,quantity:1},{id:'wrong-base',categorySlug:'sports-cards',name:'Wrong base',year:2023,set:chrome.displayName,player:auto.player,cardNumber:'1',subset:'Base',variant:'Base',price:1,quantity:1}];
body=await(await get(autoPath,{EBAY_PARTNER_CAMPAIGN_ID:'5339046175'})).text();assert.ok(body.includes('/item/auto-copy/'));assert.ok(!body.includes('/item/wrong-base/'));assert.ok(body.indexOf('/item/auto-copy/')<body.indexOf('campid='));
const sectionPath='/baseball/checklists/2023-topps-chrome/sections/rookie-autographs';
assert.equal((await get(sectionPath+'?page=3')).status,200);assert.equal((await get(sectionPath+'?page=4')).status,404);
body=await(await get(sectionPath+'?q=Burleson')).text();assert.equal(lastPage.robotsNoindex,true);assert.equal(lastPage.canonicalPath,sectionPath);assert.ok(body.includes('Alec Burleson'));
assert.equal((await get('/baseball/checklists/2023-topps-chrome/sections/unknown')).status,404);
console.log(paths.length+' sitemap URLs, base and reviewed insert/autograph pages, pagination and exact-stock affiliate gates passed');

for(const [id,first,last] of [['2019-topps-series-1-baseball',1,350],['2019-topps-series-2-baseball',351,700]]){const s=baseballSets.find(s=>s.id===id);assert.deepEqual(s.cards.map(c=>Number(c.cardNumber)),Array.from({length:350},(_,i)=>first+i));assert.equal(Number(s.cards.at(-1).cardNumber),last);assert.ok(!s.cards.some(c=>c.variant!=='Base'));}

// Stock-driven additions preserve exact publisher section boundaries.
const {baseballStockedSets,baseballStockedSections}=await import('../scripts/topps/baseball-stocked-2026-10.mjs');
assert.equal(baseballStockedSets.length,9);assert.equal(baseballStockedSets.reduce((n,s)=>n+s.cards.length,0),2320);
for(const s of baseballStockedSets){assert.match(s.sourceSha256,/^[a-f0-9]{64}$/);assert.match(s.sourceUrl,/^https:\/\/cdn\.shopify\.com\//);assert.doesNotMatch(s.displayName,/Â|�/);assert.ok(s.cards.every(c=>c.section==='Base'&&c.variant==='Base'));}
const autographCounts={'2025-topps-chrome-baseball':166,'2024-topps-chrome-baseball':154,'2022-topps-chrome-platinum-anniversary':130,'2023-topps-finest-baseball':92};
for(const s of baseballStockedSections){assert.equal(s.sections[0].cards.length,autographCounts[s.setId]);assert.ok(s.sections[0].cards.every(c=>c.section!=='Base'));}
const {baseballStockedMoreSets,baseballStockedMoreSections}=await import('../scripts/topps/baseball-stocked-more-2026-10.mjs');
assert.equal(baseballStockedMoreSets.length,5);assert.equal(baseballStockedMoreSets.reduce((n,s)=>n+s.cards.length,0),590);
assert.equal(baseballStockedMoreSections.flatMap(s=>s.sections).reduce((n,g)=>n+g.cards.length,0),905);
for(const s of baseballStockedMoreSections)for(const g of s.sections){assert.equal(new Set(g.cards.map(c=>c.cardNumber)).size,g.cards.length);assert.ok(g.cards.every(c=>c.section===g.name));}

const {baseballStockedCurrentSets}=await import('../scripts/topps/baseball-stocked-current-2026-10.mjs');
assert.equal(baseballStockedCurrentSets.length,8);assert.equal(baseballStockedCurrentSets.reduce((n,s)=>n+s.cards.length,0),2630);
const heritage=baseballStockedCurrentSets.find(s=>s.id==='2026-topps-heritage-baseball');
assert.ok(heritage.cards.find(c=>c.cardNumber==='372').subjects.length===4);
assert.ok(heritage.cards.find(c=>c.cardNumber==='333').subjects[0].note.includes('Short print'));
const series=baseballStockedCurrentSets.find(s=>s.id==='2024-topps-baseball-series-1');
assert.equal(series.cards.find(c=>c.cardNumber==='138').subjects[0].team,'','league affiliation is not invented as a club team');
assert.equal(series.cards.find(c=>c.cardNumber==='138').sourceAffiliation,'Major League Baseball');

// New insert sections preserve existing sections of the same release and never
// leak their numbered cards into its base checklist.
import {baseballStockedInsertSections} from '../scripts/topps/baseball-stocked-inserts-2026-10.mjs';
import {baseballChecklistInventoryMatches} from '../scripts/topps/public-checklist-policy.mjs';
assert.equal(baseballStockedInsertSections.flatMap(g=>g.sections.flatMap(s=>s.cards)).length,218);
const insertExamples=[
 ['2025-topps-chrome-baseball','Chrome All Etch','All Etch','CAE-15','Julio Rodriguez'],
 ['2023-topps-pristine-baseball','Oh Snap','Oh Snap','OS-9','Julio Rodriguez'],
 ['2023-bowman-s-best-baseball','Best of 2023 Early Form Autographs','of Autographs','B23-MA','Michael Arroyo'],
 ['2023-bowman-sterling-baseball','Sterling Tek','Tek','ST-20','Julio Rodriguez'],
 ['2022-topps-update-baseball','Stars of MLB','Stars of MLB','SMLB-87','Julio Rodriguez'],
 ['2026-bowman-baseball','Power Chords','Power Chords','PC-11','Shohei Ohtani'],
];
for(const [id,section,alias,number,player] of insertExamples){
 const set=baseballSets.find(s=>s.id===id),group=sectionsForSet(set).find(g=>g.name===section),card=group.cards.find(c=>c.cardNumber===number);
 assert.ok(card,section);assert.ok(group.kind);
 assert.ok(!set.cards.some(c=>c.id===card.id),'insert stays separate from base');
 const item={categorySlug:'sports-cards',isSealed:false,year:set.year,set:set.displayName.replace(/\s+baseball$/i,'')+' '+alias,name:player+' #'+number};
 assert.equal(baseballChecklistInventoryMatches(item,card,set),true,section);
 assert.equal(baseballChecklistInventoryMatches({...item,year:set.year-1},card,set),false,'conflicting year stays blocked');
}
assert.ok(sectionsForSet(baseballSets.find(s=>s.id==='2025-topps-chrome-baseball')).some(g=>g.id==='rookie-autographs'));

import {baseballStockedOctober21Sets} from '../scripts/topps/baseball-stocked-2026-10-21.mjs';
assert.equal(baseballStockedOctober21Sets.reduce((n,s)=>n+s.cards.length,0),1300);
const stadium=baseballSets.find(s=>s.id==='2022-topps-stadium-club-chrome');
const future=sectionsForSet(stadium).find(g=>g.id==='team-of-the-future').cards.find(c=>c.cardNumber==='TOF-13');
assert.equal(baseballChecklistInventoryMatches({categorySlug:'sports-cards',set:'Baseball Cards 2022 Stadium Club Chrome Team of the Future',name:'Julio Rodriguez #TOF-13'},future,stadium),true);
assert.equal(baseballChecklistInventoryMatches({categorySlug:'sports-cards',set:'Baseball Cards 2022 Stadium Club Team of the Future',name:'Julio Rodriguez #TOF-13'},future,stadium),false,'Chrome remains a distinct release');
const historical=baseballSets.find(s=>s.id==='2024-topps-stadium-club-baseball').cards.find(c=>c.cardNumber==='107');
assert.equal(historical.player,'Josh Gibson');assert.equal(historical.team,'Homestead','preserve the exact publisher team label');
const enterprise=sectionsForSet(baseballSets.find(s=>s.id==='2026-topps-heritage-baseball')).find(g=>g.id==='the-enterprise');
assert.equal(enterprise.cards.length,30);assert.ok(enterprise.cards.some(c=>c.cardNumber==='TE-JR'&&c.player==='Julio Rodríguez'));

{
 const {sportsReferenceRows,sportsPlayerTeamSearch}=await import('../scripts/sports-player-team-search.mjs');
 const source=sportsReferenceRows();assert.ok(source.some(r=>r.type==='autographs'&&r.sport==='football'));
 const sample=source.find(r=>r.type==='autographs'&&r.card.subjects[0]?.team);
 const subject=sample.card.subjects[0];const url=new URL('https://www.themanapocket.com/sports/checklists');url.searchParams.set('player',subject.name);url.searchParams.set('team',subject.team);url.searchParams.set('type','autographs');
 const result=sportsPlayerTeamSearch(url,escape);assert.ok(result.robotsNoindex);assert.match(result.bodyHtml,/name="player"/);assert.match(result.bodyHtml,/name="team"/);assert.ok(result.bodyHtml.includes(sample.href));
 assert.equal((await get('/sports/checklists')).status,200);
 assert.equal((await get('/sports/checklists?page=999999')).status,404);
 const hostile=new URL('https://www.themanapocket.com/sports/checklists?player=%22%3E%3Cscript%3E');assert.doesNotMatch(sportsPlayerTeamSearch(hostile,escape).bodyHtml,/<script>/);
 assert.ok(source.every(r=>r.href.startsWith('/'+r.sport+'/checklists/')));
}

assert.match((await import('node:fs')).readFileSync('wrangler.deploy.jsonc','utf8'),/www\.themanapocket\.com\/sports\/checklists\*/,'Cloudflare route must include query-string filter requests');
