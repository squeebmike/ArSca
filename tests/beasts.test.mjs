// LONG BOX BEASTS (2026-11-13: "a pokemon version ... top down ... the player
// looks like me or Champ ... start with the Game Boy version, phase 1 and 2.
// How can we use chat's attacks? Generate mons or attacks on the fly?").
// Our own monster-battler: original beasts and moves, made from their names.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const B = await import('../scripts/beasts.mjs'), M = await import('../scripts/live-studio-model.mjs'), D = await import('../scripts/live-studio-dungeon.mjs');
const src = read('scripts/beasts.mjs');
assert.ok(!/Math\.random/.test(src), 'nothing by chance: the same beast and move on every screen');
assert.ok(!/pok[eé]|nintendo|pikachu|pokeball/i.test(src.replace(/^\/\/.*$/gm, '')), 'no one else\'s names in the game itself');
// Beasts from names: the same name, the same beast; different names, different beasts.
const a = B.makeBeast('SLABBIT'), a2 = B.makeBeast('SLABBIT'), c = B.makeBeast('FOILMOTH');
assert.deepEqual(a.px, a2.px); assert.notDeepEqual(a.px, c.px);
assert.equal(a.px.length, 32); assert.equal(a.frames.length, 4, 'four idle frames'); assert.notDeepEqual(a.frames[0], a.frames[2], 'it moves'); assert.ok(a.blink, 'it blinks'); assert.ok(a.px.flat().some(v => v === 3) && a.px.flat().some(v => v === -1));
assert.equal(B.wildName(3, 1), B.wildName(3, 1)); assert.notEqual(B.wildName(1, 0), B.wildName(1, 1));
// Attacks: chat can invent one; its name picks the animation.
assert.equal(B.moveAnim('PRICE CHECK'), 'coins'); assert.equal(B.moveAnim('HOT TAKE FIRE'), 'flame'); assert.equal(B.moveAnim('SLAB TOSS'), 'card'); assert.equal(B.moveAnim('LOWBALL'), 'ball');
assert.ok(['card', 'slam', 'zap', 'shout', 'ball'].includes(B.moveAnim("MOM'S BASEMENT")));
assert.deepEqual(B.movesFrom(''), B.DEFAULT_MOVES); assert.deepEqual(B.movesFrom("mom's basement"), ["MOM'S BASEMENT", ...B.DEFAULT_MOVES.slice(0, 3)]);
// The walk stands still in the tall grass while a wild beast is up; battles from the show's state.
assert.equal(B.walkAt(0.22), B.walkAt(0.29)); assert.ok(B.walkAt(0.5) < B.walkAt(0.6)); assert.equal(B.walkAt(1), 1);
const w = B.battleFrom({ floor: 2, phase: 'floor', pct: 26 }); assert.equal(w.kind, 'wild'); assert.equal(w.foe.name, B.wildName(2, 0)); assert.ok(Math.abs(w.foe.hp - 0.5) < 0.01);
assert.equal(B.battleFrom({ floor: 2, phase: 'floor', pct: 40 }), null);
const rv = B.battleFrom({ floor: 2, phase: 'boss', pct: 30, boss: { name: 'THE SCALPER' } }); assert.equal(rv.kind, 'rival'); assert.equal(rv.foe.hp, 0.3);
assert.equal(B.shelfFrom({ floor: 2, phase: 'floor', pct: 60 }).length, 5, 'beaten beasts join your shelf');
// The route: walled in by trees, a path from your shop to the rival's.
const r = B.routeFor(4); assert.equal(r.grid.length, B.MAP_H); assert.ok(r.grid.every(row => row[0] === 3 && row[B.MAP_W - 1] === 3));
assert.ok(r.grid.flat().includes(11) && r.grid.flat().includes(12) && r.grid.flat().includes(2), 'your shop, the rival\'s, tall grass');
// Settings: the mode, your face (144 digits in four greens), the attacks (no chance words).
const S = { ...M.DEFAULT_STUDIO };
assert.ok(M.validateSettings({ gameMode: 'beasts', beastsFace: '0123'.repeat(36), beastsMoves: 'LOWBALL' }));
assert.throws(() => M.validateSettings({ gameMode: 'pong' }), /gameMode/);
assert.throws(() => M.validateSettings({ beastsFace: 'abc' }), /beastsFace/);
assert.throws(() => M.validateSettings({ beastsMoves: 'RAFFLE BLAST' }), /chance/);
assert.equal(D.DUNGEON_DEFAULTS.gameMode, 'dungeon', 'the dungeon stays the default');
assert.equal(M.makeEffect('move', S, Date.now(), { move: 'lowball' }).move, 'LOWBALL');
// Wiring: chat's vote, the green screen's route, the overlay's battle, the remote.
const room = read('scripts/live-studio-room.mjs'), ov = read('scripts/live-studio-overlay.mjs'), bg = read('scripts/shed-background.mjs'), ctl = read('scripts/live-studio-controls.js');
assert.match(room, /else if \(kind === 'move'\) options = movesFrom\(s\.settings\.beastsMoves\)/);
assert.match(room, /if \(v\.kind === 'move'\) \{ s\.beastMove = index; fx = makeEffect\('move'/);
assert.match(bg, /world = beasts\.createWorld\(canvas/); assert.match(ov, /battle=beastsLib\.createBattle\(cv,\{scale:3\}\)/);
assert.match(ov, /if\(e\.kind==='move'\)\{if\(beastsOn&&battle\)\{battle\.attack\(e\.move\)/, 'chat\'s pick fires');
assert.match(ov, /if\(beastsOn&&battle&&\['sold','jackpot','boss'\]\.includes\(e\.kind\)\)/, 'every sale fires it');
assert.ok(ctl.includes('name="gameMode"') && ctl.includes('id="beast-face-file"') && ctl.includes('id="beast-buddy-file"') && ctl.includes('id="beast-add-move"') && ctl.includes('data-vote="move"'));
assert.ok(read('arcade-overlay.html').includes('<canvas id="beast-battle"'));
assert.ok(read('.github/workflows/deploy-worker.yml').includes('scripts/beasts.mjs'));
// The host and Champ, drawn (2026-11-13: "put us in there recognizable"): 16 x 20 a direction, four greens.
for (const who of ['host', 'champ']) for (const d of ['down', 'up', 'side']) for (const fr of B.PEOPLE[who][d]) { assert.equal(fr.length, 16, 'chibi: 16 x 16'); assert.ok(fr.every(r => r.length === 16 && /^[.0-3]+$/.test(r)), who + ' ' + d); }
assert.equal(typeof B.drawTrainer, 'function', 'the trainers for battles');
assert.match(src, /drawTrainer\(img, W, 2 - slide, 54, 'host'\); drawTrainer\(img, W, 40 - slide, 54, 'champ'\);/, 'both of you open every battle');
assert.match(read('scripts/live-studio-overlay.mjs'), /battle\?\.setRival\(c\)/, 'the rival trainer is the boss, in four greens');
assert.notDeepEqual(B.PEOPLE.host.down, B.PEOPLE.champ.down);
assert.match(src, /drawSprite\(img, w, sx\(p\.x\), sy\(p\.y\) \+ 4, 'host'/, 'you walk the route'); assert.match(src, /drawSprite\(img, w, sx\(q\.x\), sy\(q\.y\) \+ 6, 'champ'/, 'Champ a step behind');
// Chat picks the starter; the classic layout (theirs facing you top right, yours from behind bottom left); the vending machine.
assert.deepEqual(B.STARTERS, ['SLABBIT', 'TOPLOADON', 'SLEEVIL']);
assert.equal(B.battleFrom({ floor: 1, phase: 'floor', pct: 25 }, { starter: 'SLEEVIL' }).mine.name, 'SLEEVIL');
assert.equal(B.battleFrom({ floor: 1, phase: 'floor', pct: 25 }, { starter: 'NOPE' }).mine.name, B.STARTER, 'only a real starter');
assert.notDeepEqual(B.makeBeast('SLABBIT', { back: true }).px, B.makeBeast('SLABBIT').px, 'yours from behind');
assert.match(src, /drawBeast\(beast\(b\.mine\.name, true\), 28 \+ lunge, 42/, 'yours bottom left, from behind'); assert.match(src, /drawBeast\(beast\(b\.foe\.name\), 152 \+ shake, 4/, 'theirs top right');
assert.match(room, /else if \(kind === 'starter'\) options = STARTERS\.map/); assert.match(room, /if \(v\.kind === 'starter'\) \{ s\.beastStarter = opt\.id;/);
assert.match(room, /setMachine\(input = \{\}\) \{/); assert.match(room, /this\.machineSold\(s, event\.data, moved \? wasNow : null\)/, 'a sale marks its item SOLD OUT');
assert.match(read('scripts/live-studio-api.mjs'), /room\.setMachine\(body\)/);
assert.match(bg, /drawMachine = v\.createVending\(document, \{ img, where: 'green' \}\)/); // the machine itself: tests/vending.test.mjs
assert.ok(ctl.includes('id="vm-load"') && ctl.includes('data-vote="starter"'));
// Better, animated beasts (2026-11-13: "need better and animated sprites for the mons"): body types, 32 x 32, four frames.
for (const n of B.STARTERS) assert.ok(['biped', 'quad'].includes(B.beastType(n)), n);
assert.equal(new Set(['FOILMOTH', 'PENNYSNAIL', 'HOLOIMP', 'GRAILAROO', 'KEYTOAD', 'NEWSOWL'].map(B.beastType)).size >= 3, true, 'different body types');
assert.match(src, /blink = bt\.blink && \(t % 3\.7\) < 0\.14/, 'a blink now and then'); assert.match(src, /const faint = b\.foe\.hp <= 0\.002/, 'knocked out, it sinks away');
console.log('beasts: original beasts and moves from names, the route, battles, chat\'s attacks, your face, wiring passed');
