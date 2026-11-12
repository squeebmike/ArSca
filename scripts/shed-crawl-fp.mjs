// THE SHED CRAWL, first person (store, 2026-11-11: "go through the dungeon
// crawl like doom visuals ... walking through halls, rooms ... parts of the
// shed, looking for and through shit"; "all this has to be shitty shed
// themed. Comic, card, collectibles... even like local card shop"). A small raycaster, the classic
// early-90s way: a grid of walls, one ray per screen column, chunky pixels
// blown up 4x. A falling-apart shed someone turned into a card and comic
// shop: duct-taped board walls, comic racks, slab walls, binder pages,
// booster packs on pegboard, flyer corkboards, shelves of long boxes; dollar
// bins, comic stacks, card boxes, pizza boxes, leak buckets, a folding table
// with a playmat, boxed figures, raccoon eyes in the dark. All original,
// drawn in code -- no real covers, logos or products.
//
// Nothing is random. Each floor has a fixed layout (three, in turn) and a
// fixed route; how far along the route you are is the floor's mana. Sales
// walk you forward. At two fixed spots the view turns to rummage through a
// shelf ("SEARCHING THE LONG BOXES..."). The boss waits in the last room.
export const VIEW_W = 240, VIEW_H = 96;

// ── Layouts: routes through a GRID x GRID map. Walls are carved around them. ──
// Store, 2026-11-12: "bigger dungeons ... more area to cover ... sheds and
// dungeons, each thing walks farther": 40 x 40, a walk about three times as
// long; the first half is the shed, then a trapdoor down into the dungeon under it.
export const GRID = 40;
// Each: the route (cell centers), the side rooms to peek into while
// searching (a cell beside the route), and the boss room's corner.
const LAYOUTS = [
  { route: [[2, 13], [2, 3], [8, 3], [8, 9], [13, 9], [13, 3]], boss: [12, 1, 3, 2], peeks: [{ at: 0.28, cell: [1, 8], tex: 3, label: 'DIGGING THROUGH THE LONG BOXES…' }, { at: 0.62, cell: [10, 10], tex: 8, label: 'FLIPPING THE BINDER PAGES…' }] },
  { route: [[13, 13], [3, 13], [3, 8], [12, 8], [12, 3], [4, 3]], boss: [1, 2, 3, 3], peeks: [{ at: 0.24, cell: [8, 14], tex: 6, label: 'CHECKING THE SLAB WALL…' }, { at: 0.58, cell: [7, 9], tex: 2, label: 'PICKING A PACK OFF THE PEGBOARD…' }] },
  { route: [[2, 2], [2, 12], [7, 12], [7, 6], [13, 6], [13, 12]], boss: [12, 13, 3, 2], peeks: [{ at: 0.3, cell: [1, 7], tex: 4, label: 'SEARCHING THE BACK ISSUE RACK…' }, { at: 0.66, cell: [10, 5], tex: 7, label: 'READING THE FLYERS ON THE CORKBOARD…' }] },
];
// Each shed's palette: boards, gaps, floor, ceiling, fog.
const PALETTES = {
  'GARDEN SHED': { a: [122, 74, 38], b: [104, 62, 31], gap: [40, 22, 10], floor: [70, 52, 36], ceil: [28, 20, 16], fog: [10, 8, 6] },
  'RUSTY TOOL SHED': { a: [120, 70, 50], b: [96, 56, 40], gap: [36, 20, 14], floor: [64, 54, 48], ceil: [26, 22, 20], fog: [10, 8, 8] },
  'FLOODED SHED': { a: [80, 86, 70], b: [64, 70, 58], gap: [20, 28, 26], floor: [30, 56, 66], ceil: [18, 24, 26], fog: [6, 12, 14] },
  'HAUNTED POTTING SHED': { a: [86, 72, 96], b: [70, 58, 80], gap: [24, 16, 30], floor: [50, 42, 58], ceil: [20, 14, 26], fog: [8, 4, 12] },
  'RACCOON-INFESTED SHED': { a: [110, 90, 60], b: [92, 74, 48], gap: [34, 26, 14], floor: [72, 62, 44], ceil: [26, 22, 14], fog: [10, 8, 4] },
  'BURNT-OUT SHED': { a: [60, 44, 36], b: [44, 32, 26], gap: [14, 8, 6], floor: [40, 32, 28], ceil: [16, 10, 8], fog: [16, 6, 2] },
  'THE SHED BENEATH THE SHED': { a: [70, 40, 90], b: [54, 30, 70], gap: [16, 6, 24], floor: [34, 22, 44], ceil: [12, 6, 18], fog: [10, 2, 16] },
};
// Store, 2026-11-11: "the sheds need to vary". Every floor gets its own
// layout, made from the floor number (a fixed seed -- the same floor is
// always the same shed, nothing random on stream): a winding hall with wide
// stretches and side rooms, two rummaging spots and the boss room at the end.
// The three hand-made layouts are the fallback.
const PEEK_POOL = [
  { tex: 3, label: 'DIGGING THROUGH THE LONG BOXES…' }, { tex: 8, label: 'FLIPPING THE BINDER PAGES…' }, { tex: 6, label: 'CHECKING THE SLAB WALL…' },
  { tex: 2, label: 'PICKING A PACK OFF THE PEGBOARD…' }, { tex: 4, label: 'SEARCHING THE BACK ISSUE RACK…' }, { tex: 7, label: 'READING THE FLYERS ON THE CORKBOARD…' },
];
const DUNGEON_PEEKS = [
  { tex: 18, label: 'PRYING OPEN A CRYPT…' }, { tex: 20, label: 'DIGGING THROUGH THE ROTTEN LONG BOXES…' }, { tex: 21, label: 'PULLING ON A RUSTY CHAIN…' },
];
// How far along the walk the shed ends and the dungeon begins.
export const DUNGEON_AT = 0.5;
// Where the floor's two locked long boxes sit along the walk (live-studio-dungeon.mjs LOCKBOX_AT).
export const LOCKBOX_AT = [0.62, 0.9];
// TIME OF DAY (2026-11-12): the show starts in the morning and goes on into
// the night -- by how long it's been since the show's first sale.
export function dayPhase(startedAt, now = Date.now()) { if (!startedAt) return 'morning'; const h = (now - startedAt) / 3.6e6; return h < 0.4 ? 'morning' : h < 1 ? 'day' : h < 1.5 ? 'sunset' : 'night'; }
// The weather outside the shed's windows: by the time of year and the floor
// (a fixed pick, the same on every screen -- nothing drawn by chance).
export function weatherFor(floor, now = Date.now()) {
  const m = new Date(now).getMonth(), f = Math.max(1, floor | 0);
  const pool = m === 11 || m <= 1 ? ['snow', 'clear', 'snow', 'storm'] : m <= 4 ? ['rain', 'clear', 'storm', 'clear'] : m <= 7 ? ['clear', 'storm', 'clear', 'rain'] : ['leaves', 'rain', 'clear', 'leaves'];
  return pool[f % pool.length];
}
// The sky through a window, top to bottom, for the time of day.
const SKY = { morning: [[255, 196, 150], [150, 196, 240]], day: [[110, 170, 245], [190, 225, 255]], sunset: [[90, 40, 110], [255, 130, 60]], night: [[8, 10, 30], [24, 30, 64]] };
const seeded = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export function generateLayout(floor) {
  const N = GRID, lo = 2, hi = N - 3;
  for (let attempt = 0; attempt < 200; attempt++) {
    const rnd = seeded(floor * 7919 + 101 + attempt * 31), used = new Set(), key = (x, y) => x + ',' + y;
    const corners = [[lo, hi], [hi, hi], [lo, lo], [hi, lo]];
    let [x, y] = corners[(floor - 1) % 4]; const route = [[x, y]]; used.add(key(x, y));
    let horiz = rnd() < 0.5, ok = true;
    const segs = 11 + Math.floor(rnd() * 5);
    for (let i = 0; i < segs && ok; i++) {
      let placed = false;
      for (const sign of rnd() < 0.5 ? [1, -1] : [-1, 1]) {
        const len = 4 + Math.floor(rnd() * 7), nx = horiz ? x + sign * len : x, ny = horiz ? y : y + sign * len;
        if (nx < lo || nx > hi || ny < lo || ny > hi) continue;
        const cells = []; let clear = true;
        for (let k = 1; k <= len; k++) { const cx = horiz ? x + sign * k : x, cy = horiz ? y : y + sign * k; if (used.has(key(cx, cy)) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => used.has(key(cx + dx, cy + dy)) && !(cx + dx === x && cy + dy === y) && k === 1 ? false : used.has(key(cx + dx, cy + dy)) && k > 1)) { clear = false; break; } cells.push([cx, cy]); }
        if (!clear) continue;
        cells.forEach(([cx, cy]) => used.add(key(cx, cy))); x = nx; y = ny; route.push([x, y]); placed = true; break;
      }
      if (!placed) ok = i >= 9;
      if (!placed) break;
      horiz = !horiz;
    }
    if (!ok || route.length < 10) continue;
    // The boss room: 3 x 2 past the end of the hall, inside the walls.
    const [ex, ey] = route[route.length - 1], [px, py] = route[route.length - 2];
    const dx = Math.sign(ex - px), dy = Math.sign(ey - py);
    let boss = dx ? [Math.max(1, Math.min(N - 4, dx > 0 ? ex + 1 : ex - 3)), Math.max(1, Math.min(N - 3, ey - 1)), 3, 2] : [Math.max(1, Math.min(N - 4, ex - 1)), Math.max(1, Math.min(N - 3, dy > 0 ? ey + 1 : ey - 2)), 3, 2];
    if (boss[0] < 1 || boss[1] < 1 || boss[0] + boss[2] > N - 1 || boss[1] + boss[3] > N - 1) continue;
    // THE BOSS ARENA (2026-11-12: "boss arenas"): a big 5 x 5 hall past the
    // end of the walk, when it fits without touching the hall.
    // 5 x 5 if it fits (centred first, then slid to the side), else 4 x 4.
    // Or pulled back over the end of the last stretch (you walk into it).
    let big = false, bossAt = null; const lastSeg = new Set(); for (let k = 0; k <= Math.abs(ex - px) + Math.abs(ey - py); k++) lastSeg.add(key(ex - dx * k, ey - dy * k));
    for (const sz of [5, 4]) for (const back of [0, 1, 2, 3]) for (const sh of [-(sz >> 1), -1, -(sz - 2), 0, -(sz - 1)]) {
      if (big) break;
      const A = dx ? [dx > 0 ? ex + 1 - back : ex - sz + back, ey + sh, sz, sz] : [ex + sh, dy > 0 ? ey + 1 - back : ey - sz + back, sz, sz];
      let fits = A[0] >= 2 && A[1] >= 2 && A[0] + sz <= N - 2 && A[1] + sz <= N - 2;
      for (let y = A[1] - 1; fits && y <= A[1] + sz; y++) for (let x = A[0] - 1; x <= A[0] + sz; x++) if (used.has(key(x, y)) && !lastSeg.has(key(x, y))) { fits = false; break; }
      if (fits) { big = true; boss = A; }
      if (fits) bossAt = [A[0] + sz / 2 + dx * (sz / 2 - 1.1), A[1] + sz / 2 + dy * (sz / 2 - 1.1)];
    }
    const L = { route, boss, arena: big, bossAt, peeks: [], rooms: [], split: DUNGEON_AT };
    // Two rummaging spots: a cell beside the hall, about a third and two thirds in.
    const picks = [PEEK_POOL[floor % 6], PEEK_POOL[(floor + 3) % 6]];
    for (const [j, at] of [[0, 0.3], [1, 0.64]]) {
      const pose = poseAt(L, at), cx = Math.floor(pose.x), cy = Math.floor(pose.y), side = j ? -1 : 1;
      const sx = Math.round(-Math.sin(pose.ang)) * side, sy = Math.round(Math.cos(pose.ang)) * side;
      const cell = [cx + sx, cy + sy];
      if (cell[0] < 1 || cell[1] < 1 || cell[0] > N - 2 || cell[1] > N - 2 || used.has(key(...cell))) continue;
      L.peeks.push({ at, cell, ...(at > DUNGEON_AT ? DUNGEON_PEEKS[floor % DUNGEON_PEEKS.length] : picks[j]) });
    }
    if (L.peeks.length < 2) continue;
    // Rooms (store, 2026-11-12: "more variation, make the rooms better, other
    // random cool shit in there"): two or three, 3 to 4 cells a side, each with
    // a theme -- the arcade corner, the TV room, the poster room, the stock
    // room, the neon room, the garage, the lounge.
    // Bigger floors, more rooms: four to six -- the shed's in the first half,
    // the dungeon's chambers (crypts, catacombs, a torch hall, a spider nest) in the second.
    const nRooms = 4 + (rnd() < 0.5 ? 1 : 0) + (rnd() < 0.5 ? 1 : 0), usedCorners = new Set(); let shedN = 0, dunN = 0;
    for (let j = 0; j < nRooms * 3 && L.rooms.length < nRooms; j++) {
      const ci = 1 + Math.floor(rnd() * (route.length - 2)); if (usedCorners.has(ci)) continue;
      const r = route[ci], w = 3 + (rnd() < 0.5 ? 1 : 0), h = 3 + (rnd() < 0.5 ? 1 : 0);
      const x0 = Math.max(1, Math.min(N - 1 - w, r[0] - 1 - (w > 3 && rnd() < 0.5 ? 1 : 0)));
      const y0 = Math.max(1, Math.min(N - 1 - h, r[1] - 1 - (h > 3 && rnd() < 0.5 ? 1 : 0)));
      const [bx0, by0, bw0, bh0] = boss;
      if (x0 < bx0 + bw0 + 1 && x0 + w > bx0 - 1 && y0 < by0 + bh0 + 1 && y0 + h > by0 - 1) continue;
      usedCorners.add(ci);
      const below = routeFrac(route, ci) > DUNGEON_AT;
      L.rooms.push([x0, y0, w, h, below ? SHED_THEMES + (floor + dunN++) % (ROOM_THEMES.length - SHED_THEMES) : (floor * 3 + shedN++ * 2) % SHED_THEMES]); // never the same theme twice on a floor
    }
    // Alcoves: a nook off the hall with a vending machine or a shelf of sealed.
    L.nooks = [];
    for (const [at, side, tex0] of [[0.14, -1, 10], [0.33, 1, 13], [0.62, 1, 18], [0.86, -1, 20]]) {
      const tex = at > DUNGEON_AT ? (tex0 === 10 ? 18 : tex0 === 13 ? 20 : tex0) : tex0;
      const pose = poseAt(L, at), cx = Math.floor(pose.x), cy = Math.floor(pose.y);
      const cell = [cx + Math.round(-Math.sin(pose.ang)) * side, cy + Math.round(Math.cos(pose.ang)) * side];
      if (cell[0] < 1 || cell[1] < 1 || cell[0] > N - 2 || cell[1] > N - 2 || used.has(key(...cell)) || L.peeks.some(pk => pk.cell[0] === cell[0] && pk.cell[1] === cell[1])) continue;
      L.nooks.push({ cell, tex });
    }
    L.len = routeLength(L);
    return L;
  }
  const F = LAYOUTS[(Math.max(1, floor) - 1) % LAYOUTS.length];
  return { ...F, split: DUNGEON_AT, len: routeLength(F) };
}
// The walk's length in cells, and how far along it a corner sits (0..1).
export function routeLength(L) { let n = 0; for (let i = 1; i < L.route.length; i++) n += Math.hypot(L.route[i][0] - L.route[i - 1][0], L.route[i][1] - L.route[i - 1][1]); return n || 1; }
function routeFrac(route, ci) { let a = 0, all = 0; for (let i = 1; i < route.length; i++) { const d = Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]); all += d; if (i <= ci) a += d; } return all ? a / all : 0; }
const layoutCache = new Map();
// The rooms' themes: the wall all around it (a texture) and what's in it.
export const ROOM_THEMES = [
  { name: 'ARCADE CORNER', tex: 9, props: ['arcade', 'arcade', 'gumball'] },
  { name: 'TV ROOM', tex: 11, props: ['tv', 'tv', 'lavalamp'] },
  { name: 'POSTER ROOM', tex: 12, props: ['lavalamp', 'cat', 'table'] },
  { name: 'STOCK ROOM', tex: 13, props: ['table', 'cardbox', 'table'] },
  { name: 'NEON ROOM', tex: 14, props: ['gumball', 'lavalamp', 'arcade'] },
  { name: 'THE GARAGE', tex: 15, props: ['mower', 'cone', 'fridge'] },
  { name: 'THE LOUNGE', tex: 16, props: ['fridge', 'tv', 'pizza'] },
  // Down in the dungeon under the shed.
  { name: 'THE CRYPT', tex: 18, props: ['bones', 'coffin', 'candles'], dungeon: true },
  { name: 'THE TORCH HALL', tex: 19, props: ['brazier', 'skeleton', 'brazier'], dungeon: true },
  { name: 'THE LONG BOX CATACOMB', tex: 20, props: ['longboxstack', 'coffin', 'longboxopen'], dungeon: true },
  { name: 'THE SPIDER NEST', tex: 21, props: ['bones', 'crystal', 'candles'], dungeon: true },
  { name: 'THE FORGOTTEN STOCK', tex: 22, props: ['crate', 'longboxstack', 'shortbox'], dungeon: true },
];
const SHED_THEMES = 7;
// Each shed's floor and ceiling (2026-11-11: "PS1 graphics"): textured and
// lit, not a flat fade. f: planks / concrete / wet / carpet / dirt / scorched /
// stone; c: rafters / tin / tarp / drop tiles.
const SURFACES = {
  'GARDEN SHED': { f: 'planks', c: 'rafters' }, 'RUSTY TOOL SHED': { f: 'concrete', c: 'tin' }, 'FLOODED SHED': { f: 'wet', c: 'tarp' },
  'HAUNTED POTTING SHED': { f: 'dirt', c: 'rafters' }, 'RACCOON-INFESTED SHED': { f: 'carpet', c: 'drop' }, 'BURNT-OUT SHED': { f: 'scorched', c: 'tin' },
  'THE SHED BENEATH THE SHED': { f: 'stone', c: 'drop' },
};
function surfaceTex(kind) {
  const n = (x, y, k) => ((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0;
  const noise = (x, y, k, a) => ((n(x, y, k) % 1000) / 1000 - 0.5) * a;
  return tex(px => {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      let c;
      if (kind === 'planks') { const b = (y >> 3) % 2; c = b ? [96, 64, 40] : [110, 74, 46]; if ((y & 7) === 7) c = [40, 26, 14]; if ((x + (y >> 3) * 11) % 32 === 0) c = [50, 32, 18]; }
      else if (kind === 'concrete') { c = [104, 104, 100]; if ((x === 15 || y === 15)) c = [70, 70, 68]; }
      else if (kind === 'wet') { c = [70, 84, 86]; const d = Math.hypot(x - 20, y - 12); if (d < 7) c = [60, 110, 140]; if (d < 5) c = [90, 150, 180]; }
      else if (kind === 'carpet') { c = ((x >> 2) + (y >> 2)) % 2 ? [120, 34, 40] : [100, 26, 34]; if (Math.hypot(x - 9, y - 22) < 4) c = [70, 50, 30]; }
      else if (kind === 'dirt') c = [78, 60, 40];
      else if (kind === 'scorched') { c = [52, 40, 34]; if ((x * y) % 13 === 0) c = [22, 16, 14]; }
      else if (kind === 'stone') { const bx = (x + ((y >> 3) % 2) * 8) & 15, by = y & 7; c = bx === 0 || by === 0 ? [30, 24, 40] : [70, 62, 84]; }
      else if (kind === 'cobble') { const cx = (x + ((y >> 3) % 2) * 4) % 8, cy = y % 8, e = Math.hypot(cx - 3.5, cy - 3.5); c = e > 3.6 ? [26, 24, 30] : [74 - e * 6, 70 - e * 6, 78 - e * 5]; if ((x * 7 + y * 3) % 23 === 0) c = [52, 74, 40]; }
      else if (kind === 'vault') { c = [36, 32, 40]; if ((y & 15) === 0 || (x & 15) === 0) c = [18, 16, 22]; if (((x + y) & 15) === 3) c = [44, 40, 50]; }
      else if (kind === 'rafters') { c = [34, 26, 20]; if ((x & 15) < 4) c = [92, 62, 38]; if ((x & 15) === 3) c = [50, 32, 20]; }
      else if (kind === 'tin') { c = (x >> 1) % 2 ? [92, 96, 104] : [70, 74, 80]; if ((x * 3 + y) % 29 === 0) c = [130, 74, 40]; }
      else if (kind === 'tarp') { c = [40, 70, 130]; if ((x + y) % 11 === 0) c = [30, 54, 104]; }
      else { c = [170, 166, 150]; if ((x & 15) === 0 || (y & 15) === 0) c = [96, 94, 86]; if (Math.hypot(x - 22, y - 9) < 3) c = [140, 120, 70]; }
      const k = noise(x, y, kind.length, 18);
      px(x, y, [c[0] + k, c[1] + k, c[2] + k]);
    }
  });
}
// PS1-style color: a 4 x 4 ordered dither, then 5 bits per channel.

export const layoutFor = floor => { const f = Math.max(1, Math.floor(floor) || 1); if (!layoutCache.has(f)) layoutCache.set(f, generateLayout(f)); return layoutCache.get(f); };

// The grid: everything wall (1..5 = texture) except the route, the peek
// cells and the boss room. Wall textures follow a fixed pattern.
export function buildMap(floor, fork = '') {
  const L = layoutFor(floor), N = GRID, grid = Array.from({ length: N }, () => Array(N).fill(1)), zone = new Uint8Array(N * N), split = L.split ?? DUNGEON_AT;
  const open = (x, y) => { if (x > 0 && y > 0 && x < N - 1 && y < N - 1) grid[y][x] = 0; };
  // Each open cell is the shed (0) or the dungeon under it (1), by how far along the walk it is.
  const total = L.len || routeLength(L), mark = (x, y, z) => { if (x > 0 && y > 0 && x < N - 1 && y < N - 1) zone[y * N + x] = z; };
  let acc = 0;
  for (let i = 1; i < L.route.length; i++) {
    const [x0, y0] = L.route[i - 1], [x1, y1] = L.route[i];
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) { open(x, y); mark(x, y, (acc + Math.hypot(x - x0, y - y0)) / total > split ? 1 : 0); }
    acc += Math.hypot(x1 - x0, y1 - y0);
  }
  const [bx, by, bw, bh] = L.boss;
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) { open(x, y); mark(x, y, 1); }
  for (const p of L.peeks) { open(...p.cell); mark(...p.cell, p.at > split ? 1 : 0); }
  for (const [rx, ry, rw, rh, th] of L.rooms || []) for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) { open(x, y); mark(x, y, ROOM_THEMES[th ?? 0]?.dungeon ? 1 : 0); }
  for (const nk of L.nooks || []) { open(...nk.cell); mark(...nk.cell, nk.tex >= 17 ? 1 : 0); }
  // A wall is the dungeon's when every open cell beside it is.
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if (grid[y][x]) { const side = N4.filter(([dx, dy]) => grid[y + dy][x + dx] === 0); if (side.length && side.every(([dx, dy]) => zone[(y + dy) * N + x + dx])) zone[y * N + x] = 1; }
  // Textures on a fixed pattern: duct-taped boards (1), booster pegboard (2),
  // long-box shelves (3), the comic rack (4), the slab wall (6), the flyer
  // corkboard (7), binder pages (8); each peek looks at its own; the boss room is 5.
  // Chat's pick at the fork changes the shed: LEFT is the collector side
  // (slabs, binders, racks), RIGHT the bargain side (long boxes, bins, packs).
  const PATTERN = fork === 'left' ? [6, 8, 4, 6, 1, 8, 4, 6, 1, 8, 6, 4] : fork === 'right' ? [3, 1, 2, 3, 7, 1, 3, 2, 1, 3, 7, 2] : [1, 4, 2, 1, 3, 6, 1, 7, 8, 1, 4, 3];
  // Each shed mixes its own extras into the walls (posters, garage doors, TVs, neon...).
  const EXTRA = [[12, 15], [15, 13], [12, 11], [12, 14], [16, 15], [15, 12], [14, 9]][(Math.max(1, floor) - 1) % 7];
  const pat = PATTERN.slice(); pat[floor % 12] = EXTRA[0]; pat[(floor + 6) % 12] = EXTRA[1];
  // The dungeon's walls: stone, crypt niches, rotten long boxes, cobwebs and chains.
  const DPAT = [17, 17, 21, 17, 20, 22, 17, 21, 17, 18, 20, 17];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (grid[y][x]) grid[y][x] = zone[y * N + x] ? DPAT[(x * 3 + y * 5 + floor) % 12] : pat[(x * 3 + y * 5 + floor) % 12];
  // A themed room's walls all around it.
  for (const [rx, ry, rw, rh, th] of L.rooms || []) { const tx = ROOM_THEMES[th ?? 0]?.tex; if (tx) for (let y = ry - 1; y <= ry + rh; y++) for (let x = rx - 1; x <= rx + rw; x++) if (grid[y]?.[x]) grid[y][x] = tx; }
  for (const nk of L.nooks || []) { const [cx, cy] = nk.cell; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (grid[cy + dy]?.[cx + dx]) grid[cy + dy][cx + dx] = nk.tex; }
  for (const p of L.peeks) { const [cx, cy] = p.cell; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (grid[cy + dy]?.[cx + dx]) grid[cy + dy][cx + dx] = p.tex; }
  // The arena's walls: rune stone, a torch on every other one.
  for (let y = by - 1; y <= by + bh; y++) for (let x = bx - 1; x <= bx + bw; x++) if (grid[y]?.[x]) grid[y][x] = L.arena ? ((x + y) % 2 ? 23 : 19) : 5;
  // Walls that face the walk and are racks or slab walls become frames for
  // the store's own item photos (1000 + n*100 + the wall's own texture, which
  // shows when there are no photos).
  let n = 0;
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if ((grid[y][x] === 4 || grid[y][x] === 6 || (grid[y][x] === 12 && (x + y) % 2 === 0) || (grid[y][x] === 1 && (x * 7 + y * 3 + floor) % 3 === 0)) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy][x + dx] === 0)) grid[y][x] = 1000 + (n++) * 100 + grid[y][x];
  // WINDOWS (2026-11-12: "weather in the shed has to make sense, we're
  // inside -- through open windows"): now and then a plain shed wall is an
  // open window; the sky and the weather show through it, and daylight comes in.
  const wins = [];
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const c = grid[y][x]; if (zone[y * N + x] || !(c === 1 || c === 3 || c === 7) || (x * 5 + y * 7 + floor) % 7) continue;
    const o = N4.find(([dx, dy]) => grid[y + dy][x + dx] === 0 && !zone[(y + dy) * N + x + dx]); if (!o) continue;
    grid[y][x] = 24; wins.push({ x: x + 0.5 + o[0] * 0.8, y: y + 0.5 + o[1] * 0.8, win: true, nx: o[0], ny: o[1] });
  }
  // Lights along the walk: bare bulbs in the shed, torches on the dungeon's walls.
  const lights = [...wins];
  for (let k = 0, step = 5 / total; k * step < 0.985; k++) {
    const t = 0.04 + k * step, p = poseAt(L, t), below = t > split;
    if (!below) { lights.push({ x: p.x, y: p.y, torch: false }); continue; }
    const side = k % 2 ? 1 : -1, wx = Math.floor(p.x + Math.round(-Math.sin(p.ang)) * side), wy = Math.floor(p.y + Math.round(Math.cos(p.ang)) * side);
    if (grid[wy]?.[wx] && grid[wy][wx] < 1000 && grid[wy][wx] !== 5) grid[wy][wx] = 19; // the torch hangs on the wall beside the walk
    lights.push({ x: p.x + (wx + 0.5 - p.x) * 0.55, y: p.y + (wy + 0.5 - p.y) * 0.55, torch: true });
  }
  for (const [rx, ry, rw, rh] of L.rooms || []) lights.push({ x: rx + rw / 2, y: ry + rh / 2, torch: !!zone[Math.floor(ry + rh / 2) * N + Math.floor(rx + rw / 2)] });
  // The arena: a torch in each corner.
  if (L.arena) for (const [cx, cy] of [[bx + 0.6, by + 0.6], [bx + bw - 0.6, by + 0.6], [bx + 0.6, by + bh - 0.6], [bx + bw - 0.6, by + bh - 0.6]]) lights.push({ x: cx, y: cy, torch: true, arena: true });
  return { grid, layout: L, zone, lights };
}

