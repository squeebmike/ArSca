import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MASCOT_STATES, createMascotMachine, BYTERIDER_SVG, EASTER_EGGS, BOOT_LINES } from '../scripts/byterider.mjs';
import { DEFAULT_STUDIO, validateSettings, makeEffect, EFFECTS } from '../scripts/live-studio-model.mjs';

// ByteRider_97 (store, 2026-11-02, character spec): a living 1997 CRT
// monitor, the overlay's mascot, with a state machine that plays a reaction
// once, queues the rest, returns to idle and naps when the show is quiet.
assert.deepEqual(MASCOT_STATES, ['idle', 'happy', 'talking', 'surprised', 'jackpot', 'glitch', 'sleeping', 'alert', 'countdown', 'celebrating', 'disappearing']);

// The look (store: "The border of the phone is his border. No square around
// him. No antenna."): the whole 1080 x 1920 frame is his monitor -- teal
// bezel at the screen's edge, charcoal trim, purple accent, neon-green
// buttons, scanlines and corner fuzz -- and his big lime face in it.
assert.match(BYTERIDER_SVG, /viewBox="0 0 1080 1920"/);
assert.match(BYTERIDER_SVG, /class="br-bezel" x="12" y="12" width="1056" height="1896"/, 'the bezel runs round the screen edge');
assert.match(BYTERIDER_SVG, /#2bd4c6/);assert.match(BYTERIDER_SVG, /#7b3fe4/);assert.match(BYTERIDER_SVG, /#b6ff3a/);
assert.match(BYTERIDER_SVG, /id="br-scan"/);assert.match(BYTERIDER_SVG, /id="br-fuzz"/);
assert.doesNotMatch(BYTERIDER_SVG, /antenna/i, 'no antenna');
for (const part of ['br-eyes-normal', 'br-eyes-happy', 'br-eyes-wide', 'br-eyes-dollar', 'br-eyes-closed', 'br-m-smile', 'br-m-grin', 'br-m-o', 'br-m-flat', 'br-m-talk', 'br-static', 'br-place']) assert.ok(BYTERIDER_SVG.includes(part), part);
assert.doesNotMatch(BYTERIDER_SVG, /\b(arm|hand|leg|foot|feet)\b/i, 'no limbs');
assert.deepEqual(EASTER_EGGS, ['RE:MIND', 'PRIMARY USER', 'SYSTEM REWIND', '1997']);
assert.ok(BOOT_LINES.some(l => /PRIMARY USER/.test(l)));

// The machine.
let t = 0;
const m = createMascotMachine({ now: () => t, sleepAfterMs: 300000 });
assert.equal(m.current.state, 'idle');
m.play('happy', { text: 'SOLD! $45' });
assert.equal(m.current.state, 'happy');assert.equal(m.current.text, 'SOLD! $45');
// Things that happen at once wait their turn, most important first.
m.play('talking', { text: 'hi' });m.play('jackpot', { text: 'BIG HIT!' });m.play('surprised');
assert.equal(m.current.state, 'happy', 'nothing cuts a reaction off');
assert.deepEqual(m.queue.map(q => q.state), ['jackpot', 'surprised', 'talking']);
t += 5000;m.tick();assert.equal(m.current.state, 'jackpot');
t += 4000;m.tick();assert.equal(m.current.state, 'surprised');
t += 2000;m.tick();assert.equal(m.current.state, 'talking');
t += 3000;m.tick();assert.equal(m.current.state, 'idle', 'back to idle on its own');
// A long line talks longer.
m.play('talking', { text: 'X'.repeat(80) });assert.ok(m.current.until - t > 4000);
t += 10000;m.tick();
// No more than 4 wait; the least important are dropped.
m.play('happy');for (let i = 0; i < 6; i++) m.play('talking');m.play('celebrating');
assert.equal(m.queue.length, 4);assert.equal(m.queue[0].state, 'celebrating');
t += 60000;for (let i = 0; i < 6; i++) { t += 5000; m.tick(); }
assert.equal(m.current.state, 'idle');
// Quiet for 5 minutes: asleep. Anything wakes him.
t += 300001;m.tick();assert.equal(m.current.state, 'sleeping');
m.play('happy');assert.equal(m.current.state, 'happy');
m.play('sleeping');assert.equal(m.current.state, 'sleeping');assert.equal(m.queue.length, 0);
m.wake();assert.equal(m.current.state, 'idle');
m.play('nonsense');assert.equal(m.current.state, 'happy', 'an unknown reaction is just happy');

// Settings and live triggers.
assert.equal(DEFAULT_STUDIO.mascotOn, true);
assert.ok(EFFECTS.includes('mascot'));
assert.equal(DEFAULT_STUDIO.mascotBorder, true);assert.equal(DEFAULT_STUDIO.mascotIdleFace, false, 'between reactions the cameras are clear');
assert.equal(validateSettings({ mascotScale: 120, mascotFaceY: 700, mascotBorder: false }).mascotScale, 120);
assert.throws(() => validateSettings({ mascotScale: 999 }), /mascotScale/);
assert.throws(() => validateSettings({ mascotX: 10 }), /Unknown setting/, 'no box to place any more');
const e = makeEffect('mascot', DEFAULT_STUDIO, 1, { mascotState: 'jackpot', say: 'NEW FOLLOWER! WELCOME!' });
assert.equal(e.mascotState, 'jackpot');assert.equal(e.say, 'NEW FOLLOWER! WELCOME!');
assert.throws(() => makeEffect('mascot', DEFAULT_STUDIO, 1, { mascotState: 'dance' }), /Unknown ByteRider/);
assert.throws(() => makeEffect('mascot', DEFAULT_STUDIO, 1, { mascotState: 'talking', say: 'RAFFLE TONIGHT' }), /game of chance/);

// Wiring: the overlay hosts him and maps real show events to reactions;
// the dashboard has his controls; the Worker deploys his file.
const overlay = fs.readFileSync('scripts/live-studio-overlay.mjs', 'utf8'), html = fs.readFileSync('arcade-overlay.html', 'utf8');
assert.ok(html.includes('<div id="byterider"'));
for (const k of ['sold', 'jackpot', 'boss', 'countdown', 'ready', 'gameover', 'giveaway', 'winner']) assert.ok(overlay.includes(`case '${k}':`), k);
assert.match(overlay, /if\(e\.kind==='mascot'\)\{mascot\?\.play\(e\.mascotState/);
assert.match(overlay, /UP NEXT: /, 'a new item up');
const controls = fs.readFileSync('scripts/live-studio-controls.js', 'utf8');
assert.ok(controls.includes("api('effect',{kind:'mascot',state,text})"));assert.ok(controls.includes('NEW FOLLOWER'));
assert.match(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8'), /scripts\/byterider\.mjs/);
assert.match(fs.readFileSync('scripts/live-studio-api.mjs', 'utf8'), /room\.trigger\(body\.kind, body\.kind==='mascot'/);
console.log('ByteRider_97: look, state machine, queue, sleep, live triggers and wiring checks passed');
