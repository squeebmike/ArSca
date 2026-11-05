import assert from 'node:assert/strict';
import {playEngineSource,playScript} from '../scripts/mtg-play-lessons.mjs';
const {createPlayState,playAction:A,playView:V,fullGameCardAction:C}=new Function(playEngineSource+';return {createPlayState,playAction,playView,fullGameCardAction}')();
const start=()=>createPlayState('full-game');
let s=start();assert.equal(s.hand.length,7);assert.equal(s.library.length,33);assert.equal(s.yourLife,20);assert.equal(s.opponentLife,20);
assert.equal(new Set([...s.hand,...s.library].map(c=>c.id)).size,40);
assert.equal(s.yours.length,0);assert.equal(V(s).priority,false);
s=A(s,'full-mulligan');assert.equal(s.hand.length,7);assert.equal(s.library.length,33);assert.equal(s.mulligans,1);
s=A(s,'full-keep');assert.equal(s.stage,'bottom');let unchanged=A(s,'full-bottom');assert.equal(unchanged.stage,'bottom');
const bottom=s.hand.at(-1).id;s=A(s,'bottom:'+bottom);s=A(s,'full-bottom');assert.equal(s.hand.length,6);assert.equal(s.library.length,34);assert.equal(s.library.at(-1).id,bottom);
assert.equal(s.stage,'game-untap');assert(!V(s).priority);s=A(s,'full-next');assert.equal(s.stage,'game-upkeep');s=A(s,'full-pass');assert.equal(s.stage,'game-main');assert.equal(s.hand.length,6,'starting player skips the entire first draw step');
const land=s.hand.find(c=>c.name==='Forest').id;s=A(s,'land:'+land);let other=s.hand.find(c=>c.name==='Forest').id;unchanged=A(s,'land:'+other);assert.equal(unchanged.yours.length,1,'one land per turn');
const bear=s.hand.find(c=>c.power!==undefined);unchanged=A(s,'cast:'+bear.id);assert.equal(unchanged.stage,'game-main');assert.equal(unchanged.stack.length,0,'cannot cast an unaffordable spell');
// Normal turn cycle reaches the opponent's real land play and hidden draw.
for(const action of ['full-pass','full-pass','full-attacks','full-pass','full-pass','full-pass','full-pass','full-pass','full-next','full-next','full-pass','full-pass'])s=A(s,action);
assert.equal(s.active,'opponent');assert.equal(s.theirs.filter(c=>c.name==='Mountain').length,1);
assert.equal(s.opLibrary.length,32);assert.equal(s.opHand.length,7,'opponent drew and played one land');
// Casting a response preserves the underlying stack continuation and target identity.
let r=start();const cards=[...r.hand,...r.library];r.stage='game-stack';r.phase='Opponent’s main';r.active='opponent';r.main='pre';r.opCast=true;r.opBolt=true;r.stackReturn='game-main';r.yours=[{...cards.find(c=>c.name==='Forest')},{...cards.find(c=>c.name==='Grizzly Bears'),sick:false}];r.hand=[cards.find(c=>c.name==='Giant Growth')];r.stack=[{id:'op-bolt',name:'Lightning Bolt',controller:'Opponent',target:r.yours[1].id}];
const target=r.yours[1].id;r=A(r,'cast:'+r.hand[0].id);assert.equal(r.stage,'game-target');assert(!V(r).priority);assert.equal(A(r,'target:no-such-creature').stage,'game-target');r=A(r,'target:'+target);assert.equal(r.stage,'game-pay');r=A(r,'full-pay-auto');assert.equal(r.stack.length,2);r=A(r,'full-pass');assert.equal(r.stack.length,1);assert.equal(r.yours[1].toughness,5);r=A(r,'full-pass');assert.equal(r.yours[1].damage,3);assert.equal(r.stage,'game-main');assert.equal(r.active,'opponent');
// Cleanup ends the buff and removes marked damage simultaneously.
r.stage='game-end-step';r=A(r,'full-pass');assert.equal(r.yours[1].toughness,2);assert.equal(r.yours[1].damage,0);assert(!r.yourGraveyard.some(c=>c.id===target));
// Response on the opponent's upkeep returns to upkeep, never its main phase.
r=start();r.stage='game-upkeep';r.active='opponent';r.yours=[{...cards.find(c=>c.name==='Forest')},{...cards.find(c=>c.name==='Grizzly Bears')}];r.hand=[cards.find(c=>c.name==='Giant Growth')];r=A(A(A(r,'cast:'+r.hand[0].id),'target:'+r.yours[1].id),'full-pay-auto');r=A(r,'full-pass');assert.equal(r.stage,'game-upkeep');assert.equal(r.theirs.length,0);
// Multiple blockers are assigned together; blockers never tap.
r=start();r.stage='game-block';r.active='opponent';r.yours=cards.filter(c=>c.power!==undefined).slice(0,2);r.theirs=[{id:'attacker',name:'Goblin Piker',type:'Creature',power:2,toughness:1,damage:0,tapped:true,attacking:true}];
for(const c of r.yours)r=A(A(r,'blocker:'+c.id),'block-target:attacker');assert.equal(r.blocks.attacker.length,2);r=A(r,'full-blocks');assert(r.yours.every(c=>!c.tapped&&c.blocking));r=A(r,'full-pass');assert.equal(r.yourLife,20);assert.equal(r.theirGraveyard.length,1);assert.equal(r.yourGraveyard.length,1,'attacker assigns lethal damage to one of two 2/2 blockers');
// A six-mana finisher pays its real cost and tramples only excess damage.
r=start();const pool=[...r.hand,...r.library];r.stage='game-main';r.hand=[pool.find(c=>c.name==='Colossal Dreadmaw')];r.yours=pool.filter(c=>c.name==='Forest').slice(0,5);assert.equal(A(r,'cast:'+r.hand[0].id).stage,'game-main');r.yours.push(pool.filter(c=>c.name==='Forest')[5]);r=A(r,'cast:'+r.hand[0].id);assert.equal(V(r).prompt,'Pay {4}{G}{G}');r=A(r,'full-pay-auto');assert.equal(r.yours.filter(c=>c.tapped).length,6);r=A(r,'full-pass');const dinosaur=r.yours.find(c=>c.name==='Colossal Dreadmaw');r.stage='game-after-blocks';dinosaur.sick=false;dinosaur.tapped=true;dinosaur.attacking=true;dinosaur.wasBlocked=true;r.theirs=[{id:'piker',name:'Goblin Piker',power:2,toughness:1,damage:0,blocking:true}];r.blocks={[dinosaur.id]:['piker']};r=A(r,'full-pass');assert.equal(r.opponentLife,15);assert.equal(r.yours.find(c=>c.id===dinosaur.id).damage,2);assert.equal(r.theirGraveyard.length,1);
// Maximum hand size, loss for empty-library draw, and terminal states.
r=start();r.stage='game-end-step';r.hand.push(r.library.shift());r=A(r,'full-pass');assert.equal(r.stage,'game-discard');r=A(r,'discard:'+r.hand[0].id);assert.equal(r.hand.length,7);assert.equal(r.stage,'game-cleanup');
r=start();r.stage='game-upkeep';r.turn=2;r.library=[];r=A(r,'full-pass');assert(r.failed);assert.equal(A(r,'full-next').turn,2);
// Browser source remains parseable with the same shared engine.
new Function('document','location','localStorage',playScript)({querySelector:()=>null},{},{getItem:()=>null});
assert.equal(C(start(),start().hand[0],'hand'),null);
console.log('Full game: London mulligans, turn/draw rules, resource gates, exact-target stack responses, cleanup, multi-blocks, discards and terminal losses passed');

