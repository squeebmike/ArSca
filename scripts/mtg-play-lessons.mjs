export const playLessons=[
 {id:'first-turn',title:'1 · Lands, mana and your first attacker',goal:'Play a land, cast Grizzly Bears, then attack on your next turn.',refs:'106, 117, 302.6, 305, 508, 608'},
 {id:'blocking',title:'2 · Block to survive',goal:'You have 2 life. Block an attacking 2/2 without tapping your blocker.',refs:'509, 510, 704.5a, 704.5g'},
 {id:'response',title:'3 · Save your creature with a response',goal:'Use Giant Growth before Lightning Bolt resolves, then finish the turn.',refs:'117, 405, 608, 514.2, 704.5g'}
];

// Literal browser engine: tested with the same source in Node; never evaluated
// inside the Worker. This avoids bundler helpers leaking into served scripts.
export const playEngineSource=String.raw`
 const cardData={Forest:{type:'Basic Land — Forest',cost:'',text:'Tap: Add one green mana.'},'Grizzly Bears':{type:'Creature — Bear',cost:'{1}{G}',power:2,toughness:2,text:'A 2/2 creature.'},'Silvercoat Lion':{type:'Creature — Cat',cost:'{1}{W}',power:2,toughness:2,text:'A 2/2 creature.'},'Giant Growth':{type:'Instant',cost:'{G}',text:'Target creature gets +3/+3 until end of turn.'},'Lightning Bolt':{type:'Instant',cost:'{R}',text:'Deals 3 damage to any target.'}};
 function makeCard(name,id,extra={}){return {name,id,...cardData[name],tapped:false,damage:0,...extra};}
 function createPlayState(lesson){
  if(!['first-turn','blocking','response'].includes(lesson))throw new Error('Unknown play lesson');
  const s={lesson,stage:'main',turn:1,phase:'Your precombat main phase',mana:0,yourLife:20,opponentLife:20,hand:[],yours:[],theirs:[],stack:[],yourGraveyard:[],theirGraveyard:[],landPlayed:false,complete:false,failed:false,feedback:'',log:[]};
  if(lesson==='first-turn'){s.hand=[makeCard('Forest','forest-b'),makeCard('Grizzly Bears','bears')];s.yours=[makeCard('Forest','forest-a')];s.feedback='You already control one Forest. Start by playing the Forest in your hand. You can also explore what happens if you try casting without enough mana.';}
  if(lesson==='blocking'){s.stage='block';s.phase='Opponent’s declare blockers step';s.yourLife=2;s.yours=[makeCard('Silvercoat Lion','lion')];s.theirs=[makeCard('Grizzly Bears','enemy-bears',{tapped:true,attacking:true})];s.feedback='The opponent has declared Grizzly Bears attacking you. Choose whether your untapped Silvercoat Lion blocks. No other effects or responses apply.';}
  if(lesson==='response'){s.stage='respond';s.phase='Opponent’s main phase · you have priority';s.yours=[makeCard('Forest','forest-a'),makeCard('Grizzly Bears','bears')];s.hand=[makeCard('Giant Growth','growth')];s.stack=[{name:'Lightning Bolt',controller:'Opponent',target:'your Grizzly Bears'}];s.feedback='Lightning Bolt targets your 2/2 Grizzly Bears. You have priority. Tap Forest to make green mana, then choose Giant Growth and its target.';}
  return s;
 }
 function playAction(state,action){
  const s=JSON.parse(JSON.stringify(state));
  function say(text){s.feedback=text;return s;}
  function record(text){s.log.push(text);s.feedback=text;return s;}
  if(s.complete||s.failed)return say('This scenario has finished. Restart it or choose another lesson.');
  if(action.startsWith('tap:')){
   const land=s.yours.find(c=>c.id===action.slice(4)&&c.name==='Forest');
   if(!land)return say('Choose one of your Forests to make green mana.');
   if(land.tapped)return say('That Forest is already tapped. It cannot pay its tap cost again until it untaps.');
   if(!['main','next-main','respond'].includes(s.stage))return say('Follow the current step first. This guided scenario is waiting for the highlighted action.');
   land.tapped=true;s.mana++;return record('You tap Forest: add one green mana. Mana pool: '+s.mana+' green. Mana abilities do not use the stack.');
  }
  if(s.lesson==='first-turn'){
   if(action==='play-forest'){
    if(!['main','next-main'].includes(s.stage)||s.stack.length)return say('Play a land during your main phase with priority and an empty stack.');
    if(s.landPlayed)return say('You have already played a land this turn. This scenario has no effect granting another land play.');
    const i=s.hand.findIndex(c=>c.name==='Forest');if(i<0)return say('There is no Forest in your hand.');
    s.yours.push(s.hand.splice(i,1)[0]);s.landPlayed=true;return record('Forest enters the battlefield untapped. Playing a land does not use the stack. You may tap this new land for mana right away.');
   }
   if(action==='cast-bears'){
    if(s.stage!=='main')return say('There is no Grizzly Bears spell to cast from your hand at this step.');
    if(s.mana<2)return say('Grizzly Bears costs {1}{G}. You need two mana total, at least one green. Tap two different Forests; green mana can also pay the generic {1}.');
    s.mana-=2;s.hand=s.hand.filter(c=>c.id!=='bears');s.stack.push({name:'Grizzly Bears',controller:'You',target:''});s.stage='bear-spell';return record('You pay {1}{G} using two green mana. Grizzly Bears is a spell on the stack, not a creature on the battlefield yet. Pass priority; the scripted opponent will also pass.');
   }
   if(action==='pass'&&s.stage==='bear-spell'){
    s.stack=[];s.yours.push(makeCard('Grizzly Bears','bears',{sick:true}));s.stage='new-creature';return record('Both players pass. Grizzly Bears resolves and enters the battlefield. You have not controlled it since your turn began, so it cannot attack this turn without haste.');
   }
   if(action==='next-turn'&&s.stage==='new-creature'){
    s.turn++;s.mana=0;s.yours.forEach(c=>{c.tapped=false;c.sick=false;});s.landPlayed=false;s.hand.push(makeCard('Forest','forest-c'));s.stage='next-main';s.phase='Your next turn · precombat main phase';return record('A full turn cycle passes. The opponent takes no relevant actions. On your next turn you untap your permanents, finish upkeep and draw a Forest. Grizzly Bears is now ready to attack.');
   }
   if(action==='combat'&&s.stage==='next-main'){s.mana=0;s.stage='attack';s.phase='Your declare attackers step';return record('You move through beginning of combat with no actions. Any unspent mana emptied as the main phase ended. Choose Grizzly Bears as an attacker.');}
   if(action==='attack-bears'){
    const c=s.yours.find(c=>c.id==='bears');if(!c)return say('Your creature must first resolve and enter the battlefield.');
    if(c.sick)return say('Not yet: summoning sickness prevents this creature from attacking. End the turn and wait until your next turn, or an effect would need to give it haste.');
    if(s.stage!=='attack')return say('Move to combat before declaring an attacker.');
    if(c.tapped)return say('A tapped creature cannot be declared as an attacker.');
    c.tapped=true;c.attacking=true;s.stage='attacking';return record('Grizzly Bears attacks and taps. It does not have vigilance. Pass priority to continue through the scripted opponent’s no-block decision.');
   }
   if(action==='pass'&&s.stage==='attacking'){s.opponentLife-=2;s.stage='done';s.phase='Combat damage';s.complete=true;return record('With no responses, the opponent declares no blockers. After both players pass again, Grizzly Bears deals 2 combat damage. Opponent: 18 life. Lesson complete!');}
  }
  if(s.lesson==='blocking'){
   if(action==='block-lion'&&s.stage==='block'){s.yours[0].blocking=true;s.stage='blocked';return record('Silvercoat Lion blocks Grizzly Bears. Declaring a blocker does not tap it: your Lion is still untapped. Both players will pass with no responses.');}
   if(action==='no-block'&&s.stage==='block'){s.yourLife-=2;s.failed=true;s.stage='lost';s.phase='Combat damage';return record('Leaving it unblocked was legal, but Grizzly Bears deals 2 damage to you. At 0 life you lose as a state-based action. Restart and try blocking to survive.');}
   if(action==='pass'&&s.stage==='blocked'){s.yourGraveyard.push('Silvercoat Lion');s.theirGraveyard.push('Grizzly Bears');s.yours=[];s.theirs=[];s.complete=true;s.stage='done';s.phase='Combat damage';return record('After both players pass, the 2/2 creatures deal 2 combat damage to each other simultaneously. State-based actions destroy both for lethal damage. You stay at 2 life. Lesson complete!');}
  }
  if(s.lesson==='response'){
   if(action==='choose-growth'){
    if(s.stage!=='respond')return say('Choose the highlighted target or finish the current stack step.');
    if(s.mana<1)return say('Giant Growth costs {G}. Tap your Forest to make green mana before planning this cast.');
    s.stage='target';return say('Choose a creature for Giant Growth. This is the planning step; your mana and card are not spent until you confirm the target.');
   }
   if(action==='cancel-growth'&&s.stage==='target'){s.stage='respond';return say('Plan cancelled. Your mana and Giant Growth are still available.');}
   if(action==='target-player'&&s.stage==='target')return say('Giant Growth targets a creature. The opponent is a player, so that is not a legal target. Choose your Grizzly Bears. Nothing has been spent.');
   if(action==='target-bears'&&s.stage==='target'){s.mana--;s.hand=[];s.stack.push({name:'Giant Growth',controller:'You',target:'your Grizzly Bears'});s.stage='growth-stack';return record('You cast Giant Growth targeting Grizzly Bears and pay {G}. It is on top of Lightning Bolt. Targets and costs are finalized during casting; no one gets priority in the middle of that process.');}
   if(action==='pass'&&s.stage==='respond'){s.stack=[];s.yourGraveyard.push('Grizzly Bears');s.theirGraveyard.push('Lightning Bolt');s.yours=s.yours.filter(c=>c.id!=='bears');s.failed=true;s.stage='lost';return record('Passing was legal. The opponent also passes, so Lightning Bolt resolves and deals 3 to your 2/2. State-based actions destroy Grizzly Bears. Restart to try responding before Bolt resolves.');}
   if(action==='pass'&&s.stage==='growth-stack'){s.stack.pop();s.yourGraveyard.push('Giant Growth');const c=s.yours.find(c=>c.id==='bears');c.power=5;c.toughness=5;c.pumped=true;s.stage='bolt-stack';return record('Giant Growth resolves first. Grizzly Bears is 5/5 until end of turn. Lightning Bolt is still on the stack. Players receive priority again before it can resolve.');}
   if(action==='pass'&&s.stage==='bolt-stack'){s.stack=[];s.theirGraveyard.push('Lightning Bolt');s.yours.find(c=>c.id==='bears').damage=3;s.stage='cleanup';return record('Both players pass again. Lightning Bolt deals 3 damage to the 5/5 Bears. It survives: damage is marked, not subtracted from toughness, and 3 is less than 5. Finish the turn to see cleanup.');}
   if(action==='cleanup'&&s.stage==='cleanup'){const c=s.yours.find(c=>c.id==='bears');c.power=2;c.toughness=2;c.damage=0;c.pumped=false;s.mana=0;s.phase='Cleanup step';s.complete=true;s.stage='done';return record('No one takes further actions. During cleanup, damage is removed and the until-end-of-turn bonus ends simultaneously. Bears is a 2/2 with no damage; it never becomes a 2/2 with 3 damage in between. Lesson complete!');}
  }
  return say('That action is not part of the current guided step. Read the coach message and try a highlighted action.');
 }
`;

