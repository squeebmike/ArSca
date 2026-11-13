// The Shed Dungeon's green-screen backgrounds (store, 2026-11-04: "I also
// want to have a green screen where the background can be different shitty
// sheds"). An OBS Browser Source under the camera (the camera gets OBS's
// Chroma Key filter): it paints the shed of the floor the dungeon is on,
// with the room chat picked layered in, and goes red while a boss is up.
// All original pixel art drawn here in code, at 270 x 480 and blown up 4x
// with hard pixels (the PS1 / 16-bit look). Nothing in it is random: dust,
// drips and embers move on fixed paths.
import { SHEDS, shedFor, ROOMS } from './live-studio-dungeon.mjs';

export const W = 270, H = 480;
const TAU = Math.PI * 2;
// A tiny fixed sequence for prop placement (looks scattered, isn't).
const seq = seed => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

function painter(x) {
  const r = (a, b, w, h, c) => { x.fillStyle = c; x.fillRect(Math.round(a), Math.round(b), Math.round(w), Math.round(h)); };
  const circ = (a, b, rad, c) => { x.fillStyle = c; x.beginPath(); x.arc(Math.round(a), Math.round(b), rad, 0, TAU); x.fill(); };
  const poly = (pts, c) => { x.fillStyle = c; x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); x.fill(); };
  return { r, circ, poly, x };
}

// Walls: vertical boards with gaps, nails and knots.
function planks(p, { y0 = 0, y1 = 330, a = '#7a4a26', b = '#6a3e1f', gap = '#2a160a', knot = '#4a2a12', w = 18, rust = 0, seed = 1 } = {}) {
  const n = seq(seed);
  for (let i = 0, bx = 0; bx < W; i++, bx += w) {
    p.r(bx, y0, w - 1, y1 - y0, i % 2 ? a : b);
    p.r(bx + w - 1, y0, 1, y1 - y0, gap);
    p.r(bx + 3, y0 + 18, 2, 2, '#c9b38a'); p.r(bx + 3, y1 - 22, 2, 2, '#c9b38a');
    if (n() < 0.5) p.r(bx + 5 + n() * 6, y0 + 40 + n() * (y1 - y0 - 80), 4, 3, knot);
    if (rust && n() < rust) { const ry = y0 + 20 + n() * 60; p.r(bx + 4, ry, 3, 50 + n() * 80, '#8a3d12'); p.r(bx + 5, ry, 1, 40, '#b4521a'); }
  }
  p.r(0, y0, W, 6, gap);
}
function floorBoards(p, y, c1 = '#5a3519', c2 = '#4a2b13') {
  for (let i = 0; y + i * 12 < H; i++) p.r(0, y + i * 12, W, 11, i % 2 ? c1 : c2), p.r(0, y + i * 12 + 11, W, 1, '#1d0f06');
}
function windowFrame(p, x, y, w, h, sky, frame = '#3a2210') {
  p.r(x - 4, y - 4, w + 8, h + 8, frame); p.r(x, y, w, h, sky);
  p.r(x + w / 2 - 1, y, 2, h, frame); p.r(x, y + h / 2 - 1, w, 2, frame);
}
function shelf(p, x, y, w, c = '#4a2b13') { p.r(x, y, w, 4, c); p.r(x + 4, y + 4, 3, 8, c); p.r(x + w - 7, y + 4, 3, 8, c); }
function pot(p, x, y, s = 1, plant = '#3fa34d', dead = false) {
  p.poly([[x, y], [x + 16 * s, y], [x + 13 * s, y + 14 * s], [x + 3 * s, y + 14 * s]], '#c2612c');
  p.r(x - 1, y, 18 * s, 3, '#d9773a');
  if (dead) { p.r(x + 7 * s, y - 10 * s, 2, 10 * s, '#5a4a2a'); p.r(x + 3 * s, y - 12 * s, 5, 2, '#5a4a2a'); }
  else { p.circ(x + 8 * s, y - 5 * s, 6 * s, plant); p.circ(x + 4 * s, y - 2 * s, 4 * s, plant); p.circ(x + 12 * s, y - 3 * s, 4 * s, '#2e7d3a'); }
}
function bulb(p, x, y, t, swing = 0.3, glow = '#ffe9a0') {
  const a = Math.sin(t * 1.3) * swing, bx = x + Math.sin(a) * 40, by = y + Math.cos(a) * 40;
  p.x.strokeStyle = '#111'; p.x.lineWidth = 1; p.x.beginPath(); p.x.moveTo(x, y); p.x.lineTo(bx, by); p.x.stroke();
  const g = p.x.createRadialGradient(bx, by + 4, 2, bx, by + 4, 90); g.addColorStop(0, glow + 'aa'); g.addColorStop(1, glow + '00');
  p.x.fillStyle = g; p.x.fillRect(bx - 90, by - 86, 180, 180);
  p.circ(bx, by + 4, 4, glow); p.r(bx - 2, by - 2, 4, 3, '#555');
}
function dust(p, t, n = 18, c = '#fff5d088', seed = 5) {
  const s = seq(seed);
  for (let i = 0; i < n; i++) { const x0 = s() * W, y0 = s() * 300, sp = 4 + s() * 6; p.r((x0 + Math.sin(t * 0.4 + i) * 10) % W, (y0 + t * sp) % 330, 1, 1, c); }
}
function cobweb(p, x, y, flip = 1) {
  p.x.strokeStyle = '#d8d8e888'; p.x.lineWidth = 1;
  for (let i = 0; i < 4; i++) { p.x.beginPath(); p.x.moveTo(x, y); p.x.lineTo(x + flip * (40 - i * 8), y + i * 12); p.x.stroke(); }
  for (let k = 1; k < 4; k++) { p.x.beginPath(); p.x.moveTo(x + flip * k * 10, y); p.x.quadraticCurveTo(x + flip * k * 7, y + k * 7, x, y + k * 11); p.x.stroke(); }
}
function eyes(p, x, y, t, phase) { if (Math.floor(t * 0.7 + phase) % 5 === 0) return; p.r(x, y, 3, 2, '#ffe23d'); p.r(x + 7, y, 3, 2, '#ffe23d'); }

