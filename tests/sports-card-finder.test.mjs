import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {sportsReferenceRows,sportsSearchResults,sportsPlayerTeamSearch,sportsSearchSuggestions,sportsSearchClient} from '../scripts/sports-card-finder.mjs';
import {handleBaseballCatalog} from '../scripts/baseball-catalog-pages.mjs';
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const url=query=>new URL('/sports/checklists?'+query,'https://www.themanapocket.com');
const search=query=>sportsSearchResults(url(query));
const all=sportsReferenceRows(),griffey=search('player=Ken+Griffey+Jr.');
assert.ok(griffey.rows.length>200);assert.ok(new Set(griffey.rows.map(r=>r.set.id)).size>30);assert.equal(new Set(griffey.rows.map(r=>r.set.year)).size,8);
for(const name of ['ken griffey jr','Ken Griffey, Jr.','KEN GRIFFEY JR.','griffey ken jr','Ken Griffey Jr'])assert.deepEqual(search('player='+encodeURIComponent(name)).rows.map(r=>r.href),griffey.rows.map(r=>r.href),name);
assert.ok(griffey.rows.every(r=>r.card.subjects.some(s=>/\bken\b.*\bgriffey\b.*\bjr\b/i.test(s.name))),'Jr. never borrows another subject’s suffix');
assert.ok(griffey.rows.some(r=>r.type==='autographs'));assert.ok(griffey.rows.some(r=>r.type==='inserts'));assert.ok(griffey.rows.some(r=>r.type==='base'));
const mariners=search('team=seattle+mariners');assert.ok(mariners.rows.length>2000);assert.equal(new Set(mariners.rows.map(r=>r.set.year)).size,9);
assert.ok(mariners.rows.some(r=>r.set.year===2018),'historical releases participate in franchise search');
assert.deepEqual(search('team=MARINERS').rows.map(r=>r.href),mariners.rows.map(r=>r.href));
const cleveland=search('team=Cleveland+Guardians');assert.ok(cleveland.rows.some(r=>r.card.subjects.some(s=>s.team==='Cleveland Indians')),'known former franchise names participate by default');
assert.ok(search('team=Cleveland+Guardians&teamNames=printed').rows.every(r=>r.card.subjects.some(s=>s.team==='Cleveland Guardians')),'collectors can choose the printed name only');
assert.ok(search('q=Guardians+2024').rows.every(r=>r.set.year===2024));
assert.ok(search('q=2024').rows.every(r=>r.set.year===2024),'a bare year does not become a card-number query');
const range=search('player=Ken+Griffey+Jr.&from=2023&to=2024');assert.ok(range.rows.length);assert.ok(range.rows.every(r=>r.set.year>=2023&&r.set.year<=2024));
assert.equal(search('from=2025&to=2024'),null);assert.equal(search('sort=garbage'),null);
const old=search('player=Ken+Griffey+Jr.&sort=oldest');for(let i=1;i<old.rows.length;i++)assert.ok(old.rows[i-1].set.year<=old.rows[i].set.year);
const multi=all.find(r=>r.card.subjects.length>1&&r.card.subjects[0].team&&r.card.subjects[1].team&&r.card.subjects[0].team!==r.card.subjects[1].team);
assert.ok(multi);const mismatch=search(new URLSearchParams({player:multi.card.subjects[0].name,team:multi.card.subjects[1].team}));assert.ok(!mismatch.rows.includes(multi),'a different signer’s team must not satisfy the player filter');
const found=[];
for(let page=1;page<=griffey.pages;page++){
 const data=sportsPlayerTeamSearch(url('player=Ken+Griffey+Jr.&page='+page),esc),doc=parseHTML(data.bodyHtml).document;
 found.push(...[...doc.querySelectorAll('.mp-cross-card h2 a')].map(a=>a.getAttribute('href')));
 assert.ok(doc.querySelector('.mp-card-reference'),'player searches show reference photos and parallel families');
 if(page<griffey.pages)assert.ok([...doc.querySelectorAll('.mp-cross-pages a')].some(a=>a.textContent.includes('Next')&&a.getAttribute('href').includes('player=Ken')));
}
assert.equal(found.length,griffey.rows.length);assert.equal(new Set(found).size,found.length);assert.deepEqual(found,griffey.rows.map(r=>r.href),'ordinary pagination reaches every matching published card');
const one=parseHTML(sportsPlayerTeamSearch(url('number=FSA-G&from=2024&set=2024-topps-five-star-baseball'),esc).bodyHtml).document;
const player=one.querySelector('a[aria-label="All Ken Griffey Jr. cards across sets and years"]');assert.equal(player.getAttribute('href'),'/sports/checklists?sport=baseball&player=Ken+Griffey+Jr.','all-player links clear card, set and year restrictions');
const hostile=parseHTML(sportsPlayerTeamSearch(url('q=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E'),esc).bodyHtml).document;
assert.equal(hostile.querySelectorAll('script').length,1);assert.ok(hostile.querySelector('[name="q"]').getAttribute('value').includes('<script>alert(1)</script>'));
const suggestions=sportsSearchSuggestions('ken grif');assert.ok(suggestions.some(s=>s.value==='Ken Griffey Jr.'));assert.ok(suggestions.some(s=>s.value==='Ken Griffey Sr.'));assert.ok(!suggestions.some(s=>/graded|#/.test(s.value)));assert.ok(suggestions.length<=12);assert.deepEqual(sportsSearchSuggestions('k'),[]);
let reads=0;const suggestionUrl=url('suggest=ken+grif');const response=await handleBaseballCatalog(new Request(suggestionUrl),{},suggestionUrl,{listItems:()=>{reads++;throw Error('No inventory reads');}});assert.equal(response.status,200);assert.ok((await response.json()).suggestions.some(s=>s.value==='Ken Griffey Jr.'));assert.equal(reads,0);
// Exercise the actual browser typeahead, including safe DOM insertion and the
// short-query gate. No giant embedded name lists or per-keystroke database work.
const {document,window}=parseHTML('<form data-sports-finder><input name="q"><select name="sport"><option value="baseball" selected>Baseball</option></select><datalist id="mp-sports-suggestions"></datalist></form>');
let runTimer,calls=0;vm.runInNewContext('('+sportsSearchClient.toString()+')()',{document,AbortController,URLSearchParams,clearTimeout(){},setTimeout(fn){runTimer=fn;},fetch:async()=>{calls++;return {ok:true,json:async()=>({suggestions:[{value:'<img src=x onerror=alert(1)>',label:'Player'}]})};}});
document.querySelector('[name="q"]').value='ken';document.querySelector('input').dispatchEvent(new window.Event('input'));await runTimer();assert.equal(calls,1);assert.equal(document.querySelectorAll('datalist option').length,1);assert.equal(document.querySelectorAll('img').length,0);
document.querySelector('input').value='k';document.querySelector('input').dispatchEvent(new window.Event('input'));assert.equal(document.querySelectorAll('datalist option').length,0);assert.equal(calls,1);
console.log(JSON.stringify({griffeyCards:griffey.rows.length,griffeySets:new Set(griffey.rows.map(r=>r.set.id)).size,marinersCards:mariners.rows.length,pages:griffey.pages,verified:'all published base/non-base cards, years, name variants, same-subject filters, full pagination, photos, safe bounded suggestions and no inventory reads'}));
