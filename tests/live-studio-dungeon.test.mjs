// The Shed Dungeon: the mana flask, floors, floor bosses, the weekly reset,
// stars and the finale, taps, and per-show unlocks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOMS, RELICS, doorsFor, relicFor, parseRoomLines, weekKey, nextResetKey, ensureWeek, emptyDungeon, addMana, addTap, adjustDungeon, floorGoal, bossMax, publicDungeon, showUnlocksCrossed, parseLines, shedFor, SHEDS, DUNGEON_DEFAULTS } from '../scripts/live-studio-dungeon.mjs';
import { DEFAULT_STUDIO, validateSettings, applyOrder, emptyStats, makeEffect, chanceWordIn } from '../scripts/live-studio-model.mjs';

const S = { ...DEFAULT_STUDIO };
// Wed Nov 4 2026, noon Pacific = 20:00Z. Tue Nov 3 = last week.
const WED = Date.parse('2026-11-04T20:00:00Z'), TUE = Date.parse('2026-11-03T20:00:00Z'), NEXT_TUE = Date.parse('2026-11-10T20:00:00Z');
assert.equal(weekKey(WED), '2026-11-04');
assert.equal(weekKey(NEXT_TUE), '2026-11-04', 'Tuesday is still the same week');
assert.equal(weekKey(TUE), '2026-10-28');
// Just after midnight Wednesday Pacific (07:30Z) is the new week; just before is not.
assert.equal(weekKey(Date.parse('2026-11-04T08:30:00Z')), '2026-11-04');
assert.equal(weekKey(Date.parse('2026-11-04T06:30:00Z')), '2026-10-28');
assert.equal(nextResetKey(WED), '2026-11-11');

// Settings are in the studio defaults and validate.
for (const k of Object.keys(DUNGEON_DEFAULTS)) assert.ok(k in DEFAULT_STUDIO, k);
assert.deepEqual(validateSettings({ floorBase: 200, finale: true, showUnlocks: '100: Shoutout' }), { floorBase: 200, finale: true, showUnlocks: '100: Shoutout' });
assert.throws(() => validateSettings({ floorGrowth: 900 }), /Invalid floorGrowth/);
assert.throws(() => validateSettings({ floorRewards: '3: raffle for the grail' }), /game of chance.*floor rewards/);
assert.throws(() => validateSettings({ showUnlocks: '50: spin the wheel' }), /show unlocks/);

// Goals: $100 floor 1, +25% each floor; the boss has half.
assert.equal(floorGoal(S, 1), 100);
assert.equal(floorGoal(S, 2), 125);
assert.equal(floorGoal(S, 3), 156);
assert.equal(bossMax(S, 1), 50);
// The finale: +10% per star this week.
assert.equal(floorGoal({ ...S, finale: true }, 1, { stars: 3 }), 130);
assert.equal(SHEDS.length, 7);
assert.equal(shedFor(1), 'GARDEN SHED');
assert.equal(shedFor(50), 'THE SHED BENEATH THE SHED');

// Filling the floor brings the boss; beating it opens floor 2; leftovers carry.
let d = emptyDungeon(weekKey(WED));
let r = addMana(d, 60, S, WED);
assert.equal(r.dungeon.mana, 60); assert.equal(r.events.length, 0);
r = addMana(r.dungeon, 50, S, WED); // 40 fills it, 10 hits the boss
assert.equal(r.events[0].kind, 'floor'); assert.equal(r.events[0].floor, 1);
assert.equal(r.dungeon.phase, 'boss'); assert.equal(r.dungeon.bossHp, 40);
const rewards = { ...S, floorRewards: '1: Free giveaway in the Whatnot tool\n2: $1 start on a grail' };
r = addMana(r.dungeon, 45, rewards, WED);
assert.equal(r.events[0].kind, 'boss'); assert.equal(r.events[0].nextFloor, 2);
assert.equal(r.events[0].reward, 'Free giveaway in the Whatnot tool');
assert.equal(r.dungeon.floor, 2); assert.equal(r.dungeon.stars, 1); assert.equal(r.dungeon.mana, 5);
// A huge sale can clear several floors in one go.
r = addMana(emptyDungeon(weekKey(WED)), 1000, S, WED);
assert.ok(r.dungeon.floor >= 4, 'cleared several floors');
assert.equal(r.events.filter(e => e.kind === 'boss').length, r.dungeon.floor - 1);
// Off: nothing moves.
assert.equal(addMana(emptyDungeon(), 500, { ...S, dungeonOn: false }, WED).dungeon.floor, 1);

// The week resets on Wednesday; last week's result is kept.
const old = { ...emptyDungeon('2026-10-28'), floor: 4, stars: 3 };
const fresh = ensureWeek(old, WED);
assert.equal(fresh.floor, 1); assert.equal(fresh.stars, 0);
assert.deepEqual(fresh.lastWeek, { week: '2026-10-28', floor: 4, stars: 3, relics: 0 });
assert.equal(ensureWeek(old, TUE), old, 'same week is untouched');

// Taps: follow +5, share +5, bookmark +2.
r = addTap(emptyDungeon(weekKey(WED)), 'follow', S, WED);
assert.equal(r.amount, 5); assert.equal(r.dungeon.mana, 5); assert.equal(r.dungeon.taps.follow, 1);
assert.equal(addTap(r.dungeon, 'bookmark', S, WED).dungeon.mana, 7);
assert.throws(() => addTap(r.dungeon, 'like', S, WED), /Invalid tap/);

// Fixes: set the floor, reset the week.
assert.equal(adjustDungeon({ ...emptyDungeon(weekKey(WED)), mana: 40 }, { floor: 3 }, WED).floor, 3);
assert.throws(() => adjustDungeon(emptyDungeon(), { floor: 0 }, WED), /Invalid floor/);
const reset = adjustDungeon({ ...emptyDungeon(weekKey(WED)), floor: 5, stars: 4, lastWeek: { week: 'x', floor: 2, stars: 1 } }, { resetWeek: true }, WED);
assert.equal(reset.floor, 1); assert.equal(reset.stars, 0); assert.equal(reset.lastWeek.floor, 2);

