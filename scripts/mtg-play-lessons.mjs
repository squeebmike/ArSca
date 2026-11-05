import {fullGameSource} from './mtg-full-game.mjs';
export const playLessons=[
 {id:'first-turn',title:'1 · Lands, mana and your first attacker',goal:'Play a land, cast Grizzly Bears, then attack on your next turn.',refs:'106, 117, 302.6, 305, 500, 502–504, 508–510, 601, 608'},
 {id:'blocking',title:'2 · Block to survive',goal:'You have 2 life. Block an attacking 2/2 without tapping your blocker.',refs:'509, 510, 704.5a, 704.5g'},
 {id:'response',title:'3 · Save your creature with a response',goal:'Use Giant Growth before Lightning Bolt resolves, then finish the turn.',refs:'117, 405, 601, 608, 514.2, 704.5g'},
 {id:'full-game',title:'4 · Your first full game',goal:'Keep or mulligan, play both sides of the turn cycle, and win a 20-life teaching game.',refs:'103.5, 103.8a, 117, 302.6, 305, 500–514, 601, 608, 704'}
];

// Literal browser engine: tested with the same source in Node; never evaluated
// inside the Worker. This avoids bundler helpers leaking into served scripts.
export const playEngineSource=fullGameSource+String.raw`
 const cardData={'Colossal Dreadmaw':{type:'Creature — Dinosaur',cost:'{4}{G}{G}',manaValue:6,power:6,toughness:6,trample:true,text:'Trample: damage beyond lethal damage to blockers can reach the defending player.'},Mountain:{type:'Basic Land — Mountain',cost:'',text:'Tap: Add one red mana.'},'Runeclaw Bear':{type:'Creature — Bear',cost:'{1}{G}',power:2,toughness:2,text:'A 2/2 creature.'},'Goblin Piker':{type:'Creature — Goblin Warrior',cost:'{1}{R}',power:2,toughness:1,text:'A 2/1 creature.'},'Goblin Assailant':{type:'Creature — Goblin Warrior',cost:'{1}{R}',power:2,toughness:2,text:'A 2/2 creature.'},Forest:{type:'Basic Land — Forest',cost:'',text:'Tap: Add one green mana.'},'Grizzly Bears':{type:'Creature — Bear',cost:'{1}{G}',power:2,toughness:2,text:'A 2/2 creature.'},'Silvercoat Lion':{type:'Creature — Cat',cost:'{1}{W}',power:2,toughness:2,text:'A 2/2 creature.'},'Giant Growth':{type:'Instant',cost:'{G}',text:'Target creature gets +3/+3 until end of turn.'},'Lightning Bolt':{type:'Instant',cost:'{R}',text:'Deals 3 damage to any target.'}};
 function makeCard(name,id,extra={}){return {name,id,...cardData[name],tapped:false,damage:0,...extra};}
 function createPlayState(lesson){
  if(lesson==='full-game')return createFullGameState();
  if(!['first-turn','blocking','response'].includes(lesson))throw new Error('Unknown play lesson');
  const s={lesson,stage:'main',main:'pre',turn:1,phase:'Your precombat main phase',mana:0,yourLife:20,opponentLife:20,hand:[],yours:[],theirs:[],stack:[],yourGraveyard:[],theirGraveyard:[],landPlayed:false,selectedBlocker:false,blockTarget:null,complete:false,failed:false,feedback:'',log:[]};
  if(lesson==='first-turn'){s.hand=[makeCard('Forest','forest-b'),makeCard('Grizzly Bears','bears')];s.yours=[makeCard('Forest','forest-a')];s.feedback='You have priority in your main phase. Play a land from your hand, then select Grizzly Bears to cast it. Automatic payment can tap lands for you; switch it off to practice paying manually.';}
  if(lesson==='blocking'){s.stage='block';s.phase='Opponent’s declare blockers step';s.yourLife=2;s.yours=[makeCard('Silvercoat Lion','lion')];s.theirs=[makeCard('Grizzly Bears','enemy-bears',{tapped:true,attacking:true})];s.feedback='Select your Silvercoat Lion, then select the attacking Grizzly Bears to assign a block. Confirm your blockers when ready. Selecting or declaring a blocker does not tap it.';}
  if(lesson==='response'){s.stage='respond';s.phase='Opponent’s main phase · you have priority';s.yours=[makeCard('Forest','forest-a'),makeCard('Grizzly Bears','bears')];s.hand=[makeCard('Giant Growth','growth')];s.stack=[{id:'bolt',name:'Lightning Bolt',controller:'Opponent',target:'your Grizzly Bears'}];s.feedback='The opponent cast Lightning Bolt targeting your Bears, then passed priority to you: select Giant Growth, choose your creature as its target, then pay. Or pass to see what happens without a response.';}
  return s;
 }
 function playAction(state,action){
  if(state.lesson==='full-game')return fullGameAction(state,action);
  const s=JSON.parse(JSON.stringify(state));
  function say(text){s.feedback=text;return s;}
  function record(text){s.log.push(text);s.feedback=text;return s;}
  if(s.complete||s.failed)return say('Restart or choose another lesson to play again.');
  if(action.startsWith('tap:')){
   const land=s.yours.find(c=>c.id===action.slice(4)&&c.name==='Forest');
   if(!land)return say('Choose one of your Forests.');
   if(land.tapped)return say('This Forest is already tapped. It cannot pay its tap cost again until it untaps.');
   if(!['main','next-main','new-creature','post-main','respond','pay-bears','pay-growth','begin-combat','attacking','opponent-blockers','block-priority','upkeep','draw','cleanup'].includes(s.stage))return say('Finish the current selection or priority step first.');
   land.tapped=true;s.mana++;return record('Tap Forest: add {G}. This mana ability resolves immediately without using the stack. Your mana pool contains '+s.mana+' green.');
  }
  if(action==='cancel-cast'&&['pay-bears','pay-growth','target'].includes(s.stage)){s.stage=s.castFrom||'respond';s.castFrom=null;return say('Cast cancelled. The card is still in your hand. Any lands you manually tapped stay tapped, and their mana remains in your pool for this step or phase.');}
  if(action==='pay-auto'||action==='pay-mana'){
   if(!['pay-bears','pay-growth'].includes(s.stage))return say('Select a spell and any required target before paying.');
   const bears=s.stage==='pay-bears',cost=bears?2:1,need=Math.max(0,cost-s.mana),lands=s.yours.filter(c=>c.name==='Forest'&&!c.tapped);
   if(s.mana<cost&&(action!=='pay-auto'||lands.length<need))return say('Not enough mana in your pool. '+(bears?'Grizzly Bears needs {1}{G}.':'Giant Growth needs {G}.')+' Tap the required untapped Forests or enable automatic payment. Nothing has been spent.');
   if(action==='pay-auto'&&need){lands.slice(0,need).forEach(c=>c.tapped=true);s.mana+=need;}
   s.mana-=cost;const name=bears?'Grizzly Bears':'Giant Growth',id=bears?'bears':'growth';s.hand=s.hand.filter(c=>c.id!==id);s.stack.push({id,name,controller:'You',target:bears?'':'your Grizzly Bears'});s.stage=bears?'bear-spell':'growth-stack';s.castFrom=null;
   return record((need&&action==='pay-auto'?'Automatic payment tapped '+need+' Forest'+(need===1?'':'s')+'. ':'')+'You pay '+(bears?'{1}{G}':'{G}')+' and cast '+name+'. It is on the stack. '+(bears?'It is not on the battlefield yet.':'Its target is your Grizzly Bears.')+' Players get priority after casting is finished.');
  }
  if(s.lesson==='first-turn'){
   if(action==='play-forest'){
    if(!['main','next-main','new-creature','post-main'].includes(s.stage)||s.stack.length)return say('Play a land in your main phase with priority and an empty stack.');
    if(s.landPlayed)return say('You have already played a land this turn.');
    const i=s.hand.findIndex(c=>c.name==='Forest');if(i<0)return say('There is no Forest in your hand.');
    s.yours.push(s.hand.splice(i,1)[0]);s.landPlayed=true;return record('Forest enters untapped. A land play is a special action: it does not use the stack and cannot itself be responded to.');
   }
   if(action==='cast-bears'){
    if(!['main','next-main','new-creature','post-main'].includes(s.stage)||s.stack.length||!s.hand.some(c=>c.id==='bears'))return say('Cast this creature from your hand in your main phase with an empty stack.');
    if(s.mana+s.yours.filter(c=>c.name==='Forest'&&!c.tapped).length<2)return say('You cannot pay {1}{G} yet. Play your Forest to make two mana sources available.');
    s.castFrom=s.stage;s.stage='pay-bears';return say('Casting Grizzly Bears: pay {1}{G}. Green can pay the generic {1} too. Confirm automatic payment or click lands to add mana before paying.');
   }
   if(action==='pass'&&s.stage==='bear-spell'){s.stack=[];s.yours.push(makeCard('Grizzly Bears','bears',{sick:true}));s.stage='new-creature';return record('Both players pass. Grizzly Bears resolves and enters your battlefield. You have not controlled it since your turn began, so it cannot attack this turn without haste.');}
   if(action==='combat'&&['main','new-creature','next-main'].includes(s.stage)&&s.main==='pre'){s.mana=0;s.stage='begin-combat';s.phase='Beginning of combat · you have priority';return record('Your main phase ends; unspent mana empties. Beginning of combat is a priority window before attackers are declared. In this scenario the opponent has no responses.');}
   if(action==='pass'&&s.stage==='begin-combat'){s.stage='attack';s.phase='Declare attackers · choose attackers';return record('Both players pass. Choose your attackers, then confirm them together. Selecting a creature in the interface does not tap it yet.');}
   if(action==='attack-bears'){
    const c=s.yours.find(c=>c.id==='bears');if(!c)return say('Your creature must resolve before it can attack.');
    if(c.sick)return say('Summoning sickness: you have not controlled this creature since your turn began. It cannot attack this turn without haste.');
    if(s.stage!=='attack')return say('Advance to the declare attackers step first.');
    if(c.tapped)return say('A tapped creature cannot attack.');
    c.selectedAttack=!c.selectedAttack;return say(c.selectedAttack?'Grizzly Bears selected. Confirm 1 Attacker to declare the attack. It has not tapped yet.':'Grizzly Bears deselected. You can select it again or declare no attackers.');
   }
   if(action==='confirm-attacks'&&s.stage==='attack'){
    const c=s.yours.find(c=>c.selectedAttack);
    if(!c){s.stage='post-main';s.main='post';s.phase='Your postcombat main phase';return record('You declare no attackers. Combat ends with no combat damage. You are in your second main phase. You can end the turn and try attacking on a later turn.');}
    c.selectedAttack=false;c.tapped=true;c.attacking=true;s.stage='attacking';s.phase='Declare attackers · you have priority';return record('You declare Grizzly Bears attacking the opponent. It taps because it does not have vigilance. Players get priority before the opponent declares blockers.');
   }
   if(action==='pass'&&s.stage==='attacking'){s.stage='opponent-blockers';s.phase='Declare blockers · you have priority';return record('Both players pass. The scripted opponent declares no blockers. Players get priority again before combat damage.');}
   if(action==='pass'&&s.stage==='opponent-blockers'){s.opponentLife-=2;s.phase='Combat damage';s.stage='done';s.complete=true;return record('Both players pass. Your unblocked Grizzly Bears deals 2 combat damage to the opponent. Opponent: 18 life. Lesson complete.');}
   if(action==='end-turn'&&['main','new-creature','next-main','post-main'].includes(s.stage)){s.mana=0;s.stage='opponent-turn';s.phase='Opponent’s turn';return record('You pass through the remaining empty steps and end your turn. The scripted opponent takes a turn with no relevant actions. Your next turn has not started yet.');}
   if(action==='pass'&&s.stage==='opponent-turn'){s.turn++;s.mana=0;s.landPlayed=false;s.main='pre';s.yours.forEach(c=>{c.tapped=false;c.sick=false;c.attacking=false;});s.stage='untap';s.phase='Your untap step';return record('Your turn begins. Untap your permanents. Grizzly Bears has been under your control since this turn began. No player receives priority during the untap step.');}
   if(action==='advance-upkeep'&&s.stage==='untap'){s.stage='upkeep';s.phase='Your upkeep · you have priority';return record('Upkeep follows untap. Players can cast instants or activate abilities when they have priority here. This scenario has no upkeep triggers or responses.');}
   if(action==='pass'&&s.stage==='upkeep'){s.hand.push(makeCard('Forest','forest-draw-'+s.turn));s.stage='draw';s.phase='Your draw step · you have priority';return record('Both players pass. Your draw step begins and you draw the scripted Forest as a turn-based action. Players receive priority after that draw, not before the card is drawn within this step.');}
   if(action==='pass'&&s.stage==='draw'){s.stage='next-main';s.phase='Your precombat main phase';return record('Both players pass. Your first main phase begins. You may play a land, cast spells with the right timing, or move to combat.');}
  }
  if(s.lesson==='blocking'){
   if(action==='block-lion'&&s.stage==='block'){s.selectedBlocker=!s.selectedBlocker;s.blockTarget=null;return say(s.selectedBlocker?'Silvercoat Lion selected. Now select the attacking Grizzly Bears to assign it a blocker.':'Blocker selection cleared. Nothing has been declared yet.');}
   if(action==='assign-block'&&s.stage==='block'){if(!s.selectedBlocker)return say('Select your untapped Silvercoat Lion first, then the attacker it will block.');s.blockTarget=s.blockTarget?null:'enemy-bears';return say(s.blockTarget?'Block assigned. Confirm 1 Blocker to declare it. Silvercoat Lion is still untapped.':'Block assignment cleared.');}
   if(action==='confirm-blocks'&&s.stage==='block'){s.stage='block-priority';s.phase='Declare blockers · you have priority';if(s.blockTarget){s.yours[0].blocking=true;return record('You declare Silvercoat Lion blocking Grizzly Bears. The Lion stays untapped. The active opponent gets priority and passes to you before combat damage.');}return record('You declare no blockers. The attack is unblocked. The active opponent gets priority and passes to you before combat damage; your choice has not dealt damage yet.');}
   if(action==='pass'&&s.stage==='block-priority'){s.phase='Combat damage';s.stage='done';if(!s.yours[0].blocking){s.yourLife=0;s.failed=true;return record('Both players pass. Grizzly Bears deals 2 combat damage to you. At 0 life you lose as a state-based action. Restart to try assigning a block.');}s.yourGraveyard.push('Silvercoat Lion');s.theirGraveyard.push('Grizzly Bears');s.yours=[];s.theirs=[];s.complete=true;return record('Both players pass. The creatures deal 2 damage to each other simultaneously. Both are destroyed for lethal damage. You stay at 2 life. Lesson complete.');}
  }
  if(s.lesson==='response'){
   if(action==='choose-growth'&&s.stage==='respond'){s.castFrom='respond';s.stage='target';return say('Casting Giant Growth: select a creature as its target. Targets are chosen before costs are paid. You are in the casting process; the opponent does not get priority in the middle of it.');}
   if(action==='target-player'&&s.stage==='target')return say('Giant Growth requires a creature target. A player is not legal. Select your Grizzly Bears. No card or mana has been spent.');
   if(action==='target-bears'&&s.stage==='target'){s.stage='pay-growth';return say('Target chosen: your Grizzly Bears. Pay {G} to finish casting. The card and mana have not been spent yet.');}
   if(action==='pass'&&s.stage==='respond'){s.stack=[];s.yourGraveyard.push('Grizzly Bears');s.theirGraveyard.push('Lightning Bolt');s.yours=s.yours.filter(c=>c.id!=='bears');s.failed=true;s.stage='lost';return record('You pass and the opponent passes. Lightning Bolt resolves, dealing 3 to your 2/2. State-based actions destroy it. Respond before the spell resolves to save it.');}
   if(action==='pass'&&s.stage==='growth-stack'){s.stack.pop();s.yourGraveyard.push('Giant Growth');const c=s.yours.find(c=>c.id==='bears');c.power=5;c.toughness=5;c.pumped=true;s.stage='bolt-stack';return record('Both players pass. Giant Growth resolves first, making Bears 5/5. Lightning Bolt stays on the stack. The active opponent gets priority after resolution and passes to you. There is another response window before Bolt can resolve.');}
   if(action==='pass'&&s.stage==='bolt-stack'){s.stack=[];s.theirGraveyard.push('Lightning Bolt');s.yours.find(c=>c.id==='bears').damage=3;s.stage='cleanup';return record('Both players pass again. Lightning Bolt deals 3 damage to the 5/5 Bears. Damage is marked, not subtracted from toughness. Your creature survives. The active opponent gets priority and passes to you.');}
   if(action==='cleanup'&&s.stage==='cleanup'){const c=s.yours.find(c=>c.id==='bears');c.power=2;c.toughness=2;c.damage=0;c.pumped=false;s.mana=0;s.phase='Cleanup step';s.complete=true;s.stage='done';return record('You pass. The scripted opponent takes no further actions and ends its turn. In cleanup, damage is removed and the until-end-of-turn boost ends simultaneously. Bears is 2/2 with no damage. Lesson complete.');}
  }
  return say('Finish the current choice or use the phase and priority control.');
 }
 function playView(s,autoPay=true){
  if(s.lesson==='full-game')return fullGameView(s,autoPay);
  const v={prompt:'You have priority',primary:null,secondary:[],hint:'Choose a card or advance the turn.',tabletop:'Say what you are doing and give your opponent a chance to respond when they have priority.',priority:true};
  const control=(text,action)=>({text,action});
  if(s.complete||s.failed){v.prompt=s.complete?'Lesson complete':'Try another decision';v.hint=s.complete?'You used the same choices you will make in a real game.':'Restart to explore a different choice.';v.priority=false;return v;}
  if(['main','new-creature','next-main','post-main'].includes(s.stage)){
   v.primary=control(s.main==='post'?'End Turn':'Next · Combat',s.main==='post'?'end-turn':'combat');if(s.main!=='post')v.secondary.push(control('End Turn','end-turn'));
   v.hint=s.hand.some(c=>c.id==='bears')?(s.landPlayed?'Select Grizzly Bears in your hand.':'Play your Forest, then select Grizzly Bears.'):s.yours.some(c=>c.sick)?'Your new creature cannot attack yet. You can advance to combat to test this, or end the turn.':'Select Next to move into combat.';
   v.tabletop='Play a land by putting it onto the battlefield. To move on, say “Combat?” or “End my turn” and let your opponent respond at the appropriate priority windows.';
  }
  if(s.stage.startsWith('pay-')){const cost=s.stage==='pay-bears'?'{1}{G}':'{G}';v.prompt='Pay '+cost;v.primary=control(autoPay?'Auto Pay':'Pay',autoPay?'pay-auto':'pay-mana');v.secondary=[control('Cancel','cancel-cast')];v.hint=autoPay?'Review the mana cost, then confirm. Only the required Forests will tap.':'Click your Forests to add mana, then confirm payment.';v.priority=false;v.tabletop='Announce the spell and any targets, tap lands for mana, and pay the cost. No one gets priority in the middle of casting a spell.';}
  if(s.stage==='target'){v.prompt='Choose a creature target';v.secondary=[control('Cancel','cancel-cast')];v.priority=false;v.hint='Select your Grizzly Bears on the battlefield.';v.tabletop='Say “Giant Growth targeting my Bears.” Choose the target before paying the mana cost.';}
  if(s.stage==='begin-combat'){v.prompt='Beginning of combat · priority';v.primary=control('Next · Attackers','pass');v.hint='Both players must pass before attackers are chosen.';v.tabletop='Say “Beginning of combat—any actions?” This is before you declare attackers.';}
  if(s.stage==='attack'){const n=s.yours.filter(c=>c.selectedAttack).length;v.prompt='Choose attackers';v.primary=control(n?'1 Attacker':'No Attacks','confirm-attacks');v.priority=false;v.hint=n?'Confirm your attacker, or select it again to deselect.':'Select an untapped creature that can attack, then confirm.';v.tabletop='Decide all attackers together. When you declare them, tap attackers without vigilance. You attack players, planeswalkers, or battles—not their creatures.';}
  if(s.stage==='attacking'){v.prompt='Attackers declared · priority';v.primary=control('Next · Blockers','pass');v.hint='The attack is declared. There is a response window before blockers.';}
  if(s.stage==='opponent-blockers'){v.prompt='No blockers · priority';v.primary=control('Next · Damage','pass');v.hint='The opponent chose no blockers. Pass priority to reach damage.';}
  if(s.stage==='block'){v.prompt=s.selectedBlocker&&!s.blockTarget?'Select an attacker to block':'Choose blockers';v.primary=control(s.blockTarget?'1 Blocker':'No Blocks','confirm-blocks');v.priority=false;v.hint=s.blockTarget?'Confirm the assigned block or select your Lion to clear it.':s.selectedBlocker?'Select the attacking Grizzly Bears.':'Select your Lion, then the attacker it will block.';v.tabletop='Point to your blocker and the attacker it blocks. Declare all blockers together. Blocking does not tap your creature.';}
  if(s.stage==='block-priority'){v.prompt='Blockers declared · priority';v.primary=control('Next · Damage','pass');v.hint='This is the last response window before normal combat damage.';}
  if(['bear-spell','respond','growth-stack','bolt-stack'].includes(s.stage)){v.prompt='You have priority';v.primary=control(s.stage==='respond'?'Pass':'Resolve','pass');v.hint=s.stage==='respond'?'Cast Giant Growth now, or pass and let Bolt resolve.':'Passing here lets the scripted opponent pass too; only the top object resolves.';v.tabletop='Say “In response…” to cast an instant, or “Pass / resolves” to pass priority. One object resolves only after every player passes in succession.';}
  if(s.stage==='opponent-turn'){v.priority=false;v.prompt='Opponent’s turn · scripted passes';v.primary=control('Next · Your Turn','pass');v.hint='The opponent takes no relevant actions in this teaching scenario.';}
  if(s.stage==='untap'){v.prompt='Untap · no priority';v.primary=control('Next · Upkeep','advance-upkeep');v.priority=false;v.hint='Untap happens before upkeep. No spells can be cast during this untap step.';v.tabletop='Straighten your tapped cards first. Neither player gets priority during untap.';}
  if(s.stage==='upkeep'){v.prompt='Upkeep · you have priority';v.primary=control('Next · Draw','pass');v.hint='There are no upkeep triggers here. Passing moves to the draw step.';}
  if(s.stage==='draw'){v.prompt='Draw step · you have priority';v.primary=control('Next · Main','pass');v.hint='You have already drawn for this turn. Pass to enter your main phase.';}
  if(s.stage==='cleanup'){v.prompt='You have priority';v.primary=control('Pass Turn','cleanup');v.hint='Pass priority through the rest of the opponent’s turn to see the temporary boost and marked damage wear off together.';v.tabletop='You cannot end the opponent’s turn for them. Pass priority; in this scenario they take no further actions. Keep damage and temporary effects until cleanup. Do not lower the printed toughness to track damage.';}
  return v;
 }

`;

