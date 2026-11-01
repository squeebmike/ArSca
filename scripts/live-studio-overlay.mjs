import {DEFAULT_STUDIO, COMBO_WINDOW_MS, EFFECT_LABELS, publicStats, emptyStats} from './live-studio-model.mjs';
const $=id=>document.getElementById(id);
const sign=$('mana-sign'), text=$('mana-message'), effectEl=$('mana-effect'), coins=$('mana-coins');
const hud=$('mana-hud'), boss=$('mana-boss'), card=$('mana-card'), queue=$('mana-queue');
let settings={...DEFAULT_STUDIO}, stats=publicStats(emptyStats(),DEFAULT_STUDIO), stage={now:null,next:[]};
let socket, retry=0, effect=null, offset=0, audio, lastBeep=-1, played=new Set(), shownGross=null;
const params=new URLSearchParams(location.hash.slice(1));
const token=params.get('token'), store=params.get('store'), endpoint=params.get('worker');
const preview=params.get('preview')==='1';
// The fragment is never sent as a request URL or Referer. OBS retains its source URL for reloads.
const usd=n=>'$'+(Math.round((Number(n)||0)*100)/100).toLocaleString('en-US',{minimumFractionDigits:Number(n)%1?2:0,maximumFractionDigits:2});
const place=(el,left,top,show=true)=>{el.style.left=left+'px';el.style.top=top+'px';el.classList.toggle('mana-hidden',!show);};

