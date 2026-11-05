(function(){
  'use strict';
  const host=document.getElementById('mana-live-studio');if(!host)return;
  host.className='mana-controls';
  // ByteRider_97's reactions and their keyboard shortcuts (store: "how to control him?").
  const MASCOT_KEYS=[['happy','HAPPY','1'],['smug','SMUG','2'],['wink','WINK','3'],['laughing','LAUGH','4'],['love','LOVE','5'],['surprised','SURPRISED','6'],['angry','ANGRY','7'],['dizzy','DIZZY','8'],['sad','SAD','9'],['thinking','THINK','0'],
    ['jackpot','JACKPOT','J'],['celebrating','CELEBRATE','C'],['alert','ALERT','A'],['glitch','GLITCH','G'],['countdown','COUNTDOWN','D'],['sleeping','SLEEP','Z'],['disappearing','REBOOT','R'],['excited','EXCITED','E'],['cool','COOL','O'],['shocked','SHOCKED','K'],['suspicious','SUSPICIOUS','U'],['error','ERROR','X'],['loading','LOADING','L'],['processing','PROCESSING','P'],['remind','RE:MIND','M'],['idle','IDLE','I'],['talking','TALK','T','HEY CHAT! WHAT ARE WE PULLING NEXT?'],['happy','NEW FOLLOWER','N','NEW FOLLOWER! WELCOME TO THE POCKET!']];
  // The original villains (scripts/live-studio-bosses.mjs).
  const BOSS_NAMES={scalper:'THE SCALPER',flipper:'THE FLIPPER',dinged:'THE DINGED CORNER',grader:'THE HARSH GRADER',shipping:'THE SHIPPING DELAY'};
  const num=(name,label,min,max,step)=>`<label>${label}<input name="${name}" type="number" min="${min}" max="${max}"${step?` step="${step}"`:''} required></label>`;
  const box=(name,label)=>`<label class="mana-check"><span><input name="${name}" type="checkbox"> ${label}</span></label>`;
  host.innerHTML=`<h2>Mana Pocket • Live Studio</h2><p id="mana-status" role="status">Connect to load your live sign settings.</p><button id="mana-load">Connect / reload</button>
  <form id="mana-form">
  <h3>Show</h3>
  <div class="mana-row"><button type="button" id="mana-show">USE LIVE / NEXT SHOW</button><span id="mana-show-name"></span></div>
  <div class="mana-grid"><label>Whatnot show ID<input name="showId" maxlength="120"></label><label>Whatnot seller ID (optional)<input name="sellerId" maxlength="120"></label></div>
  ${box('automatic','Automatic: every sale, giveaway, show start and end plays on stream')}
  <small>Whatnot doesn't share live bids. Each order comes through as it's made (auction, Buy It Now and giveaway), so the score board keeps the money total, items sold and biggest sale.</small>
  <div class="mana-row"><button type="button" id="mana-sync">SYNC TOTALS FROM WHATNOT</button><button type="button" id="mana-reset">RESET TOTALS</button></div>
  <p id="mana-score" class="mana-score">$0 · 0 sold</p>
  <h3>The Shed Dungeon</h3>
  <p id="mana-dungeon-status" class="mana-score">Floor 1</p>
  <div class="mana-row" id="mana-taps"><button type="button" data-tap="follow" data-key="F">+ FOLLOW <kbd>F</kbd></button><button type="button" data-tap="share" data-key="Y">+ SHARE <kbd>Y</kbd></button><button type="button" data-tap="bookmark" data-key="B">+ BOOKMARK <kbd>B</kbd></button></div>
  <div class="mana-row" id="mana-doors-pick"></div>
  <small>Whatnot doesn't send follows, shares or bookmarks -- tap them in as they pop up in the app. Sales fill the flask on their own.</small>
  <div class="mana-row"><input id="mana-add-mana" type="number" min="1" max="100000" placeholder="$ sale off Whatnot"><button type="button" id="mana-add-mana-go">+ MANA</button><input id="mana-set-floor" type="number" min="1" max="99" placeholder="Floor"><button type="button" id="mana-set-floor-go">SET FLOOR</button><button type="button" id="mana-reset-week">RESET WEEK</button></div>
  ${box('dungeonOn','Dungeon on: the sign is the mana flask (sales, follows, shares and bookmarks fill it)')}
  ${box('finale','FINALE tonight (the last show before Wednesday): bigger goals for every star this week')}
  <div class="mana-grid">${num('floorBase','Floor 1 goal ($)',1,1000000)}${num('floorGrowth','Each floor needs (+%)',0,500)}${num('bossShare','Floor boss HP (% of the floor goal)',1,500)}${num('manaFollow','Follow = mana',0,1000)}${num('manaShare','Share = mana',0,1000)}${num('manaBookmark','Bookmark = mana',0,1000)}${num('starsPerFloor','Stars per floor cleared',0,10)}${num('finaleBoost','Finale: +% goal per star',0,500)}</div>
  <label>Floor rewards (one per line, "3: Free giveaway in the Whatnot tool")<textarea name="floorRewards" maxlength="1200"></textarea></label>
  <label>Room rewards (when a floor has no reward of its own; rooms: vault, library, armory, forge, crypt, lab -- "vault: $1 start on a grail")<textarea name="roomRewards" maxlength="1200"></textarea></label>
  <div class="mana-grid">${box('showMap','Show the dungeon map + relic shelf')}${num('mapX','Map left',0,900)}${num('mapY','Map top',0,1700)}</div>
  <label>This show's unlocks (one per line, by the show's sales, "100: Shoutout to everyone in chat")<textarea name="showUnlocks" maxlength="1200"></textarea></label>
  <small class="mana-rules">Every unlock is a goal reached -- nothing is drawn or random. Fill the flask and the floor's boss comes out; sales and taps knock its HP down; beat it to unlock the next floor, its reward and a relic for the shelf. Then two doors open: chat votes in the Whatnot chat (type 1 or 2) and you tap the winner here. No pick by the time the next flask fills means door 1. Progress carries over all week and starts fresh every Wednesday (new comic book day). Rewards are for everyone watching, never a buyers-only prize.</small>
  <h3>Boss battle</h3>
  <div class="mana-grid"><label>Boss<select name="bossCharacter">${Object.entries(BOSS_NAMES).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label><label>Boss name<input name="bossName" maxlength="40"></label>${num('bossGoal','Boss HP (show sales goal, $)',1,10000000)}</div>
  <label>Reward when the boss goes down<input name="bossReward" maxlength="120"></label>
  <small class="mana-rules">Whatnot rules: make the reward something for <b>everyone watching</b> -- a $1 start on a grail, a box opened on stream, or a free giveaway in Whatnot's giveaway tool (free to enter). Not a prize only buyers can win, and nothing tied to how much someone spends. No wheels, spins, raffles or random pulls -- the overlay won't save words for those.</small>
  ${box('showBoss','Show the boss bar')}
  <h3>Now playing</h3>
  <div class="mana-row"><input id="mana-find" placeholder="Find an item in inventory…" autocomplete="off"></div>
  <div id="mana-found" class="mana-found"></div>
  <div id="mana-stage" class="mana-stage"></div>
  <div class="mana-row"><button type="button" id="mana-next">NEXT ITEM ▶</button><button type="button" id="mana-stage-clear">CLEAR NOW PLAYING</button></div>
  ${box('autoAdvance','When an auction sells, move to the next item lined up')}
  ${box('bigArt','BIG PHOTO: fill the bottom camera with the item\'s photo')}
  <div class="mana-grid">${num('bigArtY','Big photo top',0,1400)}</div>
  <small class="mana-rules">Whatnot can't start auctions from outside its app -- run each auction there; the overlay follows along. With BIG PHOTO, still hold the real book up before the timer starts: the stream is the record if a buyer says it wasn't as shown. Use your own photo of the actual copy, not a catalog cover, for anything where condition matters.</small>
  <h3>Quick</h3>
  <div class="mana-row" id="mana-quick"><button type="button" data-toggle="visible" data-key="H">SIGN ON/OFF <kbd>H</kbd></button><button type="button" data-toggle="marqueeOn" data-key="Q">MARQUEE TEXT ON/OFF <kbd>Q</kbd></button><button type="button" data-toggle="finale" data-key="V">FINALE ON/OFF <kbd>V</kbd></button></div>
  <h3>Effects</h3>
  <div id="mana-effects">${[['coin','INSERT COIN'],['countdown','COUNTDOWN'],['sold','SOLD'],['jackpot','BIG HIT'],['boss','BOSS DEFEATED'],['giveaway','FREE GIVEAWAY'],['ready','READY'],['gameover','GAME OVER'],['clear','CLEAR']].map(([k,l])=>`<button type="button" data-effect="${k}">${l}</button>`).join('')}</div>
  <small>FREE GIVEAWAY only shows the banner -- run the giveaway itself in Whatnot's giveaway tool. Its winner shows automatically.</small>
  <h3>ByteRider_97</h3>
  <div class="mana-grid">${box('mascotOn','Show ByteRider_97')}${box('mascotSounds','ByteRider sounds')}${box('showHype','Hype meter')}${box('mascotSaysMarquee','ByteRider says the marquee lines')}${num('mascotSayEvery','…one every (seconds)',10,600)}${box('mascotBorder','His bezel round the screen')}${box('mascotIdleFace','Keep a faint face up between reactions')}${num('mascotScale','Face size (%)',40,150)}${num('mascotFaceY','Face height on screen',250,1650)}</div>
  <small>The phone screen is his monitor: his face pops onto it when he reacts, then clears so the cameras show. He reacts on his own to sales, big hits, the boss K.O., countdowns, giveaways and winners, the show starting and ending, and each new item up. Whatnot doesn't send follows or auction starts, so those are buttons here. He naps after 5 quiet minutes.</small>
  <div id="mana-mascot">${MASCOT_KEYS.map(([k,l,key,say])=>`<button type="button" data-mascot="${k}"${say?` data-say="${say}"`:''} data-key="${key}">${l} <kbd>${key}</kbd></button>`).join('')}</div>
  <label class="mana-check"><span><input type="checkbox" id="mana-dash-br"> Show ByteRider in the dashboard corner (this device)</span></label>
  <label class="mana-check"><span><input type="checkbox" id="mana-keys"> Keyboard shortcuts (the letters/numbers on the buttons; only on the Whatnot tab, never while typing in a box)</span></label>
  <div class="mana-row"><input id="mana-say" maxlength="120" placeholder="Make him say something (a promo, a shout-out)…"><button type="button" id="mana-say-go">SAY IT</button></div>
  <div class="mana-row"><button type="button" id="mana-pin">📌 PIN PREVIEW</button><small id="mana-br-status" role="status">Tap a reaction: he plays it in the preview (and on stream once connected).</small></div>
  <h3>Sign &amp; layout</h3>
  <label>Marquee message (separate lines with • or | -- ByteRider says them one at a time)<textarea name="message" maxlength="300"></textarea></label>
  <div class="mana-grid">
  ${num('x','Sign left',0,1080)}${num('y','Sign top',0,1920)}${num('width','Sign width',240,1080)}${num('height','Sign height',70,300)}
  ${num('speed','Scroll cycle (seconds)',4,60)}${num('hudY','Score board top',0,1700)}${num('cardX','Card left',0,700)}${num('cardY','Card top',0,1560)}
  ${num('countdownSeconds','Countdown (seconds)',3,15)}${num('volume','Volume (%)',0,100)}${num('jackpotAmount','BIG HIT at ($)',1,1000000)}
  <label>Currency<input name="currency" maxlength="3" pattern="[A-Z]{3}" required></label></div>
  <div class="mana-grid">${box('visible','Show sign')}${box('marqueeOn','Scrolling marquee on the sign')}${box('showHud','Show score board')}${box('showCard','Show now playing')}${box('showQueue','Show next up')}${box('showCombo','Show combos')}${box('attract','INSERT COIN when nothing is playing')}${box('muted','Mute sound')}${box('showBuyerNames','Show buyer usernames ("THANKS @name")')}</div>
  <small>Buyer usernames are off unless you turn them on. Whatnot shows the winner's username in the app already; check Whatnot's seller rules before showing them. Only the username is ever shown, and there's no "top spender" board.</small>
  <button type="submit">Save live settings</button></form>
  <div class="mana-preview"><iframe title="Overlay preview over two camera placeholders" src="arcade-overlay.html#preview=1"></iframe></div>
  <div class="mana-row"><button type="button" id="mana-demo">DEMO A SALE (preview only)</button></div><small>Preview is silent. Both camera areas are placeholders; camera sources stay in OBS.</small>
  <button id="mana-link">Create / replace OBS link</button><button id="mana-revoke">Revoke OBS link</button><label>Private OBS Browser Source URL<input id="mana-url" readonly></label><small>Link expires after 12 hours. Replacing it disconnects old overlays. OBS: Browser Source 1080 × 1920 above both cameras, enable “Control audio via OBS”. If sound is blocked, use OBS Interact and click the overlay once.</small>`;
  const form=host.querySelector('form'),status=host.querySelector('#mana-status'),frame=host.querySelector('iframe');
  let revision=0,connectedStore='',settings=null,stats=null,stage={now:null,next:[]};
  function store(){return typeof getActiveStoreId==='function'?getActiveStoreId():'';}
  async function api(path,body){
    if(typeof storeWorkerFetch!=='function')throw Error('Dashboard is still loading');
    const id=store();if(body && (!connectedStore || connectedStore!==id))throw Error('Store changed. Connect again before controlling the sign.');
    const res=await storeWorkerFetch('/live-studio/'+path+'?store_id='+encodeURIComponent(id),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
    const d=await res.json();if(!res.ok||!d.ok)throw Error(d.conflict?'Settings changed in another controller. Reload before saving.':d.error||'Live Studio unavailable');
    if(store()!==id)throw Error('Store changed. Connect again.');return d;
  }
  const usd=n=>'$'+(Math.round((Number(n)||0)*100)/100).toLocaleString('en-US',{maximumFractionDigits:2});
  function paint(s){settings=s;for(const [k,v] of Object.entries(s)){const el=form.elements.namedItem(k);if(el)el.type==='checkbox'?el.checked=v:el.value=v;}preview();}
  function took(d){if(d.settings)paint(d.settings);if(d.stats){stats=d.stats;host.querySelector('#mana-score').textContent=usd(stats.gross)+' · '+stats.sold+' sold · biggest '+usd(stats.biggest)+(stats.boss&&!stats.dungeon?.on?' · boss '+(stats.boss.defeated?'DEFEATED':'HP '+usd(stats.boss.hp)):'');paintDungeon();}if(d.stage){stage=d.stage;paintStage();}preview();}
  // The dungeon's status line: floor, mana, stars, the week's reset.
  function paintDungeon(){
    const d=stats?.dungeon,el=host.querySelector('#mana-dungeon-status'),pick=host.querySelector('#mana-doors-pick');pick.replaceChildren();
    if(!d){el.textContent='Connect to see the floor.';return;}
    // Chat's vote: one button per door.
    if(d.doors)d.doors.forEach((r,i)=>{const b=document.createElement('button');b.type='button';b.textContent='DOOR '+(i+1)+': '+r.icon+' '+r.name;
      b.onclick=()=>run(async()=>{const x=await api('dungeon-adjust',{door:i});took(x);if(x.effect)preview(x.effect);status.textContent='Chat picked '+r.name+'.';});pick.append(b);});
    el.textContent=(d.on?'':'(off) ')+'Floor '+d.floor+' · '+d.shed+(d.room?' · '+d.room.name:'')+' · '+(d.phase==='boss'?d.boss.name+' HP '+usd(d.boss.hp)+' / '+usd(d.boss.max):usd(d.mana)+' / '+usd(d.goal)+' mana')+' · ★ '+d.stars+' · relics '+(d.relics?.length||0)+(d.doors?' · DOOR VOTE OPEN':'')+(d.finale?' · FINALE':'')+' · resets Wed '+d.resets+(d.lastWeek?' · last week: floor '+d.lastWeek.floor+', ★ '+d.lastWeek.stars:'');
  }
  function values(){const out={};for(const el of form.elements){if(!el.name)continue;out[el.name]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;}return out;}
  function preview(effect,demoStats){frame.contentWindow?.postMessage({type:'mana-preview',settings:values(),stage,stats:demoStats||stats||undefined,effect},location.origin);}
  async function run(fn){try{await fn();}catch(e){status.textContent=e.message;}}
  host.querySelector('#mana-load').onclick=()=>run(async()=>{const d=await api('state');connectedStore=store();revision=d.revision;took(d);status.textContent='Connected. Controls are live.';});
  // Quick switches (store: "I might not want the marquee sign to show
  // sometimes"): flip the setting and save it live in one tap.
  host.querySelector('#mana-quick').onclick=e=>{const b=e.target.closest('[data-toggle]');if(!b)return;
    const box=form.elements.namedItem(b.dataset.toggle);box.checked=!box.checked;
    void run(async()=>{try{const d=await api('settings',{settings:values(),revision});revision=d.revision;took(d);status.textContent=({visible:'Sign ',marqueeOn:'Marquee text ',finale:'Finale '}[b.dataset.toggle]||'')+(box.checked?'on':'off');}catch(err){box.checked=!box.checked;throw err;}});};
  form.onsubmit=e=>{e.preventDefault();void run(async()=>{const d=await api('settings',{settings:values(),revision});revision=d.revision;took(d);status.textContent='Live settings saved.';});};
  form.oninput=e=>{
    // Picking a boss gives it its name, unless the store typed its own.
    if(e.target.name==='bossCharacter'){const nm=form.elements.namedItem('bossName');if(!nm.value||Object.values(BOSS_NAMES).includes(nm.value))nm.value=BOSS_NAMES[e.target.value]||nm.value;}
    preview();};
  // Dungeon taps and fixes.
  host.querySelector('#mana-taps').onclick=e=>{const b=e.target.closest('[data-tap]');if(!b)return;const kind=b.dataset.tap;
    if(!connectedStore){const now=Date.now(),v=values();preview({id:'local-'+now,kind:'tap',tapKind:kind,mana:v[{follow:'manaFollow',share:'manaShare',bookmark:'manaBookmark'}[kind]]||0,startsAt:now,endsAt:now+2500});status.textContent='Preview only. Tap Connect / reload to fill the real flask.';return;}
    void run(async()=>{const d=await api('dungeon-tap',{kind});took(d);preview(d.effect);status.textContent='+ '+kind;});};
  host.querySelector('#mana-add-mana-go').onclick=()=>run(async()=>{const v=Number(host.querySelector('#mana-add-mana').value);if(!(v>0))throw Error('Type the $ amount first');const d=await api('dungeon-adjust',{mana:v});took(d);if(d.effect)preview(d.effect);host.querySelector('#mana-add-mana').value='';status.textContent='Added '+usd(v)+' mana.';});
  host.querySelector('#mana-set-floor-go').onclick=()=>run(async()=>{const f=Number(host.querySelector('#mana-set-floor').value);if(!Number.isInteger(f)||f<1)throw Error('Type a floor number');if(!confirm('Jump to floor '+f+'? Its mana starts at 0.'))return;const d=await api('dungeon-adjust',{floor:f});took(d);status.textContent='Now on floor '+f+'.';});
  host.querySelector('#mana-reset-week').onclick=()=>run(async()=>{if(!confirm('Start the week over at floor 1 with no stars?'))return;const d=await api('dungeon-adjust',{resetWeek:true});took(d);status.textContent='Week reset: floor 1.';});
  host.querySelector('#mana-effects').onclick=e=>{const kind=e.target.dataset.effect;if(kind)void run(async()=>{const d=await api('effect',{kind});preview(d.effect);status.textContent='Sent '+e.target.textContent;});};
  // ByteRider_97: a reaction or a line, on stream (and in the preview).
  // Store, 2026-11-02 (on a phone): "I didn't see it animate in the preview."
  // Before Connect he still plays in the preview, and says so here, right
  // under the buttons (the main status line is far up the page).
  const brStatus=host.querySelector('#mana-br-status');
  const mascotSend=(state,text)=>{
    if(!connectedStore){const now=Date.now();preview({id:'local-'+now+'-'+Math.random().toString(36).slice(2),kind:'mascot',mascotState:state,...(text?{say:text.slice(0,120)}:{}),startsAt:now,endsAt:now+4000});
      brStatus.textContent='Preview only ('+(text||state)+'). Tap Connect / reload at the top to send him to the stream.';return;}
    return run(async()=>{try{const d=await api('effect',{kind:'mascot',state,text});preview(d.effect);status.textContent=brStatus.textContent='ByteRider: '+(text||state)+' (live)';}catch(e){brStatus.textContent=e.message;throw e;}});
  };
  // PIN PREVIEW: docks the preview in the corner so you can tap and watch
  // at the same time on a phone.
  const pin=host.querySelector('#mana-pin'),previewBox=host.querySelector('.mana-preview');
  pin.onclick=()=>{const on=previewBox.classList.toggle('pinned');pin.textContent=on?'📌 UNPIN PREVIEW':'📌 PIN PREVIEW';};
  host.querySelector('#mana-mascot').onclick=e=>{const b=e.target.closest('[data-mascot]');if(b)mascotSend(b.dataset.mascot,b.dataset.say||'');};
  host.querySelector('#mana-say-go').onclick=()=>{const t=host.querySelector('#mana-say').value.trim();if(t)mascotSend('talking',t);};
  // Keyboard shortcuts (this device only): a key fires the button that shows it;
  // S jumps to the SAY box. Never while typing in a box.
  const dashBr=host.querySelector('#mana-dash-br');
  try{dashBr.checked=localStorage.getItem('byterider-dash-hidden')!=='1';}catch{}
  dashBr.onchange=()=>{if(typeof showDashByteRider==='function')showDashByteRider(dashBr.checked);};
  const keys=host.querySelector('#mana-keys');
  try{keys.checked=localStorage.getItem('mana-keys')==='1';}catch{}
  keys.onchange=()=>{try{localStorage.setItem('mana-keys',keys.checked?'1':'0');}catch{}};
  document.addEventListener('keydown',e=>{
    // Only on the Whatnot tab (store: "only on Whatnot tab").
    if(typeof activeTab!=='undefined'&&activeTab!=='whatnot')return;
    if(!keys.checked||e.ctrlKey||e.metaKey||e.altKey||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName||'')||e.target?.isContentEditable)return;
    const k=e.key.length===1?e.key.toUpperCase():'';
    if(k==='S'){e.preventDefault();host.querySelector('#mana-say').focus();return;}
    const b=host.querySelector(`#mana-mascot [data-key="${k}"],#mana-quick [data-key="${k}"],#mana-taps [data-key="${k}"]`);
    if(b){e.preventDefault();b.click();}
  });
  host.querySelector('#mana-show').onclick=()=>run(async()=>{const d=await api('current-show');if(!d.show)throw Error('No live or scheduled Whatnot show found');form.elements.namedItem('showId').value=d.show.id;host.querySelector('#mana-show-name').textContent=(d.show.live?'LIVE: ':'NEXT: ')+(d.show.title||d.show.id);preview();status.textContent='Show picked -- tap Save live settings.';});
  host.querySelector('#mana-sync').onclick=()=>run(async()=>{const d=await api('stats-sync',{});took(d);status.textContent='Totals synced from Whatnot.';});
  host.querySelector('#mana-reset').onclick=()=>run(async()=>{if(!confirm('Reset the score board and boss to zero?'))return;const d=await api('stats-reset',{});took(d);status.textContent='Totals reset.';});

  // Now playing: picked from the dashboard's inventory.
  function inventory(){try{return typeof all!=='undefined'&&Array.isArray(all)?all:[];}catch{return [];}}
  const https=u=>/^https:\/\//.test(String(u||''))?String(u):'';
  function stageItem(i){
    const price=Number(i.market||i.marketPrice||i.salePrice||0)||0;
    const detail=[i.set,i.variant,i.grader&&i.grade?i.grader+' '+i.grade:'',i.condition].filter(Boolean).join(' · ');
    return {title:String(i.name||'').slice(0,90),detail:detail.slice(0,90),image:https(i.thumbnail)||https(i.imageUrl)||https(i.photoDataUrl),price};
  }
  function paintStage(){
    const el=host.querySelector('#mana-stage');el.replaceChildren();
    const row=(label,item,idx)=>{const d=document.createElement('div');d.className='mana-stage-row';const b=document.createElement('b');b.textContent=label;const t=document.createElement('span');t.textContent=item.title+(item.price?' · '+usd(item.price):'');d.append(b,t);
      if(idx!=null){const x=document.createElement('button');x.type='button';x.textContent='✕';x.onclick=()=>run(()=>saveStage({now:stage.now,next:stage.next.filter((_,j)=>j!==idx)}));d.append(x);}return d;};
    if(stage.now)el.append(row('NOW',stage.now));
    (stage.next||[]).forEach((n,i)=>el.append(row('NEXT '+(i+1),n,i)));
  }
  async function saveStage(next){const d=await api('stage',{stage:next});took(d);status.textContent=next.now?'Now playing: '+next.now.title:'Now playing cleared.';}
  const find=host.querySelector('#mana-find'),found=host.querySelector('#mana-found');
  find.oninput=()=>{
    const q=find.value.trim().toLowerCase();found.replaceChildren();if(q.length<2)return;
    const hits=inventory().filter(i=>i.status==='in_stock'&&String(i.name||'').toLowerCase().includes(q)).slice(0,8);
    for(const i of hits){const item=stageItem(i),d=document.createElement('div');d.className='mana-found-row';const t=document.createElement('span');t.textContent=item.title+(item.price?' · '+usd(item.price):'');
      const now=document.createElement('button');now.type='button';now.textContent='NOW';now.onclick=()=>run(()=>saveStage({now:item,next:stage.next||[]}));
      const nx=document.createElement('button');nx.type='button';nx.textContent='+ NEXT';nx.onclick=()=>run(()=>saveStage({now:stage.now,next:[...(stage.next||[]),item].slice(0,60)}));
      t.title='Tap to play it now';t.onclick=now.onclick;d.append(t,now,nx);found.append(d);}
    if(!hits.length){const d=document.createElement('div');d.className='mana-found-row';d.textContent='No in-stock item matches';found.append(d);}
  };
  host.querySelector('#mana-next').onclick=()=>run(()=>{const [n,...rest]=stage.next||[];if(!n)throw Error('Nothing in next up');return saveStage({now:n,next:rest});});
  host.querySelector('#mana-stage-clear').onclick=()=>run(()=>saveStage({now:null,next:stage.next||[]}));

  // A pretend sale in the preview only -- nothing is sent.
  let demo=0,demoGross=0,demoBig=0,demoDungeon=null,dungeonLib=null;
  import('./live-studio-dungeon.mjs').then(m=>{dungeonLib=m;}).catch(()=>{});
  host.querySelector('#mana-demo').onclick=()=>{const v=values(),amount=[12,45,8,150,25][demo%5];demo++;
    if(demo===1){demoGross=stats?.gross||0;demoBig=stats?.biggest||0;}
    const wasAlive=demoGross<v.bossGoal;demoGross+=amount;demoBig=Math.max(demoBig,amount);const hp=Math.max(0,v.bossGoal-demoGross);
    const fake={gross:demoGross,sold:(stats?.sold||0)+demo,biggest:demoBig,combo:demo,lastSaleAt:Date.now(),giveaways:0,boss:{name:v.bossName,goal:v.bossGoal,hp,pct:hp/v.bossGoal*100,defeated:hp<=0,reward:v.bossReward}};
    let kind=!v.dungeonOn&&wasAlive&&hp<=0&&v.showBoss?'boss':amount>=v.jackpotAmount?'jackpot':'sold',extra={};
    // The dungeon moves too (preview only).
    if(dungeonLib){
      if(demo===1){const p=stats?.dungeon;demoDungeon=p?{week:p.week,floor:p.floor,phase:p.phase,mana:p.mana,bossHp:p.phase==='boss'?p.boss.hp:0,stars:p.stars,cleared:[],taps:{}}:null;}
      const r=dungeonLib.addMana(demoDungeon,amount,v);demoDungeon=r.dungeon;fake.dungeon=dungeonLib.publicDungeon(demoDungeon,v,demoGross);
      const boss=r.events.filter(x=>x.kind==='boss').pop(),fl=r.events.filter(x=>x.kind==='floor').pop(),un=v.dungeonOn?dungeonLib.showUnlocksCrossed(demoGross-amount,demoGross,v).pop():null;
      if(boss){kind='boss';extra={dungeon:true,...boss};}else if(fl){kind='floor';extra=fl;}else if(un){kind='unlock';extra={unlockText:un.text,unlockAt:un.n};}
    }
    preview({id:'demo-'+Date.now(),kind,startsAt:Date.now(),endsAt:Date.now()+5000,amount,word:['POW!','BAM!','KRAK!','ZAP!','KA-CHING!'][demo%5],combo:demo,reward:v.bossReward,bossName:v.bossName,buyer:v.showBuyerNames?'collector42':'',...extra},fake);};

  host.querySelector('#mana-link').onclick=()=>run(async()=>{const d=await api('overlay-link',{});const u=new URL('arcade-overlay.html',location.href);u.hash=new URLSearchParams({worker:WORKER,store:connectedStore,token:d.token}).toString();host.querySelector('#mana-url').value=u.href;status.textContent='OBS link ready; expires '+new Date(d.expiresAt).toLocaleTimeString();});
  host.querySelector('#mana-revoke').onclick=()=>run(async()=>{await api('revoke',{});host.querySelector('#mana-url').value='';status.textContent='OBS links revoked.';});
  const resize=new ResizeObserver(()=>{frame.style.setProperty('--preview-scale',frame.parentElement.clientWidth/1080);});resize.observe(frame.parentElement);
  frame.onload=()=>{if(settings)preview();};
  import('./live-studio-model.mjs').then(m=>paint({...m.DEFAULT_STUDIO})).catch(()=>{});
})();
