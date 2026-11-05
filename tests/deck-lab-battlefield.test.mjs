import assert from 'node:assert/strict';
import {deckLabEngineSource} from '../scripts/mtg/deck-lab-match.mjs';
import {battlefieldHelpers} from '../scripts/mtg/deck-lab-battlefield.mjs';
import {deckLabClient,deckLabBody} from '../scripts/mtg/deck-lab-page.mjs';
const elements=new Map(),document={addEventListener(){},getElementById(id){if(!elements.has(id))elements.set(id,{dataset:{motion:'idle'},textContent:'',classList:{contains:()=>true}});return elements.get(id);}},window={addEventListener(){}};
const ui=new Function('document','window',deckLabEngineSource+`
const $=id=>document.getElementById(id);let state=null,attacks=[],bottom=[],blocking={},renders=0,inspected=null;
function render(){renders++;}function inspect(c){inspected=c.id;}function act(fn){fn();intent=null;pendingBlocker=null;}
`+battlefieldHelpers+`;return {Engine,set:s=>state=s,get:()=>({state,attacks,bottom,blocking,pendingBlocker,intent,renders,inspected}),click:interactCard,target:chooseTarget,canPlay,statValue};`)(document,window);
const forest={id:'f-hand',name:'Forest',type_line:'Basic Land — Forest',oracle_text:''},bear={id:'b-hand',name:'Grizzly Bears',type_line:'Creature — Bear',oracle_text:'',power:'2',toughness:'2',mana_cost:'{1}{G}',sick:false,boost:0,damage:0},growth={id:'g-hand',name:'Giant Growth',type_line:'Instant',mana_cost:'{G}'};
const s=ui.Engine.create([Array(60).fill(forest),Array(60).fill(forest)],{mode:'bot'});s.phase='main1';s.priority=0;s.players[0].hand=[forest,bear,growth];s.players[0].field=[{...forest,id:'f1'},{...forest,id:'f2'},{...bear,id:'b-field'}];ui.set(s);
assert(ui.canPlay(forest));ui.click(forest,{p:0,zone:'hand'});assert(s.players[0].field.some(c=>c.id==='f-hand'));assert(!s.players[0].hand.some(c=>c.id==='f-hand'));assert.equal(ui.get().inspected,null);
ui.click(bear,{p:0,zone:'hand'});assert.equal(s.stack.at(-1).card.id,'b-hand');assert(s.players[0].field.find(c=>c.id==='f1').tapped);
ui.click(growth,{p:0,zone:'hand'});assert.equal(ui.get().intent.id,'g-hand');const before=s.stack.length;ui.target('player1');assert.equal(s.stack.length,before,'Giant Growth cannot target a player');assert(ui.get().intent);ui.target('b-field');assert.equal(s.stack.at(-1).target,'b-field');assert.equal(ui.get().intent,null);
s.stack=[];s.phase='attack';s.active=0;const blocker=s.players[0].field.find(c=>c.id==='b-field');ui.click(blocker,{p:0,zone:'field'});assert.deepEqual(ui.get().attacks,['b-field']);ui.click(blocker,{p:0,zone:'field'});assert.deepEqual(ui.get().attacks,[]);
s.phase='block';s.active=1;s.attackers=['op-bear'];s.players[1].field=[{...bear,id:'op-bear'}];ui.click(blocker,{p:0,zone:'field'});assert.equal(ui.get().pendingBlocker,'b-field');ui.click(s.players[1].field[0],{p:1,zone:'field'});assert.deepEqual(ui.get().blocking,{'op-bear':['b-field']});assert.equal(ui.get().pendingBlocker,null);
const opening=ui.Engine.create([Array(60).fill(forest),Array(60).fill(forest)],{mode:'bot'});ui.set(opening);ui.click(opening.players[0].hand[0],{p:0,zone:'hand'});assert.equal(ui.get().bottom.length,0,'Inspecting a seven-card opening hand does not accidentally select a bottom card');
assert.equal(ui.statValue('*'),'*');assert.equal(ui.statValue('1+*'),'1+*');assert.equal(ui.statValue('2',3),5);
new Function(deckLabClient);const html=deckLabBody();assert(html.includes('id="dl-phases"'));assert(html.includes('id="dl-lines"'));assert(html.includes('id="dl-view-log"'));
console.log('Battlefield interactions: direct land/cast, mana payment, exact legal targets, attack toggles, blocker assignment, opening inspection and complete browser script parse passed');
