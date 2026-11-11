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
export const layoutFor = floor => LAYOUTS[(Math.max(1, floor) - 1) % LAYOUTS.length];

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
  // Textures on a fixed pattern: duct-taped boards (1), booster pegboard (2),
  // long-box shelves (3), the comic rack (4), the slab wall (6), the flyer
  // corkboard (7), binder pages (8); each peek looks at its own; the boss room is 5.
  // Chat's pick at the fork changes the shed: LEFT is the collector side
  // (slabs, binders, racks), RIGHT the bargain side (long boxes, bins, packs).
  const PATTERN = fork === 'left' ? [6, 8, 4, 6, 1, 8, 4, 6, 1, 8, 6, 4] : fork === 'right' ? [3, 1, 2, 3, 7, 1, 3, 2, 1, 3, 7, 2] : [1, 4, 2, 1, 3, 6, 1, 7, 8, 1, 4, 3];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (grid[y][x]) grid[y][x] = PATTERN[(x * 3 + y * 5 + floor) % 12];
  for (const p of L.peeks) { const [cx, cy] = p.cell; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (grid[cy + dy]?.[cx + dx]) grid[cy + dy][cx + dx] = p.tex; }
  for (let y = by - 1; y <= by + bh; y++) for (let x = bx - 1; x <= bx + bw; x++) if (grid[y]?.[x]) grid[y][x] = 5;
  // Walls that face the walk and are racks or slab walls become frames for
  // the store's own item photos (1000 + n*10 + the wall's own texture, which
  // shows when there are no photos).
  let n = 0;
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) if ((grid[y][x] === 4 || grid[y][x] === 6) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy][x + dx] === 0)) grid[y][x] = 1000 + (n++) * 10 + grid[y][x];
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
      if (i + 1 < segs.length && segs[i] - d < 0.8) { const next = Math.atan2(pts[i + 2][1] - by, pts[i + 2][0] - bx); let diff = next - ang; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI; ang += diff * (1 - (segs[i] - d) / 0.8) * 0.5; }
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
  chest: { a: [30, 18, 8], b: [140, 82, 36], c: [230, 180, 40], y: [255, 220, 60] },
  chestopen: { a: [30, 18, 8], b: [140, 82, 36], c: [230, 180, 40], y: [255, 250, 200], g: [255, 210, 40], d: [255, 250, 160] },
};
// Where the props sit: fixed spots along each stretch of the route.
function propsFor(layout, floor) {
  const kinds = ['dollarbin', 'comics', 'bucket', 'cardbox', 'table', 'figure', 'pizza', 'eyes'], out = [];
  for (let i = 1; i < layout.route.length; i++) {
    const [x0, y0] = layout.route[i - 1], [x1, y1] = layout.route[i], n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 3));
    for (let k = 1; k <= n; k++) {
      const f = k / (n + 1), side = (i + k) % 2 ? 0.32 : -0.32, dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      out.push({ x: x0 + 0.5 + dx * f + (-dy / len) * side, y: y0 + 0.5 + dy * f + (dx / len) * side, kind: kinds[(i * 3 + k + floor) % kinds.length] });
    }
  }
  // Three treasure chests along the way (chat's goals open them).
  for (const [k, t] of [[0, 0.16], [1, 0.47], [2, 0.8]]) { const p = poseAt(layout, t), side = k % 2 ? 0.34 : -0.34; out.push({ x: p.x - Math.sin(p.ang) * side, y: p.y + Math.cos(p.ang) * side, kind: 'chest', idx: k }); }
  return out;
}