// A complete ordinary winning line, without editing game state.
{
let s=createPlayState('full-game');function act(a){s=A(s,a);const cards=[...s.hand,...s.library,...s.yours,...s.theirs,...s.opHand,...s.opLibrary,...s.stack,...s.yourGraveyard,...s.theirGraveyard];assert.equal(cards.length,80,'cards conserved through the game');assert.equal(new Set(cards.map(c=>c.id)).size,80,'no card exists in two zones');}const mana=()=>s.mana+s.yours.filter(c=>c.name==='Forest'&&!c.tapped).length;let n=0;act('full-keep');
for(;n<1500&&!s.complete&&!s.failed;n++){
 if(s.stage==='game-main'&&s.active==='you'){
  const land=s.hand.find(c=>c.name==='Forest');if(land&&!s.landPlayed){act('land:'+land.id);continue;}
  const c=s.hand.find(c=>c.power!==undefined&&mana()>=(c.manaValue||2));if(c){act('cast:'+c.id);continue;}
 }
 if(s.stage==='game-pay'){act('full-pay-auto');continue;}
 if(s.stage==='game-target'){act('target:'+s.yours.find(c=>c.power!==undefined).id);continue;}
 if(s.stage==='game-stack'&&s.stack.at(-1)?.name==='Lightning Bolt'){
  const target=s.yours.find(c=>c.id===s.stack.at(-1).target),g=s.hand.find(c=>c.name==='Giant Growth');if(g&&mana()&&target&&target.damage+3>=target.toughness){act('cast:'+g.id);continue;}
 }
 if(s.stage==='game-attack'){
  for(const c of s.yours.filter(c=>c.power!==undefined&&!c.tapped&&!c.sick&&!c.selectedAttack))act('attack:'+c.id);act('full-attacks');continue;
 }
 if(s.stage==='game-after-blocks'&&s.active==='you'){
  const g=s.hand.find(c=>c.name==='Giant Growth'),a=s.yours.find(c=>c.attacking&&!c.pumped);if(g&&mana()&&a){act('cast:'+g.id);act('target:'+a.id);continue;}
 }
 if(s.stage==='game-block'){
  const used=new Set();for(const a of s.theirs.filter(c=>c.attacking)){const b=s.yours.find(c=>c.power!==undefined&&!c.tapped&&!used.has(c.id)&&c.damage===0&&c.power>=a.toughness);if(b){used.add(b.id);act('blocker:'+b.id);act('block-target:'+a.id);}}act('full-blocks');continue;
 }
 if(s.stage==='game-discard'){act('discard:'+s.hand.at(-1).id);continue;}
 const a=V(s).primary?.action;if(!a)throw Error('No action '+s.stage);act(a);
}
assert(s.complete);assert(!s.failed);assert(s.opponentLife<=0);assert(s.turn<=10);assert(n<300);assert(s.milestones.includes('responses')&&s.milestones.includes('blocking'));
console.log('Complete teaching game won in '+s.turn+' turns / '+n+' decisions with all 80 cards conserved.');
}
