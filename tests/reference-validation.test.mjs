import assert from 'node:assert/strict';
import {referenceMetadataCheck,referenceConsoles,checkReferenceImage,validReferenceConsoleId} from '../scripts/reference-validation.mjs';
import {matchReferenceImage} from '../scripts/reference-match.mjs';
import {baseballSets} from '../scripts/topps/baseball-seed.mjs';
import {sectionsForSet} from '../scripts/baseball-section-pages.mjs';
import {cardParallelProgram,selectedParallelCard} from '../scripts/sports-parallels.mjs';
const base={consoleId:'baseball-cards-2026-topps',title:'Aaron Judge #1',player:'Aaron Judge',parallel:'',run:'',cardNumber:'1',image:'https://storage.googleapis.com/images.pricecharting.com/card123/240.jpg',url:'https://www.sportscardspro.com/game/baseball-cards-2026-topps/aaron-judge-1'};
assert.deepEqual(referenceMetadataCheck(base).flags,[]);assert.equal(referenceMetadataCheck(base).matches.length,1);
assert.ok(referenceMetadataCheck({...base,player:'Different Player'}).flags.includes('player_conflict'));
assert.ok(referenceMetadataCheck({...base,cardNumber:'2'}).flags.includes('card_number_conflict'));
assert.ok(referenceMetadataCheck({...base,title:'Aaron Judge [Gold Holo Foil] #1',parallel:'Gold Holo Foil',run:'/25'}).flags.includes('no_exact_checklist_match'),'known /50 printing cannot become /25');
assert.deepEqual(referenceMetadataCheck({...base,title:'Aaron Judge [Gold Holo Foil] #1',parallel:'Gold Holo Foil',run:'/50'}).flags,[]);
assert.ok(referenceMetadataCheck({...base,image:''}).flags.includes('missing_photo'));
assert.ok(referenceMetadataCheck({...base,consoleId:'unmapped-set'}).flags.includes('unmapped_source_set'));
assert.ok(referenceConsoles({sport:'baseball',year:2026,displayName:'2026 Topps Update Series Baseball'}).includes('baseball-cards-2026-topps-update'));
assert.ok((await checkReferenceImage(base.image,async()=>new Response(null,{headers:{'Content-Type':'image/jpeg'}}))).ok);
assert.equal((await checkReferenceImage(base.image,async()=>new Response(null,{status:404}))).reason,'image_http_404');
assert.equal((await checkReferenceImage(base.image,async()=>new Response('HTML',{headers:{'Content-Type':'text/html'}}))).reason,'not_an_image');
let external=0;assert.equal((await checkReferenceImage('https://evil.test/photo.jpg',async()=>{external++;})).reason,'invalid_image_host');assert.equal(external,0,'no SSRF or arbitrary host probing');
assert.equal(referenceMetadataCheck(base).visuallyReviewed,false,'metadata checks never claim visual authentication');
const bowman=(consoleId,player,cardNumber,parallel='',run='')=>({...base,consoleId,player,cardNumber,parallel,run,url:'https://www.sportscardspro.com/game/'+consoleId+'/sample',title:player+(parallel?' ['+parallel+']':'')+' #'+cardNumber});
{
 const set=baseballSets.find(s=>s.id==='2023-topps-cosmic-chrome-baseball');
 for(const [section,suffix,player,number]of [
  ['Supernova','supernova','Aaron Judge','SN-1'],
  ['Cosmic Chrome Autograph Variation','autographs','Andres Gimenez','CCA-AG'],
  ['Extraterrestrial Talent Autograph Variation','extraterrestrial-talent-autographs','Julio Rodriguez','ETA-Jr.'],
  ['Launched Into Orbit Autograph Variation','launched-into-orbit-autographs','Aaron Judge','LIOA-AJ']
 ]){
  const card=sectionsForSet(set).find(g=>g.cards[0]?.section===section).cards.find(c=>c.cardNumber===number),source='baseball-cards-2023-topps-cosmic-chrome-'+suffix,row=bowman(source,player,number);
  assert.deepEqual(referenceMetadataCheck(row).flags,[]);assert.ok(referenceMetadataCheck(row).matches[0].path.endsWith('/'+card.id));assert.ok(matchReferenceImage([row],set,card));
  assert.ok(!referenceConsoles(set,set.cards[0]).includes(source),'autograph source is excluded from base cards');
  for(const rule of cardParallelProgram(set,card).variants){
   const finish=rule.name.replace(/ Refractor$/,''),parallel=bowman(source,player,number,finish,'/'+rule.printRun),check=referenceMetadataCheck(parallel);
   assert.deepEqual(check.flags,[],section+' '+finish);assert.ok(matchReferenceImage([parallel],set,selectedParallelCard(set,card,rule.id)));
   assert.ok(referenceMetadataCheck({...parallel,run:'/999'}).flags.includes('no_exact_checklist_match'),'wrong serial denominator is rejected');
  }
 }
 const bad=bowman('baseball-cards-2023-topps-cosmic-chrome-autographs','Julio Rodriguez','ETA-Jr.');assert.ok(referenceMetadataCheck(bad).flags.includes('no_exact_checklist_match'),'different autograph section cannot supply a reference');
}
assert.ok(validReferenceConsoleId('baseball-cards-2023-bowman%27s-best'));for(const bad of ['bad%2fsource','bad%2527source','bad/source','bad?source','bad%00source'])assert.equal(validReferenceConsoleId(bad),false);
for(const [source,player,number,setId]of [['baseball-cards-2023-bowman%27s-best','Taj Bradley','1','2023-bowman-s-best-baseball'],['baseball-cards-2022-stadium-club-chrome','Shohei Ohtani','1','2022-topps-stadium-club-chrome']]){const check=referenceMetadataCheck(bowman(source,player,number));assert.deepEqual(check.flags,[]);assert.equal(check.matches[0].setId,setId);}
for(const [source,player,number,setId]of [
 ['baseball-cards-2023-topps-finest-autographs','Alec Burleson','FA-AB','2023-topps-finest-baseball'],
 ['baseball-cards-2024-topps-cosmic-chrome-autograph','Andrew Abbott','CCA-AA','2024-topps-cosmic-chrome-baseball'],
 ['baseball-cards-2024-topps-chrome-rookie-autograph','Andrew Abbott','RA-AA','2024-topps-chrome-baseball'],
 ['baseball-cards-2025-topps-chrome-rookie-autograph','Adael Amador','RA-AA','2025-topps-chrome-baseball'],
 ['baseball-cards-2026-topps-chrome-rookie-autograph','Andrew Alvarez','RA-AA','2026-topps-chrome-baseball'],
 ['baseball-cards-2024-topps-chrome-update-autograph','Andrew Abbott','AC-AA','2024-topps-chrome-update-series-baseball'],
 ['baseball-cards-2019-topps','Jarrod Dyson','351','2019-topps-series-2-baseball'],
 ['baseball-cards-2020-topps','Gerrit Cole','351','2020-topps-baseball-series-2'],
 ['baseball-cards-2021-topps','Jose Abreu','331','2021-topps-series-2-baseball'],
 ['baseball-cards-2024-topps','Clayton Kershaw','351','2024-topps-baseball-series-2'],
 ['baseball-cards-2020-topps-update','Aaron Bummer','U-12','2020-topps-updates-baseball'],
 ['baseball-cards-2021-topps-update','Francisco Lindor','US1','2021-topps-updates-baseball'],
 ['baseball-cards-2021-bowman-draft-chrome','Harry Ford','BDC-1','2021-bowman-draft-baseball']
]){const check=referenceMetadataCheck(bowman(source,player,number));assert.deepEqual(check.flags,[],source+' '+number);assert.equal(check.matches[0].setId,setId);}
assert.ok(referenceMetadataCheck(bowman('baseball-cards-2021-bowman-draft-chrome','Harry Ford','BD-1')).flags.includes('no_exact_checklist_match'),'Chrome source never supplies the paper BD-1 card');
{
 const set=baseballSets.find(s=>s.id==='2026-topps-holiday-baseball'),regular=set.cards.find(c=>c.cardNumber==='H1'),variation=sectionsForSet(set).flatMap(g=>g.cards).find(c=>c.cardNumber==='H1');
 const row=bowman('baseball-cards-2026-topps-holiday','Bobby Witt Jr.','H1'),check=referenceMetadataCheck(row);
 assert.deepEqual(check.flags,[]);assert.equal(check.matches.length,1);assert.ok(check.matches[0].path.endsWith('/'+regular.id));
 assert.ok(matchReferenceImage([row],set,regular));assert.equal(matchReferenceImage([row],set,variation),null,'a plain base reference must not illustrate the short print');
}
for(const [number,caption]of [['11','National League Leaders RBI'],['38','American League Leaders HRs'],['52','It Takes Two']]){
 const row=bowman(base.consoleId,caption,number),check=referenceMetadataCheck(row);
 assert.deepEqual(check.flags,[],caption);assert.equal(check.matches[0].path,'/baseball/checklists/2026-topps-series-1-baseball/cards/2026-topps-series-1-baseball-'+number);
 assert.ok(referenceMetadataCheck({...row,cardNumber:'1',title:caption+' #1'}).flags.includes('no_exact_checklist_match'),'caption is not a wildcard for other card numbers');
 assert.ok(referenceMetadataCheck({...row,consoleId:'baseball-cards-2025-topps',url:row.url.replace('2026-topps','2025-topps')}).flags.includes('no_exact_checklist_match'),'caption does not leak across years');
 assert.ok(referenceMetadataCheck({...row,parallel:'Gold',title:caption+' [Gold] #'+number,run:'/10'}).flags.includes('no_exact_checklist_match'),'caption cannot bypass serial checks');
}
for(const [player,expected] of [['Adrian Gil','2026-bowman-baseball'],['Angeibel Gomez','2026-bowman-chrome-baseball']]){
 const check=referenceMetadataCheck(bowman('baseball-cards-2026-bowman-chrome-prospect-autograph',player,'CPA-AG'));
 assert.deepEqual(check.flags,[]);assert.equal(check.matches.length,1);assert.equal(check.matches[0].setId,expected,'same autograph number needs the correct player and release');
}
assert.deepEqual(referenceMetadataCheck(bowman('baseball-cards-2026-bowman-paper-prospect','Aidan Miller','BP-49','Logo Pattern')).flags,[]);
assert.ok(referenceMetadataCheck(bowman('baseball-cards-2026-bowman-chrome-prospect-autograph','Adrian Gil','CPA-AG','Peanuts Refractor')).flags.includes('no_exact_checklist_match'),'missing serial information cannot be invented from a photo');
for(const [source,player,number,expected]of [
 ['baseball-cards-2023-bowman-chrome-prospects','Abdias De La Cruz','BCP-34','2023-bowman'],
 ['baseball-cards-2023-bowman-chrome-prospects','Adan Sanchez','BCP-219','2023-bowman-chrome'],
 ['baseball-cards-2023-bowman-chrome-prospect-autographs','Abel Bastidas','CPA-AB','2023-bowman'],
 ['baseball-cards-2023-bowman-chrome-prospect-autographs','Abner Uribe','CPA-AU','2023-bowman-chrome'],
 ['baseball-cards-2023-topps-all-aces','Nolan Ryan','AA-1','2023-topps-series-1'],
 ['baseball-cards-2023-topps-all-aces','Tom Glavine','AA-26','2023-topps-series-2'],
 ['baseball-cards-2023-topps-all-aces','Nolan Ryan','AA-51','2023-topps-update'],
 ['baseball-cards-2023-topps-chrome-rookie-autographs','Alec Burleson','RA-AB','2023-topps-chrome'],
 ['baseball-cards-2023-topps-chrome-update-autographs','Alec Burleson','AC-AB','2023-topps-chrome-update-series-baseball'],
 ['baseball-cards-2024-bowman-chrome-prospects','Abimelec Ortiz','BCP-16','2024-bowman-baseball'],
 ['baseball-cards-2024-bowman-chrome-prospects','Adam Serwinowski','BCP-202','2024-bowman-chrome-baseball'],
 ['baseball-cards-2024-bowman-prospects','Jacob Wilson','BP-3','2024-bowman-baseball'],
 ['baseball-cards-2024-bowman-chrome-prospects-autograph','Anthony Baptist','CPA-AB','2024-bowman-baseball'],
 ['baseball-cards-2024-bowman-chrome-prospects-autograph','Alfredo Alcantara','CPA-AA','2024-bowman-chrome-baseball'],
 ['baseball-cards-2025-bowman-chrome-prospects','Walker Jenkins','BCP-1','2025-bowman-baseball'],
 ['baseball-cards-2025-bowman-prospects','Walker Jenkins','BP-1','2025-bowman-baseball'],
 ['baseball-cards-2025-bowman-chrome-prospect-autograph','Ashly Andujar','CPA-AA','2025-bowman-baseball'],
 ['baseball-cards-2025-bowman-draft-chrome','Eli Willits','BDC-1','2025-bowman-draft-baseball'],
 ['baseball-cards-2025-bowman-draft-chrome-prospect-autograph','Anthony Eyanson','CPA-AE','2025-bowman-draft-baseball']
]){const check=referenceMetadataCheck(bowman(source,player,number));assert.deepEqual(check.flags,[],source+' '+number);assert.equal(check.matches[0].setId,expected);}
assert.deepEqual(referenceMetadataCheck(bowman('baseball-cards-2024-bowman-chrome-prospects','Abimelec Ortiz','BCP-16','Aqua Lunar','/125')).flags,[]);
assert.ok(referenceMetadataCheck(bowman('baseball-cards-2024-bowman-prospects','Abimelec Ortiz','BCP-16')).flags.includes('no_exact_checklist_match'),'paper and Chrome sources are not interchangeable');
assert.ok(referenceConsoles({sport:'baseball',displayName:'2023 Topps Chrome Update Series Baseball'}).includes('baseball-cards-2023-topps-chrome-update'));
assert.ok(referenceConsoles({sport:'baseball',displayName:'2022 Topps Chrome Updates Baseball'}).includes('baseball-cards-2022-topps-chrome-update'));
// SportsCardsPro's 2023 Topps table shortens the publisher's parent-day names.
// Preserve the exact /50 identity; its Camo /26 and pooled plates /4 remain rejected.
for(const finish of ["Mother's Day Pink","Father's Day Blue"]){
 const row=bowman('baseball-cards-2023-topps','Juan Soto','1',finish,'/50');
 assert.deepEqual(referenceMetadataCheck(row).flags,[],finish);
 assert.ok(referenceMetadataCheck({...row,run:'/25'}).flags.includes('no_exact_checklist_match'));
}
for(const [finish,run]of [['Memorial Day Camo','/26'],['Printing Plates','/4']]){
 assert.ok(referenceMetadataCheck(bowman('baseball-cards-2023-topps','Juan Soto','1',finish,run)).flags.includes('no_exact_checklist_match'));
}
{
 const row=bowman('baseball-cards-2023-topps','Los Angeles Angels','93',"Mother's Day Pink",'/50');
 assert.deepEqual(referenceMetadataCheck(row).flags,[],'verified full team caption matches publisher team card');
 assert.ok(referenceMetadataCheck({...row,title:"Los Angeles Dodgers [Mother's Day Pink] #93",player:'Los Angeles Dodgers'}).flags.includes('no_exact_checklist_match'));
 assert.ok(referenceMetadataCheck({...row,run:'/25'}).flags.includes('no_exact_checklist_match'));
}
{
 const row=bowman('baseball-cards-2023-topps','Star Power','113',"Mother's Day Pink",'/50');
 assert.deepEqual(referenceMetadataCheck(row).flags,[],'source caption identifies the publisher Mookie Betts combo card');
 assert.ok(referenceMetadataCheck({...row,cardNumber:'50',title:"Star Power [Mother's Day Pink] #50"}).flags.includes('no_exact_checklist_match'),'not interchangeable with the solo Betts card');
 assert.ok(referenceMetadataCheck({...row,run:'/25'}).flags.includes('no_exact_checklist_match'));
}
{
 const set=baseballSets.find(s=>s.id==='2022-topps-chrome-platinum-anniversary'),groups=sectionsForSet(set),autos=groups.find(g=>g.name==='Autograph Cards'),card=autos.cards.find(c=>c.cardNumber==='CPA-ABE'),source='baseball-cards-2022-topps-chrome-platinum-anniversary-autographs';
 assert.equal(autos.cards.length,130);assert.equal(card.player,'Anthony Bender');
 for(const c of [...set.cards,...groups.flatMap(g=>g.cards)])assert.equal(referenceConsoles(set,c).includes(source),c.section==='Autograph Cards','dedicated autograph console excludes every non-autograph section and base');
 for(const other of baseballSets.filter(s=>s.id!==set.id))assert(!referenceConsoles(other).includes(source),'autograph console is limited to its verified release');
 const row={...bowman(source,'Anthony Bender','CPA-ABE'),productId:'5660136',url:'https://www.sportscardspro.com/game/'+source+'/anthony-bender-cpa-abe',image:'https://storage.googleapis.com/images.pricecharting.com/corrixsc3ychqjtgtnne/240.jpg',referencePrices:{currency:'USD',ungraded:1.87,grade9:12.24,psa10:34.50,capturedAt:'2026-10-30T15:30:00.000Z'}};
 const check=referenceMetadataCheck(row);assert.deepEqual(check.flags,[]);assert.equal(check.matches.length,1);assert.equal(check.matches[0].path,'/baseball/checklists/'+set.id+'/cards/'+card.id);
 const photo=matchReferenceImage([row],set,card);assert(photo);assert.equal(photo.image,row.image);assert.deepEqual(photo.referencePrices,row.referencePrices);
 assert.equal(referenceMetadataCheck({...row,title:'Anthony Bender #CPA-ABX',cardNumber:'CPA-ABX'}).matches.length,0,'wrong card number remains rejected');
 assert.equal(referenceMetadataCheck({...row,title:'Anthony Bend #CPA-ABE',player:'Anthony Bend'}).matches.length,0,'wrong player remains rejected');
 assert.equal(referenceMetadataCheck({...row,title:'Shohei Ohtani #1',player:'Shohei Ohtani',cardNumber:'1'}).matches.length,0,'non-autograph cannot borrow the dedicated source');
 const observed=[['refractor','Refractor',199],['aqua-refractor','Aqua Refractor',150],['blue-prism-refractor','Blue Prism Refractor',99],['platinum-toile-cream-blue-refractor','Toile Cream Blue Refractor',99],['gold-refractor','Gold Refractor',50],['orange-refractor','Orange Refractor',25],['pink-refractor','Pink Refractor',15],['black-refractor','Black Refractor',10],['red-refractor','Red Refractor',5],['platinum-toile-cream-red-refractor','Toile Cream Red Refractor',5],['superfractor','SuperFractor',1]];
 assert.equal(cardParallelProgram(set,card).variants.length,11,'source mapping does not invent finish eligibility');
 for(const [id,finish,run]of observed){
  const parallel={...row,title:'Anthony Bender ['+finish+'] #CPA-ABE',parallel:finish,run:'/'+run};
  assert.deepEqual(referenceMetadataCheck(parallel).flags,[],finish);assert(referenceMetadataCheck(parallel).matches[0].path.endsWith('?parallel='+id));
  assert(matchReferenceImage([parallel],set,selectedParallelCard(set,card,id)));assert.equal(matchReferenceImage([parallel],set,card),null,'parallel cannot fill the uncolored slot');
  assert.equal(referenceMetadataCheck({...parallel,run:'/999'}).matches.length,0,'wrong serial denominator remains rejected');
  assert.equal(referenceMetadataCheck({...parallel,run:''}).matches.length,0,'missing parallel serial denominator remains rejected');
 }
}
console.log('Reference validation: official identities, correct numbered printing, unmapped sources, image status, SSRF boundaries and honest review labels passed');
