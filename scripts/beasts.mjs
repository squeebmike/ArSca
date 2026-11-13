// LONG BOX BEASTS (working name) -- the Shed Dungeon's other mode (store,
// 2026-11-13: "is there a pokemon version we can make? like the overworld in
// the handheld games ... start in one that's green ... walking around, same as
// the dungeon, and then we can battle ... make it funny. Not actually Nintendo
// IP"). An ORIGINAL monster-battler in the retro-handheld style: our own town,
// our own creatures (collector jokes, drawn here from their names), our own
// battle screen (side by side), our own moves. Phase 1: the top-down
// overworld in four shades of green. Phase 2: battles.
//
// How it plays: the floor's mana walks you up the route from your shop to the
// rival's shop; wild beasts jump out of the tall grass at fixed spots (a slice
// of the floor's mana is each one's HP -- sales knock it out); the boss phase
// is the rival's beast. Chat picks the attack (CHAT PICKS); every sale fires
// it. Chat can invent attacks: the name picks its animation. Nothing is drawn
// by chance -- the same name makes the same beast and the same move on every
// screen, and nothing is won by buying.

// The handheld's four greens, lightest to darkest.
export const GB = [[155, 188, 15], [139, 172, 15], [48, 98, 48], [15, 56, 15]];
export const T = 16; // one tile, 16 x 16
// Where on the floor the wild beasts wait, and how much of the floor's mana each takes to knock out.
export const ENCOUNTERS = [[0.22, 0.3], [0.48, 0.56], [0.74, 0.82]];
export const STARTER = 'SLABBIT';
// The three starters chat picks from (store, 2026-11-13: "we need a starter monster -- chat chooses").
export const STARTERS = ['SLABBIT', 'TOPLOADON', 'SLEEVIL'];
export const DEFAULT_MOVES = ['LOWBALL', 'PRICE CHECK', 'SLEEVE UP', 'BENT CORNER'];