// ── the seven sheds (SHEDS in live-studio-dungeon.mjs, in order) ───────────
const SCENES = [
  // GARDEN SHED: sun through the window, pots and a sunflower.
  (p, t) => {
    planks(p, { a: '#9a6236', b: '#8a5530', seed: 2 }); floorBoards(p, 330, '#6a4020', '#5a3519');
    windowFrame(p, 150, 60, 80, 64, '#8fd3ff'); p.circ(205, 78, 9, '#fff3a0');
    p.x.fillStyle = '#fff3a022'; p.x.beginPath(); p.x.moveTo(150, 124); p.x.lineTo(230, 124); p.x.lineTo(170, 330); p.x.lineTo(60, 330); p.x.fill();
    shelf(p, 20, 190, 110); pot(p, 28, 176); pot(p, 58, 176, 1, '#5cbf4a'); pot(p, 90, 176);
    p.r(30, 150, 3, 180, '#3a7d2a'); for (let i = 0; i < 10; i++) p.circ(31 + Math.cos(i * TAU / 10 + Math.sin(t) * 0.05) * 13, 140 + Math.sin(i * TAU / 10) * 13, 6, '#ffd21f'); p.circ(31, 140, 8, '#6a3a12');
    p.r(240, 150, 3, 120, '#6a4020'); for (let i = 0; i < 6; i++) p.r(232 + i * 3, 150, 1, 12, '#888');
    p.poly([[170, 380], [230, 380], [236, 430], [164, 430]], '#b89a6a'); p.r(176, 396, 46, 3, '#8a7048');
    dust(p, t);
  },
  // RUSTY TOOL SHED: pegboard tools, a workbench, a swinging bulb.
  (p, t) => {
    planks(p, { a: '#6e5a4a', b: '#62503f', rust: 0.6, seed: 3 }); floorBoards(p, 330, '#4a3a2c', '#3e3024');
    p.r(30, 70, 150, 100, '#a0805a'); for (let i = 0; i < 14; i++) for (let j = 0; j < 9; j++) p.r(36 + i * 10, 76 + j * 10, 2, 2, '#6a5236');
    p.r(45, 85, 6, 50, '#9aa0a8'); p.r(40, 85, 16, 8, '#9aa0a8');
    p.poly([[75, 90], [125, 90], [125, 110], [75, 128]], '#b8bec6'); p.r(125, 90, 14, 20, '#7a3a12');
    p.r(150, 90, 6, 45, '#7a4a20'); p.r(143, 88, 20, 10, '#555b63');
    p.r(20, 260, 230, 10, '#5a3a1e'); p.r(26, 270, 8, 60, '#4a2e16'); p.r(236, 270, 8, 60, '#4a2e16'); p.r(190, 240, 30, 20, '#3a3f46');
    p.r(60, 236, 18, 24, '#9a2a1a'); p.r(66, 228, 4, 8, '#555');
    bulb(p, 140, 0, t, 0.25, '#ffd27a');
    dust(p, t, 14, '#e0c89088');
  },
  // FLOODED SHED: water halfway up, floating junk, drips, rain.
  (p, t) => {
    planks(p, { a: '#4e5a5a', b: '#46514f', seed: 4 }); floorBoards(p, 330, '#2e3a3a', '#26302f');
    windowFrame(p, 40, 60, 70, 60, '#3a4a66'); for (let i = 0; i < 12; i++) p.r(44 + (i * 13) % 62, 62 + ((t * 120 + i * 37) % 56), 1, 5, '#a8c8ff');
    shelf(p, 140, 150, 110); p.r(150, 132, 30, 18, '#7a6a4a'); p.r(190, 136, 22, 14, '#5a7a8a');
    const wl = 250 + Math.sin(t * 0.8) * 3;
    p.x.fillStyle = '#1e5a8acc'; p.x.fillRect(0, wl, W, H - wl);
    for (let i = 0; i < 9; i++) { const y = wl + 6 + i * 24; for (let k = 0; k < 6; k++) p.r(((k * 50 + i * 23 + t * (10 + i)) % (W + 40)) - 20, y + Math.sin(t * 2 + k) * 2, 18, 1, '#8fd3ff88'); }
    const bob = Math.sin(t * 1.5) * 3; p.r(30, wl - 10 + bob, 60, 16, '#e8dcc0'); p.r(30, wl - 10 + bob, 60, 3, '#bfae88');
    p.circ(200, wl - 4 - bob, 6, '#ffd21f'); p.circ(206, wl - 9 - bob, 4, '#ffd21f'); p.r(209, wl - 9 - bob, 4, 2, '#ff8a00');
    for (let i = 0; i < 4; i++) { const dx = 60 + i * 55, dy = ((t * 90 + i * 70) % (wl - 10)); p.r(dx, dy, 2, 4, '#a8d8ff'); }
  },
  // HAUNTED POTTING SHED: moonlight, cobwebs, dead plants, a wisp, a candle.
  (p, t) => {
    planks(p, { a: '#3a2c4a', b: '#32263f', knot: '#1e1428', seed: 6 }); floorBoards(p, 330, '#241a30', '#1d1528');
    windowFrame(p, 160, 60, 70, 70, '#1a2040', '#140c1c'); p.circ(200, 86, 12, '#e8e8ff'); p.circ(205, 82, 11, '#1a2040');
    cobweb(p, 0, 0); cobweb(p, W, 0, -1);
    shelf(p, 20, 200, 120, '#2a1e18'); pot(p, 30, 186, 1, '', true); pot(p, 66, 186, 1, '', true); pot(p, 102, 186, 1, '', true);
    const fl = 0.6 + Math.sin(t * 9) * 0.2 + Math.sin(t * 23) * 0.1;
    const g = p.x.createRadialGradient(220, 300, 2, 220, 300, 80); g.addColorStop(0, `rgba(255,190,90,${0.5 * fl})`); g.addColorStop(1, 'rgba(255,190,90,0)');
    p.x.fillStyle = g; p.x.fillRect(140, 220, 160, 160); p.r(216, 300, 8, 24, '#e8e0d0'); p.r(219, 292 - fl * 3, 2, 6, '#ffb000');
    const gx = 110 + Math.sin(t * 0.6) * 50, gy = 120 + Math.sin(t * 1.1) * 15;
    p.x.globalAlpha = 0.55; p.circ(gx, gy, 12, '#d8f0ff'); p.r(gx - 12, gy, 24, 14, '#d8f0ff');
    for (let i = 0; i < 4; i++) p.circ(gx - 9 + i * 6, gy + 14 + Math.sin(t * 4 + i) * 2, 3, '#d8f0ff');
    p.x.globalAlpha = 1; p.r(gx - 5, gy - 3, 3, 4, '#1a1028'); p.r(gx + 3, gy - 3, 3, 4, '#1a1028');
    p.x.fillStyle = '#0a061444'; p.x.fillRect(0, 0, W, H);
  },
  // RACCOON-INFESTED SHED: knocked-over cans, chewed boxes, eyes in the dark.
  (p, t) => {
    planks(p, { a: '#5a4a3a', b: '#504234', seed: 7 }); floorBoards(p, 330, '#3a3026', '#322a20');
    { const g = p.x.createLinearGradient(0, 0, 0, 200); g.addColorStop(0, '#0a0608dd'); g.addColorStop(1, '#0a060800'); p.x.fillStyle = g; p.x.fillRect(0, 0, W, 200); }
    eyes(p, 40, 60, t, 0); eyes(p, 200, 40, t, 2.3); eyes(p, 120, 100, t, 4.1);
    p.r(20, 250, 60, 80, '#8a7a5a'); p.poly([[20, 250], [40, 240], [60, 252], [80, 244], [80, 250]], '#2a2016');
    p.r(30, 270, 40, 3, '#6a5a3a');
    p.poly([[150, 330], [210, 300], [236, 340], [176, 370]], '#9aa0a8'); p.poly([[210, 300], [236, 340], [244, 334], [218, 296]], '#7a8088');
    const tail = Math.sin(t * 3) * 6; for (let i = 0; i < 6; i++) p.r(220 + i * 6, 318 - tail * (i / 6), 6, 8, i % 2 ? '#2a2420' : '#9a9088');
    const n = seq(9); for (let i = 0; i < 14; i++) p.r(n() * W, 336 + n() * 130, 6 + n() * 6, 3 + n() * 3, ['#e04a4a', '#ffe23d', '#4ab8ff', '#e8e8e8'][i % 4]);
    p.r(100, 280, 30, 50, '#5a7a3a'); p.circ(115, 280, 15, '#4a6a2a');
  },
  // BURNT-OUT SHED: charred boards, a hole in the roof, embers and smoke.
  (p, t) => {
    planks(p, { a: '#2a221e', b: '#221b18', gap: '#0a0605', knot: '#120c0a', seed: 8 }); floorBoards(p, 330, '#1e1612', '#181210');
    p.poly([[90, 0], [200, 0], [180, 40], [140, 60], [100, 36]], '#0a0e24'); for (let i = 0; i < 6; i++) p.r(100 + i * 16, 8 + (i * 7) % 30, 1, 1, '#fff');
    const n = seq(11); for (let i = 0; i < 16; i++) { const x0 = n() * W, y0 = n() * 300; p.r(x0, y0, 1 + n() * 2, 10 + n() * 30, Math.sin(t * 2 + i) > 0 ? '#ff6a1a' : '#b8340a'); }
    const e = seq(12); for (let i = 0; i < 26; i++) { const x0 = e() * W, sp = 20 + e() * 30, y = 420 - ((t * sp + e() * 400) % 420); p.r(x0 + Math.sin(t + i) * 6, y, 2, 2, i % 3 ? '#ffb000' : '#ff4a1a'); }
    p.x.fillStyle = '#5a5a5a22'; for (let i = 0; i < 5; i++) { p.x.beginPath(); p.x.arc(60 + i * 45, 120 - ((t * 8 + i * 30) % 120), 30, 0, TAU); p.x.fill(); }
    p.r(40, 290, 80, 40, '#1a1410'); p.r(44, 286, 20, 8, '#ff6a1a88');
  },
  // THE SHED BENEATH THE SHED: stone cellar, stairs down, a purple portal.
  (p, t) => {
    for (let y = 0; y < 330; y += 14) for (let x = (y / 14) % 2 ? -14 : 0; x < W; x += 28) { p.r(x, y, 27, 13, (x + y) % 3 ? '#3a3448' : '#342e42'); p.r(x, y + 13, 28, 1, '#15121c'); }
    floorBoards(p, 330, '#2a2434', '#241f2e');
    for (let i = 0; i < 6; i++) p.r(10 + i * 12, 260 + i * 12, 60 - i * 6, 12, i % 2 ? '#4a4458' : '#3e384c');
    const pr = 46 + Math.sin(t * 2) * 3;
    const g = p.x.createRadialGradient(170, 200, 4, 170, 200, pr + 30); g.addColorStop(0, '#f0c0ff'); g.addColorStop(0.5, '#a43bff'); g.addColorStop(1, '#a43bff00');
    p.x.fillStyle = g; p.x.fillRect(100, 120, 140, 160);
    for (let i = 0; i < 12; i++) { const a = t * 1.5 + i * TAU / 12; p.r(170 + Math.cos(a) * pr, 200 + Math.sin(a) * pr * 1.2, 3, 3, '#f0d0ff'); }
    for (const tx of [40, 250]) { const f = Math.sin(t * 11 + tx) * 2; p.r(tx - 2, 120, 4, 14, '#6a4a2a'); p.circ(tx, 116 - f, 5, '#ffb000'); p.circ(tx, 114 - f, 3, '#fff3a0'); }
    for (let i = 0; i < 8; i++) p.r(90, 10 + i * 9, 4, 6, '#6a6478'), p.r(250 - 4, 10 + i * 9, 4, 6, '#6a6478');
  },
];
export const SCENE_COUNT = SCENES.length;

