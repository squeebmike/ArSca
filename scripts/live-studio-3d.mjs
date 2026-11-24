// Live Studio in 3D: polished-N64 coins and bosses (store, 2026-11-02:
// "I do want the graphics to look better. Think polished N64... coins.
// Arcade shit. Bosses look lame."). Low-poly models with smooth shading,
// glossy highlights and bouncy animation, all built from simple shapes here
// (original art, no models or textures from anywhere else). three.js is
// bundled in assets/vendor so the stream never waits on a CDN. The overlay
// falls back to the flat sprites when WebGL isn't there.
import * as THREE from '../assets/vendor/three-0.160.0.module.min.js';

export const THREE_VERSION = THREE.REVISION;
const TAU = Math.PI * 2;

// ── shared bits ─────────────────────────────────────────────────────────────
function renderer(canvas, w, h, { antialias = true } = {}) {
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias, premultipliedAlpha: true });
  r.setPixelRatio(1);
  r.setSize(w, h, false);
  r.setClearColor(0x000000, 0);
  return r;
}
function lights(scene, { key = 1.5, rim = 0x7c3aed } = {}) {
  scene.add(new THREE.HemisphereLight(0xfff4d6, 0x3a1466, 1.15));
  const k = new THREE.DirectionalLight(0xffffff, key); k.position.set(-3, 5, 6); scene.add(k);
  const r = new THREE.DirectionalLight(rim, 1.4); r.position.set(4, 2, -5); scene.add(r);
}
// Glossy, saturated plastic -- the N64 look.
const mat = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 70, specular: 0x555555, ...o });
const flat = (color, o = {}) => mat(color, { flatShading: true, ...o });
function textTexture(text, { w = 256, h = 128, bg = '#ff2a4f', fg = '#fff', font = '900 84px Arial Black, Arial, sans-serif', stroke = '#0b0612' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (stroke) { x.lineWidth = 10; x.strokeStyle = stroke; x.strokeText(text, w / 2, h / 2 + 4); }
  x.fillStyle = fg; x.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const add = (parent, mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const ball = (r, m, seg = 14) => new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), m);
const cyl = (rt, rb, h, m, seg = 12) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
const cone = (r, h, m, seg = 8) => new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m);

// Big cartoon eyes: white, pupil, a brow (angry tilts it in).
function eyes(parent, { x = 0.26, y = 0, z = 0.5, r = 0.2, angry = false, look = 0 } = {}) {
  const white = mat(0xffffff, { shininess: 100 }), black = mat(0x0b0612, { shininess: 120 }), out = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * x, y, z); parent.add(g);
    const e = ball(r, white, 16); e.scale.set(1, 1.2, 0.55); g.add(e);
    add(g, ball(r * 0.48, black, 12), look * r * 0.3, -r * 0.08, r * 0.42).scale.set(1, 1.2, 0.6);
    add(g, ball(r * 0.14, white, 8), look * r * 0.3 - r * 0.12, r * 0.12, r * 0.6);
    if (angry) { const b = add(g, box(r * 2.3, r * 0.38, r * 0.4, mat(0x0b0612)), 0, r * 1.35, r * 0.2); b.rotation.z = s * -0.45; }
    out.push(g);
  }
  return out;
}
function grin(parent, { y = -0.2, z = 0.5, w = 0.5, teeth = true } = {}) {
  const m = new THREE.Group(); m.position.set(0, y, z); parent.add(m);
  const mouth = box(w, w * 0.32, 0.1, mat(0x2b0710)); m.add(mouth);
  if (teeth) for (let i = 0; i < 5; i++) add(m, box(w / 6, w * 0.13, 0.06, mat(0xffffff, { shininess: 120 })), -w / 2 + w / 10 + i * w / 5, w * 0.08, 0.04);
  return m;
}
const limb = (m, len = 0.55, r = 0.09) => cyl(r, r * 0.85, len, m, 8);
function legs(parent, m, { y = -1.05, x = 0.32, len = 0.4 } = {}) {
  const out = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * x, y, 0); parent.add(g);
    add(g, limb(m, len), 0, -len / 2, 0);
    const shoe = add(g, ball(0.17, mat(0x0b0612), 10), 0, -len, 0.08); shoe.scale.set(1.2, 0.6, 1.6);
    out.push(g);
  }
  return out;
}