// A fixed number sequence from a word or a number (the same every time).
export function hashOf(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function seq(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

// ── the beasts ───────────────────────────────────────────────────────────────
const PRE = ['SLAB', 'FOIL', 'MINT', 'BULK', 'PENNY', 'GRAIL', 'VARI', 'TOPLOAD', 'BENT', 'CENTER', 'SLEEVE', 'KEY', 'HOLO', 'NEWS', 'RATIO', 'CREASE'];
const SUF = ['BIT', 'LING', 'OON', 'AROO', 'OX', 'ISH', 'MOTH', 'TOAD', 'IMP', 'PUP', 'OWL', 'SNAIL'];
// The wild beast at encounter k on a floor.
export function wildName(floor, k) { const f = Math.max(1, floor | 0); return PRE[(f * 5 + k * 7) % PRE.length] + SUF[(f * 3 + k * 5) % SUF.length]; }
// A beast's look, made from its name (2026-11-13: "need better and animated
// sprites for the mons"): 32 x 32, four idle frames (it breathes; its tail,
// wings and feet move), front or back. Built from a body type the name picks --
// blob, biped, four-legged, bird, bug or serpent -- shaded light from the top
// left, a dark outline, big eyes; plus the collector bits its name asks for.
// The three starters are drawn on purpose. Original; nothing by chance.
export const BEAST_SIZE = 32;
const TYPES = ['blob', 'biped', 'quad', 'bird', 'bug', 'serpent'];
export function beastType(name) { const nm = String(name).toUpperCase(); if (nm === 'SLABBIT') return 'biped'; if (nm === 'TOPLOADON') return 'quad'; if (nm === 'SLEEVIL') return 'biped'; if (/MOTH|OWL/.test(nm)) return 'bird'; if (/SNAIL|TOAD/.test(nm)) return 'blob'; if (/IMP|PUP/.test(nm)) return 'biped'; if (/OX|AROO/.test(nm)) return 'quad'; return TYPES[hashOf(nm + 't') % TYPES.length]; }
export function makeBeast(name, { back = false } = {}) {
  const nm = String(name).toUpperCase(), type = beastType(nm), r = seq(hashOf(nm)), N = BEAST_SIZE;
  const shape = { w: 0.9 + r() * 0.25, h: 0.9 + r() * 0.2, ear: Math.floor(r() * 3), tail: r() < 0.7, spots: r() < 0.5, horn: r() < 0.3 };
  const frames = [0, 1, 2, 3].map(f => drawFrame(nm, type, shape, f, back));
  return { name: nm, type, frames, blink: back ? frames[0] : drawFrame(nm, type, shape, 0, back, true), px: frames[0] };
}
function drawFrame(nm, type, sh, f, back, shut = false) {
  const N = BEAST_SIZE, g = Array.from({ length: N }, () => Array(N).fill(-1));
  const breath = [0, 0.5, 1, 0.5][f], step = f % 2, sway = [0, 1, 0, -1][f];
  // Shaded ellipse: light top-left, darker bottom-right, an inner highlight.
  const blob = (cx, cy, rx, ry, base = 1) => { for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) { if (x < 0 || y < 0 || x >= N || y >= N) continue; const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d = dx * dx + dy * dy; if (d > 1) continue; const lit = dx * -0.6 + dy * -0.8; g[y][x] = d > 0.8 && base !== 0 ? 3 : lit > 0.45 && d < 0.4 ? 0 : lit < -0.25 && d > 0.45 ? Math.min(2, base + 1) : base; } }; // each part outlined, a highlight top left, shadow bottom right
  const px = (x, y, s) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < N && y < N) g[y][x] = s; };
  const line = (x0, y0, x1, y1, s, w = 1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let k = 0; k <= n; k++) for (let a = 0; a < w; a++) px(x0 + (x1 - x0) * k / n + a, y0 + (y1 - y0) * k / n, s); };
  let eyeY = 12, eyeDX = 4, cx = 16, mouthY = 17;
  // ── the body type ──
  if (type === 'blob') {
    const ry = 9 * sh.h - breath * 0.6, rx = 12 * sh.w + breath * 0.6;
    blob(cx, 30 - ry, rx, ry); for (let k = 0; k < 4; k++) blob(cx - rx * 0.7 + k * rx * 0.47, 29.5, 2, 1.5 + ((k + f) % 2) * 0.6); // drips at the base
    if (/SNAIL/.test(nm)) { blob(cx + 6, 30 - ry - 2, 7, 7, 2); for (let a = 0; a < 6.2; a += 0.3) px(cx + 6 + Math.cos(a) * a * 0.9, 30 - ry - 2 + Math.sin(a) * a * 0.9, 3); }
    eyeY = Math.round(30 - ry * 1.3); mouthY = eyeY + 5;
  } else if (type === 'biped') {
    blob(cx - 5, 28 + (step ? -1 : 0), 3, 2.5, 2); blob(cx + 5, 28 + (step ? 0 : -1), 3, 2.5, 2); // feet
    blob(cx, 21 - breath * 0.5, 8.5 * sh.w, 7.5); // body
    blob(cx - 9 * sh.w, 20 + sway * 0.5, 2.2, 3.5); blob(cx + 9 * sh.w, 20 - sway * 0.5, 2.2, 3.5); // arms
    blob(cx, 11 - breath * 0.5, 8.5 * sh.w, 7.5); // the big head
    eyeY = Math.round(11 - breath * 0.5); mouthY = eyeY + 4;
    if (sh.tail || /SLABBIT/.test(nm)) blob(cx + 10, 24, 2.5, 2.5, 0);
  } else if (type === 'quad') {
    for (const [lx, o] of [[-8, 0], [-3, 1], [4, 0], [9, 1]]) blob(cx + lx, 28 + ((o + step) % 2 ? -0.7 : 0), 2.2, 3, 2); // four stubby legs
    blob(cx + 1, 21 - breath * 0.4, 11 * sh.w, 6.5); // the long body
    if (sh.tail) line(cx + 11, 20, cx + 15, 15 + sway, 3, 2);
    blob(cx - 6, 12 - breath * 0.5, 7, 6.5); // the head, to one side
    cx = 10; eyeY = Math.round(12 - breath * 0.5); eyeDX = 3; mouthY = eyeY + 4;
  } else if (type === 'bird') {
    const flap = [0, -2, -3, -2][f];
    blob(cx, 18 - breath * 0.4, 9 * sh.w, 9); // round body
    for (const s of [-1, 1]) { for (let k = 0; k < 7; k++) line(cx + s * 8, 17, cx + s * (13 + k * 0.3), 10 + flap + k * 2, 2); } // wings
    for (const s of [-1, 1]) line(cx + s * 3, 26, cx + s * 4, 30, 3); // legs
    eyeY = Math.round(14 - breath * 0.4); mouthY = eyeY + 4;
  } else if (type === 'bug') {
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) line(cx + s * 6, 18 + k * 3, cx + s * (12 + ((k + f) % 2)), 21 + k * 3, 3); // six legs
    blob(cx, 22 - breath * 0.3, 7, 6, 2); blob(cx, 14 - breath * 0.4, 7.5, 6); // abdomen, head
    for (const s of [-1, 1]) line(cx + s * 3, 8, cx + s * (7 + sway * 0.5), 2, 3); // antennae
    eyeY = Math.round(14 - breath * 0.4); mouthY = eyeY + 4;
  } else { // serpent
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 1.6 + f * 0.15; blob(cx + Math.cos(a) * 9, 26 - k * 0.9 + Math.sin(a) * 2, 3.4, 3, k % 3 === 0 ? 2 : 1); }
    blob(cx + 2, 9 - breath * 0.5, 6.5, 5.5); cx = 18; eyeY = Math.round(9 - breath * 0.5); eyeDX = 3; mouthY = eyeY + 4;
  }
  // Ears or horns (on the head).
  const headTop = g.findIndex(row => row.some(v => v >= 0));
  if (type !== 'bird' && type !== 'bug') {
    if (sh.ear === 0 || /SLABBIT/.test(nm)) for (const s of [-1, 1]) { line(cx + s * 3, headTop + 1, cx + s * 5, headTop - 6, 1, 2); line(cx + s * 3.5, headTop, cx + s * 5, headTop - 4, 0); } // long ears
    else if (sh.ear === 1) for (const s of [-1, 1]) { blob(cx + s * 5, headTop + 1, 2.4, 2.4, 1); } // round ears
    if (sh.horn) line(cx, headTop + 1, cx, headTop - 3, 0, 1);
  }
  // Spots.
  if (sh.spots && type !== 'bird') for (const [x, y] of [[cx + 4, 21], [cx - 5, 24], [cx + 1, 25]]) if (g[Math.round(y)]?.[Math.round(x)] >= 0) px(x, y, 2);
  // ── the collector bits ──
  if (/SLAB|GRAIL|KEY/.test(nm) && !back) { for (let y = 17; y < 26; y++) for (let x = cx - 5; x <= cx + 5; x++) if (g[y]?.[x] >= 0) g[y][x] = y === 17 || y === 25 || x === cx - 5 || x === cx + 5 ? 3 : y < 20 ? 2 : 0; px(cx - 1, 18, 0); px(cx, 18, 0); px(cx + 2, 18, 0); px(cx + 3, 18, 0); } // a grading label on its belly
  if (/TOPLOAD/.test(nm)) for (let y = headTop - 4; y < headTop + 2; y++) for (let x = cx - 4; x <= cx + 4; x++) if (y >= 0 && (y === headTop - 4 || x === cx - 4 || x === cx + 4)) px(x, y, 3); // the top-loader crest
  if (/SLEEV/.test(nm)) { for (let y = 14; y < 29; y++) for (const s of [-1, 1]) { const x = cx + s * (9 + (y - 14) * 0.25 + (s * sway > 0 ? 0.5 : 0)); px(x, y, 2); px(x - s, y, 1); } } // the sleeve cape
  if (/FOIL|HOLO/.test(nm)) for (const [x, y] of [[4, 6], [27, 9], [6, 24], [26, 22]]) { const on = (x + y + f) % 4 < 2; if (on) { px(x, y, 0); px(x - 1, y, 2); px(x + 1, y, 2); px(x, y - 1, 2); px(x, y + 1, 2); } }
  if (/MINT/.test(nm)) { line(cx + 1, headTop - 1, cx + 3, headTop - 5, 2); blob(cx + 4, headTop - 5, 2, 1.3, 1); }
  if (/BENT|CREASE/.test(nm)) for (let k = 0; k < 4; k++) line(cx + 6 + k, headTop + k, cx + 9, headTop + k, -1);
  if (/PENNY/.test(nm)) { blob(cx + 9, 26, 2.6, 2.6, 0); px(cx + 9, 26, 2); }
  // ── the face (front only) ──
  if (!back) {
    if (shut) for (const s of [-1, 1]) { const ex = cx + s * eyeDX; line(ex - 2, eyeY, ex + 1, eyeY, 3); } // a blink
    else for (const s of [-1, 1]) { const ex = cx + s * eyeDX; for (let y = -3; y <= 3; y++) for (let x = -2; x <= 2; x++) { const e = (x / 2.5) ** 2 + (y / 3.4) ** 2; if (e <= 1) px(ex + x, eyeY + y, e > 0.62 ? 3 : 0); } for (const [a, c] of [[0, 0], [-s, 0], [0, 1], [-s, 1]]) px(ex + a, eyeY + c, 3); px(ex - s, eyeY - 1, 0); } // big eyes looking a little inward, a glint
    const grin = hashOf(nm + 'm') % 3; if (grin === 0) line(cx - 2, mouthY, cx + 2, mouthY, 3); else if (grin === 1) { line(cx - 2, mouthY, cx + 2, mouthY, 3); px(cx - 3, mouthY - 1, 3); px(cx + 3, mouthY - 1, 3); px(cx + 1, mouthY + 1, 0); } else { blob(cx, mouthY + 1, 2, 1.4, 2); px(cx, mouthY + 1, 3); }
    if (type === 'bird') { px(cx, eyeY + 3, 3); px(cx - 1, eyeY + 3, 3); px(cx, eyeY + 4, 3); } // a beak
  } else {
    // From behind: a stripe down its back.
    for (let y = headTop + 2; y < 27; y += 2) if (g[y]?.[cx] >= 0) { px(cx, y, 2); px(cx + 1, y, 2); }
  }
  // The outline, all round.
  const out = g.map(row => row.slice());
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y][x] >= 0 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => (g[y + b]?.[x + a] ?? -1) < 0)) out[y][x] = 3;
  return out;
}

