import assert from 'node:assert/strict';
import {roomEngine as E,roomView,putRoomDeck,applyRoomAction} from '../scripts/mtg/deck-lab-room-model.mjs';
const land={name:'Forest',type_line:'Basic Land — Forest',color_identity:['G'],legalities:{commander:'legal'}},cmd={name:'Test Commander',type_line:'Legendary Creature — Elf',color_identity:['G'],legalities:{commander:'legal'},mana_cost:'{G}',power:'1',toughness:'1'};
const deck=()=>[{...cmd,deckSection:'commander'},...Array.from({length:99},()=>({...land,deckSection:'main'}))];
let room={revision:0,mode:'table',format:'commander',players:Array.from({length:4},(_,i)=>({name:'Seat '+i,searching:false})),state:null};
for(let i=0;i<4;i++){room=putRoomDeck(room,i,deck(),'Seat '+i,room.revision,()=>.5);assert.equal(!!room.state,i===3);}
assert.equal(room.state.players.length,4);assert(room.state.players.every(p=>p.life===40&&p.hand.length===7&&p.library.length===92&&p.commandZone.length===1));
for(let seat=0;seat<4;seat++){const v=roomView(room,seat);assert.equal(v.names[0],'Seat '+seat);assert.equal(v.state.players[0].hand[0].name,'Forest');for(let p=1;p<4;p++)assert(v.state.players[p].hand.every(c=>c.hidden&&!c.id));assert(v.state.players.every(p=>p.library.every(c=>c.hidden)));assert.equal(v.state.commanders.find(c=>c.owner===0).id,seat+'-0');}
room=applyRoomAction(room,2,{type:'mulligan',args:[0]},room.revision);assert.equal(room.state.players[2].mulligans,0);assert.equal(room.state.players[2].mulliganCount,1);
room=applyRoomAction(room,2,{type:'mulligan',args:[0]},room.revision);assert.equal(room.state.players[2].mulligans,1);
for(let i=0;i<4;i++)room=applyRoomAction(room,i,{type:'keep',args:[0,i===2?[room.state.players[2].hand[0].id]:[]]},room.revision);
assert.equal(room.state.phase,'main1');assert.match(room.state.log.at(-1),/starting player also draws/);
assert.throws(()=>applyRoomAction(room,1,{type:'turn'},room.revision),/active player/);
room=applyRoomAction(room,0,{type:'turn'},room.revision);assert.equal(room.state.active,1);room=applyRoomAction(room,1,{type:'turn'},room.revision);assert.equal(room.state.active,2);
room=applyRoomAction(room,2,{type:'manual',args:[{player:0,kind:'commander-cast',id:'2-0'}]},room.revision);assert.equal(roomView(room,2).state.stack[0].controller,0);assert.equal(roomView(room,3).state.stack[0].controller,3);
room=applyRoomAction(room,3,{type:'manual',args:[{player:0,kind:'commander-damage',id:'2-0',value:4}]},room.revision);assert.equal(room.state.players[3].commanderDamage['2-0'],4);assert.equal(room.state.players[3].life,40);
room=applyRoomAction(room,2,{type:'concede'},room.revision);assert.equal(room.state.result,null);assert.equal(room.state.active,3);assert.equal(room.state.stack.length,0);assert.equal(room.state.players[2].field.length,0);assert.throws(()=>applyRoomAction(room,2,{type:'turn'},room.revision),/out of this game/);
room=applyRoomAction(room,3,{type:'turn'},room.revision);assert.equal(room.state.active,0);room=applyRoomAction(room,0,{type:'turn'},room.revision);assert.equal(room.state.active,1);room=applyRoomAction(room,1,{type:'turn'},room.revision);assert.equal(room.state.active,3);
room=applyRoomAction(room,0,{type:'concede'},room.revision);assert.equal(room.state.result,null);room=applyRoomAction(room,1,{type:'concede'},room.revision);assert.equal(room.state.result.winner,3);assert.equal(roomView(room,3).state.result.winner,0);
console.log('Four-player Commander: four decks/40 life, private seats, cyclic projection, free first mulligan, turn rotation, per-source damage, elimination and last-player result passed');
