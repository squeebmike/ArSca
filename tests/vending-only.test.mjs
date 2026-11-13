// (2026-11-13: "Do 3, 2 and 1") VENDING ONLY (no game, the machine full screen), READY-MADE SPOT LISTS,
// and THE BREAK BOARD (who has which spot -- only with SHOW BUYER NAMES on, off by default).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const V = await import('../scripts/vending.mjs'), M = await import('../scripts/live-studio-model.mjs');
const room = read('scripts/live-studio-room.mjs'), ov = read('scripts/live-studio-overlay.mjs'), bg = read('scripts/shed-background.mjs'), ctl = read('scripts/live-studio-controls.js'), vsrc = read('scripts/vending.mjs');
// 2. Ready-made lists: whole leagues, no chance words, and they make spots.
assert.equal(V.SPOT_PRESETS.nfl.length, 32); assert.equal(V.SPOT_PRESETS.mlb.length, 30); assert.equal(V.SPOT_PRESETS.nba.length, 30); assert.equal(V.SPOT_PRESETS.nhl.length, 32);
for (const [k, list] of Object.entries(V.SPOT_PRESETS)) { assert.equal(new Set(list).size, list.length, k + ' has no repeats'); for (const n of list) assert.equal(M.chanceWordIn(n), '', n); }
assert.equal(V.makeSpots({ names: V.SPOT_PRESETS.nfl.join('\n'), price: 10 }).length, 32);
assert.ok(ctl.includes('<select id="vm-preset">') && ctl.includes("const list=V.SPOT_PRESETS[pre.value]||[];"));
// 1. The break board: names only with SHOW BUYER NAMES on -- stripped before anything leaves the room.
assert.equal(M.DEFAULT_STUDIO.showBuyerNames, false, 'off by default');
for (const k of ["pubMachine(s) { const m = s.machine || { on:false, items:[] }; return s.settings.showBuyerNames ? m :", "const who = s.settings.showBuyerNames ? String(order?.buyer?.username || '')", "machine:this.pubMachine(state)"]) assert.ok(room.includes(k), k);
assert.ok(!/machine:s\.machine\|\|/.test(room) && !/machine:state\.machine \|\|/.test(room), 'every broadcast goes through pubMachine');
assert.ok(vsrc.includes("(it.buyer ? '<em class=\"vm-who\">@' + esc(it.buyer) + '</em>' : '')"));
assert.ok(ctl.includes("machine:values().showBuyerNames?machineCtl:{...machineCtl,items:(machineCtl.items||[]).map(({buyer,...it})=>it)}"), 'the preview hides names too when off');
assert.ok(ctl.includes('id="vm-who-go"'));
// Spot numbers, the same on every size of machine.
assert.ok(vsrc.includes("const code = i => '#' + (i + 1);"));
// 3. Vending only: a third choice; sales, taps and votes move no game; no game on either screen.
assert.equal(M.validateSettings({ ...M.DEFAULT_STUDIO, gameMode: 'vending' }).gameMode, 'vending');
for (const k of ["vendingOnly(s) { return s.settings.gameMode === 'vending'; }", "} else if (s.stats.gross > grossBefore && !this.vendingOnly(s)) {", "if (this.vendingOnly(s)) throw new Error('Vending only: no game is on (pick", "if (this.vendingOnly(s) && !['next', 'trivia'].includes(kind)) throw"]) assert.ok(room.includes(k), k);
assert.ok(ov.includes("const dg=()=>settings.gameMode!=='vending'&&settings.dungeonOn"));
assert.ok(bg.includes("if (settings0.gameMode === 'vending') {") && bg.includes('const boss = beastsOn || vendOn ||'));
assert.ok(ctl.includes('id="game-vending"') && ctl.includes('<option value="vending">VENDING ONLY'));
console.log('Vending only, ready-made lists, the break board: passed');
