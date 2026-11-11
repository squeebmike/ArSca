// THE SHED CRAWL, first person (store, 2026-11-11: "go through the dungeon
// crawl like doom visuals ... walking through halls, rooms ... parts of the
// shed, looking for and through shit"). A small raycaster, the classic
// early-90s way: a grid of walls, one ray per screen column, chunky pixels
// blown up 4x. Everything here is original and drawn in code: board walls,
// pegboard with tools, shelves of long boxes, paint cans, a mower, rakes,
// cobwebs, a lawn gnome, raccoon eyes in the dark.
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
  { route: [[2, 13], [2, 3], [8, 3], [8, 9], [13, 9], [13, 3]], boss: [12, 1, 3, 2], peeks: [{ at: 0.28, cell: [1, 8], label: 'SEARCHING THE LONG BOXES…' }, { at: 0.62, cell: [10, 10], label: 'DIGGING THROUGH THE PAINT CANS…' }] },
  { route: [[13, 13], [3, 13], [3, 8], [12, 8], [12, 3], [4, 3]], boss: [1, 2, 3, 3], peeks: [{ at: 0.24, cell: [8, 14], label: 'RUMMAGING UNDER THE MOWER…' }, { at: 0.58, cell: [7, 9], label: 'CHECKING THE PEGBOARD…' }] },
  { route: [[2, 2], [2, 12], [7, 12], [7, 6], [13, 6], [13, 12]], boss: [12, 13, 3, 2], peeks: [{ at: 0.3, cell: [1, 7], label: 'OPENING THE OLD TACKLE BOX…' }, { at: 0.66, cell: [10, 5], label: 'LOOKING BEHIND THE SEED BAGS…' }] },
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
export function buildMap(floor) {
  const L = layoutFor(floor), N = 16, grid = Array.from({ length: N }, () => Array(N).fill(1));
  const open = (x, y) => { if (x > 0 && y > 0 && x < N - 1 && y < N - 1) grid[y][x] = 0; };
  for (let i = 1; i < L.route.length; i++) {
    const [x0, y0] = L.route[i - 1], [x1, y1] = L.route[i];
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) open(x, y);
  }
  const [bx, by, bw, bh] = L.boss;
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) open(x, y);
  for (const p of L.peeks) open(...p.cell);
  // Textures: boards mostly; pegboard (2), long-box shelves (3) and seed
  // bags (4) on a fixed pattern; the peeks are shelves; the boss room is 5.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (grid[y][x]) grid[y][x] = [1, 1, 2, 1, 3, 1, 1, 4][(x * 3 + y * 5 + floor) % 8];
  for (const p of L.peeks) { const [cx, cy] = p.cell; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (grid[cy + dy]?.[cx + dx]) grid[cy + dy][cx + dx] = 3; }
  for (let y = by - 1; y <= by + bh; y++) for (let x = bx - 1; x <= bx + bw; x++) if (grid[y]?.[x]) grid[y][x] = 5;
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
function makeTextures(p) {
  const boards = px => { for (let x = 0; x < T; x++) for (let y = 0; y < T; y++) px(x, y, (x >> 3) % 2 ? p.a : p.b); for (let x = 7; x < T; x += 8) fill(px, x, 0, 1, T, p.gap); fill(px, 3, 6, 1, 1, [30, 30, 30]); fill(px, 19, 24, 1, 1, [30, 30, 30]); fill(px, 12, 15, 2, 2, p.gap); };
  return {
    1: tex(boards),
    // Pegboard: holes, a hammer, a saw outline, a wrench.
    2: tex(px => { fill(px, 0, 0, T, T, [150, 120, 84]); for (let y = 2; y < T; y += 4) for (let x = 2; x < T; x += 4) px(x, y, [70, 52, 34]); fill(px, 5, 6, 2, 14, [110, 70, 40]); fill(px, 3, 5, 6, 3, [90, 90, 96]); fill(px, 14, 8, 12, 5, [170, 174, 180]); fill(px, 24, 6, 3, 9, [92, 54, 30]); for (let i = 0; i < 6; i++) px(15 + i * 2, 13, [120, 124, 130]); fill(px, 12, 20, 2, 9, [140, 140, 150]); fill(px, 11, 19, 4, 2, [140, 140, 150]); fill(px, 20, 22, 8, 2, [200, 40, 40]); }),
    // Shelves of comic long boxes.
    3: tex(px => { boards(px); for (const sy of [9, 21]) { fill(px, 0, sy, T, 2, [60, 36, 18]); for (let x = 1; x < T - 6; x += 10) { fill(px, x, sy - 7, 8, 7, [214, 206, 186]); fill(px, x, sy - 7, 8, 1, [170, 160, 140]); fill(px, x + 2, sy - 4, 4, 1, [60, 60, 60]); } } fill(px, 0, 29, T, 2, [60, 36, 18]); fill(px, 4, 23, 6, 6, [180, 40, 40]); fill(px, 14, 24, 5, 5, [40, 90, 170]); }),
    // Seed bags and a calendar.
    4: tex(px => { boards(px); fill(px, 4, 16, 9, 14, [190, 160, 90]); fill(px, 6, 19, 5, 4, [70, 140, 60]); fill(px, 16, 18, 10, 12, [170, 140, 80]); fill(px, 19, 21, 4, 4, [200, 80, 60]); fill(px, 18, 3, 9, 10, [230, 226, 210]); fill(px, 18, 3, 9, 2, [190, 40, 40]); }),
    // The boss room: boards burned red, claw marks.
    5: tex(px => { for (let x = 0; x < T; x++) for (let y = 0; y < T; y++) px(x, y, (x >> 3) % 2 ? [110, 30, 34] : [90, 22, 28]); for (let x = 7; x < T; x += 8) fill(px, x, 0, 1, T, [30, 6, 8]); for (let i = 0; i < 12; i++) { px(8 + i, 6 + i, [20, 4, 4]); px(12 + i, 6 + i, [20, 4, 4]); px(16 + i, 6 + i, [20, 4, 4]); } }),
  };
}
// Props along the hallway, 16 x 16 sprites ('.' is see-through).
const SPRITES = {
  can: ['......aaaa......', '.....abbbba.....', '.....abbbba.....', '.....accccA.....', '.....accccA.....', '.....acddcA.....', '.....acddcA.....', '.....accccA.....', '.....aaaaaa.....'],
  boxes: ['..aaaaaaaaaaaa..', '..abbbbbbbbbba..', '..abbccccccbba..', '..abbbbbbbbbba..', '..aaaaaaaaaaaa..', '..aaaaaaaaaaaa..', '..abbbbbbbbbba..', '..abbccccccbba..', '..abbbbbbbbbba..', '..aaaaaaaaaaaa..'],
  rake: ['..a.a.a.a.a.....', '..aaaaaaaaa.....', '......b.........', '......b.........', '......b.........', '......b.........', '......b.........', '......b.........', '......b.........', '......b.........', '......b.........'],
  gnome: ['.......a........', '......aaa.......', '.....aaaaa......', '.....bbbbb......', '.....bcbcb......', '.....ddddd......', '....eeeeeee.....', '....eeeeeee.....', '.....ff.ff......'],
  mower: ['.a..............', '..a.............', '...a............', '....aaaaaaaaa...', '....abbbbbbba...', '...abbbbbbbbba..', '...accaaaaacca..', '...accA...accA..'],
  eyes: ['................', '....a.....a.....', '...aaa...aaa....'],
};
const SPRITE_COLORS = {
  can: { a: [20, 20, 20], b: [150, 150, 160], c: [60, 120, 200], A: [40, 80, 140], d: [230, 230, 230] },
  boxes: { a: [40, 30, 20], b: [214, 206, 186], c: [90, 90, 90] },
  rake: { a: [140, 140, 150], b: [120, 80, 44] },
  gnome: { a: [200, 30, 40], b: [240, 210, 180], c: [20, 20, 20], d: [240, 240, 240], e: [40, 110, 200], f: [80, 50, 30] },
  mower: { a: [30, 30, 30], b: [200, 40, 40], c: [40, 40, 40], A: [20, 20, 20] },
  eyes: { a: [255, 230, 80] },
};
// Where the props sit: fixed spots along each stretch of the route.
function propsFor(layout, floor) {
  const kinds = ['boxes', 'can', 'rake', 'gnome', 'mower', 'boxes', 'can', 'eyes'], out = [];
  for (let i = 1; i < layout.route.length; i++) {
    const [x0, y0] = layout.route[i - 1], [x1, y1] = layout.route[i], n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 3));
    for (let k = 1; k <= n; k++) {
      const f = k / (n + 1), side = (i + k) % 2 ? 0.32 : -0.32, dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      out.push({ x: x0 + 0.5 + dx * f + (-dy / len) * side, y: y0 + 0.5 + dy * f + (dx / len) * side, kind: kinds[(i * 3 + k + floor) % kinds.length] });
    }
  }
  return out;
}

