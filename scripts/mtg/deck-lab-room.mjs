import {DurableObject} from 'cloudflare:workers';
import {ROOM_TTL,roomView,putRoomDeck,applyRoomAction,boundedJson,verifiedRoomDeck} from './deck-lab-room-model.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');}
function equal(a,b){if(!a||!b||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
export class DeckLabRoom extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.sql=ctx.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS match_room(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');}
 read(){const r=this.sql.exec('SELECT value FROM match_room WHERE id=1').toArray()[0];return r?JSON.parse(r.value):null;}
 write(r){this.sql.exec('INSERT OR REPLACE INTO match_room VALUES(1,?)',JSON.stringify(r));}
 async alarm(){await this.ctx.storage.deleteAll();}
 async fetch(request){
  try{
   const path=new URL(request.url).pathname;
   if(path==='/create'){
    const b=await boundedJson(request);if(!['rules','table'].includes(b.mode)||!['casual','standard','commander'].includes(b.format||'casual'))return json({error:'Choose a valid format and room mode.'},400);
    if(b.format==='commander'&&b.mode==='rules')return json({error:'Commander currently uses a freeform room.'},400);
    const capacity=b.capacity??2;if(![2,4].includes(capacity)||capacity===4&&(b.format!=='commander'||b.mode!=='table'))return json({error:'Four-player rooms require Commander freeform.'},400);
    const cards=await verifiedRoomDeck(b.cards);const hostKey=token(),invite=token(),hostHash=await digest(hostKey),inviteHash=await digest(invite);const invites=[invite,...Array.from({length:capacity-2},()=>token())],inviteHashes=await Promise.all(invites.map(digest));
    let r={revision:0,mode:b.mode,format:b.format||'casual',expiresAt:Date.now()+ROOM_TTL,players:[{keyHash:hostHash,name:'Host',cards:null},...Array(capacity-1).fill(null)],inviteHash,inviteHashes,state:null};
    r=putRoomDeck(r,0,cards,b.name,0);if(this.read())return json({error:'Room already exists.'},409);
    this.write(r);await this.ctx.storage.setAlarm(r.expiresAt);return json({key:hostKey,invite,invites,...roomView(r,0)},201);
   }
   if(path==='/join'){
    const b=await boundedJson(request,1000);if(!/^[a-f0-9]{64}$/.test(b.invite||'')||!/^[a-f0-9]{64}$/.test(b.key||''))return json({error:'Invalid invite.'},400);
    const inviteHash=await digest(b.invite),keyHash=await digest(b.key),r=this.read();if(!r||Date.now()>=r.expiresAt)return json({error:'Room expired or unavailable.'},410);
    const existing=r.players.findIndex(p=>p&&equal(p.keyHash,keyHash));if(existing>=0)return json(roomView(r,existing));
    if(r.players.every(Boolean))return json({error:'The guest seat has already been claimed.'},409);
    const hashes=r.inviteHashes||[r.inviteHash],slot=hashes.findIndex(h=>equal(h,inviteHash));if(slot<0)return json({error:'Invite is invalid or already claimed.'},403);
    const seat=slot+1;if(r.players[seat])return json({error:'This guest seat has already been claimed.'},409);
    r.players[seat]={keyHash,name:'Guest '+seat,cards:null};hashes[slot]='';r.inviteHashes=hashes;if(seat===1)r.inviteHash='';r.revision++;this.write(r);return json(roomView(r,seat));
   }
   const bearer=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';if(!/^[a-f0-9]{64}$/.test(bearer))return json({error:'Room access required.'},401);
   const hashed=await digest(bearer);let r=this.read();if(!r||Date.now()>=r.expiresAt)return json({error:'Room expired or unavailable.'},410);
   const seat=r.players.findIndex(p=>p&&equal(p.keyHash,hashed));if(seat<0)return json({error:'Room access denied.'},403);
   if(path==='/state')return json(roomView(r,seat));
   const b=await boundedJson(request);
   r=this.read();
   if(path==='/deck'){
    const cards=await verifiedRoomDeck(b.cards);
    // External verification can yield: re-read the revision before committing.
    r=this.read();r=putRoomDeck(r,seat,cards,b.name,b.revision);
   }else if(path==='/action')r=applyRoomAction(r,seat,b.action,b.revision);
   else return json({error:'Unknown room action.'},404);
   this.write(r);return json(roomView(r,seat));
  }catch(e){return json({error:e.message||'Room request failed.'},400);}
 }
}

export async function handleDeckLabRooms(request,env,deps){
 const u=new URL(request.url),m=/^\/deck-lab\/rooms(?:\/([0-9a-f-]{36})\/(state|join|deck|action))?$/.exec(u.pathname);if(!m)return null;
 const action=m[2]||'create',read=action==='state';
 if(request.method!==(read?'GET':'POST'))return json({error:'Method not allowed.'},405);
 // Same-origin API; capability keys travel in headers, never query strings.
 if(!read&&request.headers.get('Origin')!==u.origin)return json({error:'Use this room from the Deck Lab website.'},403);
 if(!env.DECK_LAB_ROOMS)return json({error:'Online rooms are temporarily unavailable.'},503);
 try{const ip=request.headers.get('CF-Connecting-IP')||'unknown',limited=await deps.limit(env,'deck-room:'+action+':'+ip,action==='create'?4:read?150:120,action==='create'?3600:60);if(limited)return limited;}catch{return json({error:'Room service temporarily unavailable.'},503);}
 const id=m[1]||crypto.randomUUID(),stub=env.DECK_LAB_ROOMS.get(env.DECK_LAB_ROOMS.idFromName(id));
 const response=await stub.fetch(new Request('https://deck-room.internal/'+action,{method:request.method,headers:{'Content-Type':'application/json',Authorization:request.headers.get('Authorization')||''},body:read?undefined:request.body,duplex:'half'}));
 if(action!=='create'||!response.ok)return response;return json({room:id,...await response.json()},201);
}