// ── MR FISTER's gauntlet covers ─────────────────────────────────────────
// The store's own comic covers set in the glove like power stones (ratio variants first, foils next): five small
// canvases every Mr Fister model shares; setFisterCovers() paints the covers in as they load (until then, a glowing
// green placeholder). Images come through the studio's image proxy so WebGL can use them.
let fisterTex = null;
function fisterTextures() {
  if (fisterTex) return fisterTex;
  fisterTex = Array.from({ length: 5 }, (_, k) => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 96; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 64, 96); g.addColorStop(0, ['#39ff14', '#22e6ff', '#ff3fd2', '#ffe23d', '#ff2a4f'][k]); g.addColorStop(1, '#0b0612');
    x.fillStyle = g; x.fillRect(0, 0, 64, 96); x.strokeStyle = '#fff'; x.lineWidth = 4; x.strokeRect(2, 2, 60, 92);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  });
  return fisterTex;
}
// His face: one shared material for every Mr Fister on screen (the photo the remote sends), and his skin tone taken
// from the photo's cheeks so the arms and neck match.
let fisterSkinMat = null, fisterFaceMatI = null, fisterFaceOn = false; const fisterHeads = [];
// MR FISTER's textures (store, 2026-11-14: "better model and texture"), painted here on small canvases with a fixed
// pattern (no dice): skin with soft shading and pores, a cotton tee, denim, hair strands for the beard, brushed steel.
const fisterTexCache = {};
function paintTex(key, w, h, draw, rep = [1, 1]) {
  if (fisterTexCache[key]) return fisterTexCache[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 4;
  return (fisterTexCache[key] = t);
}
const fixed = (k, m = 0) => ((Math.sin(k * 12.9898 + m * 78.233) * 43758.5453) % 1 + 1) % 1;
const fisterMaps = {
  skin: () => paintTex('skin', 128, 128, (x, w, h) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); for (let k = 0; k < 900; k++) { const a = fixed(k, 1) * 0.08; x.fillStyle = `rgba(120,70,50,${a})`; x.fillRect(fixed(k, 2) * w, fixed(k, 3) * h, 1 + fixed(k, 4) * 2, 1 + fixed(k, 5) * 2); } }),
  tee: () => paintTex('tee', 128, 128, (x, w, h) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 2) { x.fillStyle = `rgba(0,0,0,${0.06 + 0.04 * fixed(y, 1)})`; x.fillRect(0, y, w, 1); } for (let k = 0; k < 400; k++) { x.fillStyle = `rgba(0,0,0,${fixed(k, 6) * 0.12})`; x.fillRect(fixed(k, 7) * w, fixed(k, 8) * h, 3, 1); } }, [4, 3]),
  denim: () => paintTex('denim', 128, 128, (x, w, h) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); for (let d = -h; d < w; d += 3) { x.strokeStyle = `rgba(0,0,30,${0.12 + 0.08 * fixed(d, 2)})`; x.beginPath(); x.moveTo(d, h); x.lineTo(d + h, 0); x.stroke(); } for (let k = 0; k < 300; k++) { x.fillStyle = `rgba(255,255,255,${fixed(k, 9) * 0.15})`; x.fillRect(fixed(k, 10) * w, fixed(k, 11) * h, 2, 1); } }, [3, 3]),
  hair: () => paintTex('hair', 128, 128, (x, w, h) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); for (let k = 0; k < 700; k++) { const x0 = fixed(k, 12) * w, y0 = fixed(k, 13) * h, l = 4 + fixed(k, 14) * 8, a = Math.PI / 2 + (fixed(k, 15) - 0.5) * 0.7; x.strokeStyle = `rgba(0,0,0,${0.25 + fixed(k, 16) * 0.35})`; x.lineWidth = 1; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + Math.cos(a) * l, y0 + Math.sin(a) * l); x.stroke(); } }, [3, 3]),
  steel: () => paintTex('steel', 128, 128, (x, w, h) => { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#c9cdd2'); g.addColorStop(1, '#ffffff'); x.fillStyle = g; x.fillRect(0, 0, w, h); for (let y = 0; y < h; y++) { x.fillStyle = `rgba(0,0,0,${0.03 + 0.05 * fixed(y, 17)})`; x.fillRect(0, y, w, 1); } for (let k = 0; k < 24; k++) { x.strokeStyle = 'rgba(40,40,40,.35)'; const x0 = fixed(k, 18) * w, y0 = fixed(k, 19) * h; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + (fixed(k, 20) - 0.5) * 30, y0 + (fixed(k, 21) - 0.5) * 10); x.stroke(); } }),
  // Glowing cracks for the symbiote goo: branching lines, a fixed pattern, lit only where the lines are.
  cracks: () => paintTex('cracks', 256, 256, (x, w, h) => { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.strokeStyle = '#7dff5a'; x.shadowColor = '#39ff14'; x.shadowBlur = 6; x.lineCap = 'round';
    const branch = (x0, y0, a, len, wd, depth, k) => { if (depth > 4 || len < 4) return; let px = x0, py = y0; x.lineWidth = wd; x.beginPath(); x.moveTo(px, py); for (let s = 0; s < 6; s++) { a += (fixed(k, s + depth * 7) - 0.5) * 0.9; px += Math.cos(a) * len / 6; py += Math.sin(a) * len / 6; x.lineTo(px, py); } x.stroke(); branch(px, py, a + 0.6, len * 0.65, wd * 0.7, depth + 1, k * 3 + 1); if (fixed(k, depth) > 0.35) branch(px, py, a - 0.7, len * 0.6, wd * 0.65, depth + 1, k * 3 + 2); };
    for (let k = 0; k < 9; k++) branch(fixed(k, 30) * w, fixed(k, 31) * h, fixed(k, 32) * Math.PI * 2, 90, 3.2, 0, k + 1); }, [2, 2]),
  emblem: () => paintTex('emblem', 128, 128, (x, w, h) => { x.clearRect(0, 0, w, h); x.fillStyle = '#39ff14'; x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.fill(); x.fillStyle = '#0b0f0c'; x.beginPath(); x.arc(64, 64, 50, 0, Math.PI * 2); x.fill(); x.fillStyle = '#39ff14'; x.fillRect(38, 46, 52, 34); for (let k = 0; k < 4; k++) x.fillRect(40 + k * 13, 34, 10, 14); x.fillRect(46, 80, 30, 22); x.fillStyle = '#0b0f0c'; for (let k = 1; k < 4; k++) x.fillRect(38 + k * 13 - 2, 34, 2, 14); }),
};
// ICE BERG's textures: the jersey (navy mesh, green and grey trim, a big 12 front and back -- no team logos), the
// watch dial (a pilot's chronograph look, no brand), pavé diamonds, a studio to reflect in the platinum, a star glint.
const icebergMaps = {
  jersey: () => paintTex('ice-jersey', 1024, 512, (x, w, h) => {
    x.fillStyle = '#0b2545'; x.fillRect(0, 0, w, h);
    for (let yy = 0; yy < h; yy += 6) for (let xx = (yy / 6) % 2 * 3; xx < w; xx += 6) { x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(xx, yy, 2, 2); }
    for (const sx of [w * 0.25, w * 0.75]) { x.fillStyle = '#69be28'; x.fillRect(sx - 7, 0, 14, h); x.fillStyle = '#a5acaf'; x.fillRect(sx - 3, 0, 6, h); } // side panels
    x.fillStyle = '#05162c'; x.fillRect(0, h - 34, w, 34); // the hem
    const num = cx => { x.save(); x.translate(cx, h * 0.7); x.font = '900 300px "Arial Black", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; const k = 170 / x.measureText('12').width; x.scale(k, 1); x.lineJoin = 'round'; x.lineWidth = 30; x.strokeStyle = '#69be28'; x.strokeText('12', 0, 0); x.lineWidth = 12; x.strokeStyle = '#0b2545'; x.strokeText('12', 0, 0); x.fillStyle = '#a5acaf'; x.fillText('12', 0, 0); for (let k2 = 0; k2 < 40; k2++) { x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(-90 + (k2 * 37) % 180, -110 + (k2 * 53) % 220, 4, 4); } x.restore(); };
    num(w / 2); num(0); num(w); // front; the back straddles the seam
  }),
  dial: () => paintTex('ice-dial', 256, 256, (x, w, h) => {
    const g = x.createRadialGradient(110, 100, 10, 128, 128, 128); g.addColorStop(0, '#1d4e9a'); g.addColorStop(1, '#061633'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.translate(128, 128);
    for (let k = 0; k < 60; k++) { x.save(); x.rotate(k / 60 * Math.PI * 2); x.fillStyle = k % 5 ? '#c9d3e0' : '#ffffff'; x.fillRect(-1.5, -122, k % 5 ? 3 : 6, k % 5 ? 10 : 22); x.restore(); }
    for (const [sx, sy] of [[-48, 8], [48, 8], [0, 52]]) { x.strokeStyle = '#d8dee8'; x.lineWidth = 4; x.beginPath(); x.arc(sx, sy, 24, 0, Math.PI * 2); x.stroke(); x.fillStyle = '#0a2450'; x.fill(); for (let k = 0; k < 12; k++) { x.save(); x.translate(sx, sy); x.rotate(k / 12 * Math.PI * 2); x.fillStyle = '#d8dee8'; x.fillRect(-1, -22, 2, 6); x.restore(); } x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + 14, sy - 10); x.stroke(); }
    x.strokeStyle = '#eef2f7'; x.lineCap = 'round'; x.lineWidth = 9; x.beginPath(); x.moveTo(0, 0); x.lineTo(-40, -50); x.stroke(); x.lineWidth = 6; x.beginPath(); x.moveTo(0, 0); x.lineTo(70, -70); x.stroke();
    x.strokeStyle = '#ffcc00'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, 20); x.lineTo(0, -110); x.stroke(); x.fillStyle = '#eef2f7'; x.beginPath(); x.arc(0, 0, 8, 0, Math.PI * 2); x.fill();
  }),
  pave: () => paintTex('ice-pave', 128, 128, (x, w, h) => { x.fillStyle = '#9aa6b4'; x.fillRect(0, 0, w, h); for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) { const cx = xx * 32 + 16 + (yy % 2) * 8, cy = yy * 32 + 16, g = x.createRadialGradient(cx - 4, cy - 4, 1, cx, cy, 14); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#dff6ff'); g.addColorStop(1, '#7d8a99'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 13, 0, Math.PI * 2); x.fill(); } }, [3, 3]),
  env: () => { const t = paintTex('ice-env', 512, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a1450'); g.addColorStop(0.5, '#0b0612'); g.addColorStop(1, '#12301a'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#ffffff'; x.fillRect(60, 40, 120, 30); x.fillRect(320, 50, 90, 22); x.fillRect(0, 118, w, 6); x.fillStyle = '#9be7ff'; x.fillRect(200, 150, 140, 14); x.fillStyle = '#c084fc'; x.fillRect(420, 90, 60, 50); }); t.mapping = THREE.EquirectangularReflectionMapping; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(1, 1); return t; },
  glint: () => paintTex('ice-glint', 64, 64, (x, w, h) => { x.clearRect(0, 0, w, h); const g = x.createRadialGradient(32, 32, 0, 32, 32, 30); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(190,240,255,.6)'); g.addColorStop(1, 'rgba(160,220,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(31, 0, 2, 64); x.fillRect(0, 31, 64, 2); }),
};
function fisterSkin() { return fisterSkinMat || (fisterSkinMat = mat(0xc4865e, { shininess: 22, specular: 0x332222, map: typeof document === 'undefined' ? null : fisterMaps.skin() })); }
function fisterFaceMat() {
  if (fisterFaceMatI) return fisterFaceMatI;
  const c = document.createElement('canvas'); c.width = 128; c.height = 146;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (fisterFaceMatI = new THREE.MeshPhongMaterial({ map: t, transparent: true, shininess: 10, specular: 0x222222 }));
}
export function setFisterFace(dataUrl = '') {
  if (typeof document === 'undefined') return;
  const m = fisterFaceMat(), c = m.map.image, x = c.getContext('2d');
  const show = on => { fisterFaceOn = on; for (const h of fisterHeads) { h.face.visible = on; h.feats.visible = !on; } };
  if (!dataUrl) { x.clearRect(0, 0, c.width, c.height); m.map.needsUpdate = true; show(false); return; }
  const im = new Image();
  im.onload = () => {
    x.clearRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    // Feather the edges into the head (an oval mask), so there's no square photo edge.
    const d = x.getImageData(0, 0, c.width, c.height); let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) { const i = (y * c.width + xx) * 4, ex = (xx - c.width / 2) / (c.width * 0.5), ey = (y - c.height * 0.5) / (c.height * 0.52), e = ex * ex + ey * ey; d.data[i + 3] = e < 0.6 ? 255 : e > 1 ? 0 : Math.round(255 * (1 - (e - 0.6) / 0.4)); if (y > c.height * 0.4 && y < c.height * 0.55 && Math.abs(ex) > 0.3 && Math.abs(ex) < 0.55) { r += d.data[i]; g += d.data[i + 1]; b += d.data[i + 2]; n++; } }
    // A black-and-white photo gets his skin tone back (warm, from the default); a colour one sets the body's tone.
    const mx = n ? Math.max(r, g, b) / n : 0, mn = n ? Math.min(r, g, b) / n : 0, grey = !n || (mx - mn) / Math.max(1, mx) < 0.1;
    if (grey) { const tone = [218, 160, 118], avg = n ? (r + g + b) / 3 / n : 128; for (let i = 0; i < d.data.length; i += 4) { const l = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3 / Math.max(40, avg); d.data[i] = Math.min(255, tone[0] * l); d.data[i + 1] = Math.min(255, tone[1] * l); d.data[i + 2] = Math.min(255, tone[2] * l); } }
    x.putImageData(d, 0, 0); m.map.needsUpdate = true;
    if (n && !grey) fisterSkin().color.setRGB(r / n / 255, g / n / 255, b / n / 255).convertSRGBToLinear();
    show(true);
  };
  im.src = dataUrl;
}
export function setFisterCovers(urls = []) {
  if (typeof document === 'undefined') return;
  const list = (urls || []).filter(Boolean).slice(0, 5); if (!list.length) return;
  const tex = fisterTextures();
  tex.forEach((t, k) => {
    const src = list[k % list.length], im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { try { const x = t.image.getContext('2d'), sc = Math.max(64 / im.naturalWidth, 96 / im.naturalHeight); x.drawImage(im, (64 - im.naturalWidth * sc) / 2, (96 - im.naturalHeight * sc) / 2, im.naturalWidth * sc, im.naturalHeight * sc); x.strokeStyle = '#39ff14'; x.lineWidth = 4; x.strokeRect(2, 2, 60, 92); t.needsUpdate = true; } catch {} };
    im.src = src;
  });
}

// ── the bosses ─────────────────────────────────────────────────────────
// Each returns { root, tick(t) } -- tick runs the idle animation.
const BUILD = {
  fister(root) {
    // MR FISTER (store, 2026-11-14: "make Mr Fister look cooler ... better model for the boss ... particle effects. And the
    // fist pump animation!"): built from scratch -- a big frame, backwards cap, sculpted beard and goatee, black tee with
    // green trim, glowing veins down his right arm into THE GAUNTLET OF GRAILS (armoured, spiked knuckles, the store's
    // comic covers set in it like stones). Green energy crackles round the fist and embers rise round him; the pump winds
    // up, punches the sky and sends a shockwave across the floor. His photo goes on the face when the remote sends one.
    const skin = fisterSkin().clone(), tee = mat(0x1d2027, { shininess: 10, map: fisterMaps.tee() }), trim = new THREE.MeshBasicMaterial({ color: 0x39ff14 }), jeans = mat(0x34405a, { shininess: 8, map: fisterMaps.denim() }), beard = mat(0x2a1a10, { shininess: 4, map: fisterMaps.hair() });
    const cap = mat(0x1a2d20, { shininess: 30 }), steel = mat(0xa7b0ba, { shininess: 170, specular: 0xffffff, map: fisterMaps.steel() }), dark = mat(0x4a5058, { shininess: 120, specular: 0xbbbbbb, map: fisterMaps.steel() }), shoe = mat(0x0f0f12, { shininess: 60 });
    const glowM = (o = 0.9) => new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending });
    const body = new THREE.Group(); root.add(body); // crouches and springs with the pump
    // Legs and hips.
    add(body, cyl(0.39, 0.35, 0.34, jeans, 16), 0, -0.72, 0).scale.set(1, 1, 0.72);
    const legsG = [];
    for (const sx of [-1, 1]) { const g = new THREE.Group(); g.position.set(sx * 0.19, -0.86, 0); body.add(g); add(g, cyl(0.18, 0.14, 0.36, jeans, 12), 0, -0.18, 0); add(g, cyl(0.14, 0.11, 0.32, jeans, 12), 0, -0.5, 0); add(g, ball(0.13, shoe, 12), 0, -0.67, 0.06).scale.set(1, 0.55, 1.7); legsG.push(g); }
    // A big chest (a lathe), the tee, green trim on the collar and sleeves.
    const prof = [[0.0, -0.58], [0.37, -0.58], [0.4, -0.42], [0.46, -0.15], [0.56, 0.06], [0.58, 0.2], [0.5, 0.32], [0.26, 0.41], [0.0, 0.43]].map(([r, y]) => new THREE.Vector2(r, y));
    const torso = add(body, new THREE.Mesh(new THREE.LatheGeometry(prof, 28), tee), 0, 0, 0); torso.scale.set(1, 1, 0.66);
    const emblem = add(body, new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), new THREE.MeshBasicMaterial({ map: fisterMaps.emblem(), transparent: true })), 0.2, 0.08, 0.375); emblem.rotation.y = 0.32; // his fist emblem on the chest
    const collar = add(body, new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 6, 20), trim), 0, 0.4, 0.02); collar.rotation.x = Math.PI / 2 - 0.25;
    for (const sx of [-1, 1]) add(body, ball(0.22, tee, 16), sx * 0.52, 0.24, 0).scale.set(1, 0.9, 0.85);
    add(body, cyl(0.13, 0.15, 0.2, skin, 12), 0, 0.48, 0.01);
    // The head: skull, ears, nose, brows, eyes, a sculpted beard down into a goatee, the cap backwards.
    const head = new THREE.Group(); head.position.set(0, 0.8, 0.02); body.add(head);
    add(head, ball(0.3, skin, 26), 0, 0, 0).scale.set(0.9, 1.1, 0.98);
    for (const sx of [-1, 1]) add(head, ball(0.06, skin, 10), sx * 0.27, -0.01, -0.02).scale.set(0.5, 1, 0.8);
    const feats = new THREE.Group(); head.add(feats);
    add(feats, cone(0.05, 0.13, skin, 8), 0, -0.03, 0.3).rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) { add(feats, ball(0.03, mat(0xf5f5f0, { shininess: 80 }), 8), sx * 0.1, 0.05, 0.255).scale.set(1.3, 0.8, 0.5); add(feats, ball(0.017, mat(0x0b0612, { shininess: 140 }), 8), sx * 0.1, 0.05, 0.27); const br = add(feats, box(0.13, 0.032, 0.035, beard), sx * 0.1, 0.115, 0.27); br.rotation.z = sx * -0.18; }
    add(feats, box(0.1, 0.022, 0.03, mat(0x5e2a24)), 0, -0.17, 0.29); // the mouth
    const beardM = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 14, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.4), beard); beardM.scale.set(0.93, 1.25, 1.04); head.add(beardM);
    // The chin beard: full and rounded, trimmed square at the bottom (2026-11-14: "fix his beard ... the cone is terrible").
    add(head, ball(0.15, beard, 18), 0, -0.3, 0.12).scale.set(1.15, 1.05, 0.85);
    add(head, ball(0.12, beard, 16), 0, -0.4, 0.11).scale.set(1.1, 0.75, 0.8);
    const stache = add(head, new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.026, 8, 18, Math.PI), beard), 0, -0.135, 0.255); stache.rotation.z = Math.PI; stache.scale.set(1.2, 0.75, 0.8); // the moustache, curving down into the beard
    add(head, box(0.18, 0.012, 0.02, new THREE.MeshBasicMaterial({ color: 0x0a0604 })), 0, -0.21, 0.29); // a sharp line-up at the cheeks
    for (const sx of [-1, 1]) { const sb = add(head, box(0.035, 0.17, 0.12, beard), sx * 0.255, -0.06, 0.08); sb.rotation.y = sx * 0.45; }
    const faceM = fisterFaceMat().clone(), face = new THREE.Mesh(new THREE.SphereGeometry(0.334, 24, 16, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.2, Math.PI * 0.62), faceM); face.scale.set(0.9, 1.1, 1.0); face.visible = fisterFaceOn; head.add(face);
    feats.visible = !fisterFaceOn; fisterHeads.push({ face, feats }); if (fisterHeads.length > 16) fisterHeads.splice(2, 1);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.315, 22, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), cap); crown.position.set(0, 0.1, -0.02); crown.scale.set(0.95, 0.95, 1.04); head.add(crown);
    const brim = add(head, box(0.3, 0.025, 0.24, cap), 0, 0.12, -0.38); brim.rotation.x = -0.22;
    add(head, ball(0.03, trim, 6), 0, 0.4, -0.02);
    const capBack = add(head, new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), new THREE.MeshBasicMaterial({ map: fisterMaps.emblem(), transparent: true })), 0, 0.2, -0.3); capBack.rotation.y = Math.PI; capBack.rotation.x = 0.35; // his fist emblem on the back of the cap
    // The arms: deltoid, a big biceps, forearm, hand. His left hangs; his RIGHT (our left) wears the gauntlet.
    const arm = g => { add(g, cyl(0.17, 0.15, 0.22, tee, 12), 0, -0.08, 0); add(g, new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.014, 6, 18), trim), 0, -0.19, 0).rotation.x = Math.PI / 2; add(g, ball(0.14, skin, 14), 0, -0.31, 0.01).scale.set(1, 1.65, 1); };
    const armL = new THREE.Group(); armL.position.set(0.52, 0.2, 0); body.add(armL); armL.rotation.z = 0.12; arm(armL);
    const foreL = new THREE.Group(); foreL.position.set(0, -0.52, 0); armL.add(foreL); add(foreL, cyl(0.12, 0.085, 0.42, skin, 12), 0, -0.21, 0); add(foreL, ball(0.095, skin, 10), 0, -0.47, 0.02).scale.set(0.9, 1.2, 0.8); foreL.rotation.x = -0.15;
    const shoulder = new THREE.Group(); shoulder.position.set(-0.52, 0.2, 0); body.add(shoulder); arm(shoulder);
    const elbow = new THREE.Group(); elbow.position.set(0, -0.52, 0); shoulder.add(elbow);
    add(elbow, cyl(0.12, 0.09, 0.42, skin, 12), 0, -0.21, 0);
    // Glowing veins down the arm into the glove.
    const veins = [];
    for (const [ang, len] of [[0.6, 0.38], [2.2, 0.3], [4.1, 0.34]]) { const v = add(elbow, cyl(0.009, 0.009, len, glowM(0.85), 4), Math.cos(ang) * 0.105, -0.25, Math.sin(ang) * 0.105); v.rotation.z = Math.cos(ang) * 0.12; veins.push(v); }
    const fist = new THREE.Group(); fist.position.set(0, -0.52, 0); fist.scale.setScalar(1.25); elbow.add(fist);
    // THE GAUNTLET: a wrist cuff with green rings, the armoured back of the hand, four knuckle plates with spikes.
    add(fist, cyl(0.13, 0.15, 0.16, dark, 14), 0, 0.17, 0);
    for (const y of [0.12, 0.22]) add(fist, new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.013, 6, 18), trim), 0, y, 0).rotation.x = Math.PI / 2;
    add(fist, box(0.3, 0.24, 0.26, steel), 0, -0.02, 0);
    for (let k = 0; k < 4; k++) { const x0 = -0.105 + k * 0.07; add(fist, box(0.062, 0.08, 0.29, dark), x0, -0.17, 0.0); add(fist, cone(0.022, 0.07, steel, 6), x0, -0.215, -0.11).rotation.x = Math.PI; }
    add(fist, box(0.08, 0.16, 0.09, dark), 0.16, -0.06, 0.06).rotation.z = 0.3; // the thumb
    const tex = fisterTextures();
    for (let k = 0; k < 4; k++) add(fist, new THREE.Mesh(new THREE.PlaneGeometry(0.052, 0.07), new THREE.MeshBasicMaterial({ map: tex[k] })), -0.105 + k * 0.07, -0.17, 0.147);
    const back = add(fist, new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.2), new THREE.MeshBasicMaterial({ map: tex[4] })), 0, 0.0, -0.132); back.rotation.y = Math.PI;
    const side = add(fist, new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.18), new THREE.MeshBasicMaterial({ map: tex[4] })), -0.153, 0, 0); side.rotation.y = -Math.PI / 2;
    const aura = add(fist, ball(0.32, glowM(0.18), 16), 0, 0, 0);
    const lamp = new THREE.PointLight(0x39ff14, 2, 3.2); fist.add(lamp);
    // PARTICLES: sparks orbiting the fist; embers rising round him; a shockwave ring on the floor at each punch.
    const pts = (n, size, color = 0x7dff5a) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); return new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })); };
    const sparks = pts(46, 0.05); fist.add(sparks);
    const embers = pts(70, 0.035, 0x39ff14); root.add(embers);
    const ring = add(root, new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40), glowM(0)), 0, -1.53, 0); ring.rotation.x = -Math.PI / 2;
    const glowFloor = add(root, new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), glowM(0.12)), 0, -1.54, 0); glowFloor.rotation.x = -Math.PI / 2;
    // SYMBIOTE MODE (store, 2026-11-14: "hit the button and he looks venomized"): our own take -- black goo spreads up from
    // the gauntlet over all of him, glossy, with green veins, glowing green eyes and goo tendrils whipping off his back.
    const crackMap = fisterMaps.cracks();
    const gooMats = [skin, tee, jeans, beard, cap, faceM].map(m => { m.emissiveMap = crackMap; m.emissive = new THREE.Color(0, 0, 0); m.needsUpdate = true; return { m, c: m === skin ? fisterSkin().color : m.color.clone(), sh: m.shininess }; }); // his skin follows the photo's tone (the shared master)
    const gooBlack = new THREE.Color(0x050607);
    const tendrils = [], gooTex = mat(0x050607, { shininess: 220, specular: 0x8899aa });
    for (let k = 0; k < 6; k++) { const g = new THREE.Group(); g.position.set((k % 3 - 1) * 0.28, 0.15 + Math.floor(k / 3) * 0.12, -0.25); body.add(g); const balls = []; for (let n = 0; n < 16; n++) balls.push(add(g, ball(0.12 * (1 - n / 19), gooTex, 10), 0, 0, 0)); g.visible = false; tendrils.push({ g, balls, k }); }
    // Big green bug eyes: glossy, bulging, slanted, glowing from inside, a glint on each.
    const gooEyes = []; for (const sx of [-1, 1]) { const e = new THREE.Group(); e.position.set(sx * 0.12, 0.06, 0.24); e.rotation.set(0, sx * 0.35, sx * -0.45); head.add(e);
      const lens = add(e, ball(0.1, new THREE.MeshPhongMaterial({ color: 0x1fbf10, emissive: 0x39ff14, emissiveIntensity: 0.9, shininess: 200, specular: 0xffffff }), 20), 0, 0, 0); lens.scale.set(1.25, 0.85, 0.75);
      add(e, ball(0.12, new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }), 14), 0, 0, 0).scale.set(1.3, 0.9, 0.8);
      add(e, ball(0.022, new THREE.MeshBasicMaterial({ color: 0xffffff }), 8), -0.03 * sx, 0.035, 0.07);
      e.visible = false; gooEyes.push(e); }
    let gooOn = false, gooK = 0, gooAt = 0;
    const seeded = (k, m) => ((Math.sin(k * 12.9898 + m * 78.233) * 43758.5453) % 1 + 1) % 1; // fixed per particle, no dice
    const ease = (a, b, k) => a + (b - a) * (k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k));
    return { mode(name, on) { if (name === 'goo') { gooOn = !!on; gooAt = -1; } }, tick(t) {
      // The goo: spreading in over 1.5 s (or peeling back off), from the gauntlet up.
      if (gooAt < 0) gooAt = t; const gk = gooOn ? Math.min(1, (t - gooAt) / 1.5) : Math.max(0, gooK - 0.05); gooK = gk;
      for (const o of gooMats) { o.m.color.copy(o.c).lerp(gooBlack, gk); if ('shininess' in o.m) o.m.shininess = o.sh + (220 - o.sh) * gk; }
      gooEyes.forEach(e => { e.visible = gk > 0.5; e.scale.setScalar(Math.min(1, (gk - 0.5) * 3) * (1 + 0.04 * Math.sin(t * 6))); });
      // The cracks: green glowing through the goo, pulsing, brighter as it takes hold.
      const crackGlow = gk * (0.75 + 0.25 * Math.sin(t * 5));
      for (const o of gooMats) o.m.emissive.setRGB(0.22 * crackGlow, 1 * crackGlow, 0.08 * crackGlow);
      feats.visible = !fisterFaceOn && gk < 0.5;
      tendrils.forEach(({ g, balls, k }) => { g.visible = gk > 0.3; const reach = Math.min(1, (gk - 0.3) / 0.7); balls.forEach((b, n) => { const u = n / balls.length, a = k * 1.05 + Math.sin(t * 2.2 + k) * 0.5; b.position.set(Math.cos(a) * u * 1.3 * reach + Math.sin(t * 4 + n * 0.7 + k) * 0.1 * u, (Math.sin(a) * 0.8 + 0.45) * u * reach + Math.sin(t * 3 + n * 0.5) * 0.12 * u, -u * 0.45 * reach); }); });
      veins.forEach(v => { v.scale.set(1 + 2 * gk, 1, 1 + 2 * gk); });
      // THE FIST PUMP (store, 2026-11-17: "Fister needs to pump his fist. It looks backwards." -- then, of the first try,
      // "he looks like he is doing triceps raises"). The real "YES!" pump: forearm up, gauntlet by his face, knuckles to
      // the camera -- then yanked DOWN hard to his chest, elbow driving back past his ribs, twice, a shake on each.
      const P = 1.8, p = (t % P) / P;
      let pump = 0;
      for (const at of [0.1, 0.5]) { const q = p - at; if (q >= 0 && q < 0.4) pump = Math.max(pump, q < 0.06 ? q / 0.06 : q < 0.2 ? 1 : 1 - (q - 0.2) / 0.2); }
      const raise = 1 - pump, low = 0;
      shoulder.rotation.z = -0.28 + 0.1 * pump; shoulder.rotation.x = ease(-0.75, 0.35, pump);
      elbow.rotation.z = 0; elbow.rotation.x = ease(-2.35, -1.75, pump);
      fist.rotation.set(0, Math.PI, 0.1); // the knuckles (and their covers) face out, not back at him
      const shake = pump > 0.95 ? Math.sin(t * 70) * 0.014 : 0;
      body.position.set(shake, -0.05 * pump, 0); head.rotation.x = 0.12 * pump - 0.05; head.rotation.y = Math.sin(t * 0.8) * 0.1;
      for (const g of legsG) g.rotation.x = 0; legsG[0].rotation.z = -0.04 * pump; legsG[1].rotation.z = 0.04 * pump;
      torso.rotation.y = 0.12 * pump + Math.sin(t * 0.8) * 0.03;
      armL.rotation.z = 0.12 + 0.1 * pump; armL.rotation.x = Math.sin(t * 1.8) * 0.05;
      // The glow: building in the wind-up, flaring at the top.
      const flare = pump > 0.9 ? 0.35 : 0, g = 0.55 + 0.45 * Math.sin(t * 9) * 0.5 + 0.5 * flare + 0.3 * low;
      aura.material.opacity = 0.1 + 0.22 * g; aura.scale.setScalar(1 + 0.25 * g + 0.6 * flare); lamp.intensity = 1.4 + 2.2 * g;
      veins.forEach((v, k) => { v.material.opacity = 0.45 + 0.5 * Math.abs(Math.sin(t * 6 + k)); });
      // Sparks: an orbit round the fist that bursts out at the top.
      const sp = sparks.geometry.attributes.position, burst = 0.22 + 0.5 * flare;
      for (let k = 0; k < sp.count; k++) { const a = t * (3 + seeded(k, 1) * 3) + k * 2.4, r = burst * (0.7 + 0.6 * seeded(k, 2)), h = (seeded(k, 3) - 0.5) * 0.5 + Math.sin(t * 4 + k) * 0.06; sp.setXYZ(k, Math.cos(a) * r, h, Math.sin(a) * r); }
      sp.needsUpdate = true; sparks.material.opacity = 0.6 + 0.4 * g;
      // Embers: rising round him, wrapping back to the floor.
      const ep = embers.geometry.attributes.position;
      for (let k = 0; k < ep.count; k++) { const life = (t * (0.18 + 0.2 * seeded(k, 4)) + seeded(k, 5)) % 1, a = seeded(k, 6) * Math.PI * 2 + life * 1.5, r = 0.55 + 0.6 * seeded(k, 7); ep.setXYZ(k, Math.cos(a) * r, -1.5 + life * 3.4, Math.sin(a) * r * 0.6); }
      ep.needsUpdate = true; embers.material.opacity = 0.75;
      // The shockwave: out across the floor from the punch.
      const sw = p >= 0.1 && p < 0.3 ? (p - 0.1) / 0.2 : p >= 0.5 && p < 0.7 ? (p - 0.5) / 0.2 : -1; // a ring with each pump
      ring.material.opacity = sw >= 0 ? 0.8 * (1 - sw) : 0; ring.scale.setScalar(sw >= 0 ? 0.6 + sw * 2.4 : 0.6);
      glowFloor.material.opacity = 0.1 + 0.2 * g;
    } };
  },

  iceberg(root) {
    // ICE BERG (store, 2026-11-24: "I need Ice Berg as a new boss and pop up ... backwards Mariners hat, 12 Seahawks
    // jersey, a big diamond earring in each ear, blue eyes, a blinged-out Breitling-inspired watch, a big platinum chain
    // with a 12"): a friend of the shop, built from scratch here. Team colours and the 12 -- no team or brand logos.
    // Idle: nodding to the beat, flexing the watch at the camera, throwing a shaka; the ice glints on a fixed rhythm.
    const doc = typeof document !== 'undefined', M = doc ? icebergMaps : null, F = doc ? fisterMaps : null;
    const env = doc ? M.env() : null;
    const skin = mat(0xd9a07c, { shininess: 26, specular: 0x332222, map: doc ? F.skin() : null });
    const jersey = mat(0xffffff, { shininess: 30, specular: 0x2a2a3a, map: doc ? M.jersey() : null });
    const navy = mat(0x0b2545, { shininess: 25, map: doc ? F.tee() : null }), green = mat(0x69be28, { shininess: 40 }), grey = mat(0xa5acaf, { shininess: 50 });
    const capM = mat(0x0c2c56, { shininess: 22, map: doc ? F.tee() : null }), teal = mat(0x00685e, { shininess: 45 });
    const hair = mat(0x3a2414, { shininess: 6, map: doc ? F.hair() : null }), jeans = mat(0x2e3a52, { shininess: 8, map: doc ? F.denim() : null });
    const shoe = mat(0x15161a, { shininess: 70 }), sole = mat(0xf2f2f2, { shininess: 20 });
    const plat = new THREE.MeshPhongMaterial({ color: 0xe9edf3, shininess: 240, specular: 0xffffff, envMap: env, reflectivity: 0.75, combine: THREE.MixOperation });
    const ice = new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x2a3a4a, shininess: 300, specular: 0xffffff, envMap: env, reflectivity: 0.6, combine: THREE.MixOperation, map: doc ? M.pave() : null });
    const gem = new THREE.MeshPhongMaterial({ color: 0xf2fbff, emissive: 0x203040, shininess: 400, specular: 0xffffff, envMap: env, reflectivity: 0.9, combine: THREE.MixOperation, flatShading: true });
    const body = new THREE.Group(); root.add(body);
    // Legs: jeans, white-soled kicks.
    add(body, cyl(0.39, 0.36, 0.3, jeans, 18), 0, -0.74, 0).scale.set(1, 1, 0.72);
    for (const sx of [-1, 1]) { const g = new THREE.Group(); g.position.set(sx * 0.19, -0.86, 0); body.add(g); add(g, cyl(0.18, 0.14, 0.36, jeans, 12), 0, -0.18, 0); add(g, cyl(0.14, 0.115, 0.32, jeans, 12), 0, -0.5, 0); add(g, ball(0.13, shoe, 14), 0, -0.66, 0.06).scale.set(1, 0.55, 1.75); add(g, cyl(0.12, 0.12, 0.04, sole, 16), 0, -0.71, 0.07).scale.set(1, 1, 1.6); }
    // The jersey: a lathe (seam at the back, so the 12 sits square on the front), V collar, sleeves with the stripes.
    const ys = Array.from({ length: 12 }, (_, j) => -0.6 + j * 0.0955), rs = [0.41, 0.42, 0.43, 0.45, 0.48, 0.52, 0.55, 0.58, 0.59, 0.55, 0.42, 0.0];
    const torso = add(body, new THREE.Mesh(new THREE.LatheGeometry(ys.map((y, j) => new THREE.Vector2(rs[j], y)), 40, Math.PI, Math.PI * 2), jersey), 0, 0, 0); torso.scale.set(1, 1, 0.66);
    for (const sx of [-1, 1]) { const v = add(body, box(0.03, 0.2, 0.02, green), sx * 0.06, 0.34, 0.27); v.rotation.z = sx * 0.5; v.rotation.x = -0.35; }
    add(body, cyl(0.135, 0.15, 0.2, skin, 16), 0, 0.48, 0.01);
    add(body, new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 24), navy), 0, 0.41, 0.01).rotation.x = Math.PI / 2 - 0.2;
    // The head: skull, ears (a big diamond stud in each), blue eyes, a grin, a trimmed beard, the cap on backwards.
    const head = new THREE.Group(); head.position.set(0, 0.82, 0.02); body.add(head);
    add(head, ball(0.3, skin, 28), 0, 0, 0).scale.set(0.88, 1.08, 0.98);
    add(head, ball(0.18, skin, 18), 0, -0.13, 0.12).scale.set(1.25, 0.9, 1); // jaw
    const studs = [];
    for (const sx of [-1, 1]) {
      add(head, ball(0.065, skin, 12), sx * 0.262, -0.0, -0.01).scale.set(0.45, 1, 0.8);
      const st = new THREE.Group(); st.position.set(sx * 0.27, -0.075, 0.03); head.add(st);
      add(st, new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.008, 6, 16), plat), sx * 0.012, 0, 0).rotation.y = sx * Math.PI / 2;
      const d = add(st, new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 4), gem), sx * 0.02, 0, 0); d.scale.set(0.6, 1, 1); studs.push(d); // a big round brilliant, faceted
    }
    const white = mat(0xf7f7f2, { shininess: 90 }), iris = mat(0x2f8fe0, { shininess: 160, specular: 0xffffff, emissive: 0x0a2a50 }), dark = mat(0x0b0612, { shininess: 160 });
    const lids = [];
    for (const sx of [-1, 1]) {
      add(head, ball(0.044, white, 14), sx * 0.1, 0.05, 0.25).scale.set(1.3, 0.85, 0.55);
      add(head, ball(0.025, iris, 14), sx * 0.1, 0.048, 0.268).scale.set(1, 1, 0.5);
      add(head, ball(0.012, dark, 10), sx * 0.1, 0.048, 0.277).scale.set(1, 1, 0.4);
      add(head, ball(0.006, new THREE.MeshBasicMaterial({ color: 0xffffff }), 6), sx * 0.1 - 0.008, 0.058, 0.282);
      lids.push(add(head, ball(0.047, skin, 14, ), sx * 0.1, 0.075, 0.245)); lids.at(-1).scale.set(1.35, 0.45, 0.6);
      const br = add(head, box(0.12, 0.03, 0.035, hair), sx * 0.1, 0.12, 0.262); br.rotation.z = sx * -0.12;
    }
    add(head, cone(0.045, 0.12, skin, 10), 0, -0.02, 0.3).rotation.x = Math.PI / 2;
    add(head, ball(0.035, skin, 10), 0, -0.055, 0.3).scale.set(1.3, 0.8, 0.9);
    // The grin: dark mouth, a row of white teeth, lips.
    const mouth = add(head, new THREE.Mesh(new THREE.SphereGeometry(0.09, 18, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), mat(0x3a0f12)), 0, -0.14, 0.3); mouth.scale.set(1.1, 0.55, 0.45);
    add(head, box(0.13, 0.03, 0.02, mat(0xffffff, { shininess: 140 })), 0, -0.15, 0.335);
    const lip = add(head, new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 20, Math.PI), mat(0xa8605a)), 0, -0.14, 0.325); lip.rotation.z = Math.PI; lip.scale.set(1.05, 0.55, 1);
    // The beard: short and trimmed, round the jaw; a moustache.
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.31, 26, 14, Math.PI / 2 + 0.42, Math.PI * 2 - 0.84, Math.PI * 0.58, Math.PI * 0.32), hair); beard.scale.set(0.92, 1.18, 1.03); beard.position.set(0, -0.02, 0.01); head.add(beard);
    add(head, ball(0.11, hair, 16), 0, -0.29, 0.19).scale.set(1.15, 0.62, 0.75); // the chin
    add(head, box(0.05, 0.035, 0.02, hair), 0, -0.2, 0.33); // under the lip
    const stache = add(head, new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 8, 18, Math.PI), hair), 0, -0.105, 0.33); stache.rotation.z = Math.PI; stache.scale.set(1.15, 0.45, 0.8);
    // Short hair at the sides under the cap.
    for (const sx of [-1, 1]) add(head, ball(0.12, hair, 14), sx * 0.2, 0.1, -0.06).scale.set(0.5, 0.8, 1.1);
    // The cap, BACKWARDS: navy crown, teal piping and button, the teal brim out the back, the snapback gap over the forehead.
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.315, 26, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), capM); crown.position.set(0, 0.11, -0.01); crown.scale.set(0.95, 0.92, 1.03); head.add(crown);
    for (let k = 0; k < 6; k++) { const seam = add(head, new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.004, 4, 24, Math.PI / 2), teal), 0, 0.11, -0.01); seam.rotation.set(0, k / 6 * Math.PI * 2, Math.PI / 2); seam.scale.set(0.95 * 1.03, 0.92, 0.95); }
    add(head, new THREE.Mesh(new THREE.TorusGeometry(0.297, 0.012, 6, 30), teal), 0, 0.115, -0.01).rotation.x = Math.PI / 2;
    add(head, ball(0.03, teal, 10), 0, 0.4, -0.01);
    const brim = add(head, box(0.32, 0.024, 0.26, teal), 0, 0.135, -0.4); brim.rotation.x = -0.18;
    add(head, box(0.3, 0.005, 0.24, capM), 0, 0.124, -0.4).rotation.x = -0.18;
    const gap = add(head, new THREE.Mesh(new THREE.CircleGeometry(0.06, 16, 0, Math.PI), hair), 0, 0.12, 0.29); gap.rotation.x = -0.2;
    add(head, box(0.14, 0.022, 0.02, capM), 0, 0.12, 0.292);
    for (const sx of [-1, 0, 1]) add(head, ball(0.008, plat, 6), sx * 0.04, 0.12, 0.305);
    // THE CHAIN: platinum links round his neck and down the chest, the iced-out 12 on the end.
    const chain = new THREE.Group(); body.add(chain);
    const half = [[0, 0.46, -0.13], [0.15, 0.45, -0.07], [0.2, 0.41, 0.06], [0.19, 0.36, 0.2], [0.13, 0.3, 0.31], [0.06, 0.26, 0.37], [0, 0.25, 0.38]];
    const ring = [...half, ...half.slice(1, -1).reverse().map(([x, y, z]) => [-x, y, z])].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(ring, true), link = new THREE.TorusGeometry(0.019, 0.0065, 6, 12), X = new THREE.Vector3(1, 0, 0);
    const N = 64;
    for (let k = 0; k < N; k++) { const u = k / N, l = new THREE.Mesh(link, plat); l.position.copy(curve.getPointAt(u)); l.quaternion.setFromUnitVectors(X, curve.getTangentAt(u)); if (k % 2) l.rotateX(Math.PI / 2); l.scale.set(1.45, 1, 1); chain.add(l); }
    const pend = new THREE.Group(); pend.position.set(0, 0.09, 0.41); pend.scale.setScalar(1.05); chain.add(pend);
    add(pend, new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.008, 6, 14), plat), 0, 0.165, 0);
    const bar = (w, h, x, y, r = 0) => { const b = add(pend, box(w, h, 0.032, ice), x, y, 0); b.rotation.z = r; const e = add(pend, box(w + 0.012, h + 0.012, 0.02, plat), x, y, -0.008); e.rotation.z = r; return b; };
    bar(0.05, 0.24, -0.075, 0); bar(0.055, 0.024, -0.1, 0.1, 0.6); bar(0.11, 0.03, -0.075, -0.11);
    const arc = add(pend, new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.021, 10, 24, Math.PI * 1.25), ice), 0.075, 0.055, 0); arc.rotation.z = -0.79;
    add(pend, new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.027, 8, 24, Math.PI * 1.25), plat), 0.075, 0.055, -0.008).rotation.z = -0.79;
    bar(0.03, 0.15, 0.077, -0.045, 0.6); bar(0.13, 0.03, 0.085, -0.11);
    // The arms. His LEFT (our right) wears THE WATCH; his right throws the shaka.
    const arm = (sx) => {
      const sh = new THREE.Group(); sh.position.set(sx * 0.53, 0.22, 0); body.add(sh);
      add(sh, ball(0.22, navy, 18), 0, 0, 0).scale.set(1, 0.9, 0.85);
      add(sh, cyl(0.18, 0.16, 0.34, navy, 16), 0, -0.16, 0);
      add(sh, new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.018, 6, 20), grey), 0, -0.22, 0).rotation.x = Math.PI / 2;
      add(sh, new THREE.Mesh(new THREE.TorusGeometry(0.163, 0.012, 6, 20), green), 0, -0.27, 0).rotation.x = Math.PI / 2;
      add(sh, cyl(0.135, 0.12, 0.2, skin, 14), 0, -0.4, 0);
      const el = new THREE.Group(); el.position.set(0, -0.52, 0); sh.add(el);
      add(el, ball(0.115, skin, 12), 0, 0, 0);
      add(el, cyl(0.115, 0.085, 0.42, skin, 14), 0, -0.21, 0);
      const hand = new THREE.Group(); hand.position.set(0, -0.46, 0); el.add(hand);
      add(hand, box(0.15, 0.13, 0.07, skin), 0, -0.02, 0);
      return { sh, el, hand };
    };
    const L = arm(1), R = arm(-1);
    // The watch: a fat platinum case, a diamond bezel, a blue chronograph dial, a link bracelet.
    const watch = new THREE.Group(); watch.position.set(0, -0.38, 0); L.el.add(watch);
    add(watch, new THREE.Mesh(new THREE.TorusGeometry(0.093, 0.024, 8, 22), plat), 0, 0, 0).rotation.x = Math.PI / 2; // the bracelet round the wrist
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; add(watch, box(0.03, 0.05, 0.012, plat), Math.cos(a) * 0.112, 0, Math.sin(a) * 0.112).rotation.y = -a + Math.PI / 2; }
    const face = new THREE.Group(); face.position.set(0, 0, 0.11); watch.add(face);
    add(face, cyl(0.078, 0.082, 0.04, plat, 28), 0, 0, 0).rotation.x = Math.PI / 2;
    add(face, new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.014, 8, 28), ice), 0, 0, 0.022);
    for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; add(face, new THREE.Mesh(new THREE.OctahedronGeometry(0.011, 0), gem), Math.cos(a) * 0.072, Math.sin(a) * 0.072, 0.034); }
    add(face, new THREE.Mesh(new THREE.CircleGeometry(0.06, 28), new THREE.MeshBasicMaterial({ map: doc ? M.dial() : null, color: doc ? 0xffffff : 0x0a2450 })), 0, 0, 0.0215);
    add(face, new THREE.Mesh(new THREE.CircleGeometry(0.06, 28), new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, shininess: 300, specular: 0xffffff, envMap: env, combine: THREE.MixOperation, reflectivity: 0.5 })), 0, 0, 0.026);
    add(face, cyl(0.012, 0.012, 0.03, plat, 10), 0.09, 0, 0).rotation.z = Math.PI / 2; // the crown
    // The shaka hand: thumb and pinky out, three fingers curled.
    const thumb = add(R.hand, cyl(0.025, 0.022, 0.11, skin, 8), -0.09, 0.02, 0.01); thumb.rotation.z = -1.1;
    const pinky = add(R.hand, cyl(0.02, 0.018, 0.1, skin, 8), 0.08, -0.1, 0); pinky.rotation.z = 0.5;
    for (let k = 0; k < 3; k++) add(R.hand, ball(0.028, skin, 8), -0.045 + k * 0.035, -0.095, 0.025);
    for (let k = 0; k < 4; k++) add(L.hand, cyl(0.022, 0.02, 0.09, skin, 8), -0.05 + k * 0.033, -0.12, 0);
    // The glints: star flashes on the ice, each on its own beat (a fixed schedule -- nothing random).
    const glints = [];
    const glint = (parent, x, y, z, k, s = 0.14) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: doc ? M.glint() : null, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); sp.position.set(x, y, z); sp.scale.setScalar(s); parent.add(sp); glints.push({ sp, k, s }); };
    studs.forEach((d, k) => glint(d.parent, d.position.x * 1.6, 0, 0.03, k * 1.3));
    for (const [x, y, k] of [[-0.075, 0.08, 0.4], [0.06, 0.09, 2.1], [0.11, -0.11, 3.3], [-0.06, -0.1, 4.6], [0.02, -0.02, 5.4]]) glint(pend, x, y, 0.03, k, 0.12);
    glint(face, 0.05, 0.05, 0.04, 1.7, 0.16); glint(face, -0.06, -0.03, 0.04, 3.9, 0.1);
    for (const [u, k] of [[0.08, 0.9], [0.3, 2.6], [0.7, 4.1], [0.9, 5.8]]) { const p = curve.getPointAt(u); glint(chain, p.x, p.y, p.z + 0.02, k, 0.09); }
    // THE BLING (2026-11-24: "Ice Berg needs particle effect bling on him and his diamonds"): an icy shimmer drifting
    // up round him, and a swarm of sparkles orbiting each diamond -- the studs, the 12, the watch. Fixed paths per
    // particle (no dice), additive star sprites.
    const fixedI = (k, m) => ((Math.sin(k * 12.9898 + m * 78.233) * 43758.5453) % 1 + 1) % 1;
    const sparkPts = (n, size, color) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); return new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: doc ? M.glint() : null, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })); };
    const shimmer = sparkPts(110, 0.17, 0xbfefff); root.add(shimmer);
    const dust = sparkPts(60, 0.12, 0xffffff); root.add(dust);
    const swarms = [];
    const swarm = (parent, x, y, z, r, n, size, k) => { const p = sparkPts(n, size, 0xffffff); p.position.set(x, y, z); parent.add(p); swarms.push({ p, r, k }); };
    studs.forEach((d, k) => swarm(d.parent, d.position.x, 0, 0.02, 0.08, 12, 0.24, k * 2.1));
    swarm(pend, 0.0, 0.0, 0.04, 0.17, 24, 0.3, 5.3);
    swarm(face, 0, 0, 0.04, 0.11, 16, 0.26, 7.7);
    swarm(chain, 0, 0.36, 0.2, 0.22, 18, 0.18, 9.1);
    const ease = (a, b, k) => a + (b - a) * (k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k));
    return { tick(t) {
      // The shimmer: rising round him and wrapping back to his feet; the dust twinkles in place round his upper body.
      const sp = shimmer.geometry.attributes.position;
      for (let k = 0; k < sp.count; k++) { const life = (t * (0.12 + 0.16 * fixedI(k, 1)) + fixedI(k, 2)) % 1, a = fixedI(k, 3) * Math.PI * 2 + life * 2.2 + t * 0.3, rr = 0.6 + 0.55 * fixedI(k, 4); sp.setXYZ(k, Math.cos(a) * rr, -1.5 + life * 3.3, Math.sin(a) * rr * 0.6); }
      sp.needsUpdate = true; shimmer.material.opacity = 0.55 + 0.25 * Math.sin(t * 4);
      const dp = dust.geometry.attributes.position;
      for (let k = 0; k < dp.count; k++) { const on = Math.sin(t * (3 + fixedI(k, 5) * 4) + k) > 0.6, a = fixedI(k, 6) * Math.PI * 2 + t * 0.2; dp.setXYZ(k, on ? Math.cos(a) * (0.5 + 0.5 * fixedI(k, 7)) : 0, on ? -0.2 + 1.5 * fixedI(k, 8) : -9, on ? 0.2 + 0.35 * fixedI(k, 9) : 0); }
      dp.needsUpdate = true;
      // The swarms: tight orbits round each diamond, pulsing bright on their own beat.
      for (const { p, r, k } of swarms) {
        const a = p.geometry.attributes.position;
        for (let j = 0; j < a.count; j++) { const ang = t * (2 + fixedI(j + k, 1) * 3) + j * 2.4, rr = r * (0.5 + 0.6 * fixedI(j + k, 2)), h = (fixedI(j + k, 3) - 0.5) * r * 1.4 + Math.sin(t * 5 + j) * r * 0.15; a.setXYZ(j, Math.cos(ang) * rr, h, Math.sin(ang) * rr * 0.5 + 0.02); }
        a.needsUpdate = true; p.material.opacity = 0.7 + 0.3 * Math.pow(Math.abs(Math.sin(t * 2.6 + k)), 3);
      }
      // Nodding to the beat.
      const beat = Math.abs(Math.sin(t * Math.PI * 1.1));
      body.position.y = beat * 0.025; head.rotation.x = -0.04 + Math.sin(t * Math.PI * 2.2) * 0.05; head.rotation.y = Math.sin(t * 0.7) * 0.15;
      torso.rotation.y = Math.sin(t * 0.7) * 0.04; chain.rotation.x = Math.sin(t * Math.PI * 2.2) * 0.02;
      // Every 5 s: the watch comes up to the camera (0.05-0.45), then the shaka (0.5-0.9).
      const P = 5, p = (t % P) / P;
      const w = p < 0.05 ? 0 : p < 0.13 ? (p - 0.05) / 0.08 : p < 0.37 ? 1 : p < 0.45 ? 1 - (p - 0.37) / 0.08 : 0;
      L.sh.rotation.set(ease(0, -0.35, w), 0, ease(0.1, 0.38, w)); L.el.rotation.set(ease(-0.1, -2.5, w), ease(0, Math.PI, w), 0); // up by his face, the wrist turning the dial to the camera
      const s = p < 0.5 ? 0 : p < 0.57 ? (p - 0.5) / 0.07 : p < 0.83 ? 1 : p < 0.9 ? 1 - (p - 0.83) / 0.07 : 0;
      R.sh.rotation.set(ease(0, -0.2, s), 0, ease(-0.1, -0.55, s)); R.el.rotation.set(ease(-0.1, -2.3, s), 0, ease(0, -0.3, s));
      R.hand.rotation.set(0, 0, s * Math.sin(t * 14) * 0.35);
      for (const d of studs) d.rotation.y = t * 1.6;
      for (const g of glints) { const f = Math.pow(Math.max(0, Math.sin(t * 2.9 + g.k * 1.7)), 8), flash = Math.max(f, w * 0.0); g.sp.material.opacity = flash; g.sp.scale.setScalar(g.s * 1.8 * (0.6 + flash)); g.sp.material.rotation = t * 0.8 + g.k; }
      const gl = 0.08 * Math.sin(t * 3); ice.emissive.setRGB(0.22 + gl, 0.28 + gl, 0.34 + gl);
    } };
  },


  scalper(root) {
    const coat = flat(0xc98a4b), hood = flat(0x2b2f3a), skin = mat(0xf2c38b);
    const body = add(root, cyl(0.42, 0.78, 1.5, coat, 9), 0, -0.25, 0);
    add(root, cyl(0.6, 0.66, 0.14, flat(0x5a3412), 9), 0, -0.3, 0); // belt
    for (const y of [0.15, -0.65]) add(root, ball(0.07, mat(0xfacc15, { shininess: 140, specular: 0xffffff }), 8), 0, y, y > 0 ? 0.5 : 0.68);
    const head = new THREE.Group(); head.position.set(0, 0.85, 0); root.add(head);
    const h = add(head, ball(0.62, hood, 12), 0, 0.06, -0.05); h.scale.set(1, 1.05, 1);
    add(head, ball(0.45, skin, 16), 0, -0.02, 0.22);
    // Shades with a cyan glint, a toothy grin.
    add(head, box(0.78, 0.2, 0.12, mat(0x0b0612, { shininess: 140, specular: 0xffffff })), 0, 0.08, 0.62);
    const glint = add(head, box(0.12, 0.05, 0.02, new THREE.MeshBasicMaterial({ color: 0x67e8f9 })), -0.2, 0.12, 0.7);
    grin(head, { y: -0.2, z: 0.6, w: 0.42 });
    // An armful of sealed boxes, and a gold $$$ tag.
    const stack = new THREE.Group(); stack.position.set(-0.78, -0.25, 0.35); root.add(stack);
    [[0xf59e0b, 0], [0x22d3ee, 0.36], [0xf43f5e, 0.72]].forEach(([c, y], i) => {
      const b = add(stack, box(0.62, 0.34, 0.5, flat(c)), (i % 2) * 0.06, y - 0.5, 0); b.rotation.y = 0.2 - i * 0.15;
      add(stack, box(0.64, 0.07, 0.52, mat(0xffffff, { shininess: 140, transparent: true, opacity: 0.55 })), (i % 2) * 0.06, y - 0.5, 0).rotation.y = b.rotation.y;
    });
    const tag = add(root, box(0.62, 0.36, 0.06, new THREE.MeshPhongMaterial({ map: textTexture('$$$', { bg: '#facc15', fg: '#0b0612', stroke: null }), shininess: 90 })), 0.82, -0.05, 0.45);
    tag.rotation.z = -0.25;
    for (const s of [-1, 1]) add(root, limb(coat, 0.75, 0.12), s * 0.62, -0.25, 0.25).rotation.z = s * 0.7;
    legs(root, flat(0x1f0a3d), { y: -1.0 });
    return { tick(t) { head.rotation.y = Math.sin(t * 1.3) * 0.25; tag.rotation.z = -0.25 + Math.sin(t * 4) * 0.12; glint.visible = (t % 2.4) < 1.2; stack.position.y = -0.25 + Math.sin(t * 2.6) * 0.04; body.scale.y = 1 + Math.sin(t * 3) * 0.02; } };
  },
  flipper(root) {
    const hoodie = flat(0x16a34a), skin = mat(0xf2c38b), cap = mat(0xef233c, { shininess: 90 });
    add(root, cyl(0.5, 0.66, 1.25, hoodie, 9), 0, -0.4, 0);
    const head = new THREE.Group(); head.position.set(0, 0.62, 0); root.add(head);
    add(head, ball(0.56, skin, 16));
    const c = add(head, ball(0.6, cap, 14), 0, 0.2, -0.04); c.scale.set(1, 0.62, 1);
    add(head, box(0.5, 0.06, 0.55, cap), 0, 0.12, -0.62).rotation.x = 0.25; // brim, backwards
    eyes(head, { y: 0.02, z: 0.42, r: 0.15, look: 0.6 });
    const smirk = add(head, box(0.34, 0.07, 0.06, mat(0x2b0710)), 0.06, -0.24, 0.52); smirk.rotation.z = 0.2;
    // Spatula up high, a comic flipping over it.
    const arm = new THREE.Group(); arm.position.set(0.6, -0.15, 0.15); root.add(arm);
    add(arm, limb(hoodie, 0.7, 0.12), 0.18, 0.25, 0).rotation.z = -0.6;
    add(arm, cyl(0.04, 0.04, 0.8, mat(0x8b5a2b), 6), 0.48, 0.8, 0).rotation.z = -0.35;
    add(arm, box(0.36, 0.42, 0.04, mat(0xd1d5db, { shininess: 140, specular: 0xffffff })), 0.62, 1.25, 0).rotation.z = -0.35;
    const comic = new THREE.Group(); comic.position.set(0.7, 1.95, 0); root.add(comic);
    const cover = new THREE.MeshPhongMaterial({ map: textTexture('#1', { w: 128, h: 160, bg: '#22d3ee', fg: '#ffe23d', font: '900 92px Arial Black, Arial' }), shininess: 60 });
    comic.add(box(0.5, 0.66, 0.05, [mat(0xffffff), mat(0xffffff), mat(0xffffff), mat(0xffffff), cover, mat(0xf472b6)]));
    add(root, limb(hoodie, 0.6, 0.12), -0.62, -0.45, 0.1).rotation.z = 0.5;
    legs(root, flat(0x1e3a8a), { y: -1.05 });
    return { tick(t) { const p = (t * 0.8) % 1; comic.position.y = 1.45 + Math.sin(p * Math.PI) * 0.32; comic.rotation.x = p * TAU; arm.rotation.z = Math.sin(p * Math.PI) * -0.15; head.rotation.z = Math.sin(t * 2) * 0.08; } };
  },
  dinged(root) {
    const page = flat(0xec4899), paper = mat(0xfff6d8, { side: THREE.DoubleSide });
    const book = new THREE.Group(); root.add(book);
    const cover = new THREE.MeshPhongMaterial({ map: textTexture('#1', { w: 256, h: 320, bg: '#ec4899', fg: '#ffe23d', font: '900 70px Arial Black, Arial' }), shininess: 60 });
    add(book, box(1.4, 1.8, 0.28, [page, page, page, page, cover, page]), 0, 0, 0);
    add(book, box(1.32, 0.3, 0.02, mat(0xffe23d)), 0, 0.68, 0.15);
    // The dinged corner: a folded-down flap of paper.
    const flap = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.7, 0.9, 0.15), new THREE.Vector3(0.3, 0.9, 0.15), new THREE.Vector3(0.7, 0.5, 0.15)]), paper);
    flap.geometry.computeVertexNormals(); const corner = new THREE.Group(); corner.add(flap); book.add(corner);
    eyes(book, { y: 0.12, z: 0.18, x: 0.32, r: 0.2, angry: true });
    const mouth = grin(book, { y: -0.38, z: 0.17, w: 0.6, teeth: false });
    for (const x of [-0.18, 0, 0.18]) add(mouth, cone(0.06, 0.14, mat(0xffffff, { shininess: 120 }), 6), x, 0.02, 0.06).rotation.x = Math.PI;
    for (const s of [-1, 1]) { const a = add(book, limb(page, 0.6, 0.08), s * 0.85, -0.1, 0); a.rotation.z = s * 0.9; add(a, ball(0.13, mat(0xffffff)), 0, -0.34, 0); }
    const l = legs(root, flat(0x831843), { y: -0.9, x: 0.35 });
    return { tick(t) { book.rotation.z = Math.sin(t * 5) * 0.06; book.position.y = Math.abs(Math.sin(t * 5)) * 0.12; l[0].rotation.x = Math.sin(t * 5) * 0.5; l[1].rotation.x = -Math.sin(t * 5) * 0.5; corner.rotation.z = Math.sin(t * 7) * 0.04; } };
  },
  grader(root) {
    const slab = new THREE.Group(); root.add(slab);
    add(slab, box(1.3, 2.0, 0.3, mat(0xdbeafe, { transparent: true, opacity: 0.45, shininess: 160, specular: 0xffffff })), 0, 0, 0);
    add(slab, box(1.1, 0.42, 0.32, new THREE.MeshPhongMaterial({ map: textTexture('4.0', { bg: '#ef233c' }), shininess: 90 })), 0, 0.72, 0);
    const card = add(slab, box(0.92, 1.2, 0.08, flat(0x7c3aed)), 0, -0.22, 0);
    eyes(card, { y: 0.1, z: 0.06, x: 0.22, r: 0.15, angry: true });
    const frown = add(card, new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 12, Math.PI), mat(0x0b0612)), 0, -0.34, 0.06);
    // A big magnifying glass, held up to the viewer.
    const glass = new THREE.Group(); glass.position.set(0.95, 0.15, 0.4); root.add(glass);
    add(glass, new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 8, 20), mat(0x111827, { shininess: 120 })));
    add(glass, new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), mat(0xbfdbfe, { transparent: true, opacity: 0.4, shininess: 200, specular: 0xffffff })), 0, 0, 0.01);
    add(glass, cyl(0.05, 0.06, 0.6, mat(0x7c2d12), 6), 0.26, -0.48, 0).rotation.z = 0.5;
    for (const s of [-1, 1]) add(root, limb(mat(0x94a3b8), 0.55, 0.07), s * 0.75, -0.2, 0).rotation.z = s * 0.9;
    legs(root, mat(0x334155), { y: -1.05 });
    return { tick(t) { glass.position.x = 0.95 + Math.sin(t * 1.5) * 0.12; glass.position.y = 0.15 + Math.cos(t * 1.5) * 0.1; slab.rotation.y = Math.sin(t * 0.9) * 0.2; frown.rotation.z = 0; } };
  },
  shipping(root) {
    const card = flat(0xc98a3c), dark = flat(0xa86b28);
    const crate = new THREE.Group(); root.add(crate);
    add(crate, box(1.6, 1.3, 1.1, card), 0, -0.1, 0);
    add(crate, box(0.3, 1.32, 1.12, mat(0xe8d3a0, { shininess: 90 })), 0, -0.1, 0);
    const flaps = [];
    for (const s of [-1, 1]) {
      const hinge = new THREE.Group(); hinge.position.set(s * 0.8, 0.55, 0); crate.add(hinge);
      add(hinge, box(0.8, 0.05, 1.1, dark), -s * 0.4, 0, 0); flaps.push(hinge);
    }
    eyes(crate, { y: 0.05, z: 0.56, x: 0.42, r: 0.17, angry: true });
    grin(crate, { y: -0.35, z: 0.56, w: 0.5 });
    const stamp = add(crate, box(0.62, 0.26, 0.02, new THREE.MeshBasicMaterial({ map: textTexture('LATE', { bg: null, fg: '#ef233c', stroke: '#ef233c' }), transparent: true })), -0.45, -0.52, 0.56);
    stamp.rotation.z = -0.15;
    for (const s of [-1, 1]) add(root, limb(dark, 0.5, 0.08), s * 0.95, -0.2, 0).rotation.z = s * 1.0;
    legs(root, mat(0x0b0612), { y: -0.8, x: 0.45 });
    return { tick(t) { flaps[0].rotation.z = 0.5 + Math.sin(t * 6) * 0.35; flaps[1].rotation.z = -0.5 - Math.sin(t * 6 + 1) * 0.35; crate.rotation.y = Math.sin(t * 0.8) * 0.25; } };
  },
  // ── The shed's own bosses (2026-11-12) ──
  mimic(root) {
    // A comic long box whose lid chomps open on rows of teeth.
    const card = flat(0xefe9d8), lidM = flat(0xddd5bf), white = mat(0xffffff, { shininess: 120 });
    const base = add(root, box(2.0, 0.8, 0.9, card), 0, -0.6, 0);
    add(base, box(0.7, 0.32, 0.02, mat(0xffffff)), -0.45, 0, 0.46);
    add(root, box(1.9, 0.12, 0.8, mat(0xb3122e)), 0, -0.22, 0); // the tongue-red inside
    const hinge = new THREE.Group(); hinge.position.set(0, -0.2, -0.45); root.add(hinge);
    const lid = add(hinge, box(2.05, 0.18, 0.95, lidM), 0, 0.05, 0.47);
    for (let i = 0; i < 7; i++) { add(lid, cone(0.09, 0.22, white, 4), -0.84 + i * 0.28, -0.18, 0.4).rotation.x = Math.PI; add(base, cone(0.09, 0.22, white, 4), -0.84 + i * 0.28, 0.5, 0.4); }
    eyes(lid, { y: 0.25, z: 0.3, x: 0.42, r: 0.2, angry: true });
    legs(root, flat(0x7c5c2e), { y: -1.0, x: 0.6, len: 0.3 });
    return { tick(t) { hinge.rotation.x = -0.25 - Math.abs(Math.sin(t * 3.4)) * 0.75; root.position.y = Math.abs(Math.sin(t * 3.4)) * 0.06; } };
  },
  golem(root) {
    // A lumpy stone giant, a price gun for a hand, stickers stuck all over.
    const stone = flat(0x8b8f99), dark = flat(0x6b7280);
    const body = add(root, box(1.3, 1.2, 0.8, stone), 0, -0.25, 0); body.rotation.y = 0.08;
    const head = add(root, box(0.85, 0.7, 0.7, flat(0x9aa0aa)), 0, 0.7, 0);
    eyes(head, { y: 0.06, z: 0.36, x: 0.2, r: 0.14, angry: true });
    for (const [x, y, c] of [[-0.3, 0.05, 0xfde047], [0.25, -0.35, 0xfb923c], [-0.1, -0.55, 0xfde047]]) add(body, box(0.3, 0.18, 0.02, mat(c)), x, y, 0.41);
    add(root, box(0.36, 0.95, 0.36, stone), -0.9, -0.3, 0).rotation.z = 0.15;
    const gun = new THREE.Group(); gun.position.set(0.95, -0.05, 0.2); root.add(gun);
    add(gun, box(0.6, 0.34, 0.3, mat(0xf97316, { shininess: 90 })), 0.15, 0, 0);
    add(gun, box(0.16, 0.42, 0.24, mat(0xf97316)), 0.05, -0.32, 0);
    add(gun, box(0.12, 0.12, 0.2, mat(0xfde047)), 0.5, 0.05, 0);
    for (const s2 of [-1, 1]) add(root, box(0.38, 0.4, 0.4, dark), s2 * 0.35, -1.05, 0);
    return { tick(t) { gun.rotation.z = Math.sin(t * 2.2) * 0.25; head.rotation.y = Math.sin(t * 0.9) * 0.3; } };
  },
  kraken(root) {
    // A purple beast up out of a puddle, tentacles waving.
    const skin = mat(0x8b5cf6, { shininess: 90 }), deep = mat(0x6d28d9, { shininess: 90 });
    add(root, cyl(1.5, 1.5, 0.08, mat(0x38bdf8, { transparent: true, opacity: 0.85, shininess: 160 }), 24), 0, -1.35, 0);
    const head = add(root, ball(0.8, skin, 18), 0, 0.15, 0); head.scale.set(1, 1.25, 0.95);
    add(head, ball(0.16, mat(0xc4b5fd)), -0.35, 0.45, 0.6); add(head, ball(0.1, mat(0xc4b5fd)), 0.4, -0.3, 0.68);
    eyes(head, { y: 0, z: 0.68, x: 0.28, r: 0.2, angry: true });
    const arms = [];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, g = new THREE.Group(); g.position.set(Math.cos(a) * 0.75, -1.0, Math.sin(a) * 0.5 + 0.2); root.add(g); const seg = add(g, cyl(0.07, 0.16, 1.1, i % 2 ? deep : skin, 8), 0, 0.5, 0); seg.rotation.z = Math.cos(a) * 0.5; arms.push(g); }
    return { tick(t) { arms.forEach((g, i) => { g.rotation.z = Math.sin(t * 2.4 + i) * 0.45; g.rotation.x = Math.cos(t * 2 + i) * 0.25; }); head.position.y = 0.15 + Math.sin(t * 1.6) * 0.08; } };
  },
  lich(root) {
    // A skull in a tattered green hood, holding up a glowing $1 bin.
    const robe = flat(0x14532d), hood = flat(0x166534), bone = mat(0xf5f5dc, { shininess: 60 });
    add(root, cone(0.85, 2.0, robe, 7), 0, -0.45, 0);
    const head = new THREE.Group(); head.position.set(0, 0.85, 0); root.add(head);
    add(head, ball(0.6, hood, 10), 0, 0.05, -0.08).scale.set(1, 1.15, 1);
    add(head, ball(0.4, bone, 14), 0, -0.02, 0.2);
    const glow = new THREE.MeshBasicMaterial({ color: 0x4ade80 });
    for (const sx of [-1, 1]) add(head, ball(0.1, glow, 8), sx * 0.15, 0.04, 0.55);
    add(head, box(0.3, 0.06, 0.04, mat(0x0b0612)), 0, -0.22, 0.56);
    const bin = new THREE.Group(); bin.position.set(0, -0.15, 0.75); root.add(bin);
    add(bin, box(1.0, 0.5, 0.5, flat(0xa16207)));
    [[0xef4444, -0.28], [0x3b82f6, 0], [0xeab308, 0.28]].forEach(([c, x]) => add(bin, box(0.16, 0.36, 0.3, flat(c)), x, 0.3, 0));
    add(bin, box(0.6, 0.24, 0.02, new THREE.MeshBasicMaterial({ map: textTexture('$1', { bg: '#4ade80', fg: '#0b0612', stroke: null }) })), 0, 0, 0.26);
    for (const sx of [-1, 1]) add(root, limb(bone, 0.6, 0.06), sx * 0.55, -0.1, 0.5).rotation.z = sx * 1.1;
    return { tick(t) { bin.position.y = -0.15 + Math.sin(t * 1.8) * 0.1; glow.color.setRGB(0.3, 0.6 + Math.sin(t * 5) * 0.3, 0.4); head.rotation.z = Math.sin(t * 0.8) * 0.12; } };
  },
  raccoonking(root) {
    // A raccoon in a gold crown, on a throne of greasy pizza boxes.
    const fur = flat(0x9ca3af), dark = flat(0x4b5563), gold = mat(0xfacc15, { shininess: 140, specular: 0xffffff });
    for (let i = 0; i < 3; i++) add(root, box(1.7 - i * 0.1, 0.18, 1.3, flat(i % 2 ? 0xb07a3c : 0xc98a3c)), 0, -1.25 + i * 0.19, 0).rotation.y = i * 0.12;
    const body = add(root, ball(0.75, fur, 14), 0, -0.35, 0); body.scale.set(1, 0.95, 0.85);
    const head = new THREE.Group(); head.position.set(0, 0.6, 0.1); root.add(head);
    add(head, ball(0.55, fur, 16));
    const mask = add(head, box(0.9, 0.24, 0.1, mat(0x111827)), 0, 0.05, 0.46);
    eyes(head, { y: 0.05, z: 0.52, x: 0.2, r: 0.13 });
    add(head, ball(0.08, mat(0x0b0612)), 0, -0.15, 0.55);
    for (const sx of [-1, 1]) add(head, cone(0.15, 0.3, dark, 5), sx * 0.35, 0.5, 0);
    const crown = new THREE.Group(); crown.position.set(0, 0.62, 0); head.add(crown);
    add(crown, cyl(0.3, 0.32, 0.16, gold, 10));
    for (let i = 0; i < 5; i++) add(crown, cone(0.07, 0.2, gold, 4), Math.cos(i / 5 * TAU) * 0.28, 0.16, Math.sin(i / 5 * TAU) * 0.28);
    const tail = new THREE.Group(); tail.position.set(0.7, -0.6, -0.2); root.add(tail);
    for (let i = 0; i < 5; i++) add(tail, ball(0.2, i % 2 ? dark : fur, 8), i * 0.16, i * 0.16, 0);
    return { tick(t) { tail.rotation.z = Math.sin(t * 2) * 0.3; crown.rotation.y = t * 0.8; mask.scale.x = 1; head.rotation.y = Math.sin(t * 1.1) * 0.25; } };
  },
  lowballer(root) {
    // A smug guy in a polo, phone out, holding up a tiny $2 sign.
    const polo = flat(0x0ea5e9), skin = mat(0xf2c38b);
    add(root, cyl(0.5, 0.62, 1.2, polo, 9), 0, -0.4, 0);
    const head = new THREE.Group(); head.position.set(0, 0.6, 0); root.add(head);
    add(head, ball(0.52, skin, 16));
    add(head, ball(0.54, flat(0x78350f), 12), 0, 0.22, -0.05).scale.set(1, 0.55, 1);
    for (const sx of [-1, 1]) add(head, box(0.2, 0.05, 0.05, mat(0x0b0612)), sx * 0.18, 0.06, 0.48).rotation.z = sx * -0.15;
    const smirk = add(head, box(0.3, 0.06, 0.05, mat(0x2b0710)), 0.06, -0.2, 0.48); smirk.rotation.z = 0.25;
    const sign = new THREE.Group(); sign.position.set(-0.8, 0.4, 0.3); root.add(sign);
    add(sign, cyl(0.03, 0.03, 0.7, mat(0x8b5a2b), 6), 0, -0.35, 0);
    add(sign, box(0.5, 0.34, 0.04, new THREE.MeshPhongMaterial({ map: textTexture('$2', { bg: '#ffffff', fg: '#dc2626', stroke: null }) })));
    const phone = add(root, box(0.26, 0.44, 0.05, mat(0x1f2937, { shininess: 140 })), 0.72, -0.1, 0.35);
    add(phone, box(0.2, 0.14, 0.01, new THREE.MeshBasicMaterial({ color: 0xa3e635 })), 0, 0.1, 0.03);
    for (const sx of [-1, 1]) add(root, limb(polo, 0.55, 0.1), sx * 0.6, -0.25, 0.2).rotation.z = sx * 0.6;
    legs(root, flat(0x374151), { y: -1.05 });
    return { tick(t) { sign.rotation.z = Math.sin(t * 3) * 0.15; sign.position.y = 0.4 + Math.abs(Math.sin(t * 3)) * 0.08; head.rotation.y = Math.sin(t) * 0.2; } };
  },
  dragon(root) {
    // A red dragon curled on a hoard of gold and slabbed books, smoke puffing.
    const red = mat(0xdc2626, { shininess: 80 }), dark = flat(0x7f1d1d), gold = mat(0xfacc15, { shininess: 150, specular: 0xffffff });
    for (let i = 0; i < 9; i++) add(root, ball(0.22, gold, 8), -0.9 + (i % 5) * 0.45, -1.3 + Math.floor(i / 5) * 0.2, 0.3 - (i % 3) * 0.2);
    for (const x of [-0.6, 0.55]) add(root, box(0.3, 0.42, 0.06, mat(0xdbeafe, { transparent: true, opacity: 0.7, shininess: 160 })), x, -1.05, 0.55).rotation.z = x * 0.3;
    const body = add(root, ball(0.75, red, 14), 0, -0.45, -0.1); body.scale.set(1.3, 0.85, 1);
    const neck = new THREE.Group(); neck.position.set(0.3, 0.05, 0.2); root.add(neck);
    add(neck, cyl(0.2, 0.3, 0.8, red, 8), 0, 0.3, 0).rotation.z = -0.3;
    const head = new THREE.Group(); head.position.set(0.3, 0.8, 0.1); neck.add(head);
    add(head, box(0.7, 0.42, 0.5, red), 0.1, 0, 0);
    add(head, box(0.4, 0.2, 0.4, red), 0.45, -0.1, 0);
    eyes(head, { y: 0.12, z: 0.27, x: 0.16, r: 0.11, angry: true });
    for (const sz of [-1, 1]) add(head, cone(0.08, 0.35, dark, 5), -0.1, 0.32, sz * 0.15).rotation.z = 0.4;
    const wings = [];
    for (const sz of [-1, 1]) { const w = new THREE.Group(); w.position.set(-0.2, -0.1, sz * 0.5); root.add(w); add(w, cone(0.55, 1.2, dark, 3), 0, 0.55, 0).rotation.x = sz * 0.5; wings.push(w); }
    const puff = add(head, ball(0.12, mat(0xfb923c, { transparent: true, opacity: 0.8 }), 8), 0.75, -0.1, 0);
    return { tick(t) { wings.forEach((w, i) => { w.rotation.x = (i ? 1 : -1) * (0.2 + Math.sin(t * 2.5) * 0.25); }); const p = (t * 0.7) % 1; puff.position.x = 0.75 + p * 0.6; puff.scale.setScalar(0.5 + p * 1.5); puff.material.opacity = 0.8 * (1 - p); head.rotation.z = Math.sin(t * 1.3) * 0.1; } };
  },
  hydra(root) {
    // Three snake heads, each a clear top loader with a card glaring out.
    const scale = flat(0x0f766e), clear = mat(0xe0f2fe, { transparent: true, opacity: 0.55, shininess: 180, specular: 0xffffff });
    add(root, ball(0.8, scale, 12), 0, -0.85, 0).scale.set(1.3, 0.7, 1);
    const heads = [];
    for (const [x, h, tilt] of [[-0.75, 1.2, 0.35], [0, 1.6, 0], [0.75, 1.2, -0.35]]) {
      const g = new THREE.Group(); g.position.set(x * 0.5, -0.5, 0); root.add(g);
      add(g, cyl(0.12, 0.2, h, scale, 8), 0, h / 2, 0); g.rotation.z = tilt;
      const loader = new THREE.Group(); loader.position.set(0, h + 0.25, 0); g.add(loader);
      add(loader, box(0.42, 0.56, 0.08, clear));
      add(loader, box(0.32, 0.44, 0.04, flat(0xf43f5e)));
      for (const sx of [-1, 1]) add(loader, ball(0.05, mat(0xffffff)), sx * 0.08, 0.05, 0.05);
      heads.push(g);
    }
    return { tick(t) { heads.forEach((g, i) => { g.rotation.x = Math.sin(t * 2 + i * 2) * 0.2; g.children[1].rotation.y = Math.sin(t * 1.5 + i) * 0.4; }); } };
  },
};
export const BOSS_3D_IDS = Object.keys(BUILD);
// For other scenes (the Beasts gym fight in 3D): a boss model into any group, and the gauntlet's cover textures.
export function buildBoss3D(id, root) { return (BUILD[id] || BUILD.scalper)(root); }
export function fisterCoverTextures() { return typeof document === 'undefined' ? [] : fisterTextures(); }

