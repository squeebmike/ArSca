import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deckLabEngineSource} from '../scripts/mtg/deck-lab-match.mjs';
import {deckLabBody,deckLabClient,handleDeckLab} from '../scripts/mtg/deck-lab-page.mjs';
const createDeckLabEngine=()=>new Function(deckLabEngineSource+'return Engine;')();
const E=createDeckLabEngine();
const forest={name:'Forest',type_line:'Basic Land â€” Forest',mana_cost:'',oracle_text:''},mountain={...forest,name:'Mountain',type_line:'Basic Land â€” Mountain'};
const bear={name:'Grizzly Bears',type_line:'Creature â€” Bear',mana_cost:'{1}{G}',power:'2',toughness:'2',cmc:2,oracle_text:''};
const bolt={name:'Lightning Bolt',type_line:'Instant',mana_cost:'{R}',oracle_text:'Lightning Bolt deals 3 damage to any target.'},growth={name:'Giant Growth',type_line:'Instant',mana_cost:'{G}',oracle_text:'Target creature gets +3/+3 until end of turn.'};
const deck=(land,creature=bear)=>[...Array.from({length:24},()=>land),...Array.from({length:36},()=>creature)];
const s=E.create([deck(forest),deck(mountain)],{random:()=>.5,mode:'bot'});
const count=s=>s.players.flatMap(p=>['hand','library','field','graveyard','exile'].flatMap(z=>p[z])).concat(s.stack.map(t=>t.card));
assert.equal(count(s).length,120);assert.equal(new Set(count(s).map(c=>c.id)).size,120);
const parsed=E.parse('Deck\n4 Grizzly Bears (M10) 178\n24 Forest\nSideboard\n2 Shock');assert.equal(parsed.entries[0].set,'m10');assert.equal(parsed.entries[2].section,'sideboard');assert.equal(E.parse('<script>alert(1)</script>').errors.length,1);assert.equal(E.parse('251 Forest').errors.length,1);
assert.equal(E.support({...bear,oracle_text:'Flying'}).kind,'manual');assert.equal(E.support({...forest,name:'Misty Rainforest'}).kind,'manual');assert.throws(()=>E.create([deck(forest,{...bear,oracle_text:'Flying'}),deck(mountain)],{mode:'bot'}),/supported/);
E.mulligan(s,0,()=>.2);assert.throws(()=>E.keep(s,0,[]));const bottom=s.players[0].hand[0].id;E.keep(s,0,[bottom]);assert.equal(s.players[0].hand.length,6);assert.equal(s.players[0].library.at(-1).id,bottom);assert.equal(s.phase,'main1');assert.equal(s.players[0].library.length,54);
// Build a real stack response with unique physical cards, pay exact colored mana.
const t=E.create([deck(forest),deck(mountain)],{mode:'bot',random:()=>.3});E.keep(t,0);t.phase='main1';
const a=t.players[0],b=t.players[1];function relocate(p,c,zone){const pool=['hand','library','field','graveyard','exile'];let original;for(const z of pool){const i=p[z].findIndex(x=>x.name===c.name);if(i>=0){original=p[z].splice(i,1)[0];break;}}const id=original?.id||'fixture-'+p.field.length+'-'+p.hand.length;const card={...c,id,damage:0,boost:0,tapped:false,sick:false};p[zone].push(card);return card;}
a.field=[];a.hand=[];const f1=relocate(a,forest,'field'),f2=relocate(a,forest,'field');const creature=relocate(a,bear,'field'),pump=relocate(a,growth,'hand');b.field=[];relocate(b,mountain,'field');const removal=relocate(b,bolt,'hand');
t.priority=1;E.cast(t,1,removal.id,creature.id);E.pass(t,1);E.cast(t,0,pump.id,creature.id);E.pass(t,0);E.pass(t,1);assert.equal(creature.boost,3);E.pass(t,0);E.pass(t,1);assert.equal(creature.damage,3);assert(a.field.includes(creature));assert.equal(t.stack.length,0);assert(f1.tapped||f2.tapped);
assert.equal(E.payment({field:[{...mountain,id:'red',tapped:false}]},'{G}'),null);
// Attack/block legality, simultaneous lethal damage and no damage through a block.
t.phase='attack';t.active=0;t.priority=0;creature.boost=0;creature.damage=0;creature.tapped=false;const blocker=relocate(b,bear,'field');E.attack(t,0,[creature.id]);assert(creature.tapped);E.pass(t,0);E.pass(t,1);E.block(t,1,{[creature.id]:blocker.id});assert.equal(blocker.tapped,false);E.pass(t,0);E.pass(t,1);assert(a.graveyard.some(c=>c.id===creature.id));assert(b.graveyard.some(c=>c.id===blocker.id));assert.equal(b.life,20);
const manual=E.create([deck(forest),deck(mountain)],{mode:'manual'});const id=manual.players[0].hand[0].id;E.manual(manual,{player:0,from:'hand',to:'exile',id});assert(manual.players[0].exile.some(c=>c.id===id));assert.equal(count(manual).length,120);assert.throws(()=>E.manual(t,{player:0,kind:'life',value:20}));
// A practiced opponent really responds to a lethal removal spell.
const reaction=E.clone(t);reaction.skill='practiced';reaction.phase='main1';reaction.priority=1;reaction.active=0;reaction.stack=[];reaction.players[1].field=[];reaction.players[1].hand=[];
relocate(reaction.players[1],forest,'field');const protectedCard=relocate(reaction.players[1],bear,'field'),savedPump=relocate(reaction.players[1],growth,'hand');reaction.stack.push({card:bolt,controller:0,target:protectedCard.id});
assert(E.bot(reaction));assert.equal(reaction.stack.at(-1).card.id,savedPump.id);
// Multiple blockers deal simultaneous damage; a blocker cannot block twice.
const multi=E.clone(t);multi.result=null;multi.phase='attack';multi.active=0;multi.priority=0;multi.players[0].field=[];multi.players[1].field=[];
const big=relocate(multi.players[0],{...bear,power:'4',toughness:'4'},'field'),one=relocate(multi.players[1],bear,'field'),two=relocate(multi.players[1],bear,'field');E.attack(multi,0,[big.id]);E.pass(multi,0);E.pass(multi,1);assert.throws(()=>E.block(multi,1,{[big.id]:[one.id,one.id]}));E.block(multi,1,{[big.id]:[one.id,two.id]});E.pass(multi,0);E.pass(multi,1);assert(multi.players[0].graveyard.some(c=>c.id===big.id));assert(multi.players[1].graveyard.some(c=>c.id===one.id));assert(multi.players[1].graveyard.some(c=>c.id===two.id));
new Function(deckLabEngineSource+'return Engine;')();new Function(deckLabClient);assert(deckLabBody().includes('Direct URL import is not available'));assert(deckLabBody().includes('dl-skill'));
const deps={shell:o=>o.bodyHtml};for(const path of ['/deck-lab','/deck-lab/app.js']){const r=handleDeckLab(new Request('https://test'+path),deps);assert.equal(r.status,200);assert.equal((await handleDeckLab(new Request('https://test'+path,{method:'HEAD'}),deps).text()),'');assert.equal(handleDeckLab(new Request('https://test'+path,{method:'POST'}),deps).status,405);}
assert(fs.readFileSync('scripts/mtg-academy.mjs','utf8').includes('href="/deck-lab"'));assert(fs.readFileSync('wrangler.deploy.jsonc','utf8').includes('www.themanapocket.com/deck-lab*'));
// Complete ordinary matches: no edits to match state, hidden cards or draws.
for(const skill of ['learner','regular','practiced']){
 let seed=431;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
 const goblin={...bear,name:'Goblin Piker',mana_cost:'{1}{R}',toughness:'1'};
 const match=E.create([deck(forest),[...Array.from({length:24},()=>mountain),...Array.from({length:28},()=>goblin),...Array.from({length:8},()=>bolt)]],{mode:'bot',skill,random});
 E.keep(match,0);let steps=0;
 while(!match.result&&steps++<2000){
  if(E.bot(match))continue;
  const human=match.players[0];
  if(match.phase==='attack'){E.attack(match,0,human.field.filter(c=>E.support(c).kind==='creature'&&!c.tapped&&!c.sick).map(c=>c.id));}
  else if(match.phase==='block'){const free=human.field.filter(c=>E.support(c).kind==='creature'&&!c.tapped),blocks={};for(const id of match.attackers){if(free.length)blocks[id]=free.shift().id;}E.block(match,0,blocks);}
  else if(match.phase==='discard')E.discard(match,0,human.hand[0].id);
  else{
   const l=human.hand.find(c=>E.support(c).kind==='land'),c=human.hand.find(c=>E.support(c).kind==='creature'&&E.payment(human,c.mana_cost));
   if(match.active===0&&['main1','main2'].includes(match.phase)&&!match.stack.length&&l&&!human.landPlayed)E.land(match,0,l.id);
   else if(match.active===0&&['main1','main2'].includes(match.phase)&&!match.stack.length&&c)E.cast(match,0,c.id);
   else E.pass(match,0);
  }
  assert.equal(count(match).length,120);assert.equal(new Set(count(match).map(c=>c.id)).size,120);
 }
 assert(match.result,'ordinary '+skill+' match reaches a result');console.log(skill+' opponent: completed '+match.turn+' turns / '+steps+' decisions');
}
console.log('Deck Lab import, rules coverage, London mulligan, colored mana, response stack, combat, freeform and routes passed');
