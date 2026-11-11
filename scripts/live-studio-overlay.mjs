import {DEFAULT_STUDIO, COMBO_WINDOW_MS, EFFECT_LABELS, publicStats, emptyStats, marqueeLines, hypeNow, hypeAfterSale, HYPE_MOOD, HYPE_MAX} from './live-studio-model.mjs';
import {bossById, drawBoss} from './live-studio-bosses.mjs';
import {createByteRider} from './byterider.mjs';
import {roomById} from './live-studio-dungeon.mjs';
const $=id=>document.getElementById(id);
const sign=$('mana-sign'), text=$('mana-message'), effectEl=$('mana-effect'), coins=$('mana-coins');
const hud=$('mana-hud'), boss=$('mana-boss'), card=$('mana-card'), queue=$('mana-queue');
let settings={...DEFAULT_STUDIO}, stats=publicStats(emptyStats(),DEFAULT_STUDIO), stage={now:null,next:[]};
let drawnBoss='', socket, retry=0, effect=null, offset=0, audio, lastBeep=-1, played=new Set(), shownGross=null;
const params=new URLSearchParams(location.hash.slice(1));
const token=params.get('token'), store=params.get('store'), endpoint=params.get('worker');
const preview=params.get('preview')==='1';
// The fragment is never sent as a request URL or Referer. OBS retains its source URL for reloads.
const usd=n=>'$'+(Math.round((Number(n)||0)*100)/100).toLocaleString('en-US',{minimumFractionDigits:Number(n)%1?2:0,maximumFractionDigits:2});
// The sign's rising mana bubbles.
for(let i=0;i<12;i++){const b=document.createElement('i');b.style.left=(i*8)+'%';b.style.animationDelay=-(i%5)+'s';document.querySelector('.mana-bubbles')?.append(b);}
// ByteRider_97 lives in the overlay and reacts to the show (reactions below).
const mascotHost=$('byterider'), mascot=mascotHost?createByteRider(mascotHost,{onChange:e=>mascotSound(e)}):null;
// The hype meter (see HYPE_* in live-studio-model.mjs).
let hype={level:0,at:Date.now()};
let lastNowTitle=null, soldLine=0, lastPhase='';
// Polished-N64 3D (scripts/live-studio-3d.mjs): the boss and the coins. If
// WebGL or the module isn't there, the flat sprites and CSS coins stay.
let gl=null, bossView=null, effectBoss=null, coinLayer=null;
import('./live-studio-3d.mjs').then(m=>{
  try{
    const ps1=settings.bossStyle!=='n64';
    bossView=m.createBossView($('mana-boss-3d'),{size:280,ps1});
    effectBoss=m.createBossView($('mana-effect-boss'),{size:420,fov:28,ps1});
    coinLayer=m.createCoinLayer($('mana-coins-3d'));
    gl=m;document.body.classList.add('mana-3d');drawnBoss='';apply(settings);bossView.start();
    // Read-only peek for tests: is 3D on, which boss, how many coins in the air.
    window.manaStudio3d=()=>({boss:bossView.id,coins:coinLayer.count,bossPixels:bossView.litPixels(),ps1:bossView.ps1,exploded:effectBoss.exploded});
  }catch(e){console.warn('[studio] 3D off:',e?.message||e);bossView=effectBoss=coinLayer=gl=null;document.body.classList.remove('mana-3d');}
}).catch(e=>console.warn('[studio] 3D off:',e?.message||e));
// The Shed Dungeon (scripts/live-studio-dungeon.mjs), when it's on.
const dg=()=>settings.dungeonOn&&stats.dungeon?.on?stats.dungeon:null;
// The boss on screen: the dungeon floor's, or the show's boss bar.
function curBoss(){
  const d=dg();
  if(d)return {character:d.boss.character,name:d.boss.name,hp:d.boss.hp,pct:d.pct,defeated:false,show:settings.showBoss&&d.boss.active};
  const b=stats.boss||{};
  return {character:b.character||settings.bossCharacter,name:b.name||settings.bossName,hp:b.hp,pct:b.pct??100,defeated:!!b.defeated,show:settings.showBoss};
}
const place=(el,left,top,show=true)=>{el.style.left=left+'px';el.style.top=top+'px';el.classList.toggle('mana-hidden',!show);};