// ── the room chat picked: props in the front ──────────────────────────────
const ROOM_PROPS = {
  vault: (p, t) => { for (let i = 0; i < 3; i++) for (let k = 0; k < 6 - i; k++) p.circ(30 + k * 12 + i * 6, 440 - i * 8, 6, k % 2 ? '#ffd21f' : '#e0a100'); p.r(170, 410, 70, 40, '#7a4a1a'); p.r(170, 404, 70, 10, '#5a3412'); p.r(200, 418, 10, 10, '#ffd21f'); if (Math.sin(t * 3) > 0.7) p.r(60, 420, 2, 2, '#fff'); },
  library: p => { for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) { p.r(20 + k * 100, 450 - i * 22, 90, 20, '#e8dcc0'); p.r(20 + k * 100, 450 - i * 22, 90, 3, '#bfae88'); p.r(55 + k * 100, 456 - i * 22, 20, 6, '#3a2a1a'); } },
  armory: p => { for (let i = 0; i < 5; i++) { p.r(24 + i * 46, 392, 36, 54, '#e8f0f8'); p.r(28 + i * 46, 396, 28, 10, '#ef233c'); p.r(28 + i * 46, 410, 28, 32, ['#22d3ee', '#ec4899', '#facc15', '#4ade80', '#a78bfa'][i]); } },
  forge: (p, t) => { for (let i = 0; i < 4; i++) { const gl = 0.5 + Math.sin(t * 4 + i) * 0.3; p.r(20 + i * 60, 410, 50, 40, '#3a1e10'); p.r(24 + i * 60, 414, 42, 32, `rgba(255,${120 + i * 20},40,${gl})`); } },
  crypt: (p, t) => { for (let i = 0; i < 3; i++) { p.r(20 + i * 80, 400, 70, 50, '#5a4a3a'); p.r(24 + i * 80, 396, 62, 8, '#e8dcc0'); p.r(48 + i * 80, 412, 14, 10, '#ffe23d'); } for (const cx of [10, 255]) { p.r(cx, 430, 6, 18, '#e8e0d0'); p.circ(cx + 3, 426 + Math.sin(t * 9 + cx) , 3, '#ffb000'); } },
  lab: (p, t) => { for (let i = 0; i < 5; i++) { const x = 24 + i * 48; p.r(x, 410, 26, 36, '#d8f0ff55'); p.r(x + 2, 426, 22, 18, ['#4ade80', '#a43bff', '#22d3ee', '#ff3fd2', '#b4ff3a'][i]); p.r(x + 9, 398, 8, 12, '#d8f0ff55'); p.circ(x + 13, 420 - ((t * 20 + i * 9) % 20), 2, '#ffffffaa'); } },
};

