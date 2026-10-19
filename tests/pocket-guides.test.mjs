import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {handlePocketGuides,pocketGuideEntries,pocketGuideCategories,pocketGuidePaths} from '../scripts/pocket-guides.mjs';
const require=createRequire(import.meta.url),{parseHTML}=require('linkedom');
const articles=[{slug:'mtg-final-fantasy-mtg-2025-collector-guide',title:'FINAL FANTASY guide',summary:'Cards and scenes',image:'https://example.com/cover.jpg',publishedAt:'2026-10-17'},{slug:'pokemon-prismatic-evolutions-2025-collector-guide',title:'Pokémon Eevee guide',summary:'Pick a favorite',publishedAt:'2026-10-17'},{slug:'absolute-batman-25-covers-presale',title:'Batman #25',summary:'Exact covers',books:['Batman #25'],publishedAt:'2026-10-04'}];
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let page;const deps={escape,loadArticles:async()=>articles,shell:p=>{page=p;return p.bodyHtml;}};
const get=(path,method='GET')=>handlePocketGuides(new Request('https://www.themanapocket.com'+path,{method}),{},new URL('https://www.themanapocket.com'+path),deps);
const entries=pocketGuideEntries(articles),seen=new Set();
assert.equal(entries.length,new Set(entries.map(e=>e.url)).size,'one canonical destination per entry');
assert.equal(pocketGuidePaths.length,pocketGuideCategories.length+1);
for(const path of pocketGuidePaths){
 let number=1;while(true){const url=path+(number>1?'?page='+number:''),r=await get(url);assert.equal(r.status,200);const body=await r.text(),{document:d}=parseHTML(body);
 assert.equal(page.canonicalPath,url);assert.equal(page.robotsNoindex,false);assert.equal(page.jsonLd['@type'],'CollectionPage');assert.equal(d.querySelectorAll('h1').length,1);
 for(const link of d.querySelectorAll('.pg-guide'))seen.add(link.getAttribute('href'));
 const next=[...d.querySelectorAll('.pg-pages a')].find(a=>a.textContent.includes('Next'));
 if(!next)break;assert.equal(next.getAttribute('href'),path+'?page='+(number+1));number++;assert.ok(number<20);
 }
}
assert.deepEqual([...seen].sort(),entries.map(e=>e.url).sort(),'ordinary topic and pagination links discover every published entry');
let body=await(await get('/pocket-guides')).text();assert.ok(body.includes('width="80" height="112"')&&body.includes('loading="lazy"'));assert.ok(body.includes('var(--wo-button')&&body.includes('var(--wo-text'));
assert.equal((await get('/pocket-guides/no-such-section')).status,404);assert.ok(page.robotsNoindex);
assert.equal((await get('/pocket-guides/mtg/nested')).status,404);
assert.equal((await get('/pocket-guides?page=999')).status,404);
assert.equal((await get('/pocket-guides?page=NaN')).status,404);
body=await(await get('/pocket-guides?q=%3Cscript%3Ebad%3C%2Fscript%3E')).text();assert.ok(!body.includes('<script>bad'));assert.ok(body.includes('&lt;script&gt;'));assert.ok(page.robotsNoindex);assert.equal(page.canonicalPath,'/pocket-guides');
body=await(await get('/pocket-guides/secret-lair?q=Garfield')).text();assert.equal(parseHTML(body).document.querySelectorAll('.pg-guide').length,3);
assert.equal((await get('/pocket-guides/')).status,301);
assert.equal(await(await get('/pocket-guides','HEAD')).text(),'');assert.equal(await get('/shop'),null);
deps.loadArticles=async()=>{throw Error('CMS down');};assert.equal((await get('/pocket-guides')).status,503);assert.equal((await get('/pocket-guides')).headers.get('Retry-After'),'60');
console.log('Pocket Guides: complete HTML discovery, topic pagination, search safety, schema, theme, canonical URLs and honest outages passed');

assert.ok(fs.readFileSync(new URL('../wrangler.deploy.jsonc',import.meta.url),'utf8').includes('www.themanapocket.com/pocket-guides*'), 'root query pagination and search must match the Worker route');