function apply(s) {
  settings={...DEFAULT_STUDIO,...s};
  Object.assign(sign.style,{left:settings.x+'px',top:settings.y+'px',width:settings.width+'px',height:settings.height+'px'});
  sign.classList.toggle('mana-hidden',!settings.visible);
  sign.style.setProperty('--mana-speed',settings.speed+'s'); text.textContent=settings.message;
  // The scrolling text can be switched off (the sign and its bubbling mana stay).
  sign.querySelector('.mana-track').classList.toggle('mana-hidden',settings.marqueeOn===false);
  place(hud,40,settings.hudY,settings.showHud);
  // Big photo: over the bottom camera, full width.
  card.classList.toggle('big',!!settings.bigArt);
  if(settings.bigArt){place(card,40,settings.bigArtY);card.style.height=Math.max(420,Math.min(900,1900-settings.bigArtY))+'px';}
  else {place(card,settings.cardX,settings.cardY);card.style.height='';}
  // Next up beside the card, or above it when there's no room.
  const qx=settings.cardX+400<=760?settings.cardX+400:Math.max(0,settings.cardX), qy=settings.cardX+400<=760?settings.cardY+70:Math.max(0,settings.cardY-230);
  place(queue,qx,qy);
  // Center stage: the boss stands just above the sign's mana bar.
  $('mana-arena').style.top=Math.max(0,settings.y-330)+'px';$('mana-crawl').style.top=Math.max(0,settings.y-404)+'px';
  // Bursts are centered on the sign.
  const cx=settings.x+settings.width/2, cy=settings.y+settings.height/2;
  Object.assign(effectEl.style,{left:Math.max(0,Math.min(1080-900,cx-450))+'px',top:Math.max(0,Math.min(1920-640,cy-320))+'px',width:'900px',height:'640px'});
  // PS1 or N64 bosses.
  bossView?.style(settings.bossStyle!=='n64');effectBoss?.style(settings.bossStyle!=='n64');
  if(mascot){mascot.place({y:settings.mascotFaceY,scale:settings.mascotScale,border:settings.mascotBorder,idleFace:settings.mascotIdleFace});mascot.show(settings.mascotOn!==false);}
  paintStage();paintStats(stats,false);paintHype();
}
function paintStats(next,fromSale) {
  const before=shownGross;stats=next||stats;
  $('mana-gross').textContent=usd(stats.gross);$('mana-sold').textContent=String(stats.sold);$('mana-biggest').textContent=usd(stats.biggest);
  const b=curBoss(),d=dg();
  boss.classList.toggle('mana-hidden',!b.show);
  // The boss's sprite and catchphrase, redrawn when the boss changes.
  if(drawnBoss!==b.character){drawnBoss=b.character;void drawBoss($('mana-boss-sprite'),drawnBoss);bossView?.set(drawnBoss);effectBoss?.set(drawnBoss);}
  // The boss bar's boss stomps in when the flask fills.
  const phase=d?d.phase+d.floor:'';if(d&&d.phase==='boss'&&lastPhase&&lastPhase!==phase)bossView?.enter();lastPhase=phase;
  paintDungeon(d);paintVote();
  $('mana-boss-name').textContent=b.name;
  $('mana-boss-hp').textContent=b.defeated?'DEFEATED':'HP '+usd(b.hp);
  const fill=$('mana-boss-fill');fill.style.width=Math.max(0,Math.min(100,b.pct??100))+'%';fill.classList.toggle('low',(b.pct??100)<=25);
  boss.classList.toggle('defeated',!!b.defeated);bossView?.defeat(!!b.defeated);
  $('mana-boss-taunt').textContent=b.defeated?'"I\'LL BE BACK NEXT SHOW..."':'"'+bossById(b.character).taunt+'"';
  if(fromSale && before!=null && stats.gross>before){
    for(const el of [$('mana-gross'),$('mana-sold')]){el.classList.remove('bump');void el.offsetWidth;el.classList.add('bump');}
    // Coins pop out of the score, more for a bigger sale.
    if(coinLayer&&settings.showHud){const r=$('mana-gross').getBoundingClientRect();coinLayer.burst(r.left+r.width/2,r.top+r.height/2,Math.min(16,6+Math.round((stats.gross-before)/25)));}
    // In the dungeon, a sale before the boss shows up fills the flask.
    if(d&&!b.show){const m=document.createElement('b');m.textContent='+'+usd(stats.gross-before);$('mana-sign-hits').append(m);setTimeout(()=>m.remove(),1500);}
    if(b.show){
      boss.classList.remove('hit');void boss.offsetWidth;boss.classList.add('hit');bossView?.hit();
      const cr=$('mana-crawl');cr.classList.remove('hit');void cr.offsetWidth;cr.classList.add('hit');
      const dmg=document.createElement('b');const wpn=d?.weapon;dmg.textContent=(wpn?wpn.icon+' '+wpn.hit+' ':'')+'-'+usd(stats.gross-before);$('mana-boss-hits').append(dmg);setTimeout(()=>dmg.remove(),1500);
    }
  }
  shownGross=stats.gross;
}
// The flask sign + the floor badge on the score board.
function paintDungeon(d){
  sign.classList.toggle('dungeon',!!d);sign.classList.toggle('boss',!!d&&d.phase==='boss');sign.classList.toggle('full',!!d&&d.phase==='floor'&&d.pct>=90);
  $('mana-dungeon').classList.toggle('mana-hidden',!d);
  // CENTER STAGE (store, 2026-11-11: "mana bar in the center? bosses"): the
  // bubbling mana sign, bigger, across the middle, the floor's boss on top of it.
  const center=!!d&&settings.centerStage!==false&&settings.visible!==false, arena=$('mana-arena');
  document.body.classList.toggle('mana-center',center);
  if(center&&boss.parentElement!==arena)arena.append(boss);
  else if(!center&&boss.parentElement===arena)hud.insertBefore(boss,$('mana-dungeon'));
  arena.classList.toggle('mana-hidden',!(center&&d.phase==='boss'&&settings.showBoss!==false));
  paintCrawl(d,center);paintForeground(d,center);
  paintMap(d);
  if(!d){$('mana-title-text').textContent='THE MANA POCKET';sign.style.removeProperty('--fill');return;}
  sign.style.setProperty('--fill',String(Math.max(4,Math.min(100,d.pct))));
  $('mana-title-text').textContent='FLOOR '+d.floor+' · '+(d.room?d.room.name:d.shed);
  $('mana-flask-meter').textContent=d.phase==='boss'?'BOSS HP '+usd(d.boss.hp):usd(d.mana)+' / '+usd(d.goal);
  $('mana-cbar-sub').textContent=d.phase==='boss'?'EVERY SALE HITS THE BOSS!':usd(Math.max(0,d.goal-d.mana))+' MORE TO SUMMON '+d.boss.name+'!';
  $('mana-dungeon-floor').textContent='FLOOR '+d.floor;$('mana-dungeon-shed').textContent=d.shed+(d.room?' · '+d.room.icon+' '+d.room.name:'')+(d.finale?' · FINALE':'');
  $('mana-dungeon-stars').textContent=d.stars?'STARS '+d.stars:'';
  const next=[d.reward?'FLOOR REWARD: '+d.reward:'',d.nextUnlock?'NEXT UNLOCK '+usd(d.nextUnlock.at)+': '+d.nextUnlock.text:''].filter(Boolean).join('  •  ');
  $('mana-dungeon-next').textContent=next;
}
// THE SHED CRAWL, first person (2026-11-11: "like doom visuals ... walking
// through halls, rooms ... looking for and through shit"): scripts/shed-crawl-fp.mjs.
// Mana walks you down the floor's hallways; it stops to rummage at fixed
// spots; the boss waits in the last room. The weapon chat picked is in hand.
let fp=null,fpBoss='',fpOn=false;const fpBossCanvas=document.createElement('canvas');
import('./shed-crawl-fp.mjs').then(m=>{fpLib=m;fp=m.createShedCrawl($('mana-fp'));
  fp.onPeek(showPeek);
  fpOn=false;paintStats(stats,false);}).catch(e=>console.warn('[studio] crawl off:',e?.message||e));
