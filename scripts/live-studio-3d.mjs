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
function renderer(canvas, w, h) {
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
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

// ── the five bosses ─────────────────────────────────────────────────────────
// Each returns { root, tick(t) } -- tick runs the idle animation.
const BUILD = {
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
};
export const BOSS_3D_IDS = Object.keys(BUILD);

// One boss on its own little stage. view.set(id), .hit(), .defeat(on).
export function createBossView(canvas, { size = 280, fov = 30 } = {}) {
  const r = renderer(canvas, size, size);
  const scene = new THREE.Scene(); lights(scene);
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.1, 50); cam.position.set(0, 0.4, 7.0); cam.lookAt(0, 0.1, 0);
  const holder = new THREE.Group(); scene.add(holder);
  // A soft shadow blob under the feet.
  const shadow = add(scene, new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })), 0, -1.55, 0);
  shadow.rotation.x = -Math.PI / 2;
  let model = null, id = '', hitAt = -9, defeated = false, defeatAt = 0, raf = 0;
  const clock = new THREE.Clock();
  const tint = (fn) => holder.traverse(o => { if (o.material) for (const m of [].concat(o.material)) fn(m); });
  function set(next) {
    next = BUILD[next] ? next : 'scalper';
    if (next === id) return;
    id = next;
    holder.clear();
    const root = new THREE.Group(); holder.add(root);
    model = { root, ...BUILD[id](root) };
    tint(m => { m.userData.color = m.color?.clone(); });
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    const t = clock.getElapsedTime();
    if (!model) return;
    if (!defeated) {
      model.tick(t);
      // Idle: a bouncy hover with a little squash at the bottom.
      const b = Math.sin(t * 3.2);
      model.root.position.y = b * 0.08;
      model.root.scale.set(1 + (b < 0 ? -b * 0.03 : 0), 1 - (b < 0 ? -b * 0.04 : 0), 1);
      holder.rotation.set(0, Math.sin(t * 0.7) * 0.18, 0);
    }
    // A hit: knocked back, flashing white then red, with a shake.
    const since = t - hitAt;
    if (since < 0.6) {
      const k = 1 - since / 0.6;
      holder.position.x = Math.sin(since * 60) * 0.12 * k;
      holder.rotation.z = -0.25 * k;
      tint(m => { if (m.emissive) m.emissive.setRGB(since < 0.1 ? 1 : 0.9 * k, since < 0.1 ? 1 : 0.1 * k, since < 0.1 ? 1 : 0.1 * k); });
    } else if (since < 0.7) { holder.position.x = 0; holder.rotation.z = 0; tint(m => m.emissive?.setRGB(0, 0, 0)); }
    if (defeated) {
      const d = Math.min(1, (t - defeatAt) / 0.7);
      holder.rotation.z = -1.45 * (d * d);
      holder.position.y = -0.4 * d;
      holder.position.x = 0.3 * d;
    }
    r.render(scene, cam);
  }
  return {
    set,
    hit() { hitAt = clock.getElapsedTime(); },
    defeat(on) {
      if (on === defeated) return;
      defeated = on; defeatAt = clock.getElapsedTime();
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
      const g = r.getContext(), px = new Uint8Array(size * size * 4);
      g.readPixels(0, 0, size, size, g.RGBA, g.UNSIGNED_BYTE, px);
      let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
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