// ── the moves ────────────────────────────────────────────────────────────────
// Any move's animation, from its name (chat can invent one on the spot).
const ANIMS = [
  [/FIRE|FLAME|BURN|HOT|SPICY|ROAST/, 'flame'], [/WATER|SOAK|FLOOD|RAIN|SPILL|DRIP|LEAK/, 'water'],
  [/PRICE|MONEY|CASH|COIN|FLIP|PROFIT|SELL|DOLLAR|\$/, 'coins'], [/LOWBALL|BALL|BOUNCE/, 'ball'],
  [/SLAB|CARD|SLEEVE|TOPLOAD|GRADE|COMIC|HOLO|FOIL/, 'card'], [/BENT|CREASE|PUNCH|SLAM|SMASH|HIT|DENT|BONK/, 'slam'],
  [/SHIP|DELAY|BOX|PACKAGE|MAIL/, 'box'], [/SHOUT|YELL|HYPE|ROAST|TROLL|DM|CHAT/, 'shout'], [/ZAP|SHOCK|POWER|STATIC|ELECTR/, 'zap'],
];
export function moveAnim(name) { const n = String(name || '').toUpperCase(); const hit = ANIMS.find(([re]) => re.test(n)); return hit ? hit[1] : ['card', 'slam', 'zap', 'shout', 'ball'][hashOf(n) % 5]; }
export function movesFrom(text) { const list = String(text || '').split(/\r?\n/).map(s => s.replace(/[^A-Za-z0-9 '!?$&.-]/g, '').trim().toUpperCase().slice(0, 16)).filter(Boolean); return [...list, ...DEFAULT_MOVES].slice(0, 4); }

// ── your face (and your buddy's): 12 x 12 in the four greens ─────────────────
// Stored in the settings as 144 digits 0-3 (no image hosting). The remote makes it from a photo.
export function faceFromImage(img, size = 12) {
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d', { willReadFrequently: true });
  const s = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height); x.drawImage(img, ((img.naturalWidth || img.width) - s) / 2, ((img.naturalHeight || img.height) - s) / 2.4, s, s, 0, 0, size, size);
  const d = x.getImageData(0, 0, size, size).data, lum = []; for (let i = 0; i < d.length; i += 4) lum.push(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
  const sorted = [...lum].sort((a, b) => a - b), q = k => sorted[Math.floor(sorted.length * k)];
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.78); // spread the photo across the four shades
  return lum.map(v => (v > t3 ? 0 : v > t2 ? 1 : v > t1 ? 2 : 3)).join('');
}
export const validFace = s => typeof s === 'string' && /^[0-3]{144}$/.test(s);

// ── the town and the route (a floor) ────────────────────────────────────────
// Tiles: 0 grass, 1 path, 2 tall grass, 3 tree, 4 water, 5 house wall, 6 roof,
// 7 door, 8 fence, 9 flowers, 10 sign, 11 your shop's sign, 12 the rival's sign.
export const MAP_W = 24, MAP_H = 64;
const mapCache = new Map();
export function routeFor(floor) {
  const f = Math.max(1, floor | 0); if (mapCache.has(f)) return mapCache.get(f);
  const r = seq(hashOf('route' + f)), W = MAP_W, H = MAP_H, g = Array.from({ length: H }, () => Array(W).fill(0));
  // Trees all round; the path winds north from your shop (bottom) to the rival's (top).
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 2 || x >= W - 2) g[y][x] = 3;
  const pts = []; let x = 12;
  for (let y = H - 9; y >= 8; y--) { if (y % 7 === 0) x = Math.max(5, Math.min(W - 6, x + Math.round((r() - 0.5) * 10))); pts.push([x, y]); }
  // The path: two wide, following x (with the bends filled in).
  let px0 = pts[0][0];
  for (const [x1, y] of pts) { for (let xx = Math.min(px0, x1); xx <= Math.max(px0, x1); xx++) { g[y][xx] = 1; g[y][xx + 1] = 1; } px0 = x1; }
  // Woods along the route (not on the path), a pond, flowers.
  for (let y = 10; y < H - 12; y++) for (let x2 = 2; x2 < W - 2; x2++) if (g[y][x2] === 0) { const v = r(); if (v < 0.16) g[y][x2] = 3; else if (v < 0.2) g[y][x2] = 9; }
  const pond = [3 + Math.floor(r() * 4), 22 + Math.floor(r() * 20)]; for (let y = pond[1]; y < pond[1] + 3; y++) for (let x2 = pond[0]; x2 < pond[0] + 4; x2++) if (g[y][x2] !== 1) g[y][x2] = 4;
  // Tall grass where the wild beasts wait (around the path at each encounter).
  const along = t => pts[Math.min(pts.length - 1, Math.floor(t * (pts.length - 1)))];
  ENCOUNTERS.forEach(([a, b]) => { const [ex, ey] = along(walkAt((a + b) / 2)); for (let y = ey - 3; y <= ey + 3; y++) for (let x2 = ex - 3; x2 <= ex + 4; x2++) if (g[y]?.[x2] !== undefined && x2 >= 2 && x2 < W - 2 && g[y][x2] !== 4) g[y][x2] = g[y][x2] === 1 ? 2 : 2; });
  // Your shop's town at the bottom: the shop, two houses, a fence, a sign.
  const house = (hx, hy, sign) => { for (let x2 = hx; x2 < hx + 5; x2++) { g[hy][x2] = 6; g[hy + 1][x2] = 6; g[hy + 2][x2] = 5; g[hy + 3][x2] = 5; } g[hy + 3][hx + 2] = 7; if (sign) g[hy + 1][hx + 2] = sign; };
  for (let y = H - 9; y < H - 1; y++) for (let x2 = 2; x2 < W - 2; x2++) g[y][x2] = g[y][x2] === 1 ? 1 : 0;
  house(9, H - 8, 11); house(3, H - 7, 0); house(16, H - 7, 0);
  for (let x2 = 2; x2 < W - 2; x2++) if (g[H - 2][x2] === 0) g[H - 2][x2] = 8;
  g[H - 4][14] = 10; g[H - 4][12] = 1; g[H - 4][13] = 1; g[H - 5][11] = 1; g[H - 5][12] = 1;
  // The rival's shop at the top.
  for (let y = 1; y < 8; y++) for (let x2 = 2; x2 < W - 2; x2++) if (g[y][x2] !== 1) g[y][x2] = y < 2 ? 3 : 0;
  house(pts[pts.length - 1][0] - 2, 2, 12);
  // The walk: your shop's door, up the path, to the rival's door.
  const walk = [[11, H - 4], ...pts.map(([px, py]) => [px, py]), [pts[pts.length - 1][0], 6]];
  const out = { floor: f, grid: g, walk, len: walk.reduce((n, p, i) => i ? n + Math.hypot(p[0] - walk[i - 1][0], p[1] - walk[i - 1][1]) : 0, 0) };
  mapCache.set(f, out); return out;
}
// How far along the walk you are for the floor's progress: you stand still in
// the tall grass while a wild beast is up.
export function walkAt(pct) { let gone = 0, total = 0; for (const [a, b] of ENCOUNTERS) { total += b - a; gone += Math.max(0, Math.min(pct, b) - a); } return Math.max(0, Math.min(1, (pct - gone) / (1 - total))); }
export function posAt(route, t) {
  let d = Math.max(0, Math.min(1, t)) * route.len; const w = route.walk;
  for (let i = 1; i < w.length; i++) { const L = Math.hypot(w[i][0] - w[i - 1][0], w[i][1] - w[i - 1][1]); if (d <= L || i === w.length - 1) { const f = L ? Math.min(1, d / L) : 0; return { x: w[i - 1][0] + (w[i][0] - w[i - 1][0]) * f, y: w[i - 1][1] + (w[i][1] - w[i - 1][1]) * f, dx: Math.sign(w[i][0] - w[i - 1][0]), dy: Math.sign(w[i][1] - w[i - 1][1]) }; } d -= L; }
  return { x: w[0][0], y: w[0][1], dx: 0, dy: -1 };
}

// ── the battle, from the show's state ───────────────────────────────────────
// A wild beast while the floor's mana is inside an encounter (its HP is what's
// left of that slice); the rival's beast while a boss is up. Your beast's HP is
// the flashlight battery (sales keep it up). Beaten beasts join your shelf.
// THE RIVALS (2026-11-13: "does the bar in the center still give wrong stuff? Leaky roof kraken?"):
// Beasts has its own rival trainers, one a route, each with their own beast -- never the dungeon's boss.
export const RIVALS = [['SCALPER STEVE', 'FLIPWRAITH'], ['BAGGER BEV', 'POLYBAGGON'], ['MINT MARCY', 'MINTICORE'], ['LONGBOX LOU', 'BOXJAW'], ['SLABHEAD SAL', 'GRADEGOLEM'], ['FLIPPER FRAN', 'REPRICER'], ['DOLLAR BIN DEX', 'BINRAT'], ['CGC CARLA', 'CASECRAB']];
// The dungeon's rooms, as places on the route (2026-11-13: "Path? On pokemon"): the same vote, the same rewards, route names.
export const PLACES = { vault: ['🪙', 'GOLDEN GROTTO'], library: ['📚', 'READING MEADOW'], armory: ['🛡️', 'SLAB RIDGE'], forge: ['🔥', 'EMBER TRAIL'], crypt: ['🕯️', 'BARGAIN BOG'], lab: ['🧪', 'VARIANT WOODS'] };
export function placeFor(room) { const p = PLACES[room?.id || room]; return p ? { icon: p[0], name: p[1] } : { icon: room?.icon || '🌿', name: 'TALL GRASS' }; }
export function rivalFor(floor) { const [name, beast] = RIVALS[(Math.max(1, Math.floor(Number(floor) || 1)) - 1) % RIVALS.length]; return { name, beast }; }
export function battleFrom(d, { battery = 1, bossName = '', starter = '' } = {}) {
  if (!d) return null;
  const mine = { name: STARTERS.includes(starter) ? starter : STARTER, hp: Math.max(0.08, Math.min(1, battery)) };
  if (d.phase === 'boss') { const rv = rivalFor(d.floor); return { kind: 'rival', k: 3, mine, foe: { name: rv.beast, hp: Math.max(0, Math.min(1, (d.pct ?? 100) / 100)) }, trainer: rv.name }; }
  const pct = Math.max(0, Math.min(1, (d.pct || 0) / 100));
  for (let k = 0; k < ENCOUNTERS.length; k++) { const [a, b] = ENCOUNTERS[k]; if (pct >= a && pct < b) return { kind: 'wild', k, mine, foe: { name: wildName(d.floor, k), hp: 1 - (pct - a) / (b - a) } }; }
  return null;
}
export function shelfFrom(d) { if (!d) return []; const out = []; for (let f = 1; f <= d.floor; f++) for (let k = 0; k < ENCOUNTERS.length; k++) if (f < d.floor || (d.phase === 'boss' || (d.pct || 0) / 100 >= ENCOUNTERS[k][1])) out.push(wildName(f, k)); return out; }

// ── drawing ──────────────────────────────────────────────────────────────────
const put = (img, W, x, y, s) => { if (x < 0 || y < 0 || x >= W || y >= img.height || s < 0) return; const i = (y * W + x) * 4, c = GB[s]; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255; };
// One tile's pixel (shade) at (u, v) inside it; tm for the waving grass and water.
function tileShade(t, u, v, tx, ty, tm) {
  const h = (hashOf(tx * 131 + ty * 7919 + u * 17 + v) % 100);
  switch (t) {
    case 1: return h < 5 ? 1 : (u === 0 || v === 0) && h < 40 ? 1 : 0;               // path: light, pebbles
    case 2: { const sway = Math.floor(tm * 2 + tx * 0.7) % 2; const blade = (u + sway + (v >> 2) * 2) % 4; return v % 8 < 6 && blade < 2 ? 2 : v % 8 === 7 ? 3 : 1; } // tall grass, swaying
    case 3: { const cx = u - 7.5, cy = v - 6; if (v > 11 && Math.abs(cx) < 2) return 3; const d = cx * cx / 56 + cy * cy / 40; return d < 1 ? (d > 0.75 || (u + v) % 5 === 0 ? 3 : (u * 3 + v) % 7 === 0 ? 1 : 2) : 1; } // tree
    case 4: { const w = Math.floor(tm * 3 + tx) % 4; return (u + w * 2 + (v >> 2) * 3) % 8 === 0 && v % 4 === 1 ? 0 : 1; } // water, rippling
    case 5: return u === 0 || u === 15 ? 3 : v % 6 === 5 ? 2 : (u > 3 && u < 7 && v > 3 && v < 9) || (u > 9 && u < 13 && v > 3 && v < 9) ? 2 : 0; // wall with windows
    case 6: return v % 4 === 3 ? 3 : (u + (v >> 2)) % 3 === 0 ? 3 : 2;              // roof
    case 7: return u < 3 || u > 12 ? 0 : v < 2 ? 3 : u === 10 && v === 9 ? 0 : 3;     // door
    case 8: return (u % 8 === 3 || u % 8 === 4) && v > 3 ? 3 : (v === 6 || v === 11) ? 3 : 1; // fence
    case 9: { const b = Math.floor(tm * 1.5 + tx + ty) % 2; return (u % 6 === 2 && v % 6 === 2) || (b && u % 6 === 3 && v % 6 === 3) ? 3 : (u % 6 === 2 && v % 6 === 3) ? 0 : 1; } // flowers, nodding
    case 10: return (v > 9 && (u === 7 || u === 8)) ? 3 : v > 2 && v < 10 && u > 1 && u < 14 ? (v === 3 || v === 9 || u === 2 || u === 13 ? 3 : (v === 5 || v === 7) && u > 3 && u < 12 ? 2 : 0) : 0; // signpost
    case 11: case 12: return v > 1 && v < 14 ? (v === 2 || v === 13 || u === 0 || u === 15 ? 3 : 0) : 2; // a shop sign (letters drawn on top)
    default: return h < 7 ? 2 : h < 12 ? 0 : 1;                                       // grass: a shade darker than the path, tufts
  }
}
// A tiny 3 x 5 font (the shop signs, the "!" over your head).
const FONT = { A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', I: '111010010010111', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '101111111111101', O: '010101101101010', P: '110101110100100', R: '110101110110101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', '!': '010010010000010', ' ': '000000000000000' };
function text3(img, W, x, y, str, s) { [...str].forEach((ch, k) => { const g = FONT[ch] || FONT[' ']; for (let i = 0; i < 15; i++) if (g[i] === '1') put(img, W, x + k * 4 + (i % 3), y + Math.floor(i / 3), s); }); }

// THE HOST AND CHAMP, hand-drawn in four greens (store, 2026-11-13: "put us in
// there recognizable ... more like this generic style"): chibi overworld people,
// 16 x 16 -- big head, short body, dark outline, seen from a little above. The
// host in a backwards cap, a beard and his jersey (MP on the front, 24 on the
// back); Champ bald and shiny, glasses, a full beard, a big hoodie. Two walk
// frames each way ('.' see-through, '0' lightest .. '3' darkest); facing left
// is facing right, mirrored. Our own pixels, drawn here.
export const PEOPLE = {"host":{"down":[["....33333333....","...3333333333...","..333333323333..","..333330033333..","..300000000003..","..303300003303..","..303000000303..","..330001100033..","..333300003333..","...3333333333...","..331303303133..","..301300003103..","...3333333333...","....32222223....","....32233223....","....333..333...."],["....33333333....","...3333333333...","..333333323333..","..333330033333..","..300000000003..","..303300003303..","..303000000303..","..330001100033..","..333300003333..","...3333333333...","..331303303133..","..301300003103..","...3333333333...","....32222223....","....3223.223....","...333...333...."]],"up":[["....33333333....","...3333333333...","..333333333333..",".33333333333333.","..300000000003..","..300000000003..","..300000000003..","..330000000033..","..333300003333..","...3333333333...","..331003300133..","..301330033103..","...3333333333...","....32222223....","....32233223....","....333..333...."],["....33333333....","...3333333333...","..333333333333..",".33333333333333.","..300000000003..","..300000000003..","..300000000003..","..330000000033..","..333300003333..","...3333333333...","..331003300133..","..301330033103..","...3333333333...","....32222223....","....3223.223....","...333...333...."]],"side":[[".....33333333...","....3333333333..","...33333333333..",".333332333333...","....3000000003..","....3000003303..","....3000000303..","....30000000003.","....3333000333..",".....33333333...",".....33313333...",".....33310333...",".....33333333...",".....3222223....","....322223......","....33.33......."],[".....33333333...","....3333333333..","...33333333333..",".333332333333...","....3000000003..","....3000003303..","....3000000303..","....30000000003.","....3333000333..",".....33333333...",".....33313333...",".....33310333...",".....33333333...",".....3222223....","....32223.......","....333.33......"]]},"champ":{"down":[["....33333333....","...3000000003...","..300001100003..","..300000000003..","..333330033333..","..311130031113..","..333330033333..","..322000000223..","..322220022223..","...3222222223...",".33333333333333.",".30333222233303.",".33333333333333.","....32222223....","....32233223....","....333..333...."],["....33333333....","...3000000003...","..300001100003..","..300000000003..","..333330033333..","..311130031113..","..333330033333..","..322000000223..","..322220022223..","...3222222223...",".33333333333333.",".30333222233303.",".33333333333333.","....32222223....","....3223.223....","...333...333...."]],"up":[["....33333333....","...3000000003...","..300001100003..","..300000000003..","..330000000033..","..300000000003..","..300000000003..","..322000000223..","..322200002223..","...3332222333...",".33333333333333.",".30333333333303.",".33333333333333.","....32222223....","....32233223....","....333..333...."],["....33333333....","...3000000003...","..300001100003..","..300000000003..","..330000000033..","..300000000003..","..300000000003..","..322000000223..","..322200002223..","...3332222333...",".33333333333333.",".30333333333303.",".33333333333333.","....32222223....","....3223.223....","...333...333...."]],"side":[[".....33333333...","....3000000003..","...30000110003..","...30033333333..","...30003111133..","...30033333333..","...300000000003.","...32200000223..","...32222202223..","....322222223...","...33333333333..","...33333033333..","...33333333333..",".....3222223....","....322223......","....33.33......."],[".....33333333...","....3000000003..","...30000110003..","...30033333333..","...30003111133..","...30033333333..","...300000000003.","...32200000223..","...32222202223..","....322222223...","...33333333333..","...33333033333..","...33333333333..",".....3222223....","....32223.......","....333.33......"]]}};
export function drawSprite(img, W, x0, y0, who, dir, step) {
  const s = PEOPLE[who] || PEOPLE.host, rows = (dir === 'up' ? s.up : dir === 'down' ? s.down : s.side)[step ? 1 : 0], flip = dir === 'left';
  rows.forEach((row, y) => { for (let x = 0; x < 16; x++) { const ch = row[flip ? 15 - x : x]; if (ch !== '.') put(img, W, x0 + x, y0 + y, +ch); } });
}
// THE TRAINERS in a battle, bigger (40 x 48): the host and Champ side by side
// at the start of every battle; drawn from shapes here (original, not traced).
export function drawTrainer(img, W, x0, y0, who) {
  const P = (x, y, s) => put(img, W, x0 + Math.round(x), y0 + Math.round(y), s), champ = who === 'champ';
  const hx = 20, hy = champ ? 15 : 14, rx = champ ? 11 : 9.5, ry = champ ? 11.5 : 10.5;
  // The body first: the jersey (host) or the big hoodie (Champ), an arm out front.
  const bw = champ ? 15 : 11;
  for (let y = 26; y < 48; y++) for (let x = hx - bw - (y > 34 && champ ? 2 : 0); x <= hx + bw + (y > 34 && champ ? 2 : 0); x++) { const edge = x === hx - bw - (y > 34 && champ ? 2 : 0) || x === hx + bw + (y > 34 && champ ? 2 : 0) || y === 26; P(x, y, edge ? 3 : champ ? (y > 36 && y < 42 && Math.abs(x - hx) < 6 ? 2 : 3) : 3); }
  if (!champ) { for (let x = hx - bw + 1; x < hx - bw + 4; x++) for (const y of [33, 34]) P(x, y, 1); for (let x = hx + bw - 3; x < hx + bw; x++) for (const y of [33, 34]) P(x, y, 1); text3(img, W, x0 + hx - 4, y0 + 31, 'MP', 0); }
  for (let k = 0; k < 9; k++) { P(hx + bw - 1 + k, 30 - (k >> 1), 3); P(hx + bw - 1 + k, 31 - (k >> 1), 3); P(hx + bw - 1 + k, 32 - (k >> 1), k > 6 ? 0 : 3); } // the arm, reaching out
  for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0]]) P(hx + bw + 8 + a, 26 + b, 0); // the hand
  // The head.
  for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) { const d = ((x - hx) / rx) ** 2 + ((y - hy) / ry) ** 2; if (d > 1) continue; P(x, y, d > 0.84 ? 3 : 0); }
  if (champ) {
    for (let y = hy - 8; y < hy - 5; y++) for (let x = hx - 5; x < hx - 1; x++) P(x, y, 1); // the shine on his head
    for (const gx of [hx - 9, hx + 1]) { for (let x = gx; x < gx + 8; x++) { P(x, hy - 1, 3); P(x, hy + 4, 3); } for (let y = hy - 1; y <= hy + 4; y++) { P(gx, y, 3); P(gx + 7, y, 3); } for (let y = hy; y < hy + 4; y++) for (let x = gx + 1; x < gx + 7; x++) P(x, y, 1); P(gx + 4, hy + 2, 3); } // glasses
    for (let x = hx - 1; x <= hx + 1; x++) P(x, hy, 3);
    for (let y = hy + 5; y < hy + 13; y++) for (let x = 0; x < 40; x++) { const d = ((x - hx) / rx) ** 2 + ((y - hy) / ry) ** 2; if (d <= 1.08 && y > hy + 5 - (Math.abs(x - hx) > 7 ? 3 : 0)) P(x, y, (y === hy + 7 && Math.abs(x - hx) < 4) ? 0 : 2); } // the beard, a grin in it
  } else {
    // The backwards cap: the crown over the top, the brim out the back.
    for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) { const d = ((x - hx) / rx) ** 2 + ((y - hy) / ry) ** 2; if (d <= 1 && y < hy - 3) P(x, y, (y === hy - 4) ? 2 : (x === hx && y < hy - 6) ? 2 : 3); }
    for (let x = hx - rx - 6; x < hx - rx + 3; x++) { P(Math.round(x), hy - 4, 3); P(Math.round(x), hy - 3, 3); }
    for (let x = hx - 6; x < hx - 1; x++) P(x, hy - 1, 3); for (let x = hx + 2; x < hx + 7; x++) P(x, hy - 1, 3); // brows
    P(hx - 4, hy + 1, 3); P(hx - 3, hy + 1, 3); P(hx + 4, hy + 1, 3); P(hx + 5, hy + 1, 3); // eyes
    for (let y = hy + 4; y < hy + 12; y++) for (let x = 0; x < 40; x++) { const d = ((x - hx) / rx) ** 2 + ((y - hy) / ry) ** 2; if (d <= 1.12 && (y > hy + 5 || Math.abs(x - hx) > 6)) P(x, y, (y === hy + 6 && Math.abs(x - hx) < 3) ? 0 : 3); } // the beard, a grin
    P(hx - rx + 1, hy + 1, 1); P(hx - rx + 1, hy + 2, 1); // an ear
  }
}
// You (or your buddy): a big chibi head (your face, 12 x 12) on a small body,
// two-frame walk, four directions. Facing up you see the back of your head.
function drawPerson(img, W, x0, y0, face, dir, step, small = false) {
  const hx = x0 + 2, hy = y0;
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const round = (x - 5.5) ** 2 / 38 + (y - 5.5) ** 2 / 40 < 1; if (!round) continue;
    let s; if (dir === 'up') s = (x + y) % 5 === 0 ? 2 : 3; else { const fx = dir === 'left' ? 11 - x : x; s = validFace(face) ? +face[y * 12 + fx] : (y === 5 && (fx === 3 || fx === 8)) || (y === 8 && fx > 3 && fx < 8) ? 3 : y < 3 ? 3 : 0; }
    if ((x - 5.5) ** 2 / 38 + (y - 5.5) ** 2 / 40 > 0.82) s = 3; // the outline
    put(img, W, hx + x, hy + y, s);
  }
  // A light hoodie with a dark outline (so you never read as a tree), arms swinging, dark jeans, sneakers.
  const by = y0 + 12, bw = small ? 6 : 8, bx = x0 + 8 - bw / 2, bh = small ? 5 : 7, a = step ? 1 : 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) put(img, W, bx + x, by + y, x === 0 || x === bw - 1 || y === bh - 1 ? 3 : y === 0 && (x === 1 || x === bw - 2) ? 3 : x === (bw >> 1) && y > 1 ? 1 : 0);
  for (let y = 1; y < bh - 1; y++) { put(img, W, bx - 1, by + y + (y > 2 ? a : 0), y === bh - 2 ? 1 : 3); put(img, W, bx + bw, by + y + (y > 2 ? 1 - a : 0), y === bh - 2 ? 1 : 3); } // arms
  const legY = by + bh;
  for (let y = 0; y < 3; y++) { put(img, W, bx + 1 + (y === 2 ? -a : 0), legY + y, 2); put(img, W, bx + 2 + (y === 2 ? -a : 0), legY + y, y === 2 ? 3 : 2); put(img, W, bx + bw - 3 + (y === 2 ? a : 0), legY + y, 2); put(img, W, bx + bw - 2 + (y === 2 ? a : 0), legY + y, y === 2 ? 3 : 2); }
}

