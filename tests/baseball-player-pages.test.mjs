import assert from 'node:assert/strict';
import {baseballPlayers,baseballPlayerPath} from '../scripts/baseball-player-pages.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {handleBaseballCatalog,baseballCardPath} from '../scripts/baseball-catalog-pages.mjs';
let page;
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const deps={escape,slug:s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-'),available:i=>i.quantity>0,listItems:async()=>[],shell:p=>{page=p;return p.bodyHtml;}};
const get=path=>handleBaseballCatalog(new Request('https://www.themanapocket.com'+path),{},new URL('https://www.themanapocket.com'+path),deps);
const players=baseballPlayers(baseballSets);assert.equal(players.length,772);
const index=await(await get('/baseball/players')).text();const xml=await(await get('/sitemap-baseball.xml')).text();
for(const player of players){
 const path=baseballPlayerPath(player);assert.ok(index.includes('href="'+path+'"'));assert.ok(xml.includes('https://www.themanapocket.com'+path));
 const res=await get(path),body=await res.text();assert.equal(res.status,200);assert.equal(page.canonicalPath,path);assert.ok(!page.robotsNoindex);
 assert.ok(new Set(player.rows.map(r=>r.set.id)).size>=2);
 for(const row of player.rows)assert.ok(body.includes(baseballCardPath(row.set,row.card)));
 assert.ok(body.includes(player.team));assert.ok(!body.includes('"offers"'));
}
assert.equal((await get('/baseball/players/does-not-exist')).status,404);
await get('/baseball/players?q=Trout');assert.ok(page.robotsNoindex);assert.equal(page.canonicalPath,'/baseball/players');
const fixture=[{id:'one',cards:[{id:'a',subjects:[{name:'Same Name',team:'Team A'},{name:'Same Name',team:'Team B'},{name:'Team A',team:'Team A'}]}]},{id:'two',cards:[{id:'b',subjects:[{name:'Same Name',team:'Team A'}]}]}];
const grouped=baseballPlayers(fixture);assert.equal(grouped.length,1);assert.equal(grouped[0].team,'Team A');assert.equal(grouped[0].rows.length,2);
console.log('772 cross-set player/team profiles preserve exact card links, printed teams, sitemap discovery and reference-only semantics');