// The flashlight battery (2026-11-11): it runs down when the show goes quiet
// (no sales, follows, shares or bookmarks) and is full again with the next one.
const BATTERY_DRAIN_MS=6*60000;
function batteryNow(d){const last=Math.max(Number(stats.lastSaleAt)||0,Number(d?.lastAt)||0);if(!last)return 1;return Math.max(0.15,Math.min(1,1-(Date.now()+offset-last)/BATTERY_DRAIN_MS));}
// Item photos for the crawl's walls: NEXT UP's photos through the Worker (CORS).
let fpPicKey='';
function studioImg(u){if(!u)return '';try{const w=endpoint?new URL(endpoint):null;return w?w.origin+'/public/studio-img?u='+encodeURIComponent(u):u;}catch{return u;}}
function loadPictures(){if(!fp||!fpLib)return;const urls=[stage.now,...(stage.next||[])].filter(x=>x&&x.image).map(x=>x.image).slice(0,12),key=urls.join('|');if(key===fpPicKey)return;fpPicKey=key;Promise.all(urls.map(u=>fpLib.loadPicture(studioImg(u)))).then(list=>fp?.setPictures(list));}
let fpLib=null,peekPct=-1,peekFloor=0;
function paintCrawl(d,center){
  // The window over the top camera only when CRAWL WINDOW is on; otherwise the
  // crawl is the green-screen background (shed-background.html) and this is a slim bar.
  const el=$('mana-crawl'),show=!!d&&center,win=show&&settings.crawlWindow===true;
  el.classList.toggle('mana-hidden',!show);el.classList.toggle('bar',show&&!win);el.classList.toggle('boss',!!d&&d.phase==='boss');
  if(!win&&fpOn){fp?.stop();fpOn=false;}
  if(!show)return;
  const batt=batteryNow(d);
  if(win&&fp){
    fp.set({floor:d.floor,shed:d.shed,pct:d.pct,phase:d.phase,chests:[0,1,2].map(k=>(d.opened||[]).includes(k)),battery:batt,fork:d.fork||''});
    if(fpBoss!==d.boss.character){fpBoss=d.boss.character;void drawBoss(fpBossCanvas,fpBoss,{size:48}).then(ok=>{if(ok)fp.setBoss(fpBossCanvas);});}
    if(!fpOn){fp.start();fpOn=true;}
    loadPictures();
  }
  // Without the window, the overlay calls out the rummaging spots itself.
  if(!win&&fpLib){const pk=fpLib.layoutFor(d.floor).peeks,pct=d.phase==='boss'?100:d.pct;if(peekFloor!==d.floor){peekFloor=d.floor;peekPct=pct;}else{const hit=pk.find(p=>peekPct<p.at*100&&pct>=p.at*100);if(hit)showPeek(hit.label);peekPct=pct;}}
  const w=d.weapon;$('mana-crawl-weapon').textContent=(w?w.icon+' '+w.name+'  ·  ':'')+'FLOOR '+d.floor+' · '+(d.name?'"'+d.name+'"':d.shed)+(d.fork?' · '+(d.fork==='left'?'COLLECTOR SIDE':'BARGAIN SIDE'):'');
  $('mana-fp-hand').textContent=w?w.icon:'🔦';
  // The next treasure chest: locked until chat's goal, or how far ahead.
  const opened=d.opened||[],goals=d.chests||[],nextK=[0,1,2].find(k=>!opened.includes(k));
  const g=nextK==null?null:goals[nextK];
  $('mana-fp-chest').textContent=nextK==null?'🧰 ALL 3 CHESTS OPEN':g&&!g.open?'🔒 CHEST '+(nextK+1)+': '+g.have+'/'+g.n+' '+g.kind.toUpperCase()+'S':'🧰 CHEST '+(nextK+1)+' AHEAD';
  // The battery: bars, and a warning when it's low.
  const bars=Math.round(batt*5);$('mana-fp-batt').textContent='🔦 '+'▮'.repeat(bars)+'▯'.repeat(5-bars)+(batt<0.35?' FOLLOW/SHARE TO RECHARGE!':'');
  el.classList.toggle('lowbatt',batt<0.35);
}
// PROPS IN FRONT (2026-11-11: "some things in front of us ... some behind ...
// make it pseudo 3D"): with the hallway on the green screen BEHIND the hosts,
// big pixel props slide past IN FRONT of them as the crawl walks -- comic
// stacks, dollar bins, card boxes, figures -- and the floor's chests when the
// walk reaches one (open once it's opened). They grow and slide out to the
// sides like you're walking past them.
const FG_KINDS=['comics','dollarbin','cardbox','figure','pizza','bucket','comics','cardbox'];
let fgShown=-1,fgTarget=0,fgFloor=0,fgOpened=[],fgLast=0;
function paintForeground(d,center){
  const el=$('mana-fg'),on=!!d&&center&&settings.foreground!==false&&!!fpLib;
  el.classList.toggle('mana-hidden',!on);if(!on)return;
  const pct=d.phase==='boss'?1:Math.max(0,Math.min(1,d.pct/100));
  if(fgFloor!==d.floor){fgFloor=d.floor;fgShown=pct;}
  fgTarget=pct;fgOpened=d.opened||[];
  el.style.top=Math.max(0,settings.y-62-350)+'px';
}
function fgSide(cv,phase,kind,side,open){
  // phase 0..1: far and small near the middle -> close, big, sliding off the edge.
  const k=cv.getContext('2d');k.imageSmoothingEnabled=false;
  fpLib.drawSprite(k,kind==='chest'&&open?'chestopen':kind,10,0.55+0.45*phase);
  const scale=0.6+phase*0.95,x=(side<0?-1:1)*(phase*190-60),y=-phase*6;
  cv.style.transform=`translate(${x}px,${y}px) scale(${scale})`;cv.style.opacity=String(Math.min(1,phase*4,(1-phase)*5+0.15));
  cv.style.filter=`drop-shadow(8px 10px 0 #000a) brightness(${0.75+phase*0.35})`;
}
function fgFrame(now){
  requestAnimationFrame(fgFrame);
  if(now-fgLast<50||$('mana-fg').classList.contains('mana-hidden'))return;const dt=Math.min(0.2,(now-(fgLast||now))/1000);fgLast=now;
  if(fgShown<0)fgShown=fgTarget;if(fgShown<fgTarget)fgShown=Math.min(fgTarget,fgShown+dt*0.06);else fgShown=fgTarget;
  // Three props per side per floor; the right side shows a chest when the walk is at one.
  const at=[0.16,0.47,0.8],near=at.findIndex(a=>Math.abs(fgShown-a)<0.07);
  const pl=(fgShown*3)%1,pr=(fgShown*3+0.5)%1,il=Math.floor(fgShown*3),ir=Math.floor(fgShown*3+0.5);
  fgSide($('mana-fg-l'),pl,FG_KINDS[(il+fgFloor)%FG_KINDS.length],-1,false);
  if(near>=0){const ph=Math.min(0.95,Math.max(0.05,0.5+(fgShown-at[near])/0.14));fgSide($('mana-fg-r'),ph,'chest',1,fgOpened.includes(near));}
  else fgSide($('mana-fg-r'),pr,FG_KINDS[(ir+fgFloor+3)%FG_KINDS.length],1,false);
}
requestAnimationFrame(fgFrame);
function showPeek(t){const el=$('mana-fp-peek');el.textContent=t;el.classList.remove('on');void el.offsetWidth;el.classList.add('on');}
setInterval(()=>{const d=dg();if(d&&document.body.classList.contains('mana-center'))paintCrawl(d,true);},5000);
// A revealed item (a chest, or where chat said to dig): its photo spins in 3D.
function revealItem(e){
  const it=e.item;if(!it||!it.title)return;
  const el=$('mana-reveal'),img=$('mana-reveal-img');
  $('mana-reveal-label').textContent=e.kind==='found'?'FOUND IT'+(e.spot?' IN '+e.spot:'')+'!':'CHEST OPENED! '+(e.chestText||'$1 START!');
  $('mana-reveal-title').textContent=it.title;$('mana-reveal-price').textContent=e.kind==='chest'?'$1 START!':(it.price?'VALUE '+usd(it.price):'');
  img.hidden=!it.image;if(it.image)img.src=studioImg(it.image);
  el.style.top=Math.max(0,settings.y-610)+'px';
  el.classList.remove('mana-hidden','on');void el.offsetWidth;el.classList.add('on');
  clearTimeout(revealItem.t);revealItem.t=setTimeout(()=>el.classList.add('mana-hidden'),7600);
}
// CHAT PICKS: the numbered choices chat votes on (the host taps the winner).
// An open door vote shows on its own.
function paintVote(){
  const v=stats.vote,d=dg(),el=$('mana-vote');
  const doors=!v&&d&&d.doors?{kind:'door',options:d.doors.map(r=>({label:r.icon+' '+r.name}))}:null,show=v||doors;
  el.classList.toggle('mana-hidden',!show||settings.visible===false);
  if(!show)return;
  el.classList.toggle('trivia',show.kind==='trivia');el.style.top=Math.max(0,settings.y-330)+'px';
  el.querySelector('.mana-vote-foot').textContent=show.kind==='trivia'?'TYPE YOUR ANSWER IN CHAT':'TYPE THE NUMBER IN CHAT';
  el.querySelector('.mana-vote-head').textContent=show.kind==='trivia'?'BYTERIDER TRIVIA!':'CHAT PICKS!';
  $('mana-vote-title').textContent=show.kind==='weapon'?'PICK THE HERO\'S WEAPON':show.kind==='next'?'WHAT COMES UP NEXT?':show.kind==='dig'?'WHERE DO WE DIG?':show.kind==='fork'?'A FORK IN THE HALL!':show.kind==='trivia'?show.question:'PICK A DOOR';
  if(show.kind==='trivia'){$('mana-vote-list').replaceChildren();return;}
  $('mana-vote-list').replaceChildren(...show.options.map((o,i)=>{const li=document.createElement('li');const n=document.createElement('b');n.textContent=String(i+1);li.append(n,document.createTextNode(o.label));return li;}));
  el.style.top=Math.max(0,settings.y-330)+'px';
}
// The map (floors this week, the next one dark), the doors chat is voting
// on, and the relic shelf.
let mapKey='';
function paintMap(d){
  const el=$('mana-map');el.classList.toggle('mana-hidden',!d||settings.showMap===false);
  if(!d)return;
  // Center stage: the map moves under the sign, out of the crawl's way.
  const centered=document.body.classList.contains('mana-center');
  el.style.left=(centered?800:Number(settings.mapX)||0)+'px';el.style.top=(centered?settings.y+225:Number(settings.mapY)||0)+'px';
  const key=JSON.stringify([d.map,d.doors,d.relics]);if(key===mapKey)return;mapKey=key;
  const doors=$('mana-doors');doors.replaceChildren();
  if(d.doors){const b=document.createElement('b');b.textContent='CHAT: PICK A DOOR!';const row=document.createElement('div');
    d.doors.forEach((r,i)=>{const sp=document.createElement('span'),ic=document.createElement('i');ic.textContent=r.icon;sp.append(ic,document.createTextNode((i+1)+' · '+r.name));row.append(sp);});doors.append(b,row);}
  $('mana-map-list').replaceChildren(...d.map.map(m=>{const li=document.createElement('li');li.className=m.cleared?'cleared':m.current?'current':'dark';
    const n=document.createElement('b');n.textContent=m.floor;const em=document.createElement('em');
    if(m.dark){li.append(n,document.createTextNode('???'));return li;}
    em.textContent=m.shed;li.append(n,document.createTextNode((m.icon?m.icon+' ':'')+(m.room||(m.floor===1?'THE WAY IN':m.current&&d.doors?'DOOR VOTE…':'UNEXPLORED'))+(m.cleared?' ✓':'')),em);return li;}));
  $('mana-relics').replaceChildren(...d.relics.map(r=>{const i=document.createElement('i');i.textContent=r.icon;i.title=r.name;return i;}));
}
function paintStage() {
  const now=stage.now;
  card.classList.toggle('has-art',!!now?.image);card.classList.toggle('has-price',!!now?.price);
  const insert=$('mana-card-insert');insert.innerHTML=now?'NO<br>PHOTO':'INSERT<br>COIN';insert.classList.toggle('still',!!now);
  const img=$('mana-card-img');if(now?.image){if(img.src!==now.image)img.src=now.image;}else img.removeAttribute('src');
  $('mana-card-title').textContent=now?.title||(settings.attract?'PLAYER SELECT':'');
  $('mana-card-detail').textContent=now?.detail||'';
  $('mana-card-price').innerHTML='';
  if(now?.price){const s=document.createElement('small');s.textContent='GUIDE';$('mana-card-price').append(s,document.createTextNode(usd(now.price)));}
  card.classList.toggle('mana-hidden',!settings.showCard||(!now&&!settings.attract));
  const list=$('mana-queue-list');list.replaceChildren(...(stage.next||[]).slice(0,3).map(n=>{const li=document.createElement('li');li.textContent=n.title+(n.price?' · '+usd(n.price):'');return li;}));
  queue.classList.toggle('mana-hidden',!settings.showQueue||settings.bigArt||!(stage.next||[]).length);
  // A new item up (NEXT ITEM, or auto-advance after an auction sells): ByteRider calls it.
  // Whatnot sends no "auction started" event; this is the closest real signal.
  const title=now?.title||'';
  if(lastNowTitle!==null&&title&&title!==lastNowTitle)mascot?.play('surprised',{text:'UP NEXT: '+(title.length>42?title.slice(0,40)+'…':title)});
  lastNowTitle=title;
}
// What ByteRider_97 does for each show event. Lines take turns (no chance involved).
const TAP_LINES={follow:'NEW FOLLOWER! WELCOME TO THE POCKET!',share:'THANKS FOR THE SHARE!',bookmark:'BOOKMARKED! SEE YOU NEXT SHOW!'};
const TAP_WORDS={follow:'FOLLOW',share:'SHARE',bookmark:'BOOKMARK'};
const SOLD_LINES=['SOLD!','KA-CHING!','ANOTHER ONE!','NICE PULL!','STRAIGHT TO THE PILE!','GG, COLLECTOR!'];
function react(e){
  if(!mascot)return;
  const amt=e.amount?' '+usd(e.amount):'';
  switch(e.kind){
    // A sale: a new hi-score floors him; a combo makes him dizzy; while the
    // boss stands, every other sale he taunts it; otherwise a happy line.
    case 'sold': {
      // Each sale fills the hype meter; his mood climbs with it.
      hype=hypeAfterSale(hype,{},Date.now());paintHype();
      const bossUp=settings.showBoss&&stats.boss&&!stats.boss.defeated, mood=HYPE_MOOD[hype.level];
      if(e.record)mascot.play('cool',{text:'NEW HI-SCORE. NATURALLY.'+amt});
      else if(hype.level>=HYPE_MAX)mascot.play('glitch',{text:'OVERDRIVE!!'+amt,ms:2200});
      else if(mood==='dizzy'||e.combo>=5)mascot.play('dizzy',{text:(e.combo>=3?e.combo+'× COMBO?! ':'')+'TOO FAST!'+amt});
      else if(mood==='excited'||e.combo>=3)mascot.play('excited',{text:(e.combo>=3?e.combo+'× COMBO!':'HYPE!')+amt});
      else if(bossUp&&soldLine%2)mascot.play('smug',{text:'TAKE THAT, '+String(stats.boss.name||settings.bossName).replace(/^THE /,'')+'!'+(e.amount?' -'+usd(e.amount):''),}),soldLine++;
      else mascot.play('happy',{text:SOLD_LINES[soldLine++%SOLD_LINES.length]+amt});
      break;
    }
    case 'jackpot': hype=hypeAfterSale(hype,{big:true},Date.now());paintHype();mascot.play('jackpot',{text:'BIG HIT!'+amt});break;
    case 'boss': hype=hypeAfterSale(hype,{big:true},Date.now());paintHype();mascot.play('shocked',{text:'WAIT-- WE BEAT IT?!',ms:1400});mascot.play('celebrating',{text:e.relic?'IT DROPPED THE '+e.relic+'!':e.nextFloor?'FLOOR '+e.nextFloor+' UNLOCKED!':'BOSS DOWN! GG!'});
      if(e.doors?.length===2){const [a,b]=e.doors.map(roomById);if(a&&b)setTimeout(()=>mascot.play('alert',{text:'TWO DOORS! CHAT, TYPE 1 FOR '+a.name+' OR 2 FOR '+b.name+'!',ms:5000}),6000);}break;
    case 'room': {const r=roomById(e.room);mascot.play('excited',{text:r?'INTO THE '+r.name+'!':'ONWARD!'});break;}
    case 'floor': mascot.play('alert',{text:'FLASK FULL! '+(e.bossName||'THE BOSS')+' INCOMING!',ms:1800});mascot.play('angry',{text:'GET HIM, CHAT!'});break;
    case 'unlock': mascot.play('celebrating',{text:'UNLOCKED: '+(e.unlockText||'')});break;
    case 'chest': mascot.play('jackpot',{text:'CHEST OPENED! '+(e.item?.title?'$1 START: '+e.item.title:e.chestText||'')});break;
    case 'found': mascot.play('excited',{text:'FOUND IT! '+(e.item?.title||'')});break;
    case 'trivia': mascot.play('celebrating',{text:'CORRECT! IT WAS '+(e.answer||'')+'!'});break;
    case 'tap': mascot.play(e.tapKind==='follow'?'love':'happy',{text:TAP_LINES[e.tapKind]||'MANA!'});break;
    case 'countdown': mascot.play('countdown',{ms:Math.max(1000,e.endsAt-1200-e.startsAt)});mascot.play('surprised',{text:'GO GO GO!'});break;
    case 'ready': mascot.play('disappearing',{boot:true});mascot.play('loading',{ms:1500});mascot.play('talking',{text:"PLAYER 1 READY! LET'S GO!"});break;
    case 'gameover': mascot.play('sad',{text:"SHOW'S OVER?! ...SAME TIME NEXT SHOW?"});setTimeout(()=>mascot.play('sleeping'),5000);break;
    case 'giveaway': mascot.play('alert',{text:'FREE GIVEAWAY! ENTER IN THE WHATNOT APP!'});break;
    case 'winner': mascot.play('love',{text:e.buyer?'WINNER: @'+e.buyer+'!':'WE HAVE A WINNER!'});break;
    case 'coin': mascot.play('talking',{text:'INSERT COIN!'});break;
  }
}

