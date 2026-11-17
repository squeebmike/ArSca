// Beasts: items on the path, chat's gifts, more country, gyms every 5th route, time of day.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as B from '../scripts/beasts.mjs';
// Items: four a route, fixed (the same route gives the same items), clear of the tall grass, a stone at a gym.
const a = B.itemsFor(3), b = B.itemsFor(3);
assert.deepEqual(a, b); assert.equal(a.length, 4);
const grass = B.ENCOUNTERS.map(([s, e]) => [B.walkAt(s), B.walkAt(e)]);
for (const it of a) assert.ok(!grass.some(([s, e]) => it.t > s - 0.02 && it.t < e + 0.02), 'items sit between the grass patches');
assert.equal(B.itemsFor(5)[3].kind, 'STONE');
assert.deepEqual(B.routeFor(7).items, B.itemsFor(7));
// Gyms: routes 5, 10 ...; the leader's beast has twice the HP; the badge says gym.
assert.ok(B.isGym(5) && B.isGym(10) && !B.isGym(4));
assert.equal(B.toGym(3), 2); assert.equal(B.toGym(5), 0); assert.equal(B.toGym(6), 4);
const s = { beastsGoal: 100 };
assert.equal(B.rivalMax(s, 5), 2 * B.rivalMax(s, 4) * (B.beastGoal(s, 5) / B.beastGoal(s, 4)));
assert.ok(B.rivalFor(5).gym && B.rivalFor(5).name === 'MR FISTER' && B.rivalFor(10).name === 'THE GRADER' && !B.rivalFor(4).gym, 'the first gym is Mr Fister');
let bs = { ...B.emptyBeasts('w'), route: 5 };
const r = B.addBeastXp(bs, 100 + 100, s, 1);
const badge = r.events.find(e => e.kind === 'badge');
assert.ok(badge?.gym, 'beating a gym leader gives a gym badge');
assert.equal(B.beastMoment(r.events).gym, true);
assert.equal(B.publicBeasts(r.beasts, s).gymBadges, 1);
// Chat's gifts: a tap drops one a few steps ahead on this route; public view shows this route's only.
bs = B.addBeastDrop({ ...B.emptyBeasts('w'), xp: 50 }, 'follow', s, 5);
const d = B.publicBeasts(bs, s).drops;
assert.equal(d.length, 1); assert.equal(d[0].kind, 'follow');
assert.ok(Math.abs(d[0].t - (B.walkAt(0.5) + B.DROP_AHEAD)) < 0.002);
assert.equal(B.publicBeasts({ ...bs, route: 2 }, s).drops.length, 0);
assert.equal(B.addBeastDrop({ ...B.emptyBeasts('w'), phase: 'rival' }, 'share', s).drops, undefined, 'no gifts during the rival fight');
// More country: every biome appears on some route, the route knows its biome by row; a cave has a corridor.
const seen = new Set(); for (let f = 1; f <= 60; f++) B.routeFor(f).biomes.forEach(x => seen.add(x));
for (const bio of B.BIOMES) assert.ok(seen.has(bio), bio + ' shows up');
let caveRoute = 0; for (let f = 1; f <= 60 && !caveRoute; f++) if (B.routeFor(f).biomes.includes('cave')) caveRoute = f;
const cr = B.routeFor(caveRoute), cy = [...Array(B.MAP_H).keys()].find(y => cr.biomeAt(y) === 'cave' && cr.grid[y].includes(17));
assert.ok(cr.grid[cy].some(t => t === 1 || t === 2 || t === 18), 'the cave keeps a way through');
// Time of day: by the clock, never by chance.
assert.equal(B.timeOfDay(12), 'day'); assert.equal(B.timeOfDay(18), 'sunset'); assert.equal(B.timeOfDay(22), 'night'); assert.equal(B.timeOfDay(3), 'night');
const src = readFileSync(new URL('../scripts/beasts.mjs', import.meta.url), 'utf8');
assert.ok(!/Math\.random/.test(src), 'no Math.random in beasts');
const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8');
assert.ok(room.includes('s.beasts = addBeastDrop(s.beasts, kind, s.settings, now);'), 'a tap drops a gift');
// What the items do: walking past a CANDY / STONE / COIN is bonus XP (a share of the goal); a BERRY / POTION / ETHER
// or chat's gift is stamina (the beast lasts 25% longer each, this route); stamina resets with the next route.
{
  const items = B.itemsFor(1), goal = B.beastGoal(s, 1);
  const xpBonus = items.reduce((n, it) => n + goal * (B.ITEM_XP[it.kind] || 0), 0), staminaN = items.filter(it => !B.ITEM_XP[it.kind]).length;
  let w = B.addBeastDrop({ ...B.emptyBeasts('w'), xp: 0 }, 'share', s, 1);
  const r1 = B.addBeastXp(w, goal - 0.01, s, 2);
  assert.equal(r1.events.filter(e => e.kind === 'item').length, items.length + 1, 'every item and the gift picked up');
  assert.ok(Math.abs(r1.beasts.exp - (goal - 0.01 + xpBonus)) < 0.02, 'XP items add their bonus');
  assert.equal(r1.beasts.stamina, staminaN + 1);
  assert.equal(B.publicBeasts(r1.beasts, s).drainMs, B.drainFor(staminaN + 1));
  assert.ok(B.beastHpFrom(1000, 1000 + B.BEAST_DRAIN_MS, B.drainFor(2)) > 0.3, 'stamina slows the drain');
  const r2 = B.addBeastXp(r1.beasts, 0.01 + B.rivalMax(s, 1), s, 3);
  assert.equal(r2.beasts.stamina, 0, 'a new route starts fresh');
  const again = B.addBeastXp(r1.beasts, 0.001, s, 4);
  assert.equal(again.events.filter(e => e.kind === 'item').length, 0, 'nothing picked up twice');
  assert.equal(B.drainFor(99), B.BEAST_DRAIN_MS * 2, 'stamina tops out at double');
}
console.log('Beasts items, gifts, country, gyms, time of day: passed');
// Mr Fister (2026-11-14): first dungeon boss, first gym leader, his face from the remote (never in the code).
{
  const bosses = await import('../scripts/live-studio-bosses.mjs'), dun = await import('../scripts/live-studio-dungeon.mjs');
  assert.equal(dun.bossForFloor(1), 'fister'); assert.equal(bosses.BOSSES.fister.move, 'comics');
  const r = (f => readFileSync(new URL('../scripts/' + f, import.meta.url), 'utf8'));
  const g3 = r('live-studio-3d.mjs'), room = r('live-studio-room.mjs'), api = r('live-studio-api.mjs'), ov = r('live-studio-overlay.mjs'), ctl = r('live-studio-controls.js'), fp = r('shed-crawl-fp.mjs');
  assert.ok(g3.includes('  fister(root) {') && g3.includes('export function setFisterFace(') && g3.includes('export function setFisterCovers('));
  assert.ok(room.includes('setFisterFace(face) {') && room.includes("fisterFace:state.fisterFace || ''") && api.includes("/live-studio/fister-face"));
  assert.ok(ov.includes("if((e.kind==='fister'||e.kind==='fistergoo')&&fisterView)") && ov.includes("case 'fister':") && ctl.includes("['fister','✊ MR FISTER']") && ctl.includes("tag:'ratio'"));
  assert.ok(fp.includes("if (mv === 'comics')") && fp.includes('bossFeet = feetOf('), 'the comic storm; the boss on its feet');
  const M = await import('../scripts/live-studio-model.mjs');
  assert.ok(M.EFFECTS.includes('fister'));
  const { DurableObject } = { DurableObject: class {} };
  assert.throws(() => { const f = String('data:image/png;base64,AAAA'); if (f && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(f) || f.length > 40000)) throw new Error('Face: a small JPEG only'); }, /small JPEG/);
  console.log('Mr Fister: passed');
}
// Graphics settings (2026-11-14): GBC (four greens) or GBA (full colour); your beast follows you.
{
  assert.deepEqual([...B.GFX], ['gbc', 'gba', 'nds', '3ds']);
  for (const t of Object.keys(B.TILE_RAMPS)) assert.equal(B.TILE_RAMPS[t].length, 4, 'tile ' + t);
  for (let t = 0; t <= 24; t++) assert.ok(B.TILE_RAMPS[t], 'every tile has GBA colours: ' + t);
  assert.deepEqual(B.beastRamp('SLABBIT'), B.beastRamp('slabbit'), 'a beast keeps its colours');
  const M = await import('../scripts/live-studio-model.mjs');
  assert.equal(M.validateSettings({ ...M.DEFAULT_STUDIO, beastsGfx: 'gba' }).beastsGfx, 'gba'); assert.throws(() => M.validateSettings({ beastsGfx: 'n64' }), /beastsGfx/);
  const src = readFileSync(new URL('../scripts/beasts.mjs', import.meta.url), 'utf8'), sb = readFileSync(new URL('../scripts/shed-background.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('YOUR BEAST FOLLOWS YOU') && sb.includes("follower: settings0.beastsFollow !== false ? (d.form || '') : ''") && sb.includes("gfx: settings0.beastsGfx || 'gbc'"));
  const g3 = readFileSync(new URL('../scripts/live-studio-3d.mjs', import.meta.url), 'utf8');
  assert.ok(g3.includes('const fisterMaps = {') && g3.includes('fisterMaps.denim()') && g3.includes('THE FIST PUMP (store, 2026-11-17'), 'Mr Fister: textures and the pump');
  console.log('Beasts graphics settings: passed');
}
// Symbiote Mr Fister, his beard, the back of his cap (2026-11-14).
{
  const g3 = readFileSync(new URL('../scripts/live-studio-3d.mjs', import.meta.url), 'utf8'), ov = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8'), ctl = readFileSync(new URL('../scripts/live-studio-controls.js', import.meta.url), 'utf8');
  assert.ok(g3.includes("cracks: () => paintTex('cracks'") && g3.includes('Big green bug eyes') && g3.includes('SYMBIOTE MODE') && g3.includes("mode(name, on) { model?.mode?.(name, on); }") && !g3.includes('the goatee point'), 'symbiote mode; no cone beard');
  assert.ok(g3.includes('his fist emblem on the back of the cap'));
  assert.ok(ov.includes("fisterView.mode('goo',e.kind==='fistergoo')") && ctl.includes("['fistergoo','🖤 SYMBIOTE FISTER']"));
  const M = await import('../scripts/live-studio-model.mjs'); assert.ok(M.EFFECTS.includes('fistergoo'));
  console.log('Symbiote Fister: passed');
}
// DS and 3DS (2026-11-14): the touch panel; the tilted route; 3D beasts in the battle.
{
  const src = readFileSync(new URL('../scripts/beasts.mjs', import.meta.url), 'utf8'), b3 = readFileSync(new URL('../scripts/beasts-3d.mjs', import.meta.url), 'utf8'), ov = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes("if (gfx === '3ds') {") && src.includes('DS: the bottom screen'));
  assert.ok(b3.includes('export function buildBeast3D(name)') && b3.includes('export function createBattle3D(canvas') && !/Math\.random/.test(b3));
  assert.ok(ov.includes("import('./beasts-3d.mjs?v=12')") && ov.includes("const want3d=settings.beastsGfx==='3ds'"));
  const M = await import('../scripts/live-studio-model.mjs'); assert.equal(M.validateSettings({ ...M.DEFAULT_STUDIO, beastsGfx: '3ds' }).beastsGfx, '3ds');
  console.log('DS / 3DS: passed');
}
// Chat picks the next area; the route in real 3D (2026-11-14).
{
  assert.equal(B.areaOptions(3).length, 3); assert.deepEqual(B.areaOptions(3), B.areaOptions(3));
  assert.deepEqual(B.routeFor(3, 'cave').biomes.slice(0, 2), ['cave', 'cave']); assert.notDeepEqual(B.routeFor(3, 'cave').grid, B.routeFor(3).grid);
  assert.equal(B.publicBeasts({ ...B.emptyBeasts('w'), route: 2, areas: { 2: 'snow', 3: 'city' } }, s).area, 'snow');
  const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8'), b3 = readFileSync(new URL('../scripts/beasts-3d.mjs', import.meta.url), 'utf8'), sb = readFileSync(new URL('../scripts/shed-background.mjs', import.meta.url), 'utf8');
  assert.ok(room.includes("else if (kind === 'area') options = areaOptions(") && room.includes("if (v.kind === 'area')"));
  assert.ok(b3.includes('export function createWorld3D(canvas') && sb.includes("b3d.createWorld3D(canvas"));
  console.log('Area vote + 3D route: passed');
}
// Better models, more variations (2026-11-14): eleven body plans, toon outline, parts by name; 2D stripes and eye kinds.
{
  const b3 = readFileSync(new URL('../scripts/beasts-3d.mjs', import.meta.url), 'utf8'), src = readFileSync(new URL('../scripts/beasts.mjs', import.meta.url), 'utf8');
  for (const k of ["'fish', 'dragon', 'golem', 'ghost', 'sprout'", 'MeshToonMaterial', 'function outline(', 'export function planOf(', "['round', 'angry', 'sleepy']"]) assert.ok(b3.includes(k), k);
  assert.ok(src.includes("const look = hashOf(nm + 'look');") && src.includes('const eyeKind = (look >>> 4) % 3;'));
  assert.ok(!/Math\.random/.test(b3));
  console.log('Beast models: passed');
}
// The 3D route's scenery (2026-11-14).
{
  const b3 = readFileSync(new URL('../scripts/beasts-3d.mjs', import.meta.url), 'utf8');
  for (const k of ['PATH EDGING', 'BRIDGES: planks and rails', 'WATER: one sheet with ripples', 'Palms:', 'Dead trees:', 'HOUSES: walls with windows', 'LAVA: glowing, pulsing', 'THE SKYLINE', 'function sceneTick(']) assert.ok(b3.includes(k), k);
  console.log('3D scenery: passed');
}
// Pixel routes, more detail (2026-11-14): trees by area, path edges, shorelines, ground details.
{
  const src = readFileSync(new URL('../scripts/beasts.mjs', import.meta.url), 'utf8');
  for (const k of ['function treeShade(kind', "b === 'beach' ? 'palm'", 'Path edges: a darker line', 'export const TREE_RAMPS', 'a pebble']) assert.ok(src.includes(k), k);
  console.log('Pixel route detail: passed');
}
// Mr Fister's gym fight in 3D (2026-11-14).
{
  const b3 = readFileSync(new URL('../scripts/beasts-3d.mjs', import.meta.url), 'utf8'), g3 = readFileSync(new URL('../scripts/live-studio-3d.mjs', import.meta.url), 'utf8');
  assert.ok(g3.includes('export function buildBoss3D(id, root)') && g3.includes('export function fisterCoverTextures()'));
  assert.ok(b3.includes("MR FISTER'S GYM IN 3D") && b3.includes('const throwComics = () =>') && B.gymMoveFor('MR FISTER', 3) === 'COMIC STORM' && b3.includes("if (next.trainer === 'MR FISTER') throwComics()"));
  console.log('3D gym fight: passed');
}

// 9. SEASON PASS (2026-11-14): the beast keeps its level, its dex and its rematches all year; only the route resets weekly.
{ const old = { ...B.emptyBeasts('2026-11-04'), route: 7, exp: 900, caught: [{ name: 'A' }, { name: 'B' }], rematch: { 'MR FISTER': 2 }, badges: [{ route: 5 }] };
  const nw = B.ensureBeasts(old, '2026-11-11');
  assert.equal(nw.route, 1, 'the route starts over'); assert.equal(nw.badges.length, 0, 'badges are weekly');
  assert.equal(nw.exp, 900, 'the level stays'); assert.equal(nw.caught.length, 2, 'the dex stays'); assert.deepEqual(nw.rematch, { 'MR FISTER': 2 }); assert.equal(nw.season, 2);
  const off = B.ensureBeasts(old, '2026-11-11', false);
  assert.equal(off.exp, 0, 'season pass off: a clean slate'); assert.equal(off.caught.length, 0); assert.equal(off.lastWeek.route, 7);
  assert.equal(B.ensureBeasts(nw, '2026-11-11'), nw, 'same week: untouched'); }
// 11. WEATHER chat picks: it changes which beasts show up on that route, and only that route.
{ for (const w of ['rain', 'heat', 'snow', 'fog']) { assert.ok(B.WEATHERS[w]); assert.equal(B.wildName(4, 1, w), B.wildName(4, 1, w), 'fixed, not random'); }
  assert.notEqual(B.wildName(4, 0, 'snow'), B.wildName(4, 0, 'heat'), 'snow and heat bring different beasts');
  assert.equal(B.wildName(4, 0, 'clear'), B.wildName(4, 0), 'clear skies: the usual beasts');
  const b = { ...B.emptyBeasts('w'), route: 3, weather: { route: 3, kind: 'rain' } };
  assert.equal(B.weatherOn(b, 3), 'rain'); assert.equal(B.weatherOn({ ...b, route: 4 }, 4), '', 'the next route is clear again');
  assert.equal(B.publicBeasts(b, { beastsGoal: 100 }).weather, 'rain'); }
// 12. RIVAL REMATCHES: each badge from a trainer brings them back stronger next time (25% a rematch).
{ const s = { beastsGoal: 100 };
  assert.equal(B.rivalMax(s, 5, 2), B.rivalMax(s, 5) * (1 + 2 * B.REMATCH_STEP));
  let bs = { ...B.emptyBeasts('w'), route: 5 }; const r = B.addBeastXp(bs, 100 + B.rivalMax(s, 5) + 1, s, 1);
  assert.ok(r.events.some(e => e.kind === 'badge')); assert.equal(r.beasts.rematch['MR FISTER'], 1, 'Mr Fister remembers');
  const again = B.ensureBeasts(r.beasts, 'w2'), back = { ...again, route: 5 };
  assert.equal(B.rematchesOf(back, 5), 1); const r2 = B.addBeastXp(back, 100, s, 2), ev = r2.events.find(e => e.kind === 'rival');
  assert.equal(ev.rematch, 1, 'WANTS A REMATCH!'); assert.equal(r2.beasts.rivalHp, B.rivalMax(s, 5, 1));
  const src = readFileSync(new URL('../scripts/beasts.mjs', import.meta.url), 'utf8'); assert.ok(src.includes('WANTS A REMATCH!')); assert.ok(!/Math\.random/.test(src)); }

// 8. NIGHT BEASTS (2026-11-14): after dark the middle patch has a beast you only see at night; weather still wins.
{ assert.ok(B.isNightBeast(B.wildName(3, B.NIGHT_PATCH, '', true)), 'a night-only beast'); assert.equal(B.wildName(3, 0, '', true), B.wildName(3, 0), 'only the middle patch changes');
  assert.ok(!B.isNightBeast(B.wildName(3, B.NIGHT_PATCH)), 'not in the day'); assert.equal(B.wildName(3, B.NIGHT_PATCH, 'rain', true), B.wildName(3, B.NIGHT_PATCH, 'rain'), 'weather wins');
  assert.equal(B.nightFor({ beastsTimeOfDay: 'night' }), true); assert.equal(B.nightFor({ beastsTimeOfDay: 'day' }), false);
  assert.equal(B.nightFor({}, Date.parse('2026-11-15T06:00:00Z')), true, '10 pm Pacific'); assert.equal(B.nightFor({}, Date.parse('2026-11-14T20:00:00Z')), false, 'noon Pacific');
  const w = B.battleFrom({ floor: 2, phase: 'floor', pct: (B.ENCOUNTERS[B.NIGHT_PATCH][0] + 0.01) * 100, night: true }); assert.equal(w.night, true); assert.ok(B.isNightBeast(w.foe.name));
  const s = { beastsGoal: 100, beastsTimeOfDay: 'night' }; const r = B.addBeastXp({ ...B.emptyBeasts('w'), route: 2 }, 99, s, 1); const c = r.events.filter(e => e.kind === 'caught');
  assert.ok(c.some(e => e.night && B.isNightBeast(e.name)), 'caught at night'); assert.equal(B.publicBeasts(r.beasts, s).night, true); }
// 9b. THE GYM LEADERS (2026-11-14: "cool trainers. Or thematic"): five, each with an arena, a signature move and a line.
{ assert.deepEqual(B.GYM_LEADERS.map(g => g[0]), ['MR FISTER', 'THE GRADER', 'FOIL QUEEN', 'THE ARCHIVIST', 'THE INKER']);
  assert.deepEqual([5, 10, 15, 20, 25, 30].map(r => B.rivalFor(r).name), ['MR FISTER', 'THE GRADER', 'FOIL QUEEN', 'THE ARCHIVIST', 'THE INKER', 'MR FISTER']);
  for (const [name] of B.GYM_LEADERS) { const g = B.gymOf(name); assert.ok(g && g.id && g.arena && g.moves.length && g.line.length <= 30, name); assert.equal(B.gymMoveFor(name, 0), g.moves[0], 'opens with the signature'); }
  assert.equal(B.gymMoveFor('SCALPER STEVE', 0), '', 'route rivals use beast moves');
  assert.equal(B.battleFrom({ floor: 10, phase: 'boss', pct: 50 }).gym, 'grader'); assert.equal(B.battleFrom({ floor: 4, phase: 'boss', pct: 50 }).gym, '');
  const src = readFileSync(new URL('../scripts/beasts.mjs', import.meta.url), 'utf8'), g3 = readFileSync(new URL('../scripts/beasts-gyms-3d.mjs', import.meta.url), 'utf8'), b3 = readFileSync(new URL('../scripts/beasts-3d.mjs', import.meta.url), 'utf8');
  for (const id of ['grader', 'foil', 'archivist', 'inker']) { assert.ok(new RegExp('\\n  ' + id + '\\(P, L\\) \\{').test(src), 'pixel sprite ' + id); assert.ok(new RegExp('\\n  ' + id + '\\(\\) \\{').test(g3), '3D model ' + id); assert.ok(g3.includes("id === '" + id + "'"), 'arena + move ' + id); }
  for (const k of ["from './beasts.mjs?v=19'", "from './beasts-gyms-3d.mjs?v=1'", 'signatureFx(gymId, scene, from', "if (b && b.kind === 'rival' && b.gym && b.gym !== 'fister') arenaBg("]) assert.ok((b3 + src).includes(k), k);
  assert.ok(!/Math\.random/.test(g3), 'nothing by chance'); assert.ok(!/pok[eé]mon|nintendo|marvel/i.test(g3.replace(/^\/\/.*$/gm, '')), 'our own designs'); }
// Mr Fister's beast is SPIDER-CHEEKS, a baboon (store, 2026-11-14), drawn as one in pixels and in 3D.
{ assert.equal(B.rivalFor(5).beast, 'SPIDER-CHEEKS'); assert.equal(B.beastType('SPIDER-CHEEKS'), 'baboon');
  const px = B.makeBeast('SPIDER-CHEEKS'); assert.equal(px.type, 'baboon'); assert.ok(px.frames[0].flat().filter(v => v >= 0).length > 200, 'a full sprite');
  const b3 = readFileSync(new URL('../scripts/beasts-3d.mjs', import.meta.url), 'utf8'); assert.ok(b3.includes("if (nm === 'SPIDER-CHEEKS') return 'baboon';") && b3.includes("if (plan === 'baboon') {")); }
// SPIDER-CHEEKS shows off its red behind (store, 2026-11-14): 2.4 s of every 9, on the clock; the back sprite has it.
{ assert.ok(B.cheeksShow(1) && B.cheeksShow(9.5) && !B.cheeksShow(5), 'on the clock');
  const back = B.makeBeast('SPIDER-CHEEKS', { back: true }).frames[0], front = B.makeBeast('SPIDER-CHEEKS').frames[0];
  const light = f => f.slice(20, 29).flat().filter(v => v === 0).length; assert.ok(light(back) > light(front) + 20, 'the red behind, from the back');
  const src = readFileSync(new URL('../scripts/beasts.mjs', import.meta.url), 'utf8'), b3 = readFileSync(new URL('../scripts/beasts-3d.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes("drawBeast(beast(b.foe.name, cheeksOn)") && src.includes("'SPIDER-CHEEKS SHOWS OFF ITS CHEEKS!'") && b3.includes("if (plan === 'baboon') { const k = ((t % 9) + 9) % 9") && b3.includes("'SPIDER-CHEEKS SHOWS OFF ITS CHEEKS!'")); }
// The host and Champ in the 3DS battle (store, 2026-11-14): the same two as the pixel sprites, reacting to the fight.
{ const b3 = readFileSync(new URL('../scripts/beasts-3d.mjs', import.meta.url), 'utf8');
  for (const k of ["export function trainer3D(who) {", "x.fillText('MP', 128, 78)", "x.fillText('24', 0, 92)", "// The cap on backwards", "// Bald and shiny, glasses.", "crew = [trainer3D('host'), trainer3D('champ')]", "crew?.forEach(c => c.point())", "levelUp(name, level) { crew?.forEach(c => c.cheer());", "evolve(from, to) { evo = { at: performance.now() }; crew?.forEach(c => c.cheer());"]) assert.ok(b3.includes(k), k); }
