// PS1 bosses and the green-screen shed backgrounds (store, 2026-11-04:
// "graphics would have to be animated and PS1 graphics ... a green screen
// where the background can be different shitty sheds").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_STUDIO, validateSettings } from '../scripts/live-studio-model.mjs';
import { SHEDS, ROOMS } from '../scripts/live-studio-dungeon.mjs';
import { drawShed, SCENE_COUNT, W, H } from '../scripts/shed-background.mjs';

// The boss look is a setting; PS1 by default.
assert.equal(DEFAULT_STUDIO.bossStyle, 'ps1');
assert.equal(validateSettings({ bossStyle: 'n64' }).bossStyle, 'n64');
assert.throws(() => validateSettings({ bossStyle: 'ps5' }), /bossStyle/);

// PS1: low-res render, snapped vertices, dithered colour, stepped animation,
// an entrance stomp and a blow-apart K.O.
const three = fs.readFileSync('scripts/live-studio-3d.mjs', 'utf8');
for (const bit of ['export const PS1 = { scale: 3', 'sp.xy = floor(sp.xy * uSnap + 0.5) / uSnap', 'ps1Bayer2', 'Math.floor(real * PS1.fps) / PS1.fps', 'enter() {', 'function explode()', "canvas.classList.toggle('ps1', on)"]) assert.ok(three.includes(bit), bit);
assert.doesNotMatch(three, /Math\.random/);
const css = fs.readFileSync('assets/live-studio.css', 'utf8');
assert.match(css, /canvas\.ps1 \{image-rendering:pixelated/);
const overlay = fs.readFileSync('scripts/live-studio-overlay.mjs', 'utf8');
assert.match(overlay, /bossView\?\.style\(settings\.bossStyle!=='n64'\)/);
assert.match(overlay, /bossView\?\.enter\(\)/, 'the boss stomps in when the flask fills');
assert.match(overlay, /effectBoss\.defeat\(true\)/);
const controls = fs.readFileSync('scripts/live-studio-controls.js', 'utf8');
assert.match(controls, /name="bossStyle"/);
assert.match(controls, /id="mana-shed-url"/);
assert.match(controls, /new URL\('shed-background\.html',location\.href\);sh\.hash=u\.hash/);

// Sheds: one scene per shed, room props for every room, and every combo
// draws without error (a stand-in 2D context).
assert.equal(SCENE_COUNT, SHEDS.length);
const src = fs.readFileSync('scripts/shed-background.mjs', 'utf8');
for (const r of ROOMS) assert.match(src, new RegExp('\\n  ' + r.id + ': '), 'props for ' + r.id);
assert.doesNotMatch(src, /Math\.random/, 'nothing random: fixed paths');
assert.equal(W * 4, 1080); assert.equal(H * 4, 1920);
let calls = 0;
const grad = { addColorStop() {} };
const ctx = new Proxy({}, { get: (o, k) => k in o ? o[k] : (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => grad : () => { calls++; }), set: (o, k, v) => { o[k] = v; return true; } });
for (let f = 1; f <= 9; f++) for (const room of ['', ...ROOMS.map(r => r.id)]) for (const boss of [false, true]) drawShed(ctx, { floor: f, room, boss, t: f * 1.7 });
assert.ok(calls > 1000);
const html = fs.readFileSync('shed-background.html', 'utf8');
assert.match(html, /<canvas id="shed" width="270" height="480"/);
assert.match(html, /image-rendering:pixelated/);
assert.match(html, /scripts\/shed-background\.mjs/);
// Live: the read-only overlay socket, same token.
assert.match(src, /url\.pathname = '\/live-studio\/socket'/);
assert.match(src, /socket\.send\(JSON\.stringify\(\{ token \}\)\)/);
console.log('live-studio PS1 bosses + shed backgrounds: ok');