// ── the PS1 look ────────────────────────────────────────────────────────────
// Store, 2026-11-04: "graphics would have to be animated and PS1 graphics".
// The same models drawn the way a 1995 console did: rendered small and
// blown up with hard pixels, vertices snapped to a coarse screen grid (the
// wobble), flat shading, and colours cut down with an ordered dither.
// Animation steps at 15 fps. Each material gets the two uniforms; 0 = off.
export const PS1 = { scale: 3, snap: 44, levels: 20, fps: 15 };
function ps1Patch(m, u) {
  if (m.userData.ps1) return;
  m.userData.ps1 = { flatShading: !!m.flatShading, shininess: m.shininess };
  m.onBeforeCompile = sh => {
    sh.uniforms.uSnap = u.snap; sh.uniforms.uLevels = u.levels;
    sh.vertexShader = 'uniform float uSnap;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  if (uSnap > 0.0) { vec4 sp = gl_Position; sp.xyz /= sp.w; sp.xy = floor(sp.xy * uSnap + 0.5) / uSnap; sp.xyz *= sp.w; gl_Position = sp; }');
    sh.fragmentShader = 'uniform float uLevels;\nfloat ps1Bayer2(vec2 p) { return mod(2.0 * p.x + 3.0 * p.y, 4.0); }\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
      '#include <dithering_fragment>\n  if (uLevels > 0.0) { vec2 q = floor(gl_FragCoord.xy); float b = (4.0 * ps1Bayer2(mod(q, 2.0)) + ps1Bayer2(mod(floor(q / 2.0), 2.0)) + 0.5) / 16.0; gl_FragColor.rgb = floor(gl_FragColor.rgb * uLevels + b) / uLevels; }');
  };
  m.needsUpdate = true;
}
function ps1Set(m, on) {
  const o = m.userData.ps1; if (!o) return;
  m.flatShading = on ? true : o.flatShading;
  if ('shininess' in m) m.shininess = on ? Math.min(8, o.shininess ?? 8) : o.shininess;
  if (m.map) { m.map.magFilter = on ? THREE.NearestFilter : THREE.LinearFilter; m.map.minFilter = on ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter; m.map.needsUpdate = true; }
  m.needsUpdate = true;
}

