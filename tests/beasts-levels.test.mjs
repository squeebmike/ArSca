// LEVELS, EVOLUTION, THE BEASTDEX (store, 2026-11-13: "can our monster level up and evolve? We need more to this
// game. We need it to tie into us selling on Whatnot and keeping the viewers watching" -- "add all that").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const B = await import('../scripts/beasts.mjs'), M = await import('../scripts/live-studio-model.mjs');
const S = { ...M.DEFAULT_STUDIO, beastsGoal: 100, beastsGrowth: 15 };
// XP and levels: LV 2 at 10, LV 5 at 100, LV 10 at 450, LV 20 at 1900.
assert.deepEqual([1, 2, 5, 10, 20].map(B.xpFor), [0, 10, 100, 450, 1900]);
assert.equal(B.levelFor(0), 1); assert.equal(B.levelFor(9.99), 1); assert.equal(B.levelFor(10), 2); assert.equal(B.levelFor(450), 10); assert.equal(B.levelFor(1e9), B.MAX_LEVEL);
// The lines: three forms each, our own names; evolve at LV 10 and 20.
for (const st of B.STARTERS) { assert.equal(B.EVOLUTIONS[st][0], st); assert.equal(B.EVOLUTIONS[st].length, 3); assert.equal(B.formName(st, 9), st); assert.equal(B.formName(st, 10), B.EVOLUTIONS[st][1]); assert.equal(B.formName(st, 20), B.EVOLUTIONS[st][2]); }
for (const n of Object.values(B.EVOLUTIONS).flat()) assert.ok(!/pok[eé]|chu|saur|mon$/i.test(n), n);
// Sales walk the levels: every dollar is XP; a new move every 5 levels; the evolution at 10.
let b = B.emptyBeasts('w'); const evs = []; for (let i = 0; i < 45; i++) { const r = B.addBeastXp(b, 10, S); b = r.beasts; evs.push(...r.events); }
assert.equal(b.exp, 450); assert.ok(evs.some(e => e.kind === 'level' && e.level === 5 && e.learn)); assert.ok(evs.some(e => e.kind === 'evolve' && e.level === 10 && e.stage === 1));
// The moment on screen: an evolution beats everything; a plain level up leaves the sale its own moment.
const evo = B.beastMoment([{ kind: 'caught', name: 'X' }, { kind: 'level', level: 10, learn: true }, { kind: 'evolve', level: 10, stage: 1 }], 'SLEEVIL', 'Free giveaway');
assert.deepEqual([evo.beastEvent, evo.fromName, evo.beastName, evo.reward], ['evolve', 'SLEEVIL', 'SLEEVILLAIN', 'Free giveaway']);
assert.equal(B.beastMoment([{ kind: 'level', level: 3, learn: false }], 'SLABBIT'), null);
assert.equal(B.beastMoment([{ kind: 'level', level: 5, learn: true }], 'SLABBIT').beastEvent, 'learn');
// What the screens see: level, XP to go, the next evolution, the form, the beastdex.
const pub = B.publicBeasts({ ...b, caught: [{ name: 'A' }, { name: 'A' }, { name: 'B' }] }, S, 'TOPLOADON');
assert.equal(pub.level, 10); assert.equal(pub.form, 'TOPLOADRAKE'); assert.equal(pub.nextEvo, 20); assert.equal(pub.toEvo, 1450); assert.equal(pub.nextForm, 'TITANLOADER'); assert.equal(pub.dex, 2);
// The battle shows the form and level; the effect carries the evolution; the reward is checked for chance words.
assert.equal(B.battleFrom({ floor: 1, pct: 25, phase: 'floor', level: 12 }, { starter: 'SLABBIT' }).mine.name, 'SLABBUNNY');
const fx = M.makeEffect('beast', S, 1, { beastEvent: 'evolve', beastName: 'slabbunny', fromName: 'slabbit', level: 10, reward: 'Free giveaway' });
assert.deepEqual([fx.beastEvent, fx.beastName, fx.fromName, fx.level, fx.reward], ['evolve', 'SLABBUNNY', 'SLABBIT', 10, 'Free giveaway']);
assert.throws(() => M.validateSettings({ ...S, beastsEvolveReward: 'Mystery raffle spin' }), /chance/);
const room = read('scripts/live-studio-room.mjs'), ov = read('scripts/live-studio-overlay.mjs'), ctl = read('scripts/live-studio-controls.js'), bsrc = read('scripts/beasts.mjs');
assert.ok(room.includes("beastEffect(events, s) { return beastMoment(events, s?.beastStarter || '', s?.settings?.beastsEvolveReward || ''); }"));
assert.ok(ov.includes("battle.evolve?.(e.fromName,e.beastName)") && ov.includes("' TO EVOLVE INTO '+d.nextForm+' -- STAY FOR IT!'") && ov.includes("beastsLib.drawShelf(sh,d.caught,{count:d.dex,scale:2})"));
assert.ok(ctl.includes('name="beastsEvolveReward"') && ctl.includes('id="beast-preview-evo"') && ctl.includes("beastsLib.beastMoment(r.events,"));
assert.ok(bsrc.includes("evolve(from, to) {") && bsrc.includes("' IS EVOLVING!'") && !/Math\.random/.test(bsrc));
console.log('Beasts: levels, evolution, the beastdex: passed');
