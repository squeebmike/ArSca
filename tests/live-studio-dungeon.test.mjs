// The Shed Dungeon: the mana flask, floors, floor bosses, the weekly reset,
// stars and the finale, taps, and per-show unlocks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOMS, RELICS, doorsFor, relicFor, parseRoomLines, weekKey, nextResetKey, ensureWeek, emptyDungeon, addMana, addTap, adjustDungeon, floorGoal, bossMax, publicDungeon, showUnlocksCrossed, parseLines, shedFor, SHEDS, DUNGEON_DEFAULTS } from '../scripts/live-studio-dungeon.mjs';
import { DEFAULT_STUDIO, validateSettings, applyOrder, emptyStats, makeEffect } from '../scripts/live-studio-model.mjs';

const S = { ...DEFAULT_STUDIO };
// Wed Nov 4 2026, noon Pacific = 20:00Z. Tue Nov 3 = last week.
const WED = Date.parse('2026-11-04T20:00:00Z'), TUE = Date.parse('2026-11-03T20:00:00Z'), NEXT_TUE = Date.parse('2026-11-10T20:00:00Z');
assert.equal(weekKey(WED), '2026-11-04');
assert.equal(weekKey(NEXT_TUE), '2026-11-04', 'Tuesday is still the same week');
assert.equal(weekKey(TUE), '2026-10-28');
// Just after midnight Wednesday Pacific (07:30Z) is the new week; just before is not.
assert.equal(weekKey(Date.parse('2026-11-04T08:30:00Z')), '2026-11-04');
assert.equal(weekKey(Date.parse('2026-11-04T06:30:00Z')), '2026-10-28');
assert.equal(nextResetKey(WED), '2026-11-11');

// Settings are in the studio defaults and validate.
for (const k of Object.keys(DUNGEON_DEFAULTS)) assert.ok(k in DEFAULT_STUDIO, k);
assert.deepEqual(validateSettings({ floorBase: 200, finale: true, showUnlocks: '100: Shoutout' }), { floorBase: 200, finale: true, showUnlocks: '100: Shoutout' });
assert.throws(() => validateSettings({ floorGrowth: 900 }), /Invalid floorGrowth/);
assert.throws(() => validateSettings({ floorRewards: '3: raffle for the grail' }), /game of chance.*floor rewards/);
assert.throws(() => validateSettings({ showUnlocks: '50: spin the wheel' }), /show unlocks/);

// Goals: $100 floor 1, +25% each floor; the boss has half.
assert.equal(floorGoal(S, 1), 100);
assert.equal(floorGoal(S, 2), 125);
assert.equal(floorGoal(S, 3), 156);
assert.equal(bossMax(S, 1), 50);
// The finale: +10% per star this week.
assert.equal(floorGoal({ ...S, finale: true }, 1, { stars: 3 }), 130);
assert.equal(SHEDS.length, 7);
assert.equal(shedFor(1), 'GARDEN SHED');
assert.equal(shedFor(50), 'THE SHED BENEATH THE SHED');

// Filling the floor brings the boss; beating it opens floor 2; leftovers carry.
let d = emptyDungeon(weekKey(WED));
let r = addMana(d, 60, S, WED);
assert.equal(r.dungeon.mana, 60); assert.equal(r.events.length, 0);
r = addMana(r.dungeon, 50, S, WED); // 40 fills it, 10 hits the boss
assert.equal(r.events[0].kind, 'floor'); assert.equal(r.events[0].floor, 1);
assert.equal(r.dungeon.phase, 'boss'); assert.equal(r.dungeon.bossHp, 40);
const rewards = { ...S, floorRewards: '1: Free giveaway in the Whatnot tool\n2: $1 start on a grail' };
r = addMana(r.dungeon, 45, rewards, WED);
assert.equal(r.events[0].kind, 'boss'); assert.equal(r.events[0].nextFloor, 2);
assert.equal(r.events[0].reward, 'Free giveaway in the Whatnot tool');
assert.equal(r.dungeon.floor, 2); assert.equal(r.dungeon.stars, 1); assert.equal(r.dungeon.mana, 5);
// A huge sale can clear several floors in one go.
r = addMana(emptyDungeon(weekKey(WED)), 1000, S, WED);
assert.ok(r.dungeon.floor >= 4, 'cleared several floors');
assert.equal(r.events.filter(e => e.kind === 'boss').length, r.dungeon.floor - 1);
// Off: nothing moves.
assert.equal(addMana(emptyDungeon(), 500, { ...S, dungeonOn: false }, WED).dungeon.floor, 1);

