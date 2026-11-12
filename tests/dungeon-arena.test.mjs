// 2026-11-12: "Do 1 2 3" -- locked long boxes chat's taps open, boss arenas,
// morning-to-night light with the weather only through open windows ("we're inside").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const D = await import('../scripts/live-studio-dungeon.mjs'), F = await import('../scripts/shed-crawl-fp.mjs'), M = await import('../scripts/live-studio-model.mjs');
for (const f of ['scripts/shed-crawl-fp.mjs', 'scripts/live-studio-dungeon.mjs', 'scripts/prop-models.mjs']) assert.ok(!/Math\.random/.test(read(f)), 'no chance: ' + f);
// 1. Locked long boxes: keys are chat's taps on this floor (never sales), opened once the crawl reaches them.
assert.deepEqual(D.LOCKBOX_AT, F.LOCKBOX_AT, 'the crawl and the server agree where the boxes are');
const s = { ...D.DUNGEON_DEFAULTS };
let d = D.emptyDungeon();
for (let i = 0; i < 5; i++) d = D.addTap(d, 'share', s).dungeon;
assert.equal(d.floorTaps, 5);
assert.deepEqual(D.boxesOf(d, s).map(b => [b.need, b.unlocked]), [[5, true], [10, false]]);
assert.equal(D.boxesToOpen(d, s).length, 0, 'not reached yet');
d = D.addMana(d, D.floorGoal(s, 1, d) * 0.7 - d.mana, s).dungeon;
assert.deepEqual(D.boxesToOpen(d, s).map(b => b.k), [0], 'reached and unlocked');
d = D.openBox(d, 0); assert.equal(D.boxesToOpen(d, s).length, 0);
assert.equal(D.publicDungeon(d, s).boxes[0].open, true);
const sales = D.addMana(D.emptyDungeon(), 60, s).dungeon; assert.equal(sales.floorTaps || 0, 0, 'sales are never keys');
assert.equal(D.boxesOf(d, { ...s, lockboxTaps: 0 }).length, 0, 'off at 0');
d = D.addMana(d, 100000, s).dungeon; assert.equal(d.floorTaps, 0, 'a new floor starts with no keys');
const room = read('scripts/live-studio-room.mjs');
assert.match(room, /openReachedBoxes\(s, now\) \{/);
assert.match(room, /spot: 'THE LOCKED LONG BOX'/);
assert.equal(M.makeEffect('found', { ...M.DEFAULT_STUDIO }, Date.now(), { spot: 'THE LOCKED LONG BOX', lockbox: 1 }).lockbox, 1);
assert.ok(F.propsFor(F.layoutFor(3), 3).filter(p => p.kind === 'lockbox').length === 2);
// 2. Boss arenas: most floors get the big room, torches and braziers; the 3D boss moves in it.
let arenas = 0; for (let f = 1; f <= 20; f++) { const L = F.layoutFor(f); if (L.arena) { arenas++; assert.ok(L.bossAt && L.boss[2] >= 4); } }
assert.ok(arenas >= 12, 'arenas: ' + arenas);
const fp = read('scripts/shed-crawl-fp.mjs');
assert.match(fp, /if \(sourceCanvas\.frames\?\.length\) \{ bossAnim = sourceCanvas;/);
assert.match(read('scripts/live-studio-3d.mjs'), /export function bakeBoss\(id/);
for (const f of ['scripts/live-studio-overlay.mjs', 'scripts/shed-background.mjs']) assert.match(read(f), /bakeBoss\?\.\(/, f);
// 3. Morning to night by the show's clock; the weather is outside the windows.
assert.equal(F.dayPhase(0), 'morning');
const t0 = Date.UTC(2026, 10, 12, 18); assert.deepEqual([0.1, 0.5, 1.2, 2].map(h => F.dayPhase(t0, t0 + h * 3.6e6)), ['morning', 'day', 'sunset', 'night']);
assert.equal(F.weatherFor(3, t0), F.weatherFor(3, t0), 'the same on every screen');
assert.ok(['snow', 'clear', 'storm'].includes(F.weatherFor(1, Date.UTC(2026, 11, 20))), 'winter');
let wins = 0; for (let f = 1; f <= 7; f++) { const m = F.buildMap(f); m.lights.filter(l => l.win).forEach(l => { wins++; assert.equal(m.zone[Math.floor(l.y) * F.GRID + Math.floor(l.x)], 0, 'windows only in the shed, not underground'); }); }
assert.ok(wins >= 7, 'windows: ' + wins);
assert.ok(M.publicStats({ ...M.emptyStats('x'), orders: { a: { at: 5, amount: 1 }, b: { at: 3, amount: 1 } } }, { ...M.DEFAULT_STUDIO, showId: 'x' }).startedAt === 3, 'the show clock starts at its first sale');
// 4. Boss attacks in the arena (2026-11-12: "do 4"): every boss's move plays in the room.
const B = await import('../scripts/live-studio-bosses.mjs');
for (const id of B.BOSS_IDS || Object.keys(B.BOSSES || {})) { const m = B.bossById(id).move; assert.ok(fp.includes("'" + m + "'"), 'the arena plays ' + m); }
assert.match(fp, /attack\(move\) \{ atk = \{ move:/);
assert.match(read('scripts/live-studio-overlay.mjs'), /fp\?\.attack\?\.\(move\);/);
const bg = read('scripts/shed-background.mjs'); assert.match(bg, /stage > rage\.seen\) \{ rage\.seen = stage; fp\.attack\(bosses\.bossById\(d\.boss\.character\)\.move\); \}/); assert.match(bg, /type === 'mana-attack'/);
assert.match(read('scripts/live-studio-controls.js'), /id="mana-test-attack"/);
// 5. The cracked wall and its secret vault; the merchant; sharper pixels.
{
  assert.equal(D.SECRET_AT, F.SECRET_AT);
  const S2 = { ...D.DUNGEON_DEFAULTS, secretTaps: 3 }; let w = D.emptyDungeon();
  assert.deepEqual([D.secretOf(w, S2).have, D.secretOf(w, S2).broken], [0, false]);
  for (let i = 0; i < 3; i++) w = D.addTap(w, 'follow', S2).dungeon;
  assert.equal(D.secretOf(w, S2).broken, true, 'chat smashed it');
  assert.equal(D.secretToOpen(w, S2), null, 'not reached yet');
  w = D.addMana(w, D.floorGoal(S2, 1, w) * 0.8 - w.mana, S2).dungeon;
  assert.ok(D.secretToOpen(w, S2)); w = D.openVault(w); assert.equal(D.secretToOpen(w, S2), null); assert.equal(D.publicDungeon(w, S2).secret.open, true);
  assert.equal(D.secretOf(w, { ...S2, secretTaps: 0 }), null, 'off at 0');
  let placed = 0; for (let f = 1; f <= 20; f++) { const L = F.layoutFor(f); if (L.secret) { placed++; const m = F.buildMap(f); assert.equal(m.grid[L.secret.wall[1]][L.secret.wall[0]], 25, 'sealed by the cracked wall'); } }
  assert.ok(placed >= 17, 'cracked walls: ' + placed);
  const picks = D.merchantPicks([{ title: 'Spawn #1' }, { title: 'Venom #1 1:25 Ratio Variant' }, { title: 'Glow in the Dark cover' }, { title: 'X-Men #1 Foil' }]);
  assert.deepEqual(picks.map(p => [p.i, p.tag]), [[1, '🎯 RATIO VARIANT'], [2, '🌙 GLOW IN THE DARK']], 'specials first, two different kinds');
  assert.deepEqual(D.merchantPicks([{ title: 'A' }, { title: 'B' }]).map(p => p.tag), ['💎 FROM HIS PACK', '💎 FROM HIS PACK']);
  const room = read('scripts/live-studio-room.mjs'), api = read('scripts/live-studio-api.mjs');
  assert.match(room, /else if \(kind === 'merchant'\)/); assert.match(room, /spot: 'THE MERCHANT'/); assert.match(room, /spot: 'THE SECRET VAULT'/); assert.match(room, /THE CRACKED WALL CRUMBLES! A SECRET VAULT!/);
  assert.match(api, /withChest\(await room\.pickVote\(/, 'the merchant\'s pick goes into the Whatnot show');
  assert.ok(read('scripts/live-studio-controls.js').includes('data-vote="merchant"'));
  assert.match(read('scripts/shed-background.mjs'), /const W = sharp \? 480 : 360;/);
  assert.equal(D.DUNGEON_DEFAULTS.crawlSharp, false, 'sharper pixels are opt-in');
  for (const k of ['pedestal', 'merchant']) assert.ok((await import('../scripts/prop-models.mjs')).MODEL_KINDS.includes(k));
}
// 6. The store's products down in the dungeon too (2026-11-12: "yes add the products to the dungeon").
{
  let walls = 0, stands = 0;
  for (let f = 1; f <= 7; f++) { const L = F.layoutFor(f), m = F.buildMap(f); for (let y = 0; y < F.GRID; y++) for (let x = 0; x < F.GRID; x++) if (m.grid[y][x] >= 1000 && m.zone[y * F.GRID + x]) walls++; stands += F.propsFor(L, f).filter(p => p.kind === 'pic' && m.zone[Math.floor(p.y) * F.GRID + Math.floor(p.x)]).length; }
  assert.ok(walls / 7 >= 12, 'item photos on the dungeon walls: ' + walls / 7);
  assert.ok(stands / 7 >= 4, 'items on stands in the dungeon: ' + stands / 7);
  assert.match(fp, /kind: 'pic', float: true, idx: 970 \+ pr\.idx/, 'the opened long box\'s item hovers over it');
  assert.match(fp, /kind: 'pic', float: true, idx: 990/, 'the vault\'s item over its pedestal');
  assert.match(fp, /grid\[y\]\[x\] === 23 && L\.arena/, 'trophies on the arena walls');
}
console.log('dungeon arena: locked long boxes, boss arenas, day to night and window weather passed');
