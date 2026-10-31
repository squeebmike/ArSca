(function(){
  'use strict';
  const host=document.getElementById('mana-live-studio');if(!host)return;
  host.className='mana-controls';
  host.innerHTML=`<h2>Mana Pocket • Live Studio</h2><p id="mana-status" role="status">Connect to load your live sign settings.</p><button id="mana-load">Connect / reload</button>
  <form id="mana-form"><label>Marquee message<textarea name="message" maxlength="300"></textarea></label><div class="mana-grid">
  ${[['x','Left',0,1080],['y','Top',0,1920],['width','Width',240,1080],['height','Height',70,300],['speed','Scroll cycle (seconds)',4,60],['countdownSeconds','Countdown (seconds)',3,15],['volume','Volume (%)',0,100],['jackpotAmount','Jackpot subtotal',1,1000000]].map(([name,label,min,max])=>`<label>${label}<input name="${name}" type="number" min="${min}" max="${max}" required></label>`).join('')}
  <label>Currency<input name="currency" maxlength="3" pattern="[A-Z]{3}" required></label><label>Whatnot seller ID<input name="sellerId" maxlength="120"></label><label>Whatnot show ID<input name="showId" maxlength="120"></label>
  <label><span><input name="visible" type="checkbox"> Show sign</span></label><label><span><input name="muted" type="checkbox"> Mute sound</span></label><label><span><input name="automatic" type="checkbox"> Automatic show / auction-order effects</span></label></div>
  <small>Automatic effects require the exact seller and show IDs and subscribed Whatnot webhooks. Individual bids and auction timers are not provided. Countdown is manually triggered. Effects stay inside the sign, leaving both cameras visible.</small><button type="submit">Save live settings</button></form>
  <div id="mana-effects">${[['coin','INSERT COIN'],['jackpot','JACKPOT'],['countdown','COUNTDOWN'],['sold','SOLD'],['ready','READY'],['gameover','GAME OVER'],['clear','CLEAR']].map(([k,l])=>`<button type="button" data-effect="${k}">${l}</button>`).join('')}</div>
  <div class="mana-preview"><iframe title="Sign preview over two camera placeholders" src="arcade-overlay.html#preview=1"></iframe></div><small>Preview is silent. Both camera areas are placeholders; camera sources stay in OBS.</small>
  <button id="mana-link">Create / replace OBS link</button><button id="mana-revoke">Revoke OBS link</button><label>Private OBS Browser Source URL<input id="mana-url" readonly></label><small>Link expires after 12 hours and only displays the sign. Replacing it disconnects old overlays. OBS: 1080 × 1920; add above both cameras, enable “Control audio via OBS”. If sound is blocked, use OBS Interact and click the overlay once.</small>`;
  const form=host.querySelector('form'),status=host.querySelector('#mana-status'),frame=host.querySelector('iframe');
  let revision=0,connectedStore='',settings=null;
  function store(){return typeof getActiveStoreId==='function'?getActiveStoreId():'';}
  async function api(path,body){
    if(typeof storeWorkerFetch!=='function')throw Error('Dashboard is still loading');
    const id=store();if(body && (!connectedStore || connectedStore!==id))throw Error('Store changed. Connect again before controlling the sign.');
    const res=await storeWorkerFetch('/live-studio/'+path+'?store_id='+encodeURIComponent(id),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
    const d=await res.json();if(!res.ok||!d.ok)throw Error(d.conflict?'Settings changed in another controller. Reload before saving.':d.error||'Live Studio unavailable');
    if(store()!==id)throw Error('Store changed. Connect again.');return d;
  }
  function paint(s){settings=s;for(const [k,v] of Object.entries(s)){const el=form.elements.namedItem(k);if(el)el.type==='checkbox'?el.checked=v:el.value=v;}preview();}
  function values(){const out={};for(const el of form.elements){if(!el.name)continue;out[el.name]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;}return out;}
  function preview(effect){frame.contentWindow?.postMessage({type:'mana-preview',settings:values(),effect},location.origin);}
  async function run(fn){try{await fn();}catch(e){status.textContent=e.message;}}
  host.querySelector('#mana-load').onclick=()=>run(async()=>{const d=await api('state');connectedStore=store();revision=d.revision;paint(d.settings);status.textContent='Connected. Controls are live.';});
  form.onsubmit=e=>{e.preventDefault();void run(async()=>{const d=await api('settings',{settings:values(),revision});revision=d.revision;paint(d.settings);status.textContent='Live settings saved.';});};
  form.oninput=()=>preview();
  host.querySelector('#mana-effects').onclick=e=>{const kind=e.target.dataset.effect;if(kind)void run(async()=>{const d=await api('effect',{kind});preview(d.effect);status.textContent='Sent '+e.target.textContent;});};
  host.querySelector('#mana-link').onclick=()=>run(async()=>{const d=await api('overlay-link',{});const u=new URL('arcade-overlay.html',location.href);u.hash=new URLSearchParams({worker:WORKER,store:connectedStore,token:d.token}).toString();host.querySelector('#mana-url').value=u.href;status.textContent='OBS link ready; expires '+new Date(d.expiresAt).toLocaleTimeString();});
  host.querySelector('#mana-revoke').onclick=()=>run(async()=>{await api('revoke',{});host.querySelector('#mana-url').value='';status.textContent='OBS links revoked.';});
  const resize=new ResizeObserver(()=>{frame.style.setProperty('--preview-scale',frame.parentElement.clientWidth/1080);});resize.observe(frame.parentElement);
  frame.onload=()=>{if(settings)preview();};
  import('./live-studio-model.mjs').then(m=>paint({...m.DEFAULT_STUDIO})).catch(()=>{});
})();