// The week resets on Wednesday; last week's result is kept.
const old = { ...emptyDungeon('2026-10-28'), floor: 4, stars: 3 };
const fresh = ensureWeek(old, WED);
assert.equal(fresh.floor, 1); assert.equal(fresh.stars, 0);
assert.deepEqual(fresh.lastWeek, { week: '2026-10-28', floor: 4, stars: 3, relics: 0 });
assert.equal(ensureWeek(old, TUE), old, 'same week is untouched');

// Taps: follow +5, share +5, bookmark +2.
r = addTap(emptyDungeon(weekKey(WED)), 'follow', S, WED);
assert.equal(r.amount, 5); assert.equal(r.dungeon.mana, 5); assert.equal(r.dungeon.taps.follow, 1);
assert.equal(addTap(r.dungeon, 'bookmark', S, WED).dungeon.mana, 7);
assert.throws(() => addTap(r.dungeon, 'like', S, WED), /Invalid tap/);

// Fixes: set the floor, reset the week.
assert.equal(adjustDungeon({ ...emptyDungeon(weekKey(WED)), mana: 40 }, { floor: 3 }, WED).floor, 3);
assert.throws(() => adjustDungeon(emptyDungeon(), { floor: 0 }, WED), /Invalid floor/);
const reset = adjustDungeon({ ...emptyDungeon(weekKey(WED)), floor: 5, stars: 4, lastWeek: { week: 'x', floor: 2, stars: 1 } }, { resetWeek: true }, WED);
assert.equal(reset.floor, 1); assert.equal(reset.stars, 0); assert.equal(reset.lastWeek.floor, 2);

// Per-show unlocks.
assert.deepEqual(parseLines('$100: Shoutout\n  junk\n50 - Pack opened on stream').map(x => x.n), [50, 100]);
assert.deepEqual(showUnlocksCrossed(40, 120, { showUnlocks: '50: A\n100: B\n200: C' }).map(x => x.text), ['A', 'B']);

// What the overlay sees.
const pub = publicDungeon({ ...emptyDungeon(weekKey(WED)), mana: 25 }, { ...S, showUnlocks: '100: Shoutout' }, 30, WED);
assert.equal(pub.floor, 1); assert.equal(pub.shed, 'GARDEN SHED'); assert.equal(pub.pct, 25); assert.equal(pub.goal, 100);
assert.equal(pub.boss.active, false); assert.equal(pub.nextUnlock.text, 'Shoutout'); assert.equal(pub.resets, '2026-11-11');
const pubBoss = publicDungeon({ ...emptyDungeon(weekKey(WED)), mana: 100, phase: 'boss', bossHp: 25 }, S, 0, WED);
assert.equal(pubBoss.pct, 50); assert.equal(pubBoss.boss.active, true);

// With the dungeon on, the show's old boss bar doesn't fire on a sale.
const order = { id: 'o1', show_id: 'show1', status: 'pending_fulfillment', transaction_type: 'auction', amounts: { subtotal: { amount: 600 } } };
assert.equal(applyOrder(emptyStats('show1'), order, { ...S, showId: 'show1' }).effect.kind, 'jackpot');
assert.equal(applyOrder(emptyStats('show1'), order, { ...S, showId: 'show1', dungeonOn: false }).effect.kind, 'boss');

// Effects carry the dungeon's fields, cleaned.
const fx = makeEffect('boss', S, WED, { dungeon: true, bossName: 'THE FLIPPER', bossCharacter: 'flipper', reward: 'Free giveaway', floor: 1, nextFloor: 2, shed: 'RUSTY TOOL SHED' });
assert.equal(fx.bossName, 'THE FLIPPER'); assert.equal(fx.nextFloor, 2); assert.equal(fx.reward, 'Free giveaway');
assert.equal(makeEffect('boss', S, WED, { dungeon: true, bossCharacter: 'nope' }).bossCharacter, S.bossCharacter);
assert.equal(makeEffect('tap', S, WED, { tapKind: 'share', mana: 5 }).tapKind, 'share');
assert.equal(makeEffect('unlock', S, WED, { unlockText: 'Shoutout', unlockAt: 100 }).unlockAt, 100);

