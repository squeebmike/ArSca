import fs from 'node:fs';
import assert from 'node:assert/strict';
import {handleLicensedSportsCatalog as handle} from '../scripts/licensed-sports-pages.mjs';
import {licensedSportsSets} from '../scripts/licensed-sports-seed.mjs';
import {sportsSearchResults,sportsPlayerTeamSearch} from '../scripts/sports-card-finder.mjs';
const escape=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let page;const deps={escape,shell:p=>{page=p;return '<title>'+escape(p.title)+'</title>'+p.bodyHtml;}};
const get=(path,method='GET')=>handle(new Request('https://www.themanapocket.com'+path,{method}),{},new URL('https://www.themanapocket.com'+path),deps);
const set=licensedSportsSets[0],root='/hockey/checklists/'+set.id;
for(const path of ['/sports/sets','/sports/sets?sport=hockey','/hockey',root])assert.equal((await get(path)).status,200,path);
let body=await(await get('/sports/sets')).text();assert.match(body,/Upper Deck Series 1/);assert.match(body,/2018 Topps Big League/);assert.match(body,/Football/);
body=await(await get(root)).text();assert.match(body,/250 entries/);assert.match(body,/Young Guns 201–250/);assert.match(body,/id="pack-odds"/);assert.match(body,/Official complete checklist<\/a>/,'HTML publisher source is not mislabeled as a PDF');
const first=set.cards[0],clear=set.sections.find(g=>g.id==='clear-cut-parallel');
const redirect=await get(root+'?view='+clear.id);assert.equal(redirect.status,303);assert.equal(redirect.headers.get('Location'),root+'/sections/'+clear.id);
const xml=await(await get('/sitemap-hockey.xml')).text(),paths=[...xml.matchAll(/<loc>https:\/\/www.themanapocket.com([^<]+)<\/loc>/g)].map(m=>m[1]);
assert.equal(new Set(paths).size,paths.length);assert.ok(paths.includes('/hockey')&&paths.includes(root));
const cards=[...set.cards,...set.sections.flatMap(g=>g.cards)],titles=new Set();
for(const card of cards){const path=root+'/cards/'+card.id;assert.ok(paths.includes(path));const res=await get(path);assert.equal(res.status,200,path);assert.equal(page.canonicalPath,path);assert.ok(!page.jsonLd.image&&!page.jsonLd.offers,'no invented photos or sale offers');assert.ok(!titles.has(page.title));titles.add(page.title);}
assert.equal(titles.size,4418);
for(const group of set.sections){const path=root+'/sections/'+group.id;assert.ok(paths.includes(path));assert.equal((await get(path)).status,200);}
assert.equal((await get(root+'?page=5')).status,200);assert.equal((await get(root+'?page=6')).status,404);
assert.equal((await get(root+'/sections/'+clear.id+'?page=4')).status,200);assert.equal((await get(root+'/sections/'+clear.id+'?page=5')).status,404);
const cardPath=root+'/cards/'+first.id;const metadata=await(await get(cardPath+'?reference=3')).json();assert.deepEqual(metadata,{reference:null,referenceStatus:'not_verified'});
assert.equal(await(await get(cardPath+'?reference=3','HEAD')).text(),'');
for(const path of ['/hockey/checklists/fake','/sports/sets?sport=fake','/sitemap-hockey.xml?part=0',cardPath+'?parallel=wrong&reference=3',cardPath+'?market=1'])assert.equal((await get(path)).status,404,path);
assert.equal(await(await get(root,'HEAD')).text(),'');assert.equal(await get('/unrelated'),null);
body=await(await get(root+'?q=%3Cscript%3E')).text();assert.ok(body.includes('value="&lt;script&gt;"'));assert.ok(!body.includes('value="<script>')); assert.ok(page.robotsNoindex);assert.equal(page.canonicalPath,root);
const query=new URL('https://www.themanapocket.com/sports/checklists?sport=hockey&player=Troy+Terry');const found=sportsSearchResults(query);assert.ok(found.rows.length>1);assert.ok(found.rows.every(r=>r.href.startsWith('/hockey/')&&r.sport==='hockey'));
body=sportsPlayerTeamSearch(query,escape).bodyHtml;assert.match(body,/Hockey/);assert.ok(!body.includes('data-sports-reference="/baseball/'),'hockey never mounts a baseball reference lookup');
console.log('Licensed sports routes: all 4,418 card pages, sections, source metadata, discovery, sitemaps, pagination, search and strict printing isolation passed');

