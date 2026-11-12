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

// ── Layouts: routes through a 16 x 16 grid. Walls are carved around them. ──
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
const seeded = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export function generateLayout(floor) {
  const N = 16, lo = 2, hi = 13;
  for (let attempt = 0; attempt < 60; attempt++) {
    const rnd = seeded(floor * 7919 + 101 + attempt * 31), used = new Set(), key = (x, y) => x + ',' + y;
    const corners = [[2, 13], [13, 13], [2, 2], [13, 2]];
    let [x, y] = corners[(floor - 1) % 4]; const route = [[x, y]]; used.add(key(x, y));
    let horiz = rnd() < 0.5, ok = true;
    const segs = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < segs && ok; i++) {
      let placed = false;
      for (const sign of rnd() < 0.5 ? [1, -1] : [-1, 1]) {
        const len = 4 + Math.floor(rnd() * 5), nx = horiz ? x + sign * len : x, ny = horiz ? y : y + sign * len;
        if (nx < lo || nx > hi || ny < lo || ny > hi) continue;
        const cells = []; let clear = true;
        for (let k = 1; k <= len; k++) { const cx = horiz ? x + sign * k : x, cy = horiz ? y : y + sign * k; if (used.has(key(cx, cy)) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => used.has(key(cx + dx, cy + dy)) && !(cx + dx === x && cy + dy === y) && k === 1 ? false : used.has(key(cx + dx, cy + dy)) && k > 1)) { clear = false; break; } cells.push([cx, cy]); }
        if (!clear) continue;
        cells.forEach(([cx, cy]) => used.add(key(cx, cy))); x = nx; y = ny; route.push([x, y]); placed = true; break;
      }
      if (!placed) ok = i >= 4;
      if (!placed) break;
      horiz = !horiz;
    }
    if (!ok || route.length < 5) continue;
    // The boss room: 3 x 2 past the end of the hall, inside the walls.
    const [ex, ey] = route[route.length - 1], [px, py] = route[route.length - 2];
    const dx = Math.sign(ex - px), dy = Math.sign(ey - py);
    const boss = dx ? [Math.max(1, Math.min(N - 4, dx > 0 ? ex + 1 : ex - 3)), Math.max(1, Math.min(N - 3, ey - 1)), 3, 2] : [Math.max(1, Math.min(N - 4, ex - 1)), Math.max(1, Math.min(N - 3, dy > 0 ? ey + 1 : ey - 2)), 3, 2];
    if (boss[0] < 1 || boss[1] < 1 || boss[0] + boss[2] > N - 1 || boss[1] + boss[3] > N - 1) continue;
    const L = { route, boss, peeks: [], rooms: [] };
    // Two rummaging spots: a cell beside the hall, about a third and two thirds in.
    const picks = [PEEK_POOL[floor % 6], PEEK_POOL[(floor + 3) % 6]];
    for (const [j, at] of [[0, 0.3], [1, 0.64]]) {
      const pose = poseAt(L, at), cx = Math.floor(pose.x), cy = Math.floor(pose.y), side = j ? -1 : 1;
      const sx = Math.round(-Math.sin(pose.ang)) * side, sy = Math.round(Math.cos(pose.ang)) * side;
      const cell = [cx + sx, cy + sy];
      if (cell[0] < 1 || cell[1] < 1 || cell[0] > N - 2 || cell[1] > N - 2 || used.has(key(...cell))) continue;
      L.peeks.push({ at, cell, ...picks[j] });
    }
    if (L.peeks.length < 2) continue;
    // Rooms (store, 2026-11-12: "more variation, make the rooms better, other
    // random cool shit in there"): two or three, 3 to 4 cells a side, each with
    // a theme -- the arcade corner, the TV room, the poster room, the stock
    // room, the neon room, the garage, the lounge.
    const nRooms = 2 + (rnd() < 0.5 ? 1 : 0), usedCorners = new Set();
    for (let j = 0; j < nRooms * 3 && L.rooms.length < nRooms; j++) {
      const ci = 1 + Math.floor(rnd() * (route.length - 2)); if (usedCorners.has(ci)) continue;
      const r = route[ci], w = 3 + (rnd() < 0.5 ? 1 : 0), h = 3 + (rnd() < 0.5 ? 1 : 0);
      const x0 = Math.max(1, Math.min(N - 1 - w, r[0] - 1 - (w > 3 && rnd() < 0.5 ? 1 : 0)));
      const y0 = Math.max(1, Math.min(N - 1 - h, r[1] - 1 - (h > 3 && rnd() < 0.5 ? 1 : 0)));
      const [bx0, by0, bw0, bh0] = boss;
      if (x0 < bx0 + bw0 + 1 && x0 + w > bx0 - 1 && y0 < by0 + bh0 + 1 && y0 + h > by0 - 1) continue;
      usedCorners.add(ci);
      L.rooms.push([x0, y0, w, h, (floor * 3 + L.rooms.length * 2) % ROOM_THEMES.length]); // never the same theme twice on a floor
    }
    // Alcoves: a nook off the hall with a vending machine or a shelf of sealed.
    L.nooks = [];
    for (const [at, side, tex] of [[0.14, -1, 10], [0.5, 1, 13], [0.86, -1, 10]]) {
      const pose = poseAt(L, at), cx = Math.floor(pose.x), cy = Math.floor(pose.y);
      const cell = [cx + Math.round(-Math.sin(pose.ang)) * side, cy + Math.round(Math.cos(pose.ang)) * side];
      if (cell[0] < 1 || cell[1] < 1 || cell[0] > N - 2 || cell[1] > N - 2 || used.has(key(...cell)) || L.peeks.some(pk => pk.cell[0] === cell[0] && pk.cell[1] === cell[1])) continue;
      L.nooks.push({ cell, tex });
    }
    return L;
  }
  return LAYOUTS[(Math.max(1, floor) - 1) % LAYOUTS.length];
}
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
];
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
      else if (kind === 'rafters') { c = [34, 26, 20]; if ((x & 15) < 4) c = [92, 62, 38]; if ((x & 15) === 3) c = [50, 32, 20]; }
      else if (kind === 'tin') { c = (x >> 1) % 2 ? [92, 96, 104] : [70, 74, 80]; if ((x * 3 + y) % 29 === 0) c = [130, 74, 40]; }
      else if (kind === 'tarp') { c = [40, 70, 130]; if ((x + y) % 11 === 0) c = [30, 54, 104]; }
      else { c = [170, 166, 150]; if ((x & 15) === 0 || (y & 15) === 0) c = [96, 94, 86]; if (Math.hypot(x - 22, y - 9) < 3) c = [140, 120, 70]; }
      const k = noise(x, y, kind.length, 18);
      px(x, y, [c[0] + k, c[1] + k, c[2] + k]);
    }
  });
}
// Bare bulbs hanging over the hall (warm light pools), every few cells along it.
function bulbsFor(layout) { const out = []; for (let t = 0.08; t < 1; t += 0.17) { const p = poseAt(layout, t); out.push([p.x, p.y]); } for (const [rx, ry, rw, rh] of layout.rooms || []) out.push([rx + rw / 2, ry + rh / 2]); return out; }
// PS1-style color: a 4 x 4 ordered dither, then 5 bits per channel.