// Draw one frame: shed for the floor, the room's props, a red pulse in a boss fight.
export function drawShed(x, { floor = 1, room = '', boss = false, t = 0 } = {}) {
  const p = painter(x);
  x.clearRect(0, 0, W, H);
  const i = SHEDS.indexOf(shedFor(floor));
  SCENES[Math.max(0, i)](p, t);
  ROOM_PROPS[room]?.(p, t);
  if (boss) { x.fillStyle = `rgba(255,30,60,${0.12 + Math.sin(t * 3) * 0.08})`; x.fillRect(0, 0, W, H); }
  // A little vignette.
  const g = x.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 300); g.addColorStop(0, '#0000'); g.addColorStop(1, '#000a');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
}

// ── the page ────────────────────────────────────────────────────────────────
// Store, 2026-11-11: "do green screen" -- by default this page is now the
// first-person shed crawl (scripts/shed-crawl-fp.mjs), full screen behind the
// top camera: it walks as the dungeon fills, the boss waits at the end, the
// store's item photos hang on the racks and slab walls. #painted=1 brings back
// the painted sheds; #demo=1 tours them.
if (typeof document !== 'undefined' && document.getElementById('shed')) {
  const canvas = document.getElementById('shed'), params = new URLSearchParams(location.hash.slice(1));
  const demo = params.get('demo') === '1', painted = demo || params.get('painted') === '1', preview = params.get('preview') === '1';
  const token = params.get('token'), store = params.get('store'), endpoint = params.get('worker');
  let label = document.getElementById('shed-label');
  let view = { floor: Math.max(1, Number(params.get('shed')) || 1), room: params.get('room') || '', boss: params.get('boss') === '1' };
  let onState = () => {}, pending = null;
  if (painted) {
    const x = canvas.getContext('2d'), start = performance.now();
    const frame = now => {
      const t = (now - start) / 1000;
      if (demo) { const k = Math.floor(t / 4); view = { floor: (k % SCENE_COUNT) + 1, room: ROOMS[k % ROOMS.length].id, boss: k % 3 === 2 }; }
      drawShed(x, { ...view, t });
      if (label) label.textContent = demo ? shedFor(view.floor) + ' + ' + ROOMS.find(r => r.id === view.room)?.name + (view.boss ? ' (BOSS)' : '') : '';
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    onState = m => { const d = m.stats?.dungeon; if (d) view = { floor: d.floor, room: d.room?.id || '', boss: d.phase === 'boss' }; };
  } else {
    // The crawl fills the TOP camera's area (down to the sign: settings.y,
    // 850 by default), 360 wide drawn 3x, so its horizon sits in the middle of
    // the top camera -- you look down the hall, not at the ceiling.
    Promise.all([import('./shed-crawl-fp.mjs?v=19'), import('./live-studio-bosses.mjs'), import('./prop-models.mjs?v=3').catch(() => null), import('./live-studio-3d.mjs').catch(() => null), import('./beasts.mjs?v=3').catch(() => null)]).then(([fpm, bosses, pm, gl3d, beasts]) => {
      // BEASTS mode (2026-11-13): the top-down route in four greens, you (and your buddy) walking it.
      let world = null, beastsOn = false;
      // The 3D props (Duke Nukem style), photographed once from 8 angles.
      let baked = null; try { baked = pm?.bakeProps({ size: 64 }) || null; } catch (e) { console.warn('[shed] 3D props off:', e?.message || e); }
      let fp = null, topH = 0, sharp = false;
      const build = y => {
        const h = Math.max(300, Math.min(1920, Math.round(Number(y) || 850)));
        if (h === topH && fp) return; topH = h;
        // SHARPER PIXELS (2026-11-12): 480 across instead of 360 when the remote says so (it costs the computer more).
        const W = sharp ? 480 : 360;
        fp?.stop(); fp = fpm.createShedCrawl(canvas, { w: W, h: Math.round(W * h / 1080), fov: 0.66 });
        canvas.style.height = h + 'px'; bossId = ''; picKey = ''; window.shedCrawl = fp; if (baked) fp.setModels(baked); fp.start();
      };
      const bossCanvas = document.createElement('canvas');
      let stats = null, stage = { now: null, next: [] }, shedPics = [], offset = 0, bossId = '', picKey = '';
      const img = u => { try { return endpoint ? new URL(endpoint).origin + '/public/studio-img?u=' + encodeURIComponent(u) : u; } catch { return u; } };
      const paint = () => {
        const d = stats?.dungeon || (settings0.gameMode === 'beasts' ? { floor: 1, pct: 0, phase: 'floor' } : null); if (!d) return;
        if (beasts && settings0.gameMode === 'beasts') {
          if (!beastsOn) { fp?.stop(); world = beasts.createWorld(canvas, { w: 240, h: Math.round(240 * 850 / 1080) }); world.start(); beastsOn = true; mini.hidden = true; }
          world.set({ floor: d.floor, pct: d.pct, phase: d.phase, face: settings0.beastsFace || '', buddy: settings0.beastsBuddy || '' });
          bubble.classList.remove('on'); paintBattle(d); // the dungeon's boss taunt stays out of the route
          return;
        }
        if (beastsOn) { world?.stop(); world = null; beastsOn = false; topH = 0; build(850); bossId = ''; picKey = ''; }
        paintBattle(null);
        const now = Date.now() + offset;
        fp.setClock?.(offset);
        // The photos and the hall's state: the same recipe as the overlay's front layer (shed-crawl-fp.mjs).
        const pics = fpm.crawlPictures(stage, shedPics), key = pics.urls.join('|');
        picUrls = pics.urls; picItems = pics.items;
        if (key !== picKey) { picKey = key; Promise.all(pics.urls.map(u => fpm.loadPicture(img(u)))).then(list => fp.setPictures(list, pics.kinds)); }
        // The boss grabs the priciest item in NEXT UP and holds it up.
        taunt(d, fpm.bossGrabFrom(stage));
        // BOSS ATTACKS (2026-11-12): at 2/3 and 1/3 of its HP the boss pulls its move in the arena.
        const rk = d.boss.character + '|' + d.floor, rStage = d.phase !== 'boss' ? -1 : d.pct <= 33.4 ? 2 : d.pct <= 66.7 ? 1 : 0;
        if (rk !== rage.key) rage = { key: rk, seen: rStage }; else if (rStage > rage.seen) { rage.seen = rStage; fp.attack(bosses.bossById(d.boss.character).move); }
        fp.set(fpm.crawlStateFrom({ stats, stage, urls: pics.urls, now, testUntil, hideNear }));
        // A sale landing on the boss: the hall shakes (the overlay flashes over the hosts at the same time).
        const hp = d.phase === 'boss' ? Number(d.boss?.hp) : NaN; if (hp < lastHp) fp.hit?.(); lastHp = hp;
        // The boss in the arena: the 3D model, moving (flat pixel art without WebGL).
        if (bossId !== d.boss.character) { bossId = d.boss.character; let anim = null; try { anim = gl3d?.bakeBoss?.(bossId, { size: 96 }); } catch {} if (anim) fp.setBoss(anim); else void bosses.drawBoss(bossCanvas, bossId, { size: 48 }).then(ok => { if (ok) fp.setBoss(bossCanvas); }); }
      };
      // THE CLOSE-UP (2026-11-12: "item images need to be clearer, so we can tell
      // what they are"): the item you're walking right past, sharp, with its name and price.
      let picItems = [], cardAt = -1, picUrls = [], miniOn = true;
      // THE VENDING MACHINE (2026-11-13): for breaks and surprise sets -- the items
      // in rows of three, scrolling past, each SOLD OUT or still lit; on the green
      // screen behind the hosts while it's on (the remote's VENDING MACHINE).
      // Now drawn by scripts/vending.mjs (2026-11-13 polish): small or full screen behind the hosts, a BID button on every slot.
      let drawMachine = () => {}, lastMachine = null;
      import('./vending.mjs?v=1').then(v => { drawMachine = v.createVending(document, { img, where: 'green' }); if (lastMachine) drawMachine(lastMachine); }).catch(e => console.warn('[shed] machine off:', e?.message || e));
      // THE BATTLE ON THE GREEN SCREEN (2026-11-13: "I may also want the pokemon game thing to also be the green screen ... I want the option"):
      // with WHERE THE BATTLE SHOWS on BEHIND US, the battle is drawn here, behind the hosts, instead of on the overlay.
      const bcv = Object.assign(document.createElement('canvas'), { id: 'shed-battle', hidden: true }); document.body.append(bcv);
      let battle = null, battleOn = false, rivalArt = '';
      const batteryOf = d => { const last = Math.max(Number(stats?.lastSaleAt) || 0, Number(d?.lastAt) || 0); return last ? Math.max(0.15, Math.min(1, 1 - (Date.now() + offset - last) / 360000)) : 1; };
      const paintBattle = d => {
        const b = beasts && d && settings0.gameMode === 'beasts' && settings0.beastsBattle === 'green' ? beasts.battleFrom(d, { battery: batteryOf(d), bossName: d.boss?.name, starter: stats?.beastStarter }) : null;
        bcv.hidden = !b; if (!b) { if (battleOn) { battle?.stop(); battleOn = false; } return; }
        if (!battle) battle = beasts.createBattle(bcv, { scale: 3 });
        battle.set(b, { moves: beasts.movesFrom(settings0.beastsMoves), pick: Number(stats?.beastMove) || 0 });
        if (b.kind === 'rival' && rivalArt !== d.boss.character) { rivalArt = d.boss.character; const c = document.createElement('canvas'); void bosses.drawBoss(c, rivalArt, { size: 48 }).then(ok => { if (ok) battle?.setRival(c); }); }
        if (!battleOn) { battle.start(); battleOn = true; }
      };
      // Its attacks: the one the host taps, and every sale fires the one chat picked.
      const battleFx = e => { if (!battleOn || !battle || !e) return; if (e.kind === 'move') battle.attack(e.move); else if (['sold', 'jackpot', 'boss'].includes(e.kind)) { const mv = beasts.movesFrom(settings0.beastsMoves); battle.attack(mv[Number(stats?.beastMove) || 0] || mv[0]); } };
      // THE MINI-MAP (2026-11-12): top left, filling in as you walk.
      const mini = Object.assign(document.createElement('canvas'), { id: 'shed-mini' }), miniCtx = mini.getContext('2d'); document.body.append(mini);
      setInterval(() => { mini.hidden = !miniOn || !stats?.dungeon; if (!mini.hidden) fp?.drawMap?.(miniCtx, { cell: 7 }); }, 300);
      // THE BOSS'S TAUNT: a speech bubble -- the item it grabbed, then its own line, in turn.
      const bubble = Object.assign(document.createElement('div'), { id: 'shed-taunt' }); document.body.append(bubble);
      const taunt = (d, grab) => {
        const up = d.phase === 'boss' || Date.now() < testUntil; bubble.classList.toggle('on', up && (Date.now() / 1000) % 14 < 7);
        if (!up) return; const mine = grab && Math.floor(Date.now() / 14000) % 2 === 0;
        bubble.textContent = d.boss.name + ': "' + (mine ? String(grab.title || 'THIS GRAIL').toUpperCase().slice(0, 48) + ' IS MINE!' : bosses.bossById(d.boss.character).taunt) + '"';
      };
      const card = Object.assign(document.createElement('div'), { id: 'shed-item' }), cardImg = document.createElement('img'), cardTxt = document.createElement('b');
      cardImg.alt = ''; card.append(cardImg, cardTxt); document.body.append(card);
      setInterval(() => {
        const boss = beastsOn || stats?.dungeon?.phase === 'boss' || Date.now() < testUntil, i = boss ? -1 : fp?.nearItem?.() ?? -1, it = i >= 0 ? picItems[i] : null; // in a boss fight the boss's item is the star
        if (it && it.image) { if (cardAt !== i) { cardAt = i; cardImg.src = img(it.image); cardTxt.textContent = String(it.title || '').slice(0, 60) + (Number(it.price) > 0 ? '  ·  $' + Number(it.price).toFixed(2) : ''); cardTxt.hidden = !it.title; } card.classList.add('on'); }
        else if (cardAt >= 0 && !card.classList.contains('hold')) { card.classList.remove('on'); cardAt = -1; }
      }, 250);
      let settings0 = {}, lastHp = NaN, hideNear = true, rage = { key: '', seen: -1 }, testUntil = 0;
      onState = m => { if (m.type === 'camera') { fp?.setCamera?.(m.cam); return; }
        // The remote's TEST A BOSS ATTACK: into the arena for 8 seconds, and the boss attacks.
        if (m.type === 'attack') { if (beastsOn) return; const d = stats?.dungeon; testUntil = Date.now() + 8000; if (d) { paint(); setTimeout(() => fp.attack(bosses.bossById(d.boss.character).move), 2600); setTimeout(paint, 8100); } return; } if (m.settings) { settings0 = m.settings; miniOn = m.settings.miniMap !== false && m.settings.gameMode !== 'beasts'; if ((m.settings.crawlSharp === true) !== sharp) { sharp = m.settings.crawlSharp === true; topH = 0; build(850); bossId = ''; } hideNear = m.settings.foreground !== false && m.settings.dungeonOn !== false; canvas.style.visibility = m.settings.crawlWindow === true ? 'hidden' : ''; } if (m.settings && Number.isFinite(Number(m.settings.y))) build(m.settings.y); if (Number.isFinite(m.serverNow)) offset = m.serverNow - Date.now(); if (m.stats) stats = m.stats; if (m.stage) stage = m.stage; if (Array.isArray(m.pics)) shedPics = m.pics; if (m.machine) { lastMachine = m.machine; drawMachine(m.machine); } paint(); if (m.effect && (m.type === 'effect' || m.fresh)) battleFx(m.effect); };
      setInterval(paint, 5000);
      setInterval(() => { const d = stats?.dungeon; if (d && !beastsOn) { let grab = null; for (const n of [stage.now, ...(stage.next || [])]) if (n && n.image && (!grab || (Number(n.price) || 0) > (Number(grab.price) || 0))) grab = n; taunt(d, grab); } }, 1000);
      build(850);
      fp.set({ floor: view.floor, shed: shedFor(view.floor), pct: 30, phase: view.boss ? 'boss' : 'floor' });
      if (pending) onState(pending);
    }).catch(e => console.warn('[shed] crawl off:', e?.message || e));
  }
  // Live: the same read-only overlay link (#worker=…&store=…&token=…).
  let retry = 0;
  function connect() {
    if (!endpoint || !store || !token) return;
    let url; try { url = new URL(endpoint); if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return; } catch { return; }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.pathname = '/live-studio/socket'; url.search = '?store_id=' + encodeURIComponent(store); url.hash = '';
    const socket = new WebSocket(url);
    socket.onopen = () => socket.send(JSON.stringify({ token }));
    socket.onmessage = ev => { try { const m = JSON.parse(ev.data); retry = 0; onState(m); } catch {} };
    socket.onclose = ev => { if (ev.code === 1008) return; setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(retry++, 5))); };
  }
  // Live Studio's preview: the dashboard sends the state (same page only), no socket.
  if (preview) window.addEventListener('message', ev => { if (ev.source !== parent || ev.origin !== location.origin) return; if (ev.data?.type === 'mana-camera') { onState({ type: 'camera', cam: ev.data.cam }); return; } if (ev.data?.type === 'mana-attack') { onState({ type: 'attack' }); return; } if (ev.data?.type !== 'mana-preview') return; pending = { settings: ev.data.settings, stats: ev.data.stats, stage: ev.data.stage, pics: ev.data.pics, machine: ev.data.machine, effect: ev.data.effect, fresh: !!ev.data.effect }; onState(pending); });
  else if (!demo) connect();
}