const routeConfig=fs.readFileSync('wrangler.deploy.jsonc','utf8');
for(const pattern of ['sports/sets*','hockey','hockey/*','sitemap-hockey.xml*','sitemap-sports-sets.xml*'])assert.ok(routeConfig.includes('www.themanapocket.com/'+pattern+'"'),'Production zone route required: '+pattern);

const series2=licensedSportsSets.find(s=>s.id==='2024-25-upper-deck-series-2-hockey');
assert.deepEqual(series2.cards.map(c=>Number(c.cardNumber)),Array.from({length:250},(_,i)=>i+251));
assert.equal(series2.sections.length,105);assert.equal(series2.sections.reduce((n,g)=>n+g.cards.length,0),4381);
const secondRoot='/hockey/checklists/'+series2.id;
for(const section of series2.sections){assert.equal((await get(secondRoot+'/sections/'+section.id)).status,200);for(const card of section.cards){assert.equal((await get(secondRoot+'/cards/'+card.id)).status,200);assert.equal(page.canonicalPath,secondRoot+'/cards/'+card.id);}}
assert.equal(series2.sourceExceptions[0].rows.length,6);
assert.equal(series2.cards.find(c=>c.cardNumber==='496').subjects.length,2);
assert.equal(series2.cards.find(c=>c.cardNumber==='500').checklistCard,true);
assert.ok(series2.sections.flatMap(g=>g.cards).some(c=>c.printedSP));
assert.match(await(await get(secondRoot)).text(),/ambiguous rows are withheld/);

const extended=licensedSportsSets.find(s=>s.id==='2024-25-upper-deck-extended-series-hockey');
assert.deepEqual(extended.cards.map(c=>Number(c.cardNumber)),Array.from({length:250},(_,i)=>i+501));
assert.equal(extended.sections.length,86);assert.equal(extended.sections.reduce((n,g)=>n+g.cards.length,0),3643);
assert.equal(extended.cards.filter(c=>c.printedSection==='Base Set - All-Star').length,43);
assert.equal(extended.cards.filter(c=>c.printedSection==='Base Set - Young Guns').length,30);
assert.equal(extended.cards.filter(c=>c.printedSection==='Base Set - 1st Round Rookies').length,20);
assert.equal(extended.sourceExceptions.length,0);
const extendedRoot='/hockey/checklists/'+extended.id;
for(const group of [{cards:extended.cards},...extended.sections]){if(group.id)assert.equal((await get(extendedRoot+'/sections/'+group.id)).status,200);for(const card of group.cards){assert.equal((await get(extendedRoot+'/cards/'+card.id)).status,200);assert.equal(page.canonicalPath,extendedRoot+'/cards/'+card.id);}}
assert.deepEqual(extended.cards.find(c=>c.cardNumber==='730').subjects.map(s=>s.name),['Jonathan Lekkerimaki','Will Smith']);
const allHockeyXml=await(await get('/sitemap-hockey.xml')).text();assert.ok(allHockeyXml.includes(extendedRoot+'/cards/'+extended.cards.at(-1).id));

const basketball=licensedSportsSets.find(s=>s.id==='2025-26-topps-basketball');
assert.equal(basketball.cards.length,300);assert.equal(basketball.sections.length,67);
assert.equal(basketball.sections.reduce((n,g)=>n+g.cards.length,0),3018);
const basketballRoot='/basketball/checklists/'+basketball.id;
assert.equal((await get('/basketball')).status,200);
for(const group of [{cards:basketball.cards},...basketball.sections]){if(group.id)assert.equal((await get(basketballRoot+'/sections/'+group.id)).status,200);for(const card of group.cards){assert.equal((await get(basketballRoot+'/cards/'+card.id)).status,200);assert.equal(page.canonicalPath,basketballRoot+'/cards/'+card.id);}}
assert.equal(basketball.cards.find(c=>c.cardNumber==='201').player,'Cooper Flagg');
const triple=basketball.sections.find(s=>s.id==='1980-81-topps-basketball-triple-autographs');assert.ok(triple.cards.every(c=>c.subjects.length===3));
const dual=basketball.sections.find(s=>s.id==='rookie-photo-shoot-dual-autograph');assert.ok(dual.cards.every(c=>c.subjects.length===2));
assert.equal((await get(basketballRoot+'/cards/'+basketball.cards[0].id+'?parallel=made-up')).status,404);
const basketballXml=await(await get('/sitemap-basketball.xml')).text();assert.ok(basketballXml.includes(basketballRoot+'/cards/'+basketball.cards[0].id));
for(const pattern of ['basketball','basketball/*','sitemap-basketball.xml*'])assert.ok(routeConfig.includes('www.themanapocket.com/'+pattern+'"'));
