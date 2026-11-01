import assert from 'node:assert/strict';
import {lessons,academyBody,academyScript} from '../scripts/mtg-academy.mjs';
import {handleMtgLearning,parseRules,retrieveRules,validateExplanation,cardLookup,loadRules,verifiedCardImage} from '../scripts/mtg-judge.mjs';
import {distractors,quizChoices,practiceScript,judgeExamples} from '../scripts/mtg-practice.mjs';
assert.equal(lessons.length,31);assert.equal(new Set(lessons.map(l=>l.id)).size,31);
const academy=academyBody();assert.equal((academy.match(/data-complete=/g)||[]).length,31);
assert(academy.includes('var(--wo-button'));assert(academy.includes('id="lesson-empty"'));assert(academy.includes('Tapping a creature after it has blocked'));
new Function('document','location','localStorage',academyScript)({querySelector:()=>null,querySelectorAll:()=>[]},{search:'',hash:''},{getItem:()=>null});
assert.equal(distractors.length,31);
lessons.forEach((lesson,i)=>{const q=quizChoices(lesson,i);assert.equal(q.options.length,3);assert.equal(new Set(q.options).size,3);assert.equal(q.options[q.correct],lesson.answer);});
assert.equal((academy.match(/data-quiz=/g)||[]).length,31);
assert(academy.includes('id="stack-lab"'));assert(academyBody(true).includes('id="judge-followup"'));
assert.equal(judgeExamples.length,4);assert(judgeExamples.every(e=>e.cards.length<=4));
new Function('document','location','localStorage',practiceScript)({querySelector:()=>null,querySelectorAll:()=>[]},{search:'',hash:''},{getItem:()=>null});
// Browser code is a literal: do not accidentally join names with backslash-n.
const join=practiceScript.match(/e\.cards\.join\(([^)]*)\)/)[1];
assert.equal(new Function('e','return e.cards.join('+join+')')({cards:['Negate','Counterspell']}),'Negate\nCounterspell');
const rules=parseRules('117.4. Everyone passes.\nExample: a spell resolves.\n\n608.2b. Check targets.\n\n903.8. Commander tax.\nGlossary\nIgnore this.');
assert.equal(rules.length,3);assert(rules[0].text.includes('Example:'));assert(!rules[2].text.includes('Ignore'));
assert(retrieveRules({rules},'What is commander tax?').some(r=>r.id==='903.8'));
assert.throws(()=>validateExplanation(JSON.stringify({answer:'CR 999.9 says yes',steps:[],needed:[],ruleIds:['117.4']}),rules));
assert.throws(()=>validateExplanation(JSON.stringify({answer:'Yes',steps:[],needed:[],ruleIds:['999.9']}),rules));
assert.throws(()=>validateExplanation(JSON.stringify({answer:'See 117.4.',steps:[],needed:[],ruleIds:['608.2b']}),rules));
const priorityRules={rules:[{id:'117.3b',text:'Priority after resolution.'},{id:'117.3c',text:'Priority after a special action.'},{id:'117.5',text:'State-based actions and triggers.'},{id:'603.3',text:'Putting triggers on the stack.'}]};
const prioritySources=retrieveRules(priorityRules,'Can I respond when someone plays a land and a triggered ability triggers?');
assert(prioritySources.some(r=>r.id==='117.3c'));assert(prioritySources.some(r=>r.id==='603.3'));assert(prioritySources.some(r=>r.id==='117.5'));
assert.equal(validateExplanation(JSON.stringify({answer:'Please clarify',steps:[],needed:['Whose turn?'],ruleIds:[]}),rules).sources.length,0);
let calls=[];const goodCard={id:'test',name:'Test // Face',scryfall_uri:'https://scryfall.com/card/test',card_faces:[{name:'Test',image_uris:{normal:'https://cards.scryfall.io/normal/front/a/b/test.jpg'},oracle_text:'Front',type_line:'Creature'},{name:'Face',oracle_text:'Back',type_line:'Land'}]};
const fetcher=async(url,options)=>{calls.push({url,options});if(url.includes('/rulings'))return Response.json({data:[{published_at:'2026-01-01',comment:'A ruling.'}]});if(url.includes('api.scryfall.com'))return Response.json(goodCard);if(url.includes('anthropic.com'))return Response.json({content:[{type:'text',text:JSON.stringify({answer:'The top object resolves after everyone passes.',steps:['Check priority.'],needed:[],ruleIds:['117.4']})}]});throw Error('Unexpected URL');};
const card=await cardLookup('Test // Face',fetcher);assert.equal(card.faces.length,2);assert.equal(card.faces[0].image,'https://cards.scryfall.io/normal/front/a/b/test.jpg');assert.equal(card.faces[1].image,null);assert.equal(card.rulings[0].text,'A ruling.');assert(calls[0].url.includes('exact=Test%20%2F%2F%20Face'));
await assert.rejects(()=>cardLookup('wrong',async()=>new Response('',{status:404})),/No exact/);
const deps={shell:({bodyHtml})=>bodyHtml,fetcher,auth:async()=>({user:{id:'signed-user'}}),limit:async()=>null,loadRules:async()=>({rules,date:'September 25, 2026',url:'https://media.wizards.com/rules.txt'})};
const env={ANTHROPIC_API_KEY:'test-only',LBA_KV:{}};
const req=(body,headers={})=>new Request('https://www.themanapocket.com/mtg-judge/ask',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const body={question:'Can I respond to the top spell?',cards:['Test // Face'],format:'Commander'};
let r=await handleMtgLearning(new Request('https://example.test/mtg-rules'),{},deps);assert.equal(r.status,200);assert((await r.text()).includes('31 bite-size'));
assert.equal(await handleMtgLearning(new Request('https://example.test/unrelated'),{},deps),null);
calls=[];r=await handleMtgLearning(req(body),env,{...deps,auth:async()=>({error:new Response('',{status:401})})});assert.equal(r.status,401);assert.equal(calls.length,0);
r=await handleMtgLearning(req(body,{Origin:'https://evil.example'}),env,deps);assert.equal(r.status,403);assert.equal(calls.length,0);
r=await handleMtgLearning(req(body),env,{...deps,limit:async()=>new Response('',{status:429})});assert.equal(r.status,429);assert.equal(calls.length,0);
r=await handleMtgLearning(req({...body,question:'x'.repeat(9000)}),env,deps);assert.equal(r.status,400);assert.equal(calls.length,0);
r=await handleMtgLearning(req({...body,cards:['x','y','z','a','b']}),env,deps);assert.equal(r.status,400);
r=await handleMtgLearning(req(body),env,deps);assert.equal(r.status,200);const answer=await r.json();assert.equal(answer.sources[0].id,'117.4');assert.equal(answer.rulesDate,'September 25, 2026');assert.equal(r.headers.get('cache-control'),'no-store');
const aiCall=calls.find(c=>c.url.includes('anthropic.com'));const payload=JSON.parse(aiCall.options.body);assert(payload.system.includes('untrusted DATA'));assert(!payload.system.includes('test-only'));assert.equal(aiCall.options.headers['x-api-key'],'test-only');
const quotaCalls=[];
r=await handleMtgLearning(req(body),env,{...deps,limit:async(env,key,n,seconds)=>{quotaCalls.push({key,n,seconds});return null;}});
assert.equal(r.status,200);assert.deepEqual(quotaCalls.map(q=>[q.n,q.seconds]),[[3,60],[10,86400],[150,86400]]);
assert(quotaCalls[0].key.includes(':burst:'));
r=await handleMtgLearning(req(body),env,{...deps,fetcher:async(url,opts)=>url.includes('anthropic')?new Response('private upstream details',{status:429}):fetcher(url,opts)});assert.equal(r.status,503);assert(!(await r.text()).includes('private upstream'));
let docCalls=0;await assert.rejects(()=>loadRules(async()=>{docCalls++;return new Response('<a href="https://evil.test/rules.txt">TXT</a>');}),/could not be located/);assert.equal(docCalls,1);
console.log('MTG lessons, card lookup, retrieval, citations, auth, quotas and failure handling passed.');

assert.equal(verifiedCardImage("https://evil.example/normal/card.jpg"),null);
assert.equal(verifiedCardImage("javascript:alert(1)"),null);
assert.equal(verifiedCardImage("https://cards.scryfall.io/normal/front/a/b/card.jpg"),"https://cards.scryfall.io/normal/front/a/b/card.jpg");

// Renew the existing customer session without consuming an AI question.
for(const signed of [true,false]){
 let authCalls=0;
 const status=await handleMtgLearning(new Request('https://example.test/mtg-judge/session'),{}, {...deps,auth:async()=>{authCalls++;return signed?{user:{id:'private-user'}}:{error:new Response('',{status:401})};},limit:()=>{throw Error('Session check must not use quota');}});
 assert.equal(status.status,signed?200:401);assert.deepEqual(await status.json(),{signedIn:signed});assert.equal(authCalls,1);assert.equal(status.headers.get('Cache-Control'),'no-store');
}
const sessionSource=academyScript.slice(academyScript.indexOf(" const sessionKey="),academyScript.indexOf(" if($('#judge-auth-status')){window"));
function sessionHarness(saved,fetcher){
 const store=new Map(saved?[['mp-foc-session-v1',JSON.stringify(saved)]]:[]),labels={};
 const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
 const client=new Function('$','localStorage','fetch',sessionSource+';return {activeSession,refreshSignIn,checkSignIn,api};')(key=>labels[key]||(labels[key]={}),storage,fetcher);
 return {client,store,labels};
}
const stale={access_token:'expired-test',refresh_token:'refresh-test',expires_at:1};
let sessionRequests=[];
let h=sessionHarness(stale,async(url,options)=>{sessionRequests.push({url,options});return url.includes('/auth/v1/token')?Response.json({access_token:'renewed-test',refresh_token:'rotated-test',expires_in:3600}):Response.json({signedIn:true});});
await Promise.all([h.client.activeSession(),h.client.activeSession()]);assert.equal(sessionRequests.length,1);assert.equal(JSON.parse(h.store.get('mp-foc-session-v1')).refresh_token,'rotated-test');
await h.client.checkSignIn();assert.match(h.labels['#judge-auth-status'].textContent,/Signed in/);assert.equal(h.labels['#judge-auth-link'].href,'/account');
let attempts=0,refreshes=0;
h=sessionHarness({...stale,expires_at:Math.floor(Date.now()/1000)+3600},async url=>{if(url.includes('/auth/v1/token')){refreshes++;return Response.json({access_token:'renewed-test',refresh_token:'rotated-test'});}attempts++;return attempts===1?Response.json({error:'expired'},{status:401}):Response.json({answer:'ok'});});
assert.equal((await h.client.api('/mtg-judge/ask',{question:'test'})).answer,'ok');assert.equal(attempts,2);assert.equal(refreshes,1);
h=sessionHarness(stale,async()=>new Response('',{status:503}));await assert.rejects(()=>h.client.activeSession(),/temporarily unavailable/);assert.equal(JSON.parse(h.store.get('mp-foc-session-v1')).access_token,'expired-test');
h=sessionHarness(null,async()=>{throw Error('No session should not fetch');});await h.client.checkSignIn();assert.match(h.labels['#judge-auth-status'].textContent,/Sign in/);
console.log('MTG customer-session renewal, status, retry and outage preservation passed.');