// The room: sales fill the flask, taps and fixes have routes, stats show it.
const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8');
assert.match(room, /s\.dungeon = ensureWeek\(s\.dungeon\)/);
assert.match(room, /addMana\(s\.dungeon, Math\.round\(\(s\.stats\.gross - grossBefore\)/);
assert.match(room, /dungeon: publicDungeon\(/);
const api = readFileSync(new URL('../scripts/live-studio-api.mjs', import.meta.url), 'utf8');
assert.match(api, /\/live-studio\/dungeon-tap/); assert.match(api, /\/live-studio\/dungeon-adjust/);
// The overlay and the controls.
const overlay = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8');
assert.match(overlay, /'FLOOR '\+d\.floor\+' · '\+\(d\.room\?d\.room\.name:d\.shed\)/);
assert.match(overlay, /setProperty\('--fill'/);
const controls = readFileSync(new URL('../scripts/live-studio-controls.js', import.meta.url), 'utf8');
for (const k of ['data-tap="follow" data-key="F"', 'data-tap="share" data-key="Y"', 'data-tap="bookmark" data-key="B"', 'data-toggle="finale"', 'name="floorRewards"', 'name="showUnlocks"', 'mana-reset-week']) assert.ok(controls.includes(k), k);
// Chat picks the path: after a boss, two doors (fixed by the floor, no draw).
assert.deepEqual(doorsFor(2), ['vault', 'library']);
assert.deepEqual(doorsFor(3), ['armory', 'forge']);
assert.deepEqual(doorsFor(2 + ROOMS.length / 2), doorsFor(2), 'doors cycle in a set order');
let p = addMana(emptyDungeon(weekKey(WED)), 150, { ...S, roomRewards: 'library: Back issue spotlight' }, WED);
const bossEv = p.events.find(e => e.kind === 'boss');
assert.deepEqual(bossEv.doors, ['vault', 'library']);
assert.equal(bossEv.relic, RELICS[0].name);
assert.deepEqual(p.dungeon.doors, ['vault', 'library']);
let picked = adjustDungeon(p.dungeon, { door: 1 }, WED);
assert.equal(picked.rooms[2], 'library'); assert.equal(picked.doors, null);
assert.throws(() => adjustDungeon(picked, { door: 0 }, WED), /no doors/);
assert.throws(() => adjustDungeon(p.dungeon, { door: 2 }, WED), /Invalid door/);
const roomS = { ...S, roomRewards: 'library: Back issue spotlight\nnope: x' };
assert.deepEqual(parseRoomLines(roomS.roomRewards), { library: 'Back issue spotlight' });
let pub2 = publicDungeon(picked, roomS, 0, WED);
assert.equal(pub2.room.name, 'BACK ISSUE LIBRARY'); assert.equal(pub2.reward, 'Back issue spotlight');
assert.equal(pub2.relics.length, 1); assert.equal(pub2.relics[0].icon, relicFor(1).icon);
assert.deepEqual(pub2.map.map(m => [m.floor, m.cleared, m.current, m.dark]), [[1, true, false, false], [2, false, true, false], [3, false, false, true], [4, false, false, true]]);
assert.equal(pub2.map[1].room, 'BACK ISSUE LIBRARY');
// No pick before the next flask fills: door 1 it is.
const auto = addMana(p.dungeon, 200, S, WED);
assert.equal(auto.dungeon.rooms[2], 'vault');
assert.equal(auto.events[0].kind, 'room'); assert.equal(auto.events[0].auto, true);
// A new week clears the map but remembers last week's relics.
assert.equal(ensureWeek({ ...picked, week: '2026-10-28' }, WED).lastWeek.relics, 1);
// Effects carry rooms/doors by id only.
const rfx = makeEffect('room', S, WED, { room: 'vault', floor: 2, auto: true });
assert.equal(rfx.room, 'vault'); assert.equal(rfx.auto, true);
assert.equal(makeEffect('room', S, WED, { room: '<script>' }).room, undefined);
assert.deepEqual(makeEffect('boss', S, WED, { dungeon: true, doors: ['vault', 'bad', 'library'], relic: 'RUSTY TROWEL', relicIcon: '🪏' }).doors, ['vault', 'library']);
assert.throws(() => validateSettings({ roomRewards: 'vault: lottery ticket' }), /room rewards/);
assert.match(api, /door:body\.door/);
assert.match(overlay, /CHAT: PICK A DOOR!/);
assert.match(controls, /'dungeon-adjust',\{door:i\}/);
console.log('live-studio-dungeon: ok');
