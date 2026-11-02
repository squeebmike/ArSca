import assert from 'node:assert/strict';
import {DEFAULT_STUDIO,validateSettings,whatnotEffect,makeEffect,applyOrder,emptyStats,publicStats,statsFromOrders,validateStage,chanceWordIn,COMBO_WINDOW_MS,advanceStage} from '../scripts/live-studio-model.mjs';
import {handleLiveStudio} from '../scripts/live-studio-api.mjs';
import {BOSSES,BOSS_IDS,bossById,DEFAULT_BOSS} from '../scripts/live-studio-bosses.mjs';
import {verifyStandardWebhook} from '../scripts/whatnot-api.mjs';

assert.throws(()=>validateSettings({...DEFAULT_STUDIO,x:1000}),/fit/);
assert.throws(()=>validateSettings({volume:NaN}),/volume/);
assert.throws(()=>validateSettings({automatic:true}),/IDs/);
assert.throws(()=>validateSettings({width:'500'}),/width/);
assert.throws(()=>validateSettings({token:'secret'}),/Unknown/);
const settings={...DEFAULT_STUDIO,automatic:true,sellerId:'seller-a',showId:'show-a'};
const now=Date.now();
const event={version:'v2',seller_id:'seller-a',timestamp:new Date(now).toISOString(),type:'orders.created',data:{show_id:'show-a',transaction_type:'auction',status:'pending_fulfillment',amounts:{subtotal:{amount:'105',currency:'USD'}}}};
assert.equal(whatnotEffect(event,settings,now).kind,'jackpot');
assert.equal(whatnotEffect({...event,seller_id:'other'},settings,now),null);
assert.equal(whatnotEffect({...event,data:{...event.data,show_id:'other'}},settings,now),null);
assert.equal(whatnotEffect({...event,data:{...event.data,transaction_type:'buy_it_now'}},settings,now),null);
assert.equal(whatnotEffect({...event,data:{...event.data,status:'cancelled'}},settings,now),null);
assert.equal(whatnotEffect({...event,type:'bids.created'},settings,now),null);
assert.equal(whatnotEffect({...event,timestamp:new Date(now-61000).toISOString()},settings,now),null);
assert.equal(whatnotEffect(event,{...settings,automatic:false},now),null);
assert.equal(makeEffect('countdown',settings,now).endsAt,now+6200);
const id='11111111-1111-4111-8111-111111111111';
let accessed=0;
const room={snapshot:()=>{accessed++;return {settings};},update:()=>({conflict:true}),trigger:()=>{accessed++;return {};}};
const env={MANA_LIVE_STUDIO:{getByName:()=>room}};
const json=(data,status=200)=>Response.json(data,{status});
const deps={json,requireStoreUser:async()=>({error:json({ok:false},403)}),readJsonWithLimit:async r=>({data:await r.json()})};
let u=new URL('https://worker/live-studio/state?store_id='+id);
assert.equal((await handleLiveStudio(new Request(u),env,deps,u)).status,403);
assert.equal(accessed,0,'unauthorized controllers cannot read state');
deps.requireStoreUser=async(r,e,store,roles)=>{assert.equal(store,id);assert.deepEqual(roles,['owner','admin','manager']);return {user:{id:'u'}};};
assert.equal((await handleLiveStudio(new Request(u),env,deps,u)).status,200);
u=new URL('https://worker/live-studio/settings?store_id='+id);
assert.equal((await handleLiveStudio(new Request(u,{method:'POST',body:'{}'}),env,deps,u)).status,409);
assert.equal((await handleLiveStudio(new Request(u),{},deps,u)).status,503);
const raw=JSON.stringify(event), bytes=new Uint8Array(32).fill(7), ts=String(Math.floor(now/1000));
const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`event-1.${ts}.${raw}`))).toString('base64');
const h=new Headers({'webhook-id':'event-1','webhook-timestamp':ts,'webhook-signature':'v1,'+signature});
assert.equal(await verifyStandardWebhook('wn_wh_'+Buffer.from(bytes).toString('base64'),h,raw),'');
assert.notEqual(await verifyStandardWebhook('wn_wh_'+Buffer.from(bytes).toString('base64'),h,raw+' '),'');

