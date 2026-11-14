// LONG BOX BEASTS, A SEPARATE GAME (store, 2026-11-13: "they should be totally
// separate games"): its own track -- routes, wild beasts beaten, the route's
// rival, badges -- apart from the dungeon's floors, chests, doors and bosses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const B = await import('../scripts/beasts.mjs'), M = await import('../scripts/live-studio-model.mjs');
const S = { ...M.DEFAULT_STUDIO, beastsGoal: 100, beastsGrowth: 10 };
// 1. The engine: dollars walk the route, the three wild beasts fall as you pass, the rival steps up, a badge.
let b = B.emptyBeasts('2026-11-11');
const onRoute = r => ({ ...r, events: r.events.filter(e => e.kind !== 'level' && e.kind !== 'evolve') }); // levels: tests/beasts-levels.test.mjs
let r = onRoute(B.addBeastXp(b, 25, S, 1)); assert.equal(r.events.length, 0); b = r.beasts; assert.equal(b.xp, 25);
r = onRoute(B.addBeastXp(b, 10, S, 2)); assert.deepEqual(r.events.map(e => e.kind), ['caught']); assert.equal(r.events[0].name, B.wildName(1, 0)); b = r.beasts;
r = onRoute(B.addBeastXp(b, 70, S, 3)); assert.deepEqual(r.events.map(e => e.kind), ['caught', 'caught', 'rival']); b = r.beasts;
assert.equal(b.phase, 'rival'); assert.equal(b.rivalHp, 45, 'leftover $5 hits the rival (HP 50)');
assert.equal(r.events[2].trainer, B.rivalFor(1).name);
r = onRoute(B.addBeastXp(b, 50, S, 4)); assert.deepEqual(r.events.map(e => e.kind), ['badge']); b = r.beasts;
assert.equal(b.route, 2); assert.equal(b.phase, 'route'); assert.equal(b.xp, 5, 'leftovers carry on'); assert.equal(b.badges.length, 1); assert.equal(b.caught.length, 3);
assert.equal(B.beastGoal(S, 2), 110, 'each route needs more');
const pub = B.publicBeasts(b, S); assert.equal(pub.route, 2); assert.equal(pub.floor, 2); assert.equal(pub.phase, 'floor'); assert.equal(pub.badges, 1); assert.equal(pub.caughtCount, 3); assert.equal(pub.rival.name, B.rivalFor(2).name);
assert.equal(B.adjustBeasts(b, { route: 5 }, 'w').route, 5); assert.equal(B.adjustBeasts(b, { reset: true }, 'w2').route, 1); assert.throws(() => B.adjustBeasts(b, { route: 0 }, 'w'));
assert.equal(B.ensureBeasts(b, 'next-week').route, 1, 'a new week starts at route 1'); assert.equal(B.ensureBeasts(b, '2026-11-11'), b);
assert.ok(!/Math\.random/.test(read('scripts/beasts.mjs')), 'nothing by chance');
// 2. The server: Beasts on, sales/taps/+$/trivia go to Beasts only; the dungeon's votes are refused; and the other way round.
const room = read('scripts/live-studio-room.mjs');
for (const k of ["s.beasts = ensureBeasts(s.beasts, weekKey());", "beasts: publicBeasts(state.beasts, state.settings, state.beastStarter || ''),", "if (s.stats.gross > grossBefore && this.beastsOn(s)) {", "} else if (s.stats.gross > grossBefore && !this.vendingOnly(s)) {", "if (this.beastsOn(s)) { s.beasts = addBeastDrop(s.beasts, kind, s.settings, now); return this.beastsIn(s, tapMana(s.settings, kind), now,", "if (this.beastsOn(s) && ['weapon', 'door', 'fork', 'dig', 'merchant'].includes(kind)) throw", "if (!this.beastsOn(s) && ['move', 'starter'].includes(kind)) throw", "s.beasts = adjustBeasts(s.beasts, { route: input.floor, reset: !!input.resetWeek }, weekKey(now), now);", "if (this.beastsOn(s)) s.beasts = addBeastXp(s.beasts, Number(s.settings.triviaMana)"]) assert.ok(room.includes(k), k);
assert.ok(!/I CHOOSE YOU/.test(room), 'no one else\'s catchphrases');
// 3. Its own effect.
const fx = M.makeEffect('beast', S, 1, { beastEvent: 'badge', beastName: 'flipwraith', trainer: 'scalper steve', route: 1, badges: 1 });
assert.equal(fx.beastEvent, 'badge'); assert.equal(fx.trainer, 'SCALPER STEVE'); assert.equal(M.makeEffect('beast', S, 1, { beastEvent: 'nope' }).beastEvent, 'caught');
assert.equal(M.validateSettings({ ...S, beastsGoal: 250 }).beastsGoal, 250);
// 4. The screens read Beasts' own track.
const ov = read('scripts/live-studio-overlay.mjs'), bg = read('scripts/shed-background.mjs'), ctl = read('scripts/live-studio-controls.js');
for (const k of ["const gd=()=>settings.gameMode==='beasts'?(stats.beasts||null):dg();", "const b=curBoss(),d=gd();", "if(beastMode()){\n    const rv=d.rival", "case 'beast':", "if(b.show&&!beastMode()){"]) assert.ok(ov.includes(k), k);
assert.ok(bg.includes("const d = settings0.gameMode === 'beasts' ? (stats?.beasts ||"));
// 5. The remote: Beasts' own section; the other game's sections step aside; the preview demo plays Beasts on its own track.
for (const k of ['<h3>👾 Beasts controls</h3>', '<h3>👾 Beasts settings</h3>', 'id="beast-status"', 'id="beast-add-go"', 'id="beast-route"', 'id="beast-reset"', "num('beastsGoal'", "const DUNGEON_ONLY=['🗡 Dungeon controls','🗡 Dungeon settings','Boss battle'],BEASTS_ONLY=['👾 Beasts controls','👾 Beasts settings'];", 'const r=beastsLib.addBeastXp(demoBeasts,amount,v);']) assert.ok(ctl.includes(k), k);
assert.ok(ctl.indexOf('<h3>👾 Beasts settings</h3>') < ctl.indexOf('name="beastsMoves"') && ctl.indexOf('name="beastsMoves"') < ctl.indexOf('<h3>🗡 Dungeon settings</h3>'), 'Beasts settings live in its own section');
// 6. (2026-11-13: "the pokemon doesn't respond to demo sale... still has old graphics. Why no chibi?")
// The demo counts each sale (it sat in a comment, so the Beasts demo crashed on its empty start); the remote's
// game modules are versioned (a phone kept an old beasts.mjs); the route always draws the chibi walkers.
assert.ok(/amount=v\.gameMode==='beasts'\?\[4,3,5,4,6\]\[demo%5\]:\[12,45,8,150,25\]\[demo%5\];demo\+\+;/.test(ctl.replace(/ /g, '')), 'the demo counts its sales');
assert.ok(!/fightsdemo\+\+/.test(ctl));
assert.ok(ctl.includes("const STUDIO_V='") && !/import\('\.\/(beasts|vending|live-studio-dungeon)\.mjs'\)/.test(ctl), 'versioned imports');
assert.ok(ctl.includes("try{demoSale();}catch(e){status.textContent='Demo: '"), 'a failing demo says so');
const bsrc = read('scripts/beasts.mjs'); assert.ok(bsrc.includes("drawSprite(img, w, sx(p.x), sy(p.y) + 4, 'host', dir, step);") && !/validFace\(face\)\) drawPerson/.test(bsrc), 'always the chibi walkers');
// 7. (2026-11-13: "change directions when walking up down left right ... we never get hit ... what happens if we lose? ... longer route, varying scenery")
const rt = B.routeFor(3); assert.equal(B.MAP_H, 128); assert.ok(rt.len > 140, 'a longer walk');
assert.ok(rt.walk.every((p, i) => !i || p[0] === rt.walk[i - 1][0] || p[1] === rt.walk[i - 1][1]), 'straight runs only (so you face the way you walk)');
const dirs = new Set(); for (let t = 0; t <= 1; t += 0.002) { const p = B.posAt(rt, t); dirs.add(p.dx < 0 ? 'left' : p.dx > 0 ? 'right' : p.dy < 0 ? 'up' : 'down'); }
assert.ok(dirs.has('up') && (dirs.has('left') || dirs.has('right')), 'up, and across on the turns');
assert.equal(B.biomesFor(3).length, 3); assert.equal(new Set(B.biomesFor(3)).size, 3, 'three different stretches');
const seen = new Set(); for (let f = 1; f <= 12; f++) for (const b of B.biomesFor(f)) seen.add(b); assert.ok(seen.size >= 5, 'the scenery varies route to route');
assert.deepEqual(B.routeFor(3).grid, B.routeFor(3).grid, 'the same route on every screen');
assert.equal(B.battleFrom({ floor: 1, pct: 25, phase: 'floor' }, { battery: 0 }).mine.hp, 0, 'your beast can faint');
assert.equal(B.beastHpFrom(0), 1); assert.equal(B.beastHpFrom(1000, 1000 + B.BEAST_DRAIN_MS), 0); assert.ok(B.beastHpFrom(1000, 1000 + B.BEAST_DRAIN_MS / 2) === 0.5);
assert.ok(B.FOE_MOVES.includes(B.foeMoveFor('SLEEVEMOTH')));
const bsrc2 = read('scripts/beasts.mjs'); for (const k of ["foeAnim = { kind: moveAnim(mv), at: performance.now() }; msg = (next.kind === 'wild' ? 'WILD ' : 'FOE ')", "' FAINTED! CHAT: FOLLOW/SHARE TO REVIVE'", "' IS BACK ON ITS FEET!'"]) assert.ok(bsrc2.includes(k), k);
assert.ok(!/Math\.random/.test(bsrc2));
console.log('Long Box Beasts, a separate game: passed');