// Per-show unlocks.
assert.deepEqual(parseLines('$100: Shoutout\n  junk\n50 - Pack opened on stream').map(x => x.n), [50, 100]);
assert.deepEqual(showUnlocksCrossed(40, 120, { showUnlocks: '50: A\n100: B\n200: C' }).map(x => x.text), ['A', 'B']);

// What the overlay sees.
const pub = publicDungeon({ ...emptyDungeon(weekKey(WED)), mana: 25 }, { ...S, showUnlocks: '100: Shoutout' }, 30, WED);
assert.equal(pub.floor, 1); assert.equal(pub.shed, 'GARDEN SHED'); assert.equal(pub.pct, 25); assert.equal(pub.goal, 100);
assert.equal(pub.boss.active, false); assert.equal(pub.nextUnlock.text, 'Shoutout'); assert.equal(pub.resets, '2026-11-11');
const pubBoss = publicDungeon({ ...emptyDungeon(weekKey(WED)), mana: 100, phase: 'boss', bossHp: 25 }, S, 0, WED);
assert.equal(pubBoss.pct, 50); assert.equal(pubBoss.boss.active, true);

// With the dungeon on, the show's old boss bar doesn't fire on a sale.
const order = { id: 'o1', show_id: 'show1', status: 'pending_fulfillment', transaction_type: 'auction', amounts: { subtotal: { amount: 600 } } };
assert.equal(applyOrder(emptyStats('show1'), order, { ...S, showId: 'show1' }).effect.kind, 'jackpot');
assert.equal(applyOrder(emptyStats('show1'), order, { ...S, showId: 'show1', dungeonOn: false }).effect.kind, 'boss');

// Effects carry the dungeon's fields, cleaned.
const fx = makeEffect('boss', S, WED, { dungeon: true, bossName: 'THE FLIPPER', bossCharacter: 'flipper', reward: 'Free giveaway', floor: 1, nextFloor: 2, shed: 'RUSTY TOOL SHED' });
assert.equal(fx.bossName, 'THE FLIPPER'); assert.equal(fx.nextFloor, 2); assert.equal(fx.reward, 'Free giveaway');
assert.equal(makeEffect('boss', S, WED, { dungeon: true, bossCharacter: 'nope' }).bossCharacter, S.bossCharacter);
assert.equal(makeEffect('tap', S, WED, { tapKind: 'share', mana: 5 }).tapKind, 'share');
assert.equal(makeEffect('unlock', S, WED, { unlockText: 'Shoutout', unlockAt: 100 }).unlockAt, 100);