// Chiptune: square-wave notes.
function tone(freq,duration=.12,when=0,type='square',vol=1) {
  if(settings.muted || preview) return;
  try {
    audio ||= new AudioContext();
    if(audio.state==='suspended') {void audio.resume().catch(()=>{});return;}
    const t=audio.currentTime+when,o=audio.createOscillator(),g=audio.createGain(); o.type=type;o.frequency.setValueAtTime(freq,t);
    g.gain.setValueAtTime(settings.volume/100*.12*vol,t);g.gain.exponentialRampToValueAtTime(.001,t+duration);
    o.connect(g).connect(audio.destination);o.start(t);o.stop(t+duration);
  } catch {}
}
const tune=(notes,step=.11)=>notes.forEach((f,i)=>f&&tone(f,step*1.4,i*step));
// ByteRider's sounds: quieter than the show's, a beat after them, and only
// with "ByteRider sounds" on (the overlay's volume and mute still rule).
function noise(dur=.15,when=0,vol=.5){
  if(settings.muted||preview)return;
  try{audio||=new AudioContext();if(audio.state==='suspended')return;
    const n=Math.floor(audio.sampleRate*dur),buf=audio.createBuffer(1,n,audio.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<n;i++)d[i]=((i*7919)%1000/500-1)*(1-i/n);
    const src=audio.createBufferSource(),g=audio.createGain();src.buffer=buf;g.gain.value=settings.volume/100*.08*vol;
    src.connect(g).connect(audio.destination);src.start(audio.currentTime+when);}catch{}
}
const bt=(notes,step=.07,type='square',vol=.45,at=.3)=>notes.forEach((f,i)=>f&&tone(f,step*1.3,at+i*step,type,vol));
const BR_SOUNDS={
  happy:()=>bt([660,880]), excited:()=>bt([660,880,1047,1319],.05), laughing:()=>bt([880,660,880,660],.09),
  smug:()=>bt([392,523],.12,'triangle'), wink:()=>bt([1319],.08), cool:()=>{bt([98],.3,'sawtooth',.5);bt([392,494,587],.06,'square',.35,.45);},
  surprised:()=>bt([440,660,990],.04), shocked:()=>bt([330,660,1320],.05,'sawtooth'), sad:()=>bt([523,440,349],.16,'triangle'),
  angry:()=>bt([110,104],.18,'sawtooth',.6), love:()=>bt([784,1047],.16,'triangle'), alert:()=>bt([880,0,880],.1),
  thinking:()=>bt([523,0,587,0,659],.08,'triangle',.35), dizzy:()=>bt([600,500,700,450,750],.06,'triangle'),
  jackpot:()=>bt([988,1319,988,1319],.06), celebrating:()=>bt([523,659,784,1047],.08),
  glitch:()=>{noise(.18,.3);bt([1500,200],.03,'sawtooth',.3,.32);}, error:()=>{noise(.2,.3);bt([220,110],.12,'square');},
  disappearing:()=>noise(.35,.2,.7), remind:()=>{noise(.12,.3);bt([1319,1568,1319],.1,'triangle',.4,.45);},
  loading:()=>bt([880,0,880,0,880],.12,'square',.25), processing:()=>bt([660,660,660,880],.11,'square',.25),
  sleeping:()=>bt([196,175],.4,'triangle',.3),
};
function mascotSound({state,text,newState,newText}){
  if(settings.mascotSounds===false)return;
  // A line: a bloop per syllable-ish, pitched from his words.
  if(newText){const t=String(text).replace(/[^A-Za-z0-9]/g,'').slice(0,8);bt([...t].map(c=>260+(c.charCodeAt(0)*37)%420),.06,'square',.3,.25);}
  if(newState&&BR_SOUNDS[state])BR_SOUNDS[state]();
}
const SOUNDS={
  sold:()=>{tone(110,.18,0,'sawtooth',.8);tune([523,659,784,1047],.08);},
  jackpot:()=>tune([523,659,784,1047,0,784,1047,1319,1568],.1),
  boss:()=>{tone(80,.5,0,'sawtooth',1);tune([392,0,392,523,659,784,0,1047,1047,1319],.12);},
  coin:()=>tune([988,1319],.09),
  ready:()=>tune([523,523,784,1047],.13),
  gameover:()=>tune([784,659,523,392,330,262],.16),
  giveaway:()=>tune([659,784,988,1319,988,1319],.1),
  winner:()=>tune([784,988,1175,1568,0,1568],.11),
  floor:()=>{tone(70,.6,0,'sawtooth',1);tune([262,0,247,0,233,0,220,330,440],.12);},
  unlock:()=>tune([659,880,1175,1319],.09),
  room:()=>{noise(.3,0,.6);tune([196,262,330,392,523],.1);},
  tap:()=>tune([1047,1568],.06),
};
document.addEventListener('click',()=>{audio ||= new AudioContext();void audio.resume();});

