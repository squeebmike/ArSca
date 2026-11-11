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
 const result=u.pathname==='/link'?await room.rotateOverlay():u.pathname==='/revoke'?await room.revokeOverlay():u.pathname==='/effect'?await room.trigger(b.kind):u.pathname==='/settings'?await room.update(b.settings,b.revision):u.pathname==='/event'?await room.receiveWhatnot(b.id,b.event):u.pathname==='/stage'?await room.setStage(b.stage):u.pathname==='/sync'?await room.syncStats(b.orders):u.pathname==='/reset'?await room.resetStats():u.pathname==='/vote-open'?await room.openVote(b.kind):u.pathname==='/vote-pick'?await room.pickVote(b.index):u.pathname==='/trivia'?await room.askTrivia(b):u.pathname==='/adjust'?await room.dungeonAdjust(b):u.pathname==='/name'?await room.nameFloor(b.name):await room.snapshot();
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
 // Sales: the score board, boss damage and the comic burst (2026-11-01).
 const sale=(id,amount,extra={})=>({type:'orders.created',version:'v2',seller_id:'s',timestamp:new Date().toISOString(),data:{id,show_id:'show',status:'pending_fulfillment',transaction_type:'buy_it_now',amounts:{subtotal:{amount:String(amount),currency:'USD'}},buyer:{username:'collector42'},...extra}});
 msg=message(ws);await call('/event',{id:'sale-1',event:sale('o1',40)});let got=await msg;
 assert.equal(got.type,'effect');assert.equal(got.effect.kind,'sold');assert.equal(got.effect.amount,40);assert.equal(got.stats.gross,40);assert.equal(JSON.stringify(got).includes('collector42'),false,'buyer names are off by default');
 // A late webhook retry still counts, without a burst.
 msg=message(ws);await call('/event',{id:'sale-2',event:{...sale('o2',10),timestamp:new Date(Date.now()-3600000).toISOString()}});got=await msg;
 assert.equal(got.type,'stats');assert.equal(got.stats.gross,50);assert.equal(got.stats.sold,2);
 msg=message(ws);await call('/event',{id:'sale-3',event:{...sale('o2',10,{status:'cancelled'}),type:'orders.updated'}});got=await msg;assert.equal(got.stats.gross,40,'a cancelled order comes back off');
 msg=message(ws);await call('/settings',{revision:1,settings:{bossGoal:100}});await msg;
 msg=message(ws);await call('/event',{id:'sale-4',event:sale('o3',75)});got=await msg;assert.equal(got.effect.kind,'boss');assert.equal(got.stats.boss.defeated,true);assert.ok(got.effect.reward);
 msg=message(ws);await call('/stage',{stage:{now:{title:'Spawn #1',price:28,image:'https://x.example/a.jpg'},next:[{title:'X-Men #1'}]}});got=await msg;assert.equal(got.stage.now.title,'Spawn #1');
 // An auction sale moves NOW PLAYING to the next item lined up.
 msg=message(ws);await call('/event',{id:'sale-5',event:sale('o4',5,{transaction_type:'auction'})});got=await msg;assert.equal(got.stage.now.title,'X-Men #1');assert.equal(got.stage.next.length,0);
 assert.equal((await call('/sync',{orders:[{id:'a',show_id:'show',status:'completed',amounts:{subtotal:{amount:'5'}},created_at:'2026-11-01T00:00:00Z'}]})).stats.gross,5);
 assert.equal((await call('/reset')).stats.gross,0);
 closed=close(ws);ws.send(JSON.stringify({kind:'jackpot'}));assert.equal((await closed).code,1008,'overlay cannot send controls');
 const viewer=await socket();msg=message(viewer);viewer.send(JSON.stringify({token:link.token}));await msg;
 closed=close(viewer);await call('/revoke');assert.equal((await closed).code,1008);
 const revoked=await socket();closed=close(revoked);revoked.send(JSON.stringify({token:link.token}));assert.equal((await closed).code,1008);
 // Chat picks (2026-11-11): the weapon vote shows, the host taps the winner.
 let voted=await call('/vote-open',{kind:'weapon'});assert.equal(voted.stats.vote.options.length,4);
 voted=await call('/vote-pick',{index:2});assert.equal(voted.stats.vote,null);assert.equal(voted.stats.dungeon.weapon.id,'chicken');assert.match(voted.effect.say,/CHAT PICKED: RUBBER CHICKEN/);
 await call('/stage',{stage:{now:{title:'A'},next:[{title:'B'},{title:'C'}]}});
 await call('/vote-open',{kind:'next'});assert.deepEqual((await call('/vote-pick',{index:1})).stage.next.map(n=>n.title),['C','B'],'chat\'s pick comes up next');
 // FOUND IT!: chat says where to dig; that spot's item comes up next, with its photo.
 await call('/stage',{stage:{now:{title:'A'},next:[{title:'Cheap',price:3},{title:'Grail',price:400,image:'https://img.example/g.jpg'},{title:'Mid',price:40}]}});
 await call('/vote-open',{kind:'dig'});let dug=await call('/vote-pick',{index:1});
 assert.equal(dug.effect.kind,'found');assert.equal(dug.effect.item.title,'Grail');assert.equal(dug.stage.next[0].title,'Grail');
 // Trivia: the host sees the answer; the overlay's stats never carry it; CORRECT gives everyone mana.
 const tq=await call('/trivia',{});assert.ok(tq.triviaAnswer);assert.equal(JSON.stringify(tq.stats).includes(tq.triviaAnswer),false);
 const tc=await call('/vote-pick',{index:0});assert.equal(tc.effect.kind,'trivia');assert.equal(tc.effect.answer,tq.triviaAnswer);
 // A chest the crawl reaches opens and brings the most valuable NEXT UP item up as a $1 start.
 await call('/settings',{revision:(await call('/state')).revision,settings:{dungeonOn:true,floorBase:100}});
 await call('/stage',{stage:{now:{title:'A'},next:[{title:'Cheap',price:3},{title:'Grail',price:400}]}});
 await call('/adjust',{resetWeek:true});const before=(await call('/state')).stats.dungeon;assert.deepEqual(before.opened,[]);
 const ch=await call('/adjust',{mana:Math.ceil(before.goal*0.16)+1});
 assert.equal(ch.effect.kind,'chest');assert.equal(ch.effect.item.title,'Grail');assert.equal(ch.stage.next[0].title,'Grail');assert.deepEqual(ch.stats.dungeon.opened,[0]);
 assert.equal((await call('/name',{name:'box fort'})).stats.dungeon.name,'BOX FORT');
 // A new show going live on Whatnot: the studio follows it on its own (2026-11-11).
 const nextShow='9b2f6c1e-4d3a-4f8b-a1c2-3d4e5f6a7b8c';
 await call('/event',{id:'event-next',event:{...event,timestamp:new Date().toISOString(),data:{show_id:nextShow}}});
 let st=await call('/state');assert.equal(st.settings.showId,nextShow);assert.equal(st.stats.gross,0,'a new show starts its own totals');
 const nextSale=sale('o9',12);await call('/event',{id:'sale-next',event:{...nextSale,data:{...nextSale.data,show_id:nextShow}}});
 assert.equal((await call('/state')).stats.gross,12,'its sales count without anyone tapping USE LIVE');
 await call('/event',{id:'event-other-seller',event:{...event,seller_id:'someone-else',timestamp:new Date().toISOString(),data:{show_id:'1b2f6c1e-4d3a-4f8b-a1c2-3d4e5f6a7b8c'}}});
 assert.equal((await call('/state')).settings.showId,nextShow,'another seller\'s show is never followed');
 console.log('Real Durable Object / SQLite / WebSocket tests passed: auth, tenant isolation, settings, countdown reconnect, deduplication, ordering, read-only access and revocation');
} finally {await mf.dispose();}
