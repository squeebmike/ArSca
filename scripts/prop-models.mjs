// 3D props for the shed crawl, the Duke Nukem 3D way (store, 2026-11-12:
// "can't we make the props 3d? the chest 3d? the critters?" -- "yes, do it
// the duke nukem way"). Each prop is a small low-poly model built here (all
// original, simple shapes, no outside models or textures), photographed once
// at load from 8 angles (and a few animation frames). The crawl then shows
// the photo for the angle you see it from, so a chest turns as you walk past
// it and a rat runs in profile -- and the hall stays as fast as before.
import * as THREE from '../assets/vendor/three-0.160.0.module.min.js';

const mat = (c, o = {}) => new THREE.MeshPhongMaterial({ color: c, shininess: 40, flatShading: true, ...o });
const glow = c => new THREE.MeshBasicMaterial({ color: c });
const add = (p, m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); p.add(m); return m; };
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const ball = (r, m, s = 10) => new THREE.Mesh(new THREE.SphereGeometry(r, s, Math.max(6, Math.round(s * 0.7))), m);
const cyl = (a, b, h, m, s = 10) => new THREE.Mesh(new THREE.CylinderGeometry(a, b, h, s), m);
const cone = (r, h, m, s = 8) => new THREE.Mesh(new THREE.ConeGeometry(r, h, s), m);
const COMIC = [0xef4444, 0x3b82f6, 0xfacc15, 0x22c55e, 0xa855f7, 0xf97316];

