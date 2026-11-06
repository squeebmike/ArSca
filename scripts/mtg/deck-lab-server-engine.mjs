// Generated from deck-lab-match.mjs; equality is checked in tests. No runtime eval.
export function createDeckLabServerEngine(){
 const basics={Plains:'W',Island:'U',Swamp:'B',Mountain:'R',Forest:'G'};
 const effects={'Lightning Bolt':['damage',3],'Shock':['damage',2],'Giant Growth':['pump',3]};
 const clone=x=>JSON.parse(JSON.stringify(x));
 function support(c){
  if(c.card_faces?.length||(c.layout&&!['normal'].includes(c.layout)))return {kind:'manual',reason:'Multi-face or special layout not automated yet'};
  if(basics[c.name]&&/^Basic Land/.test(c.type_line))return {kind:'land',color:basics[c.name]};
  if(effects[c.name])return {kind:effects[c.name][0],amount:effects[c.name][1]};
  if(/^Creature\b/.test(c.type_line)&&!String(c.oracle_text||'').trim()&&/^(?:\{(?:\d+|[WUBRG])\})*$/.test(c.mana_cost||'')&&/^\d+$/.test(String(c.power))&&/^\d+$/.test(String(c.toughness)))return {kind:'creature'};
  return {kind:'manual',reason:'Rules text not automated yet'};
 }
 function parse(text){
  if(String(text).length>60000)throw Error('Decklist is too large. Limit: 60,000 characters.');
  let section='main';const entries=[],errors=[];
  for(const [i,raw] of String(text).split(/\r?\n/).entries()){
   let line=raw.trim();if(!line||line.startsWith('//'))continue;
   if(/^(Deck|Mainboard|Commander|Sideboard|Maybeboard|Companion):?$/i.test(line)){section=/deck|mainboard/i.test(line)?'main':line.toLowerCase().replace(':','');continue;}
   if(/^SB:/i.test(line)){section='sideboard';line=line.slice(3).trim();}
   const m=/^(\d+)\s*x?\s+(.+?)\s*$/i.exec(line);if(!m){errors.push('Line '+(i+1)+': expected quantity and card name.');continue;}
   const q=Number(m[1]),printing=/\s+\(([a-z0-9]{2,8})\)\s*([a-z0-9-]+)?\s*$/i.exec(m[2]);
   const name=(printing?m[2].slice(0,printing.index):m[2]).replace(/\s+\*F\*$/,'').trim();
   if(!q||q>250||!name||name.length>150){errors.push('Line '+(i+1)+': invalid quantity or name.');continue;}
   entries.push({quantity:q,name,section,set:printing?.[1]?.toLowerCase()||'',collector:printing?.[2]||''});
  }
  if(entries.reduce((n,c)=>n+c.quantity,0)>250)throw Error('Limit: 250 total cards per deck.');
  return {entries,errors};
 }
 function shuffled(cards,random=Math.random){const out=cards.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
 function validateDeck(deck,format='casual'){
  const errors=[],warnings=[],main=deck.filter(c=>!c.deckSection||c.deckSection==='main'),commanders=deck.filter(c=>c.deckSection==='commander'),side=deck.filter(c=>c.deckSection==='sideboard');
  if(!['casual','standard','commander'].includes(format))errors.push('Unknown format.');
  if(format==='casual')return {errors,warnings,main:main.length,commanders:commanders.length,sideboard:side.length};
  const cards=format==='standard'?[...main,...side]:[...main,...commanders],counts=new Map();
  if(format==='standard'){if(main.length<60)errors.push('Standard needs at least 60 main-deck cards.');if(side.length>15)errors.push('Standard allows at most 15 sideboard cards.');if(commanders.length)errors.push('Standard does not use a Commander section.');}
  else{
   if(main.length+commanders.length!==100)errors.push('Commander needs exactly 100 cards including the commander(s).');
   if(commanders.length<1||commanders.length>2)errors.push('Choose one commander, or two commanders with a legal pairing.');
   if(commanders.length===2)warnings.push('Two-commanders pairing eligibility needs manual verification.');
   for(const c of commanders)if(!(/Legendary/.test(c.type_line)&&/Creature/.test(c.type_line))&&!/can be your commander/i.test(c.oracle_text||'')&&!(commanders.length===2&&/Legendary.*Background/.test(c.type_line)))errors.push(c.name+' is not recognized as an eligible commander.');
   if(side.length)warnings.push('Commander sideboard entries are excluded from the match.');
   const colors=new Set(commanders.flatMap(c=>c.color_identity||[]));
   for(const c of cards){if(!Array.isArray(c.color_identity))warnings.push('Color identity unavailable for '+c.name+'.');else if(c.color_identity.some(x=>!colors.has(x)))errors.push(c.name+' is outside the commanders’ color identity.');}
  }
  for(const c of cards){counts.set(c.name,(counts.get(c.name)||0)+1);const legality=c.legalities?.[format];if(legality&&legality!=='legal')errors.push(c.name+' is '+legality+' in '+format+' according to the card provider.');else if(!legality)warnings.push('Provider legality unavailable for '+c.name+'.');}
  for(const [name,count] of counts){const c=cards.find(c=>c.name===name);if(/\bBasic\b/.test(c.type_line))continue;let limit=format==='standard'?4:1;
   if(/A deck can have any number of cards named/i.test(c.oracle_text||''))limit=Infinity;
   const exception=/A deck can have up to (\w+) cards named/i.exec(c.oracle_text||'');if(exception){const n=Number(exception[1])||({seven:7,nine:9})[exception[1].toLowerCase()];if(n)limit=n;else warnings.push('Review the special copy limit for '+name+'.');}
   if(count>limit)errors.push(name+' has '+count+' copies; this format allows '+limit+'.');
  }
  return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],main:main.length,commanders:commanders.length,sideboard:side.length};
 }
 function create(decks,{mode='manual',skill='regular',random=Math.random,format='casual'}={}){
  if(!['manual','bot'].includes(mode)||!['learner','regular','practiced'].includes(skill))throw Error('Invalid match settings.');
  if(![2,4].includes(decks.length)||decks.length===4&&(format!=='commander'||mode!=='manual'))throw Error('Four-player tables require Commander freeform.');
  if(format==='commander'&&mode==='bot')throw Error('Commander currently uses the freeform table; automated Commander abilities are not implemented.');
  const players=decks.map((deck,p)=>{const report=validateDeck(deck,format);if(report.errors.length)throw Error((p?'Opponent: ':'Your deck: ')+report.errors.join(' '));if(report.main<7)throw Error('Both decks need at least seven main-deck cards.');if(deck.length>250)throw Error('Deck exceeds 250 cards.');const physical=deck.map((c,i)=>({...clone(c),quantity:null,id:p+'-'+i,owner:p,isCommander:format==='commander'&&c.deckSection==='commander',commandCasts:0,tapped:false,sick:true,damage:0,boost:0}));return {life:format==='commander'?40:20,eliminated:false,mulligans:0,mulliganCount:0,kept:false,landPlayed:false,mana:{},hand:[],field:[],graveyard:[],exile:[],commandZone:physical.filter(c=>c.isCommander),commanderDamage:{},sideboard:physical.filter(c=>c.deckSection==='sideboard'),library:shuffled(physical.filter(c=>!c.deckSection||c.deckSection==='main'),random)};});
  if(mode==='bot'&&players.some(p=>p.library.some(c=>support(c).kind==='manual')))throw Error('Automated mode requires supported cards in both decks. Use the freeform table for this list.');
  const s={mode,skill,format,players,commanders:players.flatMap(p=>p.commandZone.map(c=>({id:c.id,name:c.name,owner:c.owner}))),active:0,priority:0,passes:0,turn:1,phase:'opening',stack:[],attackers:[],blocks:{},log:[],result:null,decisions:0};
  for(let p=0;p<players.length;p++)for(let i=0;i<7;i++)draw(s,p);
  if(mode==='bot'){
   const p=players[1],landCount=()=>p.hand.filter(c=>support(c).kind==='land').length;
   while(skill!=='learner'&&(landCount()<2||landCount()>5)&&p.mulligans<2){mulligan(s,1,random);}
   const ranked=p.hand.slice().sort((a,b)=>Number(a.cmc||0)-Number(b.cmc||0));
   keep(s,1,ranked.slice(-p.mulligans||ranked.length).map(c=>c.id));
  }
  return s;
 }
 function log(s,t){s.log.push(t);if(s.log.length>180)s.log.shift();}
 function eliminate(s,p,reason='Concession'){const x=s.players[p];if(!x||x.eliminated)throw Error('Player is already out.');x.eliminated=true;x.kept=true;for(const z of ['hand','library','field','graveyard','exile','commandZone','sideboard'])x[z]=[];s.stack=s.stack.filter(t=>t.controller!==p);const alive=s.players.map((x,i)=>x.eliminated?null:i).filter(i=>i!==null);if(alive.length<2)s.result={winner:alive[0]??null,reason};else if(s.active===p){s.active=nextPlayer(s,p);s.priority=s.active;}if(s.phase==='opening'&&s.players.every(x=>x.kept))s.phase='main1';}
 function nextPlayer(s,p){for(let i=1;i<=s.players.length;i++){const n=(p+i)%s.players.length;if(!s.players[n].eliminated)return n;}return p;}
 function draw(s,p){const x=s.players[p];if(!x.library.length){if(s.players.length>2)eliminate(s,p,'Last player remaining');else s.result={winner:1-p,reason:'Tried to draw from an empty library'};return;}x.hand.push(x.library.shift());}
 function mulligan(s,p,random=Math.random){const x=s.players[p];if(s.phase!=='opening'||x.kept||x.mulligans>=7)throw Error('Cannot mulligan now.');x.library=shuffled([...x.hand,...x.library],random);x.hand=[];x.mulliganCount=(x.mulliganCount||0)+1;x.mulligans=s.players.length>2?Math.max(0,x.mulliganCount-1):x.mulliganCount;for(let i=0;i<7;i++)draw(s,p);log(s,(p?'Opponent':'You')+' mulligans to '+(7-x.mulligans)+'.');}
 function keep(s,p,bottom=[]){const x=s.players[p];if(s.phase!=='opening'||x.kept)throw Error('Cannot keep now.');if(new Set(bottom).size!==x.mulligans||bottom.length!==x.mulligans||bottom.some(id=>!x.hand.some(c=>c.id===id)))throw Error('Choose exactly '+x.mulligans+' card(s) to bottom.');for(const id of bottom)x.library.push(x.hand.splice(x.hand.findIndex(c=>c.id===id),1)[0]);x.kept=true;if(s.players.every(x=>x.kept)){s.phase='main1';s.priority=0;log(s,s.players.length>2?'Multiplayer: the starting player also draws. Apply beginning steps manually.':'You play first; skip your first draw. Precombat main phase.');}}
 function payment(player,cost,selected=null){
  if(selected!==null&&(!Array.isArray(selected)||new Set(selected).size!==selected.length||selected.some(id=>typeof id!=='string')))return null;
  const available=player.field.filter(c=>support(c).kind==='land'&&!c.tapped);
  if(selected!==null&&selected.some(id=>!available.some(c=>c.id===id)))return null;
  const lands=selected===null?available:selected.map(id=>available.find(c=>c.id===id)),chosen=[];let generic=0;
  for(const symbol of [...String(cost||'').matchAll(/\{([^}]+)\}/g)].map(m=>m[1])){
   if(/^\d+$/.test(symbol)){generic+=Number(symbol);continue;}
   if(!/^[WUBRG]$/.test(symbol))return null;
   const land=lands.find(c=>!chosen.includes(c.id)&&support(c).color===symbol);if(!land)return null;chosen.push(land.id);
  }
  const spare=lands.filter(c=>!chosen.includes(c.id));if(spare.length<generic||selected!==null&&lands.length!==chosen.length+generic)return null;return [...chosen,...spare.slice(0,generic).map(c=>c.id)];
 }
 function check(s){
  for(const p of s.players)for(let i=p.field.length-1;i>=0;i--){const c=p.field[i];if(support(c).kind==='creature'&&c.damage>=Number(c.toughness)+c.boost){p.graveyard.push(p.field.splice(i,1)[0]);log(s,c.name+' dies.');}}
  if(s.players.every(p=>p.life<=0))s.result={winner:null,reason:'Both players at zero life'};else for(let i=0;i<2;i++)if(s.players[i].life<=0)s.result={winner:1-i,reason:'Life reached zero'};
 }
 function legalTarget(s,card,target){if(support(card).kind==='damage'&&['player0','player1'].includes(target))return true;return s.players.some(p=>p.field.some(c=>c.id===target&&support(c).kind==='creature'));}
 function cast(s,p,id,target,selected=null){
  const x=s.players[p],c=x.hand.find(c=>c.id===id);if(!c||s.priority!==p||['opening','attack','block','discard'].includes(s.phase)||s.result)throw Error('You do not have priority.');
  const kind=support(c).kind;if(kind==='manual'||kind==='land')throw Error('This card is not an automated spell.');
  if(kind==='creature'&&(s.active!==p||!['main1','main2'].includes(s.phase)||s.stack.length))throw Error('Cast creatures in your main phase with an empty stack.');
  if(['damage','pump'].includes(kind)&&!legalTarget(s,c,target))throw Error('Choose a legal target.');
  const pay=payment(x,c.mana_cost,selected);if(!pay)throw Error('Not enough untapped lands of the required colors.');
  pay.forEach(id=>x.field.find(c=>c.id===id).tapped=true);x.hand.splice(x.hand.indexOf(c),1);s.stack.push({card:c,controller:p,target});s.passes=0;log(s,(p?'Opponent casts ':'You cast ')+c.name+'.');
 }
 function land(s,p,id){const x=s.players[p],c=x.hand.find(c=>c.id===id);if(s.result||s.priority!==p||s.active!==p||!['main1','main2'].includes(s.phase)||s.stack.length||x.landPlayed||!c||support(c).kind!=='land')throw Error('Land play is not legal now.');x.hand.splice(x.hand.indexOf(c),1);c.sick=false;x.field.push(c);x.landPlayed=true;log(s,(p?'Opponent plays ':'You play ')+c.name+'.');}
 function resolve(s){const {card:c,controller:p,target}=s.stack.pop(),kind=support(c).kind;
  if(kind==='creature'){c.sick=true;s.players[p].field.push(c);}else{if(legalTarget(s,c,target)){if(target.startsWith('player'))s.players[Number(target.slice(-1))].life-=support(c).amount;else{const t=s.players.flatMap(p=>p.field).find(c=>c.id===target);if(kind==='damage')t.damage+=support(c).amount;else t.boost+=support(c).amount;}}else log(s,'Target is no longer legal; '+c.name+' does not resolve.');s.players[p].graveyard.push(c);}
  log(s,c.name+' leaves the stack.');check(s);s.priority=s.active;s.passes=0;
 }
 function advance(s){
  const p=s.players[s.active];
  if(s.phase==='main1')s.phase='begin-combat';
  else if(s.phase==='begin-combat'){s.phase='attack';s.attackers=[];s.blocks={};}
  else if(s.phase==='attack-priority')s.phase='block';
  else if(s.phase==='block-priority'){
   for(const id of s.attackers){const a=p.field.find(c=>c.id===id);if(!a)continue;const ids=s.blocks[id]||[],blockers=ids.map(id=>s.players[1-s.active].field.find(c=>c.id===id)).filter(Boolean);if(!ids.length)s.players[1-s.active].life-=Number(a.power)+a.boost;else{let remaining=Number(a.power)+a.boost;for(const b of blockers){const assigned=Math.min(remaining,Math.max(0,Number(b.toughness)+b.boost-b.damage));b.damage+=assigned;remaining-=assigned;a.damage+=Number(b.power)+b.boost;}if(remaining&&blockers.length)blockers.at(-1).damage+=remaining;}}
   check(s);s.phase='end-combat';log(s,'Combat damage is simultaneous.');
  }else if(s.phase==='end-combat')s.phase='main2';
  else if(s.phase==='main2')s.phase='end';
  else if(s.phase==='end'){
   if(p.hand.length>7){s.phase='discard';return;}
   nextTurn(s);
  }else if(s.phase==='upkeep'){draw(s,s.active);s.phase='draw';}
  else if(s.phase==='draw')s.phase='main1';
  s.priority=s.active;s.passes=0;
 }
 function nextTurn(s){for(const p of s.players)for(const c of p.field){c.damage=0;c.boost=0;}s.active=1-s.active;s.turn++;s.priority=s.active;s.passes=0;const p=s.players[s.active];p.landPlayed=false;p.field.forEach(c=>{c.tapped=false;c.sick=false;});s.phase='upkeep';s.attackers=[];s.blocks={};log(s,'Turn '+s.turn+': '+(s.active?'opponent':'you')+' untaps. Upkeep priority.');}
 function pass(s,p){if(s.result||s.priority!==p||['opening','attack','block','discard'].includes(s.phase))throw Error('Complete the current choice first.');if(++s.passes===2){if(s.stack.length)resolve(s);else advance(s);}else s.priority=1-p;}
 function attack(s,p,ids){if(s.result||s.active!==p||s.phase!=='attack')throw Error('Not your attack step.');if(new Set(ids).size!==ids.length||ids.some(id=>!s.players[p].field.some(c=>c.id===id&&support(c).kind==='creature'&&!c.sick&&!c.tapped)))throw Error('Invalid attacker.');s.attackers=ids;ids.forEach(id=>s.players[p].field.find(c=>c.id===id).tapped=true);s.phase=ids.length?'attack-priority':'end-combat';s.priority=p;s.passes=0;log(s,ids.length+' attacker(s).');}
 function block(s,p,assignments){if(s.result||p===s.active||s.phase!=='block')throw Error('Not your block step.');const normalized=Object.fromEntries(Object.entries(assignments).map(([a,b])=>[a,Array.isArray(b)?b:[b]])),ids=Object.values(normalized).flat();if(new Set(ids).size!==ids.length||Object.entries(normalized).some(([a,bs])=>!s.attackers.includes(a)||bs.some(b=>!s.players[p].field.some(c=>c.id===b&&!c.tapped&&support(c).kind==='creature'))))throw Error('Invalid blocker.');s.blocks=normalized;s.phase='block-priority';s.priority=s.active;s.passes=0;log(s,ids.length+' block(s) declared.');}
 function discard(s,p,id){if(s.result||s.active!==p||s.phase!=='discard')throw Error('Not a cleanup discard.');const x=s.players[p],i=x.hand.findIndex(c=>c.id===id);if(i<0)throw Error('Card not in hand.');x.graveyard.push(x.hand.splice(i,1)[0]);if(x.hand.length<=7)nextTurn(s);}
 function bot(s){
  if(s.mode!=='bot'||s.result||s.phase==='opening')return false;
  const p=s.players[1],opp=s.players[0],skill=s.skill;
  if(s.active===1&&s.phase==='discard'){discard(s,1,p.hand.slice().sort((a,b)=>Number(b.cmc||0)-Number(a.cmc||0))[0].id);return true;}
  if(s.active===1&&s.phase==='attack'){
   const blockers=opp.field.filter(c=>support(c).kind==='creature'&&!c.tapped),max=blockers.reduce((n,c)=>Math.max(n,Number(c.power)+c.boost),0);
   attack(s,1,p.field.filter(c=>support(c).kind==='creature'&&!c.tapped&&!c.sick&&(skill==='learner'||!blockers.length||Number(c.toughness)+c.boost>max||opp.life<=Number(c.power)+c.boost)).map(c=>c.id));return true;
  }
  if(s.active===0&&s.phase==='block'){
   const blocks={},free=p.field.filter(c=>support(c).kind==='creature'&&!c.tapped);
   for(const id of s.attackers){const a=opp.field.find(c=>c.id===id);if(!a)continue;const i=free.findIndex(b=>skill==='learner'||Number(b.toughness)+b.boost>Number(a.power)+a.boost||Number(b.power)+b.boost>=Number(a.toughness)+a.boost||p.life<=Number(a.power)+a.boost);if(i>=0)blocks[id]=free.splice(i,1)[0].id;}
   block(s,1,blocks);return true;
  }
  if(s.priority!==1||['attack','block','discard'].includes(s.phase))return false;
  // Practiced reacts to removal; no access to the human's hand/library.
  const pump=p.hand.find(c=>support(c).kind==='pump'&&payment(p,c.mana_cost));
  const threat=s.stack.at(-1),victim=threat&&p.field.find(c=>c.id===threat.target);
  if(skill==='practiced'&&pump&&victim&&support(threat.card).kind==='damage'&&victim.damage+support(threat.card).amount>=Number(victim.toughness)+victim.boost){cast(s,1,pump.id,victim.id);return true;}
  if(s.active===1&&['main1','main2'].includes(s.phase)&&!s.stack.length){
   const l=p.hand.find(c=>support(c).kind==='land');if(l&&!p.landPlayed){land(s,1,l.id);return true;}
   const spells=p.hand.filter(c=>payment(p,c.mana_cost));
   const removal=spells.find(c=>support(c).kind==='damage');
   if(removal&&skill!=='learner'){
    const n=support(removal).amount,target=opp.field.filter(c=>support(c).kind==='creature'&&Number(c.toughness)+c.boost-c.damage<=n).sort((a,b)=>Number(b.power)-Number(a.power))[0];
    if(opp.life<=n||target){cast(s,1,removal.id,target&&opp.life>n?target.id:'player0');return true;}
   }
   const creature=spells.filter(c=>support(c).kind==='creature').sort((a,b)=>skill==='learner'?Number(a.cmc)-Number(b.cmc):Number(b.cmc)-Number(a.cmc))[0];if(creature){cast(s,1,creature.id);return true;}
   if(removal){cast(s,1,removal.id,'player0');return true;}
  }
  pass(s,1);return true;
 }
 function manual(s,{player,from,to,id,kind,value,label,power,toughness}){
  if(s.mode!=='manual')throw Error('Freeform actions are only available at the freeform table.');
  const p=s.players[player];if(!p||p.eliminated)throw Error('Invalid or eliminated player.');if(s.phase==='opening')throw Error('Keep both opening hands before using table actions.');
  if(kind==='phase'){if(s.active!==player)throw Error('Only the active player advances the phase marker.');if(s.stack.length)throw Error('Resolve the stack before advancing the phase marker.');const steps=['upkeep','draw','main1','begin-combat','attack','block','main2','end'],i=steps.indexOf(s.tableStep||'main1');if(i>=steps.length-1)throw Error('Pass the turn after the end step.');s.tableStep=steps[i+1];return;}
  if(kind==='token'){if(typeof label!=='string'||!label.trim()||label.length>80||!Number.isInteger(power)||!Number.isInteger(toughness)||Math.abs(power)>99||Math.abs(toughness)>99||!Number.isInteger(value)||value<1||value>20)throw Error('Enter a token name, numeric stats and 1–20 copies.');if(p.field.filter(c=>c.token).length+value>60)throw Error('Token limit: 60 per player.');for(let n=0;n<value;n++)p.field.push({id:'token-'+player+'-'+(s.tokenSerial=(s.tokenSerial||0)+1),owner:player,name:label.trim(),type_line:'Token Creature',oracle_text:'Apply token abilities manually.',power:String(power),toughness:String(toughness),token:true,tapped:false,sick:true,damage:0,boost:0});return;}
  if(kind==='table-cast'){if(!['hand','commandZone'].includes(from))throw Error('Cast from your hand or command zone.');if(from==='commandZone')return manual(s,{player,kind:'commander-cast',id});const i=p.hand.findIndex(c=>c.id===id);if(i<0||/\bLand\b/.test(p.hand[i].type_line))throw Error('Choose a spell in your hand.');s.stack.push({card:p.hand.splice(i,1)[0],controller:player,target:null});return;}
  if(kind==='table-resolve'){if(!['field','graveyard','exile'].includes(to))throw Error('Choose a public destination.');const i=s.stack.findIndex(t=>t.card.id===id&&t.controller===player);if(i<0)throw Error('Your spell is not on the stack.');const c=s.stack.splice(i,1)[0].card;c.sick=true;p[to].push(c);return;}
  if(kind==='commander-damage'){if(s.format!=='commander'||!s.commanders.some(c=>c.id===id)||!Number.isInteger(value)||Math.abs(value)>21)throw Error('Invalid commander damage entry.');const n=(p.commanderDamage[id]||0)+value;if(n<0)throw Error('Commander damage cannot be negative.');p.commanderDamage[id]=n;return;}
  if(kind==='commander-cast'){if(s.format!=='commander')throw Error('This is not a Commander table.');const i=p.commandZone.findIndex(c=>c.id===id);if(i<0)throw Error('Commander is not in your command zone.');const c=p.commandZone.splice(i,1)[0];c.commandCasts++;s.stack.push({card:c,controller:player,target:null});return;}
  if(kind==='commander-resolve'||kind==='commander-counter'){const i=s.stack.findIndex(t=>t.card.id===id&&t.card.isCommander&&t.controller===player);if(i<0)throw Error('Your commander is not on the stack.');const c=s.stack.splice(i,1)[0].card;c.sick=true;p[kind==='commander-resolve'?'field':'graveyard'].push(c);return;}
  if(kind==='life'){if(!Number.isFinite(value)||Math.abs(value)>100)throw Error('Invalid life change.');p.life+=value;return;}
  if(kind==='draw'){draw(s,player);return;}
  if(!['hand','field','graveyard','exile','library','commandZone','sideboard'].includes(from))throw Error('Invalid source zone.');const i=p[from].findIndex(c=>c.id===id);if(i<0)throw Error('Card not found.');
  if(kind==='counter'){if(from!=='field'||!['+1/+1','-1/-1','loyalty','charge','stun'].includes(label)||!Number.isInteger(value)||Math.abs(value)>20)throw Error('Invalid counter change.');const c=p[from][i];c.counters||={};const n=(c.counters[label]||0)+value;if(n<0||n>999)throw Error('Counter count must be 0–999.');c.counters[label]=n;return;}
  if(kind==='tap'){p[from][i].tapped=!p[from][i].tapped;return;}
  if(kind==='flip'){const c=p[from][i];if(!c.card_faces?.length)throw Error('No other face.');c.face=((c.face||0)+1)%c.card_faces.length;return;}
  if(!['hand','field','graveyard','exile','library','commandZone','sideboard'].includes(to))throw Error('Invalid destination zone.');if(to==='commandZone'&&!p[from][i].isCommander)throw Error('Only a designated commander can enter the command zone.');const moved=p[from].splice(i,1)[0];if(!moved.token||to==='field')p[to].push(moved);if(to!=='field'){moved.counters={};moved.damage=0;moved.boost=0;moved.tapped=false;}
 }
 return {support,parse,shuffled,validateDeck,create,mulligan,keep,payment,land,cast,pass,attack,block,discard,bot,manual,eliminate,nextPlayer,clone};
}