export function playLessonHtml(){return `<section class="learn-panel" id="play-table" aria-labelledby="play-title"><p class="learn-kicker">LEARN BY PLAYING</p><h2 id="play-title">Take a seat at the teaching table</h2><p>Play cards from your hand, tap lands, choose attacks and blocks, and respond to spells. These guided lessons use fixed starting boards and scripted opponent actions. They work without sign-in or AI requests.</p><label for="play-lesson">Choose a playing lesson</label><select id="play-lesson">${playLessons.map(l=>`<option value="${l.id}">${l.title}</option>`).join('')}</select><p id="play-goal"></p><p id="play-progress" role="status">0 of 3 guided lessons completed on this device.</p><div class="play-toolbar"><strong id="play-phase"></strong><span id="play-mana"></span><button type="button" id="play-reset">Restart this lesson</button></div><section class="play-coach" aria-labelledby="play-coach-title"><h3 id="play-coach-title" tabindex="-1">Your coach</h3><p id="play-feedback" role="status" aria-live="polite"></p><div id="play-actions" class="practice-actions"></div></section><div class="play-board"><div class="play-mat-title">MANA POCKET · TRAINING MATCH</div><section class="play-seat"><h3>Scripted opponent <span id="play-life-opponent"></span></h3><div id="play-enemy" class="play-cards" aria-label="Opponent battlefield"></div><p id="play-their-graveyard"></p></section><section class="play-stack"><h3>The stack · top first</h3><ol id="play-stack"></ol></section><section class="play-seat"><h3>Your battlefield <span id="play-life-you"></span></h3><div id="play-yours" class="play-cards" aria-label="Your battlefield"></div><p id="play-your-graveyard"></p></section><section class="play-hand"><h3>Your hand</h3><div id="play-hand" class="play-cards" aria-label="Your hand"></div></section></div><p class="learn-note">Card images and Oracle data provided by <a href="https://scryfall.com" target="_blank" rel="noopener">Scryfall</a>. Magic: The Gathering card images © Wizards of the Coast. Select a card image to inspect it.</p><dialog id="play-inspect" aria-labelledby="play-inspect-title"><h3 id="play-inspect-title"></h3><div id="play-inspect-content"></div><form method="dialog"><button>Back to the table</button></form></dialog><details><summary>What happened this lesson?</summary><ol id="play-log"></ol></details><p class="learn-note" id="play-refs"></p></section><script type="application/json" id="play-lesson-data">${JSON.stringify(playLessons)}</script>`;}