// ── The renderer ──
export function createShedCrawl(canvas, { scale = 4 } = {}) {
  canvas.width = VIEW_W; canvas.height = VIEW_H;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(VIEW_W, VIEW_H), zbuf = new Float32Array(VIEW_W);
  let state = { floor: 1, shed: 'GARDEN SHED', pct: 0, phase: 'floor' }, map = buildMap(1), textures = makeTextures(PALETTES['GARDEN SHED']), props = propsFor(map.layout, 1);
  let first = true, shown = 0, target = 0, look = 0, peek = null, peekUntil = 0, done = new Set(), bossPx = null, raf = 0, last = 0, bob = 0, walking = false;
  const listeners = { peek: () => {} };
  function setBoss(sourceCanvas) {
    if (!sourceCanvas) { bossPx = null; return; }
    const c = sourceCanvas.getContext('2d'), d = c.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    bossPx = { w: sourceCanvas.width, h: sourceCanvas.height, data: d.data };
  }
  function set(next) {
    const floorChanged = first || next.floor !== state.floor || next.shed !== state.shed; first = false;
    state = { ...state, ...next };
    if (floorChanged) { map = buildMap(state.floor); textures = makeTextures(PALETTES[state.shed] || PALETTES['GARDEN SHED']); props = propsFor(map.layout, state.floor); shown = 0; done = new Set(); }
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
    const pose = poseAt(map.layout, shown), ang = pose.ang + look, fov = 0.66;
    const dirX = Math.cos(ang), dirY = Math.sin(ang), planeX = -dirY * fov, planeY = dirX * fov;
    const pal = PALETTES[state.shed] || PALETTES['GARDEN SHED'], data = img.data, horizon = (VIEW_H >> 1) + Math.round(Math.sin(bob) * 1.5);
    const boss = state.phase === 'boss';
    // Ceiling and floor: dark at the far end, lit by the flashlight up close.
    for (let y = 0; y < VIEW_H; y++) {
      const far = y < horizon ? (horizon - y) / horizon : (y - horizon) / (VIEW_H - horizon), base = y < horizon ? pal.ceil : pal.floor, k = 0.35 + 0.95 * far;
      for (let x = 0; x < VIEW_W; x++) { const i = (y * VIEW_W + x) * 4, dither = ((x + y) & 1) * 4; data[i] = base[0] * k + dither; data[i + 1] = base[1] * k + dither; data[i + 2] = base[2] * k + dither; data[i + 3] = 255; }
    }
    // Walls: one ray per column (DDA).
    for (let x = 0; x < VIEW_W; x++) {
      const cam = 2 * x / VIEW_W - 1, rx = dirX + planeX * cam, ry = dirY + planeY * cam;
      let mx = Math.floor(pose.x), my = Math.floor(pose.y);
      const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry), sx = rx < 0 ? -1 : 1, sy = ry < 0 ? -1 : 1;
      let sdx = rx < 0 ? (pose.x - mx) * ddx : (mx + 1 - pose.x) * ddx, sdy = ry < 0 ? (pose.y - my) * ddy : (my + 1 - pose.y) * ddy, side = 0, cell = 0;
      for (let g = 0; g < 64 && !cell; g++) { if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; } cell = map.grid[my]?.[mx] ?? 1; }
      const dist = Math.max(0.05, side ? sdy - ddy : sdx - ddx); zbuf[x] = dist;
      const h = Math.floor(VIEW_H / dist), top = Math.max(0, horizon - (h >> 1)), bot = Math.min(VIEW_H - 1, horizon + (h >> 1));
      let wx = side ? pose.x + dist * rx : pose.y + dist * ry; wx -= Math.floor(wx);
      const tx = Math.floor(wx * T), t = textures[cell] || textures[1];
      // Flashlight + fog: bright in the middle and close, dark at the edges and far.
      const light = Math.max(0.16, Math.min(1, 2 / (1 + dist * 0.42)) * (1 - Math.abs(cam) * 0.35) * (side ? 0.8 : 1));
      for (let y = top; y <= bot; y++) {
        const ty = Math.min(T - 1, Math.floor((y - horizon + (h >> 1)) * T / h)), ti = (ty * T + tx) * 3, i = (y * VIEW_W + x) * 4;
        data[i] = t[ti] * light + pal.fog[0] * (1 - light); data[i + 1] = t[ti + 1] * light + pal.fog[1] * (1 - light); data[i + 2] = t[ti + 2] * light + pal.fog[2] * (1 - light);
      }
    }
    // Props and the boss: sprites, farthest first, hidden behind walls.
    const list = props.map(p => ({ ...p })); if (boss && bossPx) { const [bx, by, bw, bh] = map.layout.boss; list.push({ x: bx + bw / 2, y: by + bh / 2, kind: 'boss' }); }
    const inv = 1 / (planeX * dirY - dirX * planeY);
    list.map(s => ({ ...s, d: (s.x - pose.x) ** 2 + (s.y - pose.y) ** 2 })).sort((a, b) => b.d - a.d).forEach(s => {
      const rx = s.x - pose.x, ry = s.y - pose.y, tX = inv * (dirY * rx - dirX * ry), tY = inv * (-planeY * rx + planeX * ry);
      if (tY <= 0.15) return;
      const scx = Math.floor((VIEW_W / 2) * (1 + tX / tY)), size = Math.max(2, Math.floor(Math.floor(VIEW_H / tY) * (s.kind === 'boss' ? 1.5 : s.kind === 'eyes' ? 0.3 : 0.55)));
      const floorY = horizon + Math.floor(VIEW_H / tY / 2), top = s.kind === 'eyes' ? horizon - size : floorY - size;
      const light = Math.max(0.25, Math.min(1, 2 / (1 + tY * 0.42)));
      for (let sx = Math.max(0, scx - (size >> 1)); sx < Math.min(VIEW_W, scx + (size >> 1)); sx++) {
        if (tY > zbuf[sx]) continue;
        const u = (sx - (scx - (size >> 1))) / size;
        for (let sy = Math.max(0, top); sy < Math.min(VIEW_H, top + size); sy++) {
          const v = (sy - top) / size; let col = null;
          if (s.kind === 'boss') { const bxp = Math.floor(u * bossPx.w), byp = Math.floor(v * bossPx.h), bi = (byp * bossPx.w + bxp) * 4; if (bossPx.data[bi + 3] > 128) col = [bossPx.data[bi], bossPx.data[bi + 1], bossPx.data[bi + 2]]; }
          else { const rows = SPRITES[s.kind], row = rows[Math.floor(v * 16) - (16 - rows.length)], ch = row?.[Math.floor(u * 16)]; if (ch && ch !== '.') col = SPRITE_COLORS[s.kind][ch]; }
          if (!col) continue;
          const i = (sy * VIEW_W + sx) * 4, l = s.kind === 'eyes' || s.kind === 'boss' ? 1 : light;
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
    start() { if (!raf) raf = requestAnimationFrame(frame); },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    // For tests: where the walker is.
    peekState: () => ({ shown, target, peeking: Date.now() < peekUntil, label: peek?.label || '' }),
    drawNow: draw,
  };
}