// Coins scattered (a fixed spread -- the same every time).
function rain(n=24){if(coinLayer){coinLayer.rain(n>=36?40:26,n>=36?4200:3200);return;}coins.replaceChildren();for(let i=0;i<n;i++){const c=document.createElement('i');c.textContent='●';c.style.left=((i*37)%97)+'%';c.style.animationDelay=-((i*53)%23)/10+'s';c.style.animationDuration=(1.8+((i*29)%9)/10)+'s';coins.append(c);}}
function receiveEffect(e,initial=false) {
  if(!e || e.kind==='clear' || e.endsAt <= Date.now()+offset) {effect=null;coins.replaceChildren();if(e?.kind==='clear')coinLayer?.clear();return;}
  // Reconnect restores a running countdown without replaying a sale sound/celebration.
  if(initial && e.kind!=='countdown') return;
  if(played.has(e.id)) return;
  played.add(e.id);if(played.size>200) played.delete(played.values().next().value);
  // A ByteRider reaction or line from the dashboard: just him, no burst.
  if(e.kind==='mascot'){mascot?.play(e.mascotState,{text:e.say||'',boot:e.mascotState==='disappearing'});return;}
  // A follow / share / bookmark: a float on the flask and a line, no burst.
  if(e.kind==='tap'){react(e);const m=document.createElement('b');m.textContent='+'+(e.mana||0)+' '+(TAP_WORDS[e.tapKind]||'MANA');$('mana-sign-hits').append(m);setTimeout(()=>m.remove(),1500);if(!initial)SOUNDS.tap();return;}
  react(e);revealItem(e);
  effect=e;lastBeep=-1;coins.replaceChildren();
  if(['jackpot','boss','unlock','chest','found','trivia'].includes(e.kind)) rain(e.kind==='boss'?36:24);
  if(!initial && e.kind!=='countdown') (SOUNDS[e.kind]||SOUNDS.coin)();
}
function words(e) {
  const thanks=e.buyer?'THANKS @'+e.buyer:'';
  const extras=[e.record?'NEW HI-SCORE!':'',settings.showCombo&&e.combo>=2?e.combo+'× COMBO!':'',thanks].filter(Boolean).join(' • ');
  switch(e.kind){
    case 'sold': return [e.word||'POW!',e.amount?usd(e.amount):'SOLD!',e.amount?['SOLD!',extras].filter(Boolean).join(' • '):extras];
    case 'jackpot': return ['BIG HIT!',e.amount?usd(e.amount):'',['SOLD!',extras].filter(Boolean).join(' • ')];
    case 'boss': if(e.dungeon)return [(e.bossName||'BOSS')+' DEFEATED!','FLOOR '+(e.nextFloor||'')+' UNLOCKED!',[e.reward?'REWARD: '+e.reward:'',e.relic?'RELIC: '+(e.relicIcon||'')+' '+e.relic:''].filter(Boolean).join(' • ')];
    case 'room': {const r=roomById(e.room);return [(r?r.icon+' ':'')+(r?r.name:'A NEW ROOM'),'FLOOR '+(e.floor||''),e.auto?'NO VOTE IN -- DOOR 1 IT IS!':(r?r.blurb.toUpperCase():'')];}
      return [(e.bossName||settings.bossName)+' DEFEATED!','K.O.!',e.reward||settings.bossReward];
    case 'floor': return ['FLOOR '+(e.floor||'')+' CLEARED!','BOSS APPEARS!','VS '+(e.bossName||'THE BOSS')];
    case 'unlock': return ['UNLOCKED!',e.unlockAt?usd(e.unlockAt):'',e.unlockText||''];
    case 'chest': return ['CHEST OPENED!',e.chestGoal?(/^CHAT HIT|^CHEST/.test(e.chestGoal)?e.chestGoal:'CHAT HIT '+e.chestGoal)+'!':'',e.item?.title?(e.chestText||'$1 START')+': '+e.item.title:e.chestText||''];
    case 'found': return ['FOUND IT!',e.spot?'IN '+e.spot:'',e.item?.title||''];
    case 'trivia': return ['CORRECT!',e.answer||'',(e.who?'@'+e.who+' GOT IT · ':'')+(e.mana?'+'+usd(e.mana)+' MANA FOR EVERYONE':'NICE ONE, CHAT')];
    case 'giveaway': return ['FREE GIVEAWAY!','','FREE TO ENTER IN THE WHATNOT APP'];
    case 'winner': return ['WINNER!',e.buyer?'@'+e.buyer:'','GIVEAWAY WINNER — PICKED BY WHATNOT'];
    case 'gameover': return ['GAME OVER','','THANKS FOR PLAYING!'];
    // Show start: a boss-fight intro card.
    case 'ready': {const d=dg();if(d)return ['FLOOR '+d.floor,d.shed,d.phase==='boss'?'BOSS FIGHT: '+d.boss.name:'FILL THE MANA FLASK!'];}
      if(!settings.showBoss)return ['PLAYER 1 READY','',''];
      return ['BOSS FIGHT!','VS',(settings.bossName||'')+' — "'+bossById(settings.bossCharacter).taunt+'"'];
    default: return [EFFECT_LABELS[e.kind]||'','',''];
  }
}
let lastKind='';
function draw() {
  const now=Date.now()+offset;
  if(effect && effect.endsAt>now) {
    if(lastKind!==effect.id){effectEl.className='active k-'+effect.kind+(effect.item?.title&&['chest','found'].includes(effect.kind)?' with-item':'');lastKind=effect.id;
      if(effect.kind==='boss'||effect.kind==='floor'||(effect.kind==='ready'&&settings.showBoss&&!dg())){
        const who=effect.bossCharacter||settings.bossCharacter;
        if(effectBoss){effectBoss.set(who);effectBoss.defeat(false);if(effect.kind==='floor')effectBoss.enter();effectBoss.start();
          // Beaten: a beat of HP-zero, then it blows apart (PS1) or keels over.
          if(effect.kind==='boss'){const id=effect.id;setTimeout(()=>{if(effect?.id===id)effectBoss.defeat(true);},700);}}
        else{try{$('mana-effect-art').src=$('mana-boss-sprite').toDataURL();}catch{}}
      } else effectBoss?.stop();
      if(effect.kind!=='countdown'){const [w,m,s]=words(effect);$('mana-effect-word').textContent=w;$('mana-effect-main').textContent=m;$('mana-effect-sub').textContent=s;}}
    if(effect.kind==='countdown') {
      const n=Math.max(0,Math.ceil((effect.endsAt-1200-now)/1000));$('mana-effect-word').textContent=n||'GO!';$('mana-effect-main').textContent=n?'LAST CALL!':'';$('mana-effect-sub').textContent='';
      if(n!==lastBeep){lastBeep=n;tone(n?440:880,n?.1:.3);}
    }
  } else if(effect||lastKind){effectEl.className='';effect=null;lastKind='';coins.replaceChildren();effectBoss?.stop();}
  const combo=$('mana-combo'),on=settings.showCombo&&stats.combo>=2&&now-stats.lastSaleAt<COMBO_WINDOW_MS;
  if(on&&combo.textContent!==stats.combo+'× COMBO!')combo.textContent=stats.combo+'× COMBO!';
  combo.classList.toggle('on',on);
  requestAnimationFrame(draw);
}
function connect() {
  if(!endpoint || !store || !token) return;
  let url;try {url=new URL(endpoint);if(url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))return;}catch{return;}
  url.protocol=url.protocol==='https:'?'wss:':'ws:';url.pathname='/live-studio/socket';url.search='?store_id='+encodeURIComponent(store);url.hash='';
  socket=new WebSocket(url);
  socket.onopen=()=>socket.send(JSON.stringify({token}));
  socket.onmessage=ev=>{try {const m=JSON.parse(ev.data);offset=m.serverNow-Date.now();retry=0;
    if(m.settings)apply(m.settings);
    if(m.stage){stage=m.stage;paintStage();}
    if(m.stats)paintStats(m.stats,m.type==='effect'||m.type==='stats');
    if(m.type==='effect'||m.type==='snapshot')receiveEffect(m.effect,m.type==='snapshot');}catch{}};
  socket.onclose=ev=>{if(ev.code===1008)return;setTimeout(connect,Math.min(30000,1000*2**Math.min(retry++,5)));};
}
// ByteRider says the marquee: its lines one at a time, every N seconds, in
// turn, when he isn't in the middle of a reaction (and not while he naps
// after the show).
// The hype meter: drains a notch every 20 quiet seconds.
function paintHype(){
  const el=$('mana-hype');if(!el)return;
  // With the dungeon on, the flask sign is the hype bar.
  el.classList.toggle('mana-hidden',settings.showHype===false||settings.mascotOn===false||!!settings.dungeonOn);
  const lv=hypeNow(hype).level;el.querySelectorAll('i').forEach((seg,i)=>seg.classList.toggle('on',i<lv));
  el.classList.toggle('max',lv>=HYPE_MAX);
}
setInterval(()=>{const before=hype.level;hype=hypeNow(hype);if(hype.level!==before)paintHype();},1000);
let marqueeLine=0,lastMarquee=Date.now();
setInterval(()=>{
  if(!mascot||!settings.mascotSaysMarquee||settings.mascotOn===false)return;
  if(Date.now()-lastMarquee<(Number(settings.mascotSayEvery)||45)*1000)return;
  if(mascot.machine.current.state!=='idle')return;
  const lines=marqueeLines(settings.message);if(!lines.length)return;
  lastMarquee=Date.now();mascot.say(lines[marqueeLine++%lines.length]);
},1000);
apply(settings);draw();connect();
// Local editor preview only; same-origin parent can show settings without network access.
if(preview) window.addEventListener('message',ev=>{if(ev.source!==parent || ev.origin!==location.origin)return;
  if(ev.data?.type==='mana-preview'){apply(ev.data.settings);if(ev.data.stage){stage=ev.data.stage;paintStage();}if(ev.data.stats)paintStats(ev.data.stats,!!ev.data.effect);if(ev.data.effect)receiveEffect(ev.data.effect);}});
