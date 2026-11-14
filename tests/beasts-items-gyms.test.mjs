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
assert.ok(B.rivalFor(5).gym && B.rivalFor(5).name === 'MR FISTER' && /^LEADER /.test(B.rivalFor(10).name) && !B.rivalFor(4).gym, 'the first gym is Mr Fister');
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
