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
  if(lesson==='response'){s.stage='respond';s.phase='Opponent’s main phase · you have priority';s.yours=[makeCard('Forest','forest-a'),makeCard('Grizzly Bears','bears')];s.hand=[makeCard('Giant Growth','growth')];s.stack=[{id:'bolt',name:'Lightning Bolt',controller:'Opponent',target:'your Grizzly Bears'}];s.feedback='Lightning Bolt targets your 2/2 Grizzly Bears. You have priority. Tap Forest to make green mana, then choose Giant Growth and its target.';}
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
    s.mana-=2;s.hand=s.hand.filter(c=>c.id!=='bears');s.stack.push({id:'bears',name:'Grizzly Bears',controller:'You',target:''});s.stage='bear-spell';return record('You pay {1}{G} using two green mana. Grizzly Bears is a spell on the stack, not a creature on the battlefield yet. Pass priority; the scripted opponent will also pass.');
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
   if(action==='target-bears'&&s.stage==='target'){s.mana--;s.hand=[];s.stack.push({id:'growth',name:'Giant Growth',controller:'You',target:'your Grizzly Bears'});s.stage='growth-stack';return record('You cast Giant Growth targeting Grizzly Bears and pay {G}. It is on top of Lightning Bolt. Targets and costs are finalized during casting; no one gets priority in the middle of that process.');}
   if(action==='pass'&&s.stage==='respond'){s.stack=[];s.yourGraveyard.push('Grizzly Bears');s.theirGraveyard.push('Lightning Bolt');s.yours=s.yours.filter(c=>c.id!=='bears');s.failed=true;s.stage='lost';return record('Passing was legal. The opponent also passes, so Lightning Bolt resolves and deals 3 to your 2/2. State-based actions destroy Grizzly Bears. Restart to try responding before Bolt resolves.');}
   if(action==='pass'&&s.stage==='growth-stack'){s.stack.pop();s.yourGraveyard.push('Giant Growth');const c=s.yours.find(c=>c.id==='bears');c.power=5;c.toughness=5;c.pumped=true;s.stage='bolt-stack';return record('Giant Growth resolves first. Grizzly Bears is 5/5 until end of turn. Lightning Bolt is still on the stack. Players receive priority again before it can resolve.');}
   if(action==='pass'&&s.stage==='bolt-stack'){s.stack=[];s.theirGraveyard.push('Lightning Bolt');s.yours.find(c=>c.id==='bears').damage=3;s.stage='cleanup';return record('Both players pass again. Lightning Bolt deals 3 damage to the 5/5 Bears. It survives: damage is marked, not subtracted from toughness, and 3 is less than 5. Finish the turn to see cleanup.');}
   if(action==='cleanup'&&s.stage==='cleanup'){const c=s.yours.find(c=>c.id==='bears');c.power=2;c.toughness=2;c.damage=0;c.pumped=false;s.mana=0;s.phase='Cleanup step';s.complete=true;s.stage='done';return record('No one takes further actions. During cleanup, damage is removed and the until-end-of-turn bonus ends simultaneously. Bears is a 2/2 with no damage; it never becomes a 2/2 with 3 damage in between. Lesson complete!');}
  }
  return say('That action is not part of the current guided step. Read the coach message and try a highlighted action.');
 }
