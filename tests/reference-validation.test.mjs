import assert from 'node:assert/strict';
import {referenceMetadataCheck,referenceConsoles,checkReferenceImage} from '../scripts/reference-validation.mjs';
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
for(const [player,expected] of [['Adrian Gil','2026-bowman-baseball'],['Angeibel Gomez','2026-bowman-chrome-baseball']]){
 const check=referenceMetadataCheck(bowman('baseball-cards-2026-bowman-chrome-prospect-autograph',player,'CPA-AG'));
 assert.deepEqual(check.flags,[]);assert.equal(check.matches.length,1);assert.equal(check.matches[0].setId,expected,'same autograph number needs the correct player and release');
}
assert.deepEqual(referenceMetadataCheck(bowman('baseball-cards-2026-bowman-paper-prospect','Aidan Miller','BP-49','Logo Pattern')).flags,[]);
assert.ok(referenceMetadataCheck(bowman('baseball-cards-2026-bowman-chrome-prospect-autograph','Adrian Gil','CPA-AG','Peanuts Refractor')).flags.includes('no_exact_checklist_match'),'missing serial information cannot be invented from a photo');
for(const [source,player,number,expected]of [
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
console.log('Reference validation: official identities, correct numbered printing, unmapped sources, image status, SSRF boundaries and honest review labels passed');