// Each model stands on y = 0, about 1 unit across, facing +z (toward you at angle 0).
const MODELS = {
  chest: { frames: 1, build(r) {
    const wood = mat(0x9c5824), dark = mat(0x4a2a10), gold = mat(0xf5c542, { shininess: 120, specular: 0xffffff });
    add(r, box(1.0, 0.5, 0.62, wood), 0, 0.25, 0);
    const lid = add(r, cyl(0.31, 0.31, 1.0, wood, 12), 0, 0.5, 0); lid.rotation.z = Math.PI / 2; lid.scale.set(1, 1, 1); // a rounded lid
    for (const x of [-0.36, 0.36]) { add(r, box(0.1, 0.52, 0.64, gold), x, 0.25, 0); const b = add(r, cyl(0.32, 0.32, 0.1, gold, 12), x, 0.5, 0); b.rotation.z = Math.PI / 2; }
    add(r, box(1.02, 0.06, 0.64, gold), 0, 0.5, 0);
    add(r, box(0.18, 0.22, 0.06, glow(0xfff4b0)), 0, 0.42, 0.33); add(r, box(0.05, 0.08, 0.02, mat(0x1a0e04)), 0, 0.4, 0.37);
    add(r, box(1.04, 0.05, 0.66, dark), 0, 0.02, 0);
  } },
  chestopen: { frames: 1, build(r) {
    const wood = mat(0x9c5824), gold = mat(0xf5c542, { shininess: 120, specular: 0xffffff });
    add(r, box(1.0, 0.5, 0.62, wood), 0, 0.25, 0);
    for (const x of [-0.36, 0.36]) add(r, box(0.1, 0.52, 0.64, gold), x, 0.25, 0);
    add(r, box(0.9, 0.12, 0.52, glow(0xffe680)), 0, 0.5, 0); // a heap of gold, glowing
    for (let i = 0; i < 7; i++) add(r, cyl(0.07, 0.07, 0.03, glow(0xffd23a), 10), -0.33 + i * 0.11, 0.58 + (i % 2) * 0.03, -0.1 + (i % 3) * 0.1).rotation.x = 0.4 * (i % 2 ? 1 : -1);
    const hinge = new THREE.Group(); hinge.position.set(0, 0.5, -0.31); r.add(hinge); // the lid, thrown back
    const lid = add(hinge, cyl(0.31, 0.31, 1.0, wood, 12), 0, 0.22, -0.18); lid.rotation.z = Math.PI / 2; hinge.rotation.x = -1.2;
  } },
  rat: { frames: 2, build(r, f) {
    const fur = mat(0x6e645c), pink = mat(0xe8a0a8);
    const body = add(r, ball(0.22, fur), 0, 0.17, 0); body.scale.set(0.85, 0.75, 1.6);
    add(r, ball(0.13, fur), 0, 0.2, 0.36).scale.set(0.9, 0.85, 1.3);
    add(r, cone(0.05, 0.09, pink, 6), 0, 0.19, 0.52).rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) { add(r, ball(0.06, pink), s * 0.08, 0.32, 0.32); add(r, ball(0.025, glow(0x111111)), s * 0.07, 0.24, 0.45); }
    const tail = add(r, cyl(0.015, 0.03, 0.55, pink, 5), 0, 0.12, -0.55); tail.rotation.x = Math.PI / 2 - 0.25 + (f ? 0.3 : -0.1);
    for (const [x, z, k] of [[-0.12, 0.2, 0], [0.12, 0.2, 1], [-0.12, -0.15, 1], [0.12, -0.15, 0]]) add(r, box(0.05, 0.1, 0.06, pink), x, 0.05, z + ((k ^ f) ? 0.05 : -0.05));
  } },
  bat: { frames: 2, build(r, f) {
    const skin = mat(0x3a2a48), wing = mat(0x55406a, { side: THREE.DoubleSide });
    add(r, ball(0.14, skin), 0, 0.5, 0).scale.set(1, 1.2, 1);
    for (const s of [-1, 1]) { add(r, cone(0.04, 0.1, skin, 4), s * 0.07, 0.68, 0); add(r, ball(0.025, glow(0xff4040)), s * 0.05, 0.54, 0.12);
      const w = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.5, f ? 0.25 : -0.2, -0.05), new THREE.Vector3(s * 0.45, f ? -0.05 : -0.35, 0.05), new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.45, f ? -0.05 : -0.35, 0.05), new THREE.Vector3(s * 0.2, f ? -0.1 : -0.25, 0.02)]), wing);
      w.geometry.computeVertexNormals(); add(r, w, s * 0.06, 0.52, 0); }
  } },
  spider: { frames: 1, build(r) {
    const black = mat(0x22181f);
    add(r, cyl(0.006, 0.006, 0.55, glow(0xc8c8d0), 4), 0, 0.72, 0);
    add(r, ball(0.12, black), 0, 0.4, 0).scale.set(1, 0.85, 1.2); add(r, ball(0.07, black), 0, 0.42, 0.15);
    for (const s of [-1, 1]) add(r, ball(0.02, glow(0xff3030)), s * 0.03, 0.45, 0.21);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { const l = add(r, cyl(0.012, 0.012, 0.3, black, 4), s * 0.16, 0.36, -0.12 + i * 0.08); l.rotation.z = s * 1.1; l.rotation.x = (i - 1.5) * 0.25; }
  } },
  // The dungeon's long boxes, every which way (2026-11-12: "more variations of the long boxes and stuff in the dungeons").
  longbox: { frames: 1, build(r) {
    const card = mat(0xd9cdb0), lid = mat(0xc9bc9c);
    add(r, box(0.36, 0.36, 1.1, card), 0, 0.18, 0); add(r, box(0.38, 0.08, 1.12, lid), 0, 0.38, 0);
    add(r, box(0.2, 0.1, 0.01, mat(0xffffff)), 0, 0.22, 0.556); add(r, box(0.14, 0.02, 0.01, mat(0x333333)), 0, 0.22, 0.562);
    add(r, box(0.12, 0.04, 0.01, mat(0x222222)), 0, 0.3, 0.556); // the hand hole
  } },
  longboxopen: { frames: 1, build(r) {
    const card = mat(0xd9cdb0);
    add(r, box(0.36, 0.36, 1.1, card), 0, 0.18, 0);
    for (let i = 0; i < 12; i++) { const c = add(r, box(0.3, 0.42, 0.02, mat(COMIC[i % COMIC.length])), 0, 0.27 + (i % 3) * 0.02, -0.48 + i * 0.085); c.rotation.x = (i % 4 - 1.5) * 0.06; }
    const lid = add(r, box(0.38, 0.06, 1.12, mat(0xc9bc9c)), 0.3, 0.04, 0.05); lid.rotation.z = 0.25; // the lid leaning on the side
  } },
  // The secret vault's pedestal: a stone pillar, a glowing gold box on top.
  pedestal: { frames: 1, build(r) {
    const stone = mat(0x8a8494), gold = mat(0xf5c542, { shininess: 120, specular: 0xffffff });
    add(r, box(0.5, 0.1, 0.5, stone), 0, 0.05, 0); add(r, cyl(0.16, 0.2, 0.62, stone, 8), 0, 0.41, 0); add(r, box(0.46, 0.08, 0.46, stone), 0, 0.76, 0);
    add(r, box(0.3, 0.22, 0.24, gold), 0, 0.91, 0); add(r, box(0.2, 0.12, 0.26, glow(0xfff2a0)), 0, 0.93, 0.01);
    for (let k = 0; k < 6; k++) { const g = add(r, box(0.05, 0.05, 0.05, glow([0xff5577, 0x55aaff, 0x66ff99][k % 3])), Math.cos(k) * 0.3, 1.1 + (k % 2) * 0.1, Math.sin(k) * 0.3); g.rotation.set(k, k * 2, 0); }
  } },
  // THE MERCHANT (2026-11-12): a hooded traveller, a huge pack of long boxes and
  // comics on his back, a lantern held up -- he offers chat two items.
  merchant: { frames: 1, build(r) {
    const robe = mat(0x5b3a8c), dark = mat(0x2a1a40), skin = mat(0xd8a878), card = mat(0xd9cdb0), brass = mat(0xd9a640, { shininess: 100 });
    add(r, cone(0.36, 0.95, robe, 10), 0, 0.48, 0); // the robe
    const hood = add(r, cone(0.22, 0.42, robe, 10), 0, 1.12, 0); hood.rotation.x = -0.15;
    add(r, ball(0.15, dark, 10), 0, 0.98, 0.06); // shadow in the hood
    for (const x of [-0.06, 0.06]) add(r, ball(0.025, glow(0xffe680), 6), x, 1.0, 0.19); // eyes glinting
    add(r, ball(0.06, skin, 8), 0, 0.92, 0.19); // the nose
    add(r, box(0.52, 0.6, 0.3, card), 0, 0.85, -0.3); add(r, box(0.54, 0.06, 0.32, mat(0xc9bc9c)), 0, 1.16, -0.3); // the pack: long boxes
    for (let i = 0; i < 5; i++) add(r, box(0.2, 0.28, 0.02, mat(COMIC[i % COMIC.length])), -0.18 + i * 0.09, 1.3, -0.3 + (i % 2) * 0.04); // comics poking out
    const arm = add(r, cyl(0.06, 0.07, 0.42, robe, 8), 0.3, 0.86, 0.12); arm.rotation.z = -0.9;
    add(r, box(0.12, 0.16, 0.12, brass), 0.5, 1.05, 0.18); add(r, box(0.08, 0.1, 0.08, glow(0xffd860)), 0.5, 1.05, 0.18); // the lantern
  } },
  // A LOCKED long box (2026-11-12: "doors and keys"): chained shut with a glowing
  // padlock; chat's follows / shares / bookmarks open it and a store item comes out.
  lockbox: { frames: 1, build(r) {
    const card = mat(0xcbb48a), lid = mat(0xb9a074), iron = mat(0x6a6a74, { shininess: 90, specular: 0xffffff });
    add(r, box(0.42, 0.4, 1.1, card), 0, 0.2, 0); add(r, box(0.44, 0.08, 1.12, lid), 0, 0.42, 0);
    for (const z of [-0.3, 0.3]) { add(r, box(0.48, 0.05, 0.05, iron), 0, 0.3, z); add(r, box(0.05, 0.46, 0.05, iron), 0.235, 0.23, z); add(r, box(0.05, 0.46, 0.05, iron), -0.235, 0.23, z); add(r, box(0.48, 0.05, 0.05, iron), 0, 0.47, z); }
    add(r, box(0.18, 0.16, 0.06, glow(0xffd84a)), 0, 0.26, 0.58); // the padlock, glowing gold
    const sh = add(r, cyl(0.06, 0.06, 0.03, iron, 10), 0, 0.37, 0.58); sh.rotation.x = Math.PI / 2;
    add(r, box(0.04, 0.06, 0.02, mat(0x1a1206)), 0, 0.25, 0.615);
  } },
  lockboxopen: { frames: 1, build(r) {
    const card = mat(0xcbb48a), iron = mat(0x6a6a74);
    add(r, box(0.42, 0.4, 1.1, card), 0, 0.2, 0);
    add(r, box(0.36, 0.06, 1.0, glow(0xfff0a0)), 0, 0.41, 0); // light pouring out
    for (let i = 0; i < 10; i++) { const c = add(r, box(0.34, 0.44, 0.02, mat(COMIC[i % COMIC.length])), 0, 0.3 + (i % 3) * 0.02, -0.45 + i * 0.1); c.rotation.x = (i % 4 - 1.5) * 0.08; }
    const lid = add(r, box(0.44, 0.06, 1.12, mat(0xb9a074)), 0.34, 0.04, 0.05); lid.rotation.z = 0.3;
    for (const x of [-0.42, 0.5]) add(r, box(0.05, 0.05, 0.5, iron), x, 0.03, 0.4); // the chains, dropped
  } },
  longboxstack: { frames: 1, build(r) {
    const card = mat(0xd9cdb0), lid = mat(0xc9bc9c);
    [[0, 0, 0], [0.05, 0.42, 0.08], [-0.04, 0.84, -0.05]].forEach(([x, y, a]) => { const g = new THREE.Group(); g.position.set(x, y, 0); g.rotation.y = a; r.add(g); add(g, box(0.36, 0.34, 1.0, card), 0, 0.17, 0); add(g, box(0.38, 0.07, 1.02, lid), 0, 0.36, 0); add(g, box(0.2, 0.08, 0.01, mat(0xffffff)), 0, 0.2, 0.506); });
  } },
  shortbox: { frames: 1, build(r) {
    const card = mat(0xe0d6bd);
    add(r, box(0.36, 0.34, 0.5, card), -0.22, 0.17, 0); add(r, box(0.38, 0.06, 0.52, mat(0xcfc4a6)), -0.22, 0.36, 0);
    add(r, box(0.36, 0.34, 0.5, card), 0.2, 0.17, 0.08).rotation.y = 0.3;
    for (let i = 0; i < 5; i++) add(r, box(0.3, 0.38, 0.02, mat(COMIC[(i + 2) % COMIC.length])), 0.2 + Math.sin(0.3) * (i * 0.08 - 0.16), 0.26, 0.08 + Math.cos(0.3) * (i * 0.08 - 0.16)).rotation.y = 0.3;
  } },
  crate: { frames: 1, build(r) {
    const wood = mat(0x8a5a2b), dark = mat(0x5c3a18);
    add(r, box(0.7, 0.6, 0.7, wood), 0, 0.3, 0);
    for (const y of [0.08, 0.52]) add(r, box(0.72, 0.08, 0.72, dark), 0, y, 0);
    const brace = add(r, box(0.08, 0.84, 0.02, dark), 0, 0.3, 0.36); brace.rotation.z = 0.78;
    for (let i = 0; i < 4; i++) add(r, box(0.18, 0.26, 0.02, mat(COMIC[i])), -0.21 + i * 0.14, 0.7, 0.05 + (i % 2) * 0.06).rotation.x = -0.2;
  } },
  coffin: { frames: 1, build(r) {
    // An old rotten long box in the crypt, lid askew, cobwebs.
    const rot = mat(0x8a7350), lid = mat(0x7a6444);
    add(r, box(0.4, 0.38, 1.15, rot), 0, 0.19, 0);
    const l = add(r, box(0.42, 0.07, 1.16, lid), 0.06, 0.42, 0.08); l.rotation.y = 0.18; l.rotation.z = -0.08;
    add(r, box(0.22, 0.1, 0.01, mat(0xb8ad90)), 0, 0.24, 0.58);
    const web = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.2, 0.46, 0.56), new THREE.Vector3(-0.2, 0.1, 0.58), new THREE.Vector3(0.1, 0.46, 0.58)]), new THREE.MeshBasicMaterial({ color: 0xd0d0d8, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    r.add(web);
  } },
  bones: { frames: 1, build(r) {
    const bone = mat(0xe6dfc8);
    add(r, ball(0.15, bone), 0, 0.15, 0.05).scale.set(1, 0.95, 1.1);
    for (const s of [-1, 1]) add(r, ball(0.04, glow(0x111111)), s * 0.055, 0.17, 0.18);
    add(r, box(0.14, 0.05, 0.08, bone), 0, 0.04, 0.16);
    [[0.3, 0.05, -0.1, 0.6], [-0.28, 0.05, 0.15, -0.9], [0.05, 0.05, -0.3, 1.4]].forEach(([x, y, z, a]) => { const b = add(r, cyl(0.03, 0.03, 0.42, bone, 6), x, y, z); b.rotation.z = Math.PI / 2; b.rotation.y = a; add(r, ball(0.05, bone), x + Math.cos(a) * 0.21, y, z - Math.sin(a) * 0.21); });
  } },
  brazier: { frames: 2, build(r, f) {
    const iron = mat(0x3f3b45, { shininess: 80 });
    add(r, cyl(0.06, 0.12, 0.6, iron, 8), 0, 0.3, 0); add(r, cyl(0.25, 0.4, 0.06, iron, 8), 0, 0.03, 0);
    add(r, cyl(0.34, 0.2, 0.22, iron, 10), 0, 0.7, 0);
    add(r, cone(0.24, 0.42 + f * 0.08, glow(0xff7a1a), 7), 0, 0.98, 0).rotation.y = f;
    add(r, cone(0.14, 0.32 + (1 - f) * 0.1, glow(0xffe060), 6), 0.04 * (f ? 1 : -1), 0.98, 0.02);
  } },
};
export const MODEL_KINDS = Object.keys(MODELS);