// Where you stand at a point along the route (0..1): position and facing.
// The last stretch ends at the boss room; turns ease in near corners.
export function poseAt(layout, t) {
  const pts = layout.route.map(([x, y]) => [x + 0.5, y + 0.5]);
  const segs = []; let total = 0;
  for (let i = 1; i < pts.length; i++) { const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(len); total += len; }
  let d = Math.max(0, Math.min(1, t)) * total * 0.94;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const f = Math.min(1, d / segs[i]), [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      let ang = Math.atan2(by - ay, bx - ax);
      // Start turning toward the next stretch in the last 0.8 of a cell.
      // Turns ease across the corner (half before, half after), so the view
      // never snaps and never stares into the corner wall.
      const wrap = v => { while (v > Math.PI) v -= 2 * Math.PI; while (v < -Math.PI) v += 2 * Math.PI; return v; };
      if (i + 1 < segs.length && segs[i] - d < 0.8) { const next = Math.atan2(pts[i + 2][1] - by, pts[i + 2][0] - bx); ang += wrap(next - ang) * (1 - (segs[i] - d) / 0.8) * 0.5; }
      else if (i > 0 && d < 0.8) { const prev = Math.atan2(ay - pts[i - 1][1], ax - pts[i - 1][0]); ang += wrap(prev - ang) * (1 - d / 0.8) * 0.5; }
      return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, ang };
    }
    d -= segs[i];
  }
  return { x: pts[0][0], y: pts[0][1], ang: 0 };
}

