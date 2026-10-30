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

// Collected 2022 Platinum uses the exact SP label for publisher image variants.
const platinum=baseballSets.find(s=>s.id==='2022-topps-chrome-platinum-anniversary'),platinumSource='baseball-cards-2022-topps-chrome-platinum-anniversary',platinumVariations=sectionsForSet(platinum).find(g=>g.name==='Base Cards Image Variations'),griffey=platinumVariations.cards.find(c=>c.cardNumber==='450'),griffeyBase=platinum.cards.find(c=>c.cardNumber==='450');
assert.equal(platinumVariations.cards.length,25);
const spRow={consoleId:platinumSource,title:'Ken Griffey Jr. [SP Variation] #450',player:'Ken Griffey Jr.',cardNumber:'450',parallel:'SP Variation',run:'',image:'https://storage.googleapis.com/images.pricecharting.com/corrlwkvmmcownm5rxz4/240.jpg',url:'https://www.sportscardspro.com/game/'+platinumSource+'/ken-griffey-jr-sp-variation-450'};
const spCheck=referenceMetadataCheck(spRow);assert.deepEqual(spCheck.flags,[]);assert.equal(spCheck.matches.length,1);assert.equal(spCheck.matches[0].path,'/baseball/checklists/'+platinum.id+'/cards/'+griffey.id);assert(matchReferenceImage([spRow],platinum,griffey));
assert.equal(matchReferenceImage([spRow],platinum,griffeyBase),null,'SP photo cannot replace uncolored base');
const plainGriffey={...spRow,title:'Ken Griffey Jr. #450',parallel:''};assert.equal(matchReferenceImage([plainGriffey],platinum,griffey),null,'uncolored photo cannot replace SP');assert(matchReferenceImage([plainGriffey],platinum,griffeyBase));
for(const bad of [{...spRow,run:'/1'},{...spRow,title:'Ken Griffey Jr. [Refractor] #450',parallel:'Refractor'},{...spRow,title:'Ken Griffey Jr. [Image Variation] #450',parallel:'Image Variation'},{...spRow,title:'Ken Griffey Jr. [SP Variation] #451',cardNumber:'451'},{...spRow,title:'Shohei Ohtani [SP Variation] #450',player:'Shohei Ohtani'},{...spRow,consoleId:'baseball-cards-2023-topps-chrome-platinum-anniversary'}])assert.equal(matchReferenceImage([bad],platinum,griffey),null,'only exact observed SP identity/source is accepted');
assert.equal(referenceIdentityMatches(spRow,griffey,{...platinum,id:'2023-topps-chrome-platinum-anniversary'}),false,'alias cannot leak to another release');
assert.equal(referenceIdentityMatches(spRow,{...griffey,section:'Base Cards Design Variations'},platinum),false,'alias cannot leak to a different physical section');

const chrome19=baseballSets.find(s=>s.id==='2019-topps-chrome'),rookies19=sectionsForSet(chrome19).find(g=>g.name==='Rookie Autographs'),cimber=rookies19.cards.find(c=>c.cardNumber==='RA-AC'),rookieSource='baseball-cards-2019-topps-chrome-rookie-autographs';
assert.equal(rookies19.cards.length,76);assert(referenceConsoles(chrome19,cimber).includes(rookieSource));assert(!referenceConsoles(chrome19,chrome19.cards[0]).includes(rookieSource));
const cimberRow=normalizeCloudReference({consoleId:rookieSource,productId:'1634512',title:'Adam Cimber #RA-AC',player:'Adam Cimber',cardNumber:'RA-AC',image:'https://storage.googleapis.com/images.pricecharting.com/corrdp4cgnlshkcso2uf/60.jpg',url:'https://www.sportscardspro.com/game/'+rookieSource+'/adam-cimber-ra-ac'});
const cimberCheck=referenceMetadataCheck(cimberRow);assert.deepEqual(cimberCheck.flags,[]);assert.equal(cimberCheck.matches.length,1);assert.equal(cimberCheck.matches[0].path,'/baseball/checklists/'+chrome19.id+'/cards/'+cimber.id);assert(matchReferenceImage([cimberRow],chrome19,cimber));
for(const wrong of [{...cimberRow,title:'Adam Cimber #AC',cardNumber:'AC'},{...cimberRow,title:'Adam Cimber [Refractor] #RA-AC',parallel:'Refractor',run:'/499'},{...cimberRow,title:'Austin Dean #RA-AC',player:'Austin Dean'}])assert.equal(matchReferenceImage([wrong],chrome19,cimber),null,'exact autograph number, subject and uncolored finish remain required');
assert.equal(referenceMetadataCheck({...cimberRow,consoleId:'baseball-cards-2019-topps-chrome-autographs',url:cimberRow.url.replace('chrome-rookie-autographs','chrome-autographs')}).matches.length,0,'generic autograph source is not a rookie source alias');

const pristine23=baseballSets.find(s=>s.id==='2023-topps-pristine-baseball'),pristineAutos=sectionsForSet(pristine23).find(g=>g.name==='Pristine Autographs'),burleson=pristineAutos.cards.find(c=>c.cardNumber==='PA-AB'),pristineSource='baseball-cards-2023-topps-pristine-autographs';
assert.equal(pristineAutos.cards.length,74);assert(referenceConsoles(pristine23,burleson).includes(pristineSource));assert(!referenceConsoles(pristine23,pristine23.cards[0]).includes(pristineSource));
const burlesonRow=normalizeCloudReference({consoleId:pristineSource,productId:'5776007',title:'Alec Burleson #PA-AB',player:'Alec Burleson',cardNumber:'PA-AB',image:'https://storage.googleapis.com/images.pricecharting.com/corra2hmn3mcv2vnl5fp/60.jpg',url:'https://www.sportscardspro.com/game/'+pristineSource+'/alec-burleson-pa-ab'});
const burlesonCheck=referenceMetadataCheck(burlesonRow);assert.deepEqual(burlesonCheck.flags,[]);assert.equal(burlesonCheck.matches.length,1);assert.equal(burlesonCheck.matches[0].path,'/baseball/checklists/'+pristine23.id+'/cards/'+burleson.id);assert(matchReferenceImage([burlesonRow],pristine23,burleson));
for(const wrong of [{...burlesonRow,title:'Alec Burleson #216',cardNumber:'216'},{...burlesonRow,title:'Alec Burleson [Refractor] #PA-AB',parallel:'Refractor',run:'/99'},{...burlesonRow,title:'Alex Bregman #PA-AB',player:'Alex Bregman'}])assert.equal(matchReferenceImage([wrong],pristine23,burleson),null,'Pristine autograph number, subject and uncolored finish stay exact');