function apply(s) {
  settings={...DEFAULT_STUDIO,...s};
  Object.assign(sign.style,{left:settings.x+'px',top:settings.y+'px',width:settings.width+'px',height:settings.height+'px'});
  sign.classList.toggle('mana-hidden',!settings.visible);
  sign.style.setProperty('--mana-speed',settings.speed+'s'); text.textContent=settings.message;
  place(hud,40,settings.hudY,settings.showHud);
  boss.classList.toggle('mana-hidden',!settings.showBoss);
  // Big photo: over the bottom camera, full width.
  card.classList.toggle('big',!!settings.bigArt);
  if(settings.bigArt){place(card,40,settings.bigArtY);card.style.height=Math.max(420,Math.min(900,1900-settings.bigArtY))+'px';}
  else {place(card,settings.cardX,settings.cardY);card.style.height='';}
  // Next up beside the card, or above it when there's no room.
  const qx=settings.cardX+400<=760?settings.cardX+400:Math.max(0,settings.cardX), qy=settings.cardX+400<=760?settings.cardY+70:Math.max(0,settings.cardY-230);
  place(queue,qx,qy);
  // Bursts are centered on the sign.
  const cx=settings.x+settings.width/2, cy=settings.y+settings.height/2;
  Object.assign(effectEl.style,{left:Math.max(0,Math.min(1080-900,cx-450))+'px',top:Math.max(0,Math.min(1920-640,cy-320))+'px',width:'900px',height:'640px'});
  paintStage();paintStats(stats,false);
}
function paintStats(next,fromSale) {
  const before=shownGross;stats=next||stats;
  $('mana-gross').textContent=usd(stats.gross);$('mana-sold').textContent=String(stats.sold);$('mana-biggest').textContent=usd(stats.biggest);
  const b=stats.boss||{};
  $('mana-boss-name').textContent=b.name||settings.bossName;
  $('mana-boss-hp').textContent=b.defeated?'DEFEATED':'HP '+usd(b.hp);
  const fill=$('mana-boss-fill');fill.style.width=Math.max(0,Math.min(100,b.pct??100))+'%';fill.classList.toggle('low',(b.pct??100)<=25);
  boss.classList.toggle('defeated',!!b.defeated);
  if(fromSale && before!=null && stats.gross>before){
    for(const el of [$('mana-gross'),$('mana-sold')]){el.classList.remove('bump');void el.offsetWidth;el.classList.add('bump');}
    if(settings.showBoss){
      boss.classList.remove('hit');void boss.offsetWidth;boss.classList.add('hit');
      const dmg=document.createElement('b');dmg.textContent='-'+usd(stats.gross-before);$('mana-boss-hits').append(dmg);setTimeout(()=>dmg.remove(),1500);
    }
  }
  shownGross=stats.gross;
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
  const list=$('mana-queue-list');list.replaceChildren(...(stage.next||[]).map(n=>{const li=document.createElement('li');li.textContent=n.title+(n.price?' · '+usd(n.price):'');return li;}));
  queue.classList.toggle('mana-hidden',!settings.showQueue||settings.bigArt||!(stage.next||[]).length);
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
const SOUNDS={
  sold:()=>{tone(110,.18,0,'sawtooth',.8);tune([523,659,784,1047],.08);},
  jackpot:()=>tune([523,659,784,1047,0,784,1047,1319,1568],.1),
  boss:()=>{tone(80,.5,0,'sawtooth',1);tune([392,0,392,523,659,784,0,1047,1047,1319],.12);},
  coin:()=>tune([988,1319],.09),
  ready:()=>tune([523,523,784,1047],.13),
  gameover:()=>tune([784,659,523,392,330,262],.16),
  giveaway:()=>tune([659,784,988,1319,988,1319],.1),
  winner:()=>tune([784,988,1175,1568,0,1568],.11),
};
document.addEventListener('click',()=>{audio ||= new AudioContext();void audio.resume();});

// Coins scattered (a fixed spread -- the same every time).
function rain(n=24){coins.replaceChildren();for(let i=0;i<n;i++){const c=document.createElement('i');c.textContent='●';c.style.left=((i*37)%97)+'%';c.style.animationDelay=-((i*53)%23)/10+'s';c.style.animationDuration=(1.8+((i*29)%9)/10)+'s';coins.append(c);}}
function receiveEffect(e,initial=false) {
  if(!e || e.kind==='clear' || e.endsAt <= Date.now()+offset) {effect=null;coins.replaceChildren();return;}
  // Reconnect restores a running countdown without replaying a sale sound/celebration.
  if(initial && e.kind!=='countdown') return;
  if(played.has(e.id)) return;
  played.add(e.id);if(played.size>200) played.delete(played.values().next().value);
  effect=e;lastBeep=-1;coins.replaceChildren();
  if(['jackpot','boss'].includes(e.kind)) rain(e.kind==='boss'?36:24);
  if(!initial && e.kind!=='countdown') (SOUNDS[e.kind]||SOUNDS.coin)();
}
function words(e) {
  const thanks=e.buyer?'THANKS @'+e.buyer:'';
  const extras=[e.record?'NEW HI-SCORE!':'',settings.showCombo&&e.combo>=2?e.combo+'× COMBO!':'',thanks].filter(Boolean).join(' • ');
  switch(e.kind){
    case 'sold': return [e.word||'POW!',e.amount?usd(e.amount):'SOLD!',e.amount?['SOLD!',extras].filter(Boolean).join(' • '):extras];
    case 'jackpot': return ['BIG HIT!',e.amount?usd(e.amount):'',['SOLD!',extras].filter(Boolean).join(' • ')];
    case 'boss': return [(e.bossName||settings.bossName)+' DEFEATED!','K.O.!',e.reward||settings.bossReward];
    case 'giveaway': return ['FREE GIVEAWAY!','','FREE TO ENTER IN THE WHATNOT APP'];
    case 'winner': return ['WINNER!',e.buyer?'@'+e.buyer:'','GIVEAWAY WINNER — PICKED BY WHATNOT'];
    case 'gameover': return ['GAME OVER','','THANKS FOR PLAYING!'];
    default: return [EFFECT_LABELS[e.kind]||'','',''];
  }
}
let lastKind='';
function draw() {
  const now=Date.now()+offset;
  if(effect && effect.endsAt>now) {
    if(lastKind!==effect.id){effectEl.className='active k-'+effect.kind;lastKind=effect.id;
      if(effect.kind!=='countdown'){const [w,m,s]=words(effect);$('mana-effect-word').textContent=w;$('mana-effect-main').textContent=m;$('mana-effect-sub').textContent=s;}}
    if(effect.kind==='countdown') {
      const n=Math.max(0,Math.ceil((effect.endsAt-1200-now)/1000));$('mana-effect-word').textContent=n||'GO!';$('mana-effect-main').textContent=n?'LAST CALL!':'';$('mana-effect-sub').textContent='';
      if(n!==lastBeep){lastBeep=n;tone(n?440:880,n?.1:.3);}
    }
  } else if(effect||lastKind){effectEl.className='';effect=null;lastKind='';coins.replaceChildren();}
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
apply(settings);draw();connect();
// Local editor preview only; same-origin parent can show settings without network access.
if(preview) window.addEventListener('message',ev=>{if(ev.source!==parent || ev.origin!==location.origin)return;
  if(ev.data?.type==='mana-preview'){apply(ev.data.settings);if(ev.data.stage){stage=ev.data.stage;paintStage();}if(ev.data.stats)paintStats(ev.data.stats,!!ev.data.effect);if(ev.data.effect)receiveEffect(ev.data.effect);}});