// The room: sales fill the flask, taps and fixes have routes, stats show it.
const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8');
assert.match(room, /s\.dungeon = ensureWeek\(s\.dungeon\)/);
assert.match(room, /addMana\(s\.dungeon, Math\.round\(\(s\.stats\.gross - grossBefore\)/);
assert.match(room, /dungeon: publicDungeon\(/);
const api = readFileSync(new URL('../scripts/live-studio-api.mjs', import.meta.url), 'utf8');
assert.match(api, /\/live-studio\/dungeon-tap/); assert.match(api, /\/live-studio\/dungeon-adjust/);
// The overlay and the controls.
const overlay = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8');
assert.match(overlay, /'FLOOR '\+d\.floor\+' · '\+\(d\.room\?d\.room\.name:d\.shed\)/);
assert.match(overlay, /setProperty\('--fill'/);
const controls = readFileSync(new URL('../scripts/live-studio-controls.js', import.meta.url), 'utf8');
for (const k of ['data-tap="follow" data-key="F"', 'data-tap="share" data-key="Y"', 'data-tap="bookmark" data-key="B"', 'data-toggle="finale"', 'name="floorRewards"', 'name="showUnlocks"', 'mana-reset-week']) assert.ok(controls.includes(k), k);
// Chat picks the path: after a boss, two doors (fixed by the floor, no draw).
assert.deepEqual(doorsFor(2), ['vault', 'library']);
assert.deepEqual(doorsFor(3), ['armory', 'forge']);
assert.deepEqual(doorsFor(2 + ROOMS.length / 2), doorsFor(2), 'doors cycle in a set order');
let p = addMana(emptyDungeon(weekKey(WED)), 150, { ...S, roomRewards: 'library: Back issue spotlight' }, WED);
const bossEv = p.events.find(e => e.kind === 'boss');
assert.deepEqual(bossEv.doors, ['vault', 'library']);
assert.equal(bossEv.relic, RELICS[0].name);
assert.deepEqual(p.dungeon.doors, ['vault', 'library']);
let picked = adjustDungeon(p.dungeon, { door: 1 }, WED);
assert.equal(picked.rooms[2], 'library'); assert.equal(picked.doors, null);
assert.throws(() => adjustDungeon(picked, { door: 0 }, WED), /no doors/);
assert.throws(() => adjustDungeon(p.dungeon, { door: 2 }, WED), /Invalid door/);
const roomS = { ...S, roomRewards: 'library: Back issue spotlight\nnope: x' };
assert.deepEqual(parseRoomLines(roomS.roomRewards), { library: 'Back issue spotlight' });
let pub2 = publicDungeon(picked, roomS, 0, WED);
assert.equal(pub2.room.name, 'BACK ISSUE LIBRARY'); assert.equal(pub2.reward, 'Back issue spotlight');
assert.equal(pub2.relics.length, 1); assert.equal(pub2.relics[0].icon, relicFor(1).icon);
assert.deepEqual(pub2.map.map(m => [m.floor, m.cleared, m.current, m.dark]), [[1, true, false, false], [2, false, true, false], [3, false, false, true], [4, false, false, true]]);
assert.equal(pub2.map[1].room, 'BACK ISSUE LIBRARY');
// No pick before the next flask fills: door 1 it is.
const auto = addMana(p.dungeon, 200, S, WED);
assert.equal(auto.dungeon.rooms[2], 'vault');
assert.equal(auto.events[0].kind, 'room'); assert.equal(auto.events[0].auto, true);
// A new week clears the map but remembers last week's relics.
assert.equal(ensureWeek({ ...picked, week: '2026-10-28' }, WED).lastWeek.relics, 1);
// Effects carry rooms/doors by id only.
const rfx = makeEffect('room', S, WED, { room: 'vault', floor: 2, auto: true });
assert.equal(rfx.room, 'vault'); assert.equal(rfx.auto, true);
assert.equal(makeEffect('room', S, WED, { room: '<script>' }).room, undefined);
assert.deepEqual(makeEffect('boss', S, WED, { dungeon: true, doors: ['vault', 'bad', 'library'], relic: 'RUSTY TROWEL', relicIcon: '🪏' }).doors, ['vault', 'library']);
assert.throws(() => validateSettings({ roomRewards: 'vault: lottery ticket' }), /room rewards/);
assert.match(api, /door:body\.door/);
assert.match(overlay, /CHAT: PICK A DOOR!/);
assert.match(controls, /'dungeon-adjust',\{door:i\}/);
// 2026-11-11: the dungeon runs itself -- a show of ours going live on
// Whatnot is followed automatically (full runtime check: live-studio-runtime).
{
  const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8');
  assert.ok(room.includes("if (event?.type === 'shows.started' && s.settings.automatic && event.version === 'v2' && (!s.settings.sellerId || event.seller_id === s.settings.sellerId)"));
  assert.ok(room.includes('s.stats = emptyStats(s.settings.showId);'));
}
// CENTER STAGE (2026-11-11): the big mana bar across the middle, the boss standing on it.
{
  const ov = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8'), html = readFileSync(new URL('../arcade-overlay.html', import.meta.url), 'utf8'), css = readFileSync(new URL('../assets/live-studio.css', import.meta.url), 'utf8');
  assert.equal(DUNGEON_DEFAULTS.centerStage, true);
  assert.deepEqual(validateSettings({ centerStage: false }), { centerStage: false });
  assert.ok(html.includes('<div id="mana-cbar-sub"></div>'));
  assert.ok(html.includes('<div class="mana-liquid" aria-hidden="true"></div><div class="mana-bubbles" aria-hidden="true"></div>'), 'the bubbling mana stays');
  assert.ok(html.includes('<section id="mana-arena" class="mana-hidden" aria-label="Boss"></section>'));
  assert.ok(ov.includes("const center=!!d&&settings.centerStage!==false&&settings.visible!==false"));
  assert.ok(ov.includes("arena.classList.toggle('mana-hidden',!(center&&d.phase==='boss'&&settings.showBoss!==false&&!beastMode()));"));
  assert.doesNotMatch(css, /body\.mana-center \.mana-(liquid|bubbles)[^{]*\{[^}]*display:none/, 'center stage never hides the bubbling mana');
  assert.match(css, /body\.mana-center #mana-sign\{left:40px!important;width:1000px!important;height:200px!important/);
  assert.match(css, /body\.mana-center #byterider\{z-index:2\}/);
}
// THE CRAWL + CHAT PICKS (2026-11-11): a hallway the hero walks as mana fills;
// chat votes on the weapon, what's next, or a door, and the host taps the winner.
{
  const { WEAPONS, weaponById } = await import('../scripts/live-studio-dungeon.mjs');
  assert.deepEqual(WEAPONS.map(w => w.id), ['pricegun', 'fireball', 'chicken', 'longbox']);
  let dd = emptyDungeon(weekKey(WED));
  dd = adjustDungeon(dd, { weapon: 'chicken' }, WED);
  assert.equal(publicDungeon(dd, { ...DEFAULT_STUDIO, dungeonOn: true }, 0, WED).weapon.name, 'RUBBER CHICKEN');
  assert.throws(() => adjustDungeon(dd, { weapon: 'slot-machine' }, WED), /Invalid weapon/);
  assert.equal(weaponById('nope'), null);
  for (const w of WEAPONS) assert.ok(!chanceWordIn(w.name + ' ' + w.hit), 'no game-of-chance words');
  const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8'), api = readFileSync(new URL('../scripts/live-studio-api.mjs', import.meta.url), 'utf8');
  for (const k of ["if (kind === 'weapon') options = WEAPONS.map", "else if (kind === 'next')", "else if (kind === 'door')", "s.vote = null;", "vote: state.vote ? { kind: state.vote.kind, question: state.vote.question"]) assert.ok(room.includes(k), k);
  for (const k of ["/live-studio/vote-open", "/live-studio/vote-pick", "/live-studio/vote-close"]) assert.ok(api.includes(k), k);
  const ov = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8'), html = readFileSync(new URL('../arcade-overlay.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<section id="mana-crawl"') && html.includes('<section id="mana-vote"'));
  assert.ok(ov.includes("fp.set({floor:d.floor,shed:d.shed,pct:d.pct,phase:d.phase,chests:[0,1,2].map(k=>(d.opened||[]).includes(k)),boxes:[0,1].map(k=>!!d.boxes?.[k]?.open),"), 'the first-person crawl follows the floor and its mana');
  assert.ok(html.includes('<canvas id="mana-fp" width="240" height="96" aria-hidden="true"></canvas>'));
  assert.ok(ov.includes("dmg.textContent=(wpn?wpn.icon+' '+wpn.hit+' ':'')"), 'hits show chat\'s weapon');
  assert.match(controls, /data-vote="weapon"/);
}
// THE SHED CRAWL, first person (2026-11-11): fixed layouts, the route and
// rooms are walkable, the walk is the floor's mana, nothing random.
{
  const { buildMap, poseAt, layoutFor, VIEW_W, VIEW_H } = await import('../scripts/shed-crawl-fp.mjs');
  assert.deepEqual([VIEW_W, VIEW_H], [240, 96]);
  for (const floor of [1, 2, 3, 4]) {
    const { grid, layout } = buildMap(floor);
    assert.deepEqual(buildMap(floor).grid, grid, 'the same floor is always the same shed');
    assert.notDeepEqual(layoutFor(floor + 1).route, layout.route, 'every floor its own shed');
    for (let t = 0; t <= 1.0001; t += 0.05) { const p = poseAt(layout, t); assert.equal(grid[Math.floor(p.y)][Math.floor(p.x)], 0, 'the walk stays in the open: floor ' + floor + ' t ' + t.toFixed(2)); }
    for (const pk of layout.peeks) assert.equal(grid[pk.cell[1]][pk.cell[0]], 0);
    const [bx, by] = layout.boss; assert.equal(grid[by][bx], 0);
    assert.equal(grid.length, 40); assert.ok(grid.every(row => row[0] && row[39]) && grid[0].every(Boolean) && grid[39].every(Boolean), 'walled in');
  }
  const L = layoutFor(1), a0 = poseAt(L, 0), a1 = poseAt(L, 0.5);
  assert.ok(Math.hypot(a1.x - a0.x, a1.y - a0.y) > 1, 'mana walks you forward');
  const src = readFileSync(new URL('../scripts/shed-crawl-fp.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Math\.random/, 'nothing random');
}
// TREASURE CHESTS (2026-11-11): chat goals (follows, shares, bookmarks, taps)
// open a chest with the store's own reward line. Never sales, nothing drawn.
{
  const { parseChestLines, chestsOf, chestsOpened } = await import('../scripts/live-studio-dungeon.mjs');
  const S = { ...DEFAULT_STUDIO, dungeonOn: true, manaFollow: 0, manaShare: 0, manaBookmark: 0, chestGoals: '10 follows: Free giveaway in the Whatnot tool\n25 taps: Open a box on stream\n5 shares: $1 start on a slab\n100 dollars: not a chat goal\nnonsense' };
  assert.deepEqual(parseChestLines(S.chestGoals).map(c => [c.n, c.kind]), [[10, 'follow'], [25, 'tap'], [5, 'share']], 'only chat goals; sales are never a chest');
  let d = emptyDungeon(weekKey(WED)), opened = [];
  for (let i = 0; i < 10; i++) { const next = addTap(d, 'follow', S, WED).dungeon; opened.push(...chestsOpened(d, next, S)); d = next; }
  assert.deepEqual(opened.map(c => c.text), ['Free giveaway in the Whatnot tool'], 'the 10th follow opens the first chest, once');
  assert.deepEqual(chestsOf(S, d).map(c => [c.have, c.open]), [[10, true], [10, false], [0, false]]);
  assert.equal(publicDungeon(d, S, 0, WED).chests.length, 3);
  assert.equal(chestsOf(S, ensureWeek(d, Date.parse('2026-11-12T20:00:00Z'))).filter(c => c.open).length, 0, 'chests close again with the new week');
  assert.throws(() => validateSettings({ chestGoals: '10 follows: spin the wheel' }), /game of chance.*treasure chests/);
  assert.equal(makeEffect('chest', DEFAULT_STUDIO, WED, { chestText: 'Free giveaway in the Whatnot tool', chestGoal: '10 FOLLOWS' }).chestGoal, '10 FOLLOWS');
  const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8');
  assert.ok(room.includes("const chest = chestsOpened(s.dungeon, r.dungeon, s.settings).pop();"));
  assert.match(controls, /textarea name="chestGoals"/);
}
// 2026-11-11: green screen, item photos, chests on the path, FOUND IT!, the
// fork, the battery, naming the floor and ByteRider trivia.
{
  const L = await import('../scripts/live-studio-dungeon.mjs');
  const S = { ...DEFAULT_STUDIO, dungeonOn: true, manaFollow: 0, manaShare: 0, manaBookmark: 0, floorBase: 100, chestGoals: '3 follows: $1 start on a big book' };
  assert.deepEqual(L.CHEST_AT, [0.16, 0.47, 0.8]);
  let d = L.emptyDungeon(weekKey(WED));
  d = L.addMana(d, 20, S, WED).dungeon;
  assert.deepEqual(L.chestsToOpen(d, S).map(c => c.k), [], 'chest 1 has a chat goal: locked until 3 follows');
  for (let i = 0; i < 3; i++) d = L.addTap(d, 'follow', S, WED).dungeon;
  assert.deepEqual(L.chestsToOpen(d, S).map(c => c.k), [0], 'reached and the goal met: it opens');
  d = L.openChest(d, 0, WED);
  assert.deepEqual(L.chestsToOpen(d, S).map(c => c.k), [], 'once');
  d = L.addMana(d, 30, S, WED).dungeon;
  assert.deepEqual(L.chestsToOpen(d, S).map(c => c.k), [1], 'chest 2 has no goal: it opens when the crawl gets there');
  assert.deepEqual(L.publicDungeon(L.openChest(d, 1, WED), S, 0, WED).opened, [0, 1]);
  // The fork and the floor name.
  d = L.adjustDungeon(d, { fork: 'left' }, WED); assert.equal(L.publicDungeon(d, S, 0, WED).fork, 'left');
  assert.throws(() => L.adjustDungeon(d, { fork: 'up' }, WED), /Invalid fork/);
  d = L.adjustDungeon(d, { name: '  the box   fort ' }, WED); assert.equal(L.publicDungeon(d, S, 0, WED).name, 'THE BOX FORT');
  // Trivia: real questions, no chance words; the answer never goes to the overlay.
  assert.ok(L.TRIVIA.length >= 15 && L.TRIVIA.every(t => t.q && t.a && !chanceWordIn(t.q + ' ' + t.a)));
  const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8');
  assert.ok(room.includes("vote: state.vote ? { kind: state.vote.kind, question: state.vote.question || '', options: state.vote.options } : null"), 'the overlay gets the question, never the answer');
  assert.ok(room.includes("return { ...this.publicState(s), triviaAnswer: s.vote.answer };"), 'the host sees the answer');
  for (const k of ["else if (kind === 'dig')", "else if (kind === 'fork')", "openReachedChests(s, now)", "if (item) s.stage = { ...s.stage, next: [item, ...next] };"]) assert.ok(room.includes(k), k);
  assert.ok(validateSettings({ triviaMana: 25, crawlWindow: true }));
  // The 3D engine: any size, photo walls, battery, fork.
  const fp = readFileSync(new URL('../scripts/shed-crawl-fp.mjs', import.meta.url), 'utf8');
  const { buildMap } = await import('../scripts/shed-crawl-fp.mjs');
  assert.ok(buildMap(1).grid.flat().some(c => c >= 1000), 'racks and slab walls frame item photos');
  assert.notDeepEqual(buildMap(1, 'left').grid, buildMap(1, 'right').grid, 'the fork changes the shed');
  for (const k of ['export function loadPicture(src)', "im.crossOrigin = 'anonymous'", 'setPictures(list, kinds = [])', 'batt = 0.25 + 0.75']) assert.ok(fp.includes(k), k);
  // The green screen is the crawl now.
  const bg = readFileSync(new URL('../scripts/shed-background.mjs', import.meta.url), 'utf8');
  assert.ok(bg.includes("fp = fpm.createShedCrawl(canvas, { w: W, h: Math.round(W * h / 1080), fov: 0.66 });"));
  assert.ok(bg.includes("painted = demo || params.get('painted') === '1'"));
  // The image route only serves the inventory's own image hosts.
  const w = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
  assert.ok(w.includes("if (url.pathname === '/public/studio-img' && request.method === 'GET')") && w.includes("if (!okHost) return new Response('Host not allowed', { status: 403 });"));
  // The overlay: the reveal spins the item; trivia in the banner.
  const ov2 = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8'), css = readFileSync(new URL('../assets/live-studio.css', import.meta.url), 'utf8');
  assert.ok(ov2.includes('react(e);revealItem(e);'));
  assert.match(css, /@keyframes mana-reveal-spin\{to\{transform:rotateY\(360deg\)\}\}/);
  assert.match(controls, /data-vote="dig"/); assert.match(controls, /id="mana-trivia"/); assert.match(controls, /id="mana-floor-name-go"/);
}
// 2026-11-11: the SHOW REMOTE (big buttons up top, settings folded away) and
// PROPS IN FRONT (shed junk and chests slide past in front of the hosts).
{
  assert.match(controls, /<section class="mana-remote" aria-label="Show remote">/);
  assert.match(controls, /<details class="mana-all mana-sec" id="mana-all"><summary>⚙ Settings<\/summary>/);
  for (const t of ['#mana-taps [data-tap=follow]', '#mana-vote-open [data-vote=dig]', '#mana-trivia', '#mana-load']) assert.ok(controls.includes('data-click="' + t + '"'), t);
  assert.ok(controls.indexOf('id="mana-vote-pick"') < controls.indexOf('<details class="mana-all mana-sec"'), 'the winner buttons are in the remote');
  assert.ok(controls.includes("host.querySelector('.mana-remote').onclick=e=>{const b=e.target.closest('[data-click]');if(b)host.querySelector(b.dataset.click)?.click();};"));
  assert.equal(DUNGEON_DEFAULTS.foreground, true);
  const { drawSprite, SPRITE_KINDS } = await import('../scripts/shed-crawl-fp.mjs');
  assert.ok(['comics', 'dollarbin', 'cardbox', 'chest', 'chestopen'].every(k => SPRITE_KINDS.includes(k)));
  const calls = []; const ctx = { canvas: { width: 160, height: 160 }, clearRect() {}, fillRect: (...a) => calls.push(a), set fillStyle(v) {} };
  assert.equal(drawSprite(ctx, 'chest', 10), true); assert.ok(calls.length > 20);
  const ov3 = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8'), html = readFileSync(new URL('../arcade-overlay.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<div id="mana-fg" class="mana-hidden" aria-hidden="true">'));
  assert.ok(ov3.includes("paintCrawl(d,center);paintForeground(d,center);"));
  assert.ok(ov3.includes("p.kind==='chest'?fgOpened.includes(p.idx):p.kind==='lockbox'&&fgBoxes.includes(p.idx)"), 'the chest passes by in front, open once opened');
}
// The setup preview shows the green-screen shed behind the top camera (2026-11-11).
{
  assert.ok(controls.includes('<iframe class="mana-preview-bg" title="Green-screen shed behind the top camera" src="shed-background.html#preview=1"></iframe>'));
  assert.ok(controls.includes("host.querySelector('.mana-preview-bg')?.contentWindow?.postMessage(msg,location.origin);"));
  const bg2 = readFileSync(new URL('../scripts/shed-background.mjs', import.meta.url), 'utf8');
  assert.ok(bg2.includes("if (ev.source !== parent || ev.origin !== location.origin) return; if (ev.data?.type === 'mana-camera')") && bg2.includes("if (ev.data?.type !== 'mana-preview') return;"), 'only its own dashboard can drive the preview');
}
// 2026-11-11: "still don't see items playing next ... nothing happens when I hit
// the buttons ... can it use the names of users?" -- NOW PLAYING / NEXT UP is in
// the remote, messages and errors show there, it refreshes while connected,
// and trivia takes the winner's username.
{
  const remote = controls.slice(controls.indexOf('<section class="mana-remote"'), controls.indexOf('<details class="mana-all"'));
  for (const id of ['id="mana-find"', 'id="mana-stage"', 'id="mana-next"', 'id="mana-remote-msg"', 'id="mana-trivia-who"', 'id="mana-doors-pick"', 'id="mana-vote-pick"']) assert.ok(remote.includes(id), id + ' is in the remote');
  assert.ok(controls.includes("new MutationObserver(()=>{const m=host.querySelector('#mana-remote-msg');if(m)m.textContent=status.textContent;})"));
  assert.ok(controls.includes("if(form.contains(document.activeElement)||d.revision===revision)took({stats:d.stats,stage:d.stage});"), 'never overwrites settings being typed');
  const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8'), api = readFileSync(new URL('../scripts/live-studio-api.mjs', import.meta.url), 'utf8');
  assert.ok(room.includes('pickVote(index, who = \'\')') && api.includes("room.pickVote(Number(body.index),String(body.who||''))"));
}
// 2026-11-11: "the sheds need to vary and look better. PS1 graphics. I don't
// see my items in the shed as we walk by."
{
  const fp = await import('../scripts/shed-crawl-fp.mjs');
  for (let f = 1; f <= 40; f++) {
    const L = fp.layoutFor(f), { grid } = fp.buildMap(f);
    assert.deepEqual(fp.generateLayout(f), L, 'the same floor is always the same shed (seeded, not random)');
    for (let t = 0; t <= 1.0001; t += 0.02) { const p = fp.poseAt(L, t); assert.equal(grid[Math.floor(p.y)][Math.floor(p.x)], 0, 'floor ' + f + ' walk stays in the open'); }
    assert.equal(L.peeks.length, 2);
  }
  assert.ok(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(f => JSON.stringify(fp.layoutFor(f).route))).size >= 7, 'the floors differ');
  const src = readFileSync(new URL('../scripts/shed-crawl-fp.mjs', import.meta.url), 'utf8');
  for (const k of ["'GARDEN SHED': { f: 'planks', c: 'rafters' }", 'const lights = [...wins];', 'rowDist = posZ / p']) assert.ok(src.includes(k), k);
  const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8'), api = readFileSync(new URL('../scripts/live-studio-api.mjs', import.meta.url), 'utf8');
  assert.ok(room.includes('setPics(list) {') && room.includes('pics:state.pics || []') && api.includes("/live-studio/pics"));
  assert.ok(controls.includes("sendShedPics(d.pics).catch(()=>{}).then(readyList);"), 'connecting sends the in-stock photos');
  const ov4 = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8'), bg4 = readFileSync(new URL('../scripts/shed-background.mjs', import.meta.url), 'utf8');
  assert.ok(ov4.includes("if(Array.isArray(m.pics)){shedPics=m.pics;loadPictures();loadFgPics();}") && bg4.includes('if (Array.isArray(m.pics)) shedPics = m.pics;'));
  assert.ok(ov4.includes("const FG_KINDS=['comics','pic',"), 'items pass by in front, in top loaders');
}
// 2026-11-11: "we need comics and stuff too" and "the chest opens and the item spins".
{
  assert.ok(controls.includes("if(/suppl|bcw|accessor/i.test(cat+' '+(i.vendor||'')))continue;"), 'supplies stay out of the shed');
  assert.ok(controls.includes('const l=lists[k%lists.length]'), 'every category takes turns on the walls');
  const ov5 = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8'), html5 = readFileSync(new URL('../arcade-overlay.html', import.meta.url), 'utf8'), css5 = readFileSync(new URL('../assets/live-studio.css', import.meta.url), 'utf8');
  assert.ok(html5.includes('<canvas id="mana-reveal-chest" width="160" height="160" aria-hidden="true"></canvas>') && html5.includes('<div class="mana-reveal-rays" aria-hidden="true"></div>'));
  assert.ok(ov5.includes("fpLib.drawSprite(k,'chest',10);") && ov5.includes("fpLib.drawSprite(k,'chestopen',10)"), 'the chest shows shut, then pops open');
  assert.match(css5, /@keyframes mana-item-rise\{0%\{transform:translateY\(330px\) scale\(\.18\)/);
}
// 2026-11-11: chests run their item -- NOW PLAYING at once and into the
// Whatnot show as a $1 start -- and the remote connects on its own.
{
  const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8'), api = readFileSync(new URL('../scripts/live-studio-api.mjs', import.meta.url), 'utf8'), w = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8'), wn = readFileSync(new URL('../scripts/whatnot-api.mjs', import.meta.url), 'utf8');
  assert.ok(room.includes("if (item) { s.stage = { now: item, next: s.stage.now ? [s.stage.now, ...next] : next }; this.chestItem = item; }"), 'the chest item is NOW PLAYING');
  assert.ok(room.includes('return {ok:true, ...this.takeChest(s)};'));
  assert.ok(api.includes('if (r?.chestItem?.id && r.showId && deps.chestToWhatnot)') && wn.includes('deps.chestToWhatnot ? deps.chestToWhatnot(storeId, r.chestItem, r.showId)'));
  assert.ok(w.includes("{ starts: { [item.id]: 1 } });"), 'a $1 start in the show');
  const { validateStage } = await import('../scripts/live-studio-model.mjs');
  assert.equal(validateStage({ now: { title: 'X', id: '0f9dd4bc-42a7-487e-a972-2905d24513e9' }, next: [{ title: 'Y', id: 'bad' }] }).now.id, '0f9dd4bc-42a7-487e-a972-2905d24513e9');
  assert.equal(validateStage({ now: null, next: [{ title: 'Y', id: 'bad' }] }).next[0].id, undefined);
  assert.ok(controls.includes("let id=store();if(body && (!connectedStore || connectedStore!==id)){await connect();id=store();}"), 'a tap while disconnected connects first');
  assert.ok(controls.includes('(function autoConnect(tries){'));
}
// 2026-11-11: props in front come FROM the hall as you pass them, panels are
// see-through, and every studio script at least parses (a broken overlay once
// slipped through).
{
  const { execFileSync } = await import('node:child_process');
  for (const f of ['scripts/live-studio-overlay.mjs', 'scripts/shed-background.mjs', 'scripts/shed-crawl-fp.mjs', 'scripts/live-studio-controls.js', 'scripts/live-studio-room.mjs']) execFileSync(process.execPath, ['--check', new URL('../' + f, import.meta.url).pathname]);
  const fp = await import('../scripts/shed-crawl-fp.mjs');
  assert.ok(fp.propsFor(fp.layoutFor(1), 1).some(p => p.kind === 'pic' && Number.isInteger(p.idx)), 'the store\'s items stand in the hall');
  const L = fp.layoutFor(1), g = fp.buildMap(1).grid, e0 = fp.eyePose(L, g, 0.3); assert.equal(g[Math.floor(e0.y)][Math.floor(e0.x)], 0);
  const ov6 = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8');
  assert.ok(ov6.includes("const eye=fpLib.eyePose(fgCache.L,fgCache.grid,Math.min(0.99,fgShown+cam.scout))") && ov6.includes('if(fwd<0.15||fwd>reach||Math.abs(side)>1.05)continue;'), 'props in front are the hall\'s props, beside and just ahead');
  const src = readFileSync(new URL('../scripts/shed-crawl-fp.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes("const close = fwd >= 0.15 && fwd <= (s.kind === 'chest' ? 3 : 1.6) && Math.abs(side) <= 1.05; if (FG ? !close : close) return;"), 'the hall hides what is passing in front');
  assert.ok(src.includes('export function createShedCrawl(canvas, { w: VW = VIEW_W, h: VH = VIEW_H'), 'the window crawl has its default size');
  assert.equal(DEFAULT_STUDIO.panelAlpha, 70); assert.throws(() => validateSettings({ panelAlpha: 101 }), /Invalid panelAlpha/); assert.ok(validateSettings({ panelAlpha: 0 }));
  assert.match(readFileSync(new URL('../assets/live-studio.css', import.meta.url), 'utf8'), /rgb\(74 29 150\/var\(--pa,1\)\)/);
}
console.log('live-studio-dungeon: ok');

// 2026-11-11: the store's items show as what they are -- comics lean in the
// hall, sealed sits on a folding table, cards stand in top loaders.
{
  const { validateStage } = await import('../scripts/live-studio-model.mjs');
  const st = validateStage({ now: { title: 'Booster Box', image: 'https://x.test/a.jpg', kind: 'sealed' }, next: [{ title: 'X-Men 1', image: 'https://x.test/b.jpg', kind: 'comic' }, { title: 'Bad', kind: 'gun' }] });
  assert.equal(st.now.kind, 'sealed');
  assert.equal(st.next[0].kind, 'comic');
  assert.equal(st.next[1].kind, undefined, 'only comic / sealed / card');
  const fp = readFileSync(new URL('../scripts/shed-crawl-fp.mjs', import.meta.url), 'utf8');
  for (const k of ["how === 'comic'", "how === 'sealed'"]) assert.ok(fp.includes(k), k);
  const ov = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8');
  assert.ok(ov.includes('fp?.setPictures(list,kinds)') && ov.includes("how==='sealed'"));
  const ctl = readFileSync(new URL('../scripts/live-studio-controls.js', import.meta.url), 'utf8');
  assert.ok(ctl.includes("?'comic':") && ctl.includes("'sealed':'card'"));
}
{
  // Tables show a sealed box, comic stacks a real comic, item stands any item.
  const { itemFor } = await import('../scripts/shed-crawl-fp.mjs');
  const kinds = ['card', 'sealed', 'comic', 'sealed'];
  assert.deepEqual(itemFor({ kind: 'table', idx: 0 }, kinds), { i: 1, how: 'sealed' });
  assert.deepEqual(itemFor({ kind: 'table', idx: 1 }, kinds), { i: 3, how: 'sealed' });
  assert.deepEqual(itemFor({ kind: 'comics', idx: 5 }, kinds), { i: 2, how: 'comic' });
  assert.deepEqual(itemFor({ kind: 'pic', idx: 4 }, kinds), { i: 0, how: 'card' });
  assert.equal(itemFor({ kind: 'table', idx: 0 }, ['card']), null, 'no sealed: the plain table');
  assert.equal(itemFor({ kind: 'bucket', idx: 0 }, kinds), null);
  assert.equal(itemFor({ kind: 'pic', idx: 0 }, []), null);
}
{
  // Panel opacity shows the cameras through (the gold frame is a ring, not a fill),
  // and CRAWL WINDOW on means no second crawl behind it on the green screen.
  const css = readFileSync(new URL('../assets/live-studio.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.mana-panel::before {') && css.includes('rgb(18 4 39/var(--pa,1))) padding-box;'));
  const bg = readFileSync(new URL('../scripts/shed-background.mjs', import.meta.url), 'utf8');
  assert.ok(bg.includes("canvas.style.visibility = m.settings.crawlWindow === true ? 'hidden' : ''"));
}
{
  // 2026-11-12: "more variation, make the rooms better, other random cool shit".
  const fpm = await import('../scripts/shed-crawl-fp.mjs');
  const names = new Set(), props = new Set();
  for (let f = 1; f <= 7; f++) {
    const L = fpm.layoutFor(f), g = fpm.buildMap(f).grid;
    assert.ok(L.rooms.length >= 2, 'two or three rooms a floor: ' + f);
    assert.equal(new Set(L.rooms.map(r => r[4])).size, L.rooms.length, 'no theme twice on a floor');
    L.rooms.forEach(r => names.add(fpm.ROOM_THEMES[r[4]].name));
    for (const r of L.rooms) assert.ok(g.some(row => row.some(c => (c >= 1000 ? c % 100 : c) === fpm.ROOM_THEMES[r[4]].tex)), 'the room has its walls');
    fpm.propsFor(L, f).forEach(p => props.add(p.kind));
    assert.ok(g.flat().every(c => c === 0 || (c >= 1 && c <= 28) || (c >= 1000 && c % 100 >= 1 && c % 100 <= 28)), 'every wall has a texture');
  }
  assert.ok(names.size >= 6, 'room themes vary: ' + [...names]);
  for (const k of ['arcade', 'tv', 'gnome', 'skeleton', 'raccoon', 'crystal', 'lavalamp']) assert.ok(props.has(k), 'cool stuff: ' + k);
  for (const k of fpm.SPRITE_KINDS) assert.ok(k, k);
}
{
  // 2026-11-12: the first two chests are a FREE giveaway; chests show in front from farther down the hall.
  const { DUNGEON_DEFAULTS } = await import('../scripts/live-studio-dungeon.mjs');
  assert.equal(DUNGEON_DEFAULTS.giveawayChests, 2);
  const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8');
  assert.ok(room.includes("chestText: 'FREE GIVEAWAY!'") && room.includes('chestGiveaway: true'));
  const ov = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8');
  assert.ok(ov.includes("reach=p.kind==='chest'?3:1.6") && ov.includes('FREE TO ENTER IN THE WHATNOT APP'));
}
{
  // 2026-11-12: "the bosses are lame" -- each shed its own boss, and real fights.
  const { bossForFloor, SHEDS } = await import('../scripts/live-studio-dungeon.mjs');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(bossForFloor), ['mimic', 'golem', 'kraken', 'lich', 'raccoonking', 'lowballer', 'dragon']);
  assert.equal(SHEDS[6], 'THE SHED BENEATH THE SHED'); assert.equal(bossForFloor(8), 'hydra'); assert.equal(bossForFloor(9), 'scalper');
  const ov = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8');
  for (const k of ['function bossIntro(b,d)', 'function bossCombo()', 'function bossRage(b,d)', 'function bossMove(b,stage)', 'function bossKO()', "if(key!==rageKey){rageKey=key;rageSeen=stage;return;}", "setTimeout(()=>card.classList.remove('snatched'),3000)"]) assert.ok(ov.includes(k), k);
  assert.ok(!/Math\.random/.test(ov.slice(ov.indexOf('function bossIntro'), ov.indexOf('function paintForeground'))), 'no chance in the fights');
  const html = readFileSync(new URL('../arcade-overlay.html', import.meta.url), 'utf8');
  for (const id of ['mana-boss-intro', 'mana-vs-art', 'mana-boss-combo', 'mana-move', 'mana-ko']) assert.ok(html.includes('id="' + id + '"'), id);
}
{
  // 2026-11-12: "bigger dungeons ... sheds and dungeons, each thing walks farther ... more atmospheric, critters, particles, animated".
  const fpm = await import('../scripts/shed-crawl-fp.mjs');
  assert.equal(fpm.GRID, 40);
  for (let f = 1; f <= 7; f++) {
    const L = fpm.layoutFor(f), M = fpm.buildMap(f);
    assert.ok(L.len >= 55, 'a long walk: floor ' + f + ' ' + L.len);
    assert.ok(L.rooms.length >= 4, 'four to six rooms');
    assert.ok(L.rooms.some(r => fpm.ROOM_THEMES[r[4]].dungeon) && L.rooms.some(r => !fpm.ROOM_THEMES[r[4]].dungeon), 'shed rooms up top, dungeon chambers below');
    const start = fpm.poseAt(L, 0.05), end = fpm.poseAt(L, 0.95), z = (p) => M.zone[Math.floor(p.y) * fpm.GRID + Math.floor(p.x)];
    assert.equal(z(start), 0, 'it starts in the shed'); assert.equal(z(end), 1, 'it ends in the dungeon');
    assert.ok(M.lights.some(l => l.torch) && M.lights.some(l => !l.torch), 'bulbs up top, torches below');
    assert.ok(M.grid.flat().some(c => c === 19), 'torches on the dungeon walls');
    assert.ok(fpm.propsFor(L, f).some(p => p.kind === 'trapdoor'), 'the trapdoor down');
  }
  const src = readFileSync(new URL('../scripts/shed-crawl-fp.mjs', import.meta.url), 'utf8');
  for (const k of ["listeners.peek('DOWN THE TRAPDOOR INTO THE DUNGEON…')", 'dt * Math.max(1.6 / len, (target - shown) / 12)', "kind: (tm * (sniff ? 3 : 8) | 0) % 2 ? 'rat' : 'rat2'", "kind: (tm * 9 | 0) % 2 ? 'bat' : 'bat2'", "kind: 'spider'", "const AIR = {", 'Moths around the bulbs', "if (s.kind === 'eyes' && (tm / 5", 'const ANIM = {', "const glance = ph > 0.55", 'g < 128 && !cell'])
    assert.ok(src.includes(k), k);
  assert.ok(!/Math\.random/.test(src), 'nothing left to chance: the same on every screen');
  const ov = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8');
  assert.ok(ov.includes('fgShown+dt*Math.max(1.6/len,(fgTarget-fgShown)/12)'), 'the props in front walk at the same pace');
}
{
  // 2026-11-12: "can I move camera from the dashboard? Joystick?"
  const room = readFileSync(new URL('../scripts/live-studio-room.mjs', import.meta.url), 'utf8'), api = readFileSync(new URL('../scripts/live-studio-api.mjs', import.meta.url), 'utf8');
  assert.ok(room.includes("this.broadcast({ type: 'camera', cam, serverNow: now });") && api.includes("url.pathname==='/live-studio/camera'"), 'the remote sends, the screens hear');
  const fp = readFileSync(new URL('../scripts/shed-crawl-fp.mjs', import.meta.url), 'utf8');
  for (const k of ['setCamera(c = {})', 'const held = now - manual.at < 3000', 'Math.min(0.99, shown + scoutNow)', 'pitchNow * VH * 0.28']) assert.ok(fp.includes(k), k);
  assert.ok(!fp.match(/shown\s*=\s*[^;]*scoutNow/), 'scouting never moves how far along the floor you are');
  const ov = readFileSync(new URL('../scripts/live-studio-overlay.mjs', import.meta.url), 'utf8'), bg = readFileSync(new URL('../scripts/shed-background.mjs', import.meta.url), 'utf8'), ctl = readFileSync(new URL('../scripts/live-studio-controls.js', import.meta.url), 'utf8');
  assert.ok(ov.includes("if(m.type==='camera'){fp?.setCamera?.(m.cam);front?.setCamera?.(m.cam);return;}") && ov.includes("ev.data?.type==='mana-camera'"));
  assert.ok(bg.includes("if (m.type === 'camera') { fp?.setCamera?.(m.cam); return; }") && bg.includes("ev.data?.type === 'mana-camera'"));
  assert.ok(ctl.includes('id="mana-joy"') && ctl.includes("camSend({action:'scout'})") && ctl.includes("camSend({action:'back'})") && ctl.includes("api('camera',cam)"));
}
{
  // 2026-11-12: "the chests need to be better looking, I don't really notice them".
  const fp = readFileSync(new URL('../scripts/shed-crawl-fp.mjs', import.meta.url), 'utf8');
  for (const k of ["chest: { a: [44, 24, 10]", "SPRITE_GLOW = { chest: 'ygw'", 'chest: 0.85', 'A loot beam', 'Sparkles circling each shut chest', "pr.kind === 'chest' && (pr.x - pose.x)"]) assert.ok(fp.includes(k), k);
  const { drawSprite } = await import('../scripts/shed-crawl-fp.mjs');
  assert.equal(typeof drawSprite, 'function');
}