// One boss on its own little stage. view.set(id), .hit(), .defeat(on),
// .enter() (stomps in), .style(ps1).
export function createBossView(canvas, { size = 280, fov = 30, ps1 = true, lookY = 0.1 } = {}) {
  const r = renderer(canvas, size, size, { antialias: false });
  const scene = new THREE.Scene(); lights(scene);
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.1, 50); cam.position.set(0, lookY + 0.3, 7.0); cam.lookAt(0, lookY, 0);
  const holder = new THREE.Group(); scene.add(holder);
  // A soft shadow blob under the feet.
  const shadow = add(scene, new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })), 0, -1.55, 0);
  shadow.rotation.x = -Math.PI / 2;
  let model = null, id = '', hitAt = -9, defeated = false, defeatAt = 0, raf = 0, enterAt = -9, pieces = null, isPs1 = false, px = size;
  const clock = new THREE.Clock();
  const u = { snap: { value: 0 }, levels: { value: 0 } };
  const tint = (fn) => holder.traverse(o => { if (o.material) for (const m of [].concat(o.material)) fn(m); });
  const styleAll = () => { tint(m => { ps1Patch(m, u); ps1Set(m, isPs1); }); shadow.material.opacity = isPs1 ? 0.5 : 0.35; };
  function set(next, force = false) {
    next = BUILD[next] ? next : 'scalper';
    if (next === id && !force) return;
    id = next;
    if (pieces) for (const p of pieces) scene.remove(p.o);
    pieces = null;
    holder.clear(); holder.position.set(0, 0, 0); holder.rotation.set(0, 0, 0);
    const root = new THREE.Group(); holder.add(root);
    model = { root, ...BUILD[id](root) };
    tint(m => { m.userData.color = m.color?.clone(); });
    styleAll();
  }
  function style(on) {
    on = !!on;
    if (on === isPs1 && px === (on ? Math.round(size / PS1.scale) : size)) return;
    isPs1 = on; px = on ? Math.round(size / PS1.scale) : size;
    r.setSize(px, px, false);
    u.snap.value = on ? PS1.snap : 0; u.levels.value = on ? PS1.levels : 0;
    canvas.classList.toggle('ps1', on);
    styleAll();
  }
  // Knocked out, PS1 style: the model blows apart into its pieces, which
  // tumble and fall (a fixed spread from each piece's place, no chance).
  function explode() {
    const next = seq(7), center = new THREE.Vector3();
    holder.updateMatrixWorld(true);
    const meshes = []; model.root.traverse(o => { if (o.isMesh) meshes.push(o); });
    pieces = meshes.map(o => {
      const w = new THREE.Vector3(); o.getWorldPosition(w); scene.attach(o);
      const dir = w.clone().sub(center); dir.z += 0.6; dir.normalize();
      return { o, v: dir.multiplyScalar(3 + next() * 3).add(new THREE.Vector3(0, 3 + next() * 2, 0)), s: new THREE.Vector3(next() * 8 - 4, next() * 8 - 4, next() * 8 - 4) };
    });
  }
  let lastT = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const real = clock.getElapsedTime();
    // PS1: the pose steps at 15 fps.
    const t = isPs1 ? Math.floor(real * PS1.fps) / PS1.fps : real;
    if (!model) return;
    if (pieces) {
      const dt = Math.min(0.05, real - lastT);
      for (const p of pieces) { p.v.y -= 9.8 * dt; p.o.position.addScaledVector(p.v, dt); p.o.rotation.x += p.s.x * dt; p.o.rotation.y += p.s.y * dt; p.o.rotation.z += p.s.z * dt; }
      lastT = real; r.render(scene, cam); return;
    }
    lastT = real;
    if (!defeated) {
      model.tick(t);
      // Idle: a bouncy hover with a little squash at the bottom.
      const b = Math.sin(t * 3.2);
      model.root.position.y = b * 0.08;
      model.root.scale.set(1 + (b < 0 ? -b * 0.03 : 0), 1 - (b < 0 ? -b * 0.04 : 0), 1);
      holder.rotation.set(0, Math.sin(t * 0.7) * 0.18, 0);
      // Entrance: drops in from above, lands with a squash and a shake.
      const e = t - enterAt;
      if (e >= 0 && e < 1) {
        if (e < 0.45) { const k = e / 0.45; holder.position.y = 4 * (1 - k * k); model.root.scale.set(0.9, 1.15, 0.9); }
        else { const k = (e - 0.45) / 0.55, sq = Math.sin(k * Math.PI * 3) * (1 - k) * 0.3; holder.position.y = 0; holder.position.x = Math.sin(k * 50) * 0.08 * (1 - k); model.root.scale.set(1 + sq, 1 - sq, 1 + sq); }
        shadow.scale.setScalar(e < 0.45 ? 0.4 + 0.6 * (e / 0.45) : 1);
      } else if (e >= 1 && e < 1.1) { holder.position.set(0, 0, 0); shadow.scale.setScalar(1); }
    }
    // A hit: knocked back, flashing white then red, with a shake.
    const since = t - hitAt;
    if (since < 0.6) {
      const k = 1 - since / 0.6;
      holder.position.x = Math.sin(since * 60) * 0.12 * k;
      holder.rotation.z = -0.25 * k;
      tint(m => { if (m.emissive) m.emissive.setRGB(since < 0.1 ? 1 : 0.9 * k, since < 0.1 ? 1 : 0.1 * k, since < 0.1 ? 1 : 0.1 * k); });
    } else if (since < 0.7) { holder.position.x = 0; holder.rotation.z = 0; tint(m => m.emissive?.setRGB(0, 0, 0)); }
    if (defeated && !isPs1) {
      const d = Math.min(1, (t - defeatAt) / 0.7);
      holder.rotation.z = -1.45 * (d * d);
      holder.position.y = -0.4 * d;
      holder.position.x = 0.3 * d;
    }
    r.render(scene, cam);
  }
  style(ps1);
  return {
    set, style,
    hit() { hitAt = clock.getElapsedTime(); },
    // A model's own modes (Mr Fister's symbiote).
    mode(name, on) { model?.mode?.(name, on); },
    enter() { if (defeated) this.defeat(false); enterAt = clock.getElapsedTime(); },
    get ps1() { return isPs1; },
    get exploded() { return !!pieces; },
    defeat(on) {
      if (on === defeated) return;
      defeated = on; defeatAt = clock.getElapsedTime();
      if (isPs1) { if (on) { if (model) explode(); } else set(id, true); return; }
      // Knocked out: drained of colour.
      tint(m => { if (!m.userData.color || !m.color) return; if (on) { const c = m.userData.color, g = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; m.color.setRGB(g * 0.7, g * 0.7, g * 0.75); } else m.color.copy(m.userData.color); });
      if (!on) { holder.rotation.set(0, 0, 0); holder.position.set(0, 0, 0); }
    },
    start() { if (!raf) { clock.start(); frame(); } },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    get id() { return id; },
    // How many pixels the boss covers, read right after a render (tests).
    litPixels() {
      r.render(scene, cam);
      const g = r.getContext(), buf = new Uint8Array(px * px * 4);
      g.readPixels(0, 0, px, px, g.RGBA, g.UNSIGNED_BYTE, buf);
      let n = 0; for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) n++;
      return n;
    },
  };
}

