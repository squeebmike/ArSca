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
let r = B.addBeastXp(b, 25, S, 1); assert.equal(r.events.length, 0); b = r.beasts; assert.equal(b.xp, 25);
r = B.addBeastXp(b, 10, S, 2); assert.deepEqual(r.events.map(e => e.kind), ['caught']); assert.equal(r.events[0].name, B.wildName(1, 0)); b = r.beasts;
r = B.addBeastXp(b, 70, S, 3); assert.deepEqual(r.events.map(e => e.kind), ['caught', 'caught', 'rival']); b = r.beasts;
assert.equal(b.phase, 'rival'); assert.equal(b.rivalHp, 45, 'leftover $5 hits the rival (HP 50)');
assert.equal(r.events[2].trainer, B.rivalFor(1).name);
r = B.addBeastXp(b, 50, S, 4); assert.deepEqual(r.events.map(e => e.kind), ['badge']); b = r.beasts;
assert.equal(b.route, 2); assert.equal(b.phase, 'route'); assert.equal(b.xp, 5, 'leftovers carry on'); assert.equal(b.badges.length, 1); assert.equal(b.caught.length, 3);
assert.equal(B.beastGoal(S, 2), 110, 'each route needs more');
const pub = B.publicBeasts(b, S); assert.equal(pub.route, 2); assert.equal(pub.floor, 2); assert.equal(pub.phase, 'floor'); assert.equal(pub.badges, 1); assert.equal(pub.caughtCount, 3); assert.equal(pub.rival.name, B.rivalFor(2).name);
assert.equal(B.adjustBeasts(b, { route: 5 }, 'w').route, 5); assert.equal(B.adjustBeasts(b, { reset: true }, 'w2').route, 1); assert.throws(() => B.adjustBeasts(b, { route: 0 }, 'w'));
assert.equal(B.ensureBeasts(b, 'next-week').route, 1, 'a new week starts at route 1'); assert.equal(B.ensureBeasts(b, '2026-11-11'), b);
assert.ok(!/Math\.random/.test(read('scripts/beasts.mjs')), 'nothing by chance');
// 2. The server: Beasts on, sales/taps/+$/trivia go to Beasts only; the dungeon's votes are refused; and the other way round.
const room = read('scripts/live-studio-room.mjs');
for (const k of ["s.beasts = ensureBeasts(s.beasts, weekKey());", "beasts: publicBeasts(state.beasts, state.settings),", "if (s.stats.gross > grossBefore && this.beastsOn(s)) {", "} else if (s.stats.gross > grossBefore) {", "if (this.beastsOn(s)) return this.beastsIn(s, tapMana(s.settings, kind), now,", "if (this.beastsOn(s) && ['weapon', 'door', 'fork', 'dig', 'merchant'].includes(kind)) throw", "if (!this.beastsOn(s) && ['move', 'starter'].includes(kind)) throw", "s.beasts = adjustBeasts(s.beasts, { route: input.floor, reset: !!input.resetWeek }, weekKey(now), now);", "if (this.beastsOn(s)) s.beasts = addBeastXp(s.beasts, Number(s.settings.triviaMana)"]) assert.ok(room.includes(k), k);
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
console.log('Long Box Beasts, a separate game: passed');
