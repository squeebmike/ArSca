import assert from 'node:assert/strict';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {sectionsForSet} from '../scripts/baseball-section-pages.mjs';
import {selectedParallelCard} from '../scripts/sports-parallels.mjs';
import {referenceIdentityMatches,matchReferenceImage} from '../scripts/reference-match.mjs';
import {referenceMetadataCheck,referenceConsoles} from '../scripts/reference-validation.mjs';
import {normalizeCloudReference} from '../scripts/cloud-card-references.mjs';
const set=baseballSets.find(s=>s.id==='2024-topps-stadium-club-baseball'),base=set.cards[0],consoleId='baseball-cards-2024-topps-stadium-club';
for(const [id,finish,run]of [['red-foil','Red',''],['black-foil','Black',''],['gold-foil','Gold',''],['black-and-white','Black White',''],['blue-foil','Blue','/50'],['photographer-s-proof','Proof','']]){
 const row={consoleId,title:'Mike Trout ['+finish+'] #1',cardNumber:'1',player:'Mike Trout',parallel:finish,run,image:'https://storage.googleapis.com/images.pricecharting.com/testcard/240.jpg',url:'https://www.sportscardspro.com/game/'+consoleId+'/mike-trout-'+id+'-1'};
 const check=referenceMetadataCheck(row);assert.equal(check.flags.length,0,JSON.stringify({finish,check}));assert.equal(check.matches[0].path,'/baseball/checklists/'+set.id+'/cards/'+base.id+'?parallel='+id);
 if(run){assert.equal(referenceMetadataCheck({...row,run:'/25'}).matches.length,0,'wrong run is still rejected');}
}
for(const [section,finish]of [['Base Set Chrome Variation','Chrome'],['Base Cards Image Variations','Image Variation'],['Base Cards Design Variations','Design Variation']]){
 const row={consoleId,title:'Mike Trout ['+finish+'] #1',cardNumber:'1',player:'Mike Trout',parallel:finish,run:'',image:'https://storage.googleapis.com/images.pricecharting.com/testcard/240.jpg',url:'https://www.sportscardspro.com/game/'+consoleId+'/mike-trout-variation-1'};
 const check=referenceMetadataCheck(row);assert.equal(check.flags.length,0,JSON.stringify(check));assert.equal(check.matches[0].path,'/baseball/checklists/'+set.id+'/cards/'+sectionsForSet(set).find(g=>g.name===section).cards[0].id);
}
console.log('2024 Stadium Club source-only finish aliases restore exact photos while preserving numbering and subset identity');

const chrome=sectionsForSet(set).find(g=>g.name==='Base Set Chrome Variation').cards[0];
assert.equal(referenceIdentityMatches({consoleId,title:'Mike Trout [Chrome Refractor] #1',run:''},chrome),false,'Chrome refractor cannot collide with plain Chrome');

const autographSource='baseball-cards-2024-topps-stadium-club-chrome-autograph',autographs=sectionsForSet(set).find(g=>g.name==='Chrome Autograph Cards'),abbott=autographs.cards.find(c=>c.cardNumber==='SCCA-AA');
assert.equal(autographs.cards.length,93);
for(const c of [...set.cards,...sectionsForSet(set).flatMap(g=>g.cards)])assert.equal(referenceConsoles(set,c).includes(autographSource),c.section==='Chrome Autograph Cards','Chrome autograph source is excluded from base, variations and other autograph sections');
for(const other of baseballSets.filter(s=>s.id!==set.id))assert(!referenceConsoles(other).includes(autographSource),'source cannot leak into another release or year');
const autographRow=normalizeCloudReference({consoleId:autographSource,productId:'7752985',title:'Andrew Abbott #SCCA-AA',player:'Andrew Abbott',cardNumber:'SCCA-AA',parallel:'',run:'',image:'https://storage.googleapis.com/images.pricecharting.com/corrfpoefaaqyy45pkkc/60.jpg',url:'https://www.sportscardspro.com/game/'+autographSource+'/andrew-abbott-scca-aa',capturedAt:new Date().toISOString(),referencePrices:{currency:'USD',ungraded:11.60,grade9:17.48,psa10:25.60}});
assert(autographRow);assert.deepEqual(referenceMetadataCheck(autographRow).flags,[]);
assert.equal(referenceMetadataCheck(autographRow).matches[0].path,'/baseball/checklists/'+set.id+'/cards/'+abbott.id);
const matchedAutograph=matchReferenceImage([autographRow],set,abbott);assert(matchedAutograph);assert.equal(matchedAutograph.image,autographRow.image);assert.equal(matchedAutograph.referencePrices.ungraded,11.60);assert.equal(matchedAutograph.referencePrices.grade9,17.48);assert.equal(matchedAutograph.referencePrices.psa10,25.60);
assert.equal(matchReferenceImage([{...autographRow,title:'Andrew Alvarez #SCCA-AA'}],set,abbott),null,'another subject cannot supply this autograph');
assert.equal(matchReferenceImage([{...autographRow,title:'Andrew Abbott #SCCA-AB'}],set,abbott),null,'another number cannot supply this autograph');
for(const [finish,run]of [['Red','/50'],['Orange','/10'],['Superfractor','/1']]){
 assert.equal(selectedParallelCard(set,abbott,finish.toLowerCase()),null,'unregistered autograph finishes are not published from provider rows');
 assert.equal(referenceMetadataCheck({...autographRow,title:'Andrew Abbott ['+finish+'] #SCCA-AA',parallel:finish,run}).matches.length,0,'observed colored row cannot substitute for uncolored autograph');
}
