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
const bg = read('scripts/shed-background.mjs'); assert.match(bg, /rStage > rage\.seen\) \{ rage\.seen = rStage; fp\.attack\(bosses\.bossById\(d\.boss\.character\)\.move\); \}/); assert.match(bg, /type === 'mana-attack'/);
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
// 7. Clearer items and live torches (2026-11-12: "item images need to be clearer", "are the torches animated?").
{
  assert.match(fp, /if \(pic\) \{ const pl = Math\.max\(0\.85,/, 'item photos on walls stay lit, never lost in the fog');
  assert.match(fp, /contrast\(1\.15\) saturate\(1\.25\)/);
  assert.match(fp, /pd \? 0\.82 :/, 'bigger items on the stands');
  assert.match(fp, /const torchFlame = \(tx, ty, sx\) =>/); assert.match(fp, /if \(cell === 19 && tx >= 9/);
  assert.match(fp, /nearItem\(\) \{ return seenPic/);
  const bg = read('scripts/shed-background.mjs'), html = read('shed-background.html');
  assert.match(bg, /i = boss \? -1 : fp\?\.nearItem\?\.\(\) \?\? -1/); assert.ok(html.includes('#shed-item.on{'), 'the sharp close-up card');
}
// 8. The boss taunts with the store's items; the mini-map (2026-11-12: "do 6 and 7").
{
  assert.match(fp, /if \(boss && bossPx && state\.bossItem >= 0 && pics\.length\)/, 'the boss holds up an item');
  assert.match(fp, /drawMap\(ctx, \{ cell = 6 \} = \{\}\) \{/); assert.match(fp, /revealed\[y \* N \+ x\] = 1;/);
  const bg = read('scripts/shed-background.mjs'), html = read('shed-background.html'), ov = read('scripts/live-studio-overlay.mjs');
  assert.match(bg, /fp\.set\(fpm\.crawlStateFrom\(\{ stats, stage, urls: pics\.urls, now, testUntil, hideNear \}\)\);/);
  assert.match(bg, /' IS MINE!'/); assert.match(bg, /fp\?\.drawMap\?\.\(miniCtx/);
  assert.ok(html.includes('#shed-mini{') && html.includes('#shed-taunt.on{'));
  assert.ok(!/const rk = [^;]*\bstage = d\.phase/.test(bg), 'no local "stage" hiding the lineup (it blanked the green screen\'s item photos)');
  assert.match(ov, /function bossGrab\(st\)/);
  assert.equal(D.DUNGEON_DEFAULTS.miniMap, true);
}
// 9. SHOW READY (2026-11-12: "pre load the dungeon rewards and items based on what I have in stock. Keep it comics").
{
  const ctl = read('scripts/live-studio-controls.js');
  assert.ok(ctl.includes('id="mana-show-ready"') && ctl.includes('id="mana-ready"'), 'the button and the checklist');
  assert.match(ctl, /async function showReady\(\)/); assert.match(ctl, /function stockComics\(\)\{return inventory\(\)\.filter\(i=>i\.status==='in_stock'&&\/comic\/i/);
  assert.match(ctl, /if\(next\.length<5\)\{fill=true;/, 'SHOW PREP\'s lineup stays');
  assert.match(ctl, /chanceFn\(it\.title\+' '\+it\.detail\)/, 'nothing that reads as chance on the walls');
  assert.match(ctl, /if\(comicsOnly&&!\/comic\/i\.test\(cat\)\)continue;/);
  assert.match(ctl, /pick\.push\(l\[\(day\*7\+n\)%l\.length\]\)/, 'no repeats on the walls');
  assert.equal(D.DUNGEON_DEFAULTS.dungeonComics, true);
  // The rewards it writes parse as the dungeon reads them.
  const chest = '5 follows: Free giveaway for everyone -- Bone #1\n10 shares: Free giveaway for everyone -- Saga #1\n25 taps: Low start on Amazing Spider-Man #300';
  assert.equal(D.parseChestLines(chest).length, 3);
  assert.equal(M.chanceWordIn(chest), '');
}
// 10. Props in front, IN the scene (2026-11-13: "they look like they're on the screen, and they move with the camera").
{
  assert.match(fp, /layer = '' \} = \{\}\) \{\n  const FG = layer === 'front';/);
  assert.match(fp, /if \(FG \? !close : close\) return; \} else if \(FG\) return;/, 'the front layer has only the close props (and see-through glow)');
  assert.match(fp, /if \(FG\) data\.fill\(0\); else for/, 'no floor or walls on the front layer');
  assert.match(fp, /const shared = \(\) => \(\(Date\.now\(\) \+ clockOffset\) % 3\.6e6\) \/ 1000;/, 'one clock on every screen');
  assert.match(fp, /const tm = shared\(\), ph = \(tm % 13\) \/ 13/, 'the idle glance keeps the shared time');
  const ov = read('scripts/live-studio-overlay.mjs'), html = read('arcade-overlay.html'), css = read('assets/live-studio.css');
  assert.match(ov, /front=fpLib\.createShedCrawl\(cv,\{w:W,h:Math\.round\(W\*850\/1080\),fov:0\.66,layer:'front'\}\)/);
  assert.match(ov, /fpLib\.crawlStateFrom\(\{stats,stage,urls:pics\.urls,now:Date\.now\(\)\+offset,hideNear:true\}\)/, 'the same state recipe as the green screen');
  assert.ok(html.includes('<canvas id="mana-front"') && css.includes('#mana-front{position:absolute;left:0;top:0;width:1080px;height:850px'), 'lined up with the green screen\'s hall');
  const st = F.crawlStateFrom({ stats: { dungeon: { floor: 3, shed: 'X', pct: 40, phase: 'floor', boss: {}, opened: [1], boxes: [{ open: true }], fork: '' }, lastSaleAt: 0 }, stage: { next: [{ image: 'https://a/1.jpg', price: 5 }, { image: 'https://a/2.jpg', price: 50 }] }, urls: ['https://a/1.jpg', 'https://a/2.jpg'] });
  assert.deepEqual([st.floor, st.bossItem, st.chests, st.boxes], [3, 1, [false, true, false], [true, false]]);
}
// 11. See-through glow and particles in front of the hosts; the polish (2026-11-13: "add all those features").
{
  assert.match(fp, /const FRONT = FG \|\| !!state\.hideNear, FXN = NEAR_CHEST \+ 0\.05;/, 'particles as close as the chests in front go on the front layer');
  assert.match(fp, /const fx = \(i, col, a, tY\) => \{/); assert.match(fp, /glowAt\(pr\.x, pr\.y, 0\.22, 0\.42, \[255, 210, 90\]/, 'the chest\'s gleam');
  assert.match(fp, /chestBurst\[k\] = performance\.now\(\)/, 'a chest opening bursts');
  assert.match(fp, /hit\(\) \{ hitAt = performance\.now\(\); \}/); assert.match(fp, /screenOf\(kind, idx\)/);
  assert.match(fp, /swoop: true/); assert.match(fp, /sniff = f >= 0\.4 && f < 0\.62/); assert.match(fp, /drop = ph < 0\.15/);
  assert.match(fp, /const DECALS = \(\(\) => \{/); assert.match(fp, /const jamb = !pic && \(\(alongA/);
  assert.match(fp, /segs\[i\] - d < 1\.3\)/, 'smoother corners'); assert.match(fp, /Walking past a room, you turn your head to look in/);
  assert.match(fp, /COLOUR GRADING \(2026-11-13 polish\)/); assert.match(fp, /Cold down there: your breath fogs/);
  const ov = read('scripts/live-studio-overlay.mjs'), bg = read('scripts/shed-background.mjs'), css = read('assets/live-studio.css');
  assert.match(ov, /if\(hp<frontHp\)front\.hit\(\);/); assert.match(bg, /if \(hp < lastHp\) fp\.hit\?\.\(\);/);
  assert.match(ov, /front\.screenOf\('chest'/); assert.ok(css.includes('@keyframes mana-from-chest'));
  assert.match(ov, /front\?\.walking\?\.\(\)/, 'footsteps while walking');
  // Every polish piece is fixed (no chance) and keeps the same time on every screen.
  assert.ok(!/Math\.random/.test(fp));
}
// 12. The knockout and the next floor (2026-11-13: "keep going -- what else does it need?").
{
  assert.match(fp, /koUntil = koAt \+ 2600; pendingSet = next;/, 'the arena holds for the knockout');
  assert.match(fp, /if \(n\) set\(n, true\); \}, 2650\)/, 'then the next floor -- once (no second knockout)');
  assert.match(fp, /THE KNOCKOUT: the boss blows apart/); assert.match(fp, /Arriving on a new floor: the light comes up/);
  assert.match(fp, /shown = target; arenaK = 0; look = 0;/, 'a new floor never starts in the old arena');
}
console.log('dungeon arena: locked long boxes, boss arenas, day to night and window weather passed');