// ── coins ───────────────────────────────────────────────────────────────────
// Thick gold coins with a raised mana-drop on each face, spinning as they
// fly. A tiny repeatable sequence spreads them (looks random, isn't).
function coinFace() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(100, 90, 10, 128, 128, 128);
  g.addColorStop(0, '#fff7c2'); g.addColorStop(0.45, '#ffd21f'); g.addColorStop(1, '#c98200');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.lineWidth = 14; x.strokeStyle = '#b57400'; x.beginPath(); x.arc(128, 128, 104, 0, TAU); x.stroke();
  x.lineWidth = 5; x.strokeStyle = '#fff3a6'; x.beginPath(); x.arc(128, 128, 94, 0, TAU); x.stroke();
  // The mana drop, embossed: dark offset under a lit face.
  const drop = (ox, oy, fill) => { x.fillStyle = fill; x.beginPath(); x.moveTo(128 + ox, 52 + oy); x.bezierCurveTo(176 + ox, 112 + oy, 182 + ox, 150 + oy, 170 + ox, 172 + oy); x.arc(128 + ox, 158 + oy, 44, 0.3, Math.PI - 0.3); x.bezierCurveTo(74 + ox, 150 + oy, 80 + ox, 112 + oy, 128 + ox, 52 + oy); x.fill(); };
  drop(6, 7, '#9a6200'); drop(0, 0, '#ffe45c');
  x.fillStyle = '#fffbe0'; x.beginPath(); x.ellipse(110, 128, 10, 22, -0.4, 0, TAU); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function seq(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function createCoinLayer(canvas, { width = 1080, height = 1920 } = {}) {
  const r = renderer(canvas, width, height);
  const scene = new THREE.Scene(); lights(scene, { key: 1.8, rim: 0xffb000 });
  // Pixel coordinates: x right, y down (flipped below), z toward the viewer.
  const cam = new THREE.OrthographicCamera(0, width, 0, -height, -2000, 2000); cam.position.z = 1000;
  const face = new THREE.MeshPhongMaterial({ map: coinFace(), shininess: 110, specular: 0xfff1a8 });
  const rim = new THREE.MeshPhongMaterial({ color: 0xe0a100, shininess: 120, specular: 0xffffff, flatShading: true });
  const geo = new THREE.CylinderGeometry(1, 1, 0.24, 24);
  const coins = [];
  let raf = 0, last = 0, rainUntil = 0, rainRate = 0, rainCarry = 0, next = seq(97);
  function spawn({ x, y, vx, vy, size, spin }) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, [rim, face, face]); m.rotation.x = Math.PI / 2; g.add(m);
    g.scale.setScalar(size); g.position.set(x, -y, 0); scene.add(g);
    coins.push({ g, x, y, vx, vy, spin, a: next() * TAU, tilt: (next() - 0.5) * 0.6, size });
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (now < rainUntil) {
      rainCarry += rainRate * dt;
      while (rainCarry >= 1) { rainCarry--; spawn({ x: 40 + next() * (width - 80), y: -60, vx: (next() - 0.5) * 60, vy: 200 + next() * 260, size: 24 + next() * 14, spin: 6 + next() * 8 }); }
    }
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      c.vy += 1500 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.a += c.spin * dt;
      c.g.position.set(c.x, -c.y, 0); c.g.rotation.set(c.tilt, c.a, Math.sin(c.a * 0.5) * 0.15);
      if (c.y > height + 80) { scene.remove(c.g); coins.splice(i, 1); }
    }
    r.render(scene, cam);
    if (!coins.length && now >= rainUntil) { cancelAnimationFrame(raf); raf = 0; last = 0; r.clear(); }
  }
  const run = () => { if (!raf) raf = requestAnimationFrame(frame); };
  return {
    // A coin shower for ms (big hits, the boss K.O.).
    rain(perSecond = 24, ms = 3500) { rainRate = perSecond; rainUntil = performance.now() + ms; run(); },
    // A fountain of coins out of a point on screen (each sale, from the score).
    burst(x, y, n = 8) {
      for (let i = 0; i < n; i++) spawn({ x, y, vx: (next() - 0.5) * 900, vy: -(260 + next() * 420), size: 22 + next() * 10, spin: 8 + next() * 10 });
      run();
    },
    clear() { rainUntil = 0; for (const c of coins) scene.remove(c.g); coins.length = 0; },
    get count() { return coins.length; },
  };
}

