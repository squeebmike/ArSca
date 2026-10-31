import {DEFAULT_STUDIO} from './live-studio-model.mjs';
const sign=document.getElementById('mana-sign'), text=document.getElementById('mana-message'), effectEl=document.getElementById('mana-effect'), coins=document.getElementById('mana-coins');
let settings={...DEFAULT_STUDIO}, socket, retry=0, effect=null, offset=0, audio, lastBeep=-1, played=new Set();
const params=new URLSearchParams(location.hash.slice(1));
const token=params.get('token'), store=params.get('store'), endpoint=params.get('worker');
const preview=params.get('preview')==='1';
// The fragment is never sent as a request URL or Referer. OBS retains its source URL for reloads.
function apply(s) {
  settings=s;
  Object.assign(sign.style,{left:s.x+'px',top:s.y+'px',width:s.width+'px',height:s.height+'px',display:s.visible?'block':'none'});
  sign.style.setProperty('--mana-speed',s.speed+'s'); text.textContent=s.message;
}
for(let i=0;i<12;i++) {const b=document.createElement('i');b.style.left=(i*8)+'%';b.style.animationDelay=-(i%5)+'s';document.querySelector('.mana-bubbles').append(b);}
function tone(freq,duration=.12) {
  if(settings.muted || preview) return;
  try {
    audio ||= new AudioContext();
    if(audio.state==='suspended') {void audio.resume().catch(()=>{});return;}
    const o=audio.createOscillator(),g=audio.createGain(); o.type='square';o.frequency.value=freq;
    g.gain.setValueAtTime(settings.volume/100*.12,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
    o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+duration);
  } catch {}
}
document.addEventListener('click',()=>{audio ||= new AudioContext();void audio.resume();});
function receiveEffect(e,initial=false) {
  if(!e || e.kind==='clear' || e.endsAt <= Date.now()+offset) {effect=null;coins.replaceChildren();return;}
  // Reconnect restores a running countdown without replaying a sale sound/celebration.
  if(initial && e.kind!=='countdown') return;
  if(played.has(e.id)) return;
  played.add(e.id);if(played.size>200) played.delete(played.values().next().value);
  effect=e;lastBeep=-1;coins.replaceChildren();
  if(e.kind==='jackpot') for(let i=0;i<24;i++){const c=document.createElement('i');c.textContent='●';c.style.left=(i*4.3)+'%';c.style.animationDelay=-(i%6)*.2+'s';coins.append(c);}
  if(!initial && e.kind!=='countdown') {tone(e.kind==='coin'?988:523,.22);setTimeout(()=>tone(784,.22),180);setTimeout(()=>tone(1047,.3),360);}
}
function draw() {
  const now=Date.now()+offset;
  if(effect && effect.endsAt>now) {
    effectEl.className='active';
    if(effect.kind==='countdown') {
      const n=Math.max(0,Math.ceil((effect.endsAt-1200-now)/1000)); effectEl.textContent=n||'GO!';
      if(n!==lastBeep){lastBeep=n;tone(n?440:880,n?.1:.3);}
    } else effectEl.textContent=({coin:'INSERT COIN',jackpot:'JACKPOT!',sold:'SOLD!',ready:'PLAYER 1 READY',gameover:'GAME OVER'})[effect.kind]||'';
  } else {effectEl.className='';effect=null;coins.replaceChildren();}
  requestAnimationFrame(draw);
}
function connect() {
  if(!endpoint || !store || !token) return;
  let url;try {url=new URL(endpoint);if(url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))return;}catch{return;}
  url.protocol=url.protocol==='https:'?'wss:':'ws:';url.pathname='/live-studio/socket';url.search='?store_id='+encodeURIComponent(store);url.hash='';
  socket=new WebSocket(url);
  socket.onopen=()=>socket.send(JSON.stringify({token}));
  socket.onmessage=ev=>{try {const m=JSON.parse(ev.data);offset=m.serverNow-Date.now();retry=0;if(m.settings)apply(m.settings);if(m.type==='effect'||m.type==='snapshot')receiveEffect(m.effect,m.type==='snapshot');}catch{}};
  socket.onclose=ev=>{if(ev.code===1008)return;setTimeout(connect,Math.min(30000,1000*2**Math.min(retry++,5)));};
}
apply(settings);draw();connect();
// Local editor preview only; same-origin parent can show settings without network access.
if(preview) window.addEventListener('message',ev=>{if(ev.source!==parent || ev.origin!==location.origin)return;if(ev.data?.type==='mana-preview'){apply(ev.data.settings);if(ev.data.effect)receiveEffect(ev.data.effect);}});