// THE OVERWORLD on a canvas: the route, you walking it, your buddy a step behind.
export function createWorld(canvas, { w = 240, h = 189 } = {}) {
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h);
  let first = true, state = { floor: 1, pct: 0, phase: 'floor' }, route = routeFor(1), shown = 0, raf = 0, last = 0, face = '', buddy = '', step = 0, dir = 'up', exclaim = -1e9;
  function set(s) {
    if (first || s.floor !== state.floor) { route = routeFor(s.floor); shown = s.phase === 'boss' ? 1 : walkAt((s.pct || 0) / 100); first = false; }
    const wasBattle = battleOf(state), isBattle = battleOf(s);
    if (isBattle && !wasBattle) exclaim = performance.now(); // a "!" over your head as the beast jumps out
    state = { ...state, ...s }; face = s.face ?? face; buddy = s.buddy ?? buddy;
  }
  const battleOf = s => s.phase === 'boss' || ENCOUNTERS.some(([a, b]) => (s.pct || 0) / 100 >= a && (s.pct || 0) / 100 < b);
  function frame(now) {
    raf = requestAnimationFrame(frame); if (now - last < 33) return; const dt = Math.min(0.2, (now - (last || now)) / 1000); last = now; const tm = now / 1000;
    const target = state.phase === 'boss' ? 1 : walkAt((state.pct || 0) / 100);
    const walking = shown < target - 0.0005; if (walking) shown = Math.min(target, shown + dt * Math.max(3.2 / route.len, (target - shown) / 10)); else if (shown > target) shown = target;
    const p = posAt(route, shown), q = posAt(route, Math.max(0, shown - 1.3 / route.len));
    if (walking) { step = Math.floor(tm * 6) % 2; dir = p.dy < 0 ? 'up' : p.dy > 0 ? 'down' : p.dx < 0 ? 'left' : p.dx > 0 ? 'right' : dir; } else step = 0;
    // The camera follows you (kept inside the map).
    const camX = Math.max(0, Math.min(MAP_W * T - w, (p.x + 0.5) * T - w / 2)), camY = Math.max(0, Math.min(MAP_H * T - h, (p.y + 0.5) * T - h * 0.58));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const wx = x + camX, wy = y + camY, tx = Math.floor(wx / T), ty = Math.floor(wy / T), t = route.grid[ty]?.[tx] ?? 3; put(img, w, x, y, tileShade(t, Math.floor(wx) % T, Math.floor(wy) % T, tx, ty, tm)); }
    // The shop signs.
    route.grid.forEach((row, ty) => row.forEach((t, tx) => { if (t === 11 || t === 12) text3(img, w, tx * T - camX + 8 - (t === 11 ? 12 : 10), ty * T - camY + 5, t === 11 ? 'COMICS' : 'RIVAL', 3); }));
    // Your buddy, then you (you're in front).
    const sx = x => Math.round((x + 0.5) * T - camX - 8), sy = y => Math.round((y + 0.5) * T - camY - 18);
    if (validFace(buddy)) drawPerson(img, w, sx(q.x), sy(q.y) + 4, buddy, dir, walking ? 1 - step : 0, true); else drawSprite(img, w, sx(q.x), sy(q.y) + 6, 'champ', dir, walking ? 1 - step : 0);
    if (validFace(face)) drawPerson(img, w, sx(p.x), sy(p.y), face, dir, step); else drawSprite(img, w, sx(p.x), sy(p.y) + 4, 'host', dir, step);
    if (performance.now() - exclaim < 1400) text3(img, w, sx(p.x) + 7, sy(p.y) - 14, '!', 3);
    ctx.putImageData(img, 0, 0);
  }
  return { set, start() { if (!raf) raf = requestAnimationFrame(frame); }, stop() { cancelAnimationFrame(raf); raf = 0; }, get route() { return route; } };
}

