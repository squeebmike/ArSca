import {createDeckLabServerEngine} from './deck-lab-server-engine.mjs';
export const roomEngine=createDeckLabServerEngine();
export const ROOM_TTL=4*60*60*1000;
export function secureRandom(){return crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;}
export function roomView(room,seat){
 const state=room.state?structuredClone(room.state):null;
 if(state){
  // Do not transmit library identities to either seat, or the other hand to anyone.
  state.players.forEach((p,i)=>{if(i!==seat||!room.players[seat].searching)p.library=p.library.map(()=>({hidden:true}));if(i!==seat){p.hand=p.hand.map(()=>({hidden:true}));p.sideboard=(p.sideboard||[]).map(()=>({hidden:true}));}});
  const count=state.players.length,order=Array.from({length:count},(_,i)=>(seat+i)%count),relative=p=>(p-seat+count)%count;
  state.players=order.map(i=>state.players[i]);state.active=relative(state.active);state.priority=relative(state.priority);
  (state.commanders||[]).forEach(c=>c.owner=relative(c.owner));state.stack.forEach(t=>{t.controller=relative(t.controller);if(/^player[0-9]+$/.test(t.target||''))t.target='player'+relative(Number(t.target.slice(6)));});if(state.result&&state.result.winner!==null)state.result.winner=relative(state.result.winner);
  state.mode=room.mode==='rules'?'remote-rules':'remote-table';
  state.librarySearch=!!room.players[seat].searching;
  state.log=state.log.map(t=>t.replace(/^You /,'Host ').replace(/^Opponent /,'Guest ').replace(/^(Turn \d+: )you /,'$1host ').replace(/^(Turn \d+: )opponent /,'$1guest '));
 }
 return {revision:room.revision,expiresAt:room.expiresAt,seat,mode:room.mode,format:room.format||'casual',capacity:room.players.length,names:Array.from({length:room.players.length},(_,i)=>room.players[(seat+i)%room.players.length]?.name||'Waiting for player'),ready:room.players.map(p=>!!p?.cards),joined:room.players.filter(Boolean).length===room.players.length,joinedCount:room.players.filter(Boolean).length,state};
}
export function putRoomDeck(room,seat,cards,name,expected,random=secureRandom){
 if(room.revision!==expected)throw Error('The room changed. Sync and try again.');
 if(room.state)throw Error('A match is already in progress.');
 const report=roomEngine.validateDeck(cards,room.format||'casual');if(report.errors.length)throw Error(report.errors.join(' '));
 if(room.format==='commander'&&room.mode==='rules')throw Error('Commander currently uses a freeform room.');
 if(room.mode==='rules'&&cards.some(c=>(!c.deckSection||c.deckSection==='main')&&roomEngine.support(c).kind==='manual'))throw Error('This deck has cards outside automated rules coverage. Create a freeform room for this deck.');
 const next=structuredClone(room);next.players[seat]={...next.players[seat],name:String(name||'Player').slice(0,60),cards};next.revision++;
 if(next.players.every(p=>p?.cards)){
  next.state=roomEngine.create(next.players.map(p=>p.cards),{mode:'manual',random,format:room.format||'casual'});
  next.state.log.push('Private online match. Host plays first. '+(room.mode==='rules'?'Server checks the supported rules.':'Freeform: both players apply card effects and rules manually.'));
  // Remove the pre-shuffle lists once the physical cards are in match zones.
  next.players.forEach(p=>{p.cards=null;});
 }
 return next;
}
export function applyRoomAction(room,seat,action,expected){
 if(room.revision!==expected)throw Error('The room changed. Sync and try again.');
 if(!room.state)throw Error('Waiting for all players to load a deck.');
 const next=structuredClone(room),s=next.state;
 if(s.result)throw Error('This match has ended. Create another room for a rematch.');
 const {type,args=[]}=action||{};if(s.players[seat].eliminated)throw Error('You are out of this game.');
 if(type==='concede'){if(s.players.length>2)roomEngine.eliminate(s,seat,'Last player remaining');else s.result={winner:1-seat,reason:'Concession'};s.log.push(next.players[seat].name+' concedes.');}
 else if(type==='keep'){roomEngine.keep(s,seat,args[1]||[]);if(s.phase!=='opening')s.log[s.log.length-1]=s.players.length>2?'Multiplayer: the starting player also draws. Beginning steps are manual.':'Host plays first and skips the first draw. Precombat main phase.';}
 else if(type==='mulligan')roomEngine.mulligan(s,seat,secureRandom);
 else if(room.mode==='rules'){
  if(!['land','cast','pass','attack','block','discard'].includes(type))throw Error('Action is not supported in a rules room.');
  // Actor comes from the bearer capability, never from the caller's player index.
  const params=args.slice(1);if(type==='cast'&&seat===1){if(params[1]==='player0')params[1]='player1';else if(params[1]==='player1')params[1]='player0';}
  roomEngine[type](s,seat,...params);
 }else if(type==='manual'){
  if(s.phase==='opening')throw Error('Keep your opening hand first.');
  const data=args[0];if(!data||data.player!==0)throw Error('You can move only your own cards and adjust your own life.');
  const c=s.players[seat][data.from]?.find?.(c=>c.id===data.id),name=c?.name;
  roomEngine.manual(s,{...data,player:seat});
  s.log.push((seat?'Guest':'Host')+' '+(data.kind==='draw'?'draws a card.':data.kind==='life'?'changes their life by '+data.value+'.':data.to&&['field','graveyard','exile'].includes(data.to)?'moves '+name+' to '+data.to+'.':'updates a card.'));
 }else if(type==='search'){
  if(s.phase==='opening')throw Error('Keep your opening hand first.');next.players[seat].searching=true;s.log.push((seat?'Guest':'Host')+' searches their library.');
 }else if(type==='shuffle'){
  if(s.phase==='opening')throw Error('Keep your opening hand first.');s.players[seat].library=roomEngine.shuffled(s.players[seat].library,secureRandom);next.players[seat].searching=false;s.log.push((seat?'Guest':'Host')+' shuffles their library.');
 }else if(type==='turn'){
  if(s.phase==='opening'||s.active!==seat)throw Error('Only the active player can pass the turn.');
  s.active=roomEngine.nextPlayer(s,s.active);s.priority=s.active;s.turn++;s.players[s.active].field.forEach(c=>c.tapped=false);s.log.push('Turn passed. Untap applied; draw and other turn actions are manual.');
 }else throw Error('Unknown table action.');
 next.revision++;s.decisions++;return next;
}
export async function boundedJson(message,max=250000){
 const reader=message.body?.getReader();if(!reader)throw Error('JSON body required.');let size=0,out='';const decoder=new TextDecoder();
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('Request is too large.');out+=decoder.decode(value,{stream:true});}return JSON.parse(out+decoder.decode());}finally{await reader.cancel().catch(()=>{});}
}
function thinCard(c){
 const uri=u=>{try{const x=new URL(u);return x.protocol==='https:'&&x.hostname==='cards.scryfall.io'?x.href:'';}catch{return '';}};
 const fields=['id','name','type_line','mana_cost','cmc','oracle_text','power','toughness','layout','color_identity','legalities','keywords'];const out=Object.fromEntries(fields.filter(k=>c[k]!==undefined).map(k=>[k,c[k]]));out.image_uris={normal:uri(c.image_uris?.normal)};out.scryfall_uri='https://scryfall.com/card/'+encodeURIComponent(c.set)+'/'+encodeURIComponent(c.collector_number);
 if(c.card_faces)out.card_faces=c.card_faces.map(f=>({name:f.name,oracle_text:f.oracle_text,image_uris:{normal:uri(f.image_uris?.normal)}}));return out;
}
export async function verifiedRoomDeck(rows,fetcher=fetch){
 if(!Array.isArray(rows)||!rows.length||rows.length>150)throw Error('Send 1–150 unique card printings.');
 const merged=new Map();for(const r of rows){if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(r?.id)||!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>250||!['main','commander','sideboard'].includes(r.section||'main'))throw Error('Invalid card identifier, section or quantity.');const k=r.id+':'+(r.section||'main'),old=merged.get(k);merged.set(k,{id:r.id,section:r.section||'main',quantity:(old?.quantity||0)+r.quantity});}
 const total=[...merged.values()].reduce((a,b)=>a+b.quantity,0);if(total<7||total>250)throw Error('Deck must contain 7–250 cards including the supplied zones.');
 const ids=[...new Set([...merged.values()].map(r=>r.id))],found=new Map();
 for(let i=0;i<ids.length;i+=75){
  if(i)await new Promise(r=>setTimeout(r,150));
  const r=await fetcher('https://api.scryfall.com/cards/collection',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','User-Agent':'TheManaPocket/1.0 (private deck playtesting)'},body:JSON.stringify({identifiers:ids.slice(i,i+75).map(id=>({id}))}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Card verification is unavailable (provider HTTP '+r.status+'). Try again later; your deck has not been submitted.');const data=await boundedJson(r,1500000);for(const c of data.data||[])if(ids.includes(c.id)&&typeof c.name==='string')found.set(c.id,thinCard(c));
 }
 if(ids.some(id=>!found.has(id)))throw Error('Some cards could not be verified. Reload your deck and try again.');
 return [...merged.values()].flatMap(r=>Array.from({length:r.quantity},()=>({...structuredClone(found.get(r.id)),deckSection:r.section})));
}
