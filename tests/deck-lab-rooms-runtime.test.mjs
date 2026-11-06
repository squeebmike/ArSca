// Workerd + real SQLite boundary test; STUDIO_TOOLING can locate existing tools.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(process.env.STUDIO_TOOLING||import.meta.url),{build}=require('esbuild'),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
const fixture={id:'11111111-1111-4111-8111-111111111111',name:'Forest',type_line:'Basic Land — Forest',oracle_text:'',mana_cost:'',set:'lea',collector_number:'295',layout:'normal',color_identity:['G'],legalities:{standard:'legal',commander:'legal'}};
const commanderFixture={...fixture,id:'22222222-2222-4222-8222-222222222222',name:'Test Commander',type_line:'Legendary Creature — Elf',mana_cost:'{2}{G}',power:'3',toughness:'3'};
const bundle=await build({stdin:{sourcefile:'deck-room-harness.mjs',resolveDir:process.cwd(),contents:`import {DeckLabRoom,handleDeckLabRooms} from './scripts/mtg/deck-lab-room.mjs';export {DeckLabRoom};globalThis.fetch=async(url,init)=>{if(url!=='https://api.scryfall.com/cards/collection')throw Error('Unexpected network request');return Response.json({data:[${JSON.stringify(fixture)},${JSON.stringify(commanderFixture)}]});};export default {fetch:(request,env)=>handleDeckLabRooms(request,env,{limit:async()=>null})};`},bundle:true,platform:'browser',format:'esm',external:['cloudflare:workers'],write:false});
const base={workers:[{name:'deck-room-test',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-20',durableObjects:{DECK_LAB_ROOMS:{className:'DeckLabRoom',useSQLite:true}}}]};
const opts=convertV4MiniflareOptions?convertV4MiniflareOptions(base):base;const mf=new Miniflare(opts);
const key='b'.repeat(64),other='c'.repeat(64),rows=[{id:fixture.id,quantity:60}];
async function call(path,{body,auth,origin='https://local'}={}){const r=await mf.dispatchFetch('https://local/deck-lab/rooms'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:origin}:{}),...(auth?{Authorization:'Bearer '+auth}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
try{
 assert.equal((await call('',{body:{mode:'table',cards:rows},origin:'https://evil.test'})).status,403);
 const created=await call('',{body:{mode:'table',name:'Alice',cards:rows}});assert.equal(created.status,201);const host=created.data.key,id=created.data.room,invite=created.data.invite;
 assert.equal((await call('/'+id+'/state')).status,401);assert.equal((await call('/'+id+'/state',{auth:other})).status,403);
 let guest=await call('/'+id+'/join',{body:{invite,key}});assert.equal(guest.status,200);assert.equal((await call('/'+id+'/join',{body:{invite,key:other}})).status,409);
 const retry=await call('/'+id+'/join',{body:{invite,key}});assert.equal(retry.status,200,'same guest can recover a retried join');
 guest=await call('/'+id+'/deck',{auth:key,body:{revision:guest.data.revision,name:'Bob',cards:rows}});assert.equal(guest.status,200);assert(guest.data.state);
 const hostState=await call('/'+id+'/state',{auth:host});assert.equal(hostState.data.names[0],'Alice');assert.equal(guest.data.names[0],'Bob');
 for(const v of [guest.data,hostState.data]){assert(v.state.players[1].hand.every(c=>c.hidden&&!c.name&&!c.id));assert(v.state.players.every(p=>p.library.every(c=>c.hidden&&!c.name&&!c.id)));assert(!JSON.stringify(v).includes('keyHash'));}
 let h=await call('/'+id+'/action',{auth:host,body:{revision:hostState.data.revision,action:{type:'keep',args:[0,[]]}}});assert.equal(h.status,200);
 let g=await call('/'+id+'/action',{auth:key,body:{revision:h.data.revision,action:{type:'keep',args:[0,[]]}}});assert.equal(g.status,200);
 const stolen=await call('/'+id+'/action',{auth:key,body:{revision:g.data.revision,action:{type:'manual',args:[{player:1,kind:'draw'}]}}});assert.equal(stolen.status,400);
 const concurrent=await Promise.all([1,2].map(()=>call('/'+id+'/action',{auth:host,body:{revision:g.data.revision,action:{type:'manual',args:[{player:0,kind:'life',value:1}]}}})));assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,400]);
 const reconnected=await call('/'+id+'/state',{auth:host});assert.equal(reconnected.data.state.players[0].life,21);assert.equal(reconnected.data.revision,g.data.revision+1);
 const cross=await call('/00000000-0000-4000-8000-000000000000/state',{auth:host});assert.equal(cross.status,410,'a key cannot reach another room');
 const conceded=await call('/'+id+'/action',{auth:key,body:{revision:reconnected.data.revision,action:{type:'concede'}}});assert.equal(conceded.status,200);assert.equal((await call('/'+id+'/state',{auth:host})).data.state.result.winner,0);
 // Commander rooms retain public command zones and private hands independently.
 const commanderRows=[{id:fixture.id,quantity:99,section:'main'},{id:commanderFixture.id,quantity:1,section:'commander'}];
 const made=await call('',{body:{mode:'table',format:'commander',name:'Commander host',cards:commanderRows}});assert.equal(made.status,201);const cid=made.data.room,ckey=made.data.key,gkey='d'.repeat(64);
 const joinedCmd=await call('/'+cid+'/join',{body:{invite:made.data.invite,key:gkey}});let cmd=await call('/'+cid+'/deck',{auth:gkey,body:{revision:joinedCmd.data.revision,name:'Commander guest',cards:commanderRows}});assert.equal(cmd.status,200);assert.equal(cmd.data.state.players[0].life,40);assert.equal(cmd.data.state.players[0].commandZone.length,1);assert.equal(cmd.data.state.players[1].hand.every(c=>c.hidden),true);
 let cmdHost=await call('/'+cid+'/action',{auth:ckey,body:{revision:cmd.data.revision,action:{type:'keep',args:[0,[]]}}});cmd=await call('/'+cid+'/action',{auth:gkey,body:{revision:cmdHost.data.revision,action:{type:'keep',args:[0,[]]}}});const commanderId=cmd.data.state.players[0].commandZone[0].id;
 cmd=await call('/'+cid+'/action',{auth:gkey,body:{revision:cmd.data.revision,action:{type:'manual',args:[{player:0,kind:'commander-cast',id:commanderId}]}}});assert.equal(cmd.data.state.stack[0].card.commandCasts,1);assert.equal(cmd.data.state.stack[0].controller,0);
 cmd=await call('/'+cid+'/action',{auth:gkey,body:{revision:cmd.data.revision,action:{type:'manual',args:[{player:0,kind:'commander-counter',id:commanderId}]}}});cmd=await call('/'+cid+'/action',{auth:gkey,body:{revision:cmd.data.revision,action:{type:'manual',args:[{player:0,from:'graveyard',to:'commandZone',id:commanderId}]}}});assert.equal(cmd.data.state.players[0].commandZone[0].commandCasts*2,2);cmdHost=await call('/'+cid+'/state',{auth:ckey});assert.equal(cmdHost.data.state.players[1].commandZone[0].id,commanderId);
 // Four distinct one-use invitations and four independently private seats.
 const pod=await call('',{body:{mode:'table',format:'commander',capacity:4,name:'Pod host',cards:commanderRows}});assert.equal(pod.status,201);assert.equal(pod.data.invites.length,3);const pid=pod.data.room,pkeys=[pod.data.key,'e'.repeat(64),'f'.repeat(64),'a'.repeat(64)];
 let pv=pod;
 for(let i=1;i<4;i++){
  const j=await call('/'+pid+'/join',{body:{invite:pod.data.invites[i-1],key:pkeys[i]}});assert.equal(j.status,200);assert.equal(j.data.seat,i);
  assert([403,409].includes((await call('/'+pid+'/join',{body:{invite:pod.data.invites[i-1],key:'9'.repeat(64)}})).status));
  pv=await call('/'+pid+'/deck',{auth:pkeys[i],body:{revision:j.data.revision,name:'Pod '+i,cards:commanderRows}});assert.equal(pv.status,200);assert.equal(!!pv.data.state,i===3);
 }
 assert.equal((await call('/'+pid+'/join',{body:{invite:pod.data.invites[0],key:'9'.repeat(64)}})).status,409);
 for(let i=0;i<4;i++){
  const v=await call('/'+pid+'/state',{auth:pkeys[i]});assert.equal(v.data.state.players.length,4);assert.equal(v.data.names[0],i?'Pod '+i:'Pod host');assert.equal(v.data.state.players[0].life,40);assert(v.data.state.players.slice(1).every(p=>p.hand.every(c=>c.hidden&&!c.id)));assert(v.data.state.players.every(p=>p.library.every(c=>c.hidden)));assert(!JSON.stringify(v).includes('keyHash'));assert(!JSON.stringify(v).includes('inviteHashes'));
  pv=await call('/'+pid+'/action',{auth:pkeys[i],body:{revision:v.data.revision,action:{type:'keep',args:[0,[]]}}});assert.equal(pv.status,200);
 }
 for(let i=0;i<4;i++){const v=await call('/'+pid+'/state',{auth:pkeys[i]});assert.equal(v.data.state.active,0);pv=await call('/'+pid+'/action',{auth:pkeys[i],body:{revision:v.data.revision,action:{type:'turn'}}});assert.equal(pv.status,200);}
 const v=await call('/'+pid+'/state',{auth:pkeys[1]});pv=await call('/'+pid+'/action',{auth:pkeys[1],body:{revision:v.data.revision,action:{type:'concede'}}});assert.equal(pv.status,200);assert.equal(pv.data.state.result,null);assert.equal(pv.data.state.players[0].eliminated,true);
 console.log('Real SQLite four-player pod: three single-use invitations, four private seats, deck readiness, full turn cycle and independent concession passed');
 assert.equal((await call('',{body:{mode:'rules',format:'commander',cards:commanderRows}})).status,400);
 console.log('Real SQLite Commander room: 40 life, public command zones, private hands, guest cast/counter/return and per-commander tax passed');
 console.log('Real Durable Object / SQLite: two independent seats, trusted deck lookup, single-use invite, private hands/libraries, reconnect, room isolation, ownership, concurrent revision conflict, concession and origin checks passed');
}finally{await mf.dispose();}