// THE BATTLE on a canvas (the overlay's handheld screen): your beast on the
// left facing right, theirs on the right facing left, HP bars over each, the
// four moves under them, the move chat picked lit up, and the attack itself.
export function createBattle(canvas, { scale = 3 } = {}) {
  // THE BATTLE (2026-11-13: "you did side view"): the wild beast faces you,
  // top right, on its patch of ground; yours is seen from behind, bottom left,
  // bigger (it's closer); their HP box top left, yours bottom right; the moves
  // and the line of text in the box along the bottom. Our own boxes and art.
  const W = 240, H = 160; canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d'), low = document.createElement('canvas'); low.width = W; low.height = H; const lx = low.getContext('2d'), img = lx.createImageData(W, H);
  let b = null, moves = DEFAULT_MOVES, pick = 0, anim = null, raf = 0, last = 0, msg = '', shownFoe = 1, beastCache = new Map(), introAt = -1e9, key = '', rival = null;
  const beast = (n, back = false) => { const k = n + (back ? '|back' : ''); if (!beastCache.has(k)) beastCache.set(k, makeBeast(n, { back })); return beastCache.get(k); };
  const fill = (x0, y0, w, h, s) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(img, W, x, y, s); };
  // A beast, animated: its idle frames (4 a second), a blink now and then; sinking out of sight when it's knocked out.
  const drawBeast = (bt, x0, y0, flash, k = 2, sink = 0) => { const t = performance.now() / 1000, blink = bt.blink && (t % 3.7) < 0.14, fr = blink ? bt.blink : bt.frames[Math.floor(t * 4) % 4], N = BEAST_SIZE, cut = N - Math.round(sink * N); for (let y = 0; y < cut; y++) for (let x = 0; x < N; x++) { const s = fr[y][x]; if (s < 0) continue; for (let a = 0; a < k; a++) for (let c = 0; c < k; c++) put(img, W, x0 + x * k + c, y0 + (y + Math.round(sink * N)) * k + a, flash ? 3 - s : s); } };
  const patch = (cx, cy, rx, ry) => { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) { const d = (x / rx) ** 2 + (y / ry) ** 2; if (d <= 1) put(img, W, cx + x, cy + y, d > 0.78 ? 3 : (x + y) % 3 === 0 ? 2 : 1); } };
  const hpBox = (x0, y0, name, f, mineBox) => { fill(x0, y0, 104, 26, 3); fill(x0 + 1, y0 + 1, 102, 24, 0); fill(x0 + 2, y0 + 23, 100, 1, 2); const bx = x0 + 18, by = y0 + 15; fill(bx, by, 80, 5, 3); fill(bx + 1, by + 1, 78, 3, 0); fill(bx + 1, by + 1, Math.max(0, Math.round(78 * f)), 3, f < 0.25 ? 3 : 2); if (mineBox) fill(x0 + 104, y0 + 8, 3, 18, 3); else fill(x0 - 3, y0 + 8, 3, 18, 3); };
  function words(line) { const S = scale; ctx.fillStyle = `rgb(${GB[3]})`; ctx.fillRect(0, 106 * S, W * S, 54 * S); ctx.fillStyle = `rgb(${GB[0]})`; ctx.fillRect(2 * S, 108 * S, (W - 4) * S, 50 * S); ctx.fillStyle = `rgb(${GB[3]})`; ctx.font = `${6 * S}px "Press Start 2P", monospace`; ctx.fillText(line, 10 * S, 126 * S); }
  function frame(now) {
    raf = requestAnimationFrame(frame); if (now - last < 33) return; last = now; const tm = now / 1000;
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] = GB[0][0]; img.data[i + 1] = GB[0][1]; img.data[i + 2] = GB[0][2]; img.data[i + 3] = 255; }
    if (!b) { lx.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(low, 0, 0, W * scale, H * scale); return; }
    // Their patch of ground (top right), yours (bottom left).
    patch(184, 66, 34, 7); patch(60, 104, 46, 8);
    const a = anim ? (now - anim.at) / 1300 : -1, hitT = a >= 0.55 && a < 0.85, shake = hitT ? Math.round(Math.sin(now / 18) * 3) : 0, bob = k => Math.round(Math.sin(tm * 3 + k) * 1.5);
    // THE INTRO (2.4 s): the host and Champ on the left, the rival on the right, then the beasts.
    const it = (now - introAt) / 2400;
    if (it >= 0 && it < 1) {
      const out = it > 0.62 ? (it - 0.62) / 0.38 : 0, slide = Math.round(out * out * 120);
      drawTrainer(img, W, 2 - slide, 54, 'host'); drawTrainer(img, W, 40 - slide, 54, 'champ');
      if (b.kind === 'rival' && rival) for (let y = 0; y < 44; y++) for (let x = 0; x < 44; x++) { const v = rival[y * 44 + x]; if (v >= 0) put(img, W, 162 + slide + x, 18 + y, v); }
      if (it < 0.62) { if (b.kind !== 'rival' || !rival) drawBeast(beast(b.foe.name), 152 + Math.round(Math.max(0, 0.25 - it) * 300), 4 + bob(1), false); lx.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(low, 0, 0, W * scale, H * scale); words(b.kind === 'rival' ? b.trainer.slice(0, 20) + ' WANTS TO BATTLE!' : 'A WILD ' + b.foe.name + ' JUMPED OUT!'); return; }
    }
    // Yours from behind (bigger, closer), lunging forward on an attack; theirs facing you.
    const lunge = a >= 0 && a < 0.25 ? Math.round(a * 32) : 0;
    drawBeast(beast(b.mine.name, true), 28 + lunge, 42 + bob(0) - lunge, false, 2);
    const faint = b.foe.hp <= 0.002 ? Math.min(1, Math.max(0, 1 - shownFoe * 50)) : 0;
    drawBeast(beast(b.foe.name), 152 + shake, 4 + bob(1), hitT && Math.floor(now / 60) % 2 === 0, 2, faint);
    // The attack: from yours (bottom left) up to theirs (top right).
    if (a >= 0 && a < 1) { const kind = anim.kind, f = Math.min(1, a / 0.6), x = 70 + f * 112, y = 74 - f * 30 - Math.sin(f * Math.PI) * 18, FX = 184, FY = 44;
      if (kind === 'coins') for (let k = 0; k < 7; k++) { const cx = FX - 18 + k * 6, cy = 4 + ((a * 120 + k * 13) % 50); fill(cx, cy, 3, 3, 3); fill(cx + 1, cy + 1, 1, 1, 0); }
      else if (kind === 'water') for (let k = 0; k < 9; k++) { const cx = FX - 14 + (k * 7) % 30, cy = 4 + ((a * 140 + k * 11) % 54); fill(cx, cy, 1, 3, 2); }
      else if (kind === 'flame') for (let k = 0; k < 6; k++) { const fx = x + Math.sin(k * 2 + a * 20) * 4, fy = y - k * 2; fill(Math.round(fx), Math.round(fy), 3 + (k % 2), 3, k % 2 ? 2 : 3); }
      else if (kind === 'zap') { let zx = 70, zy = 72; for (let k = 0; k < 12 && zx < x; k++) { const nx = zx + 10, ny = 72 - (k + 1) * 2.6 + (k % 2 ? -5 : 5); for (let t = 0; t <= 10; t++) put(img, W, Math.round(zx + (nx - zx) * t / 10), Math.round(zy + (ny - zy) * t / 10), 3); zx = nx; zy = ny; } }
      else if (kind === 'shout') for (let k = 0; k < 3; k++) { const r = ((a * 3 + k * 0.33) % 1) * 40; for (let t = 0; t < 24; t++) { const ang = -0.9 + t * 0.05; put(img, W, Math.round(70 + Math.cos(ang) * r * 2.6), Math.round(72 + Math.sin(ang) * r), 3); } }
      else if (kind === 'box') { const by = Math.min(32, -10 + a * 100); fill(FX - 9, Math.round(by), 18, 14, 2); fill(FX - 9, Math.round(by), 18, 1, 3); fill(FX - 9, Math.round(by) + 13, 18, 1, 3); fill(FX - 1, Math.round(by), 2, 14, 3); }
      else if (kind === 'slam') { if (a > 0.45 && a < 0.8) for (let k = 0; k < 8; k++) { const ang = k * Math.PI / 4, r = (a - 0.45) * 60; fill(Math.round(FX + Math.cos(ang) * r), Math.round(FY + Math.sin(ang) * r), 2, 2, 3); } }
      else if (kind === 'ball') { const bx = x, by2 = y - Math.abs(Math.sin(f * Math.PI * 2)) * 14; fill(Math.round(bx) - 2, Math.round(by2) - 2, 5, 5, 3); fill(Math.round(bx) - 1, Math.round(by2) - 1, 2, 2, 0); }
      else { const spin = Math.abs(Math.cos(a * 18)); const cw = Math.max(1, Math.round(6 * spin)); fill(Math.round(x - cw / 2), Math.round(y - 5), cw, 10, 3); if (cw > 2) fill(Math.round(x - cw / 2) + 1, Math.round(y - 4), cw - 2, 8, 0); }
      if (a > 0.55 && a < 0.62) for (let yy = 0; yy < 70; yy++) for (let xx = 150; xx < W; xx += 2) put(img, W, xx, yy, 0); // the hit's flash
    }
    if (anim && a >= 1) anim = null;
    shownFoe += ((b.foe.hp) - shownFoe) * 0.12;
    // Their box top left, yours bottom right; the box along the bottom.
    hpBox(6, 6, b.foe.name, Math.max(0, shownFoe), false); hpBox(130, 76, b.mine.name, b.mine.hp, true);
    fill(0, 106, W, 54, 3); fill(2, 108, W - 4, 50, 0); fill(4, 110, W - 8, 1, 2);
    lx.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(low, 0, 0, W * scale, H * scale);
    // Words in a crisp pixel font, at the screen's size.
    const S = scale, tx = (s, x, y, size = 7, c = GB[3]) => { ctx.fillStyle = `rgb(${c})`; ctx.font = `${size * S}px "Press Start 2P", monospace`; ctx.fillText(s, x * S, y * S); };
    tx(b.foe.name.slice(0, 11), 10, 17, 6); tx('HP', 9, 25, 5); tx(b.mine.name.slice(0, 11), 134, 87, 6); tx('HP', 133, 95, 5);
    tx(it >= 0.62 && it < 1 ? b.mine.name + ', GO!' : msg || (b.kind === 'rival' ? b.trainer.slice(0, 22) + ' SENT OUT ' + b.foe.name.slice(0, 10) + '!' : 'WHAT WILL ' + b.mine.name + ' DO?'), 10, 122, 6);
    moves.forEach((m, i) => { const x = 14 + (i % 2) * 112, y = 138 + Math.floor(i / 2) * 13; if (i === pick) { ctx.fillStyle = `rgb(${GB[2]})`; ctx.fillRect((x - 6) * S, (y - 9) * S, 108 * S, 11 * S); } tx((i + 1) + ' ' + m, x, y, 6, i === pick ? GB[0] : GB[3]); });
  }
  return {
    set(next, { moves: mv, pick: p } = {}) { const k = next ? next.kind + '|' + next.foe.name : ''; if (k && k !== key) { introAt = performance.now(); shownFoe = next.foe.hp; } key = k; b = next; if (mv) moves = mv; if (Number.isInteger(p)) pick = p; if (!b) { msg = ''; shownFoe = 1; } },
    // The rival trainer, from any picture (the boss's art), turned into four greens at 44 x 44.
    setRival(src) { if (!src) { rival = null; return; } const c = document.createElement('canvas'); c.width = c.height = 44; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, 44, 44); const d = x.getImageData(0, 0, 44, 44).data; rival = new Int8Array(44 * 44); for (let i = 0; i < rival.length; i++) { const a = d[i * 4 + 3], l = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11; rival[i] = a < 120 ? -1 : l > 190 ? 0 : l > 130 ? 1 : l > 70 ? 2 : 3; } },
    // A move fired (chat's pick, on a sale): its animation and the line of text.
    attack(name) { const i = moves.indexOf(String(name).toUpperCase()); if (i >= 0) pick = i; anim = { kind: moveAnim(name), at: performance.now() }; msg = (b?.mine?.name || STARTER) + ' USED ' + String(name).toUpperCase() + '!'; clearTimeout(this.t); this.t = setTimeout(() => { msg = ''; }, 2600); },
    start() { if (!raf) raf = requestAnimationFrame(frame); }, stop() { cancelAnimationFrame(raf); raf = 0; },
  };
}
