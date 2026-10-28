import assert from 'node:assert/strict';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {sectionsForSet} from '../scripts/baseball-section-pages.mjs';
import {selectedParallelCard} from '../scripts/sports-parallels.mjs';
import {referenceMetadataCheck} from '../scripts/reference-validation.mjs';
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
