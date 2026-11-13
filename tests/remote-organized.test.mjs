// The remote, organized (2026-11-13: "I want to be able to close a dropdown for different sections. I don't use
// ByteRider_97 much and like to hide certain sections. Organize it better") -- and the preview switches to Beasts before Connect.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ctl = readFileSync(new URL('../scripts/live-studio-controls.js', import.meta.url), 'utf8'), bg = readFileSync(new URL('../scripts/shed-background.mjs', import.meta.url), 'utf8'), css = readFileSync(new URL('../assets/live-studio.css', import.meta.url), 'utf8');
assert.match(ctl, /function organize\(\)\{/); assert.match(ctl, /setTimeout\(organize,0\);/);
assert.match(ctl, /d\.addEventListener\('toggle',\(\)=>put\(name,d\.open\?'open':'closed'\)\)/, 'every section folds and remembers');
assert.match(ctl, /'👁 SHOW \/ HIDE SECTIONS'/, 'any section can be hidden');
assert.match(ctl, /host\.querySelectorAll\('\[data-click\*="mana-mascot"\]'\)\.forEach\(b=>\{b\.hidden=!!off;\}\)/, 'hiding ByteRider_97 hides his buttons too');
assert.match(ctl, /for\(const n of \['🎬 Show ready','Now playing & next up','🎮 Game','🕹️ Camera','🥤 Vending machine'\]\)/, 'the remote in show order');
assert.ok(ctl.includes('id="game-dungeon"') && ctl.includes('id="game-beasts"'), 'the game in one tap');
assert.ok(bg.includes("const d = settings0.gameMode === 'beasts' ? (stats?.beasts || { floor: 1, route: 1, pct: 0, phase: 'floor' }) : stats?.dungeon;"), 'the preview shows Beasts before Connect (its own track)');
assert.ok(css.includes('details.mana-sec>summary'));
// ATTACK NOW, and resets in reach (2026-11-13: "nothing to let me reset the dungeon ... I need to select an attack? I'm in preview").
assert.ok(ctl.includes('id="beast-moves"') && ctl.includes('id="demo-reset"') && ctl.includes('data-click="#mana-reset-week"') && ctl.includes('id="quick-floor"'));
assert.match(ctl, /api\('beast-move',\{index:i\}\);took\(d\);if\(d\.effect\)preview\(d\.effect\);/, 'the show uses it, and the preview shows it');
assert.match(ctl, /demoMove=i;preview\(\{id:'move-'\+now,kind:'move',move:m/, 'in the preview (not connected) it plays there');
assert.match(ctl, /amount=v\.gameMode==='beasts'\?\[4,3,5,4,6\]\[demo%5\]/, 'the beasts demo walks into the tall grass');
const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8'), api = readFileSync(new URL('../scripts/live-studio-api.mjs', import.meta.url), 'utf8');
assert.match(room, /pickMove\(index\) \{/); assert.match(api, /room\.pickMove\(Number\(body\.index\)\)/);
console.log('remote organized: folding sections, show/hide, show order, one-tap game, Beasts preview passed');