export const playStyles=`#mtg-academy .play-board{background:var(--wo-bg,#100c1c);border:1px solid var(--wo-border-strong,#75608c);border-radius:18px;padding:18px;margin:18px 0}#mtg-academy .play-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:14px}#mtg-academy .play-toolbar strong{flex:1;min-width:180px}#mtg-academy .play-seat,#mtg-academy .play-stack,#mtg-academy .play-hand{padding:12px 0;border-bottom:1px solid var(--wo-border,#51415e)}#mtg-academy .play-cards{display:flex;gap:14px;flex-wrap:wrap;align-items:stretch}#mtg-academy .play-card{width:190px;max-width:100%;border:2px solid var(--wo-border-strong,#75608c);border-radius:12px;background:var(--wo-surface,#1d172d);padding:14px;display:flex;flex-direction:column;gap:8px;box-shadow:0 5px 12px #0003}#mtg-academy .play-card.tapped{border-style:dashed;background:var(--wo-surface-alt,#292139)}#mtg-academy .play-card strong{line-height:1.3}#mtg-academy .play-card small{line-height:1.5}#mtg-academy .play-card button{margin-top:auto;font-size:14px;padding:9px;white-space:normal}#mtg-academy .play-card .play-pt{font-weight:800;align-self:flex-end}#mtg-academy .play-badge{font-size:12px;font-weight:700;color:var(--wo-accent,#b4f871)}#mtg-academy .play-coach{position:sticky;top:110px;z-index:4;max-height:42vh;overflow:auto;margin:16px 0;box-shadow:0 5px 16px #0004;border-left:4px solid var(--wo-accent,#b4f871);padding:8px 18px;background:var(--wo-surface-alt,#292139);border-radius:10px}#mtg-academy .play-stack li{padding:8px;line-height:1.5}#mtg-academy #play-feedback{min-height:3em}#mtg-academy .play-seat h3 span{font-size:17px;color:var(--wo-accent,#b4f871)}@media(max-width:480px){#mtg-academy .play-board{padding:10px}#mtg-academy .play-card{width:100%}#mtg-academy .play-coach{padding:8px 12px;top:88px}#mtg-academy .play-coach h3{font-size:17px;margin:8px 0}#mtg-academy .play-coach p{margin:8px 0}}
#mtg-academy .play-board{background:radial-gradient(ellipse at center,#28443d 0,#142b29 65%,#0b1c20 100%);border:3px solid #897044;box-shadow:inset 0 0 60px #0008,0 15px 35px #0004;color:#f8f4e8;padding:22px}
#mtg-academy .play-mat-title{text-align:center;color:#d5c39c;font-size:11px;letter-spacing:3px;padding:5px 0 18px}
#mtg-academy .play-seat,#mtg-academy .play-hand,#mtg-academy .play-stack{border-color:#b8c8bb30;padding:18px 0}
#mtg-academy .play-seat h3,#mtg-academy .play-hand h3,#mtg-academy .play-stack h3{color:#f5ead5;text-transform:uppercase;letter-spacing:1px;font-size:15px}
#mtg-academy .play-cards{align-items:flex-start;gap:18px}
#mtg-academy .play-card{width:164px;background:#101b20;border:1px solid #698178;border-radius:12px;padding:9px;color:#f4f1e8;gap:6px;box-shadow:0 7px 14px #0006}
#mtg-academy .play-art{position:relative;display:block;width:100%;aspect-ratio:488/680;padding:0;margin:0 0 4px;border:0;border-radius:9px;overflow:hidden;background:#19241e;cursor:zoom-in;transition:transform .22s}
#mtg-academy .play-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
#mtg-academy .play-art-placeholder{display:flex;align-items:center;justify-content:center;height:100%;padding:12px;box-sizing:border-box;color:#e4d1a8;border:5px solid #1b1510;border-radius:9px;background:linear-gradient(135deg,#294639,#141b25)}
#mtg-academy .play-art-placeholder[hidden]{display:none}
#mtg-academy .play-card.tapped{background:#172024;border-style:solid;padding-top:32px}
#mtg-academy .play-card.tapped .play-art{transform:rotate(90deg) scale(.72);filter:brightness(.8)}
#mtg-academy .play-card.attacking{border:2px solid #ef9b57;box-shadow:0 0 18px #f0903633}
#mtg-academy .play-card.blocking{border:2px solid #7dc8f5}
#mtg-academy .play-card small{font-size:12px}
#mtg-academy .play-card button:not(.play-art){font-size:12px;width:100%;min-height:40px}
#mtg-academy .play-card .play-badge{color:#a7e5ba;font-size:11px}
#mtg-academy .play-pt{background:#eee5cc;color:#111c19;border-radius:5px;padding:3px 9px}
#mtg-academy .play-stack{background:#0c17245c;border:1px dashed #b4bec755;border-radius:12px;padding:12px;margin:16px 0}
#mtg-academy #play-stack{display:flex;flex-wrap:wrap;gap:16px;list-style:none;padding:0}
#mtg-academy #play-stack li{padding:0;max-width:190px}
#mtg-academy #play-stack li p{font-size:12px;color:#f2ddae}
#mtg-academy #play-inspect{background:var(--wo-surface,#1d172d);color:var(--wo-text,#fff);border:1px solid #8a7957;border-radius:18px;width:min(440px,85vw);max-height:88vh;overflow:auto;padding:20px}
#mtg-academy #play-inspect::backdrop{background:#000b}
#mtg-academy #play-inspect img{display:block;max-width:100%;max-height:58vh;margin:auto;border-radius:12px}
@media(max-width:480px){#mtg-academy .play-board{padding:12px}#mtg-academy .play-cards{gap:10px}#mtg-academy .play-card{width:calc(50% - 5px);box-sizing:border-box;padding:7px}#mtg-academy .play-card.tapped{padding-top:20px}#mtg-academy #play-stack li{width:150px}#mtg-academy #play-stack .play-card{width:100%}}
@media(prefers-reduced-motion:reduce){#mtg-academy .play-art{transition:none}}
`;

