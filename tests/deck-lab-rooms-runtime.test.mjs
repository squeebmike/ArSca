// Workerd + real SQLite boundary test; STUDIO_TOOLING can locate existing tools.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(process.env.STUDIO_TOOLING||import.meta.url),{build}=require('esbuild'),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
const fixture={id:'11111111-1111-4111-8111-111111111111',name:'Forest',type_line:'Basic Land — Forest',oracle_text:'',mana_cost:'',set:'lea',collector_number:'295',layout:'normal'};
const bundle=await build({stdin:{sourcefile:'deck-room-harness.mjs',resolveDir:process.cwd(),contents:`import {DeckLabRoom,handleDeckLabRooms} from './scripts/mtg/deck-lab-room.mjs';export {DeckLabRoom};globalThis.fetch=async(url,init)=>{if(url!=='https://api.scryfall.com/cards/collection')throw Error('Unexpected network request');return Response.json({data:[${JSON.stringify(fixture)}]});};export default {fetch:(request,env)=>handleDeckLabRooms(request,env,{limit:async()=>null})};`},bundle:true,platform:'browser',format:'esm',external:['cloudflare:workers'],write:false});
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
 console.log('Real Durable Object / SQLite: two independent seats, trusted deck lookup, single-use invite, private hands/libraries, reconnect, room isolation, ownership, concurrent revision conflict, concession and origin checks passed');
}finally{await mf.dispose();}
