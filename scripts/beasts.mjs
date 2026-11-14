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
const lineOf = nm => Object.values(EVOLUTIONS).find(l => l.includes(nm));
export function beastType(name) { const nm0 = String(name).toUpperCase(), line = lineOf(nm0), nm = line ? line[0] : nm0; if (nm === 'SLABBIT') return 'biped'; if (nm === 'TOPLOADON') return 'quad'; if (nm === 'SLEEVIL') return 'biped'; if (/MOTH|OWL/.test(nm)) return 'bird'; if (/SNAIL|TOAD/.test(nm)) return 'blob'; if (/IMP|PUP/.test(nm)) return 'biped'; if (/OX|AROO/.test(nm)) return 'quad'; return TYPES[hashOf(nm + 't') % TYPES.length]; }
export function makeBeast(name, { back = false } = {}) {
  const nm = String(name).toUpperCase(), type = beastType(nm), r = seq(hashOf(nm)), N = BEAST_SIZE;
  const shape = { w: 0.9 + r() * 0.25, h: 0.9 + r() * 0.2, ear: Math.floor(r() * 3), tail: r() < 0.7, spots: r() < 0.5, horn: r() < 0.3 };
  // An evolved form: bigger, and at the last stage a horn and markings (the line keeps its look).
  const ln = lineOf(nm), st = ln ? ln.indexOf(nm) : 0; if (st) { shape.w = Math.min(1.2, shape.w + 0.08 * st); shape.h = Math.min(1.15, shape.h + 0.06 * st); shape.tail = true; if (st >= 2) { shape.horn = true; shape.spots = true; } }
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
// 7 door, 8 fence, 9 flowers, 10 sign, 11 your shop's sign, 12 the rival's sign,
// 13 boulder, 14 sand, 15 bridge, 16 ledge.
// LONGER, AND NEVER THE SAME TWICE (store, 2026-11-13: "we also need longer
// route. Varying scenery"): 128 tiles from your shop to the rival's, in three
// stretches, each its own kind of country -- open meadow, deep woods, a lake
// with a sandy shore, a river with a bridge, rocky ledges, a flower field --
// picked by the route's number (the same route looks the same on every screen;
// nothing by chance). A rest stop halfway: a little house and a sign. The path
// turns in straight runs, so you walk (and face) up, left or right.
export const MAP_W = 28, MAP_H = 128;
// MORE COUNTRY (store, 2026-11-14): a cave (dark, the host's lantern lights the way), a beach on the ocean, a
// snowfield, a city street, a graveyard and a volcano join the meadow, woods, lake, river, ledges and flowers.
export const BIOMES = ['meadow', 'woods', 'lake', 'river', 'rocky', 'flowers', 'cave', 'beach', 'snow', 'city', 'graveyard', 'volcano'];
export function biomesFor(floor) { const f = Math.max(1, floor | 0), h = hashOf('biomes' + f), out = []; for (let k = 0; k < 3; k++) { let b = BIOMES[(h >>> (k * 5)) % BIOMES.length]; if (out.includes(b)) b = BIOMES[(BIOMES.indexOf(b) + 1 + k) % BIOMES.length]; out.push(b); } return out; }
const mapCache = new Map();
export function routeFor(floor) {
  const f = Math.max(1, floor | 0); if (mapCache.has(f)) return mapCache.get(f);
  const r = seq(hashOf('route' + f)), W = MAP_W, H = MAP_H, g = Array.from({ length: H }, () => Array(W).fill(0));
  const inMap = (x, y) => y >= 0 && y < H && x >= 2 && x < W - 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 2 || x >= W - 2) g[y][x] = 3;
  // The path's corners: straight runs north, then across (never diagonal).
  const TOP = 8, BOT = H - 10, corners = [[13, BOT]]; let x = 13;
  for (let y = BOT - 6; y > TOP + 2; y -= 6 + Math.floor(r() * 5)) { const nx = Math.max(5, Math.min(W - 7, x + Math.round((r() - 0.5) * 16))); corners.push([x, y]); if (nx !== x) corners.push([nx, y]); x = nx; }
  corners.push([x, TOP]);
  const pathTiles = new Set(), lay = (x0, y0, x1, y1) => { for (let yy = Math.min(y0, y1); yy <= Math.max(y0, y1); yy++) for (let xx = Math.min(x0, x1); xx <= Math.max(x0, x1); xx++) for (const [ax, ay] of [[0, 0], [1, 0]]) if (inMap(xx + ax, yy + ay)) { g[yy + ay][xx + ax] = 1; pathTiles.add((xx + ax) + ',' + (yy + ay)); } };
  for (let i = 1; i < corners.length; i++) lay(corners[i - 1][0], corners[i - 1][1], corners[i][0], corners[i][1]);
  const nearPath = (x2, y2, d = 1) => { for (let yy = -d; yy <= d; yy++) for (let xx = -d; xx <= d; xx++) if (pathTiles.has((x2 + xx) + ',' + (y2 + yy))) return true; return false; };
  // Three stretches of country.
  const biomes = biomesFor(f), zoneOf = y => y < TOP + (BOT - TOP) / 3 ? 2 : y < TOP + 2 * (BOT - TOP) / 3 ? 1 : 0;
  for (let y = TOP + 1; y < BOT; y++) for (let x2 = 2; x2 < W - 2; x2++) {
    if (g[y][x2] !== 0) continue; const v = r(), bio = biomes[zoneOf(y)], close = nearPath(x2, y);
    if (bio === 'meadow') g[y][x2] = v < 0.08 && !close ? 3 : v < 0.12 ? 9 : 0;
    else if (bio === 'woods') g[y][x2] = !close && v < 0.55 ? 3 : v < 0.6 ? 9 : 0;
    else if (bio === 'rocky') g[y][x2] = !close && v < 0.16 ? 13 : !close && v < 0.22 ? 3 : 0;
    else if (bio === 'flowers') g[y][x2] = v < 0.38 ? 9 : !close && v < 0.42 ? 3 : 0;
    else if (bio === 'cave') g[y][x2] = nearPath(x2, y, 2) ? 18 : 17;
    else if (bio === 'beach') g[y][x2] = !close && v < 0.03 ? 3 : 14;
    else if (bio === 'snow') g[y][x2] = !close && v < 0.12 ? 3 : 19;
    else if (bio === 'city') g[y][x2] = close && v < 0.1 ? 21 : 20;
    else if (bio === 'graveyard') g[y][x2] = !close && v < 0.16 ? 22 : !close && v < 0.21 ? 3 : 0;
    else if (bio === 'volcano') g[y][x2] = !close && v < 0.1 ? 23 : !close && v < 0.18 ? 13 : 24;
    else g[y][x2] = !close && v < 0.1 ? 3 : 0;
  }
  biomes.forEach((bio, z) => {
    const y0 = Math.round(TOP + (2 - z) * (BOT - TOP) / 3), y1 = Math.round(TOP + (3 - z) * (BOT - TOP) / 3), mid = Math.round((y0 + y1) / 2);
    if (bio === 'lake') { // a lake beside the path, a sandy shore
      const side = corners.find(c => c[1] <= mid)?.[0] > W / 2 ? 4 : W - 12; for (let y = y0 + 3; y < y1 - 3; y++) for (let x2 = side; x2 < side + 8; x2++) { if (!inMap(x2, y) || nearPath(x2, y)) continue; const d = ((x2 - side - 3.5) / 4.5) ** 2 + ((y - mid) / ((y1 - y0) / 2 - 3)) ** 2; if (d < 0.8) g[y][x2] = 4; else if (d < 1.1) g[y][x2] = 14; }
    }
    if (bio === 'river') { // a river across, a bridge where the path crosses
      for (const y of [mid, mid + 1]) for (let x2 = 2; x2 < W - 2; x2++) g[y][x2] = pathTiles.has(x2 + ',' + y) ? 15 : 4;
      for (const y of [mid - 1, mid + 2]) for (let x2 = 2; x2 < W - 2; x2++) if (g[y][x2] !== 1 && g[y][x2] !== 15) g[y][x2] = 14;
    }
    if (bio === 'beach') { // the ocean along one side, a ragged shoreline
      const left = (corners.find(c => c[1] <= mid)?.[0] ?? 13) > W / 2;
      for (let y = y0 + 1; y < y1 - 1; y++) { const reach = 6 + (hashOf('shore' + f + y) % 3); for (let k = 0; k < reach; k++) { const x2 = left ? 2 + k : W - 3 - k; if (inMap(x2, y) && !nearPath(x2, y, 2)) g[y][x2] = 4; } }
    }
    if (bio === 'volcano') { // a lava river off to the side, rock walls along it
      for (let y = y0 + 2; y < y1 - 2; y++) for (const x2 of [3, 4, W - 5, W - 4]) if (inMap(x2, y) && !nearPath(x2, y, 2)) g[y][x2] = (y + x2) % 5 ? 23 : 13;
    }
    if (bio === 'rocky') { // ledges across the hill, the path cut through
      for (let y = y0 + 4; y < y1 - 2; y += 7) for (let x2 = 2; x2 < W - 2; x2++) if (!pathTiles.has(x2 + ',' + y) && g[y][x2] !== 4) g[y][x2] = 16;
    }
  });
  // Tall grass where the wild beasts wait (around the path at each encounter).
  const walk = [[11, H - 4], [13, H - 4], ...corners];
  const len = walk.reduce((n, p, i) => i ? n + Math.abs(p[0] - walk[i - 1][0]) + Math.abs(p[1] - walk[i - 1][1]) : 0, 0);
  const route0 = { walk, len };
  ENCOUNTERS.forEach(([a, b]) => { const p = posAt(route0, walkAt((a + b) / 2)), ex = Math.round(p.x), ey = Math.round(p.y); for (let y = ey - 4; y <= ey + 4; y++) for (let x2 = ex - 4; x2 <= ex + 5; x2++) if (inMap(x2, y) && ![4, 15, 16, 17, 21, 22, 23].includes(g[y][x2])) g[y][x2] = 2; });
  // Your shop's town at the bottom: the shop, two houses, a fence, a sign.
  const house = (hx, hy, sign) => { for (let x2 = hx; x2 < hx + 5; x2++) { g[hy][x2] = 6; g[hy + 1][x2] = 6; g[hy + 2][x2] = 5; g[hy + 3][x2] = 5; } g[hy + 3][hx + 2] = 7; if (sign) g[hy + 1][hx + 2] = sign; };
  for (let y = BOT + 1; y < H - 1; y++) for (let x2 = 2; x2 < W - 2; x2++) g[y][x2] = 0;
  house(9, H - 8, 11); house(3, H - 7, 0); house(18, H - 7, 0);
  lay(11, H - 4, 13, H - 4); lay(13, H - 4, 13, BOT);
  for (let x2 = 2; x2 < W - 2; x2++) if (g[H - 2][x2] === 0) g[H - 2][x2] = 8;
  g[H - 4][16] = 10;
  // City blocks: shops along the street.
  biomes.forEach((bio, z) => { if (bio !== 'city') return; const y0 = Math.round(TOP + (2 - z) * (BOT - TOP) / 3); for (let k = 0; k < 3; k++) { const hy = y0 + 4 + k * 12; for (const hx of [3, W - 8]) { let ok = inMap(hx, hy) && inMap(hx + 4, hy + 3); for (let yy = hy; ok && yy < hy + 5; yy++) for (let xx = hx - 1; ok && xx < hx + 6; xx++) if (pathTiles.has(xx + ',' + yy)) ok = false; if (ok) house(hx, hy, 0); } } });
  // A rest stop halfway (route 2 on): a little house by the path, a sign.
  if (f >= 2) { const c = corners[Math.floor(corners.length / 2)], hx = c[0] > W / 2 ? 3 : W - 9, hy = c[1] - 2; if (inMap(hx, hy) && inMap(hx + 5, hy + 4)) { house(hx, hy, 0); g[hy + 4] && (g[hy + 4][hx + 2] = 1); g[hy + 4] && (g[hy + 4][hx + 5] = 10); } }
  // The rival's shop at the top.
  for (let y = 1; y < TOP; y++) for (let x2 = 2; x2 < W - 2; x2++) g[y][x2] = y < 2 ? 3 : 0;
  lay(x, TOP, x, TOP - 1); house(x - 2, 2, 12);
  // Every 5th route ends at a GYM: a wider hall, pillars at the door.
  if (isGym(f)) { const gx = Math.max(3, Math.min(W - 10, x - 3)); for (let x2 = gx; x2 < gx + 7; x2++) { g[2][x2] = 6; g[3][x2] = 6; g[4][x2] = 5; g[5][x2] = 5; } g[5][x] = 7; g[3][x] = 12; g[5][gx] = 13; g[5][gx + 6] = 13; }
  walk.push([x, 6]);
  const bands = [0, 1, 2].map(z => [Math.round(TOP + (2 - z) * (BOT - TOP) / 3), Math.round(TOP + (3 - z) * (BOT - TOP) / 3)]);
  const biomeAt = y => { for (let z = 0; z < 3; z++) if (y >= bands[z][0] && y < bands[z][1]) return biomes[z]; return ''; };
  const out = { floor: f, grid: g, walk, biomes, biomeAt, items: itemsFor(f), len: walk.reduce((n, p, i) => i ? n + Math.abs(p[0] - walk[i - 1][0]) + Math.abs(p[1] - walk[i - 1][1]) : 0, 0) };
  mapCache.set(f, out); return out;
}
// How far along the walk you are for the floor's progress: you stand still in
// the tall grass while a wild beast is up.
export function walkAt(pct) { let gone = 0, total = 0; for (const [a, b] of ENCOUNTERS) { total += b - a; gone += Math.max(0, Math.min(pct, b) - a); } return Math.max(0, Math.min(1, (pct - gone) / (1 - total))); }
// ITEMS ON THE PATH (store, 2026-11-14): four on every route, at fixed spots between the patches of tall grass --
// the same items in the same places on every screen (from the route's number; nothing by chance). You pick each
// one up as you walk past it.
export const ITEM_KINDS = ['BERRY', 'POTION', 'CANDY', 'STONE', 'BERRY', 'ETHER', 'COIN', 'POTION'];
export const ITEM_SPOTS = [0.12, 0.41, 0.65, 0.88];
export function itemsFor(route) { const f = Math.max(1, route | 0); return ITEM_SPOTS.map((t, k) => ({ t, kind: k === 3 && isGym(f) ? 'STONE' : ITEM_KINDS[(hashOf('item' + f + ':' + k)) % ITEM_KINDS.length] })); }
// GYMS (store, 2026-11-14): every 5th route ends at a gym; its leader's beast has twice the HP, its badge is a gym badge.
export const GYM_EVERY = 5;
export const isGym = route => (Math.max(1, route | 0)) % GYM_EVERY === 0;
export const GYM_LEADERS = [['LEADER GRADY', 'SLABTITAN'], ['LEADER FOLIA', 'HOLOPHOENIX'], ['LEADER MINTY', 'GEMMINTAUR'], ['LEADER KEYS', 'KEYSTONEX'], ['LEADER VARIA', 'VARIANTRIX']];
export const toGym = route => { const r = Math.max(1, route | 0); return (GYM_EVERY - (r % GYM_EVERY)) % GYM_EVERY; };
// CHAT'S GIFTS (store, 2026-11-14): a follow, share or bookmark the host taps in drops a gift a few steps ahead on
// the path (for everyone watching -- nothing tied to buying, no names).
export const DROP_AHEAD = 0.04;
export function addBeastDrop(bIn, kind, s, now = Date.now()) {
  const b = { ...(bIn || emptyBeasts()) }; if (b.phase !== 'route') return b;
  const t = Math.min(0.985, walkAt(Math.min(1, (Number(b.xp) || 0) / beastGoal(s || {}, b.route))) + DROP_AHEAD);
  b.drops = [...(b.drops || []), { kind: String(kind || 'follow').toLowerCase().slice(0, 12), route: b.route, t: Math.round(t * 1000) / 1000, at: now }].slice(-12);
  return b;
}
export function posAt(route, t) {
  let d = Math.max(0, Math.min(1, t)) * route.len; const w = route.walk;
  for (let i = 1; i < w.length; i++) { const dx = w[i][0] - w[i - 1][0], dy = w[i][1] - w[i - 1][1], L = Math.abs(dx) + Math.abs(dy); if (d <= L || i === w.length - 1) { const f = L ? Math.min(1, d / L) : 0; return { x: w[i - 1][0] + dx * f, y: w[i - 1][1] + dy * f, dx: Math.sign(dx), dy: Math.sign(dy) }; } d -= L; }
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
export function rivalFor(floor) { const r = Math.max(1, Math.floor(Number(floor) || 1)); if (isGym(r)) { const [name, beast] = GYM_LEADERS[(r / GYM_EVERY - 1) % GYM_LEADERS.length]; return { name, beast, gym: true }; } const [name, beast] = RIVALS[(r - 1) % RIVALS.length]; return { name, beast }; }
// THE FOE HITS BACK (store, 2026-11-13: "we never get hit by the other monster? What happens if we lose a battle?"):
// while no sales come in, your beast's HP drains and the other beast attacks (a hit for each tenth lost); at 0 it
// faints -- nothing is lost, but it can't fight until chat revives it (a follow, share or bookmark) or a sale comes in.
export const FOE_MOVES = ['PAPER CUT', 'DOG EAR', 'SPINE ROLL', 'SUN FADE', 'STATIC CLING', 'RUSTY STAPLE', 'PRICE HIKE', 'WATER SPOT', 'COFFEE RING', 'BENT STAPLE'];
export const foeMoveFor = (name, n = 0) => FOE_MOVES[(hashOf(String(name)) + n) % FOE_MOVES.length];
export const BEAST_DRAIN_MS = 5 * 60000;
// Your beast's HP from the last sale or chat tap (lastAt): full, draining to 0 over BEAST_DRAIN_MS.
export function beastHpFrom(lastAt, now = Date.now()) { const l = Number(lastAt) || 0; if (!l) return 1; return Math.max(0, Math.min(1, 1 - (now - l) / BEAST_DRAIN_MS)); }
export function battleFrom(d, { battery = 1, bossName = '', starter = '' } = {}) {
  if (!d) return null;
  const lv = Number(d.level) || 1, mine = { name: formName(starter, lv), level: lv, hp: Math.max(0, Math.min(1, battery)) };
  if (d.phase === 'boss') { const rv = rivalFor(d.floor); return { kind: 'rival', k: 3, mine, foe: { name: rv.beast, hp: Math.max(0, Math.min(1, (d.pct ?? 100) / 100)) }, trainer: rv.name }; }
  const pct = Math.max(0, Math.min(1, (d.pct || 0) / 100));
  for (let k = 0; k < ENCOUNTERS.length; k++) { const [a, b] = ENCOUNTERS[k]; if (pct >= a && pct < b) return { kind: 'wild', k, mine, foe: { name: wildName(d.floor, k), hp: 1 - (pct - a) / (b - a) } }; }
  return null;
}
export function shelfFrom(d) { if (!d) return []; const out = []; for (let f = 1; f <= d.floor; f++) for (let k = 0; k < ENCOUNTERS.length; k++) if (f < d.floor || (d.phase === 'boss' || (d.pct || 0) / 100 >= ENCOUNTERS[k][1])) out.push(wildName(f, k)); return out; }

// ── THE GAME ITSELF, ITS OWN (store, 2026-11-13: "they should be totally separate games") ──
// Beasts keeps its own progress -- the route, the dollars toward the rival, the
// rival's HP, the beasts you've beaten, the badges -- apart from the dungeon's
// floors, chests and doors. Sales (and chat's follows / shares / bookmarks) walk
// you up the route; the three wild beasts on it fall as you pass their patch of
// grass; at the top the route's rival sends out their beast; beat it for the
// route's badge and the next route opens. Week by week, like the dungeon, but
// on its own track. Nothing by chance; nothing won by buying.
const r2b = n => Math.round(n * 100) / 100;
export const beastGoal = (s, route) => Math.max(1, Math.round((Number(s.beastsGoal) || 100) * Math.pow(1 + (Number(s.beastsGrowth) || 0) / 100, Math.max(0, route - 1))));
export const rivalMax = (s, route) => Math.max(1, Math.round(beastGoal(s, route) / 2) * (isGym(route) ? 2 : 1));
// LEVELS AND EVOLUTION (store, 2026-11-13: "can our monster level up and evolve? We need more to this game ...
// tie into us selling on Whatnot and keeping the viewers watching"): every dollar sold (and chat's follows, shares,
// bookmarks) is XP; levels come at 10, 30, 60, 100 ... XP; a new attack to learn every 5 levels (chat names it);
// at LV 10 and LV 20 your beast evolves -- each starter has its own line, our own names. The level lasts the week.
export const EVOLUTIONS = { SLABBIT: ['SLABBIT', 'SLABBUNNY', 'GRADEZILLA'], TOPLOADON: ['TOPLOADON', 'TOPLOADRAKE', 'TITANLOADER'], SLEEVIL: ['SLEEVIL', 'SLEEVILLAIN', 'OVERSLEEVOR'] };
export const EVOLVE_AT = [10, 20], LEARN_EVERY = 5, MAX_LEVEL = 50;
export const xpFor = level => 5 * (level - 1) * level; // the XP a level starts at (LV 2: 10, LV 5: 100, LV 10: 450, LV 20: 1900)
export function levelFor(exp) { let l = 1; while (l < MAX_LEVEL && xpFor(l + 1) <= (Number(exp) || 0)) l++; return l; }
export const stageFor = level => EVOLVE_AT.filter(a => level >= a).length;
export function formName(starter, level) { const line = EVOLUTIONS[STARTERS.includes(starter) ? starter : STARTER]; return line[Math.min(line.length - 1, stageFor(level))]; }
// The moment a batch of events puts on screen (the server and the preview demo alike): an evolution, a badge,
// the rival stepping up, a new move to learn, a wild beast beaten. A plain level up returns null (the sale keeps its moment).
export function beastMoment(events, starter = '', reward = '') {
  const st = STARTERS.includes(starter) ? starter : STARTER, ev = events.filter(x => x.kind === 'evolve').pop();
  if (ev) { const line = EVOLUTIONS[st]; return { kind: 'beast', beastEvent: 'evolve', beastName: line[ev.stage] || '', fromName: line[ev.stage - 1] || '', level: ev.level, reward: reward || '' }; }
  const lv = events.filter(x => x.kind === 'level').pop(), big = events.filter(x => x.kind === 'badge').pop() || events.filter(x => x.kind === 'rival').pop();
  const e = big || (lv?.learn ? lv : null) || events.filter(x => x.kind === 'caught').pop();
  if (!e) return null;
  if (e.kind === 'level') return { kind: 'beast', beastEvent: 'learn', beastName: formName(st, e.level), level: e.level };
  return { kind: 'beast', beastEvent: e.kind, beastName: e.kind === 'caught' ? e.name : e.beast, trainer: e.trainer || '', route: e.route, badges: e.badges, ...(e.gym || isGym(e.route) && e.kind !== 'caught' ? { gym: true } : {}), ...(lv ? { level: lv.level } : {}) };
}
// THE BEASTDEX SHELF: the beasts you've beaten this week, in a row (newest last), with the count.
export function drawShelf(canvas, names = [], { count = 0, scale = 2 } = {}) {
  const list = names.slice(-10), N = BEAST_SIZE, W = 10 * (N + 4) + 120, H = N + 8; canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(W, H);
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = GB[1][0]; img.data[i + 1] = GB[1][1]; img.data[i + 2] = GB[1][2]; img.data[i + 3] = 255; }
  for (let x = 0; x < W; x++) { put(img, W, x, 0, 3); put(img, W, x, H - 1, 3); } for (let y = 0; y < H; y++) { put(img, W, 0, y, 3); put(img, W, W - 1, y, 3); }
  text3(img, W, 6, 8, 'BEASTDEX', 3); const n = String(count || list.length); [...n].forEach((d, k) => text3(img, W, 6 + k * 4, 18, d, 3));
  list.forEach((nm, k) => { const px = makeBeast(nm).frames[0], x0 = 116 + k * (N + 4), y0 = 4; px.forEach((row, y) => row.forEach((v, x) => { if (v >= 0) put(img, W, x0 + x, y0 + y, v); })); });
  ctx.putImageData(img, 0, 0); canvas.style.imageRendering = 'pixelated'; canvas.style.width = W * scale + 'px'; canvas.style.height = H * scale + 'px';
}
export function emptyBeasts(week = '') { return { week, route: 1, phase: 'route', xp: 0, rivalHp: 0, exp: 0, caught: [], badges: [], lastAt: 0 }; }
export function ensureBeasts(b, week = '') { if (b && b.week === week) return b; const fresh = emptyBeasts(week); if (b?.week) fresh.lastWeek = { week: b.week, route: b.route, badges: (b.badges || []).length, caught: (b.caught || []).length }; return fresh; }
// Dollars in: walk the route (passing the wild beasts), then the rival's HP; leftovers carry on.
// Returns { beasts, events } -- { kind:'caught', name }, { kind:'rival', trainer, beast }, { kind:'badge', route, trainer, beast }.
export function addBeastXp(bIn, amount, s, now = Date.now()) {
  const b = { ...bIn, caught: [...(bIn.caught || [])], badges: [...(bIn.badges || [])] }, events = [];
  if (!(amount > 0)) return { beasts: b, events };
  const lv0 = levelFor(b.exp || 0); b.exp = r2b((b.exp || 0) + amount); const lv1 = levelFor(b.exp);
  if (lv1 > lv0) { const learn = Math.floor(lv1 / LEARN_EVERY) > Math.floor(lv0 / LEARN_EVERY); events.push({ kind: 'level', level: lv1, learn }); const st0 = stageFor(lv0), st1 = stageFor(lv1); if (st1 > st0) events.push({ kind: 'evolve', level: lv1, stage: st1 }); }
  let left = r2b(amount);
  for (let guard = 0; left > 0 && guard < 60; guard++) {
    if (b.phase === 'route') {
      const goal = beastGoal(s, b.route), before = b.xp / goal, need = r2b(goal - b.xp);
      const take = Math.min(left, need); b.xp = r2b(b.xp + take); left = r2b(left - take);
      const after = b.xp / goal;
      ENCOUNTERS.forEach(([, end], k) => { if (before < end && after >= end) { const name = wildName(b.route, k); b.caught.push({ name, route: b.route, at: now }); events.push({ kind: 'caught', name, route: b.route }); } });
      if (b.xp >= goal) { b.phase = 'rival'; b.rivalHp = rivalMax(s, b.route); const rv = rivalFor(b.route); events.push({ kind: 'rival', route: b.route, trainer: rv.name, beast: rv.beast }); }
    } else {
      if (left < b.rivalHp) { b.rivalHp = r2b(b.rivalHp - left); left = 0; break; }
      left = r2b(left - b.rivalHp); const rv = rivalFor(b.route);
      b.badges.push({ route: b.route, trainer: rv.name, at: now, ...(rv.gym ? { gym: true } : {}) }); events.push({ kind: 'badge', route: b.route, trainer: rv.name, beast: rv.beast, badges: b.badges.length, ...(rv.gym ? { gym: true } : {}) });
      b.route += 1; b.phase = 'route'; b.xp = 0; b.rivalHp = 0;
    }
  }
  b.lastAt = now;
  return { beasts: b, events };
}
// The host's fixes: set the route, or start Beasts' week over.
export function adjustBeasts(bIn, { route, reset } = {}, week = '', now = Date.now()) {
  if (reset) return { ...emptyBeasts(week), lastAt: now };
  const n = Math.floor(Number(route));
  if (!Number.isFinite(n) || n < 1 || n > 99) throw new Error('Route 1 to 99');
  return { ...bIn, route: n, phase: 'route', xp: 0, rivalHp: 0, lastAt: now };
}
// What the screens see (floor and pct keep the drawing code's names: floor is the route).
export function publicBeasts(bIn, s, starter = '') {
  const b = bIn || emptyBeasts(), exp = Number(b.exp) || 0, level = levelFor(exp), nextEvo = EVOLVE_AT.find(a => a > level), goal = beastGoal(s, b.route), max = rivalMax(s, b.route), rv = rivalFor(b.route), rival = b.phase === 'rival';
  return { route: b.route, floor: b.route, phase: rival ? 'boss' : 'floor', stage: rival ? 'rival' : 'route', xp: b.xp, goal, pct: rival ? Math.round(b.rivalHp / max * 1000) / 10 : Math.round(Math.min(1, b.xp / goal) * 1000) / 10, rival: { name: rv.name, beast: rv.beast, hp: rival ? b.rivalHp : max, max }, caught: (b.caught || []).slice(-24).map(c => c.name), caughtCount: (b.caught || []).length, dex: new Set((b.caught || []).map(c => c.name)).size, level, exp, toNext: level >= MAX_LEVEL ? 0 : r2b(xpFor(level + 1) - exp), levelPct: level >= MAX_LEVEL ? 100 : Math.round((exp - xpFor(level)) / (xpFor(level + 1) - xpFor(level)) * 1000) / 10, nextEvo: nextEvo || 0, toEvo: nextEvo ? r2b(xpFor(nextEvo) - exp) : 0, form: formName(starter, level), nextForm: nextEvo ? formName(starter, nextEvo) : '', badges: (b.badges || []).length, gymBadges: (b.badges || []).filter(x => x.gym).length, gym: isGym(b.route), toGym: toGym(b.route), drops: (b.drops || []).filter(x => x.route === b.route).slice(-8).map(x => ({ kind: x.kind, t: x.t })), lastAt: b.lastAt || 0, week: b.week || '', lastWeek: b.lastWeek || null };
}