// ── the boss in the crawl's arena ───────────────────────────────────────────
// The 3D boss photographed through one loop of its idle animation (8 frames),
// facing you, so the first-person crawl can show it moving in the boss arena
// (2026-11-12: "boss arenas"). Null without WebGL (the flat pixel boss stays).
export function bakeBoss(id, { size = 96, frames = 8 } = {}) {
  if (!BUILD[id]) id = 'scalper';
  let r;
  try { const c = document.createElement('canvas'); c.width = c.height = size; r = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: false, preserveDrawingBuffer: true }); }
  catch { return null; }
  r.setPixelRatio(1); r.setSize(size, size, false); r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(); lights(scene);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50); cam.position.set(0, 0.2, 7.2); cam.lookAt(0, 0, 0);
  const root = new THREE.Group(); scene.add(root);
  const model = BUILD[id](root);
  const out = document.createElement('canvas'); out.width = out.height = size; const ctx = out.getContext('2d', { willReadFrequently: true });
  const shots = [], loop = TAU / 3.2;
  for (let f = 0; f < frames; f++) {
    const t = f / frames * loop, b = Math.sin(t * 3.2);
    model.tick?.(t); root.position.y = b * 0.08; root.rotation.y = Math.sin(f / frames * TAU) * 0.15;
    r.render(scene, cam); ctx.clearRect(0, 0, size, size); ctx.drawImage(r.domElement, 0, 0);
    shots.push({ w: size, h: size, data: ctx.getImageData(0, 0, size, size).data });
  }
  r.dispose(); r.forceContextLoss?.();
  return { frames: shots };
}