// ── Textures (32 x 32), drawn once ──
const T = 32;
function tex(draw) { const c = new Uint8ClampedArray(T * T * 3); const px = (x, y, [r, g, b]) => { if (x < 0 || y < 0 || x >= T || y >= T) return; const i = (y * T + x) * 3; c[i] = r; c[i + 1] = g; c[i + 2] = b; }; draw(px); return c; }
const fill = (px, x0, y0, w, h, col) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(x, y, col); };
// A tiny 3x5 font for price stickers and flyers.
const FONT = { '$': '011110010011110', '1': '010110010010111', '0': '111101101101111', 'F': '111100110100100', 'N': '101111111111101', 'M': '101111111101101', 'B': '110101111101110', 'U': '101101101101111', 'Y': '101101010010010', '2': '111001111100111', '5': '111100111001111', 'S': '111100111001111', 'A': '010101111101101', 'L': '100100100100111', 'E': '111100110100111', 'C': '111100100100111', 'G': '111100101101111', 'D': '110101101101110', 'R': '110101110101101', 'T': '111010010010010', 'P': '110101110100100', 'O': '111101101101111' };
function text(px, x, y, str, col) { [...str].forEach((ch, k) => { const g = FONT[ch]; if (!g) return; for (let i = 0; i < 15; i++) if (g[i] === '1') px(x + k * 4 + (i % 3), y + Math.floor(i / 3), col); }); }
// Stone brick for the dungeon (no chance: the speckle is a fixed hash).
function stone(px) { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const bx = (x + ((y >> 3) % 2) * 8) & 15, by = y & 7, h = ((x * 73856093) ^ (y * 19349663)) >>> 0, k = (h % 17) - 8; px(x, y, bx === 0 || by === 0 ? [24, 22, 28] : [72 + k, 70 + k, 80 + k]); if (h % 61 === 0) px(x, y, [54, 80, 44]); } }
function makeTextures(p) {
  const boards = px => { for (let x = 0; x < T; x++) for (let y = 0; y < T; y++) px(x, y, (x >> 3) % 2 ? p.a : p.b); for (let x = 7; x < T; x += 8) fill(px, x, 0, 1, T, p.gap); fill(px, 3, 6, 1, 1, [30, 30, 30]); fill(px, 19, 24, 1, 1, [30, 30, 30]); fill(px, 12, 15, 2, 2, p.gap); };
  // A made-up comic cover: a color, a title band, a hero blob.
  const cover = (px, x, y, c, i) => { fill(px, x, y, 7, 10, c); fill(px, x, y, 7, 2, [240, 230, 200]); fill(px, x + 1, y, 5, 1, [200, 30, 30]); fill(px, x + 2, y + 3 + (i % 2), 3, 4, [250 - i * 20, 220, 120 + i * 20]); fill(px, x + 3, y + 3, 1, 1, [20, 20, 20]); };
  const COV = [[200, 40, 40], [40, 90, 190], [230, 170, 30], [60, 150, 70], [130, 50, 160], [20, 20, 20]];
  return {
    // Board walls, a strip of duct tape and a taped-up "NO REFUNDS" style sign (blank).
    1: tex(px => { boards(px); fill(px, 0, 4, T, 3, [150, 150, 158]); fill(px, 0, 4, T, 1, [180, 180, 188]); fill(px, 18, 14, 10, 8, [235, 230, 214]); fill(px, 19, 16, 8, 1, [40, 40, 40]); fill(px, 19, 18, 6, 1, [40, 40, 40]); fill(px, 17, 13, 3, 2, [150, 150, 158]); fill(px, 26, 13, 3, 2, [150, 150, 158]); }),
    // Pegboard of booster packs (made-up foil packs) and a blister card.
    2: tex(px => { fill(px, 0, 0, T, T, [150, 120, 84]); for (let y = 2; y < T; y += 4) for (let x = 2; x < T; x += 4) px(x, y, [70, 52, 34]); const FOIL = [[220, 40, 60], [40, 170, 220], [240, 190, 40], [150, 60, 210], [50, 190, 90], [230, 110, 30]]; for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { const x = 1 + c * 8, y = 2 + r * 15, f = FOIL[(r * 4 + c) % 6]; fill(px, x + 2, y, 2, 1, [60, 60, 60]); fill(px, x, y + 1, 6, 11, f); fill(px, x, y + 1, 6, 1, [255, 255, 255]); fill(px, x + 1, y + 4, 4, 4, [255, 255, 255].map((v, i) => (v + f[i]) >> 1)); fill(px, x, y + 11, 6, 1, [255, 255, 255]); } }),
    // Shelves of comic long boxes, hand-written labels.
    3: tex(px => { boards(px); for (const sy of [9, 21]) { fill(px, 0, sy, T, 2, [60, 36, 18]); for (let x = 1; x < T - 6; x += 10) { fill(px, x, sy - 7, 8, 7, [214, 206, 186]); fill(px, x, sy - 7, 8, 1, [170, 160, 140]); fill(px, x + 1, sy - 4, 6, 1, [40, 40, 40]); fill(px, x + 2, sy - 2, 3, 1, [200, 40, 40]); } } fill(px, 0, 29, T, 2, [60, 36, 18]); fill(px, 4, 23, 6, 6, [214, 206, 186]); fill(px, 14, 24, 5, 5, [214, 206, 186]); fill(px, 22, 25, 8, 4, [200, 160, 60]); }),
    // The back-issue rack: rows of made-up covers on a wire rack.
    4: tex(px => { fill(px, 0, 0, T, T, [50, 44, 40]); let i = 0; for (let y = 1; y < T - 10; y += 15) for (let x = 0; x < T; x += 8) cover(px, x, y, COV[i++ % COV.length], i); for (const y of [12, 27]) fill(px, 0, y, T, 1, [160, 160, 170]); }),
    // The boss room: boards burned red, claw marks.
    5: tex(px => { for (let x = 0; x < T; x++) for (let y = 0; y < T; y++) px(x, y, (x >> 3) % 2 ? [110, 30, 34] : [90, 22, 28]); for (let x = 7; x < T; x += 8) fill(px, x, 0, 1, T, [30, 6, 8]); for (let i = 0; i < 12; i++) { px(8 + i, 6 + i, [20, 4, 4]); px(12 + i, 6 + i, [20, 4, 4]); px(16 + i, 6 + i, [20, 4, 4]); } }),
    // The slab wall: graded slabs (clear case, red label, a card inside).
    6: tex(px => { fill(px, 0, 0, T, T, [40, 34, 30]); for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { const x = 1 + c * 8, y = 1 + r * 16; fill(px, x, y, 7, 14, [200, 210, 220]); fill(px, x, y, 7, 3, [210, 40, 40]); fill(px, x + 1, y + 1, 5, 1, [255, 255, 255]); fill(px, x + 1, y + 4, 5, 9, COV[(r * 4 + c + 2) % COV.length]); fill(px, x + 2, y + 6, 3, 4, [240, 220, 160]); } }),
    // The corkboard: flyers -- FNM, BUY, $5, a lost-cat-style sheet.
    7: tex(px => { fill(px, 0, 0, T, T, [170, 120, 70]); for (let i = 0; i < 40; i++) px((i * 7) % T, (i * 13) % T, [140, 96, 52]); fill(px, 1, 2, 14, 9, [240, 240, 230]); text(px, 2, 4, 'FNM', [30, 30, 160]); fill(px, 17, 1, 13, 9, [250, 230, 90]); text(px, 18, 3, 'BUY', [180, 30, 30]); fill(px, 3, 14, 11, 9, [140, 220, 140]); text(px, 4, 16, '$5', [20, 20, 20]); fill(px, 17, 13, 12, 16, [235, 235, 235]); fill(px, 19, 15, 8, 6, [90, 90, 90]); fill(px, 19, 23, 8, 1, [30, 30, 30]); fill(px, 19, 25, 6, 1, [30, 30, 30]); for (const [x, y] of [[7, 2], [23, 1], [8, 14], [22, 13]]) px(x, y, [220, 30, 30]); }),
    // Binder pages: 9-pocket sheets of made-up cards.
    // 9 arcade cabinets: marquee, glowing screen, buttons.
    9: tex(px => { fill(px, 0, 0, T, T, [18, 14, 26]); [[1, [255, 60, 170], [30, 190, 240]], [17, [255, 200, 40], [80, 240, 120]]].forEach(([x, m, sc]) => { fill(px, x, 0, 14, T, [70, 30, 120]); fill(px, x + 1, 1, 12, 4, m); fill(px, x + 2, 7, 10, 9, sc); for (let y = 8; y < 16; y += 2) fill(px, x + 2, y, 10, 1, sc.map(v => v * 0.7)); fill(px, x + 4, 9, 2, 2, [250, 255, 255]); fill(px, x, 18, 14, 3, [50, 50, 60]); px(x + 3, 19, [230, 40, 50]); px(x + 6, 19, [255, 220, 40]); px(x + 9, 19, [40, 200, 80]); fill(px, x + 5, 24, 4, 3, [200, 170, 60]); fill(px, x + 6, 25, 2, 1, [30, 20, 10]); }); }),
    // 10 a vending machine: rows of cans behind glass.
    10: tex(px => { fill(px, 0, 0, T, T, [30, 26, 24]); fill(px, 2, 0, 28, T, [190, 30, 40]); fill(px, 4, 3, 18, 22, [20, 30, 50]); const CAN = [[240, 60, 60], [60, 200, 240], [250, 210, 40], [80, 220, 100], [240, 240, 240]]; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) fill(px, 5 + c * 4, 4 + r * 5, 3, 4, CAN[(r + c) % CAN.length]); fill(px, 24, 4, 4, 6, [230, 230, 230]); for (let y = 12; y < 22; y += 3) fill(px, 25, y, 2, 2, [40, 40, 40]); fill(px, 6, 27, 14, 3, [12, 12, 14]); }),
    // 11 a stack of CRT TVs, all on different channels.
    11: tex(px => { boards(px); const SC = [[60, 120, 230], [40, 200, 90], [230, 80, 160], [200, 200, 210]]; for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) { const x = 1 + c * 16, y = 1 + r * 16, sc = SC[r * 2 + c]; fill(px, x, y, 14, 14, [64, 58, 52]); fill(px, x + 2, y + 2, 10, 8, sc); for (let k = 0; k < 10; k++) px(x + 2 + (k * 7 + r * 3 + c) % 10, y + 2 + (k * 3 + c) % 8, [240, 240, 250]); px(x + 11, y + 12, [210, 200, 160]); px(x + 9, y + 12, [210, 200, 160]); } }),
    // 12 posters (all made up): a sunset, a robot, a starburst SALE.
    12: tex(px => { boards(px); fill(px, 1, 2, 9, 13, [250, 140, 60]); fill(px, 1, 9, 9, 6, [80, 40, 120]); fill(px, 3, 5, 5, 3, [255, 230, 120]); fill(px, 12, 3, 8, 12, [40, 60, 90]); fill(px, 14, 5, 4, 4, [170, 180, 190]); px(15, 6, [255, 60, 60]); px(16, 6, [255, 60, 60]); fill(px, 14, 10, 4, 4, [140, 150, 160]); fill(px, 22, 2, 9, 12, [255, 230, 40]); for (let k = 0; k < 9; k++) { px(26 + Math.round(Math.cos(k) * 4), 8 + Math.round(Math.sin(k) * 4), [230, 40, 40]); } text(px, 3, 20, 'SALE', [255, 255, 255]); fill(px, 1, 18, 17, 9, [200, 30, 40]); text(px, 3, 20, 'SALE', [255, 240, 200]); [[1, 2], [9, 2], [12, 3], [19, 3], [22, 2], [30, 2]].forEach(([x, y]) => px(x, y, [200, 200, 190])); }),
    // 13 a metal shelf of sealed boxes (made-up foil boxes).
    13: tex(px => { fill(px, 0, 0, T, T, [44, 42, 48]); fill(px, 0, 0, 2, T, [120, 120, 128]); fill(px, 30, 0, 2, T, [120, 120, 128]); const FOIL = [[220, 40, 60], [40, 170, 220], [240, 190, 40], [150, 60, 210], [50, 190, 90], [240, 120, 30]]; [9, 20, 31].forEach((sy, r) => { fill(px, 0, sy, T, 1, [140, 140, 148]); for (let x = 3, k = r; x < 28; x += 7, k++) { const c = FOIL[k % FOIL.length]; fill(px, x, sy - 8, 6, 8, c); fill(px, x, sy - 8, 6, 2, c.map(v => Math.min(255, v + 50))); fill(px, x + 1, sy - 5, 4, 1, [250, 250, 240]); } }); }),
    // 14 a brick wall with a neon OPEN sign and a lightning bolt.
    14: tex(px => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) px(x, y, (y % 4 === 3 || (x + (y >> 2) % 2 * 4) % 8 === 7) ? [24, 14, 16] : [66, 30, 34]); for (let x = 3; x < 29; x++) { px(x, 4, [255, 60, 180]); px(x, 13, [255, 60, 180]); } for (let y = 4; y < 14; y++) { px(3, y, [255, 60, 180]); px(28, y, [255, 60, 180]); } text(px, 8, 7, 'OPEN', [90, 240, 255]); [[22, 17], [20, 20], [23, 20], [21, 23], [19, 27], [24, 22], [22, 25]].forEach(([x, y]) => fill(px, x, y, 2, 2, [255, 230, 60])); }),
    // 15 a roll-up garage door with spray paint.
    15: tex(px => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) px(x, y, (y >> 2) % 2 ? [130, 134, 140] : [106, 110, 116]); for (let y = 3; y < T; y += 4) fill(px, 0, y, T, 1, [70, 72, 78]); for (let k = 0; k < 18; k++) { const x = 4 + k, y = 12 + Math.round(Math.sin(k / 2) * 3); fill(px, x, y, 2, 2, [40, 220, 120]); } for (let k = 0; k < 10; k++) fill(px, 8 + k * 2, 21 + (k % 2), 2, 2, [240, 70, 200]); fill(px, 13, 28, 6, 2, [50, 50, 54]); }),
    // 16 brick with string lights and a dartboard.
    16: tex(px => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) px(x, y, (y % 5 === 4 || (x + ((y / 5) | 0) % 2 * 5) % 10 === 9) ? [60, 40, 34] : [130, 66, 48]); const BUL = [[255, 80, 80], [255, 220, 60], [80, 220, 120], [80, 160, 255]]; for (let x = 0; x < T; x++) { const y = 4 + Math.round(Math.sin(x / 5) * 2); px(x, y, [30, 30, 30]); if (x % 4 === 1) fill(px, x, y + 1, 2, 2, BUL[(x >> 2) % 4]); } for (let r = 7; r > 0; r -= 2) for (let a = 0; a < 40; a++) px(16 + Math.round(Math.cos(a / 6.4) * r), 20 + Math.round(Math.sin(a / 6.4) * r), r % 4 === 1 ? [230, 220, 200] : [30, 30, 30]); px(16, 20, [220, 40, 40]); }),
    // ── The dungeon under the shed ──
    // 17 stone brick, a little moss.
    17: tex(px => { stone(px); }),
    // 18 crypt niches: two arches, a skull and bones in each.
    18: tex(px => { stone(px); for (const x0 of [2, 18]) { fill(px, x0, 6, 12, 18, [14, 12, 16]); fill(px, x0 + 1, 4, 10, 2, [14, 12, 16]); fill(px, x0 + 3, 14, 6, 5, [222, 216, 196]); px(x0 + 4, 16, [20, 16, 16]); px(x0 + 7, 16, [20, 16, 16]); fill(px, x0 + 4, 18, 4, 1, [40, 34, 30]); fill(px, x0 + 1, 21, 10, 2, [205, 198, 178]); } }),
    // 19 a torch in an iron bracket.
    19: tex(px => { stone(px); fill(px, 14, 18, 4, 9, [60, 56, 62]); fill(px, 12, 16, 8, 2, [80, 76, 84]); fill(px, 14, 10, 4, 6, [255, 130, 30]); fill(px, 15, 8, 2, 4, [255, 220, 90]); px(15, 7, [255, 240, 160]); fill(px, 13, 12, 1, 3, [240, 90, 20]); fill(px, 18, 12, 1, 3, [240, 90, 20]); }),
    // 20 a catacomb of rotting long boxes in stone niches.
    20: tex(px => { stone(px); for (const y0 of [2, 17]) { fill(px, 1, y0, 30, 12, [16, 14, 18]); for (const x0 of [2, 16]) { fill(px, x0, y0 + 3, 13, 8, [150, 124, 84]); fill(px, x0, y0 + 3, 13, 1, [176, 150, 106]); fill(px, x0 + 3, y0 + 6, 5, 2, [214, 206, 180]); px(x0 + 10, y0 + 9, [90, 70, 40]); } } }),
    // 21 cobwebs and a hanging chain.
    21: tex(px => { stone(px); for (let k = 0; k < 12; k++) { px(k, k, [200, 200, 210]); px(k, Math.floor(k / 2), [180, 180, 190]); px(Math.floor(k / 2), k, [180, 180, 190]); } for (const r of [4, 8]) for (let a = 0; a <= r; a++) px(a, r - a, [170, 170, 180]); for (let y = 0; y < 26; y += 3) { fill(px, 22, y, 3, 2, [96, 92, 100]); px(23, y + 2, [60, 58, 64]); } }),
    // 22 a collapsed heap of long boxes in the stone, comics spilling out.
    22: tex(px => { stone(px); [[1, 18, 14, 7, 0], [15, 20, 16, 7, 1], [4, 11, 13, 7, 2], [17, 12, 12, 7, 0], [8, 4, 14, 7, 1]].forEach(([x, y, w, h, k]) => { fill(px, x, y, w, h, [196 - k * 14, 182 - k * 14, 150 - k * 12]); fill(px, x, y, w, 1, [222, 212, 186]); fill(px, x + 2, y + 3, 4, 2, [240, 236, 220]); }); [[3, 26], [12, 27], [21, 28], [27, 26]].forEach(([x, y], i) => fill(px, x, y, 5, 4, [[220, 50, 50], [50, 110, 220], [240, 190, 40], [60, 170, 80]][i])); }),
    // 23 the arena: dark stone, a glowing red rune circle, an iron chain.
    23: tex(px => { stone(px); for (let a = 0; a < 40; a++) { const r = a / 40 * Math.PI * 2; px(16 + Math.round(Math.cos(r) * 9), 15 + Math.round(Math.sin(r) * 9), [235, 44, 30]); } for (let k = -6; k <= 6; k++) { px(16 + k, 15 + Math.round(k * 0.6), [255, 90, 40]); px(16 + k, 15 - Math.round(k * 0.6), [255, 90, 40]); } for (let y = 0; y < 30; y += 3) { fill(px, 3, y, 3, 2, [96, 92, 100]); fill(px, 27, y + 1, 3, 2, [96, 92, 100]); } }),
    // 24 an open window: a wooden frame and sill; the magenta is drawn as the sky outside.
    24: tex(px => { boards(px); fill(px, 4, 4, 24, 20, [74, 46, 22]); fill(px, 6, 6, 20, 16, [255, 0, 255]); fill(px, 15, 6, 2, 16, [74, 46, 22]); fill(px, 3, 24, 26, 2, [120, 80, 42]); fill(px, 3, 26, 26, 1, [60, 36, 16]); }),
    8: tex(px => { fill(px, 0, 0, T, T, [30, 30, 36]); fill(px, 1, 1, 30, 30, [70, 70, 80]); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const x = 2 + c * 10, y = 2 + r * 10, k = COV[(r * 3 + c) % COV.length]; fill(px, x, y, 8, 9, [220, 210, 160]); fill(px, x + 1, y + 1, 6, 4, k); fill(px, x + 1, y + 6, 6, 1, [60, 60, 60]); fill(px, x + 1, y + 7, 4, 1, [120, 120, 120]); px(x, y, [255, 255, 255]); } }),
  };
}
// Props along the hallway, 16 x 16 sprites ('.' is see-through).
const SPRITES = {
  // The dollar bin: a beat-up box of comics with a "$1" sign.
  dollarbin: ['..aaaaaaaaaaa...', '..abbbbbbbbba...', '..abwwwwwwwba...', '..abw$1wwwwba...', '..abwwwwwwwba...', '..aaaaaaaaaaa...', '.ccdcedcfdcecc..', '.aaaaaaaaaaaaa..', '.agggggggggggga.', '.agggggggggggga.', '.agggggggggggga.', '.aaaaaaaaaaaaaa.'],
  // A leaning stack of comics.
  comics: ['....cccccccc....', '....dddddddd....', '...eeeeeeee.....', '....ffffffff....', '...cccccccc.....', '....dddddddd....', '....eeeeeeee....', '...ffffffff.....', '....cccccccc....', '....dddddddd....'],
  // A white card storage box (800 count), lid half off.
  cardbox: ['.aaaaaaaaaaaaa..', '.awwwwwwwwwwwa..', '..aaaaaaaaaaaaa.', '..awwwwwwwwwwwa.', '..awwbbbbbwwwwa.', '..awwwwwwwwwwwa.', '..awwwwwwwwwwwa.', '..aaaaaaaaaaaaa.'],
  // An empty pizza box (game night).
  pizza: ['..aaaaaaaaaaaa..', '..abbbbbbbbbba..', '..abbbrrrbbbba..', '..abbrrrrrbbba..', '..abbbrrrbbbba..', '..aaaaaaaaaaaa..'],
  // A bucket catching the roof leak.
  bucket: ['.......c........', '.......c........', '................', '...aaaaaaaaaa...', '...abccccccba...', '....abbbbbba....', '....abbbbbba....', '.....aaaaaa.....'],
  // A folding table with a playmat and two decks.
  table: ['aaaaaaaaaaaaaaaa', 'abbbbbbbbbbbbbba', 'abbcccbbbbcccbba', 'abbcccbbbbcccbba', 'aaaaaaaaaaaaaaaa', '.d............d.', '.d............d.', '.d............d.', 'dd............dd'],
  // A boxed figure in a window box (made up).
  figure: ['...aaaaaaaa.....', '...abbbbbbba.....', '...abcccccba.....', '...abcdddcba.....', '...abcdedcba.....', '...abcdddcba.....', '...abccfccba.....', '...abcffccba.....', '...abcccccba.....', '...abbbbbbba.....', '...aaaaaaaa.....'],
  eyes: ['................', '....a.....a.....', '...aaa...aaa....'],
  // Random cool stuff (2026-11-12), all made up: an arcade cabinet, a CRT TV on
  // a cart, a gumball machine, a traffic cone, a skeleton, a raccoon, a trash
  // can, a rubber duck, candles, a fire barrel, a glowing crystal, a garden
  // gnome, a push mower, a mini fridge, a lava lamp, a black cat.
  arcade: ['..aaaaaaaaaaaa..', '..ammmmmmmmmma..', '..ammmmmmmmmma..', '..aaaaaaaaaaaa..', '..abbbbbbbbbba..', '..abssssssssba..', '..abswsssswsba..', '..abssssssssba..', '..absssswsssba..', '..abbbbbbbbbba..', '.cccccccccccccc.', '.ccyccrcccgcccc.', '..abbbbbbbbbba..', '..abbbbddbbbba..', '..abbbbbbbbbba..', '..aaaaaaaaaaaa..'],
  tv: ['....a....a......', '.....a..a.......', '......aa........', '.bbbbbbbbbbbbb..', '.bsssssssssssb..', '.bszsszsszszsb..', '.bsssssssssssb..', '.bszszsszsszsb..', '.bsssssssssssb..', '.bbbbbbbbbkbkb..', '...cc......cc...'],
  gumball: ['......ccc.......', '....gggggggg....', '...grgybgrygg...', '..gybrgyrbgyrg..', '..grygbrygbryg..', '..gybrgybrgybg..', '...grybgrybgg...', '....gggggggg....', '....aaaaaaaa....', '....aaakkaaa....', '....aaaaaaaa....', '.....aaaaaa.....', '....aaaaaaaa....'],
  cone: ['.......oo.......', '.......oo.......', '......owwo......', '......owwo......', '.....oooooo.....', '.....oooooo.....', '....owwwwwwo....', '....oooooooo....', '...oooooooooo...', '..aaaaaaaaaaaa..'],
  skeleton: ['......wwww......', '.....wwwwww.....', '.....wkwwkw.....', '.....wwwwww.....', '......wkkw......', '.......ww.......', '....wwwwwwww....', '...w.wkwwkw.w...', '...w.wwwwww.w...', '..w..wkwwkw..w..', '.......ww.......', '......wwww......', '......w..w......', '......w..w......', '.....w....w.....', '....ww....ww....'],
  raccoon: ['..a.......a.....', '..aa.....aa.....', '..agggggggga....', '..akwkggkwka....', '..agggnnggga....', '...aggggggga....', '..aggggggggggat.', '..agggggggggatat', '..aa.aa..aa.aa..'],
  trashcan: ['...aaaaaaaaaaa..', '..abbbbbbbbbbba.', '...aaaaaaaaaaa..', '...acbcbcbcbca..', '...acbcbcbcbca..', '...acbcbcbcbca..', '...acbcbcbcbca..', '...acbcbcbcbca..', '...acbcbcbcbca..', '...acbcbcbcbca..', '...aaaaaaaaaaa..'],
  duck: ['.....yyyy.......', '....yyyyyy......', '....yykyyyoo....', '.....yyyyyoo....', '.yy..yyyy.......', '.yyyyyyyyyy.....', '..yyyyyyyyy.....', '...yyyyyyy......'],
  candles: ['...f.....f......', '..fff...fff..f..', '...w.....w..fff.', '..www...www..w..', '..www...www.www.', '..www...www.www.', '..www...www.www.', '.aaaaaaaaaaaaaa.'],
  barrel: ['.....f...f......', '....fff.fff.....', '...ffyfffyff....', '...fyyyfyyyf....', '..aaaaaaaaaaa...', '..abbbbbbbbba...', '..aaaaaaaaaaa...', '..abbbbbbbbba...', '..abbbbbbbbba...', '..aaaaaaaaaaa...', '..abbbbbbbbba...', '..abbbbbbbbba...', '..aaaaaaaaaaa...'],
  crystal: ['.......c........', '......ccc.......', '......cdc...c...', '.....ccdcc.ccc..', '.....cdddc.cdc..', '..c..ccdcc.ccc..', '.ccc.ccdcc.cdc..', '.cdc.cdddc.ccc..', '.ccc.ccdcc.ccc..', '.aaaaaaaaaaaaa..'],
  gnome: ['.......r........', '......rr........', '......rrr.......', '.....rrrr.......', '.....rrrrr......', '....rrrrrr......', '....ssssss......', '....skssks......', '....wwwwww......', '...wwwwwwww.....', '...bwwwwwwb.....', '...bbbbbbbb.....', '....kk..kk......', '...kkk..kkk.....'],
  mower: ['h...............', '.h..............', '..h.............', '...h............', '....h...........', '.....aaaaaaaa...', '....arrrrrrrra..', '...arrrrrrrrrra.', '...kk.......kk..'],
  fridge: ['...aaaaaaaaaa...', '...awwwwwwwwa...', '...awwrwwwwwa...', '...awwwwwbwwa...', '...awwwwwwwwa...', '...aaaaaaaaaa...', '...awwwwwwwka...', '...awwywwwwka...', '...awwwwwwwka...', '...awwwwgwwka...', '...awwwwwwwka...', '...aaaaaaaaaa...', '....k......k....'],
  lavalamp: ['.......aa.......', '......aaaa......', '......lggl......', '......glgg......', '.....gglggg.....', '.....ggggll.....', '.....glllgg.....', '....gggggllg....', '....ggllgggg....', '....glllllgg....', '.....aaaaaa.....', '....aaaaaaaa....', '...aaaaaaaaaa...', '...aaaaaaaaaa...'],
  // Down in the dungeon, and the critters that keep the place moving.
  bones: ['.....wwww.......', '....wkwwkw......', '....wwwwww.ww...', '.ww..wkkw.wwwww.', 'wwwwwwwwwwww.ww.', '.ww.wwww..wwwww.'],
  coffin: ['...aaaaaaaaaa...', '..abbbbbbbbbba..', '.abbbwwwwwbbbba.', '.abbbwkkkwbbbba.', '.abbbwwwwwbbbba.', '.abbbbbbbbbbbba.', '.abbbbbbbbbbbba.', '..abbbbbbbbbba..', '...aaaaaaaaaa...'],
  brazier: ['......f.........', '.....fyf..f.....', '....fyyyffyf....', '...fyyyyyyyyf...', '...aaaaaaaaaa...', '....abbbbbba....', '.....abbbba.....', '......abba......', '.......aa.......', '.......aa.......', '......aaaa......', '.....aaaaaa.....'],
  trapdoor: ['..aaaaaaaaaaaa..', '..abbbbbbbbbba..', '..abbbbccbbbba..', '..abbbbbbbbbba..', '..aaaaaaaaaaaa..'],
  rat: ['..........aa....', '...bbbbbbbbbbe..', '..bbbbbbbbbbbbn.', 'tt.bbbbbbbbbbb..', '.t..f..f...f....'],
  rat2: ['..........aa....', '...bbbbbbbbbbe..', '..bbbbbbbbbbbbn.', 'tt.bbbbbbbbbbb..', '.t...f..f..f....'],
  bat: ['a..............a', '.aa....bb....aa.', '..aaa.bbbb.aaa..', '....aabrrbaa....', '......bbbb......'],
  bat2: ['.......bb.......', '......bbbb......', '....aabrrbaa....', '..aaa.bbbb.aaa..', '.aa..........aa.', 'a..............a'],
  spider: ['.......w........', '.......w........', '.......w........', '.......w........', '.......w........', '.......w........', '.......w........', '.......w........', '.......w........', '.......w........', '...l...w...l....', '....l.bbb.l.....', '..llbbbbbbbll...', '....bbrbrbb.....', '..ll.bbbbb.ll...', '....l.....l.....'],
  cat: ['...k...k........', '...kk.kk........', '...kkkkk........', '...kykyk........', '...kkkkk........', '....kkk.........', '...kkkkkk.......', '..kkkkkkkk...k..', '..kkkkkkkk..k...', '..kkkkkkkkkk....'],
  // Treasure chests: shut, and open once chat hits its goal.
  // Treasure chests (2026-11-12: "the chests need to be better looking, I don't
  // really notice them"): a big wooden chest, gold bands, a glowing lock; open,
  // it spills gold light and coins.
  chest: ['...aaaaaaaaaa...', '..abbybbbbybba..', '.abbbybbbbybbba.', '.abbbybbbbybbba.', '.aaaayaaaayaaaa.', '.gggggggggggggg.', '.abbbybwwbybbba.', '.abbbybkkbybbba.', '.abbbybbbbybbba.', '.abbbybbbbybbba.', '.abbbybbbbybbba.', '.aaaaaaaaaaaaaa.', '.d............d.'],
  chestopen: ['..s....s....s...', '...aaaaaaaaaa...', '..abbybbbbybba..', '.aaaayaaaayaaaa.', '.cccccccccccccc.', '.cyycyycyycyycc.', '.gggggggggggggg.', '.abbbybwwbybbba.', '.abbbybbbbybbba.', '.abbbybbbbybbba.', '.abbbybbbbybbba.', '.aaaaaaaaaaaaaa.', '.d............d.'],
};
const SPRITE_COLORS = {
  dollarbin: { a: [40, 26, 14], b: [200, 40, 40], w: [250, 240, 200], $: [20, 120, 30], 1: [20, 120, 30], c: [200, 40, 40], d: [40, 90, 190], e: [230, 170, 30], f: [60, 150, 70], g: [160, 120, 70] },
  comics: { c: [200, 40, 40], d: [40, 90, 190], e: [230, 170, 30], f: [130, 50, 160] },
  cardbox: { a: [120, 120, 130], w: [240, 240, 236], b: [40, 40, 40] },
  pizza: { a: [110, 80, 40], b: [200, 160, 100], r: [190, 50, 30] },
  bucket: { a: [40, 40, 50], b: [120, 120, 140], c: [90, 150, 220] },
  table: { a: [40, 40, 40], b: [40, 90, 70], c: [200, 190, 160], d: [130, 130, 140] },
  figure: { a: [30, 30, 30], b: [230, 90, 30], c: [200, 230, 250], d: [240, 200, 160], e: [20, 20, 20], f: [60, 70, 200] },
  eyes: { a: [255, 230, 80] },
  arcade: { a: [20, 16, 26], m: [255, 60, 170], b: [70, 30, 120], s: [30, 190, 240], w: [220, 255, 255], c: [50, 50, 60], y: [255, 220, 40], r: [230, 40, 50], g: [40, 200, 80], d: [200, 170, 60] },
  tv: { a: [140, 140, 150], b: [70, 56, 44], s: [70, 120, 220], z: [220, 230, 255], k: [200, 190, 150], c: [40, 40, 40] },
  gumball: { c: [200, 30, 40], g: [200, 230, 240], r: [230, 40, 50], y: [250, 210, 40], b: [50, 120, 230], a: [200, 30, 40], k: [220, 220, 220] },
  cone: { o: [240, 110, 20], w: [240, 240, 240], a: [40, 40, 40] },
  skeleton: { w: [230, 226, 210], k: [40, 30, 30] },
  raccoon: { a: [60, 56, 56], g: [130, 126, 120], k: [20, 20, 20], w: [250, 250, 250], n: [10, 10, 10], t: [40, 36, 36] },
  trashcan: { a: [70, 76, 80], b: [110, 116, 120], c: [90, 96, 100] },
  duck: { y: [250, 220, 30], k: [20, 20, 20], o: [240, 120, 20] },
  candles: { f: [255, 200, 60], w: [230, 220, 200], a: [60, 50, 40] },
  barrel: { f: [255, 120, 20], y: [255, 230, 80], a: [60, 40, 30], b: [120, 60, 40] },
  crystal: { c: [150, 80, 255], d: [230, 200, 255], a: [50, 40, 60] },
  gnome: { r: [210, 30, 40], s: [240, 190, 150], k: [40, 30, 20], w: [240, 240, 240], b: [40, 90, 200] },
  mower: { h: [140, 140, 150], a: [40, 40, 40], r: [200, 40, 30], k: [20, 20, 20] },
  fridge: { a: [90, 90, 96], w: [220, 224, 230], k: [60, 60, 64], r: [230, 50, 50], b: [50, 120, 230], y: [250, 210, 40], g: [40, 190, 80] },
  lavalamp: { a: [160, 160, 170], g: [120, 30, 140], l: [255, 120, 40] },
  cat: { k: [24, 22, 28], y: [180, 255, 80] },
  bones: { w: [225, 220, 200], k: [30, 25, 25] },
  coffin: { a: [60, 45, 30], b: [150, 120, 80], w: [210, 200, 170], k: [40, 30, 20] },
  brazier: { f: [255, 120, 20], y: [255, 230, 90], a: [50, 45, 50], b: [90, 80, 90] },
  trapdoor: { a: [40, 30, 20], b: [100, 70, 40], c: [190, 190, 200] },
  rat: { a: [200, 140, 150], b: [110, 100, 95], e: [20, 20, 20], n: [230, 140, 150], t: [190, 140, 140], f: [190, 140, 140] },
  rat2: { a: [200, 140, 150], b: [110, 100, 95], e: [20, 20, 20], n: [230, 140, 150], t: [190, 140, 140], f: [190, 140, 140] },
  bat: { a: [70, 50, 80], b: [44, 32, 54], r: [255, 70, 70] },
  bat2: { a: [70, 50, 80], b: [44, 32, 54], r: [255, 70, 70] },
  spider: { w: [190, 190, 200], l: [30, 25, 30], b: [44, 32, 44], r: [255, 50, 50] },
  chest: { a: [44, 24, 10], b: [156, 88, 36], y: [255, 205, 60], g: [240, 178, 40], w: [255, 244, 180], k: [30, 18, 8], d: [44, 24, 10] },
  chestopen: { a: [44, 24, 10], b: [156, 88, 36], y: [255, 205, 60], g: [240, 178, 40], w: [255, 244, 180], c: [255, 248, 200], s: [255, 255, 220], d: [44, 24, 10] },
};
// Props that move (2026-11-12): TV static, cycling arcade screens, flowing
// lava lamps, dancing flames, pulsing crystals. Pure functions of time.
const hashN = (a, b, c) => (((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0) % 1000 / 1000;
const ANIM = {
  chest: (ch, col, u, v, tm) => ('ygw'.includes(ch) ? col.map(c => c * (0.85 + 0.5 * Math.max(0, 1 - Math.abs(u + v * 0.4 - ((tm * 0.45) % 1) * 2.2 + 0.3) * 6))) : col),
  chestopen: (ch, col, u, v, tm) => ('cs'.includes(ch) ? col.map(c => c * (0.8 + 0.2 * Math.sin(tm * 6 + u * 9))) : col),
  tv: (ch, col, u, v, tm) => (ch === 's' || ch === 'z') ? (hashN(Math.floor(u * 16), Math.floor(v * 16), Math.floor(tm * 12)) > 0.55 ? [225, 230, 255] : [50 + 40 * Math.sin(tm), 80, 190]) : col,
  arcade: (ch, col, u, v, tm) => ch === 's' ? [30 + 60 * (1 + Math.sin(tm * 2 + v * 6)), 140 + 50 * Math.sin(tm * 1.3), 220] : ch === 'm' ? (Math.floor(tm * 3 + u * 8) % 2 ? [255, 60, 170] : [255, 220, 60]) : col,
  lavalamp: (ch, col, u, v, tm) => (ch === 'g' || ch === 'l') ? (Math.sin(v * 14 - tm * 1.6 + Math.sin(u * 6 + tm) * 1.5) > 0.35 ? [255, 120, 40] : [120, 30, 140]) : col,
  candles: (ch, col, u, v, tm) => ch === 'f' ? col.map(c => c * (0.75 + 0.25 * Math.sin(tm * 17 + u * 13 + v * 7))) : col,
  brazier: (ch, col, u, v, tm) => (ch === 'f' || ch === 'y') ? col.map(c => c * (0.7 + 0.3 * Math.sin(tm * 15 + u * 11 + v * 9))) : col,
  barrel: (ch, col, u, v, tm) => (ch === 'f' || ch === 'y') ? col.map(c => c * (0.7 + 0.3 * Math.sin(tm * 15 + u * 11 + v * 9))) : col,
  crystal: (ch, col, u, v, tm) => col.map(c => c * (0.8 + 0.2 * Math.sin(tm * 2 + v * 3))),
};
// What glows in the dark (screens, flames, crystals, eyes) and how big each prop stands.
const SPRITE_GLOW = { chest: 'ygw', chestopen: 'ygwcs', arcade: 'msw', tv: 'sz', barrel: 'fy', crystal: 'cd', lavalamp: 'gl', candles: 'f', raccoon: 'w', cat: 'y', brazier: 'fy', bat: 'r', bat2: 'r', spider: 'r' };
const SPRITE_SIZE = { chest: 0.85, chestopen: 0.85, arcade: 0.95, fridge: 0.7, skeleton: 0.85, tv: 0.6, gumball: 0.6, lavalamp: 0.5, duck: 0.3, candles: 0.4, cone: 0.45, mower: 0.55, gnome: 0.5, crystal: 0.6, barrel: 0.6, trashcan: 0.6, raccoon: 0.45, cat: 0.4, bones: 0.3, coffin: 0.5, brazier: 0.55, trapdoor: 0.45, rat: 0.16, rat2: 0.16, bat: 0.2, bat2: 0.2, spider: 0.5 };
// The 3D-only props drawn flat when the 3D photos aren't there (no WebGL).
const FLAT = { lockbox: 'cardbox', lockboxopen: 'comics', longbox: 'cardbox', longboxopen: 'comics', longboxstack: 'cardbox', shortbox: 'cardbox', crate: 'dollarbin' };
// Each 3D prop's photo, as a share of the wall's height.
const MODEL_SIZE = { lockbox: 0.85, lockboxopen: 0.9, chest: 0.95, chestopen: 0.95, rat: 0.55, bat: 0.6, spider: 0.75, longbox: 0.8, longboxopen: 0.85, longboxstack: 1.0, shortbox: 0.75, crate: 0.8, coffin: 0.85, bones: 0.6, brazier: 0.9 };
const MODEL_GLOW = new Set(['chestopen', 'brazier', 'lockbox', 'lockboxopen']);
// Critters move on their own; they never hide for the props passing in front.
const CRITTERS = new Set(['rat', 'rat2', 'bat', 'bat2', 'spider']);
// One prop, drawn big and crisp on a 2D canvas (the overlay's props in front
// of the hosts): kind is any SPRITES key; px is the size of one pixel.
export const SPRITE_KINDS = Object.keys(SPRITES);
export function drawSprite(ctx, kind, px = 10, shade = 1) {
  const rows = SPRITES[kind], cols = SPRITE_COLORS[kind]; if (!rows) return false;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const top = (16 - rows.length) * px;
  rows.forEach((row, y) => [...row].forEach((ch, x) => { const c = cols[ch]; if (!c || ch === '.') return; ctx.fillStyle = `rgb(${c[0] * shade | 0},${c[1] * shade | 0},${c[2] * shade | 0})`; ctx.fillRect(x * px, top + y * px, px, px); }));
  return true;
}

// Where the props sit: fixed spots along each stretch of the route.
// 'pic' is one of the store's items in a top loader on a little stand.
const SHED_PROPS = [['gnome', 'mower', 'cone', 'cat'], ['cone', 'barrel', 'fridge', 'mower'], ['duck', 'bucket', 'duck', 'cone'], ['skeleton', 'candles', 'cat', 'crystal'], ['raccoon', 'trashcan', 'raccoon', 'pizza'], ['barrel', 'skeleton', 'trashcan', 'candles'], ['crystal', 'candles', 'skeleton', 'crystal']];
export function propsFor(layout, floor) {
  // THEME: this shed's own (gnomes in the garden shed, raccoons in the
  // raccoon one, skeletons and candles when it's haunted...); COOL: anywhere.
  const kinds = ['dollarbin', 'pic', 'THEME', 'comics', 'table', 'pic', 'COOL', 'comics', 'pic', 'THEME', 'cardbox', 'table', 'pic', 'figure', 'COOL', 'comics', 'THEME', 'pizza', 'eyes'], out = []; let picN = 0;
  const theme = SHED_PROPS[(Math.min(Math.max(1, floor), SHED_PROPS.length)) - 1], cool = ['arcade', 'tv', 'gumball', 'lavalamp', 'fridge', 'cat'];
  const deep = ['longbox', 'bones', 'longboxopen', 'brazier', 'longboxstack', 'coffin', 'shortbox', 'crate', 'skeleton', 'longbox', 'candles', 'longboxopen', 'crystal'], split = layout.split ?? DUNGEON_AT, total = layout.len || routeLength(layout); let acc = 0, deepN = floor;
  let themeN = 0, coolN = floor; // each in turn, so every one of them shows up
  const pick = k => k === 'THEME' ? theme[themeN++ % theme.length] : k === 'COOL' ? cool[coolN++ % cool.length] : k;
  for (let i = 1; i < layout.route.length; i++) {
    const [x0, y0] = layout.route[i - 1], [x1, y1] = layout.route[i], n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 2.5));
    const segLen = Math.hypot(x1 - x0, y1 - y0);
    for (let k = 1; k <= n; k++) {
      const f = k / (n + 1), side = (i + k) % 2 ? 0.32 : -0.32, dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      const below = (acc + f * segLen) / total > split, k0 = kinds[(i * 3 + k + floor) % kinds.length];
      const kind = below && (k0 === 'THEME' || k0 === 'COOL' || k0 === 'pizza' || k0 === 'figure' || k0 === 'dollarbin') ? deep[deepN++ % deep.length] : pick(k0);
      out.push({ x: x0 + 0.5 + dx * f + (-dy / len) * side, y: y0 + 0.5 + dy * f + (dx / len) * side, kind, idx: picN++, face: Math.atan2(-(dx / len) * side, (dy / len) * side) });
    }
    acc += segLen;
  }
  // The trapdoor down into the dungeon.
  { const p = poseAt(layout, split); out.push({ x: p.x + Math.cos(p.ang) * 0.6, y: p.y + Math.sin(p.ang) * 0.6, kind: 'trapdoor', idx: picN++ }); }
  // Each room's own things, in its corners.
  for (const [rx, ry, rw, rh, th] of layout.rooms || []) {
    const things = ROOM_THEMES[th ?? 0]?.props || [];
    [[rx + 0.5, ry + 0.5], [rx + rw - 0.5, ry + rh - 0.5], [rx + rw - 0.5, ry + 0.5]].forEach(([x, y], j) => { if (things[j]) out.push({ x, y, kind: things[j], idx: picN++, face: Math.atan2(ry + rh / 2 - y, rx + rw / 2 - x) }); });
  }
  // Two LOCKED long boxes down in the dungeon (chat's taps open them).
  for (const [k, t] of LOCKBOX_AT.map((t, k) => [k, t])) { const p = poseAt(layout, t), side = k % 2 ? -0.36 : 0.36; out.push({ x: p.x - Math.sin(p.ang) * side, y: p.y + Math.cos(p.ang) * side, kind: 'lockbox', idx: k, face: Math.atan2(-Math.cos(p.ang) * side, Math.sin(p.ang) * side) }); }
  // The arena: a brazier in each corner, bones on the floor.
  if (layout.arena) { const [bx, by, bw, bh] = layout.boss; [[bx + 0.5, by + 0.5], [bx + bw - 0.5, by + 0.5], [bx + 0.5, by + bh - 0.5], [bx + bw - 0.5, by + bh - 0.5]].forEach(([x, y], j) => out.push({ x, y, kind: 'brazier', idx: 900 + j, face: Math.atan2(by + bh / 2 - y, bx + bw / 2 - x) })); out.push({ x: bx + 1.3, y: by + bh / 2 + 0.8, kind: 'bones', idx: 904, face: 0.6 }); }
  // Three treasure chests along the way (chat's goals open them).
  for (const [k, t] of [[0, 0.16], [1, 0.47], [2, 0.8]]) { const p = poseAt(layout, t), side = k % 2 ? 0.34 : -0.34; out.push({ x: p.x - Math.sin(p.ang) * side, y: p.y + Math.cos(p.ang) * side, kind: 'chest', idx: k, face: Math.atan2(-Math.cos(p.ang) * side, Math.sin(p.ang) * side) }); }
  return out;
}

