// Run with Node 22+, esbuild and miniflare installed (or STUDIO_TOOLING pointing to their package.json).
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(process.env.STUDIO_TOOLING || import.meta.url);
const {build}=require('esbuild'), {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const result=await build({stdin:{contents:`
import {ManaLiveStudio} from './scripts/live-studio-room.mjs';
export {ManaLiveStudio};
export default {async fetch(req,env){
 const u=new URL(req.url), room=env.ROOM.getByName(u.searchParams.get('store')||'one');
 if(u.pathname==='/socket')return room.fetch(req);
 const b=req.method==='POST'?await req.json():{};
 const result=u.pathname==='/link'?await room.rotateOverlay():u.pathname==='/revoke'?await room.revokeOverlay():u.pathname==='/effect'?await room.trigger(b.kind):u.pathname==='/settings'?await room.update(b.settings,b.revision):u.pathname==='/event'?await room.receiveWhatnot(b.id,b.event):await room.snapshot();
 return Response.json(result);
}};`,resolveDir:process.cwd(),sourcefile:'runtime-harness.mjs'},bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],write:false});
const options={workers:[{name:'studio-test',modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-08-20',durableObjects:{ROOM:{className:'ManaLiveStudio',useSQLite:true}}}]};
const mf=new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
const call=async(p,body)=>{const r=await mf.dispatchFetch('http://local'+p,body?{method:'POST',body:JSON.stringify(body)}:{});return r.json();};
const message=ws=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('socket message timeout')),4000);ws.addEventListener('message',e=>{clearTimeout(timer);resolve(JSON.parse(e.data));},{once:true});});
const close=ws=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('socket close timeout')),4000);ws.addEventListener('close',e=>{clearTimeout(timer);resolve(e);},{once:true});});
async function socket(store='one'){const r=await mf.dispatchFetch('http://local/socket?store='+store,{headers:{Upgrade:'websocket'}});assert.equal(r.status,101);r.webSocket.accept();return r.webSocket;}
try {
 const state=await call('/state');assert.equal(state.revision,0);
 const link=await call('/link');assert.equal(link.token.length,72);
 const ws=await socket();let msg=message(ws);ws.send(JSON.stringify({token:link.token}));assert.equal((await msg).type,'snapshot');
 const wrong=await socket('other');let closed=close(wrong);wrong.send(JSON.stringify({token:link.token}));assert.equal((await closed).code,1008,'token cannot cross stores');
 msg=message(ws);await call('/settings',{revision:0,settings:{message:'NEW MANA',automatic:true,sellerId:'s',showId:'show'}});assert.equal((await msg).settings.message,'NEW MANA');
 assert.equal((await call('/settings',{revision:0,settings:{message:'stale'}})).conflict,true);
 assert.equal((await call('/state?store=other')).settings.message,state.settings.message);
 msg=message(ws);await call('/effect',{kind:'countdown'});const countdown=(await msg).effect;assert.equal(countdown.kind,'countdown');
 const reconnect=await socket();msg=message(reconnect);reconnect.send(JSON.stringify({token:link.token}));assert.equal((await msg).effect.id,countdown.id);reconnect.close();
 const event={type:'shows.started',version:'v2',seller_id:'s',timestamp:new Date().toISOString(),data:{show_id:'show'}};
 msg=message(ws);await call('/event',{id:'event-1',event});assert.equal((await msg).effect.kind,'ready');
 assert.equal((await call('/event',{id:'event-1',event})).duplicate,true);
 const effectId=(await call('/state')).effect.id;
 await call('/event',{id:'old-event',event:{...event,type:'shows.ended',timestamp:new Date(Date.now()-2000).toISOString()}});
 assert.equal((await call('/state')).effect.id,effectId,'out-of-order show event does not override newer event');
 closed=close(ws);ws.send(JSON.stringify({kind:'jackpot'}));assert.equal((await closed).code,1008,'overlay cannot send controls');
 const viewer=await socket();msg=message(viewer);viewer.send(JSON.stringify({token:link.token}));await msg;
 closed=close(viewer);await call('/revoke');assert.equal((await closed).code,1008);
 const revoked=await socket();closed=close(revoked);revoked.send(JSON.stringify({token:link.token}));assert.equal((await closed).code,1008);
 console.log('Real Durable Object / SQLite / WebSocket tests passed: auth, tenant isolation, settings, countdown reconnect, deduplication, ordering, read-only access and revocation');
} finally {await mf.dispose();}