export const layoutFor = floor => { const f = Math.max(1, Math.floor(floor) || 1); if (!layoutCache.has(f)) layoutCache.set(f, generateLayout(f)); return layoutCache.get(f); };

// The grid: everything wall (1..5 = texture) except the route, the peek
// cells and the boss room. Wall textures follow a fixed pattern.
export function buildMap(floor, fork = '') {
  const L = layoutFor(floor), N = 16, grid = Array.from({ length: N }, () => Array(N).fill(1));
  const open = (x, y) => { if (x > 0 && y > 0 && x < N - 1 && y < N - 1) grid[y][x] = 0; };
  for (let i = 1; i < L.route.length; i++) {
    const [x0, y0] = L.route[i - 1], [x1, y1] = L.route[i];
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) open(x, y);
  }
  const [bx, by, bw, bh] = L.boss;
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) open(x, y);
  for (const p of L.peeks) open(...p.cell);
  for (const [rx, ry, rw, rh] of L.rooms || []) for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) open(x, y);
  for (const nk of L.nooks || []) open(...nk.cell);
  // Textures on a fixed pattern: duct-taped boards (1), booster pegboard (2),
  // long-box shelves (3), the comic rack (4), the slab wall (6), the flyer
  // corkboard (7), binder pages (8); each peek looks at its own; the boss room is 5.
  // Chat's pick at the fork changes the shed: LEFT is the collector side
  // (slabs, binders, racks), RIGHT the bargain side (long boxes, bins, packs).
  const PATTERN = fork === 'left' ? [6, 8, 4, 6, 1, 8, 4, 6, 1, 8, 6, 4] : fork === 'right' ? [3, 1, 2, 3, 7, 1, 3, 2, 1, 3, 7, 2] : [1, 4, 2, 1, 3, 6, 1, 7, 8, 1, 4, 3];
  // Each shed mixes its own extras into the walls (posters, garage doors, TVs, neon...).
  const EXTRA = [[12, 15], [15, 13], [12, 11], [12, 14], [16, 15], [15, 12], [14, 9]][(Math.max(1, floor) - 1) % 7];
  const pat = PATTERN.slice(); pat[floor % 12] = EXTRA[0]; pat[(floor + 6) % 12] = EXTRA[1];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (grid[y][x]) grid[y][x] = pat[(x * 3 + y * 5 + floor) % 12];
  // A themed room's walls all around it.
  for (const [rx, ry, rw, rh, th] of L.rooms || []) { const tx = ROOM_THEMES[th ?? 0]?.tex; if (tx) for (let y = ry - 1; y <= ry + rh; y++) for (let x = rx - 1; x <= rx + rw; x++) if (grid[y]?.[x]) grid[y][x] = tx; }
  for (const nk of L.nooks || []) { const [cx, cy] = nk.cell; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (grid[cy + dy]?.[cx + dx]) grid[cy + dy][cx + dx] = nk.tex; }
  for (const p of L.peeks) { const [cx, cy] = p.cell; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (grid[cy + dy]?.[cx + dx]) grid[cy + dy][cx + dx] = p.tex; }
  for (let y = by - 1; y <= by + bh; y++) for (let x = bx - 1; x <= bx + bw; x++) if (grid[y]?.[x]) grid[y][x] = 5;
  // Walls that face the walk and are racks or slab walls become frames for
  // the store's own item photos (1000 + n*100 + the wall's own texture, which
  // shows when there are no photos).
  let n = 0;
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if ((grid[y][x] === 4 || grid[y][x] === 6 || (grid[y][x] === 12 && (x + y) % 2 === 0) || (grid[y][x] === 1 && (x * 7 + y * 3 + floor) % 3 === 0)) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy][x + dx] === 0)) grid[y][x] = 1000 + (n++) * 100 + grid[y][x];
  return { grid, layout: L };
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
  cat: ['...k...k........', '...kk.kk........', '...kkkkk........', '...kykyk........', '...kkkkk........', '....kkk.........', '...kkkkkk.......', '..kkkkkkkk...k..', '..kkkkkkkk..k...', '..kkkkkkkkkk....'],
  // Treasure chests: shut, and open once chat hits its goal.
  chest: ['..aaaaaaaaaaaa..', '.abbbbbbbbbbbba.', '.abccccccccccba.', '.aaaaaayyaaaaaa.', '.abbbbbyybbbbba.', '.abbbbbbbbbbbba.', '.abccccccccccba.', '.aaaaaaaaaaaaaa.'],
  chestopen: ['.aaaaaaaaaaaaaa.', '.abbbbbbbbbbbba.', '.aaaaaaaaaaaaaa.', '..dd.d..d.dd.d..', '.agggggggggggga.', '.agygygygygygya.', '.abbbbbbbbbbbba.', '.abccccccccccba.', '.aaaaaaaaaaaaaa.'],
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
  chest: { a: [30, 18, 8], b: [140, 82, 36], c: [230, 180, 40], y: [255, 220, 60] },
  chestopen: { a: [30, 18, 8], b: [140, 82, 36], c: [230, 180, 40], y: [255, 250, 200], g: [255, 210, 40], d: [255, 250, 160] },
};
// What glows in the dark (screens, flames, crystals, eyes) and how big each prop stands.
const SPRITE_GLOW = { arcade: 'msw', tv: 'sz', barrel: 'fy', crystal: 'cd', lavalamp: 'gl', candles: 'f', raccoon: 'w', cat: 'y' };
const SPRITE_SIZE = { arcade: 0.95, fridge: 0.7, skeleton: 0.85, tv: 0.6, gumball: 0.6, lavalamp: 0.5, duck: 0.3, candles: 0.4, cone: 0.45, mower: 0.55, gnome: 0.5, crystal: 0.6, barrel: 0.6, trashcan: 0.6, raccoon: 0.45, cat: 0.4 };
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
  let themeN = 0, coolN = floor; // each in turn, so every one of them shows up
  const pick = k => k === 'THEME' ? theme[themeN++ % theme.length] : k === 'COOL' ? cool[coolN++ % cool.length] : k;
  for (let i = 1; i < layout.route.length; i++) {
    const [x0, y0] = layout.route[i - 1], [x1, y1] = layout.route[i], n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 2.5));
    for (let k = 1; k <= n; k++) {
      const f = k / (n + 1), side = (i + k) % 2 ? 0.32 : -0.32, dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      const kind = pick(kinds[(i * 3 + k + floor) % kinds.length]);
      out.push({ x: x0 + 0.5 + dx * f + (-dy / len) * side, y: y0 + 0.5 + dy * f + (dx / len) * side, kind, idx: picN++ });
    }
  }
  // Each room's own things, in its corners.
  for (const [rx, ry, rw, rh, th] of layout.rooms || []) {
    const things = ROOM_THEMES[th ?? 0]?.props || [];
    [[rx + 0.5, ry + 0.5], [rx + rw - 0.5, ry + rh - 0.5], [rx + rw - 0.5, ry + 0.5]].forEach(([x, y], j) => { if (things[j]) out.push({ x, y, kind: things[j], idx: picN++ }); });
  }
  // Three treasure chests along the way (chat's goals open them).
  for (const [k, t] of [[0, 0.16], [1, 0.47], [2, 0.8]]) { const p = poseAt(layout, t), side = k % 2 ? 0.34 : -0.34; out.push({ x: p.x - Math.sin(p.ang) * side, y: p.y + Math.cos(p.ang) * side, kind: 'chest', idx: k }); }
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
  let pics = [], picKinds = [], surf = null, bulbs = [], tick = 0;
  let state = { floor: 1, shed: 'GARDEN SHED', pct: 0, phase: 'floor', battery: 1, fork: '' }, map = buildMap(1), textures = makeTextures(PALETTES['GARDEN SHED']), props = propsFor(map.layout, 1);
  let first = true, shown = 0, target = 0, look = 0, peek = null, peekUntil = 0, done = new Set(), bossPx = null, raf = 0, last = 0, bob = 0, walking = false;
  const listeners = { peek: () => {} };
  function setBoss(sourceCanvas) {
    if (!sourceCanvas) { bossPx = null; return; }
    const c = sourceCanvas.getContext('2d'), d = c.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    bossPx = { w: sourceCanvas.width, h: sourceCanvas.height, data: d.data };
  }
  function set(next) {
    const floorChanged = first || next.floor !== state.floor || next.shed !== state.shed; first = false;
    const forkChanged = (next.fork || '') !== (state.fork || '');
    state = { ...state, ...next };
    if (forkChanged && !floorChanged) map = buildMap(state.floor, state.fork || '');
    if (floorChanged) { surf = { f: surfaceTex((SURFACES[state.shed] || SURFACES['GARDEN SHED']).f), c: surfaceTex((SURFACES[state.shed] || SURFACES['GARDEN SHED']).c), r: surfaceTex((SURFACES[state.shed] || {}).f === 'carpet' ? 'planks' : 'carpet') }; bulbs = bulbsFor(layoutFor(state.floor)); }
    if (floorChanged) { map = buildMap(state.floor, state.fork || ''); textures = makeTextures(PALETTES[state.shed] || PALETTES['GARDEN SHED']); props = propsFor(map.layout, state.floor); shown = 0; done = new Set(); }
    target = state.phase === 'boss' ? 1 : Math.max(0, Math.min(1, state.pct / 100));
    if (floorChanged) shown = target;
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < 50) return; // ~20 fps is plenty for chunky pixels
    const dt = Math.min(0.2, (now - (last || now)) / 1000); last = now;
    // Walk toward the floor's progress; stop to rummage at the peek spots.
    if (Date.now() < peekUntil) { look += (peek.turn - look) * Math.min(1, dt * 4); walking = false; }
    else {
      look += (0 - look) * Math.min(1, dt * 4);
      walking = shown < target - 0.002;
      if (walking) {
        const step = Math.min(target - shown, dt * 0.06);
        const hit = map.layout.peeks.find(p => !done.has(p.at) && shown < p.at && shown + step >= p.at);
        if (hit) { done.add(hit.at); shown = hit.at; const pose = poseAt(map.layout, shown); let turn = Math.atan2(hit.cell[1] + 0.5 - pose.y, hit.cell[0] + 0.5 - pose.x) - pose.ang; while (turn > Math.PI) turn -= 2 * Math.PI; while (turn < -Math.PI) turn += 2 * Math.PI; peek = { ...hit, turn }; peekUntil = Date.now() + 2600; listeners.peek(hit.label); }
        else shown += step;
      } else if (shown > target) shown = target;
    }
    bob = walking ? bob + dt * 9 : bob * 0.9;
    draw();
  }
  function draw() {
    // The eye sits a little behind the walker (when there's room), so the view looks down the hall, not into the wall.
    const pose = eyePose(map.layout, map.grid, shown), ang = pose.ang + look, fov = FOV, batt = 0.25 + 0.75 * Math.max(0, Math.min(1, state.battery ?? 1));
    const dirX = Math.cos(ang), dirY = Math.sin(ang), planeX = -dirY * fov, planeY = dirX * fov;
    const pal = PALETTES[state.shed] || PALETTES['GARDEN SHED'], data = img.data, horizon = (VH >> 1) + Math.round(Math.sin(bob) * 1.5);
    const boss = state.phase === 'boss', rooms = map.layout.rooms || [];
    // Floor and ceiling, textured (floor casting): each row is a distance;
    // lit by the flashlight and the bulbs, fading into the shed's fog.
    const bulbLight = (wx, wy) => { let l = 0; for (const [bx, by] of bulbs) { const d2 = (wx - bx) ** 2 + (wy - by) ** 2; l += 0.9 / (1 + d2 * 1.6); } return l; };
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
        const t = floorRow && rooms.length && rooms.some(([ax, ay, aw, ah]) => fx >= ax + 0.2 && fx < ax + aw - 0.2 && fy >= ay + 0.2 && fy < ay + ah - 0.2) ? surf.r : tRow;
        const l = Math.min(1.25, base * (1 - Math.abs(2 * x / VW - 1) * 0.3) + bulbLight(fx, fy) * 0.55), fog = Math.max(0, Math.min(1, l));
        data[i] = t[ti] * l * 1 + pal.fog[0] * (1 - fog); data[i + 1] = t[ti + 1] * l * 0.96 + pal.fog[1] * (1 - fog); data[i + 2] = t[ti + 2] * l * 0.88 + pal.fog[2] * (1 - fog); data[i + 3] = 255;
      }
    }
    // Walls: one ray per column (DDA).
    for (let x = 0; x < VW; x++) {
      const cam = 2 * x / VW - 1, rx = dirX + planeX * cam, ry = dirY + planeY * cam;
      let mx = Math.floor(pose.x), my = Math.floor(pose.y);
      const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry), sx = rx < 0 ? -1 : 1, sy = ry < 0 ? -1 : 1;
      let sdx = rx < 0 ? (pose.x - mx) * ddx : (mx + 1 - pose.x) * ddx, sdy = ry < 0 ? (pose.y - my) * ddy : (my + 1 - pose.y) * ddy, side = 0, cell = 0;
      for (let g = 0; g < 64 && !cell; g++) { if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; } cell = map.grid[my]?.[mx] ?? 1; }
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
      const light = Math.min(1.2, Math.max(0.1, Math.min(1, 2 / (1 + dist * 0.42)) * (1 - Math.abs(cam) * 0.35) * (side ? 0.8 : 1) * batt) + bulbLight(pose.x + dist * rx, pose.y + dist * ry) * 0.4);
      for (let y = top; y <= bot; y++) {
        const ty = Math.min(th - 1, Math.floor((y - horizon + (h >> 1)) * th / h)), ti = (ty * tw + tx) * 3, i = (y * VW + x) * 4;
        data[i] = t[ti] * light + pal.fog[0] * (1 - light); data[i + 1] = t[ti + 1] * light + pal.fog[1] * (1 - light); data[i + 2] = t[ti + 2] * light + pal.fog[2] * (1 - light);
      }
    }
    // Props and the boss: sprites, farthest first, hidden behind walls.
    const list = props.map(p => ({ ...p })); if (boss && bossPx) { const [bx, by, bw, bh] = map.layout.boss; list.push({ x: bx + bw / 2, y: by + bh / 2, kind: 'boss' }); }
    const inv = 1 / (planeX * dirY - dirX * planeY);
    list.map(s => ({ ...s, d: (s.x - pose.x) ** 2 + (s.y - pose.y) ** 2 })).sort((a, b) => b.d - a.d).forEach(s => {
      const rx = s.x - pose.x, ry = s.y - pose.y, tX = inv * (dirY * rx - dirX * ry), tY = inv * (-planeY * rx + planeX * ry);
      if (tY <= 0.15) return;
      // Passing in front of the hosts on the overlay right now (props in front): not drawn here too.
      if (state.hideNear && s.kind !== 'boss' && s.kind !== 'eyes') { const fwd = rx * Math.cos(pose.ang) + ry * Math.sin(pose.ang), side = -rx * Math.sin(pose.ang) + ry * Math.cos(pose.ang); if (fwd >= 0.15 && fwd <= 1.6 && Math.abs(side) <= 1.05) return; }
      const it = s.idx != null && s.kind !== 'chest' ? itemFor(s, picKinds) : null, pd = it ? pics[it.i] : null, how = it?.how;
      const scx = Math.floor((VW / 2) * (1 + tX / tY)), size = Math.max(2, Math.floor(Math.floor(VH / tY) * (s.kind === 'boss' ? 1.5 : s.kind === 'eyes' ? 0.3 : pd ? 0.62 : (SPRITE_SIZE[s.kind] || 0.55))));
      const floorY = horizon + Math.floor(VH / tY / 2), top = s.kind === 'eyes' ? horizon - size : floorY - size;
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
          else { const kind = s.kind === 'chest' ? (state.chests?.[s.idx] ? 'chestopen' : 'chest') : s.kind === 'pic' ? 'comics' : s.kind, rows = SPRITES[kind], row = rows[Math.floor(v * 16) - (16 - rows.length)], ch = row?.[Math.floor(u * 16)]; if (ch && ch !== '.') { col = SPRITE_COLORS[kind][ch]; glow = (SPRITE_GLOW[kind] || '').includes(ch); } }
          if (!col) continue;
          const i = (sy * VW + sx) * 4, l = glow || s.kind === 'eyes' || s.kind === 'boss' || (s.kind === 'chest' && state.chests?.[s.idx]) ? 1 : light;
          data[i] = col[0] * l; data[i + 1] = col[1] * l; data[i + 2] = col[2] * l;
        }
      }
    });
    // A boss up: the room flushes red.
    if (boss) for (let i = 0; i < data.length; i += 4) data[i] = Math.min(255, data[i] * 1.18 + 10);
    // The bulbs themselves: little glowing dots up in the rafters.
    for (const [bx, by] of bulbs) {
      const rx = bx - pose.x, ry = by - pose.y, tX = inv * (dirY * rx - dirX * ry), tY = inv * (-planeY * rx + planeX * ry);
      if (tY <= 0.2) continue;
      const sx = Math.floor((VW / 2) * (1 + tX / tY)), sy = horizon - Math.floor(VH / tY * 0.42), r = Math.max(1, Math.floor(3 / tY));
      if (sx < 0 || sx >= VW || tY > zbuf[sx]) continue;
      for (let yy = sy - r; yy <= sy + r; yy++) for (let xx = sx - r; xx <= sx + r; xx++) { if (xx < 0 || yy < 0 || xx >= VW || yy >= VH || (xx - sx) ** 2 + (yy - sy) ** 2 > r * r) continue; const i = (yy * VW + xx) * 4; data[i] = 255; data[i + 1] = 236; data[i + 2] = 170; }
    }
    // No dither (store, 2026-11-11: "the graphics need to not have that
    // texture on them -- can't tell what they are"): clean colours, so the
    // items on the walls read on camera.
    tick++;
    ctx.putImageData(img, 0, 0);
  }
  return {
    set, setBoss, onPeek: fn => { listeners.peek = fn; },
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