export function playLessonHtml(){return `<section class="learn-panel" id="play-table" aria-labelledby="play-title"><header class="play-heading"><div><p class="learn-kicker">LEARN BY PLAYING</p><h2 id="play-title">Your first match starts here.</h2><p>Learn a short interaction or play a full 20-life game, from your opening hand to a result. Scripted teaching decks and opponent decisions.</p></div><button type="button" id="play-focus" aria-pressed="false">Expand game table</button></header><div class="play-setup"><label for="play-lesson">Playing lesson<select id="play-lesson">${playLessons.map(l=>`<option value="${l.id}">${l.title}</option>`).join('')}</select></label><label class="play-auto-setting"><input type="checkbox" id="play-auto-pay" checked> Automatic mana payment</label><p id="play-progress" role="status"></p><button type="button" id="play-reset">Restart this lesson</button></div><p id="play-match-status" class="learn-note" hidden></p><div class="play-game"><div class="play-board"><div class="play-toolbar"><strong id="play-phase"></strong><div class="play-phases" aria-label="Turn phases"><span data-phase="beginning">Beginning</span><span data-phase="main1">Main 1</span><span data-phase="combat">Combat</span><span data-phase="main2">Main 2</span><span data-phase="ending">Ending</span></div></div><div id="play-table-cue" aria-hidden="true"></div><div class="play-player opponent"><button type="button" class="play-avatar" id="play-opponent" aria-label="Opponent player">◆</button><div><strong>Practice opponent</strong><small>Scripted opponent · learn at your pace</small></div><strong id="play-life-opponent" class="play-life" aria-label="Opponent life"></strong><div id="play-their-graveyard" class="play-grave" aria-label="Opponent graveyard"></div></div><section class="play-opponent-field"><h3>Opponent battlefield</h3><div id="play-enemy" class="play-cards" aria-label="Opponent battlefield"></div></section><section class="play-combat"><h3>Combat lane</h3><div class="play-combat-row"><div id="play-combat-enemy" class="play-cards" aria-label="Attacking opponent creatures"></div><div id="play-combat-yours" class="play-cards" aria-label="Your creatures in combat"></div></div><p id="play-combat-hint"></p></section><section id="play-yours" class="play-your-field"><h3>Your battlefield</h3><div id="play-creatures" class="play-cards" aria-label="Your creatures"></div><div class="play-land-line"><span>Lands</span><div id="play-lands" class="play-cards" aria-label="Your lands"></div></div></section><section class="play-stack"><h3>Spell stack <span id="play-stack-count"></span></h3><ol id="play-stack" aria-label="Spell stack, top first"></ol></section><div class="play-player you"><span class="play-avatar" aria-hidden="true">✦</span><div><strong>You</strong><small id="play-mana"></small></div><strong id="play-life-you" class="play-life" aria-label="Your life"></strong><div id="play-your-graveyard" class="play-grave" aria-label="Your graveyard"></div></div><section class="play-hand"><h3>Your hand <span>Select a card to cast it · or drag it onto the battlefield</span></h3><div id="play-hand" class="play-cards" aria-label="Your hand"></div></section><section class="play-controls" aria-labelledby="play-prompt"><p id="play-priority"></p><h3 id="play-prompt" tabindex="-1"></h3><div id="play-actions" class="practice-actions"></div><p class="play-shortcut">Space: advance the main action</p></section><svg class="play-targets" aria-hidden="true"><defs><marker id="play-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#f5bd72"/></marker></defs><path id="play-target-path" marker-end="url(#play-arrow)"/></svg><div id="play-announcement" aria-hidden="true"></div></div><aside class="play-coach" aria-labelledby="play-coach-title"><p class="learn-kicker">YOUR COACH</p><h3 id="play-coach-title" tabindex="-1">Your move</h3><p id="play-goal"></p><div id="play-next-move"></div><p id="play-feedback" role="status" aria-live="polite"></p><details class="play-paper" open><summary>With physical cards</summary><p id="play-tabletop"></p></details><details><summary>Moving to Arena</summary><p class="learn-note">Arena lets you select attackers and assign blockers through the cards themselves, and offers automatic mana payment. Here you can turn automatic payment off to practice tapping your lands. These teaching games pause at each response window so you can learn the timing.</p><a class="learn-note" href="https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28" target="_blank" rel="noopener">Arena controls from Wizards</a></details><details><summary>Match log</summary><ol id="play-log"></ol></details><p class="learn-note" id="play-refs"></p></aside></div><p class="learn-note play-credit">Card images and Oracle data: <a href="https://scryfall.com" target="_blank" rel="noopener">Scryfall</a>. Magic: The Gathering card images © Wizards of the Coast. Use a card’s ⤢ button to inspect it. No account or AI requests needed to play.</p><dialog id="play-inspect" aria-labelledby="play-inspect-title"><h3 id="play-inspect-title"></h3><div id="play-inspect-content"></div><form method="dialog"><button>Back to the table</button></form></dialog></section><script type="application/json" id="play-lesson-data">${JSON.stringify(playLessons)}</script>`;}

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
#mtg-academy .play-board{position:relative;isolation:isolate;display:grid;grid-template-columns:minmax(0,1fr) 145px;grid-template-areas:'turn turn' 'opponent opponent' 'enemy stack' 'combat stack' 'field stack' 'you controls' 'hand controls';border:1px solid #927b51;border-radius:18px;overflow:hidden;background:radial-gradient(ellipse at 50% 38%,#315453 0,#152f36 52%,#0b1625 100%);box-shadow:inset 0 0 65px #0008,0 14px 35px #0005;color:#f9f1df;min-width:0}
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
#mtg-academy .play-hand .play-cards{gap:8px;align-items:flex-end;flex-wrap:nowrap;justify-content:flex-start;overflow-x:auto;padding:6px 4px 12px}#mtg-academy .play-opponent-field .play-card.land{width:55px;flex-basis:55px}#mtg-academy #play-match-status{font-size:12px;line-height:1.5;margin:8px 0}
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
#mtg-academy .play-focused #play-progress{display:none}#mtg-academy .play-focused .play-board{overflow:clip}#mtg-academy .play-focused .play-controls{position:sticky;bottom:8px;align-self:end;z-index:4;box-shadow:0 0 20px #0008}
@media(max-width:650px){#mtg-academy .play-board{grid-template-areas:'turn turn' 'cue cue' 'opponent opponent' 'enemy stack' 'combat stack' 'field stack' 'you controls' 'hand controls'}#mtg-academy #play-table-cue{display:block;grid-area:cue;background:#244e40;color:#d5f8e1;font-size:11px;line-height:1.5;padding:8px 10px;border-bottom:1px solid #9edac133}#mtg-academy .play-focused .play-setup{flex-wrap:nowrap}#mtg-academy .play-focused .play-setup label{flex:1 1 0;min-width:0}#mtg-academy .play-focused .play-setup button{flex:0 0 70px}#mtg-academy .play-focused .play-heading h2{font-size:17px}}
#mtg-academy .play-controls{grid-area:controls;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;padding:14px 10px 20px;background:linear-gradient(#091826,#07111d);border-left:1px solid #bfa05b55;z-index:6;min-width:0}
#mtg-academy #play-priority{font-size:9px;letter-spacing:1.5px;text-align:center;color:#b6e2ce!important;margin:0}
#mtg-academy #play-prompt{font-size:12px;line-height:1.5;text-align:center;text-transform:none;letter-spacing:0;color:#f5e6c6;margin:0 0 5px}
#mtg-academy .play-controls .practice-actions{display:flex;flex-direction:column;gap:8px}
#mtg-academy .play-controls .play-primary{width:100%;border-radius:30px;border:1px solid #e8c38a!important;background:linear-gradient(#e5b665,#ad7735)!important;color:#171c22!important;font-weight:800;font-size:14px;padding:14px 7px;box-shadow:0 0 18px #d6a14933}
#mtg-academy .play-controls .play-secondary{background:transparent!important;color:#d4dace!important;border:1px solid #586b70!important;font-size:11px;padding:7px}
#mtg-academy .play-shortcut{font-size:9px;line-height:1.4!important;text-align:center;color:#abb8bb!important;margin:0}
#mtg-academy .play-auto-setting{display:flex;align-items:center;gap:7px;font-size:12px;flex:0 0 190px;max-width:none!important}
#mtg-academy .play-auto-setting input{display:inline;width:16px;height:16px;accent-color:#d0a65e;margin:0}
#mtg-academy .play-card.is-playable .play-art{border-color:#85bed9!important;box-shadow:0 0 8px #73b8d644}
#mtg-academy .play-card.selected .play-art{outline:3px solid #f5bc71;outline-offset:3px;box-shadow:0 0 18px #f3b65c66}
#mtg-academy .play-card.is-target .play-art,#mtg-academy .play-card.assigned .play-art{outline:2px solid #8bdce2;outline-offset:3px;box-shadow:0 0 20px #80d0e355}
#mtg-academy .play-card.will-pay .play-art{outline:2px dashed #e7bd77;outline-offset:3px}
#mtg-academy .play-player.has-priority .play-avatar{box-shadow:0 0 16px #92d7db88;border-color:#96d8db}
#mtg-academy .play-paper summary{font-size:12px}#mtg-academy #play-tabletop{font-size:12px;line-height:1.6;border-left:2px solid #bca478;padding-left:10px}
#mtg-academy .play-board{grid-template-columns:minmax(0,1fr) 185px;background:radial-gradient(ellipse at 50% 45%,#334c55 0,#172b3a 50%,#101b2b 100%)}
#mtg-academy .play-hand .play-card{width:124px;flex-basis:124px}
#mtg-academy .play-card .play-pt{bottom:29px}
#mtg-academy .play-grave .play-card{width:27px;flex-basis:27px}
#mtg-academy .play-hand{min-height:200px}
#mtg-academy .play-phases{flex-wrap:wrap}
#mtg-academy .play-hand .play-art{cursor:grab}
@media(max-width:900px){#mtg-academy .play-board{grid-template-columns:minmax(0,1fr) 140px}#mtg-academy .play-auto-setting{flex:0 1 155px;font-size:11px}#mtg-academy .play-hand .play-card{width:100px;flex-basis:100px}}
@media(max-width:650px){#mtg-academy .play-board{grid-template-columns:minmax(0,1fr) 88px;grid-template-areas:'turn turn' 'cue cue' 'opponent opponent' 'enemy stack' 'combat stack' 'field stack' 'you you' 'hand hand' 'controls controls'}#mtg-academy .play-controls{position:sticky;bottom:0;padding:10px;background:#0e1c29;display:grid;grid-template-columns:1fr 1.4fr;align-items:center;border:1px solid #bfa05b55;border-radius:10px}#mtg-academy #play-priority{grid-column:1}#mtg-academy #play-prompt{grid-column:1;grid-row:2}#mtg-academy .play-controls .practice-actions{grid-column:2;grid-row:1/3}#mtg-academy .play-shortcut{display:none}#mtg-academy .play-controls .play-primary{font-size:13px;padding:11px 6px}#mtg-academy .play-setup .play-auto-setting{flex:1 0 100%;font-size:12px}#mtg-academy .play-focused .play-setup{flex-wrap:wrap}#mtg-academy .play-focused .play-setup label:first-child{flex:1 0 100%}#mtg-academy .play-hand .play-card{width:94px;flex-basis:94px}#mtg-academy .play-hand{min-height:164px}#mtg-academy .play-phases span{padding:3px 5px}#mtg-academy .play-grave .play-card{width:20px;flex-basis:20px}}
#mtg-academy .play-card[data-zone="hand"]:not(.is-playable):not(.casting) .play-art{filter:brightness(.68)}
#mtg-academy .play-card.casting .play-art{outline:2px solid #edc68a;outline-offset:4px;box-shadow:0 0 22px #e5b56866}
#mtg-academy .play-focused .play-auto-setting{margin-left:auto}
@media(prefers-reduced-motion:reduce){#mtg-academy .play-art,#mtg-academy .play-card{transition:none}#mtg-academy .play-hand .play-card:hover{transform:none}}
#mtg-academy .play-pregame .play-board{grid-template-areas:'turn turn' 'opponent opponent' 'hand hand' 'you controls'}#mtg-academy .play-pregame :is(.play-opponent-field,.play-combat,.play-your-field,.play-stack){display:none}#mtg-academy .play-pregame .play-hand{padding:24px 14px;min-height:230px}@media(max-width:650px){#mtg-academy .play-pregame .play-board{grid-template-columns:minmax(0,1fr);grid-template-areas:'turn' 'cue' 'opponent' 'hand' 'you' 'controls'}#mtg-academy .play-pregame .play-hand{padding:14px 8px;min-height:190px}}

`;

const playClientSource=String.raw`
 const root=document.querySelector('#play-table');if(!root)return;
 const $=s=>root.querySelector(s);let data=[];try{data=JSON.parse(document.querySelector('#play-lesson-data').textContent);}catch{return;}
 const savedKey='mp-mtg-play-v1';let completed=[];try{const v=JSON.parse(localStorage.getItem(savedKey)||'[]');if(Array.isArray(v))completed=v.filter(id=>data.some(l=>l.id===id));}catch{}
 const requestedGame=new URLSearchParams(location.search).get('play');if(data.some(l=>l.id===requestedGame))$('#play-lesson').value=requestedGame;
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
  const frame=node('button','');frame.type='button';frame.className='play-art';frame.setAttribute('aria-label',cardLabel(c,zone));frame.setAttribute('aria-pressed',String(!!(c.selectedBottom||state.lesson==='full-game'&&state.selectedBlocker===c.id||c.selectedAttack||c.id==='lion'&&state.selectedBlocker||c.id==='enemy-bears'&&state.blockTarget)));const action=primaryAction(c,zone);if(action)frame.dataset.action=action;
  const placeholder=node('span',c.name);placeholder.className='play-art-placeholder';frame.append(placeholder);
  let detail=null;
  cardArt(c.name).then(card=>{detail=card;const face=card?.faces?.[0];if(!face?.image)return;const img=document.createElement('img');img.alt=c.name+' card';img.width=488;img.height=680;img.decoding='async';img.addEventListener('load',()=>placeholder.hidden=true);img.addEventListener('error',()=>img.remove());img.src=face.image;frame.append(img);});
  function inspect(){const dialog=$('#play-inspect');$('#play-inspect-title').textContent=c.name;const body=$('#play-inspect-content');body.replaceChildren();const face=detail?.faces?.[0];if(face?.image){const img=document.createElement('img');img.src=face.image;img.alt=c.name;body.append(img);}body.append(node('p',face?.text||c.text||cardData[c.name]?.text||''));if(detail?.url){const link=node('a','View card and rulings on Scryfall');link.href=detail.url;link.target='_blank';link.rel='noopener';body.append(link);}dialog.showModal();}
  frame.addEventListener('click',()=>{const action=primaryAction(c,zone);if(action)act(action);else inspect();});frame.inspectCard=inspect;return frame;
 }
 function drawCard(c,zone){const e=node('article','');e.className='play-card'+(c.type?.includes('Land')?' land':'')+(c.tapped?' tapped':'')+(c.attacking?' attacking':'')+(c.blocking?' blocking':'')+(c.selectedBottom||state.lesson==='full-game'&&state.selectedBlocker===c.id||c.selectedAttack||c.id==='lion'&&state.selectedBlocker?' selected':'')+(c.id==='enemy-bears'&&state.blockTarget?' assigned':'');e.dataset.cardId=c.id;e.dataset.zone=zone;const image=art(c,zone);e.append(image,node('strong',c.name),node('small',c.cost||'Land'),node('small',c.type),node('small',c.text));const badges=[!['yours','theirs'].includes(zone)?'':c.tapped?'Tapped':'Untapped',c.sick?'Summoning sickness':'',c.attacking?'Attacking':'',c.blocking?'Blocking':'',c.pumped?'+3/+3 until end of turn':'',c.damage?c.damage+' damage marked':''].filter(Boolean);e.append(node('span',c.selectedBottom?'Bottom '+(state.bottomOrder.indexOf(c.id)+1):c.damage?c.damage+' damage':c.blocking?'Blocking':c.id==='enemy-bears'&&state.blockTarget?'Block assigned':c.selectedAttack?'Selected attacker':c.id==='lion'&&state.selectedBlocker?'Selected blocker':c.attacking?'Attacking':c.sick?'Summoning sickness':c.pumped?'+3/+3 this turn':badges[0]||''));e.lastChild.className='play-badge';e.lastChild.title=badges.join(' · ');if(c.power!==undefined){const pt=node('span',c.power+'/'+c.toughness);pt.className='play-pt';e.append(pt);}
  const inspect=node('button','⤢');inspect.type='button';inspect.className='play-inspect-button';inspect.setAttribute('aria-label','Inspect '+c.name);inspect.addEventListener('click',()=>image.inspectCard());e.append(inspect);if(state.lesson==='full-game'&&primaryAction(c,zone)||zone==='hand'||zone==='yours'&&(state.stage==='attack'&&c.id==='bears'||state.stage==='block'&&c.id==='lion')){e.draggable=true;e.addEventListener('dragstart',event=>{if(busy){event.preventDefault();return;}event.dataTransfer.setData('text/plain',c.id);event.dataTransfer.effectAllowed='move';$('.play-board').classList.add('drag-active');});e.addEventListener('dragend',()=>$('.play-board').classList.remove('drag-active'));}return e;}
 function zone(selector,cards,kind){const container=$(selector);container.replaceChildren();cards.forEach(c=>container.append(drawCard(c,kind)));if(!cards.length&&!selector.includes('combat')){const empty=node('p',kind==='hand'?'Your hand is empty':selector==='#play-lands'?'No lands in this scenario':kind==='combat'?'':kind==='theirs'?'No opposing permanents':'Your creatures enter here');empty.className='play-empty';container.append(empty);}}
 function draw(){root.classList.toggle('play-pregame',state.lesson==='full-game'&&['opening','bottom'].includes(state.stage));const match=$('#play-match-status');match.hidden=state.lesson!=='full-game';if(!match.hidden)match.textContent='Turn '+state.turn+' · '+(state.active==='you'?'Your turn':'Opponent’s turn')+' · 40-card teaching decks · Scripted draws · Learned: '+(state.milestones.join(', ')||'opening decisions');const lesson=data.find(l=>l.id===state.lesson);$('#play-goal').textContent='Goal: '+lesson.goal;$('#play-phase').textContent=state.phase;$('#play-mana').textContent='Mana pool: '+state.mana+' green'+(state.lesson==='full-game'?' · Library '+state.library.length+' · Opponent hand '+state.opHand.length:'');$('#play-life-you').textContent=state.yourLife;$('#play-life-opponent').textContent=state.opponentLife;zone('#play-creatures',state.yours.filter(c=>c.name!=='Forest'&&!c.attacking&&!c.blocking),'yours');zone('#play-lands',state.yours.filter(c=>c.name==='Forest'),'yours');zone('#play-combat-yours',state.yours.filter(c=>c.attacking||c.blocking),'yours');zone('#play-combat-enemy',state.theirs.filter(c=>c.attacking),'theirs');zone('#play-enemy',state.theirs.filter(c=>!c.attacking),'theirs');zone('#play-hand',state.hand,'hand');grave('#play-your-graveyard',state.yourGraveyard,false);grave('#play-their-graveyard',state.theirGraveyard,true);$('#play-stack').replaceChildren();[...state.stack].reverse().forEach((c,i)=>{const li=node('li','');li.append(drawCard({...cardData[c.name],...c},'stack'),node('p',(i===0?'TOP · ':'')+c.controller+(c.target?' → '+([...state.yours,...state.theirs].find(x=>x.id===c.target)?.name||c.target):'')));$('#play-stack').append(li);});if(!state.stack.length){const empty=node('li','No spells waiting');empty.className='play-empty';$('#play-stack').append(empty);}$('#play-stack-count').textContent=state.stack.length?'· '+state.stack.length:'';$('#play-feedback').textContent=state.feedback;$('#play-log').replaceChildren();state.log.forEach(text=>$('#play-log').append(node('li',text)));$('#play-refs').textContent='Rule references for this lesson: '+lesson.refs+'. See the official rules links below.';
  const view=playView(state,$('#play-auto-pay').checked);
  $('#play-combat-hint').textContent=state.blockTarget?'Block assignment · confirm before damage':state.yours.some(c=>c.blocking)?'Blockers declared · response window':state.theirs.some(c=>c.attacking)?'Select a blocker, then the attacker':state.yours.some(c=>c.attacking)?'Attackers declared':state.stage==='attack'?'Select attackers · confirm together':'';
  const phase=state.phase.toLowerCase(),active=phase.includes('untap')||phase.includes('upkeep')||phase.includes('draw step')?'beginning':phase.includes('combat')&&!phase.includes('precombat')&&!phase.includes('postcombat')||phase.includes('attacker')||phase.includes('blocker')?'combat':phase.includes('cleanup')||phase.includes('end step')?'ending':state.main==='post'?'main2':'main1';
  root.querySelectorAll('[data-phase]').forEach(e=>e.classList.toggle('active',!['opponent-turn','opening','bottom'].includes(state.stage)&&e.dataset.phase===active));
  $('#play-prompt').textContent=view.prompt;$('#play-priority').textContent=view.priority?'PRIORITY · YOU':state.complete||state.failed?'SCENARIO FINISHED':'CHOICE IN PROGRESS';$('.play-player.you').classList.toggle('has-priority',view.priority);$('#play-tabletop').textContent=view.tabletop;
  const actions=$('#play-actions');actions.replaceChildren();if(view.primary){const main=button(view.primary.text,view.primary.action);main.className='play-primary';main.dataset.primary='true';actions.append(main);}view.secondary.forEach(a=>{const secondary=button(a.text,a.action);secondary.className='play-secondary';actions.append(secondary);});
  if(state.complete&&!completed.includes(state.lesson)){completed.push(state.lesson);try{localStorage.setItem(savedKey,JSON.stringify(completed));}catch{}}
  root.querySelectorAll('.play-card').forEach(e=>{const card=[...state.hand,...state.yours,...state.theirs].find(c=>c.id===e.dataset.cardId);if(!card)return;const action=primaryAction(card,e.dataset.zone);const total=state.mana+state.yours.filter(c=>c.name==='Forest'&&!c.tapped).length,legal=!!action&&!(action.startsWith('land:')&&state.landPlayed)&&!(action.startsWith('cast:')&&total<(card.name==='Giant Growth'?1:card.manaValue||2))&&!(action.startsWith('attack:')&&(card.sick||card.tapped))&&!(action.startsWith('blocker:')&&card.tapped)&&!(action==='play-forest'&&state.landPlayed)&&!(action==='cast-bears'&&total<2)&&!(action==='attack-bears'&&(card.sick||card.tapped))&&!(action.startsWith('tap:')&&card.tapped);e.classList.toggle('is-playable',legal);const target=state.lesson==='full-game'&&(state.stage==='game-target'&&['yours','theirs'].includes(e.dataset.zone)&&card.power!==undefined||state.stage==='game-block'&&state.selectedBlocker&&card.attacking)||state.stage==='target'&&card.id==='bears'||state.stage==='block'&&state.selectedBlocker&&card.id==='enemy-bears';e.classList.toggle('is-target',!!target);const required=Math.max(0,(state.pending?.cost||(state.stage==='pay-bears'?2:1))-state.mana),paymentLands=state.yours.filter(c=>c.name==='Forest'&&!c.tapped).slice(0,required);const pay=(state.stage.startsWith('pay-')||state.stage==='game-pay')&&$('#play-auto-pay').checked&&paymentLands.some(c=>c.id===card.id);e.classList.toggle('will-pay',pay);e.classList.toggle('casting',state.lesson==='full-game'&&state.pending?.id===card.id||card.id==='bears'&&state.stage==='pay-bears'||card.id==='growth'&&['target','pay-growth'].includes(state.stage));});$('#play-next-move').textContent=view.hint;$('#play-table-cue').textContent=view.prompt+' · '+view.hint;requestAnimationFrame(targetLine);
  $('#play-progress').textContent=completed.length+' of '+data.length+' guided lessons completed on this device.';
  if(state.complete){const i=data.findIndex(l=>l.id===state.lesson);if(i<data.length-1){const b=node('button','Play the next lesson');b.type='button';b.addEventListener('click',()=>{if(busy)return;$('#play-lesson').value=data[i+1].id;state=createPlayState(data[i+1].id);draw();});actions.append(b);}}
 }

 function primaryAction(c,zone){
  if(state.lesson==='full-game')return fullGameCardAction(state,c,zone);
  if(state.complete||state.failed)return null;
  if(zone==='hand'&&['main','next-main','new-creature','post-main'].includes(state.stage))return c.name==='Forest'?'play-forest':c.name==='Grizzly Bears'?'cast-bears':null;
  if(zone==='hand'&&c.name==='Giant Growth'&&state.stage==='respond')return 'choose-growth';
  if(zone==='theirs'&&state.stage==='block'&&c.attacking)return 'assign-block';
  if(zone==='yours'){
   if(c.name==='Forest'&&['main','next-main','new-creature','post-main','respond','pay-bears','pay-growth','begin-combat','attacking','opponent-blockers','block-priority','upkeep','draw','cleanup'].includes(state.stage))return 'tap:'+c.id;
   if(c.id==='bears'&&state.stage==='target')return 'target-bears';
   if(c.id==='bears'&&state.lesson==='first-turn'&&state.stage==='attack')return 'attack-bears';
   if(c.id==='lion'&&state.stage==='block')return 'block-lion';
  }return null;
 }
 function cardLabel(c,zone){if(state.lesson==='full-game'){const a=primaryAction(c,zone);return !a?'Inspect '+c.name:a.startsWith('bottom:')?(c.selectedBottom?'Deselect ':'Select ')+c.name+' for bottom':a.startsWith('discard:')?'Discard '+c.name:a.startsWith('land:')?'Play '+c.name:a.startsWith('cast:')?'Cast '+c.name:a.startsWith('target:')?'Target '+c.name:a.startsWith('tap:')?'Tap '+c.name+' for {G}':a.startsWith('attack:')?'Select '+c.name+' attacker':a.startsWith('blocker:')?'Select '+c.name+' blocker':'Block attacking '+c.name;}const a=primaryAction(c,zone);if(a?.startsWith('tap:'))return c.tapped?'Inspect tapped '+c.name:'Tap '+c.name+' for {G}';return {'play-forest':'Play Forest','cast-bears':'Cast Grizzly Bears','choose-growth':'Cast Giant Growth','target-bears':'Target Grizzly Bears','attack-bears':c.selectedAttack?'Deselect Grizzly Bears attacker':'Select Grizzly Bears attacker','block-lion':state.selectedBlocker?'Deselect Silvercoat Lion blocker':'Select Silvercoat Lion blocker','assign-block':'Assign block to attacking Grizzly Bears'}[a]||'Inspect '+c.name;}
 function grave(selector,names,enemy){const box=$(selector);box.replaceChildren();const label=node('span','Graveyard · '+names.length);label.className='play-grave-label';box.append(label);names.forEach(name=>{if(typeof name==='object'){box.append(drawCard(name,'grave'));return;}const id=name==='Lightning Bolt'?'bolt':name==='Giant Growth'?'growth':name==='Silvercoat Lion'?'lion':enemy?'enemy-bears':'bears';box.append(drawCard(makeCard(name,id),'grave'));});}
 function capture(){const map=new Map();root.querySelectorAll('[data-card-id]').forEach(e=>{if(e.dataset.cardId)map.set(e.dataset.cardId,{rect:e.querySelector('.play-art').getBoundingClientRect(),node:e.querySelector('.play-art').cloneNode(true),tapped:e.classList.contains('tapped'),zone:e.dataset.zone});});return map;}
 async function act(action){
  if(busy)return;busy=true;root.dataset.motion='playing';const before=capture(),old=state;state=playAction(state,action);draw();
  const controls=[...root.querySelectorAll('button,select,input')];controls.forEach(e=>e.disabled=true);
  try{await moveCards(before,old,action);}finally{busy=false;root.dataset.motion='idle';controls.forEach(e=>e.disabled=false);$('#play-prompt').focus({preventScroll:true});targetLine();}
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
  let message='';if(state.complete&&!old.complete)message='Lesson complete';else if(state.failed&&!old.failed)message='Try again';else if(old.yours.find(c=>c.id==='bears')?.damage!==state.yours.find(c=>c.id==='bears')?.damage&&state.yours.find(c=>c.id==='bears')?.damage)message='3 damage';else if(action==='pass'&&old.stage==='growth-stack')message='+3 / +3';else if(action==='pass'&&old.stage==='bear-spell')message='Creature enters';else if(action==='confirm-attacks'&&state.stage==='attacking')message='Attack!';
  if(message){const banner=$('#play-announcement');banner.textContent=message;animations.push(banner.animate([{opacity:0,transform:'translate(-50%,-30%) scale(.8)'},{opacity:1,transform:'translate(-50%,-50%) scale(1)',offset:.25},{opacity:1,offset:.75},{opacity:0,transform:'translate(-50%,-70%) scale(1)'}],{duration:1000}).finished.catch(()=>{}).then(()=>banner.textContent=''));}
  await Promise.all(animations);
 }
 function targetLine(){if(state.lesson==='full-game'){const path=$('#play-target-path'),board=$('.play-board'),spell=state.stack.at(-1),pair=Object.entries(state.blocks||{}).find(([,ids])=>ids.length),sourceId=state.pending?.id||spell?.id||pair?.[0],targetId=state.pending?.target||spell?.target||pair?.[1][0],source=sourceId&&root.querySelector('[data-card-id="'+sourceId+'"]'),target=targetId&&root.querySelector('[data-card-id="'+targetId+'"]');if(!source||!target){path.setAttribute('d','');return;}const b=board.getBoundingClientRect(),a=source.getBoundingClientRect(),z=target.getBoundingClientRect(),x=a.left+a.width/2-b.left,y=a.top+a.height/2-b.top,tx=z.left+z.width/2-b.left,ty=z.top+z.height/2-b.top;path.setAttribute('d','M '+x+' '+y+' Q '+((x+tx)/2+25)+' '+((y+ty)/2-25)+' '+tx+' '+ty);return;}const path=$('#play-target-path'),board=$('.play-board');const source=['target','pay-growth'].includes(state.stage)?root.querySelector('[data-card-id="growth"]'):state.stack.length?root.querySelector('#play-stack [data-card-id="'+state.stack.at(-1).id+'"]'):state.blockTarget||state.yours.some(c=>c.blocking)?root.querySelector('[data-card-id="enemy-bears"]'):null;const target=state.blockTarget||state.yours.find(c=>c.blocking)?root.querySelector('[data-card-id="lion"]'):state.lesson==='response'?root.querySelector('#play-creatures [data-card-id="bears"]'):null;if(!source||!target){path.setAttribute('d','');return;}const b=board.getBoundingClientRect(),a=source.getBoundingClientRect(),z=target.getBoundingClientRect();const x=a.left+a.width/2-b.left,y=a.top+a.height/2-b.top,tx=z.left+z.width/2-b.left,ty=z.top+z.height/2-b.top;path.setAttribute('d','M '+x+' '+y+' Q '+((x+tx)/2+30)+' '+((y+ty)/2-30)+' '+tx+' '+ty);}
 $('.play-board').addEventListener('dragover',e=>{if(busy)return;e.preventDefault();e.dataTransfer.dropEffect='move';});
 $('.play-board').addEventListener('drop',async e=>{e.preventDefault();$('.play-board').classList.remove('drag-active');if(busy)return;const id=e.dataTransfer.getData('text/plain'),target=e.target.closest('[data-card-id]')?.dataset.cardId,c=state.hand.find(c=>c.id===id);if(state.lesson==='full-game'){if(c){const a=primaryAction(c,'hand');if(a){await act(a);if(state.stage==='game-target'&&target)await act('target:'+target);}return;}const own=state.yours.find(c=>c.id===id);if(own&&state.stage==='game-block'&&target){await act('blocker:'+id);await act('block-target:'+target);}else if(own&&state.stage==='game-attack')await act('attack:'+id);return;}if(c){const a=primaryAction(c,'hand');if(a){await act(a);if(c.id==='growth'&&target==='bears'&&state.stage==='target')await act('target-bears');}return;}if(id==='lion'&&state.stage==='block'&&target==='enemy-bears'){if(!state.selectedBlocker)await act('block-lion');if(!state.blockTarget)await act('assign-block');}else if(id==='bears'&&state.stage==='attack')await act('attack-bears');});
 $('#play-opponent').addEventListener('click',()=>{if(state.stage==='target')act('target-player');});
 $('#play-focus').addEventListener('click',()=>{const on=root.classList.toggle('play-focused');$('#play-focus').setAttribute('aria-pressed',String(on));$('#play-focus').textContent=on?'Exit expanded table':'Expand game table';requestAnimationFrame(targetLine);});
 root.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&!$('#play-inspect').open&&!['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName)){const main=root.querySelector('[data-primary]');if(main&&!main.disabled){e.preventDefault();main.click();return;}}if(e.key==='Escape'&&!$('#play-inspect').open&&root.classList.contains('play-focused'))$('#play-focus').click();});
 $('#play-auto-pay').addEventListener('change',()=>{if(!busy)draw();});
 window.addEventListener('resize',targetLine);
 $('#play-lesson').addEventListener('change',()=>{if(busy)return;state=createPlayState($('#play-lesson').value);draw();});$('#play-reset').addEventListener('click',()=>{if(busy)return;state=createPlayState($('#play-lesson').value);draw();});draw();
`;
export const playScript='(function(){\n'+playEngineSource+'\n'+playClientSource+'\n})();';