// Which of the store's items a prop shows (2026-11-11: "a box of pokemon
// cards on the table", "a few comics laid out"): an item stand shows any item,
// a folding table shows a sealed one, a comic stack shows a real comic.
// kinds[i] is 'comic' / 'sealed' / 'card' for photo i. Null: the plain sprite.
export function itemFor(p, kinds) {
  const n = kinds.length; if (!n) return null;
  if (p.kind === 'pic') return { i: p.idx % n, how: kinds[p.idx % n] || 'card' };
  const want = p.kind === 'table' ? 'sealed' : p.kind === 'comics' ? 'comic' : '';
  const list = want ? kinds.map((k, i) => k === want ? i : -1).filter(i => i >= 0) : [];
  return list.length ? { i: list[p.idx % list.length], how: want } : null;
}

// The store's item photos, framed for the walls (48 x 64, a black frame and
// a price-tag stripe). Images must allow CORS; the caller passes a proxied URL.
export const PIC_W = 96, PIC_H = 128;
export function loadPicture(src) {
  return new Promise(resolve => {
    if (!src || typeof Image === 'undefined') return resolve(null);
    const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
    im.onload = () => { try {
      const c = document.createElement('canvas'); c.width = PIC_W; c.height = PIC_H; const x = c.getContext('2d');
      x.fillStyle = '#111'; x.fillRect(0, 0, PIC_W, PIC_H);
      const iw = PIC_W - 6, ih = PIC_H - 14, k = Math.min(iw / im.width, ih / im.height), w = im.width * k, h = im.height * k;
      x.imageSmoothingEnabled = true; x.drawImage(im, 3 + (iw - w) / 2, 3 + (ih - h) / 2, w, h);
      x.fillStyle = '#d23'; x.fillRect(3, PIC_H - 9, PIC_W - 6, 6);
      const d = x.getImageData(0, 0, PIC_W, PIC_H).data, out = new Uint8ClampedArray(PIC_W * PIC_H * 3);
      for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { out[j] = d[i]; out[j + 1] = d[i + 1]; out[j + 2] = d[i + 2]; }
      resolve(out);
    } catch { resolve(null); } };
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

// Where the eye is: a little behind the walker when there's room (so the view
// looks down the hall). The overlay's props-in-front use the same pose.
export function eyePose(layout, grid, t) {
  const raw = poseAt(layout, t), bx = raw.x - Math.cos(raw.ang) * 0.45, by = raw.y - Math.sin(raw.ang) * 0.45;
  return grid[Math.floor(by)]?.[Math.floor(bx)] === 0 ? { ...raw, x: bx, y: by } : raw;
}

// ── The renderer ──
// w x h: 240 x 96 for the overlay window; tall (180 x 320) for the green-screen background.
export function createShedCrawl(canvas, { w: VW = VIEW_W, h: VH = VIEW_H, fov: FOV = 0.66 } = {}) {
  canvas.width = VW; canvas.height = VH;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(VW, VH), zbuf = new Float32Array(VW);
  let pics = [], picKinds = [], surf = null, bulbs = [], tick = 0, models = null, bossAnim = null, arenaK = 0;
  // The arena's spot: just inside it, from the end of the hall, looking at the boss.
  function arenaPose(p, k) {
    if (k < 0.002) return p;
    const r = map.layout.route, [ex, ey] = r[r.length - 1], [bx, by] = map.layout.bossAt, d = Math.hypot(bx - ex - 0.5, by - ey - 0.5) || 1;
    const ax = ex + 0.5 + (bx - ex - 0.5) / d * Math.max(0, d - 2.6), ay = ey + 0.5 + (by - ey - 0.5) / d * Math.max(0, d - 2.6), aang = Math.atan2(by - ay, bx - ax);
    let da = aang - p.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    return { x: p.x + (ax - p.x) * k, y: p.y + (ay - p.y) * k, ang: p.ang + da * k };
  }
  let state = { floor: 1, shed: 'GARDEN SHED', pct: 0, phase: 'floor', battery: 1, fork: '' }, map = buildMap(1), textures = makeTextures(PALETTES['GARDEN SHED']), props = propsFor(map.layout, 1);
  let first = true, shown = 0, target = 0, look = 0, peek = null, peekUntil = 0, done = new Set(), bossPx = null, raf = 0, last = 0, bob = 0, walking = false, dipAt = -99, fogMix = 0;
  const listeners = { peek: () => {} };
  let clockNow = 0, manual = { yaw: 0, pitch: 0, at: -1e9 }, scoutAt = -1e9, backAt = -1e9, pitchNow = 0, scoutNow = 0;
  function setBoss(sourceCanvas) {
    bossAnim = null;
    if (!sourceCanvas) { bossPx = null; return; }
    // The 3D boss, photographed through its idle animation (live-studio-3d.mjs bakeBoss).
    if (sourceCanvas.frames?.length) { bossAnim = sourceCanvas; bossPx = sourceCanvas.frames[0]; return; }
    const c = sourceCanvas.getContext('2d'), d = c.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    bossPx = { w: sourceCanvas.width, h: sourceCanvas.height, data: d.data };
  }
  function set(next) {
    const floorChanged = first || next.floor !== state.floor || next.shed !== state.shed; first = false;
    const forkChanged = (next.fork || '') !== (state.fork || '');
    state = { ...state, ...next };
    if (forkChanged && !floorChanged) map = buildMap(state.floor, state.fork || '');
    if (floorChanged) { map = buildMap(state.floor, state.fork || ''); textures = makeTextures(PALETTES[state.shed] || PALETTES['GARDEN SHED']); props = propsFor(map.layout, state.floor); shown = 0; done = new Set(); }
    if (floorChanged) { surf = { f: surfaceTex((SURFACES[state.shed] || SURFACES['GARDEN SHED']).f), c: surfaceTex((SURFACES[state.shed] || SURFACES['GARDEN SHED']).c), r: surfaceTex((SURFACES[state.shed] || {}).f === 'carpet' ? 'planks' : 'carpet'), df: surfaceTex('cobble'), dc: surfaceTex('vault') }; }
    bulbs = map.lights || [];
    target = state.phase === 'boss' ? 1 : Math.max(0, Math.min(1, state.pct / 100));
    if (floorChanged) { shown = target; if (shown >= (map.layout.split ?? DUNGEON_AT)) done.add('down'); }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < 50) return; // ~20 fps is plenty for chunky pixels
    const dt = Math.min(0.2, (now - (last || now)) / 1000); last = now;
    // Walk toward the floor's progress; stop to rummage at the peek spots.
    if (Date.now() < peekUntil) { look += (peek.turn - look) * Math.min(1, dt * 4); walking = false; }
    else {
      // Standing still, the camera never freezes (2026-11-12: "things need to feel
      // animated when we aren't moving"): a slow sway, and every 13 seconds a
      // glance to one side and back.
      const tm = now / 1000, ph = (tm % 13) / 13, side = Math.floor(tm / 13) % 2 ? 1 : -1;
      const glance = ph > 0.55 && ph < 0.8 ? Math.sin((ph - 0.55) / 0.25 * Math.PI) * 0.42 * side : 0;
      let idle = walking ? 0 : Math.sin(tm * 0.31) * 0.06 + glance;
      // The host's joystick wins for 3 seconds after it last moved; LOOK BACK
      // turns all the way round and back.
      const held = now - manual.at < 3000, back = (now - backAt) / 2600;
      if (held) idle = manual.yaw * 1.1;
      if (back >= 0 && back < 1) idle = Math.PI * (back < 0.3 ? back / 0.3 : back > 0.72 ? (1 - back) / 0.28 : 1);
      look += (idle - look) * Math.min(1, dt * (held || back < 1 ? 3 : walking ? 4 : 1.6));
      pitchNow += ((held ? manual.pitch : 0) - pitchNow) * Math.min(1, dt * 3);
      // SCOUT AHEAD: the camera runs on around the next corner, waits, and comes back.
      const sc = (now - scoutAt) / 7000, reach = Math.min(0.12, 10 / (map.layout.len || 30));
      scoutNow = sc >= 0 && sc < 1 ? reach * (sc < 0.35 ? Math.sin(sc / 0.35 * Math.PI / 2) : sc > 0.65 ? Math.cos((sc - 0.65) / 0.35 * Math.PI / 2) : 1) : 0;
      walking = shown < target - 0.002;
      if (walking) {
        // Steady footsteps (about 1.6 cells a second) on these long floors, a
        // little quicker to catch up after a big sale.
        const len = map.layout.len || routeLength(map.layout), step = Math.min(target - shown, dt * Math.max(1.6 / len, (target - shown) / 12));
        const split = map.layout.split ?? DUNGEON_AT;
        if (!done.has('down') && shown < split && shown + step >= split) { done.add('down'); dipAt = now; listeners.peek('DOWN THE TRAPDOOR INTO THE DUNGEON…'); }
        const hit = map.layout.peeks.find(p => !done.has(p.at) && shown < p.at && shown + step >= p.at);
        if (hit) { done.add(hit.at); shown = hit.at; const pose = poseAt(map.layout, shown); let turn = Math.atan2(hit.cell[1] + 0.5 - pose.y, hit.cell[0] + 0.5 - pose.x) - pose.ang; while (turn > Math.PI) turn -= 2 * Math.PI; while (turn < -Math.PI) turn += 2 * Math.PI; peek = { ...hit, turn }; peekUntil = Date.now() + 2600; listeners.peek(hit.label); }
        else shown += step;
      } else if (shown > target) shown = target;
    }
    const scoutWalk = now - scoutAt < 7000 && (now - scoutAt < 2450 || now - scoutAt > 4550); // footsteps out and back
    bob = walking || scoutWalk ? bob + dt * 9 : bob * 0.9;
    clockNow = now;
    draw();
  }
  function draw() {
    // The eye sits a little behind the walker (when there's room), so the view looks down the hall, not into the wall.
    // A boss up: walk on into the arena and face it.
    arenaK += ((state.phase === 'boss' && map.layout.arena && map.layout.bossAt ? 1 : 0) - arenaK) * 0.04;
    const pose = arenaPose(eyePose(map.layout, map.grid, Math.min(0.99, shown + scoutNow)), arenaK), ang = pose.ang + look, fov = FOV, batt = 0.25 + 0.75 * Math.max(0, Math.min(1, state.battery ?? 1));
    const dirX = Math.cos(ang), dirY = Math.sin(ang), planeX = -dirY * fov, planeY = dirX * fov;
    const tm = clockNow / 1000, N = GRID, zone = map.zone;
    // Breathing while standing; a dip as you climb down the trapdoor.
    const dip = (clockNow - dipAt) / 1600, breathe = walking ? 0 : Math.sin(tm * 1.3) * VH * 0.006;
    const pal0 = PALETTES[state.shed] || PALETTES['GARDEN SHED'], data = img.data, horizon = (VH >> 1) + Math.round(Math.sin(bob) * 1.5 + breathe + pitchNow * VH * 0.28 + (state.phase === 'boss' ? Math.sin(tm * 37) * Math.max(0, Math.sin(tm * 0.9)) ** 3 * VH * 0.02 : 0) + (dip > 0 && dip < 1 ? Math.sin(dip * Math.PI) * VH * 0.12 : 0));
    // Down in the dungeon the fog turns colder and darker.
    const inDeep = zone ? zone[Math.floor(pose.y) * N + Math.floor(pose.x)] : 0; fogMix += ((inDeep ? 1 : 0) - fogMix) * 0.05;
    const pal = { ...pal0, fog: pal0.fog.map((c, k) => Math.round(c * (1 - fogMix) + [4, 3, 8][k] * fogMix)) };
    const boss = state.phase === 'boss', rooms = map.layout.rooms || [];
    // Daylight through the windows, the sky in them, the weather out there.
    const day = state.day || 'day', wth = state.weather || 'clear', sky = SKY[day] || SKY.day, sunF = { morning: 0.9, day: 1.1, sunset: 0.6, night: 0 }[day] ?? 1;
    const flash = wth === 'storm' && tm % 11 < 0.14;
    if (bossAnim) bossPx = bossAnim.frames[Math.floor(tm * 8) % bossAnim.frames.length];
    // The lights near you, each flickering: bulbs buzz and now and then dip;
    // torches dance. (A fixed rhythm per light -- no chance, the same everywhere.)
    const near = [];
    for (let k = 0; k < bulbs.length; k++) { const b = bulbs[k]; if ((b.x - pose.x) ** 2 + (b.y - pose.y) ** 2 > 81) continue;
      if (b.win) { if (sunF > 0 || flash) near.push({ ...b, f: flash ? 1.6 : sunF * (wth === 'clear' ? 1 : 0.7) }); continue; }
      const f = b.torch ? 0.78 + 0.14 * Math.sin(tm * 9 + k * 1.7) + 0.08 * Math.sin(tm * 23 + k * 3.1) : ((Math.floor(tm * 4) + k * 13) % 53 === 0 ? 0.3 : 0.93 + 0.07 * Math.sin(tm * 3 + k));
      // A boss up: the arena's torches roar.
      near.push({ x: b.x, y: b.y, torch: b.torch, f: f * (b.torch ? (boss && b.arena ? 1.6 + 0.3 * Math.sin(tm * 13 + k) : 1.15) : 0.9) }); }
    // Each locked long box's padlock glows a little.
    for (const pr of props) if (pr.kind === 'lockbox' && !state.boxes?.[pr.idx] && (pr.x - pose.x) ** 2 + (pr.y - pose.y) ** 2 < 64) near.push({ x: pr.x, y: pr.y, torch: true, f: 0.55 + 0.15 * Math.sin(tm * 3 + pr.idx) });
    // Each chest glows: a warm gold pool of light around it, brighter while it's shut.
    for (const pr of props) if (pr.kind === 'chest' && (pr.x - pose.x) ** 2 + (pr.y - pose.y) ** 2 < 100) near.push({ x: pr.x, y: pr.y, torch: true, f: state.chests?.[pr.idx] ? 0.7 : 1.3 + 0.3 * Math.sin(tm * 2.4 + pr.idx) });
    let litO = 0;
    // Floor and ceiling, textured (floor casting): each row is a distance;
    // lit by the flashlight and the bulbs, fading into the shed's fog.
    const bulbLight = (wx, wy) => { let l = 0, o = 0; for (let k = 0; k < near.length; k++) { const b = near[k], v = b.f / (1 + ((wx - b.x) ** 2 + (wy - b.y) ** 2) * 1.6); l += v; if (b.torch) o += v; } litO = o; return l; };
    const rx0 = dirX - planeX, ry0 = dirY - planeY, rx1 = dirX + planeX, ry1 = dirY + planeY, posZ = 0.5 * VH;
    for (let y = 0; y < VH; y++) {
      const floorRow = y > horizon, p = floorRow ? y - horizon : horizon - y;
      if (p <= 0 || !surf) { for (let x = 0; x < VW; x++) { const i = (y * VW + x) * 4; data[i] = pal.fog[0]; data[i + 1] = pal.fog[1]; data[i + 2] = pal.fog[2]; data[i + 3] = 255; } continue; }
      const rowDist = posZ / p, stepX = rowDist * (rx1 - rx0) / VW, stepY = rowDist * (ry1 - ry0) / VW, tRow = floorRow ? surf.f : surf.c;
      let fx = pose.x + rowDist * rx0, fy = pose.y + rowDist * ry0;
      const base = Math.min(1, 1.7 / (1 + rowDist * 0.5)) * batt * (floorRow ? 1 : 0.7);
      for (let x = 0; x < VW; x++, fx += stepX, fy += stepY) {
        const tx = (Math.floor(fx * T) % T + T) % T, ty = (Math.floor(fy * T) % T + T) % T, ti = (ty * T + tx) * 3, i = (y * VW + x) * 4;
        // A rug down in each room.
        const deep = zone && zone[(fy | 0) * N + (fx | 0)];
        const t = deep ? (floorRow ? surf.df : surf.dc) : floorRow && rooms.length && rooms.some(([ax, ay, aw, ah]) => fx >= ax + 0.2 && fx < ax + aw - 0.2 && fy >= ay + 0.2 && fy < ay + ah - 0.2) ? surf.r : tRow;
        const l = Math.min(1.25, base * (deep ? 0.75 : 1) * (1 - Math.abs(2 * x / VW - 1) * 0.3) + bulbLight(fx, fy) * 0.55), fog = Math.max(0, Math.min(1, l)), o = litO * 0.5;
        data[i] = t[ti] * l * (1 + o * 0.5) + pal.fog[0] * (1 - fog); data[i + 1] = t[ti + 1] * l * (0.96 + o * 0.08) + pal.fog[1] * (1 - fog); data[i + 2] = t[ti + 2] * l * (0.88 - o * 0.3) + pal.fog[2] * (1 - fog); data[i + 3] = 255;
      }
    }
    // Out of the window: the sky's colour for the time of day, a tree line at
    // the bottom, and the weather -- rain streaks, snow, leaves, lightning, stars.
    const windowSky = (tx, ty, wx, x) => {
      const v = (ty - 6) / 16, c = [0, 1, 2].map(k => sky[0][k] + (sky[1][k] - sky[0][k]) * v);
      if (flash) return [235, 235, 255];
      if (ty >= 18 && (ty >= 20 || (tx * 7 + Math.floor(wx * 9)) % 3)) return day === 'night' ? [6, 10, 12] : [30, 62, 34];
      if (day === 'night' && (tx * 31 + ty * 17) % 23 === 0 && wth !== 'storm' && wth !== 'rain') return [240, 240, 210];
      const g = tx + Math.floor(wx * 4) * 5;
      if ((wth === 'rain' || wth === 'storm') && ((g + Math.floor(ty * 0.5 + tm * 30)) % 6 === 0)) return [c[0] * 0.6 + 90, c[1] * 0.6 + 100, c[2] * 0.6 + 120];
      if (wth === 'snow' && (g * 13 + Math.floor(ty - tm * 8 + Math.sin(tm + g) * 2) * 7) % 11 === 0) return [250, 250, 255];
      if (wth === 'leaves' && (g * 5 + Math.floor(ty - tm * 5) * 3 + Math.floor(tm * 3)) % 17 === 0) return [[214, 110, 30], [180, 60, 24], [230, 170, 40]][g % 3];
      return wth === 'rain' || wth === 'storm' ? c.map(v2 => v2 * 0.62) : c;
    };
    // Walls: one ray per column (DDA).
    for (let x = 0; x < VW; x++) {
      const cam = 2 * x / VW - 1, rx = dirX + planeX * cam, ry = dirY + planeY * cam;
      let mx = Math.floor(pose.x), my = Math.floor(pose.y);
      const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry), sx = rx < 0 ? -1 : 1, sy = ry < 0 ? -1 : 1;
      let sdx = rx < 0 ? (pose.x - mx) * ddx : (mx + 1 - pose.x) * ddx, sdy = ry < 0 ? (pose.y - my) * ddy : (my + 1 - pose.y) * ddy, side = 0, cell = 0;
      for (let g = 0; g < 128 && !cell; g++) { if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; } cell = map.grid[my]?.[mx] ?? 1; }
      const dist = Math.max(0.05, side ? sdy - ddy : sdx - ddx); zbuf[x] = dist;
      const h = Math.floor(VH / dist), top = Math.max(0, horizon - (h >> 1)), bot = Math.min(VH - 1, horizon + (h >> 1));
      let wx = side ? pose.x + dist * rx : pose.y + dist * ry; wx -= Math.floor(wx);
      // Flip on the walls seen from the other side, so signs read the right way.
      const flip = (!side && rx < 0) || (side && ry > 0);
      // A photo wall: the store's item, framed; without photos, the wall's own texture.
      const pic = cell >= 1000 && pics.length ? pics[Math.floor((cell - 1000) / 100) % pics.length] || null : null;
      const tw = pic ? PIC_W : T, th = pic ? PIC_H : T;
      let tx = Math.floor(wx * tw); if (flip) tx = tw - 1 - tx;
      const t = pic || textures[cell >= 1000 ? cell % 100 : cell] || textures[1];
      // Flashlight + fog: bright in the middle and close, dark at the edges and far.
      const light = Math.min(1.2, Math.max(0.1, Math.min(1, 2 / (1 + dist * 0.42)) * (1 - Math.abs(cam) * 0.35) * (side ? 0.8 : 1) * batt) + bulbLight(pose.x + dist * rx, pose.y + dist * ry) * 0.4), wo = Math.min(1, litO * 0.6);
      for (let y = top; y <= bot; y++) {
        const ty = Math.min(th - 1, Math.floor((y - horizon + (h >> 1)) * th / h)), ti = (ty * tw + tx) * 3, i = (y * VW + x) * 4;
        if (cell === 24 && t[ti] === 255 && t[ti + 1] === 0 && t[ti + 2] === 255) { const c = windowSky(tx, ty, wx, x); data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; continue; }
        data[i] = t[ti] * light * (1 + wo * 0.5) + pal.fog[0] * (1 - light); data[i + 1] = t[ti + 1] * light * (1 + wo * 0.05) + pal.fog[1] * (1 - light); data[i + 2] = t[ti + 2] * light * (1 - wo * 0.3) + pal.fog[2] * (1 - light);
      }
    }
    // Props and the boss: sprites, farthest first, hidden behind walls.
    const list = props.map(p => ({ ...p }));
    // Critters on their rounds (fixed paths and timings): rats dart along the
    // walls, bats circle in the dungeon, spiders bob on their threads.
    const R = map.layout.route, split = map.layout.split ?? DUNGEON_AT, total = map.layout.len || 1; let acc = 0;
    for (let i = 1; i < R.length; i++) {
      const [x0, y0] = R[i - 1], [x1, y1] = R[i], len = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / len, uy = (y1 - y0) / len, mid = (acc + len / 2) / total; acc += len;
      if (Math.abs((x0 + x1) / 2 - pose.x) + Math.abs((y0 + y1) / 2 - pose.y) > 16) continue;
      const cyc = (tm / 11 + i * 0.37) % 1;
      if (i % 2 && cyc < 0.35) { const f = cyc / 0.35, fwd = i % 4 === 1, a = fwd ? f : 1 - f; list.push({ x: x0 + 0.5 + ux * len * a - uy * 0.42, y: y0 + 0.5 + uy * len * a + ux * 0.42, kind: (tm * 8 | 0) % 2 ? 'rat' : 'rat2', face: Math.atan2(fwd ? uy : -uy, fwd ? ux : -ux) }); }
      if (mid > split && i % 2 === 0) { const cx = x0 + 0.5 + ux * len / 2, cy = y0 + 0.5 + uy * len / 2, a = tm * 1.3 + i; list.push({ x: cx + Math.cos(a) * 0.7, y: cy + Math.sin(tm * 1.7 + i) * 0.45, kind: (tm * 9 | 0) % 2 ? 'bat' : 'bat2', lift: (models ? 0.3 : 0.62) + Math.sin(tm * 2.3 + i) * 0.08, face: a + Math.PI / 2 }); }
      if (i % 3 === 0) list.push({ x: x0 + 0.5 - uy * 0.3, y: y0 + 0.5 + ux * 0.3, kind: 'spider', lift: (models ? 0.38 : 0.5) + Math.sin(tm * 0.8 + i) * 0.02, face: tm * 0.3 + i });
    }
    if (boss && bossPx) { const [bx, by, bw, bh] = map.layout.boss; list.push({ x: map.layout.bossAt?.[0] ?? bx + bw / 2, y: map.layout.bossAt?.[1] ?? by + bh / 2, kind: 'boss', lift: map.layout.arena ? 0.06 + Math.sin(tm * 3.2) * 0.04 : 0 }); }
    const inv = 1 / (planeX * dirY - dirX * planeY);
    list.map(s => ({ ...s, d: (s.x - pose.x) ** 2 + (s.y - pose.y) ** 2 })).sort((a, b) => b.d - a.d).forEach(s => {
      const rx = s.x - pose.x, ry = s.y - pose.y, tX = inv * (dirY * rx - dirX * ry), tY = inv * (-planeY * rx + planeX * ry);
      if (tY <= 0.15 || (CRITTERS.has(s.kind) && tY < 0.8)) return; // a critter right in your face isn't drawn huge
      // Passing in front of the hosts on the overlay right now (props in front): not drawn here too.
      if (s.kind === 'eyes' && (tm / 5 + (s.idx || 0) * 0.37) % 1 < 0.05) return; // they blink
      if (state.hideNear && s.kind !== 'boss' && s.kind !== 'eyes' && !CRITTERS.has(s.kind)) { const fwd = rx * Math.cos(pose.ang) + ry * Math.sin(pose.ang), side = -rx * Math.sin(pose.ang) + ry * Math.cos(pose.ang); if (fwd >= 0.15 && fwd <= (s.kind === 'chest' ? 3 : 1.6) && Math.abs(side) <= 1.05) return; }
      const it = s.idx != null && s.kind !== 'chest' ? itemFor(s, picKinds) : null, pd = it ? pics[it.i] : null, how = it?.how;
      // A 3D prop: the photo taken from the angle you see it from (8 around), and its frame.
      const named = s.kind === 'chest' ? (state.chests?.[s.idx] ? 'chestopen' : 'chest') : s.kind === 'lockbox' ? (state.boxes?.[s.idx] ? 'lockboxopen' : 'lockbox') : s.kind, base = named === 'rat2' ? 'rat' : named === 'bat2' ? 'bat' : named;
      const mdl = !pd && models?.[base] ? models[base] : null;
      let shot = null;
      if (mdl) { const rel = Math.atan2(pose.y - s.y, pose.x - s.x) - (s.face ?? 0), k = ((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8, fr = named === 'rat2' || named === 'bat2' ? 1 : base === 'brazier' ? (tm * 6 | 0) % 2 : 0; shot = mdl.frames[Math.min(fr, mdl.frames.length - 1)][k]; }
      const scx = Math.floor((VW / 2) * (1 + tX / tY)), size = Math.max(2, Math.floor(Math.floor(VH / tY) * (s.kind === 'boss' ? (map.layout.arena ? 1.9 : 1.5) : s.kind === 'eyes' ? 0.3 : pd ? 0.62 : shot ? (MODEL_SIZE[base] || 0.8) : (SPRITE_SIZE[s.kind] || 0.55))));
      const floorY = horizon + Math.floor(VH / tY / 2), top = (s.kind === 'eyes' ? horizon - size : floorY - size) - Math.floor((s.lift || 0) * VH / tY);
      const light = Math.max(0.15, Math.min(1, 2 / (1 + tY * 0.42)) * batt);
      for (let sx = Math.max(0, scx - (size >> 1)); sx < Math.min(VW, scx + (size >> 1)); sx++) {
        if (tY > zbuf[sx]) continue;
        const u = (sx - (scx - (size >> 1))) / size;
        for (let sy = Math.max(0, top); sy < Math.min(VH, top + size); sy++) {
          const v = (sy - top) / size; let col = null, glow = false;
          if (s.kind === 'boss') { const bxp = Math.floor(u * bossPx.w), byp = Math.floor(v * bossPx.h), bi = (byp * bossPx.w + bxp) * 4; if (bossPx.data[bi + 3] > 128) col = [bossPx.data[bi], bossPx.data[bi + 1], bossPx.data[bi + 2]]; }
          else if (pd) {
            // The store's item, by what it is: a comic leaning in the hall, a
            // sealed box on a folding table, a card in a top loader on a stand.
            const box = how === 'comic' ? [0.2, 0.8, 0.3, 1] : how === 'sealed' ? [0.16, 0.84, 0.12, 0.6] : [0.18, 0.82, 0, 0.94];
            const uu = (u - box[0]) / (box[1] - box[0]), vv = (v - box[2]) / (box[3] - box[2]);
            if (uu >= 0 && uu < 1 && vv >= 0 && vv < 1) { const ti = (Math.floor(Math.min(0.999, vv) * PIC_H) * PIC_W + Math.floor(uu * PIC_W)) * 3; col = [pd[ti], pd[ti + 1], pd[ti + 2]]; }
            else if (how === 'sealed' && v >= 0.6 && v < 0.66 && u > 0.04 && u < 0.96) col = [120, 120, 126];
            else if (how === 'sealed' && v >= 0.66 && (Math.abs(u - 0.12) < 0.03 || Math.abs(u - 0.88) < 0.03)) col = [70, 70, 76];
            else if (how === 'card' && v >= 0.94 && uu >= 0 && uu < 1) col = [60, 60, 66];
          }
          else if (shot) { const bi = (Math.min(shot.h - 1, Math.floor(v * shot.h)) * shot.w + Math.min(shot.w - 1, Math.floor(u * shot.w))) * 4; if (shot.data[bi + 3] > 110) { col = [shot.data[bi], shot.data[bi + 1], shot.data[bi + 2]]; glow = MODEL_GLOW.has(base) && shot.data[bi] > 200; } }
          else { const k0 = s.kind === 'chest' ? (state.chests?.[s.idx] ? 'chestopen' : 'chest') : s.kind === 'lockbox' ? (state.boxes?.[s.idx] ? 'lockboxopen' : 'lockbox') : s.kind === 'pic' ? 'comics' : s.kind, kind = SPRITES[k0] ? k0 : FLAT[k0] || 'comics', rows = SPRITES[kind], row = rows[Math.floor(v * 16) - (16 - rows.length)], ch = row?.[Math.floor(u * 16)]; if (ch && ch !== '.') { col = SPRITE_COLORS[kind][ch]; glow = (SPRITE_GLOW[kind] || '').includes(ch); if (ANIM[kind]) col = ANIM[kind](ch, col, u, v, tm); } }
          if (!col) continue;
          const i = (sy * VW + sx) * 4, l = glow || s.kind === 'eyes' || s.kind === 'boss' || (s.kind === 'chest' && state.chests?.[s.idx]) ? 1 : light;
          data[i] = col[0] * l; data[i + 1] = col[1] * l; data[i + 2] = col[2] * l;
        }
      }
    });
    // The air (2026-11-12: "more atmospheric ... critters, particles"): dust in
    // the light, fireflies in the garden shed, drips where it's flooded, embers
    // where it burnt, spores down below -- around you, behind the walls hidden.
    const AIR = { 'GARDEN SHED': 'firefly', 'FLOODED SHED': 'drip', 'BURNT-OUT SHED': 'ember', 'HAUNTED POTTING SHED': 'spore', 'THE SHED BENEATH THE SHED': 'spore' };
    const cx0 = Math.floor(pose.x), cy0 = Math.floor(pose.y);
    for (let gy = cy0 - 6; gy <= cy0 + 6; gy++) for (let gx = cx0 - 6; gx <= cx0 + 6; gx++) {
      if (map.grid[gy]?.[gx] !== 0) continue;
      const deepC = zone && zone[gy * N + gx];
      for (let j = 0; j < 2; j++) {
        const h = ((gx * 73856093) ^ (gy * 19349663) ^ (j * 83492791)) >>> 0, h1 = (h % 997) / 997, h2 = ((h >> 10) % 991) / 991, h3 = ((h >> 20) % 983) / 983;
        const kind = deepC ? (j ? 'drip' : 'dust') : (j ? AIR[state.shed] || 'dust' : 'dust');
        let x = gx + h1, y = gy + h2, z, col, a = 0.55, len = 1;
        if (kind === 'firefly') { if (Math.sin(tm * 2 + h3 * 20) < 0.2) continue; x += Math.sin(tm * 0.6 + h3 * 9) * 0.3; y += Math.cos(tm * 0.5 + h1 * 9) * 0.3; z = 0.3 + Math.sin(tm * 0.7 + h2 * 9) * 0.15; col = [210, 255, 120]; a = 0.95; }
        else if (kind === 'ember') { z = (h3 + tm * 0.22) % 1; x += Math.sin(tm * 1.7 + h1 * 9) * 0.12; col = [255, 140 + 80 * (1 - z), 40]; a = 0.9 * (1 - z); }
        else if (kind === 'drip') { if (h3 > 0.45) continue; z = 1 - (h3 * 3 + tm * 0.9) % 1; col = [150, 200, 255]; len = 3; a = 0.7; }
        else if (kind === 'spore') { z = (h3 + tm * 0.04) % 1; x += Math.sin(tm * 0.4 + h1 * 9) * 0.25; col = deepC ? [140, 220, 160] : [200, 150, 255]; a = 0.7; }
        else { z = 0.2 + ((h3 + tm * 0.015) % 1) * 0.7; x += Math.sin(tm * 0.3 + h3 * 6) * 0.2; y += Math.cos(tm * 0.27 + h2 * 6) * 0.2; col = deepC ? [150, 160, 140] : [235, 225, 195]; a = 0.35; }
        const rx = x - pose.x, ry = y - pose.y, tX = inv * (dirY * rx - dirX * ry), tY = inv * (-planeY * rx + planeX * ry);
        if (tY <= 0.25 || tY > 7) continue;
        const sx = Math.floor((VW / 2) * (1 + tX / tY)), sy = horizon + Math.floor((0.5 - z) * VH / tY);
        if (sx < 0 || sx >= VW || tY > zbuf[sx]) continue;
        const k = a * Math.min(1, 1.6 - tY * 0.2), w = tY < 1.5 ? 2 : 1;
        for (let yy = sy; yy < sy + len * w; yy++) for (let xx = sx; xx < sx + w; xx++) { if (xx >= VW || yy < 0 || yy >= VH) continue; const i = (yy * VW + xx) * 4; data[i] += (col[0] - data[i]) * k; data[i + 1] += (col[1] - data[i + 1]) * k; data[i + 2] += (col[2] - data[i + 2]) * k; }
      }
    }
    // Sparkles circling each shut chest, and a gold arrow bobbing over it once it's close.
    for (const pr of props) {
      if (pr.kind !== 'chest' || state.chests?.[pr.idx]) continue;
      const crx = pr.x - pose.x, cry = pr.y - pose.y, cTY = inv * (-planeY * crx + planeX * cry);
      if (cTY <= 0.4 || cTY > 9) continue;
      const put = (x, y, z, col, w) => { const rx = x - pose.x, ry = y - pose.y, tX = inv * (dirY * rx - dirX * ry), tY = inv * (-planeY * rx + planeX * ry); if (tY <= 0.3) return; const sx = Math.floor((VW / 2) * (1 + tX / tY)), sy = horizon + Math.floor((0.5 - z) * VH / tY); for (let yy = sy; yy < sy + w; yy++) for (let xx = sx; xx < sx + w; xx++) { if (xx < 0 || xx >= VW || yy < 0 || yy >= VH || tY > zbuf[xx] + 0.2) continue; const i = (yy * VW + xx) * 4; data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; } };
      for (let k = 0; k < 6; k++) { const a = tm * 1.4 + k * 1.05, tw = Math.sin(tm * 5 + k * 2.3); if (tw < -0.2) continue; put(pr.x + Math.cos(a) * 0.32, pr.y + Math.sin(a) * 0.32, 0.12 + ((tm * 0.35 + k / 6) % 1) * 0.5, tw > 0.7 ? [255, 255, 230] : [255, 214, 70], cTY < 2.5 ? 2 : 1); }
      // A loot beam: a column of gold light from the chest up to the ceiling, pulsing -- seen from far down the hall.
      { const rx = pr.x - pose.x, ry = pr.y - pose.y, tX = inv * (dirY * rx - dirX * ry), cx = Math.floor((VW / 2) * (1 + tX / cTY)), half = Math.max(2, Math.floor(VH / cTY * 0.16)), ceil = 0, // up through the ceiling: a marker, not a lamp
           floorY = horizon + Math.floor(VH / cTY * 0.5), pulse = 0.5 + 0.15 * Math.sin(tm * 3);
        for (let X = cx - half; X <= cx + half; X++) { if (X < 0 || X >= VW || cTY > zbuf[X] + 0.2) continue; const edge = 1 - Math.abs(X - cx) / (half + 1);
          for (let Y = Math.max(0, ceil); Y < Math.min(VH, floorY - Math.floor(VH / cTY * 0.3)); Y++) { const a = pulse * Math.sqrt(edge) * (0.45 + 0.55 * (Y - ceil) / Math.max(1, floorY - ceil)), i = (Y * VW + X) * 4; data[i] += (255 - data[i]) * a; data[i + 1] += (222 - data[i + 1]) * a; data[i + 2] += (110 - data[i + 2]) * a; } } }
      if (cTY < 7) { const z = 0.8 + Math.abs(Math.sin(tm * 3)) * 0.1, px = Math.max(3, Math.round(6 / cTY));
        // A small down arrow, 5 wide and 4 tall, in pixels of px.
        const rx = pr.x - pose.x, ry = pr.y - pose.y, tX = inv * (dirY * rx - dirX * ry), sx0 = Math.floor((VW / 2) * (1 + tX / cTY)), sy0 = horizon + Math.floor((0.5 - z) * VH / cTY);
        ['#####', '.###.', '..#..'].forEach((row, ry2) => [...row].forEach((c, rx2) => { if (c !== '#') return; for (let yy = 0; yy < px; yy++) for (let xx = 0; xx < px; xx++) { const X = sx0 + (rx2 - 2) * px + xx, Y = sy0 + ry2 * px + yy; if (X < 0 || X >= VW || Y < 0 || Y >= VH || cTY > zbuf[X] + 0.2) continue; const i = (Y * VW + X) * 4; data[i] = 255; data[i + 1] = 210 + 40 * Math.sin(tm * 6); data[i + 2] = 60; } })); }
    }
    // Moths around the bulbs.
    for (let k = 0; k < near.length; k++) { const b = near[k]; if (b.torch || b.win) continue;
      for (let m = 0; m < 3; m++) { const a = tm * (2.4 + m * 0.7) + m * 2.1 + k, x = b.x + Math.cos(a) * 0.28, y = b.y + Math.sin(a * 1.3) * 0.28, z = 0.86 + Math.sin(a * 2) * 0.05;
        const rx = x - pose.x, ry = y - pose.y, tX = inv * (dirY * rx - dirX * ry), tY = inv * (-planeY * rx + planeX * ry); if (tY <= 0.25) continue;
        const sx = Math.floor((VW / 2) * (1 + tX / tY)), sy = horizon + Math.floor((0.5 - z) * VH / tY); if (sx < 0 || sx >= VW || sy < 0 || sy >= VH || tY > zbuf[sx]) continue;
        const i = (sy * VW + sx) * 4; data[i] = 225; data[i + 1] = 215; data[i + 2] = 190; } }
    // In through the open windows (we're inside): snow or leaves blowing in,
    // dust floating in the sunbeam; rain stays out -- drips off the sill.
    for (const b of near) {
      if (!b.win) continue;
      for (let m = 0; m < 6; m++) {
        const rain = wth === 'rain' || wth === 'storm'; if (rain && m > 1) break;
        if (!rain && wth === 'clear' && day !== 'morning' && day !== 'day') break;
        const ph = (tm * (rain ? 0.9 : wth === 'leaves' ? 0.3 : 0.18) + m / 6) % 1, sw = Math.sin(tm * 1.7 + m * 2.3) * 0.18;
        const x = b.x + b.nx * (rain ? 0.05 : ph * 1.6) + (b.ny ? sw : 0) - b.nx * 0.3, y = b.y + b.ny * (rain ? 0.05 : ph * 1.6) + (b.nx ? sw : 0) - b.ny * 0.3;
        const z = rain ? 0.22 - ph * 0.22 : wth === 'clear' ? 0.45 + Math.sin(tm * 0.7 + m) * 0.15 : 0.62 - ph * 0.6;
        const col = rain ? [150, 175, 210] : wth === 'snow' ? [240, 244, 255] : wth === 'leaves' ? [[206, 110, 30], [170, 60, 22], [226, 168, 40]][m % 3] : [255, 236, 170];
        const rx = x - pose.x, ry = y - pose.y, tX = inv * (dirY * rx - dirX * ry), tY = inv * (-planeY * rx + planeX * ry); if (tY <= 0.25) continue;
        const sx = Math.floor((VW / 2) * (1 + tX / tY)), sy = horizon + Math.floor((0.5 - z) * VH / tY), w = tY < 2 ? 2 : 1;
        for (let yy = sy; yy < sy + w; yy++) for (let xx = sx; xx < sx + w; xx++) { if (xx < 0 || xx >= VW || yy < 0 || yy >= VH || tY > zbuf[xx]) continue; const i = (yy * VW + xx) * 4; data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; }
      }
    }
    // The shed's light by the time of day: warm at sunset, dark and blue at
    // night (the bulbs and the flashlight carry it). Down in the dungeon it's always night.
    const shedK = 1 - fogMix;
    if (shedK > 0.02 && (day === 'sunset' || day === 'night')) { const m = day === 'sunset' ? [1.1, 0.9, 0.72] : [0.52, 0.58, 0.82]; for (let i = 0; i < data.length; i += 4) { data[i] *= 1 + (m[0] - 1) * shedK; data[i + 1] *= 1 + (m[1] - 1) * shedK; data[i + 2] *= 1 + (m[2] - 1) * shedK; } }
    // A boss up: the room flushes red.
    if (boss) for (let i = 0; i < data.length; i += 4) data[i] = Math.min(255, data[i] * 1.18 + 10);
    // The bulbs themselves: little glowing dots up in the rafters.
    for (const b of near) {
      if (b.torch || b.win) continue; // a torch's flame is on its wall; a window is daylight
      const rx = b.x - pose.x, ry = b.y - pose.y, tX = inv * (dirY * rx - dirX * ry), tY = inv * (-planeY * rx + planeX * ry);
      if (tY <= 0.2) continue;
      const sx = Math.floor((VW / 2) * (1 + tX / tY)), sy = horizon - Math.floor(VH / tY * 0.42), r = Math.max(1, Math.floor(3 / tY));
      if (sx < 0 || sx >= VW || tY > zbuf[sx]) continue;
      const g = Math.min(1, b.f + 0.1);
      for (let yy = sy - r; yy <= sy + r; yy++) for (let xx = sx - r; xx <= sx + r; xx++) { if (xx < 0 || yy < 0 || xx >= VW || yy >= VH || (xx - sx) ** 2 + (yy - sy) ** 2 > r * r) continue; const i = (yy * VW + xx) * 4; data[i] = 255 * g; data[i + 1] = 236 * g; data[i + 2] = 170 * g; }
    }
    // No dither (store, 2026-11-11: "the graphics need to not have that
    // texture on them -- can't tell what they are"): clean colours, so the
    // items on the walls read on camera.
    tick++;
    ctx.putImageData(img, 0, 0);
  }
  return {
    set, setBoss, onPeek: fn => { listeners.peek = fn; },
    // The 3D props' photos (scripts/prop-models.mjs bakeProps); null keeps the flat sprites.
    setModels(m) { models = m || null; },
    // Where the camera's looking right now (the props in front follow the hall, not the screen).
    view() { return { look, pitch: pitchNow, scout: scoutNow, fov: FOV }; },
    // The host's joystick: { yaw, pitch } (-1..1) to look; { action: 'scout' | 'back' }.
    setCamera(c = {}) { const now = performance.now(); if (c.action === 'scout') scoutAt = now; else if (c.action === 'back') backAt = now; else manual = { yaw: Math.max(-1, Math.min(1, Number(c.yaw) || 0)), pitch: Math.max(-1, Math.min(1, Number(c.pitch) || 0)), at: now }; },
    // The store's item photos for the walls (from loadPicture).
    // Order kept (a photo that didn't load is a gap), so the overlay's items match.
    setPictures(list, kinds = []) { pics = (list || []).slice(0, 24); picKinds = kinds.slice(0, pics.length); while (picKinds.length < pics.length) picKinds.push('card'); },
    start() { if (!raf) raf = requestAnimationFrame(frame); },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    // For tests: where the walker is.
    peekState: () => ({ shown, target, peeking: Date.now() < peekUntil, label: peek?.label || '' }),
    drawNow: draw,
  };
}
