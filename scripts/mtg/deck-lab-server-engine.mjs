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
 function create(decks,{mode='manual',skill='regular',random=Math.random}={}){
  if(!['manual','bot'].includes(mode)||!['learner','regular','practiced'].includes(skill))throw Error('Invalid match settings.');
  const players=decks.map((deck,p)=>{if(deck.length<7)throw Error('Both decks need at least seven cards.');if(deck.length>250)throw Error('Deck exceeds 250 cards.');return {life:20,mulligans:0,kept:false,landPlayed:false,mana:{},hand:[],field:[],graveyard:[],exile:[],library:shuffled(deck.map((c,i)=>({...clone(c),quantity:null,id:p+'-'+i,owner:p,tapped:false,sick:true,damage:0,boost:0})),random)};});
  if(mode==='bot'&&players.some(p=>p.library.some(c=>support(c).kind==='manual')))throw Error('Automated mode requires supported cards in both decks. Use the freeform table for this list.');
  const s={mode,skill,players,active:0,priority:0,passes:0,turn:1,phase:'opening',stack:[],attackers:[],blocks:{},log:[],result:null,decisions:0};
  for(let p=0;p<2;p++)for(let i=0;i<7;i++)draw(s,p);
  if(mode==='bot'){
   const p=players[1],landCount=()=>p.hand.filter(c=>support(c).kind==='land').length;
   while(skill!=='learner'&&(landCount()<2||landCount()>5)&&p.mulligans<2){mulligan(s,1,random);}
   const ranked=p.hand.slice().sort((a,b)=>Number(a.cmc||0)-Number(b.cmc||0));
   keep(s,1,ranked.slice(-p.mulligans||ranked.length).map(c=>c.id));
  }
  return s;
 }
 function log(s,t){s.log.push(t);if(s.log.length>180)s.log.shift();}
 function draw(s,p){const x=s.players[p];if(!x.library.length){s.result={winner:1-p,reason:'Tried to draw from an empty library'};return;}x.hand.push(x.library.shift());}
 function mulligan(s,p,random=Math.random){const x=s.players[p];if(s.phase!=='opening'||x.kept||x.mulligans>=7)throw Error('Cannot mulligan now.');x.library=shuffled([...x.hand,...x.library],random);x.hand=[];x.mulligans++;for(let i=0;i<7;i++)draw(s,p);log(s,(p?'Opponent':'You')+' mulligans to '+(7-x.mulligans)+'.');}
 function keep(s,p,bottom=[]){const x=s.players[p];if(s.phase!=='opening'||x.kept)throw Error('Cannot keep now.');if(new Set(bottom).size!==x.mulligans||bottom.length!==x.mulligans||bottom.some(id=>!x.hand.some(c=>c.id===id)))throw Error('Choose exactly '+x.mulligans+' card(s) to bottom.');for(const id of bottom)x.library.push(x.hand.splice(x.hand.findIndex(c=>c.id===id),1)[0]);x.kept=true;if(s.players.every(x=>x.kept)){s.phase='main1';s.priority=0;log(s,'You play first; skip your first draw. Precombat main phase.');}}
 function payment(player,cost){
  const lands=player.field.filter(c=>support(c).kind==='land'&&!c.tapped),chosen=[];let generic=0;
  for(const symbol of [...String(cost||'').matchAll(/\{([^}]+)\}/g)].map(m=>m[1])){
   if(/^\d+$/.test(symbol)){generic+=Number(symbol);continue;}
   if(!/^[WUBRG]$/.test(symbol))return null;
   const land=lands.find(c=>!chosen.includes(c.id)&&support(c).color===symbol);if(!land)return null;chosen.push(land.id);
  }
  const spare=lands.filter(c=>!chosen.includes(c.id));if(spare.length<generic)return null;return [...chosen,...spare.slice(0,generic).map(c=>c.id)];
 }
 function check(s){
  for(const p of s.players)for(let i=p.field.length-1;i>=0;i--){const c=p.field[i];if(support(c).kind==='creature'&&c.damage>=Number(c.toughness)+c.boost){p.graveyard.push(p.field.splice(i,1)[0]);log(s,c.name+' dies.');}}
  if(s.players.every(p=>p.life<=0))s.result={winner:null,reason:'Both players at zero life'};else for(let i=0;i<2;i++)if(s.players[i].life<=0)s.result={winner:1-i,reason:'Life reached zero'};
 }
 function legalTarget(s,card,target){if(support(card).kind==='damage'&&['player0','player1'].includes(target))return true;return s.players.some(p=>p.field.some(c=>c.id===target&&support(c).kind==='creature'));}
 function cast(s,p,id,target){
  const x=s.players[p],c=x.hand.find(c=>c.id===id);if(!c||s.priority!==p||['opening','attack','block','discard'].includes(s.phase)||s.result)throw Error('You do not have priority.');
  const kind=support(c).kind;if(kind==='manual'||kind==='land')throw Error('This card is not an automated spell.');
  if(kind==='creature'&&(s.active!==p||!['main1','main2'].includes(s.phase)||s.stack.length))throw Error('Cast creatures in your main phase with an empty stack.');
  if(['damage','pump'].includes(kind)&&!legalTarget(s,c,target))throw Error('Choose a legal target.');
  const pay=payment(x,c.mana_cost);if(!pay)throw Error('Not enough untapped lands of the required colors.');
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
 function manual(s,{player,from,to,id,kind,value}){
  if(s.mode!=='manual')throw Error('Freeform actions are only available at the freeform table.');
  const p=s.players[player];if(!p)throw Error('Invalid player.');
  if(kind==='life'){if(!Number.isFinite(value)||Math.abs(value)>100)throw Error('Invalid life change.');p.life+=value;return;}
  if(kind==='draw'){draw(s,player);return;}
  if(!['hand','field','graveyard','exile','library'].includes(from))throw Error('Invalid source zone.');const i=p[from].findIndex(c=>c.id===id);if(i<0)throw Error('Card not found.');
  if(kind==='tap'){p[from][i].tapped=!p[from][i].tapped;return;}
  if(kind==='flip'){const c=p[from][i];if(!c.card_faces?.length)throw Error('No other face.');c.face=((c.face||0)+1)%c.card_faces.length;return;}
  if(!['hand','field','graveyard','exile','library'].includes(to))throw Error('Invalid destination zone.');p[to].push(p[from].splice(i,1)[0]);
 }
 return {support,parse,shuffled,create,mulligan,keep,payment,land,cast,pass,attack,block,discard,bot,manual,clone};
}