// 90s comic / arcade build (store, 2026-11-01).
// No games of chance: words for them can't be saved on the sign, boss or stage.
for (const t of ['RAFFLE AT 9PM','spin the wheel!','Slot machine pulls','Buy to win a Charizard','lottery','Place your bets']) assert.ok(chanceWordIn(t), t);
for (const t of ['THE MANA POCKET • INSERT COIN','$1 START ON THE GRAIL!','BIG HIT','Better Call Saul #1','Spinning Top Spider-Man']) assert.equal(chanceWordIn(t), '', t);
assert.throws(()=>validateSettings({bossReward:'Free raffle entry for buyers'}),/game of chance/);
assert.throws(()=>validateSettings({message:'SPIN THE WHEEL AFTER EVERY BUY'}),/game of chance/);
assert.throws(()=>validateStage({now:{title:'Mystery lotto pack'}}),/game of chance/);
assert.equal(validateSettings({automatic:true,showId:'show-a'}).showId,'show-a','the seller ID is optional (the webhook is already signed for this store)');
assert.throws(()=>validateSettings({bossGoal:0}),/bossGoal/);
// Stage: text cleaned, only https images, three next up at most.
const st=validateStage({now:{title:'Spawn #1',detail:'CGC 9.8',image:'javascript:alert(1)',price:'120'},next:[{title:'a'},{title:'b'},{title:'c'},{title:'d'},{title:''}]});
assert.equal(st.now.image,'');assert.equal(st.now.price,120);assert.equal(st.next.length,4,'a prepped show keeps its whole lineup (up to 60)');
assert.equal(validateStage({next:Array.from({length:80},(_,i)=>({title:'#'+i}))}).next.length,60);
assert.equal(validateStage({now:{title:'X',image:'https://still-resonance-4f87.swarnerauto.workers.dev/p.jpg'}}).now.image,'https://still-resonance-4f87.swarnerauto.workers.dev/p.jpg');
// Score board: every order counts -- auction and Buy It Now -- and the boss takes the damage.
const live={...DEFAULT_STUDIO,automatic:true,showId:'show-a',bossGoal:100,jackpotAmount:50};
const order=(id,amount,extra={})=>({id,show_id:'show-a',status:'pending_fulfillment',transaction_type:'auction',amounts:{subtotal:{amount:String(amount),currency:'USD'}},buyer:{username:'collector42'},...extra});
let t0=1_000_000,stats=emptyStats('show-a'),r;
r=applyOrder(stats,order('o1',20),live,t0);stats=r.stats;
assert.equal(r.effect.kind,'sold');assert.equal(r.effect.amount,20);assert.equal(r.effect.word,'POW!');assert.equal(r.effect.buyer,'','buyer names are off by default');
r=applyOrder(stats,order('o2',30,{transaction_type:'buy_it_now'}),live,t0+30000);stats=r.stats;
assert.equal(stats.gross,50);assert.equal(stats.sold,2);assert.equal(stats.combo,2,'two sales inside 90 seconds');assert.equal(r.effect.record,true,'a new biggest sale');
assert.equal(applyOrder(stats,order('o2',30),live,t0+31000).effect,null,'the same order twice counts once');
r=applyOrder(stats,order('o3',60),live,t0+40000);stats=r.stats;
assert.equal(r.effect.kind,'boss','the sale that takes the boss past its goal');assert.equal(stats.defeatedAt,t0+40000);
let pub=publicStats(stats,live);assert.equal(pub.boss.hp,0);assert.equal(pub.boss.defeated,true);assert.equal(pub.biggest,60);
assert.equal(JSON.stringify(pub).includes('collector42'),false,'the overlay never gets buyers');assert.equal('orders' in pub,false);
r=applyOrder(stats,order('o4',70),live,t0+40000+COMBO_WINDOW_MS+1);stats=r.stats;
assert.equal(r.effect.kind,'jackpot','over the BIG HIT amount; the boss is already down');assert.equal(stats.combo,1,'combo resets after 90 seconds');
// Cancelled: taken back off.
r=applyOrder(stats,order('o4',70,{status:'cancelled'}),live,t0+50000*3);stats=r.stats;
assert.equal(stats.gross,110);assert.equal(stats.sold,3);assert.equal(stats.biggest,60);assert.equal(r.effect,null);
// Giveaway: counted apart, winner shown (username only when turned on).
r=applyOrder(stats,order('g1',0,{transaction_type:'giveaway'}),{...live,showBuyerNames:true},t0+200000);
assert.equal(r.effect.kind,'winner');assert.equal(r.effect.buyer,'collector42');assert.equal(r.stats.giveaways,1);assert.equal(r.stats.gross,110);
// Another show's order doesn't count.
assert.equal(applyOrder(stats,order('x',500,{show_id:'other'}),live,t0).effect,null);
// Rebuilt from Whatnot's order list.
const rebuilt=statsFromOrders([order('o1',20,{created_at:'2026-11-01T01:00:00Z'}),order('o2',30,{created_at:'2026-11-01T01:01:00Z'}),order('o5',5,{status:'cancelled',created_at:'2026-11-01T01:02:00Z'}),order('z',99,{show_id:'other'})],live);
assert.equal(rebuilt.gross,50);assert.equal(rebuilt.sold,2);assert.equal(rebuilt.combo,0,'a rebuild is not a combo');
// Effects carry only what the overlay shows.
const boss=makeEffect('boss',live,t0,{amount:60,word:'BAM!',buyer:'',secret:'x'});
assert.equal(boss.reward,live.bossReward);assert.equal('secret' in boss,false);assert.equal(boss.endsAt-boss.startsAt,9000);
// The new routes: stage, totals sync / reset, current show; a fixable setting says what's wrong.
{
  const calls=[];
  const room2={snapshot:()=>({settings:{...DEFAULT_STUDIO,showId:'show-a'}}),setStage:st=>{calls.push(['stage',st]);return {stage:st};},syncStats:o=>{calls.push(['sync',o.length]);return {stats:{gross:9}};},resetStats:()=>{calls.push(['reset']);return {};},
    update:()=>{throw new Error('"raffle" reads as a game of chance -- Whatnot doesn\'t allow those. Reword the boss reward.');}};
  const env2={MANA_LIVE_STUDIO:{getByName:()=>room2}};
  const d2={...deps,requireStoreUser:async()=>({user:{id:'u'}}),showOrders:async(store,show)=>{calls.push(['orders',store,show]);return [{id:1},{id:2}];},currentShow:async()=>({id:'show-b',title:'Pre Funk',live:true})};
  const post=async(path,body,dd=d2)=>{const u=new URL('https://worker'+path+'?store_id='+id);const r=await handleLiveStudio(new Request(u,{method:path==='/live-studio/current-show'?'GET':'POST',body:path==='/live-studio/current-show'?undefined:JSON.stringify(body||{})}),env2,dd,u);return {status:r.status,body:await r.json()};};
  assert.equal((await post('/live-studio/stage',{stage:{now:{title:'Spawn #1'}}})).status,200);
  let r=await post('/live-studio/stats-sync');assert.equal(r.body.stats.gross,9);assert.deepEqual(calls.find(c=>c[0]==='orders'),['orders',id,'show-a']);
  assert.equal((await post('/live-studio/stats-reset')).status,200);
  r=await post('/live-studio/current-show');assert.equal(r.status,200);assert.equal(r.body.show.id,'show-b');
  assert.equal((await post('/live-studio/stats-sync',{},{...d2,showOrders:undefined})).status,503);
  r=await post('/live-studio/settings',{settings:{bossReward:'raffle'},revision:0});assert.equal(r.status,400);assert.match(r.body.error,/game of chance/);
}
// Whatnot's API can't run auctions; when one sells, the next item lined up plays.
{
  const lineup={now:{title:'Spawn #1'},next:[{title:'X-Men #1'},{title:'Venom #1'}]};
  assert.deepEqual(advanceStage(lineup,{transaction_type:'auction'},DEFAULT_STUDIO),{now:{title:'X-Men #1'},next:[{title:'Venom #1'}]});
  assert.equal(advanceStage(lineup,{transaction_type:'buy_it_now'},DEFAULT_STUDIO),null,'a shop sale does not move the show');
  assert.equal(advanceStage(lineup,{transaction_type:'auction'},{...DEFAULT_STUDIO,autoAdvance:false}),null);
  assert.equal(advanceStage({now:{title:'last'},next:[]},{transaction_type:'auction'},DEFAULT_STUDIO),null,'nothing lined up: stays');
  assert.equal(validateSettings({bigArt:true,bigArtY:1000}).bigArt,true);
  assert.throws(()=>validateSettings({bigArtY:1500}),/bigArtY/);
}
// Original bosses (store, 2026-11-02: "The scalpers. The flipper... The dinged corner. With original artwork").
assert.deepEqual(BOSS_IDS,['scalper','flipper','dinged','grader','shipping']);
for (const id of BOSS_IDS) { const b=BOSSES[id]; assert.match(b.svg,/^<svg [^>]*viewBox="0 0 64 64">/); assert.ok(b.name&&b.taunt); assert.equal(chanceWordIn(b.name+' '+b.taunt),'',id); assert.doesNotMatch(b.svg+b.name+b.taunt,/marvel|dc comics|spider-?man|batman|<image|href=/i,'drawn here, nobody else\'s art'); }
assert.equal(bossById('nope'),BOSSES[DEFAULT_BOSS]);
assert.equal(DEFAULT_STUDIO.bossCharacter,'scalper');assert.equal(DEFAULT_STUDIO.bossName,'THE SCALPER');
assert.equal(validateSettings({bossCharacter:'dinged'}).bossCharacter,'dinged');
assert.throws(()=>validateSettings({bossCharacter:'hulk'}),/bossCharacter/);
assert.equal(publicStats(emptyStats('s'),{...DEFAULT_STUDIO,showId:'s',bossCharacter:'flipper'}).boss.character,'flipper');
assert.equal(makeEffect('boss',{...DEFAULT_STUDIO,bossCharacter:'grader'},1).bossCharacter,'grader');
console.log('Live Studio validation, event filtering, authentication, conflict and signature tests passed');
console.log('Live Studio score board, boss battle, combos, cancellations, giveaways, privacy and no-chance-words tests passed');