// Photograph every model from 8 angles (and its frames) once. Returns
// { kind: { frames: [[{ w, h, data }, ...8 angles], ...frames] } }, or null without WebGL.
export function bakeProps({ size = 64 } = {}) {
  let renderer;
  try { const c = document.createElement('canvas'); c.width = c.height = size; renderer = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: false, preserveDrawingBuffer: true }); }
  catch { return null; }
  renderer.setPixelRatio(1); renderer.setSize(size, size, false); renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff2dc, 0x2a1f30, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(-2, 4, 5); scene.add(key);
  // A little above eye level, looking slightly down -- like you see props in the hall.
  const cam = new THREE.OrthographicCamera(-0.7, 0.7, 0.7, -0.7, 0.1, 20); cam.position.set(0, 1.5, 5); cam.lookAt(0, 0.62, 0);
  const out2d = document.createElement('canvas'); out2d.width = out2d.height = size; const ctx = out2d.getContext('2d', { willReadFrequently: true });
  const baked = {};
  for (const [kind, def] of Object.entries(MODELS)) {
    const frames = [];
    for (let f = 0; f < def.frames; f++) {
      const root = new THREE.Group(); def.build(root, f); scene.add(root);
      const angles = [];
      for (let k = 0; k < 8; k++) {
        root.rotation.y = -k * Math.PI / 4;
        renderer.render(scene, cam); ctx.clearRect(0, 0, size, size); ctx.drawImage(renderer.domElement, 0, 0);
        angles.push({ w: size, h: size, data: ctx.getImageData(0, 0, size, size).data });
      }
      scene.remove(root); root.traverse(o => { o.geometry?.dispose?.(); });
      frames.push(angles);
    }
    baked[kind] = { frames };
  }
  renderer.dispose(); renderer.forceContextLoss?.();
  return baked;
}