// The store's item photos, framed for the walls (48 x 64, a black frame and
// a price-tag stripe). Images must allow CORS; the caller passes a proxied URL.
export const PIC_W = 48, PIC_H = 64;
export function loadPicture(src) {
  return new Promise(resolve => {
    if (!src || typeof Image === 'undefined') return resolve(null);
    const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
    im.onload = () => { try {
      const c = document.createElement('canvas'); c.width = PIC_W; c.height = PIC_H; const x = c.getContext('2d');
      x.fillStyle = '#111'; x.fillRect(0, 0, PIC_W, PIC_H);
      const iw = PIC_W - 6, ih = PIC_H - 12, k = Math.min(iw / im.width, ih / im.height), w = im.width * k, h = im.height * k;
      x.imageSmoothingEnabled = true; x.drawImage(im, 3 + (iw - w) / 2, 3 + (ih - h) / 2, w, h);
      x.fillStyle = '#d23'; x.fillRect(3, PIC_H - 8, PIC_W - 6, 5);
      const d = x.getImageData(0, 0, PIC_W, PIC_H).data, out = new Uint8ClampedArray(PIC_W * PIC_H * 3);
      for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { out[j] = d[i]; out[j + 1] = d[i + 1]; out[j + 2] = d[i + 2]; }
      resolve(out);
    } catch { resolve(null); } };
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

// ── The renderer ──
// w x h: 240 x 96 for the overlay window; tall (180 x 320) for the green-screen background.
export function createShedCrawl(canvas, { w: VW = VW, h: VH = VH, fov: FOV = 0.66 } = {}) {
  canvas.width = VW; canvas.height = VH;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(VW, VH), zbuf = new Float32Array(VW);
  let pics = [];
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
    const pose = poseAt(map.layout, shown), ang = pose.ang + look, fov = FOV, batt = 0.25 + 0.75 * Math.max(0, Math.min(1, state.battery ?? 1));
    const dirX = Math.cos(ang), dirY = Math.sin(ang), planeX = -dirY * fov, planeY = dirX * fov;
    const pal = PALETTES[state.shed] || PALETTES['GARDEN SHED'], data = img.data, horizon = (VH >> 1) + Math.round(Math.sin(bob) * 1.5);
    const boss = state.phase === 'boss';
    // Ceiling and floor: dark at the far end, lit by the flashlight up close.
    for (let y = 0; y < VH; y++) {
      const far = y < horizon ? (horizon - y) / horizon : (y - horizon) / (VH - horizon), base = y < horizon ? pal.ceil : pal.floor, k = 0.35 + 0.95 * far;
      for (let x = 0; x < VW; x++) { const i = (y * VW + x) * 4, dither = ((x + y) & 1) * 4; data[i] = base[0] * k + dither; data[i + 1] = base[1] * k + dither; data[i + 2] = base[2] * k + dither; data[i + 3] = 255; }
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
      const pic = cell >= 1000 && pics.length ? pics[Math.floor((cell - 1000) / 10) % pics.length] : null;
      const tw = pic ? PIC_W : T, th = pic ? PIC_H : T;
      let tx = Math.floor(wx * tw); if (flip) tx = tw - 1 - tx;
      const t = pic || textures[cell >= 1000 ? cell % 10 : cell] || textures[1];
      // Flashlight + fog: bright in the middle and close, dark at the edges and far.
      const light = Math.max(0.1, Math.min(1, 2 / (1 + dist * 0.42)) * (1 - Math.abs(cam) * 0.35) * (side ? 0.8 : 1) * batt);
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
      const scx = Math.floor((VW / 2) * (1 + tX / tY)), size = Math.max(2, Math.floor(Math.floor(VH / tY) * (s.kind === 'boss' ? 1.5 : s.kind === 'eyes' ? 0.3 : 0.55)));
      const floorY = horizon + Math.floor(VH / tY / 2), top = s.kind === 'eyes' ? horizon - size : floorY - size;
      const light = Math.max(0.15, Math.min(1, 2 / (1 + tY * 0.42)) * batt);
      for (let sx = Math.max(0, scx - (size >> 1)); sx < Math.min(VW, scx + (size >> 1)); sx++) {
        if (tY > zbuf[sx]) continue;
        const u = (sx - (scx - (size >> 1))) / size;
        for (let sy = Math.max(0, top); sy < Math.min(VH, top + size); sy++) {
          const v = (sy - top) / size; let col = null;
          if (s.kind === 'boss') { const bxp = Math.floor(u * bossPx.w), byp = Math.floor(v * bossPx.h), bi = (byp * bossPx.w + bxp) * 4; if (bossPx.data[bi + 3] > 128) col = [bossPx.data[bi], bossPx.data[bi + 1], bossPx.data[bi + 2]]; }
          else { const kind = s.kind === 'chest' ? (state.chests?.[s.idx] ? 'chestopen' : 'chest') : s.kind, rows = SPRITES[kind], row = rows[Math.floor(v * 16) - (16 - rows.length)], ch = row?.[Math.floor(u * 16)]; if (ch && ch !== '.') col = SPRITE_COLORS[kind][ch]; }
          if (!col) continue;
          const i = (sy * VW + sx) * 4, l = s.kind === 'eyes' || s.kind === 'boss' || (s.kind === 'chest' && state.chests?.[s.idx]) ? 1 : light;
          data[i] = col[0] * l; data[i + 1] = col[1] * l; data[i + 2] = col[2] * l;
        }
      }
    });
    // A boss up: the room flushes red.
    if (boss) for (let i = 0; i < data.length; i += 4) data[i] = Math.min(255, data[i] * 1.18 + 10);
    ctx.putImageData(img, 0, 0);
  }
  return {
    set, setBoss, onPeek: fn => { listeners.peek = fn; },
    // The store's item photos for the walls (from loadPicture).
    setPictures(list) { pics = (list || []).filter(Boolean).slice(0, 24); },
    start() { if (!raf) raf = requestAnimationFrame(frame); },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    // For tests: where the walker is.
    peekState: () => ({ shown, target, peeking: Date.now() < peekUntil, label: peek?.label || '' }),
    drawNow: draw,
  };
}
