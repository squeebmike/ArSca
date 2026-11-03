import assert from 'node:assert/strict';
import {playLessons,playEngineSource,playScript,playLessonHtml} from '../scripts/mtg-play-lessons.mjs';
const {createPlayState,playAction:A,playView}=new Function(playEngineSource+';return {createPlayState,playAction,playView};')();
assert.equal(playLessons.length,3);assert.throws(()=>createPlayState('unknown'));
new Function('document',playScript)({querySelector:()=>null});
assert(playLessonHtml().includes('scripted opponent actions'));
let s=createPlayState('first-turn'),original=JSON.stringify(s);
let w=A(s,'cast-bears');assert.equal(w.stage,'main');assert.equal(w.mana,0);assert.equal(JSON.stringify(s),original);
s=A(s,'play-forest');s=A(s,'cast-bears');assert.equal(s.stage,'pay-bears');assert.equal(s.hand.length,1);assert(s.yours.every(c=>!c.tapped),'planning a cast must not pay it');
w=A(s,'pay-mana');assert.equal(w.stage,'pay-bears');assert.equal(w.hand.length,1);assert.equal(w.stack.length,0);
w=A(s,'cancel-cast');assert.equal(w.stage,'main');assert(w.yours.every(c=>!c.tapped));
s=A(s,'pay-auto');assert.equal(s.stack[0].id,'bears');assert.equal(s.mana,0);assert(s.yours.every(c=>c.tapped));assert(!s.yours.some(c=>c.id==='bears'));
s=A(s,'pass');assert(s.yours.find(c=>c.id==='bears').sick);
s=A(s,'combat');assert.equal(s.stage,'begin-combat');s=A(s,'pass');s=A(s,'attack-bears');assert.equal(s.stage,'attack');assert(!s.yours.find(c=>c.id==='bears').selectedAttack);assert(!s.yours.find(c=>c.id==='bears').tapped);
s=A(s,'confirm-attacks');assert.equal(s.stage,'post-main');assert.equal(s.main,'post');assert.equal(s.opponentLife,20);
s=A(s,'end-turn');assert.equal(s.stage,'opponent-turn');assert(s.yours.find(c=>c.id==='bears').sick,'ending your turn is not your next untap');
s=A(s,'pass');assert.equal(s.stage,'untap');assert(!playView(s).priority);assert(s.yours.every(c=>!c.tapped&&!c.sick));assert.equal(s.hand.length,0,'draw has not happened during untap');
s=A(s,'advance-upkeep');assert.equal(s.stage,'upkeep');assert(playView(s).priority);s=A(s,'pass');assert.equal(s.stage,'draw');assert.equal(s.hand[0].name,'Forest');s=A(s,'pass');assert.equal(s.stage,'next-main');
s=A(s,'tap:forest-a');assert.equal(s.mana,1);s=A(s,'tap:forest-a');assert.equal(s.mana,1);s=A(s,'combat');assert.equal(s.mana,0);s=A(s,'pass');s=A(s,'attack-bears');assert(s.yours.find(c=>c.id==='bears').selectedAttack);assert(!s.yours.find(c=>c.id==='bears').tapped,'selecting attackers is not declaration');
s=A(s,'attack-bears');assert(!s.yours.find(c=>c.id==='bears').selectedAttack);s=A(s,'attack-bears');s=A(s,'confirm-attacks');assert(s.yours.find(c=>c.id==='bears').attacking);assert(s.yours.find(c=>c.id==='bears').tapped);assert.equal(s.opponentLife,20);
s=A(s,'pass');assert.equal(s.stage,'opponent-blockers');assert.equal(s.opponentLife,20,'do not skip the post-block priority window');s=A(s,'pass');assert.equal(s.opponentLife,18);assert(s.complete);assert.equal(A(s,'pass').opponentLife,18);
// Manual payment, including cancellation after tapping, must preserve resources.
s=createPlayState('first-turn');s=A(s,'play-forest');s=A(s,'cast-bears');s=A(s,'tap:forest-a');w=A(s,'cancel-cast');assert(w.yours[0].tapped);assert.equal(w.mana,1);assert.equal(w.hand.length,1);
s=A(s,'tap:forest-b');s=A(s,'pay-mana');assert.equal(s.mana,0);assert.equal(s.stack[0].name,'Grizzly Bears');
// Blocking is assigned then confirmed; no tapping, no early damage.
s=createPlayState('blocking');w=A(s,'assign-block');assert.equal(w.blockTarget,null);s=A(s,'block-lion');assert(s.selectedBlocker);assert(!s.yours[0].tapped);s=A(s,'assign-block');assert.equal(s.blockTarget,'enemy-bears');assert(!s.yours[0].blocking);assert.equal(s.yourLife,2);s=A(s,'block-lion');assert.equal(s.blockTarget,null);s=A(s,'block-lion');s=A(s,'assign-block');s=A(s,'confirm-blocks');assert(s.yours[0].blocking);assert(!s.yours[0].tapped);s=A(s,'pass');assert(s.complete);assert.equal(s.yourLife,2);assert.deepEqual(s.yourGraveyard,['Silvercoat Lion']);assert.deepEqual(s.theirGraveyard,['Grizzly Bears']);
w=A(A(createPlayState('blocking'),'confirm-blocks'),'pass');assert(w.failed);assert.equal(w.yourLife,0);
// Targets precede mana payment, and each stack object gets its own window.
s=createPlayState('response');s=A(s,'choose-growth');assert.equal(s.stage,'target');assert.equal(s.mana,0);assert(!playView(s).priority);w=A(s,'target-player');assert.equal(w.stage,'target');assert.equal(w.hand.length,1);
s=A(s,'target-bears');assert.equal(s.stage,'pay-growth');assert.equal(s.hand.length,1);assert(!s.yours[0].tapped);w=A(s,'cancel-cast');assert.equal(w.stage,'respond');assert.equal(w.stack.length,1);
s=A(s,'pay-auto');assert.equal(s.mana,0);assert(s.yours[0].tapped);assert.deepEqual(s.stack.map(c=>c.id),['bolt','growth']);s=A(s,'pass');assert.equal(s.stage,'bolt-stack');assert.equal(s.stack.length,1);assert.equal(s.yours.find(c=>c.id==='bears').toughness,5);assert.equal(s.yours.find(c=>c.id==='bears').damage,0);s=A(s,'pass');assert.equal(s.yours.find(c=>c.id==='bears').damage,3);assert.equal(s.yours.find(c=>c.id==='bears').toughness,5);assert(!s.complete);s=A(s,'cleanup');assert(s.complete);assert.equal(s.yours.find(c=>c.id==='bears').damage,0);assert.equal(s.yours.find(c=>c.id==='bears').toughness,2);
w=A(createPlayState('response'),'pass');assert(w.failed);assert.equal(w.yourLife,20);assert(!w.yours.some(c=>c.id==='bears'));
assert.equal(playView(createPlayState('blocking')).primary.text,'No Blocks');assert.equal(playView({...createPlayState('response'),stage:'pay-growth'},false).primary.action,'pay-mana');
console.log('MTG play: atomic payment, target order, combat selection and confirmation, priority windows, turn steps and cleanup passed.');