// ── drawing ──────────────────────────────────────────────────────────────────
// TIME OF DAY (store, 2026-11-14): the overworld's colors follow the clock where the show runs -- morning and day
// in the handheld's greens, a warm sunset, a blue night with fireflies. (The battle screen keeps the greens.)
export const PALETTES = { day: GB, sunset: [[248, 208, 144], [224, 148, 96], [140, 72, 64], [48, 22, 34]], night: [[150, 170, 214], [92, 108, 168], [42, 50, 102], [10, 14, 40]] };
export const timeOfDay = (hour = new Date().getHours()) => hour >= 17 && hour < 20 ? 'sunset' : hour >= 20 || hour < 6 ? 'night' : 'day';
let PAL = GB;
const put = (img, W, x, y, s) => { if (x < 0 || y < 0 || x >= W || y >= img.height || s < 0) return; const i = (y * W + x) * 4, c = PAL[s]; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255; };
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
    case 13: { const cx = u - 7.5, cy = v - 8.5, d = cx * cx / 42 + cy * cy / 30; return d < 1 ? (d > 0.72 ? 3 : cx + cy < -4 ? 0 : (u * 5 + v * 3) % 11 === 0 ? 3 : 2) : 1; } // boulder
    case 14: return (hashOf(tx * 31 + ty * 17 + u * 7 + v * 3) % 9) === 0 ? 1 : 0;   // sand, speckled
    case 15: return v === 0 || v === 15 ? 3 : u % 4 === 3 ? 2 : 1;                     // bridge planks
    case 16: return v >= 11 ? (v === 11 ? 3 : 2) : (hashOf(tx * 13 + u + v * 5) % 9 === 0 ? 2 : 1); // a ledge (you hop down it)
    case 17: return (hashOf(tx * 7 + ty * 11 + u * 3 + v) % 13) === 0 ? 1 : (v % 8 === 7 || (u + (v >> 3) * 4) % 8 === 7) ? 3 : 2; // cave wall, rough blocks
    case 18: return h < 9 ? 2 : h < 13 ? 3 : 1;                                       // cave floor, gravel
    case 19: return h < 3 ? 1 : (u * 3 + v * 5 + tx) % 29 === 0 ? 1 : 0;              // snow, a glint here and there
    case 20: return u === 15 || v === 15 ? 2 : h < 4 ? 2 : 1;                          // pavement, slabs
    case 21: return (u === 7 || u === 8) && v > 4 ? 3 : v >= 1 && v <= 4 && u >= 5 && u <= 10 ? (v === 1 || u === 5 || u === 10 ? 3 : 0) : 1; // a street lamp
    case 22: { if (u < 4 || u > 11 || v < 3 || v > 13) return h < 7 ? 2 : 1; const top = v < 6 && ((u - 7.5) ** 2) / 14 + ((v - 6) ** 2) / 9 > 1; if (top) return 1; return u === 4 || u === 11 || v === 13 || (v < 6 && ((u - 7.5) ** 2) / 14 + ((v - 6) ** 2) / 9 > 0.6) ? 3 : (u === 7 || u === 8) && v > 5 && v < 11 || v === 7 && u > 5 && u < 10 ? 2 : 1; } // a gravestone with a cross
    case 23: { const w = Math.floor(tm * 4 + tx * 2) % 6; return (u + w + (v >> 2) * 3) % 6 < 2 ? 0 : (u * 5 + v * 3 + w) % 11 === 0 ? 2 : 1; } // lava, bubbling
    case 24: return h < 12 ? 3 : 2;                                                   // dark volcanic ground
    case 11: case 12: return v > 1 && v < 14 ? (v === 2 || v === 13 || u === 0 || u === 15 ? 3 : 0) : 2; // a shop sign (letters drawn on top)
    default: return h < 7 ? 2 : h < 12 ? 0 : 1;                                       // grass: a shade darker than the path, tufts
  }
}
// A tiny 3 x 5 font (the shop signs, the "!" over your head).
const FONT = { F: '111100110100100', J: '001001001101010', Q: '010101101011001', Z: '111001010100111', '+': '000010111010000', '-': '000000111000000', ':': '000010000010000', A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', I: '111010010010111', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '101111111111101', O: '010101101101010', P: '110101110100100', R: '110101110110101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', X: '101101010101101', G: '011100101101011', H: '101101111101101', W: '101101111111101', Y: '101101010010010', '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001010010', '8': '111101111101111', '9': '111101111001111', '!': '010010010000010', ' ': '000000000000000' };
function text3(img, W, x, y, str, s) { [...str].forEach((ch, k) => { const g = FONT[ch] || FONT[' ']; for (let i = 0; i < 15; i++) if (g[i] === '1') put(img, W, x + k * 4 + (i % 3), y + Math.floor(i / 3), s); }); }

// THE HOST AND CHAMP, hand-drawn in four greens (store, 2026-11-13: "put us in
// there recognizable ... more like this generic style"): chibi overworld people,
// 16 x 16 -- big head, short body, dark outline, seen from a little above. The
// host in a backwards cap, a beard and his jersey (MP on the front, 24 on the
// back); Champ bald and shiny, glasses, a full beard, a big hoodie. Two walk
// frames each way ('.' see-through, '0' lightest .. '3' darkest); facing left
// is facing right, mirrored. Our own pixels, drawn here.
export const PEOPLE = {"host":{"down":[["....33333333....","...3222222223...","..322222222223..","..321111111123..","..310000000013..","..303300003303..","..300000000003..","..322000000223..","...3222112223...","....33222233....","..332200002233..",".30322022022303.","...3222222223...","....31111113....","....31133113....","....333..333...."],["....33333333....","...3222222223...","..322222222223..","..321111111123..","..310000000013..","..303300003303..","..300000000003..","..322000000223..","...3222112223...","....33222233....","..332200002233..",".30322022022303.","...3222222223...","....31111113....","....3113.3113...","...333....333..."]],"up":[["....33333333....","...3222222223...","..322222222223..","..322222222223..",".33333333333333.","..300000000003..","..300000000003..","..310000000013..","...3100000013...","....33333333....","..332222222233..",".30320202002303.","...3200220023...","....31111113....","....31133113....","....333..333...."],["....33333333....","...3222222223...","..322222222223..","..322222222223..",".33333333333333.","..300000000003..","..300000000003..","..310000000013..","...3100000013...","....33333333....","..332222222233..",".30320202002303.","...3200220023...","....31111113....","....3113.3113...","...333....333..."]],"side":[[".....33333333...","....3222222223..","...32222222223..","..3321111111123.",".333100000003...","....3000003303..","....3000000003..","....3220000003..","....3222112223..",".....3222233....",".....3222223....",".....3202223....",".....3222223....","....322223......","....32223.......","....333.33......"],[".....33333333...","....3222222223..","...32222222223..","..3321111111123.",".333100000003...","....3000003303..","....3000000003..","....3220000003..","....3222112223..",".....3222233....",".....3222223....",".....3202223....",".....3222223....",".....32223......",".....3223.3.....","....333..333...."]]},"champ":{"down":[["....33333333....","...3000000003...","..300001100003..","..300000000003..","..303330033303..","..303130031303..","..300330033003..","..322000000223..","..322221122223..","...3222222223...",".33311111111333.",".30311111111303.",".33311111111333.","....31111113....","....31133113....","....333..333...."],["....33333333....","...3000000003...","..300001100003..","..300000000003..","..303330033303..","..303130031303..","..300330033003..","..322000000223..","..322221122223..","...3222222223...",".33311111111333.",".30311111111303.",".33311111111333.","....31111113....","....3113.3113...","...333....333..."]],"up":[["....33333333....","...3000000003...","..300001100003..","..300000000003..","..330000000033..","..300000000003..","..300000000003..","..322000000223..","...3220000223...","....33333333....",".33311111111333.",".30311111111303.",".33311111111333.","....31111113....","....31133113....","....333..333...."],["....33333333....","...3000000003...","..300001100003..","..300000000003..","..330000000033..","..300000000003..","..300000000003..","..322000000223..","...3220000223...","....33333333....",".33311111111333.",".30311111111303.",".33311111111333.","....31111113....","....3113.3113...","...333....333..."]],"side":[[".....33333333...","....3000000003..","...300011000003.","...300000000003.","...300033333333.","...300003111133.","...300033333333.","...32200000223..","...32222212223..","....322222223...","...31111111113..","...31111033113..","...31111111113..","....322223......","....32223.......","....333.33......"],[".....33333333...","....3000000003..","...300011000003.","...300000000003.","...300033333333.","...300003111133.","...300033333333.","...32200000223..","...32222212223..","....322222223...","...31111111113..","...31111033113..","...31111111113..",".....32223......",".....3223.3.....","....333..333...."]]}};
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
  for (let y = 26; y < 48; y++) for (let x = hx - bw - (y > 34 && champ ? 2 : 0); x <= hx + bw + (y > 34 && champ ? 2 : 0); x++) { const edge = x === hx - bw - (y > 34 && champ ? 2 : 0) || x === hx + bw + (y > 34 && champ ? 2 : 0) || y === 26; const L = hx - bw - (y > 34 && champ ? 2 : 0), pocket = champ && y > 35 && y < 43 && Math.abs(x - hx) < 7; P(x, y, edge ? 3 : pocket ? (y === 36 || y === 42 || Math.abs(x - hx) === 6 ? 3 : 1) : x - L < 3 ? (champ ? 1 : 2) : champ ? 2 : (y === 27 && Math.abs(x - hx) < 3 ? 0 : 3)); } // shaded: lit from the left; Champ's hoodie has a pocket, the jersey a collar
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

// The items' little pictures, 8 x 8 ('.' see-through).
const ICONS = {
  BERRY: ['...33...', '..3223..', '.322223.', '32200223', '32222223', '32222223', '.322223.', '..3333..'],
  POTION: ['..3333..', '...33...', '..3003..', '.320023.', '32222223', '32211223', '.322223.', '..3333..'],
  CANDY: ['3......3', '33.33.33', '.330033.', '.300003.', '.300003.', '.330033.', '33.33.33', '3......3'],
  STONE: ['...33...', '..3003..', '.300203.', '30022003', '30222203', '.302203.', '..3223..', '...33...'],
  ETHER: ['..3333..', '..3003..', '..3003..', '.322223.', '32211223', '32122123', '32211223', '.333333.'],
  COIN: ['..3333..', '.300003.', '30033003', '30300303', '30300303', '30033003', '.300003.', '..3333..'],
  GIFT: ['33.33.33', '.330033.', '33333333', '30030003', '30030003', '33333333', '30030003', '33333333'],
};
function drawIcon(img, W, x0, y0, name) { (ICONS[name] || ICONS.GIFT).forEach((row, y) => { for (let x = 0; x < 8; x++) { const ch = row[x]; if (ch !== '.') put(img, W, x0 + x, y0 + y, +ch); } }); }
const ITEM_SAYS = { BERRY: 'GOT A BERRY!', POTION: 'GOT A POTION!', CANDY: 'GOT A CANDY!', STONE: 'GOT AN EVO STONE!', ETHER: 'GOT AN ETHER!', COIN: 'GOT A COIN!' };

// THE OVERWORLD on a canvas: the route, you walking it, your buddy a step behind.
export function createWorld(canvas, { w = 240, h = 189 } = {}) {
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h);
  let first = true, state = { floor: 1, pct: 0, phase: 'floor' }, route = routeFor(1), shown = 0, raf = 0, last = 0, face = '', buddy = '', step = 0, dir = 'up', exclaim = -1e9, drops = [], said = '', saidAt = -1e9, lastShown = 0, tod = null;
  function set(s) {
    if (first || s.floor !== state.floor) { route = routeFor(s.floor); shown = s.phase === 'boss' ? 1 : walkAt((s.pct || 0) / 100); lastShown = shown; first = false; }
    const wasBattle = battleOf(state), isBattle = battleOf(s);
    if (isBattle && !wasBattle) exclaim = performance.now(); // a "!" over your head as the beast jumps out
    state = { ...state, ...s }; face = s.face ?? face; buddy = s.buddy ?? buddy; if (Array.isArray(s.drops)) drops = s.drops; if (s.timeOfDay) tod = s.timeOfDay;
  }
  const battleOf = s => s.phase === 'boss' || ENCOUNTERS.some(([a, b]) => (s.pct || 0) / 100 >= a && (s.pct || 0) / 100 < b);
  function frame(now) {
    raf = requestAnimationFrame(frame); if (now - last < 33) return; const dt = Math.min(0.2, (now - (last || now)) / 1000); last = now; const tm = now / 1000;
    const target = state.phase === 'boss' ? 1 : walkAt((state.pct || 0) / 100);
    const walking = shown < target - 0.0005; if (walking) shown = Math.min(target, shown + dt * Math.max(3.2 / route.len, (target - shown) / 10)); else if (shown > target) shown = target;
    const p = posAt(route, shown), q = posAt(route, Math.max(0, shown - 1.3 / route.len));
    // Picking things up as you pass them: the route's items, then chat's gifts.
    if (shown > lastShown) { const got = route.items.filter(it => it.t > lastShown && it.t <= shown).pop(), gift = drops.filter(d => d.t > lastShown && d.t <= shown).pop(); if (gift) { said = 'CHAT GIFT: ' + String(gift.kind).toUpperCase().slice(0, 8) + '!'; saidAt = now; } else if (got) { said = ITEM_SAYS[got.kind] || 'FOUND SOMETHING!'; saidAt = now; } }
    lastShown = shown;
    PAL = PALETTES[tod || timeOfDay()] || GB;
    // Facing the way you're walking (2026-11-13: "change directions"): across on a turn, up on a straight run.
    if (walking) { step = Math.floor(tm * 6) % 2; dir = p.dx < 0 ? 'left' : p.dx > 0 ? 'right' : p.dy < 0 ? 'up' : p.dy > 0 ? 'down' : dir; } else step = 0;
    // The camera follows you (kept inside the map).
    const camX = Math.max(0, Math.min(MAP_W * T - w, (p.x + 0.5) * T - w / 2)), camY = Math.max(0, Math.min(MAP_H * T - h, (p.y + 0.5) * T - h * 0.58));
    // In a cave it's dark: the host's lantern lights a circle around them.
    const hx = (p.x + 0.5) * T - camX, hy = (p.y + 0.5) * T - camY - 8, cave = route.biomeAt(Math.round(p.y)) === 'cave';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const wx = x + camX, wy = y + camY, tx = Math.floor(wx / T), ty = Math.floor(wy / T), t = route.grid[ty]?.[tx] ?? 3; let sh = tileShade(t, Math.floor(wx) % T, Math.floor(wy) % T, tx, ty, tm); if (cave || route.biomeAt(ty) === 'cave') { const d2 = (x - hx) ** 2 + (y - hy) ** 2, flick = Math.sin(tm * 9) * 3; if (d2 > (54 + flick) ** 2) sh = 3; else if (d2 > (38 + flick) ** 2) sh = Math.min(3, sh + 1); } put(img, w, x, y, sh); }
    // The items still on the path, and chat's gifts (they bob).
    const bobY = Math.round(Math.sin(tm * 4) * 1.5);
    for (const it of route.items) if (it.t > shown + 0.001) { const ip = posAt(route, it.t); drawIcon(img, w, Math.round((ip.x + 0.5) * T - camX - 4), Math.round((ip.y + 0.5) * T - camY - 6) + bobY, it.kind); }
    for (const d of drops) if (d.t > shown + 0.001) { const ip = posAt(route, d.t); drawIcon(img, w, Math.round((ip.x + 0.5) * T - camX - 4), Math.round((ip.y + 0.5) * T - camY - 6) - bobY, 'GIFT'); }
    // The shop signs.
    route.grid.forEach((row, ty) => row.forEach((t, tx) => { if (t === 11 || t === 12) { const gym = t === 12 && isGym(route.floor); text3(img, w, tx * T - camX + 8 - (t === 11 ? 12 : gym ? 6 : 10), ty * T - camY + 5, t === 11 ? 'COMICS' : gym ? 'GYM' : 'RIVAL', 3); } }));
    // Your buddy, then you (you're in front).
    const sx = x => Math.round((x + 0.5) * T - camX - 8), sy = y => Math.round((y + 0.5) * T - camY - 18);
    // Always the chibi walkers (2026-11-13: "why no chibi?" -- a saved face photo used to swap in the old face sprite).
    drawSprite(img, w, sx(q.x), sy(q.y) + 6, 'champ', dir, walking ? 1 - step : 0);
    drawSprite(img, w, sx(p.x), sy(p.y) + 4, 'host', dir, step);
    if (performance.now() - exclaim < 1400) text3(img, w, sx(p.x) + 7, sy(p.y) - 14, '!', 3);
    // Fireflies at night (they drift on the clock, no dice).
    if ((tod || timeOfDay()) === 'night') for (let k = 0; k < 9; k++) { const fx = Math.round((k * 53 + Math.sin(tm * 0.6 + k) * 22 + tm * 4) % w), fy = Math.round((k * 37 + Math.cos(tm * 0.5 + k * 2) * 16) % h); if ((Math.floor(tm * 2) + k) % 3) { put(img, w, fx, fy, 0); put(img, w, fx + 1, fy, 1); } }
    // What you picked up, over your head; the bag count in the corner.
    if (now - saidAt < 2200 && said) { const tw = said.length * 4 + 4, bx = Math.max(1, Math.min(w - tw - 1, sx(p.x) + 8 - tw / 2)), by = Math.max(1, sy(p.y) - 24); for (let yy = by; yy < by + 9; yy++) for (let xx = bx; xx < bx + tw; xx++) put(img, w, xx, yy, yy === by || yy === by + 8 || xx === bx || xx === bx + tw - 1 ? 3 : 0); text3(img, w, bx + 2, by + 2, said, 3); }
    const bag = (state.floor - 1) * ITEM_SPOTS.length + route.items.filter(it => it.t <= shown).length + drops.filter(d => d.t <= shown).length;
    for (let yy = 1; yy < 10; yy++) for (let xx = 1; xx < 40; xx++) put(img, w, xx, yy, yy === 1 || yy === 9 || xx === 1 || xx === 39 ? 3 : 0); text3(img, w, 4, 3, 'BAG ' + bag, 3);
    PAL = GB;
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
  let b = null, moves = DEFAULT_MOVES, pick = 0, anim = null, foeAnim = null, evo = null, foeHits = 0, lastTenth = 10, faintAt = 0, raf = 0, last = 0, msg = '', shownFoe = 1, beastCache = new Map(), introAt = -1e9, key = '', rival = null;
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
    const fa = foeAnim ? (now - foeAnim.at) / 1300 : -1, gotHit = fa >= 0.45 && fa < 0.8, myShake = gotHit ? Math.round(Math.sin(now / 18) * 3) : 0, foeLunge = fa >= 0 && fa < 0.25 ? Math.round(fa * 32) : 0;
    if (foeAnim && fa >= 1) foeAnim = null;
    const fainted = b.mine.hp <= 0, mySink = fainted ? Math.min(1, (now - faintAt) / 900) : 0;
    // EVOLVING (3.2 s): the old and new forms flicker, faster and faster, a flash, then the new one.
    const et = evo ? (now - evo.at) / 3200 : -1; if (evo && et >= 1.6) evo = null;
    const evoName = et >= 0 && et < 1 ? (Math.floor((now - evo.at) / Math.max(40, 220 * (1 - et))) % 2 ? evo.to : evo.from) : null;
    drawBeast(beast(evoName || b.mine.name, true), 28 + lunge + myShake, 42 + bob(0) - lunge, gotHit && Math.floor(now / 60) % 2 === 0, 2, mySink);
    if (et >= 0.86 && et < 1.05) for (let yy = 0; yy < 106; yy++) for (let xx = 0; xx < W; xx++) put(img, W, xx, yy, 0); // the flash
    const faint = b.foe.hp <= 0.002 ? Math.min(1, Math.max(0, 1 - shownFoe * 50)) : 0;
    drawBeast(beast(b.foe.name), 152 + shake - foeLunge, 4 + bob(1) + foeLunge, hitT && Math.floor(now / 60) % 2 === 0, 2, faint);
    // The foe's attack: from theirs (top right) down to yours (bottom left).
    if (fa >= 0 && fa < 0.6) { const f = fa / 0.6, x = 182 - f * 112, y = 30 + f * 40 - Math.sin(f * Math.PI) * 14; fill(Math.round(x) - 2, Math.round(y) - 2, 5, 5, 3); fill(Math.round(x) - 1, Math.round(y) - 1, 3, 3, 0); }
    if (fa > 0.45 && fa < 0.52) for (let yy = 40; yy < 106; yy++) for (let xx = 0; xx < 120; xx += 2) put(img, W, xx, yy, 0); // the hit's flash
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
    tx(b.foe.name.slice(0, 11), 10, 17, 6); tx('HP', 9, 25, 5); tx(b.mine.name.slice(0, 11), 134, 87, 6); tx('HP', 133, 95, 5); tx('L' + (b.mine.level || 1), 214, 87, 6);
    tx(it >= 0.62 && it < 1 ? b.mine.name + ', GO!' : msg || (b.mine.hp <= 0 ? b.mine.name.slice(0, 10) + ' FAINTED! CHAT: FOLLOW/SHARE TO REVIVE' : '') || (b.kind === 'rival' ? b.trainer.slice(0, 22) + ' SENT OUT ' + b.foe.name.slice(0, 10) + '!' : 'WHAT WILL ' + b.mine.name + ' DO?'), 10, 122, 6);
    moves.forEach((m, i) => { const x = 14 + (i % 2) * 112, y = 138 + Math.floor(i / 2) * 13; if (i === pick) { ctx.fillStyle = `rgb(${GB[2]})`; ctx.fillRect((x - 6) * S, (y - 9) * S, 108 * S, 11 * S); } tx((i + 1) + ' ' + m, x, y, 6, i === pick ? GB[0] : GB[3]); });
  }
  return {
    set(next, { moves: mv, pick: p } = {}) { const k = next ? next.kind + '|' + next.foe.name : ''; if (k && k !== key) { introAt = performance.now(); shownFoe = next.foe.hp; lastTenth = Math.ceil((next.mine?.hp ?? 1) * 10); } key = k;
      // The foe hits back: a hit for every tenth of HP your beast loses; at 0 it faints; back up, it's back.
      if (next && b && k === key) { const tenth = Math.ceil((next.mine?.hp ?? 1) * 10); if (tenth < lastTenth && performance.now() - introAt > 2400) { const mv = foeMoveFor(next.foe.name, foeHits++); foeAnim = { kind: moveAnim(mv), at: performance.now() }; msg = (next.kind === 'wild' ? 'WILD ' : 'FOE ') + next.foe.name.slice(0, 10) + ' USED ' + mv + '!'; clearTimeout(this.t); this.t = setTimeout(() => { msg = ''; }, 2600); } if (next.mine.hp <= 0 && (b.mine?.hp ?? 1) > 0) faintAt = performance.now(); if (next.mine.hp > 0 && (b.mine?.hp ?? 1) <= 0) { msg = next.mine.name + ' IS BACK ON ITS FEET!'; clearTimeout(this.t); this.t = setTimeout(() => { msg = ''; }, 2600); } lastTenth = tenth; }
      b = next; if (mv) moves = mv; if (Number.isInteger(p)) pick = p; if (!b) { msg = ''; shownFoe = 1; } },
    // The rival trainer, from any picture (the boss's art), turned into four greens at 44 x 44.
    setRival(src) { if (!src) { rival = null; return; } const c = document.createElement('canvas'); c.width = c.height = 44; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, 44, 44); const d = x.getImageData(0, 0, 44, 44).data; rival = new Int8Array(44 * 44); for (let i = 0; i < rival.length; i++) { const a = d[i * 4 + 3], l = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11; rival[i] = a < 120 ? -1 : l > 190 ? 0 : l > 130 ? 1 : l > 70 ? 2 : 3; } },
    // A move fired (chat's pick, on a sale): its animation and the line of text.
    // The evolution: the cutscene and its lines.
    evolve(from, to) { evo = { from: String(from || '').toUpperCase(), to: String(to || '').toUpperCase(), at: performance.now() }; msg = 'WHAT? ' + evo.from.slice(0, 11) + ' IS EVOLVING!'; clearTimeout(this.t); this.t = setTimeout(() => { msg = evo ? evo.from.slice(0, 10) + ' EVOLVED INTO ' + evo.to.slice(0, 11) + '!' : ''; this.t = setTimeout(() => { msg = ''; }, 3500); }, 3300); },
    // A level up: a line in the box.
    levelUp(name, level) { msg = String(name).slice(0, 11) + ' GREW TO LV ' + level + '!'; clearTimeout(this.t); this.t = setTimeout(() => { msg = ''; }, 2600); },
    attack(name) { const i = moves.indexOf(String(name).toUpperCase()); if (i >= 0) pick = i; anim = { kind: moveAnim(name), at: performance.now() }; msg = (b?.mine?.name || STARTER) + ' USED ' + String(name).toUpperCase() + '!'; clearTimeout(this.t); this.t = setTimeout(() => { msg = ''; }, 2600); },
    start() { if (!raf) raf = requestAnimationFrame(frame); }, stop() { cancelAnimationFrame(raf); raf = 0; },
  };
}