`;

export function playLessonHtml(){return `<section class="learn-panel" id="play-table" aria-labelledby="play-title"><header class="play-heading"><div><p class="learn-kicker">LEARN BY PLAYING</p><h2 id="play-title">Your first match starts here.</h2><p>Real cards. Your decisions. A coach at your side. Guided lessons use fixed boards and scripted opponent actions.</p></div><button type="button" id="play-focus" aria-pressed="false">Expand game table</button></header><div class="play-setup"><label for="play-lesson">Playing lesson<select id="play-lesson">${playLessons.map(l=>`<option value="${l.id}">${l.title}</option>`).join('')}</select></label><p id="play-progress" role="status"></p><button type="button" id="play-reset">Restart this lesson</button></div><div class="play-game"><div class="play-board"><div class="play-toolbar"><strong id="play-phase"></strong><div class="play-phases" aria-label="Turn phases"><span data-phase="main">Main</span><span data-phase="combat">Combat</span><span data-phase="ending">Ending</span></div></div><div id="play-table-cue" aria-hidden="true"></div><div class="play-player opponent"><span class="play-avatar" aria-hidden="true">◆</span><div><strong>Practice opponent</strong><small>Scripted opponent · learn at your pace</small></div><strong id="play-life-opponent" class="play-life" aria-label="Opponent life"></strong><div id="play-their-graveyard" class="play-grave" aria-label="Opponent graveyard"></div></div><section class="play-opponent-field"><h3>Opponent battlefield</h3><div id="play-enemy" class="play-cards" aria-label="Opponent battlefield"></div></section><section class="play-combat"><h3>Combat lane</h3><div class="play-combat-row"><div id="play-combat-enemy" class="play-cards" aria-label="Attacking opponent creatures"></div><div id="play-combat-yours" class="play-cards" aria-label="Your creatures in combat"></div></div><p id="play-combat-hint"></p></section><section id="play-yours" class="play-your-field"><h3>Your battlefield</h3><div id="play-creatures" class="play-cards" aria-label="Your creatures"></div><div class="play-land-line"><span>Lands</span><div id="play-lands" class="play-cards" aria-label="Your lands"></div></div></section><section class="play-stack"><h3>Spell stack <span id="play-stack-count"></span></h3><ol id="play-stack" aria-label="Spell stack, top first"></ol></section><div class="play-player you"><span class="play-avatar" aria-hidden="true">✦</span><div><strong>You</strong><small id="play-mana"></small></div><strong id="play-life-you" class="play-life" aria-label="Your life"></strong><div id="play-your-graveyard" class="play-grave" aria-label="Your graveyard"></div></div><section class="play-hand"><h3>Your hand <span>Click a card to play · or drag it onto the table</span></h3><div id="play-hand" class="play-cards" aria-label="Your hand"></div></section><svg class="play-targets" aria-hidden="true"><defs><marker id="play-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#f5bd72"/></marker></defs><path id="play-target-path" marker-end="url(#play-arrow)"/></svg><div id="play-announcement" aria-hidden="true"></div></div><aside class="play-coach" aria-labelledby="play-coach-title"><p class="learn-kicker">YOUR COACH</p><h3 id="play-coach-title" tabindex="-1">Your move</h3><p id="play-goal"></p><div id="play-next-move"></div><p id="play-feedback" role="status" aria-live="polite"></p><div id="play-actions" class="practice-actions"></div><details><summary>Match log</summary><ol id="play-log"></ol></details><p class="learn-note" id="play-refs"></p></aside></div><p class="learn-note play-credit">Card images and Oracle data: <a href="https://scryfall.com" target="_blank" rel="noopener">Scryfall</a>. Magic: The Gathering card images © Wizards of the Coast. Use a card’s ⤢ button to inspect it. No account or AI requests needed to play.</p><dialog id="play-inspect" aria-labelledby="play-inspect-title"><h3 id="play-inspect-title"></h3><div id="play-inspect-content"></div><form method="dialog"><button>Back to the table</button></form></dialog></section><script type="application/json" id="play-lesson-data">${JSON.stringify(playLessons)}</script>`;}

export const playStyles=String.raw`
.mp-wrap:has(#play-table){max-width:1560px}
#mtg-academy #play-table{padding:20px;scroll-margin-top:95px}
#mtg-academy .play-heading{display:flex;justify-content:space-between;align-items:center;gap:20px}
#mtg-academy .play-heading h2{margin:6px 0;font-size:30px}
#mtg-academy .play-heading p{margin:5px 0;font-size:14px}
#mtg-academy .play-setup{display:flex;align-items:center;gap:16px;margin:18px 0}
#mtg-academy .play-setup label{flex:1;max-width:560px;font-size:12px}
#mtg-academy .play-setup select{margin:5px 0;padding:10px;font-size:14px}
#mtg-academy #play-progress{font-size:12px;flex:1}
#mtg-academy .play-game{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:16px;align-items:start}
#mtg-academy .play-board{position:relative;isolation:isolate;display:grid;grid-template-columns:minmax(0,1fr) 145px;grid-template-areas:'turn turn' 'opponent opponent' 'enemy stack' 'combat stack' 'field stack' 'you you' 'hand hand';border:1px solid #927b51;border-radius:18px;overflow:hidden;background:radial-gradient(ellipse at 50% 38%,#315453 0,#152f36 52%,#0b1625 100%);box-shadow:inset 0 0 65px #0008,0 14px 35px #0005;color:#f9f1df;min-width:0}
#mtg-academy .play-board h3{font-size:10px;color:#c4cfc9;text-transform:uppercase;letter-spacing:1.6px;margin:0 0 8px}
#mtg-academy .play-toolbar{grid-area:turn;display:flex;justify-content:space-between;align-items:center;gap:10px;background:#091720bb;border-bottom:1px solid #ffffff18;padding:10px 14px;font-size:12px}
#mtg-academy .play-phases{display:flex;gap:6px;font-size:10px}.play-phases span{padding:4px 8px;border:1px solid #ffffff25;border-radius:20px}.play-phases .active{background:#d3ad66;color:#172330}
#mtg-academy .play-player{display:flex;align-items:center;gap:10px;padding:9px 14px;background:#08172299;min-height:60px}
#mtg-academy .play-player.opponent{grid-area:opponent}#mtg-academy .play-player.you{grid-area:you;border-top:1px solid #ffffff15}
#mtg-academy .play-player strong{font-size:13px}#mtg-academy .play-player small{display:block;font-size:10px;color:#c0cbc8;margin-top:4px}
#mtg-academy .play-avatar{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;border:1px solid #bc9862;background:linear-gradient(140deg,#534325,#192c3c);color:#f4d79d;font-size:24px}
#mtg-academy .play-player .play-life{display:grid;place-items:center;border:1px solid #bf9f60;border-radius:50%;width:42px;height:42px;font-size:23px;background:#07141b;margin-left:auto;flex-shrink:0}
#mtg-academy .play-opponent-field{grid-area:enemy;min-height:80px;padding:10px 18px}
#mtg-academy .play-combat{grid-area:combat;min-height:95px;background:linear-gradient(90deg,transparent,#d6ae5615,transparent);border-block:1px solid #a5d5c620;padding:8px 18px}
#mtg-academy .play-combat-row{display:flex;justify-content:space-evenly;gap:18px;align-items:center;min-height:28px}
#mtg-academy #play-combat-hint{font-size:11px;text-align:center;margin:0;color:#c3d6cc!important}
#mtg-academy .play-your-field{grid-area:field;padding:10px 18px;min-height:150px}
#mtg-academy .play-land-line{display:flex;align-items:center;gap:12px;border-top:1px solid #ffffff12;margin-top:8px;padding-top:8px}
#mtg-academy .play-land-line>span{font-size:10px;writing-mode:vertical-rl;text-transform:uppercase;letter-spacing:2px;color:#b9c8b5}
#mtg-academy .play-cards{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;align-items:center;min-height:20px;min-width:0}
#mtg-academy .play-land-line .play-cards{justify-content:flex-start}
#mtg-academy .play-card{position:relative;width:86px;flex:0 0 86px;display:flex;flex-direction:column;gap:3px;align-items:stretch;transition:filter .15s;z-index:2}
#mtg-academy .play-art{position:relative;width:100%;aspect-ratio:488/680;padding:0!important;margin:0;border:1px solid #8f9a83!important;border-radius:7px!important;overflow:hidden;background:#1c2925!important;box-shadow:0 5px 10px #0009;transition:transform .3s,border-color .2s}
#mtg-academy .play-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
#mtg-academy .play-art-placeholder{display:grid;place-items:center;height:100%;padding:6px;color:#e4d1a8;border:4px solid #17140e;border-radius:6px;background:linear-gradient(135deg,#294639,#141b25);font-size:10px}
#mtg-academy .play-card>strong{font-size:10px;line-height:1.2;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#mtg-academy .play-card>small{display:none}
#mtg-academy .play-card .play-badge{font-size:9px;text-align:center;color:#c5dfb9;line-height:1.3}
#mtg-academy .play-card .play-pt{position:absolute;right:1px;top:94px;border:1px solid #9d895d;background:#f0e3c1;color:#12242b;border-radius:4px;font:bold 12px Arial;padding:2px 5px;z-index:3}
#mtg-academy .play-card button.play-card-action{font-size:10px;line-height:1.25;padding:5px!important;border-radius:5px;min-height:28px;white-space:normal;width:100%}
#mtg-academy .play-inspect-button{position:absolute;right:-5px;top:-7px;z-index:4;width:24px;height:24px;border-radius:50%!important;padding:0!important;font-size:14px;background:#122636!important;color:#e8e4cc!important}
#mtg-academy .play-card.tapped{margin-inline:12px}
#mtg-academy .play-card.tapped .play-art{transform:rotate(90deg) scale(.77);filter:brightness(.82)}
#mtg-academy .play-card.attacking .play-art{box-shadow:0 0 15px #f7a54699;border-color:#ffae60!important}
#mtg-academy .play-card.blocking .play-art{box-shadow:0 0 15px #69c6ee99;border-color:#79d3f5!important}
#mtg-academy .play-card.is-next .play-art{outline:2px solid #a4e6c5;outline-offset:3px;box-shadow:0 0 18px #91e3ba55}
#mtg-academy .play-card.is-next .play-card-action{box-shadow:0 0 0 2px #a4e6c5}
#mtg-academy .play-stack{grid-area:stack;background:#08132280;border-left:1px solid #d3b77333;padding:10px 9px;min-width:0}
#mtg-academy #play-stack{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:15px;align-items:center}
#mtg-academy #play-stack li{width:100%;text-align:center}
#mtg-academy #play-stack .play-card{margin:auto}
#mtg-academy #play-stack p{font-size:10px;line-height:1.4;margin:4px 0;color:#e9cf9c!important}
#mtg-academy .play-empty{font-size:10px;margin:0;padding:8px;color:#b6c7c1!important;text-align:center}
#mtg-academy .play-hand{grid-area:hand;padding:10px 14px 15px;background:linear-gradient(#07131ca8,#050c17e8);min-height:174px;border-top:1px solid #bda26c44}
#mtg-academy .play-hand h3 span{font-size:9px;font-weight:400;text-transform:none;letter-spacing:0;margin-left:12px}
#mtg-academy .play-hand .play-cards{gap:8px;align-items:flex-end}
#mtg-academy .play-hand .play-card{width:104px;flex-basis:104px;transform:rotate(-3deg);transform-origin:50% 100%}
#mtg-academy .play-hand .play-card:nth-child(even){transform:rotate(3deg)}
#mtg-academy .play-hand .play-card:hover,#mtg-academy .play-hand .play-card:focus-within{filter:brightness(1.1);z-index:6}
#mtg-academy .play-hand .play-card .play-pt{top:118px}
#mtg-academy .play-grave{display:flex;gap:3px;align-items:center;max-width:110px;flex-wrap:wrap;margin-left:8px}
#mtg-academy .play-grave .play-card{width:27px;flex-basis:27px}.play-grave .play-card>strong,.play-grave .play-badge,.play-grave .play-pt,.play-grave .play-inspect-button{display:none!important}
#mtg-academy .play-grave-label{font-size:9px;color:#becbc7;width:100%}
#mtg-academy .play-coach{position:sticky;top:100px;min-width:0;border:1px solid var(--wo-border,#655c6e);border-radius:14px;padding:18px;background:var(--wo-surface-alt,#202837)}
#mtg-academy .play-coach h3{font-size:24px;margin:8px 0}
#mtg-academy .play-coach .learn-kicker{font-size:10px;margin:0}
#mtg-academy #play-goal{font-size:12px;border-bottom:1px solid #ffffff20;padding-bottom:14px;line-height:1.5}
#mtg-academy #play-feedback{font-size:13px;line-height:1.65;min-height:90px}
#mtg-academy #play-next-move{font-size:13px;font-weight:700;color:#b5edcd;border:1px solid #8cd7b75c;background:#224e4033;border-radius:8px;padding:10px}
#mtg-academy .play-coach .practice-actions{display:flex;flex-direction:column;gap:8px}
#mtg-academy .play-coach button{font-size:13px;width:100%}
#mtg-academy .play-coach summary{font-size:12px;margin-top:18px}
#mtg-academy #play-log{font-size:11px;padding-left:18px;line-height:1.6;max-height:180px;overflow:auto}
#mtg-academy .play-coach .learn-note{font-size:10px;line-height:1.5}
#mtg-academy .play-targets{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:visible}
#mtg-academy #play-target-path{fill:none;stroke:#f5bd72;stroke-width:2.5;stroke-dasharray:6 5;filter:drop-shadow(0 1px 3px #000)}
#mtg-academy #play-announcement{position:absolute;left:50%;top:43%;transform:translate(-50%,-50%);z-index:8;pointer-events:none;font-weight:800;font-size:25px;color:#ffe0a6;text-shadow:0 2px 8px #000;white-space:nowrap}
.play-flight{position:fixed!important;pointer-events:none!important;z-index:9999!important;transform-origin:0 0!important;margin:0!important;filter:drop-shadow(0 10px 18px #0009)}
#mtg-academy .play-credit{font-size:10px;margin-bottom:0}
#mtg-academy #play-inspect{background:var(--wo-surface,#1d172d);color:var(--wo-text,#fff);border:1px solid #8a7957;border-radius:18px;width:min(440px,85vw);max-height:88vh;overflow:auto;padding:20px}
#mtg-academy #play-inspect::backdrop{background:#000b}
#mtg-academy #play-inspect img{display:block;max-width:100%;max-height:58vh;margin:auto;border-radius:12px}
#mtg-academy #play-table.play-focused{position:fixed;inset:85px 12px 10px;z-index:90;overflow:auto;margin:0;background:var(--wo-surface,#18212c);padding:14px}
#mtg-academy .play-focused .play-heading p,#mtg-academy .play-focused .play-credit{display:none}
#mtg-academy .play-focused .play-heading h2{font-size:20px}.play-focused .play-heading .learn-kicker{display:none}
#mtg-academy .play-focused .play-setup{margin:8px 0}
#mtg-academy .play-board.drag-active{box-shadow:inset 0 0 0 2px #a4e6c5,0 14px 35px #0005}
@media(min-width:1150px){#mtg-academy .play-board{grid-template-columns:minmax(0,1fr) 170px}#mtg-academy .play-card{width:96px;flex-basis:96px}#mtg-academy .play-card .play-pt{top:108px}#mtg-academy .play-hand .play-card{width:112px;flex-basis:112px}#mtg-academy .play-hand .play-card .play-pt{top:128px}}
@media(max-width:900px){#mtg-academy .play-game{grid-template-columns:minmax(0,1fr) 230px;gap:10px}#mtg-academy .play-coach{padding:12px}#mtg-academy .play-board{grid-template-columns:minmax(0,1fr) 115px}#mtg-academy .play-card{width:72px;flex-basis:72px}#mtg-academy .play-card .play-pt{top:77px}#mtg-academy .play-hand .play-card{width:88px;flex-basis:88px}#mtg-academy .play-hand .play-card .play-pt{top:98px}}
@media(max-width:650px){#mtg-academy #play-table{padding:10px}#mtg-academy .play-heading{gap:8px}#mtg-academy .play-heading h2{font-size:23px}#mtg-academy .play-heading button{font-size:10px;padding:8px;flex:0 0 85px}#mtg-academy .play-heading p{font-size:12px}#mtg-academy .play-setup{flex-wrap:wrap;gap:8px}#mtg-academy .play-setup label{flex:1 0 100%}#mtg-academy .play-setup button{font-size:11px;padding:7px}#mtg-academy .play-game{grid-template-columns:1fr}#mtg-academy .play-coach{position:static;padding:14px}#mtg-academy #play-feedback{min-height:0}#mtg-academy .play-board{grid-template-columns:minmax(0,1fr) 85px}#mtg-academy .play-card{width:62px;flex-basis:62px}#mtg-academy .play-card .play-pt{top:64px;font-size:10px}#mtg-academy .play-card>strong{font-size:9px}#mtg-academy .play-card button.play-card-action{font-size:9px;padding:4px!important}#mtg-academy .play-cards{gap:8px}#mtg-academy .play-card.tapped{margin-inline:4px}#mtg-academy .play-your-field,#mtg-academy .play-combat,#mtg-academy .play-opponent-field{padding:8px}#mtg-academy .play-opponent-field{min-height:50px}#mtg-academy .play-your-field{min-height:110px}#mtg-academy .play-player{padding:7px;gap:6px}#mtg-academy .play-player strong{font-size:11px}#mtg-academy .play-player small{font-size:9px}#mtg-academy .play-player .play-life{width:34px;height:34px;font-size:19px}#mtg-academy .play-avatar{width:28px;height:28px;font-size:20px}#mtg-academy .play-grave{max-width:64px;margin-left:0}#mtg-academy .play-grave .play-card{width:20px;flex-basis:20px}#mtg-academy .play-hand{min-height:158px;padding:9px}#mtg-academy .play-hand .play-card{width:82px;flex-basis:82px}#mtg-academy .play-hand .play-card .play-pt{top:91px}#mtg-academy .play-hand h3 span{display:none}#mtg-academy .play-toolbar{flex-wrap:wrap;font-size:11px;padding:8px}#mtg-academy .play-phases{font-size:9px}#mtg-academy .play-board h3{font-size:9px;letter-spacing:1px}#mtg-academy .play-stack{padding:8px 5px}#mtg-academy #play-stack p{font-size:9px}#mtg-academy #play-table.play-focused{inset:75px 4px 4px;padding:8px}}
#mtg-academy .play-card>strong{position:absolute;bottom:13px;left:0;right:0;z-index:3;background:#07151ce0;padding:2px 3px;pointer-events:none}
#mtg-academy .play-card .play-badge{position:absolute;bottom:0;left:0;right:0;z-index:3;background:#07151ce0;font-size:8px;pointer-events:none}
#mtg-academy .play-card .play-pt{top:auto!important;bottom:28px;pointer-events:none}
#mtg-academy .play-card button.play-card-action{position:absolute;bottom:30px;left:0;right:0;z-index:4;min-height:22px;padding:4px!important;opacity:.95}
#mtg-academy .play-card:has(.play-card-action) .play-pt{bottom:58px}
#mtg-academy .play-land-line .play-card{width:64px;flex-basis:64px}
#mtg-academy .play-land-line .play-card button.play-card-action{font-size:9px}
#mtg-academy .play-your-field{min-height:130px}
#mtg-academy .play-grave .play-card{width:27px;flex-basis:27px}
@media(max-width:650px){#mtg-academy .play-land-line .play-card{width:51px;flex-basis:51px}#mtg-academy .play-grave .play-card{width:20px;flex-basis:20px}#mtg-academy .play-card .play-badge{font-size:7px}#mtg-academy .play-card button.play-card-action{font-size:8px}#mtg-academy .play-your-field{min-height:100px}}
#mtg-academy #play-table-cue{display:none}
#mtg-academy .play-card .play-badge{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#mtg-academy .play-focused #play-progress{display:none}
@media(max-width:650px){#mtg-academy .play-board{grid-template-areas:'turn turn' 'cue cue' 'opponent opponent' 'enemy stack' 'combat stack' 'field stack' 'you you' 'hand hand'}#mtg-academy #play-table-cue{display:block;grid-area:cue;background:#244e40;color:#d5f8e1;font-size:11px;line-height:1.5;padding:8px 10px;border-bottom:1px solid #9edac133}#mtg-academy .play-focused .play-setup{flex-wrap:nowrap}#mtg-academy .play-focused .play-setup label{flex:1 1 0;min-width:0}#mtg-academy .play-focused .play-setup button{flex:0 0 70px}#mtg-academy .play-focused .play-heading h2{font-size:17px}}
@media(prefers-reduced-motion:reduce){#mtg-academy .play-art,#mtg-academy .play-card{transition:none}#mtg-academy .play-hand .play-card:hover{transform:none}}
`;

const playClientSource=String.raw`
 const root=document.querySelector('#play-table');if(!root)return;
 const $=s=>root.querySelector(s);let data=[];try{data=JSON.parse(document.querySelector('#play-lesson-data').textContent);}catch{return;}
 const savedKey='mp-mtg-play-v1';let completed=[];try{const v=JSON.parse(localStorage.getItem(savedKey)||'[]');if(Array.isArray(v))completed=v.filter(id=>data.some(l=>l.id===id));}catch{}
 let state=createPlayState($('#play-lesson').value),busy=false;
 function node(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
 function button(text,action){const b=node('button',text);b.type='button';b.className='play-card-action';b.dataset.action=action;b.addEventListener('click',()=>act(action));return b;}
 const artCache=new Map();
 let artQueue=Promise.resolve();
 function cardArt(name){
  if(!artCache.has(name))artCache.set(name,artQueue=artQueue.catch(()=>null).then(async()=>{
   try{const r=await fetch('/mtg-judge/card?name='+encodeURIComponent(name),{credentials:'omit'});if(!r.ok)return null;const data=await r.json();return data.card||null;}catch{return null;}
  }));
  return artCache.get(name);
 }
 function art(c,zone){
  const frame=node('button','');frame.type='button';frame.className='play-art';frame.setAttribute('aria-label',(primaryAction(c,zone)?'Play or use ':'Inspect ')+c.name);
  const placeholder=node('span',c.name);placeholder.className='play-art-placeholder';frame.append(placeholder);
  let detail=null;
  cardArt(c.name).then(card=>{detail=card;const face=card?.faces?.[0];if(!face?.image)return;const img=document.createElement('img');img.alt=c.name+' card';img.width=488;img.height=680;img.decoding='async';img.addEventListener('load',()=>placeholder.hidden=true);img.addEventListener('error',()=>img.remove());img.src=face.image;frame.append(img);});
  function inspect(){const dialog=$('#play-inspect');$('#play-inspect-title').textContent=c.name;const body=$('#play-inspect-content');body.replaceChildren();const face=detail?.faces?.[0];if(face?.image){const img=document.createElement('img');img.src=face.image;img.alt=c.name;body.append(img);}body.append(node('p',face?.text||c.text||cardData[c.name]?.text||''));if(detail?.url){const link=node('a','View card and rulings on Scryfall');link.href=detail.url;link.target='_blank';link.rel='noopener';body.append(link);}dialog.showModal();}
  frame.addEventListener('click',()=>{const action=primaryAction(c,zone);if(action)act(action);else inspect();});frame.inspectCard=inspect;return frame;
 }
 function drawCard(c,zone){const e=node('article','');e.className='play-card'+(c.tapped?' tapped':'')+(c.attacking?' attacking':'')+(c.blocking?' blocking':'');e.dataset.cardId=c.id;e.dataset.zone=zone;const image=art(c,zone);e.append(image,node('strong',c.name),node('small',c.cost||'Land'),node('small',c.type),node('small',c.text));const badges=[!['yours','theirs'].includes(zone)?'':c.tapped?'Tapped':'Untapped',c.sick?'Summoning sickness':'',c.attacking?'Attacking':'',c.blocking?'Blocking':'',c.pumped?'+3/+3 until end of turn':'',c.damage?c.damage+' damage marked':''].filter(Boolean);e.append(node('span',c.damage?c.damage+' damage':c.blocking?'Blocking':c.attacking?'Attacking':c.sick?'New this turn':c.pumped?'+3/+3 this turn':badges[0]||''));e.lastChild.className='play-badge';e.lastChild.title=badges.join(' · ');if(c.power!==undefined){const pt=node('span',c.power+'/'+c.toughness);pt.className='play-pt';e.append(pt);}
  if(!state.complete&&!state.failed){
   if(zone==='hand'&&c.name==='Forest')e.append(button('Play Forest','play-forest'));
   if(zone==='hand'&&c.name==='Grizzly Bears')e.append(button('Cast Grizzly Bears · {1}{G}','cast-bears'));
   if(zone==='hand'&&c.name==='Giant Growth')e.append(button('Choose Giant Growth · {G}','choose-growth'));
   if(zone==='yours'&&c.name==='Forest'&&['main','next-main','respond'].includes(state.stage))e.append(button(c.tapped?'Forest is tapped':'Tap Forest · add {G}','tap:'+c.id));
   if(zone==='yours'&&c.id==='bears'&&state.lesson==='first-turn'&&['new-creature','next-main','attack'].includes(state.stage))e.append(button('Attack with Grizzly Bears','attack-bears'));
   if(zone==='yours'&&c.id==='lion'&&state.stage==='block')e.append(button('Block with Silvercoat Lion','block-lion'));
   if(zone==='yours'&&c.id==='bears'&&state.stage==='target')e.append(button('Target Grizzly Bears','target-bears'));
  }const inspect=node('button','⤢');inspect.type='button';inspect.className='play-inspect-button';inspect.setAttribute('aria-label','Inspect '+c.name);inspect.addEventListener('click',()=>image.inspectCard());e.append(inspect);if(zone==='hand'){e.draggable=true;e.addEventListener('dragstart',event=>{if(busy){event.preventDefault();return;}event.dataTransfer.setData('text/plain',c.id);event.dataTransfer.effectAllowed='move';$('.play-board').classList.add('drag-active');});e.addEventListener('dragend',()=>$('.play-board').classList.remove('drag-active'));}return e;}
 function zone(selector,cards,kind){const container=$(selector);container.replaceChildren();cards.forEach(c=>container.append(drawCard(c,kind)));if(!cards.length&&!selector.includes('combat')){const empty=node('p',kind==='hand'?'Your hand is empty':kind==='lands'?'Play a land here':kind==='combat'?'':kind==='theirs'?'No opposing permanents':'Your creatures enter here');empty.className='play-empty';container.append(empty);}}
 function draw(){const lesson=data.find(l=>l.id===state.lesson);$('#play-goal').textContent='Goal: '+lesson.goal;$('#play-phase').textContent=state.phase;$('#play-mana').textContent='Mana pool: '+state.mana+' green';$('#play-life-you').textContent=state.yourLife;$('#play-life-opponent').textContent=state.opponentLife;zone('#play-creatures',state.yours.filter(c=>c.name!=='Forest'&&!c.attacking&&!c.blocking),'yours');zone('#play-lands',state.yours.filter(c=>c.name==='Forest'),'yours');zone('#play-combat-yours',state.yours.filter(c=>c.attacking||c.blocking),'yours');zone('#play-combat-enemy',state.theirs.filter(c=>c.attacking),'theirs');zone('#play-enemy',state.theirs.filter(c=>!c.attacking),'theirs');zone('#play-hand',state.hand,'hand');grave('#play-your-graveyard',state.yourGraveyard,false);grave('#play-their-graveyard',state.theirGraveyard,true);$('#play-stack').replaceChildren();[...state.stack].reverse().forEach((c,i)=>{const li=node('li','');li.append(drawCard({...cardData[c.name],...c},'stack'),node('p',(i===0?'TOP · ':'')+c.controller+(c.target?' → '+c.target:'')));$('#play-stack').append(li);});if(!state.stack.length){const empty=node('li','No spells waiting');empty.className='play-empty';$('#play-stack').append(empty);}$('#play-stack-count').textContent=state.stack.length?'· '+state.stack.length:'';$('#play-feedback').textContent=state.feedback;$('#play-log').replaceChildren();state.log.forEach(text=>$('#play-log').append(node('li',text)));$('#play-refs').textContent='Rule references for this lesson: '+lesson.refs+'. See the official rules links below.';
  $('#play-combat-hint').textContent=state.yours.some(c=>c.blocking)?'Blocked · both creatures will deal damage':state.theirs.some(c=>c.attacking)?'Incoming attack → choose a blocker':state.yours.some(c=>c.attacking)?'Attacking the opponent':state.stage==='attack'?'Choose your attacker':'';const phase=state.phase.toLowerCase();root.querySelectorAll('[data-phase]').forEach(e=>e.classList.toggle('active',e.dataset.phase===(['attack','attacking','block','blocked'].includes(state.stage)||phase==='combat damage'?'combat':phase.includes('cleanup')?'ending':'main')));
  const actions=$('#play-actions');actions.replaceChildren();
  if(['bear-spell','attacking','blocked','respond','growth-stack','bolt-stack'].includes(state.stage)&&!state.failed&&!state.complete)actions.append(button(state.stage==='respond'?'Pass without responding':'Pass priority · continue','pass'));
  if(state.stage==='new-creature')actions.append(button('End turn · play to your next turn','next-turn'));
  if(state.stage==='next-main')actions.append(button('Move to combat','combat'));
  if(state.stage==='block')actions.append(button('Leave the attacker unblocked','no-block'));
  if(state.stage==='target')actions.append(button('Try targeting the opponent','target-player'),button('Cancel planned cast','cancel-growth'));
  if(state.stage==='cleanup')actions.append(button('Finish the turn · cleanup','cleanup'));
  if(state.complete&&!completed.includes(state.lesson)){completed.push(state.lesson);try{localStorage.setItem(savedKey,JSON.stringify(completed));}catch{}}
  const next=nextAction();root.querySelectorAll('[data-action]').forEach(b=>{const active=b.dataset.action===next;b.classList.toggle('is-next',active);if(active)b.closest('.play-card')?.classList.add('is-next');});$('#play-next-move').textContent=nextHint();$('#play-table-cue').textContent=nextHint();requestAnimationFrame(targetLine);
  $('#play-progress').textContent=completed.length+' of '+data.length+' guided lessons completed on this device.';
  if(state.complete){const i=data.findIndex(l=>l.id===state.lesson);if(i<data.length-1){const b=node('button','Play the next lesson');b.type='button';b.addEventListener('click',()=>{if(busy)return;$('#play-lesson').value=data[i+1].id;state=createPlayState(data[i+1].id);draw();});actions.append(b);}}
 }

 function primaryAction(c,zone){
  if(state.complete||state.failed)return null;
  if(zone==='hand')return c.name==='Forest'?'play-forest':c.name==='Grizzly Bears'?'cast-bears':c.name==='Giant Growth'?'choose-growth':null;
  if(zone==='yours'){
   if(c.name==='Forest'&&['main','next-main','respond'].includes(state.stage))return 'tap:'+c.id;
   if(c.id==='bears'&&state.stage==='target')return 'target-bears';
   if(c.id==='bears'&&state.lesson==='first-turn'&&['new-creature','next-main','attack'].includes(state.stage))return 'attack-bears';
   if(c.id==='lion'&&state.stage==='block')return 'block-lion';
  }return null;
 }
 function nextAction(){
  if(state.complete||state.failed)return null;
  if(state.stage==='main'){if(!state.landPlayed)return 'play-forest';if(state.mana<2){const land=state.yours.find(c=>c.name==='Forest'&&!c.tapped);return land?'tap:'+land.id:null;}return 'cast-bears';}
  if(state.stage==='respond'){if(!state.mana){const land=state.yours.find(c=>c.name==='Forest'&&!c.tapped);return land?'tap:'+land.id:null;}return 'choose-growth';}
  return {target:'target-bears',block:'block-lion','new-creature':'next-turn','next-main':'combat',attack:'attack-bears',cleanup:'cleanup','bear-spell':'pass',attacking:'pass',blocked:'pass','growth-stack':'pass','bolt-stack':'pass'}[state.stage]||null;
 }
 function nextHint(){if(state.complete)return 'Lesson complete. You made it happen.';if(state.failed)return 'Restart the lesson and try another decision.';const a=nextAction();if(a?.startsWith('tap:'))return 'Your move: tap the glowing Forest for mana.';return {'play-forest':'Your move: play the Forest from your hand.','cast-bears':'Your move: cast Grizzly Bears from your hand.','choose-growth':'Your move: choose Giant Growth in your hand.','target-bears':'Choose your Grizzly Bears as the target.','block-lion':'Your move: block with Silvercoat Lion.','next-turn':'Your creature needs a turn. End this turn.','combat':'Your creature is ready. Move to combat.','attack-bears':'Your move: send Grizzly Bears into combat.','cleanup':'Finish the turn to see damage and the boost wear off.','pass':'Pass priority to see what happens next.'}[a]||'Explore the cards on the table.';}
 function grave(selector,names,enemy){const box=$(selector);box.replaceChildren();const label=node('span','Graveyard · '+names.length);label.className='play-grave-label';box.append(label);names.forEach(name=>{const id=name==='Lightning Bolt'?'bolt':name==='Giant Growth'?'growth':name==='Silvercoat Lion'?'lion':enemy?'enemy-bears':'bears';box.append(drawCard(makeCard(name,id),'grave'));});}
 function capture(){const map=new Map();root.querySelectorAll('[data-card-id]').forEach(e=>{if(e.dataset.cardId)map.set(e.dataset.cardId,{rect:e.querySelector('.play-art').getBoundingClientRect(),node:e.querySelector('.play-art').cloneNode(true),tapped:e.classList.contains('tapped'),zone:e.dataset.zone});});return map;}
 async function act(action){
  if(busy)return;busy=true;root.dataset.motion='playing';const before=capture(),old=state;state=playAction(state,action);draw();
  const controls=[...root.querySelectorAll('button,select')];controls.forEach(e=>e.disabled=true);
  try{await moveCards(before,old,action);}finally{busy=false;root.dataset.motion='idle';controls.forEach(e=>e.disabled=false);$('#play-coach-title').focus({preventScroll:true});targetLine();}
 }
 async function moveCards(before,old,action){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches||!Element.prototype.animate)return;
  const animations=[];
  root.querySelectorAll('[data-card-id]').forEach(e=>{
   const previous=before.get(e.dataset.cardId);if(!previous)return;const after=e.querySelector('.play-art').getBoundingClientRect(),from=previous.rect,dx=from.left-after.left,dy=from.top-after.top;
   if(Math.abs(dx)>3||Math.abs(dy)>3||previous.zone!==e.dataset.zone){
    const ghost=previous.node;ghost.className='play-flight';ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.style.cssText='left:'+from.left+'px;top:'+from.top+'px;width:'+from.width+'px;height:'+from.height+'px;padding:0;border:0;border-radius:7px;overflow:hidden;background:#15262b;';const img=ghost.querySelector('img');if(img)img.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;';document.body.append(ghost);e.style.visibility='hidden';
    const x=after.left-from.left,y=after.top-from.top,sx=after.width/from.width,sy=after.height/from.height;
    const anim=ghost.animate([{transform:'translate(0,0) scale(1)'},{transform:'translate('+x*.5+'px,'+(y*.5-25)+'px) scale('+((1+sx)/2)+','+((1+sy)/2)+')',offset:.5},{transform:'translate('+x+'px,'+y+'px) scale('+sx+','+sy+')'}],{duration:620,easing:'cubic-bezier(.22,.65,.3,1)',fill:'forwards'});
    animations.push(anim.finished.catch(()=>{}).then(()=>{ghost.remove();e.style.visibility='';}));
   }else if(previous.tapped!==e.classList.contains('tapped')){const face=e.querySelector('.play-art');const fromTap=previous.tapped?'rotate(90deg) scale(.77)':'rotate(0deg) scale(1)',toTap=e.classList.contains('tapped')?'rotate(90deg) scale(.77)':'rotate(0deg) scale(1)';animations.push(face.animate([{transform:fromTap},{transform:toTap}],{duration:420,easing:'ease-in-out'}).finished.catch(()=>{}));}
  });
  if(old.yourLife!==state.yourLife||old.opponentLife!==state.opponentLife){const life=$(old.yourLife!==state.yourLife?'#play-life-you':'#play-life-opponent');animations.push(life.animate([{background:'#b63524',transform:'scale(1.25)'},{background:'#07141b',transform:'scale(1)'}],{duration:700}).finished.catch(()=>{}));}
  let message='';if(state.complete&&!old.complete)message='Lesson complete';else if(state.failed&&!old.failed)message='Try again';else if(old.yours.find(c=>c.id==='bears')?.damage!==state.yours.find(c=>c.id==='bears')?.damage&&state.yours.find(c=>c.id==='bears')?.damage)message='3 damage';else if(action==='pass'&&old.stage==='growth-stack')message='+3 / +3';else if(action==='pass'&&old.stage==='bear-spell')message='Creature enters';else if(action==='attack-bears'&&state.stage==='attacking')message='Attack!';
  if(message){const banner=$('#play-announcement');banner.textContent=message;animations.push(banner.animate([{opacity:0,transform:'translate(-50%,-30%) scale(.8)'},{opacity:1,transform:'translate(-50%,-50%) scale(1)',offset:.25},{opacity:1,offset:.75},{opacity:0,transform:'translate(-50%,-70%) scale(1)'}],{duration:1000}).finished.catch(()=>{}).then(()=>banner.textContent=''));}
  await Promise.all(animations);
 }
 function targetLine(){const path=$('#play-target-path'),board=$('.play-board');const source=state.stage==='target'?root.querySelector('[data-card-id="growth"]'):state.stack.length?root.querySelector('#play-stack [data-card-id="'+state.stack.at(-1).id+'"]'):state.yours.some(c=>c.blocking)?root.querySelector('[data-card-id="enemy-bears"]'):null;const target=state.yours.find(c=>c.blocking)?root.querySelector('[data-card-id="lion"]'):state.lesson==='response'?root.querySelector('#play-creatures [data-card-id="bears"]'):null;if(!source||!target){path.setAttribute('d','');return;}const b=board.getBoundingClientRect(),a=source.getBoundingClientRect(),z=target.getBoundingClientRect();const x=a.left+a.width/2-b.left,y=a.top+a.height/2-b.top,tx=z.left+z.width/2-b.left,ty=z.top+z.height/2-b.top;path.setAttribute('d','M '+x+' '+y+' Q '+((x+tx)/2+30)+' '+((y+ty)/2-30)+' '+tx+' '+ty);}
 $('.play-board').addEventListener('dragover',e=>{if(busy)return;e.preventDefault();e.dataTransfer.dropEffect='move';});
 $('.play-board').addEventListener('drop',e=>{e.preventDefault();$('.play-board').classList.remove('drag-active');const c=state.hand.find(c=>c.id===e.dataTransfer.getData('text/plain'));if(c){const a=primaryAction(c,'hand');if(a)act(a);}});
 $('#play-focus').addEventListener('click',()=>{const on=root.classList.toggle('play-focused');$('#play-focus').setAttribute('aria-pressed',String(on));$('#play-focus').textContent=on?'Exit expanded table':'Expand game table';requestAnimationFrame(targetLine);});
 root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#play-inspect').open&&root.classList.contains('play-focused'))$('#play-focus').click();});
 window.addEventListener('resize',targetLine);
 $('#play-lesson').addEventListener('change',()=>{if(busy)return;state=createPlayState($('#play-lesson').value);draw();});$('#play-reset').addEventListener('click',()=>{if(busy)return;state=createPlayState($('#play-lesson').value);draw();});draw();
`;
export const playScript='(function(){\n'+playEngineSource+'\n'+playClientSource+'\n})();';
