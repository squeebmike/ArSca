import assert from 'node:assert/strict';
import {sportsPlayerTeamSearch,sportsReferenceRows,normalizeSportsCardNumber} from '../scripts/sports-player-team-search.mjs';
import {cardParallelProgram,selectedParallelCard} from '../scripts/sports-parallels.mjs';
import {savedReferenceImage} from '../scripts/sports-reference-images.mjs';
import {handleBaseballCatalog} from '../scripts/baseball-catalog-pages.mjs';
import {sportsListingMatches} from '../scripts/sports-card-marketplace.mjs';
import {normalizeCloudReference} from '../scripts/cloud-card-references.mjs';
import {referenceMetadataCheck} from '../scripts/reference-validation.mjs';
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const result=(query)=>sportsPlayerTeamSearch(new URL('https://www.themanapocket.com/sports/checklists?'+query),esc);
const target=sportsReferenceRows().find(r=>r.card.cardNumber==='FSA-G');
assert.equal(target.card.player,'Ken Griffey Jr.');
assert.equal(target.type,'autographs');
assert.ok(sportsListingMatches({title:'2024 Topps Five Star Ken Griffey Jr FSA-G Auto Seattle Mariners'},target.card,target.set,{kind:'Autographs',name:'Base Autographs'}));
for(const number of ['FSA-G','fsa-g','Fsa-g','#Fsa-g',' FSA–G ']){
 const data=result('number='+encodeURIComponent(number));
 assert.ok(data.robotsNoindex);assert.match(data.bodyHtml,/1 matching checklist entries/);
 assert.ok(data.bodyHtml.includes(target.href));
 assert.match(data.bodyHtml,/corrruru7z42freht4tg\/240.jpg/,'card-number results include the exact primary reference image');
 assert.match(data.bodyHtml,/Parallels &amp; numbered versions \(7\)/);
}
assert.equal(normalizeSportsCardNumber('# Fsa-g'),'fsa-g');
assert.match(result('number=FSA').bodyHtml,/0 matching checklist entries/,'number matching is exact, not prefix matching');
for(const input of ['q=fsa-g','player=Fsa-g'])assert.ok(result(input).bodyHtml.includes(target.href));
assert.match(result('number=FSA-G&player=Mike+Trout').bodyHtml,/0 matching checklist entries/,'explicit filters remain combined');
assert.match(result('number=FSA-G&sport=football').bodyHtml,/0 matching checklist entries/);
const repeated=result('number=FSA-BW');assert.ok(repeated.bodyHtml.includes('Bobby Witt Jr.'));assert.ok(repeated.bodyHtml.includes('Billy Williams'),'same code does not collapse different players');
assert.doesNotMatch(result('number=%22%3E%3Cscript%3E').bodyHtml,/<script>/);
const family=cardParallelProgram(target.set,target.card);
assert.deepEqual(family.variants.map(v=>v.printRun),[75,50,25,15,10,5,1]);
assert.ok(savedReferenceImage(target.set,target.card));
for(const id of ['blue','green','orange'])assert.ok(savedReferenceImage(target.set,selectedParallelCard(target.set,target.card,id)));
const blue=savedReferenceImage(target.set,selectedParallelCard(target.set,target.card,'blue'));
const upload={...blue,cardNumber:'FSA-G',player:'Ken Griffey Jr.',parallel:'Blue',run:'',consoleId:'baseball-cards-2024-topps-five-star-autograph'};
const normalized=normalizeCloudReference(upload);assert.equal(normalized.run,'/25');assert.equal(referenceMetadataCheck(normalized).matches.length,1,'reviewed serial evidence survives a later collector upload');
assert.equal(normalizeCloudReference({...upload,image:'https://storage.googleapis.com/images.pricecharting.com/unknownphoto/240.jpg'}).run,'','never attach reviewed numbering to another photo');
assert.equal(normalizeCloudReference({...upload,run:'/50'}).run,'/50','conflicting source information remains visible to validation');
for(const id of ['aqua','purple','gold','red'])assert.equal(savedReferenceImage(target.set,selectedParallelCard(target.set,target.card,id)),null,'no main-photo substitution for missing '+id);
let inventoryReads=0;
const deps={escape:esc,slug:s=>s,available:i=>i.quantity>0,listItems:async()=>{inventoryReads++;return [];},shell:data=>data.bodyHtml};
for(const path of ['/sports/checklists?number=fsa-g',target.href,target.href+'?parallel=blue']){
 const url=new URL(path,'https://www.themanapocket.com');const response=await handleBaseballCatalog(new Request(url),{},url,deps);assert.equal(response.status,200,path);
}
assert.equal(inventoryReads,2,'search uses immutable checklist identities and makes no inventory query');
const pricedUrl=new URL(target.href+'?market=1','https://www.themanapocket.com');
const market=await handleBaseballCatalog(new Request(pricedUrl),{},pricedUrl,deps);assert.equal(market.status,200);assert.ok((await market.json()).reference?.image.includes('corrruru7z42freht4tg'));
assert.equal(inventoryReads,2,'reference and marketplace lookups do not fetch Supabase inventory');
console.log('Sports card-number search, exact identity, parallel families and reference photos passed');