const playClientSource=String.raw`
 const root=document.querySelector('#play-table');if(!root)return;
 const $=s=>root.querySelector(s);let data=[];try{data=JSON.parse(document.querySelector('#play-lesson-data').textContent);}catch{return;}
 const savedKey='mp-mtg-play-v1';let completed=[];try{const v=JSON.parse(localStorage.getItem(savedKey)||'[]');if(Array.isArray(v))completed=v.filter(id=>data.some(l=>l.id===id));}catch{}
 let state=createPlayState($('#play-lesson').value);
 function node(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
 function button(text,action){const b=node('button',text);b.type='button';b.addEventListener('click',()=>{state=playAction(state,action);draw();$('#play-coach-title').focus({preventScroll:true});});return b;}
 const artCache=new Map();
 let artQueue=Promise.resolve();
 function cardArt(name){
  if(!artCache.has(name))artCache.set(name,artQueue=artQueue.catch(()=>null).then(async()=>{
   try{const r=await fetch('/mtg-judge/card?name='+encodeURIComponent(name),{credentials:'omit'});if(!r.ok)return null;const data=await r.json();return data.card||null;}catch{return null;}
  }));
  return artCache.get(name);
 }
 function art(c){
  const frame=node('button','');frame.type='button';frame.className='play-art';frame.setAttribute('aria-label','Inspect '+c.name);
  const placeholder=node('span',c.name);placeholder.className='play-art-placeholder';frame.append(placeholder);
  let detail=null;
  cardArt(c.name).then(card=>{detail=card;const face=card?.faces?.[0];if(!face?.image)return;const img=document.createElement('img');img.alt=c.name+' card';img.width=488;img.height=680;img.decoding='async';img.addEventListener('load',()=>placeholder.hidden=true);img.addEventListener('error',()=>img.remove());img.src=face.image;frame.append(img);});
  frame.addEventListener('click',()=>{const dialog=$('#play-inspect');$('#play-inspect-title').textContent=c.name;const body=$('#play-inspect-content');body.replaceChildren();const face=detail?.faces?.[0];if(face?.image){const img=document.createElement('img');img.src=face.image;img.alt=c.name;body.append(img);}body.append(node('p',face?.text||c.text||cardData[c.name]?.text||''));if(detail?.url){const link=node('a','View card and rulings on Scryfall');link.href=detail.url;link.target='_blank';link.rel='noopener';body.append(link);}dialog.showModal();});
  return frame;
 }
 function drawCard(c,zone){const e=node('article','');e.className='play-card'+(c.tapped?' tapped':'')+(c.attacking?' attacking':'')+(c.blocking?' blocking':'');e.append(art(c),node('strong',c.name),node('small',c.cost||'Land'),node('small',c.type),node('small',c.text));const badges=[!['yours','theirs'].includes(zone)?'':c.tapped?'Tapped':'Untapped',c.sick?'Summoning sickness':'',c.attacking?'Attacking':'',c.blocking?'Blocking':'',c.pumped?'+3/+3 until end of turn':'',c.damage?c.damage+' damage marked':''].filter(Boolean);e.append(node('span',badges.join(' · ')));e.lastChild.className='play-badge';if(c.power!==undefined){const pt=node('span',c.power+'/'+c.toughness);pt.className='play-pt';e.append(pt);}
  if(!state.complete&&!state.failed){
   if(zone==='hand'&&c.name==='Forest')e.append(button('Play Forest','play-forest'));
   if(zone==='hand'&&c.name==='Grizzly Bears')e.append(button('Cast Grizzly Bears · {1}{G}','cast-bears'));
   if(zone==='hand'&&c.name==='Giant Growth')e.append(button('Choose Giant Growth · {G}','choose-growth'));
   if(zone==='yours'&&c.name==='Forest'&&['main','next-main','respond'].includes(state.stage))e.append(button(c.tapped?'Forest is tapped':'Tap Forest · add {G}','tap:'+c.id));
   if(zone==='yours'&&c.id==='bears'&&state.lesson==='first-turn'&&['new-creature','next-main','attack'].includes(state.stage))e.append(button('Attack with Grizzly Bears','attack-bears'));
   if(zone==='yours'&&c.id==='lion'&&state.stage==='block')e.append(button('Block with Silvercoat Lion','block-lion'));
   if(zone==='yours'&&c.id==='bears'&&state.stage==='target')e.append(button('Target Grizzly Bears','target-bears'));
  }return e;}
 function zone(selector,cards,kind){const container=$(selector);container.replaceChildren();cards.forEach(c=>container.append(drawCard(c,kind)));if(!cards.length)container.append(node('p','Empty'));}
 function draw(){const lesson=data.find(l=>l.id===state.lesson);$('#play-goal').textContent='Goal: '+lesson.goal;$('#play-phase').textContent=state.phase;$('#play-mana').textContent='Your mana pool: '+state.mana+' green';$('#play-life-you').textContent='· '+state.yourLife+' life';$('#play-life-opponent').textContent='· '+state.opponentLife+' life';zone('#play-yours',state.yours,'yours');zone('#play-enemy',state.theirs,'theirs');zone('#play-hand',state.hand,'hand');$('#play-your-graveyard').textContent='Your graveyard: '+(state.yourGraveyard.join(', ')||'empty');$('#play-their-graveyard').textContent='Opponent graveyard: '+(state.theirGraveyard.join(', ')||'empty');$('#play-stack').replaceChildren();[...state.stack].reverse().forEach((c,i)=>{const li=node('li','');li.append(drawCard({...cardData[c.name],...c},'stack'),node('p',(i===0?'TOP · ':'')+c.controller+(c.target?' → '+c.target:'')));$('#play-stack').append(li);});if(!state.stack.length)$('#play-stack').append(node('li','Empty'));$('#play-feedback').textContent=state.feedback;$('#play-log').replaceChildren();state.log.forEach(text=>$('#play-log').append(node('li',text)));$('#play-refs').textContent='Rule references for this lesson: '+lesson.refs+'. See the official rules links below.';
  const actions=$('#play-actions');actions.replaceChildren();
  if(['bear-spell','attacking','blocked','respond','growth-stack','bolt-stack'].includes(state.stage)&&!state.failed&&!state.complete)actions.append(button(state.stage==='respond'?'Pass without responding':'Pass priority · continue','pass'));
  if(state.stage==='new-creature')actions.append(button('End turn · play to your next turn','next-turn'));
  if(state.stage==='next-main')actions.append(button('Move to combat','combat'));
  if(state.stage==='block')actions.append(button('Leave the attacker unblocked','no-block'));
  if(state.stage==='target')actions.append(button('Try targeting the opponent','target-player'),button('Cancel planned cast','cancel-growth'));
  if(state.stage==='cleanup')actions.append(button('Finish the turn · cleanup','cleanup'));
  if(state.complete&&!completed.includes(state.lesson)){completed.push(state.lesson);try{localStorage.setItem(savedKey,JSON.stringify(completed));}catch{}}
  $('#play-progress').textContent=completed.length+' of '+data.length+' guided lessons completed on this device.';
  if(state.complete){const i=data.findIndex(l=>l.id===state.lesson);if(i<data.length-1){const b=node('button','Play the next lesson');b.type='button';b.addEventListener('click',()=>{$('#play-lesson').value=data[i+1].id;state=createPlayState(data[i+1].id);draw();});actions.append(b);}}
 }
 $('#play-lesson').addEventListener('change',()=>{state=createPlayState($('#play-lesson').value);draw();});$('#play-reset').addEventListener('click',()=>{state=createPlayState($('#play-lesson').value);draw();});draw();
`;
export const playScript='(function(){\n'+playEngineSource+'\n'+playClientSource+'\n})();';
