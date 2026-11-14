// LONG BOX BEASTS IN 3D (store, 2026-11-14: "DS and 3DS mode ... models them kind of like the corresponding games"):
// the battle with real 3D beasts -- each built from its body type (blob, biped, four-legged, bird, bug, serpent) in its
// own colours (from its name), standing on round grass platforms under a sky, the camera low behind yours looking up at
// theirs, the HP boxes and the move panel drawn over it. Same calls as the pixel battle (set, attack, evolve, levelUp).
// Original models built from simple shapes here; nothing from any game. Nothing by chance.
import * as THREE from '../assets/vendor/three-0.160.0.module.min.js';
import { buildBoss3D, fisterCoverTextures } from './live-studio-3d.mjs';
import { beastType, beastRamp, hashOf, moveAnim, foeMoveFor, gymMoveFor, gymOf, DEFAULT_MOVES, STARTER } from './beasts.mjs?v=18';
import { buildLeader3D, buildArena3D, signatureFx } from './beasts-gyms-3d.mjs?v=1';

const col = c => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
const mat = (c, o = {}) => new THREE.MeshPhongMaterial({ color: col(c), shininess: 40, ...o });
const ball = (r, m, s = 18) => new THREE.Mesh(new THREE.SphereGeometry(r, s, Math.round(s * 0.7)), m);
const cyl = (a, b, h, m, s = 12) => new THREE.Mesh(new THREE.CylinderGeometry(a, b, h, s), m);
const cone = (r, h, m, s = 10) => new THREE.Mesh(new THREE.ConeGeometry(r, h, s), m);
const at = (p, o, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); p.add(o); return o; };

// BETTER MODELS, MORE VARIATIONS (store, 2026-11-14): each beast built from its name -- one of eleven body plans (blob,
// biped, four-legged, bird, bug, serpent, fish, dragon, golem, ghost, sprout), toon-shaded with a dark outline like the
// handhelds' 3D era, and its own mix of parts: ears or horns or a crest, a tail (thin, fluffy, leaf, flame), back spikes
// or fins, spots or stripes or a belly patch, round or angry or sleepy eyes, a grin with fangs; evolved forms grow
// bigger with more spikes and armour plates. The same name always makes the same beast (no dice). Original designs.
const EXTRA_PLANS = ['fish', 'dragon', 'golem', 'ghost', 'sprout'];
const toonGrad = (() => { let t = null; return () => { if (t) return t; const d = new Uint8Array([90, 170, 255]); t = new THREE.DataTexture(d, 3, 1, THREE.RedFormat); t.needsUpdate = true; t.minFilter = t.magFilter = THREE.NearestFilter; return t; }; })();
const patternTex = new Map();
function pattern(kind, a, b) {
  const k = kind + a.join() + b.join(); if (patternTex.has(k)) return patternTex.get(k);
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = `rgb(${a})`; x.fillRect(0, 0, 64, 64); x.fillStyle = `rgb(${b})`;
  if (kind === 'spots') for (const [px, py, r] of [[12, 14, 6], [40, 10, 5], [26, 36, 7], [52, 42, 5], [10, 52, 5], [44, 58, 4]]) { x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill(); }
  else if (kind === 'stripes') for (let y = 0; y < 64; y += 16) x.fillRect(0, y, 64, 6);
  else if (kind === 'diamonds') for (let y = 0; y < 64; y += 16) for (let xx = (y / 16 % 2) * 8; xx < 64; xx += 16) { x.beginPath(); x.moveTo(xx + 8, y); x.lineTo(xx + 14, y + 8); x.lineTo(xx + 8, y + 16); x.lineTo(xx + 2, y + 8); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; patternTex.set(k, t); return t;
}
const toon = (c, o = {}) => new THREE.MeshToonMaterial({ color: col(c), gradientMap: toonGrad(), ...o });
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x15121c, side: THREE.BackSide });
function outline(group, w = 0.035) { const add = []; group.traverse(o => { if (o.isMesh && !o.userData.noOutline && o.geometry && o.material !== OUTLINE) add.push(o); }); for (const o of add) { const h = new THREE.Mesh(o.geometry, OUTLINE); h.userData.noOutline = true; const sz = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()), m = Math.max(0.05, Math.min(sz.x, sz.y, sz.z) || 0.1); h.scale.setScalar(Math.min(1.14, 1 + w / m * 2)); o.add(h); } }
export function planOf(name) {
  const nm = String(name).toUpperCase(), h = hashOf(nm + 'plan');
  // The starters keep their plan; others: a fixed share become the newer plans.
  if (nm === 'SPIDER-CHEEKS') return 'baboon';
  if (/^(SLABBIT|SLABBUNNY|GRADEZILLA|TOPLOADON|TOPLOADRAKE|TITANLOADER|SLEEVIL|SLEEVILLAIN|OVERSLEEVOR)$/.test(nm)) return beastType(nm);
  if (/GRAIL|TITAN|GOLEM|SLABTITAN/.test(nm)) return 'golem'; if (/LONGBOX|ODON/.test(nm)) return 'quad'; if (/PHOENIX|DRAKE|WYRM/.test(nm)) return 'dragon'; if (/WRAITH|GHOST|SPOOK/.test(nm)) return 'ghost';
  return h % 5 < 2 ? EXTRA_PLANS[(h >>> 3) % EXTRA_PLANS.length] : beastType(nm);
}
export function buildBeast3D(name) {
  const nm = String(name).toUpperCase(), plan = planOf(nm), r = beastRamp(nm), h = hashOf(nm), bit = (k, n = 2) => (h >>> (k * 3)) % n;
  const stage = /ZILLA|TITAN|OVERSLEEV|LOADER$/.test(nm) ? 2 : /BUNNY|DRAKE|VILLAIN/.test(nm) ? 1 : 0;
  const pat = ['plain', 'spots', 'stripes', 'diamonds', 'belly'][bit(1, 5)];
  const body = pat === 'plain' || pat === 'belly' ? toon(r[1]) : toon([255, 255, 255], { map: pattern(pat, r[1], r[2]) }), belly = toon(r[0]), dark = toon(r[2]), accent = toon(r[(bit(2, 2) ? 0 : 3)]);
  const eyeW = toon([250, 250, 250]), eyeB = new THREE.MeshBasicMaterial({ color: 0x14121c }), shine = new THREE.MeshBasicMaterial({ color: 0xffffff }), mouthM = new THREE.MeshBasicMaterial({ color: 0x5a1a22 }), fang = toon([255, 255, 255]);
  const g = new THREE.Group(), parts = { legs: [], wings: [], tail: null, head: null, float: plan === 'ghost' };
  const eyeStyle = ['round', 'angry', 'sleepy'][bit(3, 3)];
  const face = (p, x, y, z, s = 1) => {
    for (const sx of [-1, 1]) { const e = at(p, ball(0.11 * s, eyeW, 14), sx * x, y, z); e.scale.set(1, eyeStyle === 'sleepy' ? 0.55 : 1.2, 0.6); at(p, ball(0.06 * s, eyeB, 10), sx * x * 0.95, y - 0.01, z + 0.05 * s).scale.set(1, eyeStyle === 'sleepy' ? 0.5 : 1.1, 1); at(p, ball(0.022 * s, shine, 6), sx * x * 0.9 - 0.02, y + 0.035, z + 0.085 * s);
      if (eyeStyle === 'angry') { const br = at(p, new THREE.Mesh(new THREE.BoxGeometry(0.2 * s, 0.04 * s, 0.04), eyeB), sx * x, y + 0.14 * s, z + 0.04); br.rotation.z = sx * -0.45; } }
    const m = at(p, new THREE.Mesh(new THREE.TorusGeometry(0.07 * s, 0.016 * s, 6, 14, Math.PI), mouthM), 0, y - 0.15 * s, z + 0.04); m.rotation.z = Math.PI;
    if (bit(4, 2) || stage) for (const sx of [-1, 1]) at(p, cone(0.018 * s, 0.05 * s, fang, 6), sx * 0.04 * s, y - 0.2 * s, z + 0.05).rotation.x = Math.PI;
  };
  // What tops the head: long ears, round ears, horns, a crest, or nothing.
  const topper = (p, y, sp = 0.17) => { const k = bit(5, 5); if (k === 0) for (const sx of [-1, 1]) { const e = at(p, cone(0.08, 0.48, body, 10), sx * sp, y + 0.25, -0.02); e.rotation.z = sx * -0.25; at(e, cone(0.045, 0.3, belly, 8), 0, -0.04, 0.03); }
    else if (k === 1) for (const sx of [-1, 1]) at(p, ball(0.12, body, 12), sx * (sp + 0.1), y + 0.12, 0);
    else if (k === 2 || stage >= 2) for (const sx of [-1, 1]) { const hn = at(p, cone(0.06, 0.35, accent, 8), sx * sp * 0.8, y + 0.2, 0.02); hn.rotation.z = sx * -0.35; }
    else if (k === 3) for (let i = 0; i < 3; i++) at(p, cone(0.06, 0.26 - i * 0.04, accent, 6), 0, y + 0.18, -0.12 * i).rotation.x = -0.4; };
  const tailOf = (p, x, y, z) => { const k = bit(6, 4), t = new THREE.Group(); t.position.set(x, y, z); p.add(t);
    if (k === 0) { const c = at(t, cone(0.08, 0.6, body, 8), 0, 0, -0.25); c.rotation.x = -1.2; }
    else if (k === 1) { at(t, ball(0.2, belly, 12), 0, 0.05, -0.15).scale.set(1, 1.2, 1.3); }
    else if (k === 2) { const lf = at(t, ball(0.22, toon([90, 200, 90]), 10), 0, 0.15, -0.3); lf.scale.set(0.35, 1.2, 1); }
    else { const fl = at(t, cone(0.12, 0.35, new THREE.MeshBasicMaterial({ color: 0xffa020 }), 8), 0, 0.25, -0.25); fl.userData.noOutline = true; at(t, cone(0.06, 0.2, new THREE.MeshBasicMaterial({ color: 0xfff060 }), 8), 0, 0.22, -0.22).userData.noOutline = true; }
    return t; };
  const spikes = (p, y, z0, n) => { for (let i = 0; i < n; i++) at(p, cone(0.07, 0.22, dark, 6), 0, y, z0 - i * 0.16).rotation.x = -0.5; };
  if (plan === 'baboon') { /* built below */ } else if (plan === 'blob') { const b = at(g, ball(0.62, body, 28), 0, 0.5, 0); b.scale.set(1.15, 0.85, 1); if (pat === 'belly') at(g, ball(0.45, belly, 20), 0, 0.42, 0.25).scale.set(1, 0.7, 0.6); parts.head = b; face(g, 0.22, 0.7, 0.5); topper(g, 0.85, 0.22); }
  else if (plan === 'biped') {
    for (const sx of [-1, 1]) parts.legs.push(at(g, ball(0.17, dark, 14), sx * 0.24, 0.12, 0.05));
    at(g, ball(0.42, body, 24), 0, 0.55, 0).scale.set(1, 1.05, 0.9); if (pat !== 'plain') at(g, ball(0.3, belly, 18), 0, 0.5, 0.18).scale.set(1, 1.1, 0.6);
    for (const sx of [-1, 1]) at(g, ball(0.12, body, 12), sx * 0.45, 0.6, 0.05).scale.set(0.8, 1.4, 0.8);
    const head = at(g, new THREE.Group(), 0, 1.15, 0.02); parts.head = head; at(head, ball(0.4, body, 24), 0, 0, 0); face(head, 0.16, 0.02, 0.33); topper(head, 0.3);
    parts.tail = tailOf(g, 0, 0.45, -0.35); if (stage) spikes(g, 0.85, -0.3, 2 + stage);
  } else if (plan === 'quad' || plan === 'dragon') {
    const b = at(g, ball(0.5, body, 24), 0, 0.6, -0.1); b.scale.set(0.95, 0.78, 1.4);
    for (const [x, z] of [[-0.3, 0.38], [0.3, 0.38], [-0.3, -0.5], [0.3, -0.5]]) { const l = at(g, new THREE.Group(), x, 0.42, z); at(l, cyl(0.11, 0.09, 0.42, dark, 10), 0, -0.21, 0); at(l, ball(0.11, dark, 8), 0, -0.42, 0.04).scale.set(1, 0.6, 1.3); parts.legs.push(l); }
    const head = at(g, new THREE.Group(), 0, 0.95, 0.62); parts.head = head; at(head, ball(0.33, body, 20), 0, 0, 0); at(head, ball(0.19, belly, 14), 0, -0.1, 0.22).scale.set(1.1, 0.8, 1);
    face(head, 0.14, 0.08, 0.26, 0.9); topper(head, 0.22, 0.15); parts.tail = tailOf(g, 0, 0.7, -0.75); spikes(g, 1.0, 0.2, 2 + stage * 2);
    // Dragon wings: three long finger bones with a membrane between them, folded back a little.
    if (plan === 'dragon') for (const sx of [-1, 1]) { const w = at(g, new THREE.Group(), sx * 0.32, 1.05, -0.15); w.rotation.y = sx * 0.4; for (let f = 0; f < 3; f++) { const bone = at(w, cyl(0.03, 0.015, 0.75 - f * 0.12, dark, 6), sx * (0.3 + f * 0.05), 0.25 - f * 0.12, -f * 0.12); bone.rotation.z = sx * (-1.0 + f * 0.35); } const mem = at(w, ball(0.45, toon(r[0], { side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), 14), sx * 0.42, 0.12, -0.12); mem.scale.set(1, 0.6, 0.06); mem.rotation.z = sx * -0.5; mem.userData.noOutline = true; parts.wings.push(w); }
  } else if (plan === 'bird') {
    at(g, ball(0.48, body, 24), 0, 0.72, 0); at(g, ball(0.32, belly, 18), 0, 0.64, 0.25).scale.set(1, 1.1, 0.6);
    face(g, 0.17, 0.88, 0.4); at(g, cone(0.08, 0.22, toon([255, 196, 60]), 8), 0, 0.76, 0.52).rotation.x = Math.PI / 2; topper(g, 1.0, 0.1);
    for (const sx of [-1, 1]) { const w = at(g, new THREE.Group(), sx * 0.42, 0.78, 0); for (let f = 0; f < 3; f++) { const fe = at(w, ball(0.28 - f * 0.05, f ? dark : body, 12), sx * (0.2 + f * 0.12), -f * 0.06, -f * 0.05); fe.scale.set(1.3, 0.22, 0.75); } parts.wings.push(w); }
    for (const sx of [-1, 1]) at(g, cyl(0.03, 0.03, 0.32, toon([255, 196, 60]), 6), sx * 0.15, 0.17, 0); parts.tail = tailOf(g, 0, 0.65, -0.4);
  } else if (plan === 'bug') {
    at(g, ball(0.4, dark, 20), 0, 0.42, -0.38).scale.set(1, 0.8, 1.25); const hd = at(g, ball(0.36, body, 20), 0, 0.56, 0.2); parts.head = hd;
    face(g, 0.15, 0.62, 0.5, 0.9);
    for (let k = 0; k < 3; k++) for (const sx of [-1, 1]) { const l = at(g, cyl(0.03, 0.02, 0.5, dark, 6), sx * 0.35, 0.2, -0.1 - k * 0.2); l.rotation.z = sx * 1.0; parts.legs.push(l); }
    for (const sx of [-1, 1]) { const a = at(g, cyl(0.016, 0.016, 0.42, dark, 6), sx * 0.12, 0.96, 0.3); a.rotation.z = sx * -0.4; at(a, ball(0.05, accent, 8), 0, 0.22, 0); }
    if (bit(7, 2)) for (const sx of [-1, 1]) { const w = at(g, new THREE.Group(), sx * 0.2, 0.75, -0.3); const m = at(w, ball(0.35, new THREE.MeshPhongMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.55, shininess: 120 }), 12), sx * 0.3, 0.1, 0); m.scale.set(1, 0.15, 0.6); m.userData.noOutline = true; parts.wings.push(w); }
  } else if (plan === 'fish') {
    const b = at(g, ball(0.5, body, 24), 0, 0.65, 0); b.scale.set(0.8, 0.9, 1.3); parts.head = b; face(g, 0.2, 0.75, 0.55);
    for (const sx of [-1, 1]) { const fin = at(g, cone(0.18, 0.4, accent, 3), sx * 0.42, 0.55, 0.1); fin.rotation.z = sx * 1.9; fin.scale.set(1, 1, 0.3); parts.wings.push(fin); }
    const top = at(g, cone(0.22, 0.5, accent, 3), 0, 1.15, -0.1); top.scale.set(0.3, 1, 1);
    const tl = at(g, new THREE.Group(), 0, 0.65, -0.65); at(tl, cone(0.3, 0.45, accent, 3), 0, 0, -0.15).rotation.x = -Math.PI / 2; parts.tail = tl; parts.float = true;
  } else if (plan === 'golem') {
    const torso = at(g, new THREE.Mesh(new THREE.DodecahedronGeometry(0.55), body), 0, 0.85, 0); torso.scale.set(1.1, 1, 0.85);
    for (const sx of [-1, 1]) { parts.legs.push(at(g, new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.32), dark), sx * 0.25, 0.22, 0)); const arm = at(g, new THREE.Mesh(new THREE.DodecahedronGeometry(0.22), dark), sx * 0.7, 0.75, 0.1); arm.scale.set(1, 1.6, 1); }
    const head = at(g, new THREE.Group(), 0, 1.45, 0.05); parts.head = head; at(head, new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.45), body), 0, 0, 0); face(head, 0.12, 0.02, 0.24, 0.85);
    for (let k = 0; k < 4 + stage * 2; k++) at(g, new THREE.Mesh(new THREE.OctahedronGeometry(0.1), accent), Math.cos(k * 1.7) * 0.45, 1.0 + Math.sin(k * 2.3) * 0.25, 0.35);
  } else if (plan === 'ghost') {
    const b = at(g, ball(0.5, body, 24), 0, 0.95, 0); b.scale.set(1, 1.1, 0.9); parts.head = b; face(g, 0.18, 1.02, 0.42);
    for (let k = 0; k < 5; k++) at(g, cone(0.14, 0.4, body, 8), Math.cos(k * 1.26) * 0.32, 0.45, Math.sin(k * 1.26) * 0.28).rotation.x = Math.PI;
    for (const sx of [-1, 1]) { const arm = at(g, ball(0.12, body, 10), sx * 0.55, 0.95, 0.1); arm.scale.set(1.4, 0.7, 0.7); parts.wings.push(arm); } parts.float = true;
  } else if (plan === 'sprout') {
    const pot = at(g, cyl(0.38, 0.3, 0.45, dark, 16), 0, 0.22, 0); const b = at(g, ball(0.42, body, 22), 0, 0.72, 0); parts.head = b; face(g, 0.17, 0.75, 0.36);
    for (let k = 0; k < 3; k++) { const lf = at(g, ball(0.25, toon([90, 200, 90]), 10), Math.cos(k * 2.1) * 0.2, 1.25, Math.sin(k * 2.1) * 0.2); lf.scale.set(0.35, 1.2, 1); lf.rotation.z = Math.cos(k * 2.1) * 0.6; parts.wings.push(lf); }
    if (bit(8, 2)) at(g, ball(0.12, toon([255, 120, 180]), 10), 0, 1.5, 0);
  } else {
    for (let k = 0; k < 11; k++) { const a = k / 11 * Math.PI * 1.7; at(g, ball(0.21 - k * 0.006, k % 2 ? body : dark, 14), Math.cos(a) * 0.45, 0.18 + k * 0.025, Math.sin(a) * 0.45 - 0.1); }
    const head = at(g, new THREE.Group(), 0.45, 0.9, 0.15); parts.head = head; at(head, ball(0.3, body, 20), 0, 0, 0).scale.set(1, 0.85, 1.2); face(head, 0.12, 0.08, 0.3, 0.85); topper(head, 0.18, 0.12);
  }
  if (plan === 'baboon') {
    // SPIDER-CHEEKS, Mr Fister's baboon: olive fur, a darker shaggy mane over the shoulders, a long pink muzzle under a
    // heavy brow, small amber eyes set close, long spindly arms down to its knuckles, a hooked tail -- and the red behind.
    const fur = toon([138, 130, 92]), mane = toon([96, 88, 60]), skin = toon([214, 150, 150]), red = toon([226, 48, 58]), dk = toon([40, 34, 30]);
    const torso = at(g, ball(0.44, fur, 22), 0, 0.8, -0.1); torso.scale.set(1, 1.1, 0.95); torso.rotation.x = 0.4;
    at(g, ball(0.3, toon([170, 160, 118]), 16), 0, 0.72, 0.18).scale.set(1, 1.2, 0.6); // a paler chest
    // The mane: a shaggy cape over the shoulders, longer at the back.
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, back = Math.max(0, -Math.sin(a)), sp = at(g, cone(0.15, 0.48 + back * 0.3, mane, 6), Math.cos(a) * 0.4, 1.2 - back * 0.1, Math.sin(a) * 0.34 - 0.02); sp.rotation.set(Math.PI + Math.sin(a) * (0.9 + back * 0.4), 0, -Math.cos(a) * 1.05); }
    at(g, ball(0.4, mane, 18), 0, 1.24, -0.04).scale.set(1.15, 0.55, 1.05);
    for (const sx of [-1, 1]) { at(g, ball(0.25, fur, 14), sx * 0.3, 0.3, -0.12).scale.set(1, 0.8, 1.35); at(g, ball(0.16, red, 14), sx * 0.12, 0.4, -0.5).scale.set(1, 1.1, 0.8); } // haunches, the red behind
    // Long spindly arms: the upper arm out from the shoulder, an elbow, the forearm down to the knuckles.
    for (const sx of [-1, 1]) { const arm = at(g, new THREE.Group(), sx * 0.42, 1.12, 0.16); const up = at(arm, cyl(0.065, 0.055, 0.55, fur, 8), sx * 0.12, -0.25, 0.04); up.rotation.z = sx * 0.45; at(arm, ball(0.07, fur, 8), sx * 0.24, -0.5, 0.08); const fore = at(arm, cyl(0.05, 0.045, 0.6, fur, 8), sx * 0.22, -0.8, 0.14); fore.rotation.set(-0.15, 0, -sx * 0.08); at(arm, ball(0.085, dk, 10), sx * 0.2, -1.1, 0.2).scale.set(1.25, 0.6, 1.5); parts.legs.push(arm); }
    // The head, pushed forward: a heavy brow, small amber eyes set close, the long muzzle sloping down to the nose.
    const head = at(g, new THREE.Group(), 0, 1.5, 0.3); parts.head = head;
    at(head, ball(0.24, fur, 18), 0, 0, 0).scale.set(1, 0.95, 0.95);
    const face = toon([120, 92, 92]); at(head, ball(0.17, face, 14), 0, -0.02, 0.12).scale.set(1, 0.9, 0.8);
    const muz = at(head, cyl(0.07, 0.12, 0.42, skin, 14), 0, -0.12, 0.33); muz.rotation.x = Math.PI / 2 + 0.35; at(head, ball(0.075, toon([70, 52, 52]), 10), 0, -0.2, 0.53).scale.set(1, 0.8, 0.9);
    for (const sx of [-1, 1]) at(head, ball(0.016, dk, 6), sx * 0.03, -0.17, 0.59);
    at(head, cyl(0.06, 0.06, 0.012, dk, 8), 0, -0.27, 0.42).rotation.x = Math.PI / 2;
    const brow = at(head, new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.1), dk), 0, 0.07, 0.19); brow.rotation.x = -0.25;
    const amber = new THREE.MeshBasicMaterial({ color: 0xffb020 }); for (const sx of [-1, 1]) { at(head, ball(0.035, amber, 10), sx * 0.07, 0.01, 0.23); at(head, ball(0.018, eyeB, 8), sx * 0.07, 0.01, 0.255); at(head, ball(0.06, fur, 10), sx * 0.23, 0.03, -0.02).scale.set(0.5, 1, 1); }
    // The tail: up off the back and hooked over.
    const tl = at(g, new THREE.Group(), 0, 0.45, -0.55); parts.tail = tl; for (let k = 0; k < 8; k++) { const a = k / 7 * 2.4; at(tl, ball(0.075 - k * 0.005, fur, 8), 0, Math.sin(a) * 0.45 + k * 0.03, -0.12 - (1 - Math.cos(a)) * 0.22); }
  }
  if (stage) g.scale.setScalar(1 + 0.12 * stage);
  if (stage >= 2) for (const sx of [-1, 1]) at(g, new THREE.Mesh(new THREE.OctahedronGeometry(0.12), accent), sx * 0.42, 0.95, 0.12); // armour studs at the last stage
  if (/FOIL|HOLO/.test(nm)) g.traverse(o => { if (o.material?.isMeshToonMaterial) o.material.emissive = new THREE.Color(0x222244); });
  outline(g);
  const outer = new THREE.Group(); outer.add(g); // the bob is the inner group's, so placing and fainting move the outer one
  outer.userData = { parts, plan, tick(t) { const p = parts; g.position.y = (p.float ? 0.25 + Math.sin(t * 1.8) * 0.12 : Math.abs(Math.sin(t * 2.2)) * 0.04); if (p.head) p.head.rotation.y = Math.sin(t * 1.3) * 0.15; p.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 4 + i) * 0.1; }); p.wings.forEach((w, i) => { w.rotation.z = (i % 2 ? -1 : 1) * Math.sin(t * 7) * 0.35; }); if (p.tail) p.tail.rotation.y = Math.sin(t * 3) * 0.4; } };
  return outer;
}

export function createBattle3D(canvas, { scale = 3 } = {}) {
  const W = 240, H = 160; canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d'), gl = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas: gl, antialias: true, alpha: false, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.setSize(W * scale, 106 * scale, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fd6ff); scene.fog = new THREE.Fog(0x9fd6ff, 9, 20);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6fae4a, 1.2)); const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(-3, 6, 4); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(36, W / 106, 0.1, 60); cam.position.set(-0.4, 1.5, 5.6); cam.lookAt(0.9, 0.6, -1.4);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: 0x8ccf6a })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const pads = [], pad = (x, z, rad) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.05, 0.12, 40), new THREE.MeshLambertMaterial({ color: 0x5fa845 })); p.position.set(x, 0.06, z); scene.add(p); const rim = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.04, 6, 40), new THREE.MeshLambertMaterial({ color: 0x3c7a2a })); rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.12, z); scene.add(rim); pads.push([p, rim]); return p; };
  const trees = new THREE.Group(); scene.add(trees);
  pad(2.3, -2.2, 1.1); pad(-1.5, 1.7, 1.2);
  for (let k = 0; k < 7; k++) { const tr = new THREE.Group(); tr.position.set(-6 + k * 2.3, 0, -8 - (k % 3)); trees.add(tr); const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 8), new THREE.MeshLambertMaterial({ color: 0x6b4a2a })); tk.position.y = 0.6; tr.add(tk); const lf = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 9), new THREE.MeshLambertMaterial({ color: 0x3f8f3a })); lf.position.y = 1.7; tr.add(lf); }
  let b = null, mineM = null, foeM = null, mineName = '', foeName = '', moves = DEFAULT_MOVES, pick = 0, msg = '', anim = null, foeAnim = null, evo = null, raf = 0, last = 0, key = '', introAt = -1e9, lastTenth = 10, foeHits = 0, shownFoe = 1;
  const shot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 9), new THREE.MeshBasicMaterial({ color: 0xffe14a })); shot.visible = false; scene.add(shot);
  // MR FISTER'S GYM IN 3D (store, 2026-11-14): on a gym fight against him, the field turns into his arena -- a dark floor,
  // a green ring under each platform, green spotlights -- and he stands behind SPIDER-CHEEKS pumping the gauntlet, throwing the
  // store's comics (the gauntlet's covers) at your beast every time his beast attacks.
  const arena = new THREE.Group(); arena.visible = false; scene.add(arena);
  { const fl = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshLambertMaterial({ color: 0x15201a })); fl.rotation.x = -Math.PI / 2; fl.position.y = 0.005; arena.add(fl);
    for (const [x, z, rr] of [[2.3, -2.2, 1.35], [-1.5, 1.7, 1.45]]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.05, 8, 48), new THREE.MeshBasicMaterial({ color: 0x39ff14 })); ring.rotation.x = Math.PI / 2; ring.position.set(x, 0.14, z); arena.add(ring); }
    for (const x of [-4, 6]) { const beam = new THREE.Mesh(new THREE.ConeGeometry(1.6, 8, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })); beam.position.set(x, 4, -5); beam.rotation.z = x < 0 ? -0.35 : 0.35; arena.add(beam); } }
  let fister = null, fisterTick = null, thrown = [];
  // THE OTHER FOUR LEADERS (scripts/beasts-gyms-3d.mjs): each in their own arena, built the first time they're fought.
  const leaders = {}, arenas = {}; let fx = [], gymId = '';
  const ensureLeader = id => { if (leaders[id] || !buildLeader3D) return; const l = buildLeader3D(id); if (!l) return; l.g.position.set(4.9, 0, -5.0); l.g.rotation.y = -0.5; l.g.scale.setScalar(1.3); scene.add(l.g); leaders[id] = l; const key = new THREE.SpotLight(0xffffff, 1.8, 14, 0.5, 0.6); key.position.set(2, 6, 1); key.target = l.g; scene.add(key); l.key = key; const ar = buildArena3D(id); scene.add(ar); arenas[id] = ar; };
  const signature = () => { const l = leaders[gymId]; if (!l || !mineM) return; const from = new THREE.Vector3(); (l.hand || l.g).getWorldPosition(from); fx.push(signatureFx(gymId, scene, from, mineM.position.clone())); };
  const ensureFister = () => { if (fister) return; fister = new THREE.Group(); const root = new THREE.Group(); fister.add(root); fisterTick = buildBoss3D('fister', root).tick; fister.position.set(4.75, 1.62, -3.9); fister.rotation.y = -0.6; fister.scale.setScalar(1.05); scene.add(fister); const lamp = new THREE.PointLight(0x7dff5a, 2.5, 6); lamp.position.set(3.2, 2.5, -2.5); fister.add(lamp); const key = new THREE.SpotLight(0xffffff, 2.2, 14, 0.5, 0.5); key.position.set(1.5, 6, 2); key.target = fister; scene.add(key); };
  const throwComics = () => { if (!fister || !mineM) return; const tex = fisterCoverTextures(); for (let k = 0; k < 4; k++) { const card = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.62), new THREE.MeshBasicMaterial({ map: tex[k % Math.max(1, tex.length)] || null, color: tex.length ? 0xffffff : 0x39ff14, side: THREE.DoubleSide })); card.position.set(4.0, 4.0, -3.1); card.userData = { at: performance.now() + k * 160, from: card.position.clone(), k }; scene.add(card); thrown.push(card); } };
  const place = (name, mine) => { const m = buildBeast3D(name); if (mine) { m.position.set(-1.5, 0.12, 1.7); m.rotation.y = 2.5; m.scale.setScalar(0.95); } else { m.position.set(2.3, 0.12, -2.2); m.rotation.y = -0.55; m.scale.setScalar(1.15); } scene.add(m); return m; };
  const say = (t, ms = 2600) => { msg = t; clearTimeout(say.t); say.t = setTimeout(() => { msg = ''; }, ms); };
  function ui() {
    const S = scale, f = (s, x, y, size = 6, c = '#202830') => { ctx.fillStyle = c; ctx.font = `${size * S}px "Press Start 2P", monospace`; ctx.fillText(s, x * S, y * S); };
    const box = (x, y, w, hh, name, hp, lv) => { ctx.fillStyle = '#f8f8f8ee'; ctx.strokeStyle = '#202830'; ctx.lineWidth = 2 * S; ctx.beginPath(); ctx.roundRect(x * S, y * S, w * S, hh * S, 6 * S); ctx.fill(); ctx.stroke(); f(name.slice(0, lv ? 11 : 13), x + 6, y + 11, 6); if (lv) f('L' + lv, x + w - 26, y + 11, 6); ctx.fillStyle = '#3a4250'; ctx.fillRect((x + 20) * S, (y + 16) * S, (w - 28) * S, 5 * S); ctx.fillStyle = hp < 0.25 ? '#e84a3a' : hp < 0.5 ? '#f2c230' : '#3ccf5a'; ctx.fillRect((x + 21) * S, (y + 17) * S, Math.max(0, (w - 30) * hp) * S, 3 * S); f('HP', x + 6, y + 21, 5); };
    if (b) { box(6, 6, 104, 26, b.foe.name, Math.max(0, shownFoe)); box(130, 72, 104, 28, b.mine.name, b.mine.hp, b.mine.level || 1); }
    // The DS-style touch panel: the line of text, then the four moves as big rounded buttons.
    ctx.fillStyle = '#2a3240'; ctx.fillRect(0, 106 * S, W * S, 54 * S);
    const introT = (performance.now() - introAt) / 2400;
    f(msg || (b && b.kind === 'rival' && introT < 1 ? b.trainer.slice(0, 22) + (b.rematch ? ' WANTS A REMATCH!' : ' WANTS TO BATTLE!') : b && b.kind === 'wild' && b.night && introT < 1 ? '🌙 A NIGHT-ONLY ' + b.foe.name.slice(0, 12) + '!' : '') || (b ? (b.mine.hp <= 0 ? b.mine.name.slice(0, 10) + ' FAINTED! CHAT: FOLLOW/SHARE TO REVIVE' : b.kind === 'rival' ? b.trainer.slice(0, 22) + ' SENT OUT ' + b.foe.name.slice(0, 13) + '!' : 'WHAT WILL ' + b.mine.name + ' DO?') : ''), 8, 117, 6, '#f8f8f8');
    moves.forEach((m, i) => { const x = 6 + (i % 2) * 116, y = 122 + Math.floor(i / 2) * 18, on = i === pick; ctx.fillStyle = on ? '#ffd84a' : '#4d6fbf'; ctx.beginPath(); ctx.roundRect(x * S, y * S, 112 * S, 15 * S, 5 * S); ctx.fill(); f((i + 1) + ' ' + m, x + 6, y + 10, 6, on ? '#202830' : '#ffffff'); });
  }
  function frame(now) {
    raf = requestAnimationFrame(frame); if (now - last < 33) return; last = now; const t = now / 1000;
    if (mineM) mineM.userData.tick(t); if (foeM) foeM.userData.tick(t + 1.3);
    // Intro: the foe drops in, yours slides in.
    const it = Math.min(1, (now - introAt) / 1600), landing = now - introAt < 3200; if (foeM && landing) { foeM.position.y = 0.12 + Math.max(0, 1 - it * 1.6) * 3; } if (mineM && landing) mineM.position.x = -1.5 - Math.max(0, 1 - it * 1.3) * 3; // (keeps setting the landing spot a while, so a slow frame never leaves one in the air)
    // Attacks: a glowing shot from one to the other, the one hit flashing and shaking.
    const a = anim ? (now - anim.at) / 1200 : -1, fa = foeAnim ? (now - foeAnim.at) / 1200 : -1;
    shot.visible = false;
    if (a >= 0 && a < 0.6 && mineM && foeM) { shot.visible = true; shot.position.lerpVectors(mineM.position, foeM.position, a / 0.6).add(new THREE.Vector3(0, 0.8 + Math.sin(a / 0.6 * Math.PI) * 0.8, 0)); }
    if (fa >= 0 && fa < 0.6 && mineM && foeM && !foeAnim?.sig) { shot.visible = true; shot.position.lerpVectors(foeM.position, mineM.position, fa / 0.6).add(new THREE.Vector3(0, 0.8 + Math.sin(fa / 0.6 * Math.PI) * 0.6, 0)); }
    // Mr Fister: pumping the gauntlet; his thrown comics turning end over end on their way to your beast.
    if (fister && fister.visible) fisterTick?.(t);
    for (const id in leaders) if (leaders[id].g.visible) { leaders[id].tick(t); arenas[id].userData.tick(t); }
    fx = fx.filter(e => e.update(now));
    thrown = thrown.filter(card => { const k = (now - card.userData.at) / 900; if (k < 0) { card.visible = false; return true; } card.visible = true; if (k >= 1) { scene.remove(card); return false; } const to = mineM ? mineM.position.clone().add(new THREE.Vector3(0, 0.8, 0)) : new THREE.Vector3(); card.position.lerpVectors(card.userData.from, to, k).add(new THREE.Vector3(Math.sin(card.userData.k * 2) * 0.6 * Math.sin(k * Math.PI), Math.sin(k * Math.PI) * 1.2, 0)); card.rotation.set(k * 9 + card.userData.k, k * 7, k * 5); return true; });
    if (foeM) foeM.rotation.z = a > 0.55 && a < 0.9 ? Math.sin(now / 20) * 0.15 : 0; if (mineM) mineM.rotation.z = fa > 0.55 && fa < 0.9 ? Math.sin(now / 20) * 0.15 : 0;
    if (a >= 1) anim = null; if (fa >= 1) foeAnim = null;
    // Fainted: yours sinks; the foe's HP knocked to nothing: theirs sinks.
    if (mineM && b && b.mine.hp <= 0) mineM.position.y = Math.max(-1.6, mineM.position.y - 0.04);
    shownFoe += ((b?.foe.hp ?? 1) - shownFoe) * 0.12; if (foeM && shownFoe <= 0.003) foeM.position.y = Math.max(-1.6, foeM.position.y - 0.04);
    // Evolving: the old and new flicker faster and faster, a white flash, then the new one.
    if (evo) { const et = (now - evo.at) / 3200; if (et >= 1.2) evo = null; else if (mineM) { const flick = Math.floor((now - evo.at) / Math.max(40, 220 * (1 - et))) % 2; mineM.visible = et < 1 ? true : true; mineM.traverse(o => { if (o.material?.emissive) o.material.emissive.setRGB(flick && et < 1 ? 1 : 0, flick && et < 1 ? 1 : 0, flick && et < 1 ? 1 : 0); }); } }
    r.render(scene, cam); ctx.drawImage(gl, 0, 0); ui();
  }
  return {
    set(next, { moves: mv, pick: p } = {}) {
      const k = next ? next.kind + '|' + next.foe.name : '';
      if (k && k !== key) { introAt = performance.now(); shownFoe = next.foe.hp; lastTenth = Math.ceil((next.mine?.hp ?? 1) * 10); if (next.trainer === 'MR FISTER') setTimeout(() => throwComics(), 2200); else if (next.gym) setTimeout(() => { if (b === next || (b && b.trainer === next.trainer)) signature(); }, 2300); } // they open with their signature move
      if (next && b && k === key) { const tenth = Math.ceil((next.mine?.hp ?? 1) * 10); if (tenth < lastTenth && performance.now() - introAt > 1600) { const gm = gymMoveFor(next.trainer, foeHits), m = gm || foeMoveFor(next.foe.name, foeHits); foeHits++; const sig = !!next.gym && next.trainer !== 'MR FISTER' && gm === gymOf(next.trainer).moves[0]; foeAnim = { kind: moveAnim(m), at: performance.now(), sig }; if (next.trainer === 'MR FISTER') throwComics(); else if (sig) signature(); say((next.kind === 'wild' ? 'WILD ' : 'FOE ') + next.foe.name.slice(0, 10) + ' USED ' + m + '!'); } lastTenth = tenth; }
      key = k; b = next; if (mv) moves = mv; if (Number.isInteger(p)) pick = p;
      gymId = b && b.kind === 'rival' ? (b.gym || (b.trainer === 'MR FISTER' ? 'fister' : '')) : '';
      const gym = gymId === 'fister'; if (gym) ensureFister(); if (fister) fister.visible = gym; arena.visible = gym;
      if (gymId && !gym) ensureLeader(gymId); for (const id in leaders) { const on = id === gymId; leaders[id].g.visible = on; leaders[id].key.visible = on; arenas[id].visible = on; }
      const cfg = gymId && !gym ? arenas[gymId]?.userData : null; ground.visible = !gymId; trees.visible = !gymId;
      for (const [p, rim] of pads) { p.material.color.set(cfg ? cfg.pad : 0x5fa845); rim.material.color.set(cfg ? cfg.rim : 0x3c7a2a); }
      const sky = cfg ? cfg.sky : gym ? 0x0b1410 : 0x9fd6ff; scene.background = new THREE.Color(sky); scene.fog = new THREE.Fog(sky, cfg ? cfg.fog[0] : 9, cfg ? cfg.fog[1] : 20);
      if (b && b.mine.name !== mineName) { if (mineM) scene.remove(mineM); mineName = b.mine.name; mineM = place(mineName, true); }
      if (b && b.foe.name !== foeName) { if (foeM) scene.remove(foeM); foeName = b.foe.name; foeM = place(foeName, false); }
      if (!b) { if (mineM) scene.remove(mineM); if (foeM) scene.remove(foeM); mineM = foeM = null; mineName = foeName = ''; }
    },
    attack(name) { const i = moves.indexOf(String(name).toUpperCase()); if (i >= 0) pick = i; anim = { kind: moveAnim(name), at: performance.now() }; say((b?.mine?.name || STARTER) + ' USED ' + String(name).toUpperCase() + '!'); },
    evolve(from, to) { evo = { at: performance.now() }; say('WHAT? ' + String(from).toUpperCase().slice(0, 11) + ' IS EVOLVING!', 3300); setTimeout(() => say(String(from).toUpperCase().slice(0, 10) + ' EVOLVED INTO ' + String(to).toUpperCase().slice(0, 11) + '!', 3500), 3300); },
    levelUp(name, level) { say(String(name).slice(0, 11) + ' GREW TO LV ' + level + '!'); },
    setRival() {},
    start() { if (!raf) raf = requestAnimationFrame(frame); }, stop() { cancelAnimationFrame(raf); raf = 0; },
  };
}

// ── THE ROUTE IN 3D (store, 2026-11-14: "full 3D route for 3DS mode") ─────────────────────────────────────────────
// The same route (routeFor: the same tiles, the same items, the same walk) built in 3D: the ground in its colours, real
// trees, houses with roofs, water, boulders, snow, lava, lamps and gravestones; the host and Champ as little 3D people,
// your beast following in 3D, the route's items and chat's gifts bobbing on the path; the camera over your shoulder,
// tilted like the handhelds. Drawn into the same 2D canvas the flat route uses (so the screens don't change).
import { routeFor, posAt, walkAt, ENCOUNTERS, TILE_RAMPS, timeOfDay, MAP_W, MAP_H } from './beasts.mjs?v=18';
const SKY = { day: [0x8fd0ff, 0xd8f0ff], sunset: [0xf2a46a, 0xffd9b0], night: [0x1a2350, 0x3a4a80] };
function person(shirt, cap) {
  const g = new THREE.Group(), skin = mat([242, 184, 146]);
  for (const sx of [-1, 1]) at(g, cyl(0.07, 0.06, 0.3, mat([40, 46, 70])), sx * 0.09, 0.15, 0);
  at(g, cyl(0.17, 0.14, 0.36, mat(shirt)), 0, 0.48, 0);
  const head = at(g, ball(0.2, skin, 16), 0, 0.84, 0);
  if (cap) { const c = at(g, new THREE.Mesh(new THREE.SphereGeometry(0.205, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(cap)), 0, 0.86, 0); at(g, new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.16), mat(cap)), 0, 0.88, -0.2); }
  at(g, new THREE.Mesh(new THREE.SphereGeometry(0.205, 16, 8, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), mat([60, 40, 30])), 0, 0.84, 0); // the beard
  for (const sx of [-1, 1]) at(g, ball(0.025, mat([20, 20, 28]), 6), sx * 0.07, 0.88, 0.18);
  g.userData.legs = g.children.slice(0, 2); g.userData.head = head; return g;
}
export function createWorld3D(canvas, { w = 240, h = 189 } = {}) {
  const S = 2; canvas.width = w * S; canvas.height = h * S;
  const ctx = canvas.getContext('2d'), gl = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas: gl, antialias: true, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.setSize(w * S, h * S, false);
  const scene = new THREE.Scene(), hemi = new THREE.HemisphereLight(0xffffff, 0x6fae4a, 1.15), sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(-6, 12, 8); scene.add(hemi, sun);
  const cam = new THREE.PerspectiveCamera(42, w / h, 0.1, 80);
  let routeG = null, route = null, state = { floor: 1, pct: 0, phase: 'floor' }, area = '', shown = 0, first = true, raf = 0, last = 0, follower = '', followerM = null, drops = [], tod = null, dropG = new THREE.Group(), itemG = new THREE.Group();
  scene.add(dropG, itemG);
  const host = person([58, 90, 176], [30, 40, 60]), champ = person([226, 226, 232], null); scene.add(host, champ);
  const tile = (x, y) => new THREE.Vector3(x + 0.5 - MAP_W / 2, 0, y + 0.5);
  // THE SCENERY (store, 2026-11-14: "now the paths and scenery!"): dirt paths with stone edging (cobbles in the city, packed
  // snow, gravel in the cave), wooden bridges with rails, rippling water, each area's own trees (round trees and pines,
  // dense woods with mushrooms, snowy pines, palms on the beach, bare dead trees in the graveyard and the volcano, trees
  // in planters in the city), tall grass in three greens, flowers in four colours, mossy boulders, gabled houses with
  // windows and chimneys, fences, signs, lamps that glow at night, gravestones and crosses, lava that pulses with smoke
  // rising, cave walls with torches, beach umbrellas, mountains on the skyline and clouds drifting over. All placed from the
  // route's tiles and the tile's own number (the same route looks the same every time; nothing by chance).
  let water = null, lavaM = null, smoke = [], clouds = [], glows = [];
  const fixedOf = (x, y, k = 0) => ((Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453) % 1 + 1) % 1;
  function waveTex() { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#3a8ae0'; x.fillRect(0, 0, 64, 64); x.strokeStyle = '#9fd6ff'; x.lineWidth = 2; for (let y = 6; y < 64; y += 14) { x.beginPath(); for (let xx = 0; xx <= 64; xx += 4) x.lineTo(xx, y + Math.sin(xx / 64 * Math.PI * 4) * 2.5); x.stroke(); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; }
  function build() {
    if (routeG) scene.remove(routeG); routeG = new THREE.Group(); scene.add(routeG); smoke = []; clouds = []; glows = [];
    const g = route.grid, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
    const bio = y => route.biomeAt(y) || 'meadow', kinds = {}, at2 = (x, y) => g[y]?.[x];
    const groundColor = (t, b) => t === 1 ? (b === 'city' ? [104, 104, 116] : b === 'snow' ? [196, 210, 228] : b === 'cave' ? [128, 112, 94] : b === 'volcano' ? [58, 46, 42] : b === 'beach' ? [156, 112, 70] : [214, 186, 132])
      : t === 14 ? [240, 216, 150] : t === 19 ? [244, 248, 255] : t === 20 ? [176, 176, 184] : t === 18 ? [106, 92, 76] : t === 24 ? [90, 64, 52] : t === 17 ? [96, 82, 70]
      : b === 'snow' ? [236, 242, 250] : b === 'beach' ? [232, 210, 150] : b === 'cave' ? [106, 92, 76] : b === 'volcano' ? [90, 64, 52] : b === 'city' ? [176, 176, 184] : b === 'graveyard' ? [96, 132, 82] : b === 'woods' ? [84, 150, 70] : [124, 200, 88];
    // The ground: a block a tile, its own shade of its colour.
    const n = MAP_W * MAP_H, ground = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.2, 1), new THREE.MeshLambertMaterial(), n); let i = 0;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const t = g[y][x], b = bio(y), p = tile(x, y), cliff = t === 17, low = t === 4 || t === 23, ledge = t === 16;
      m4.compose(v3.set(p.x, (low ? -0.25 : ledge ? 0.05 : t === 1 ? -0.04 : 0) - 0.1 + (cliff ? 0.7 : 0), p.z), q.identity(), sc.set(1, cliff ? 8 : 1, 1)); ground.setMatrixAt(i, m4);
      const gc = groundColor(t === 3 || t === 9 || t === 10 || t === 13 || t === 2 || t === 21 || t === 22 || t === 8 ? 0 : t, b), j = 0.92 + fixedOf(x, y) * 0.14;
      ground.setColorAt(i++, c.setRGB(gc[0] / 255 * j, gc[1] / 255 * j, gc[2] / 255 * j)); (kinds[t] ||= []).push({ p, x, y, b });
    }
    ground.instanceMatrix.needsUpdate = true; ground.instanceColor.needsUpdate = true; routeG.add(ground);
    const inst = (list, geo, material, f) => { if (!list?.length) return null; const m = new THREE.InstancedMesh(geo, material, list.length); list.forEach((o, k) => { f(m4, o, k); m.setMatrixAt(k, m4); }); m.instanceMatrix.needsUpdate = true; routeG.add(m); return m; };
    const put = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => m4.compose(v3.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), sc.set(sx, sy, sz));
    // PATH EDGING: small stones along each side of the path where it meets something else.
    const edges = []; for (const o of kinds[1] || []) for (const [dx, dy, rot] of [[1, 0, 0], [-1, 0, 0], [0, 1, 1], [0, -1, 1]]) { const nt = at2(o.x + dx, o.y + dy); if (nt !== 1 && nt !== 15 && nt !== undefined) for (let k = -1; k <= 1; k++) edges.push({ p: o.p, dx, dy, k, rot, b: o.b }); }
    inst(edges, new THREE.DodecahedronGeometry(0.09), mat([150, 140, 126]), (m, o) => put(o.p.x + o.dx * 0.47 + (o.rot ? o.k * 0.3 : 0), 0.02, o.p.z + o.dy * 0.47 + (o.rot ? 0 : o.k * 0.3), 1, 0.6, 1, o.k));
    // City cobbles: dark seams across the paving.
    inst((kinds[1] || []).filter(o => o.b === 'city'), new THREE.BoxGeometry(0.96, 0.02, 0.04), mat([70, 70, 80]), (m, o) => put(o.p.x, 0.065, o.p.z));
    // The beach's boardwalk: plank seams.
    const planks = []; for (const o of (kinds[1] || []).filter(o2 => o2.b === 'beach')) for (let k = -2; k <= 2; k++) planks.push({ o, k });
    inst(planks, new THREE.BoxGeometry(0.98, 0.02, 0.025), mat([110, 76, 44]), (m, pl) => put(pl.o.p.x, 0.065, pl.o.p.z + pl.k * 0.2));
    // BRIDGES: planks and rails.
    inst(kinds[15], new THREE.BoxGeometry(1, 0.1, 0.9), mat([168, 118, 70]), (m, o) => put(o.p.x, 0.02, o.p.z));
    const bridgeSides = []; for (const o of kinds[15] || []) for (const s2 of [-1, 1]) bridgeSides.push({ o, s2 });
    inst(bridgeSides, new THREE.BoxGeometry(0.08, 0.45, 0.08), mat([120, 80, 44]), (m, b2) => put(b2.o.p.x, 0.25, b2.o.p.z + b2.s2 * 0.45));
    inst(bridgeSides, new THREE.BoxGeometry(1, 0.06, 0.06), mat([140, 96, 54]), (m, b2) => put(b2.o.p.x, 0.42, b2.o.p.z + b2.s2 * 0.45));
    // WATER: one sheet with ripples that drift.
    const wTex = waveTex(); water = inst(kinds[4], new THREE.BoxGeometry(1, 0.05, 1), new THREE.MeshPhongMaterial({ map: wTex, transparent: true, opacity: 0.88, shininess: 140, specular: 0xffffff }), (m, o) => put(o.p.x, -0.1, o.p.z)); if (water) water.userData.tex = wTex;
    // TREES, by area.
    const trees = { round: [], pine: [], snowpine: [], palm: [], dead: [], planter: [] };
    for (const o of kinds[3] || []) { const b = o.b, f = fixedOf(o.x, o.y, 1); (b === 'snow' ? trees.snowpine : b === 'beach' ? trees.palm : b === 'graveyard' || b === 'volcano' ? trees.dead : b === 'city' ? trees.planter : b === 'woods' ? (f < 0.7 ? trees.pine : trees.round) : (f < 0.35 ? trees.pine : trees.round)).push(o); }
    const hgt = o => 0.85 + fixedOf(o.x, o.y, 2) * 0.4;
    inst([...trees.round, ...trees.pine, ...trees.snowpine], new THREE.CylinderGeometry(0.07, 0.12, 0.6, 7), mat([112, 76, 44]), (m, o) => put(o.p.x, 0.3, o.p.z, 1, hgt(o), 1));
    inst(trees.round, new THREE.IcosahedronGeometry(0.42, 1), mat([64, 150, 62]), (m, o) => put(o.p.x, 0.85 * hgt(o), o.p.z, 1, 0.95, 1, o.x));
    inst(trees.round, new THREE.IcosahedronGeometry(0.3, 1), mat([88, 176, 74]), (m, o) => put(o.p.x + 0.12, 1.15 * hgt(o), o.p.z + 0.08, 1, 1, 1, o.y));
    for (const [list, col2] of [[trees.pine, [38, 112, 60]], [trees.snowpine, [40, 100, 70]]]) { inst(list, new THREE.ConeGeometry(0.45, 0.8, 8), mat(col2), (m, o) => put(o.p.x, 0.75 * hgt(o), o.p.z, 1, hgt(o), 1)); inst(list, new THREE.ConeGeometry(0.33, 0.6, 8), mat(col2), (m, o) => put(o.p.x, 1.15 * hgt(o), o.p.z, 1, hgt(o), 1)); }
    inst(trees.snowpine, new THREE.ConeGeometry(0.25, 0.32, 8), mat([250, 252, 255]), (m, o) => put(o.p.x, 1.48 * hgt(o), o.p.z));
    inst(trees.snowpine, new THREE.ConeGeometry(0.46, 0.12, 8), mat([250, 252, 255]), (m, o) => put(o.p.x, 0.62 * hgt(o), o.p.z));
    // Palms: a leaning trunk, fronds.
    inst(trees.palm, new THREE.CylinderGeometry(0.06, 0.1, 1.5, 7), mat([156, 116, 70]), (m, o) => put(o.p.x + 0.12, 0.72, o.p.z, 1, 1, 1, 0, 0, -0.18));
    const fronds = []; for (const o of trees.palm) for (let k = 0; k < 6; k++) fronds.push({ o, k });
    inst(fronds, new THREE.ConeGeometry(0.1, 0.8, 4), mat([60, 160, 70]), (m, f2) => put(f2.o.p.x + 0.26 + Math.cos(f2.k * 1.05) * 0.3, 1.42, f2.o.p.z + Math.sin(f2.k * 1.05) * 0.3, 1, 1, 0.3, -f2.k * 1.05, 0, 1.3));
    // Dead trees: a bare trunk, two crooked branches.
    inst(trees.dead, new THREE.CylinderGeometry(0.05, 0.1, 1.2, 6), mat([70, 60, 56]), (m, o) => put(o.p.x, 0.6, o.p.z, 1, 1, 1, 0, 0, 0.08));
    const dbr = []; for (const o of trees.dead) for (const s2 of [-1, 1]) dbr.push({ o, s2 });
    inst(dbr, new THREE.CylinderGeometry(0.025, 0.045, 0.55, 5), mat([70, 60, 56]), (m, b2) => put(b2.o.p.x + b2.s2 * 0.18, 0.95 + b2.s2 * 0.1, b2.o.p.z, 1, 1, 1, 0, 0, b2.s2 * -0.9));
    // City trees: a little round tree in a stone planter.
    inst(trees.planter, new THREE.BoxGeometry(0.6, 0.3, 0.6), mat([150, 146, 140]), (m, o) => put(o.p.x, 0.15, o.p.z));
    inst(trees.planter, new THREE.IcosahedronGeometry(0.32, 1), mat([74, 160, 70]), (m, o) => put(o.p.x, 0.75, o.p.z));
    inst(trees.planter, new THREE.CylinderGeometry(0.05, 0.06, 0.4, 6), mat([112, 76, 44]), (m, o) => put(o.p.x, 0.45, o.p.z));
    // Mushrooms in the woods.
    const shrooms = (kinds[0] || []).filter(o => o.b === 'woods' && fixedOf(o.x, o.y, 3) < 0.08);
    inst(shrooms, new THREE.CylinderGeometry(0.03, 0.04, 0.14, 6), mat([240, 230, 210]), (m, o) => put(o.p.x + 0.2, 0.07, o.p.z));
    inst(shrooms, new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat([220, 50, 50]), (m, o) => put(o.p.x + 0.2, 0.13, o.p.z));
    // TALL GRASS: blades in three greens, leaning.
    const blades = []; for (const o of kinds[2] || []) for (let k = 0; k < 7; k++) blades.push({ o, k });
    const bladeM = inst(blades, new THREE.ConeGeometry(0.05, 0.55, 3), new THREE.MeshLambertMaterial(), (m, b2) => put(b2.o.p.x + (fixedOf(b2.o.x, b2.o.y, b2.k) - 0.5) * 0.85, 0.26, b2.o.p.z + (fixedOf(b2.o.y, b2.o.x, b2.k) - 0.5) * 0.85, 1, 0.8 + fixedOf(b2.o.x, b2.k) * 0.5, 1, 0, (fixedOf(b2.k, b2.o.x) - 0.5) * 0.5, (fixedOf(b2.o.y, b2.k) - 0.5) * 0.5));
    if (bladeM) { blades.forEach((b2, k) => { const sh = [[60, 150, 50], [84, 176, 62], [44, 120, 40]][b2.k % 3]; bladeM.setColorAt(k, c.setRGB(sh[0] / 255, sh[1] / 255, sh[2] / 255)); }); bladeM.instanceColor.needsUpdate = true; }
    // FLOWERS: four colours on stems.
    const fl = []; for (const o of kinds[9] || []) for (let k = 0; k < 4; k++) fl.push({ o, k });
    inst(fl, new THREE.CylinderGeometry(0.01, 0.01, 0.2, 4), mat([60, 140, 50]), (m, f2) => put(f2.o.p.x + (fixedOf(f2.o.x, f2.k) - 0.5) * 0.8, 0.1, f2.o.p.z + (fixedOf(f2.k, f2.o.y) - 0.5) * 0.8));
    const flM = inst(fl, new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshLambertMaterial(), (m, f2) => put(f2.o.p.x + (fixedOf(f2.o.x, f2.k) - 0.5) * 0.8, 0.22, f2.o.p.z + (fixedOf(f2.k, f2.o.y) - 0.5) * 0.8));
    if (flM) { fl.forEach((f2, k) => { const fc = [[242, 84, 132], [255, 214, 60], [250, 250, 250], [170, 110, 230]][(f2.k + f2.o.x) % 4]; flM.setColorAt(k, c.setRGB(fc[0] / 255, fc[1] / 255, fc[2] / 255)); }); flM.instanceColor.needsUpdate = true; }
    // BOULDERS: each its own size and turn; moss on top in the woods.
    inst(kinds[13], new THREE.DodecahedronGeometry(0.4, 0), mat([150, 148, 140]), (m, o) => { const s3 = 0.8 + fixedOf(o.x, o.y, 4) * 0.5; put(o.p.x, 0.25 * s3, o.p.z, s3, s3 * 0.8, s3, fixedOf(o.y, o.x) * 3); });
    inst((kinds[13] || []).filter(o => o.b === 'woods' || o.b === 'rocky'), new THREE.SphereGeometry(0.3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 3), mat([90, 150, 70]), (m, o) => put(o.p.x, 0.42, o.p.z));
    // HOUSES: walls with windows, a gabled roof, a door, a chimney.
    inst(kinds[5], new THREE.BoxGeometry(1, 1.2, 1), mat([240, 232, 214]), (m, o) => put(o.p.x, 0.6, o.p.z));
    inst((kinds[5] || []).filter(o => at2(o.x, o.y + 1) !== 5 && at2(o.x, o.y + 1) !== 7), new THREE.BoxGeometry(0.34, 0.34, 0.04), mat([90, 140, 200], { emissive: 0x112233 }), (m, o) => put(o.p.x, 0.75, o.p.z + 0.51));
    inst(kinds[6], new THREE.CylinderGeometry(0.62, 0.62, 1.02, 3), mat([200, 70, 58]), (m, o) => put(o.p.x, 1.48, o.p.z, 1, 1, 1, 0, 0, Math.PI / 2));
    inst((kinds[6] || []).filter(o => fixedOf(o.x, o.y, 6) < 0.2), new THREE.BoxGeometry(0.2, 0.5, 0.2), mat([130, 90, 70]), (m, o) => put(o.p.x + 0.2, 1.8, o.p.z));
    inst(kinds[7], new THREE.BoxGeometry(0.45, 0.8, 0.06), mat([120, 72, 34]), (m, o) => put(o.p.x, 0.4, o.p.z + 0.5));
    inst([...(kinds[11] || []), ...(kinds[12] || [])], new THREE.BoxGeometry(0.9, 0.36, 0.08), mat([255, 210, 64], { emissive: 0x332200 }), (m, o) => put(o.p.x, 1.05, o.p.z + 0.52));
    // FENCES and SIGNS.
    inst(kinds[8], new THREE.BoxGeometry(0.08, 0.5, 0.08), mat([220, 196, 150]), (m, o) => put(o.p.x - 0.4, 0.25, o.p.z));
    inst(kinds[8], new THREE.BoxGeometry(1, 0.07, 0.05), mat([220, 196, 150]), (m, o) => put(o.p.x, 0.38, o.p.z));
    inst(kinds[8], new THREE.BoxGeometry(1, 0.07, 0.05), mat([220, 196, 150]), (m, o) => put(o.p.x, 0.18, o.p.z));
    inst(kinds[10], new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6), mat([120, 82, 46]), (m, o) => put(o.p.x, 0.4, o.p.z));
    inst(kinds[10], new THREE.BoxGeometry(0.55, 0.35, 0.06), mat([200, 160, 100]), (m, o) => put(o.p.x, 0.78, o.p.z + 0.03));
    // LAMPS: a post, an arm, a glowing lamp (brighter at night).
    inst(kinds[21], new THREE.CylinderGeometry(0.04, 0.06, 1.5, 6), mat([50, 54, 64]), (m, o) => put(o.p.x, 0.75, o.p.z));
    const lampM = inst(kinds[21], new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1a0 }), (m, o) => put(o.p.x, 1.52, o.p.z)); if (lampM) glows.push(lampM);
    // GRAVESTONES (rounded) and CROSSES, by the tile's number.
    const graves = kinds[22] || [], crosses = graves.filter(o => fixedOf(o.x, o.y, 7) < 0.35), stones = graves.filter(o => fixedOf(o.x, o.y, 7) >= 0.35);
    inst(stones, new THREE.BoxGeometry(0.42, 0.45, 0.12), mat([168, 168, 178]), (m, o) => put(o.p.x, 0.22, o.p.z, 1, 1, 1, (fixedOf(o.x, o.y) - 0.5) * 0.3, 0, (fixedOf(o.y, o.x) - 0.5) * 0.15));
    inst(stones, new THREE.CylinderGeometry(0.21, 0.21, 0.12, 12, 1, false, 0, Math.PI), mat([168, 168, 178]), (m, o) => put(o.p.x, 0.45, o.p.z, 1, 1, 1, (fixedOf(o.x, o.y) - 0.5) * 0.3, Math.PI / 2, 0));
    inst(crosses, new THREE.BoxGeometry(0.1, 0.65, 0.1), mat([150, 150, 160]), (m, o) => put(o.p.x, 0.32, o.p.z));
    inst(crosses, new THREE.BoxGeometry(0.4, 0.1, 0.1), mat([150, 150, 160]), (m, o) => put(o.p.x, 0.48, o.p.z));
    // LAVA: glowing, pulsing; smoke rising here and there.
    lavaM = inst(kinds[23], new THREE.BoxGeometry(1, 0.05, 1), new THREE.MeshBasicMaterial({ color: 0xff6a10 }), (m, o) => put(o.p.x, -0.12, o.p.z));
    for (const o of (kinds[23] || []).filter(o2 => fixedOf(o2.x, o2.y, 8) < 0.12)) for (let k = 0; k < 4; k++) { const puff = ball(0.2, new THREE.MeshLambertMaterial({ color: 0x777070, transparent: true, opacity: 0.5, depthWrite: false }), 8); puff.position.set(o.p.x, 0, o.p.z); puff.userData.k = k; routeG.add(puff); smoke.push(puff); }
    // CAVE: the walls get jagged tops, torches on some.
    inst((kinds[17] || []).filter(o => fixedOf(o.x, o.y, 9) < 0.5), new THREE.ConeGeometry(0.4, 0.8, 5), mat([84, 72, 62]), (m, o) => put(o.p.x, 1.9, o.p.z, 1, 1, 1, o.x));
    const torches = (kinds[18] || []).filter(o => fixedOf(o.x, o.y, 10) < 0.06);
    inst(torches, new THREE.CylinderGeometry(0.03, 0.03, 0.6, 5), mat([90, 60, 30]), (m, o) => put(o.p.x, 0.3, o.p.z));
    const flameM = inst(torches, new THREE.ConeGeometry(0.08, 0.2, 6), new THREE.MeshBasicMaterial({ color: 0xffa020 }), (m, o) => put(o.p.x, 0.68, o.p.z)); if (flameM) glows.push(flameM);
    // BEACH: umbrellas on the sand.
    const umb = (kinds[14] || []).filter(o => o.b === 'beach' && fixedOf(o.x, o.y, 11) < 0.04);
    inst(umb, new THREE.CylinderGeometry(0.025, 0.025, 1.1, 5), mat([240, 240, 240]), (m, o) => put(o.p.x, 0.55, o.p.z));
    const umM = inst(umb, new THREE.ConeGeometry(0.55, 0.3, 8), new THREE.MeshLambertMaterial(), (m, o) => put(o.p.x, 1.15, o.p.z));
    if (umM) { umb.forEach((o, k) => { const uc = [[240, 70, 70], [60, 130, 230], [250, 200, 40]][k % 3]; umM.setColorAt(k, c.setRGB(uc[0] / 255, uc[1] / 255, uc[2] / 255)); }); umM.instanceColor.needsUpdate = true; }
    // SNOW: soft mounds.
    inst((kinds[19] || []).filter(o => fixedOf(o.x, o.y, 12) < 0.12), new THREE.SphereGeometry(0.35, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat([250, 252, 255]), (m, o) => put(o.p.x, 0, o.p.z, 1, 0.5, 1));
    // THE SKYLINE: mountains past the edges, clouds drifting over.
    for (let k = 0; k < 14; k++) { const side = k % 2 ? 1 : -1, z = (k >> 1) * (MAP_H / 7) + 6, hm = 6 + fixedOf(k, 1) * 6, mtn = new THREE.Mesh(new THREE.ConeGeometry(4 + fixedOf(k, 2) * 3, hm, 6), mat(route.biomeAt(Math.min(MAP_H - 1, Math.floor(z))) === 'snow' ? [210, 220, 236] : [104, 128, 150])); mtn.position.set(side * (MAP_W / 2 + 5 + fixedOf(k, 3) * 4), hm / 2 - 0.2, z); routeG.add(mtn); }
    for (let k = 0; k < 10; k++) { const cl = new THREE.Group(); for (let p2 = 0; p2 < 3; p2++) at(cl, ball(0.9 - p2 * 0.15, new THREE.MeshLambertMaterial({ color: 0xffffff }), 10), p2 * 0.9 - 0.9, fixedOf(k, p2) * 0.3, 0).scale.set(1, 0.55, 0.8); cl.position.set((fixedOf(k, 5) - 0.5) * 30, 8 + fixedOf(k, 6) * 3, k * 13); routeG.add(cl); clouds.push(cl); }
    // The route's items.
    itemG.clear(); for (const it of route.items) { const p = posAt(route, it.t), o = ball(0.16, mat(it.kind === 'STONE' ? [140, 255, 120] : it.kind === 'CANDY' ? [255, 140, 220] : it.kind === 'COIN' ? [255, 210, 60] : [240, 80, 80], { emissive: 0x222222 }), 12); o.position.copy(tile(p.x, p.y)).setY(0.4); o.userData.t = it.t; itemG.add(o); }
  }
  function sceneTick(t, day) {
    if (water?.userData.tex) { water.userData.tex.offset.x = t * 0.04; water.userData.tex.offset.y = Math.sin(t * 0.7) * 0.03; }
    if (lavaM) lavaM.material.color.setRGB(1, 0.36 + 0.12 * Math.sin(t * 3), 0.04);
    for (const puff of smoke) { const life = ((t * 0.25 + puff.userData.k * 0.25) % 1); puff.position.y = life * 3; puff.scale.setScalar(0.6 + life * 1.6); puff.material.opacity = 0.5 * (1 - life); }
    for (const cl of clouds) cl.position.x = ((cl.position.x + 0.004 + 16) % 32) - 16;
    for (const gm of glows) gm.material.color.setRGB(1, day === 'night' ? 0.95 : 0.85, day === 'night' ? 0.6 : 0.45);
  }
  // WEATHER (chat's pick): rain or snow falling round you, fog closing in, the heat turning the sky orange.
  let weather = ''; const wxGeo = new THREE.BufferGeometry(); wxGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(900 * 3), 3));
  const wxPts = new THREE.Points(wxGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.85, depthWrite: false })); wxPts.visible = false; scene.add(wxPts);
  function set(s) {
    if (s.weather !== undefined) weather = String(s.weather || '');
    if (first || s.floor !== state.floor || (s.area ?? area) !== area) { area = s.area ?? area; route = routeFor(s.floor, area); build(); shown = s.phase === 'boss' ? 1 : walkAt((s.pct || 0) / 100); first = false; }
    state = { ...state, ...s }; if (Array.isArray(s.drops)) { drops = s.drops; dropG.clear(); for (const d of drops) { const p = posAt(route, d.t), o = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat([255, 216, 74])); o.position.copy(tile(p.x, p.y)).setY(0.4); o.userData.t = d.t; dropG.add(o); } }
    if (s.timeOfDay !== undefined) tod = s.timeOfDay || null;
    if (s.follower !== undefined && s.follower !== follower) { follower = s.follower || ''; if (followerM) scene.remove(followerM); followerM = follower ? buildBeast3D(follower) : null; if (followerM) { followerM.scale.setScalar(0.45); scene.add(followerM); } }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame); if (now - last < 33) return; const dt = Math.min(0.2, (now - (last || now)) / 1000); last = now; const t = now / 1000;
    const target = state.phase === 'boss' ? 1 : walkAt((state.pct || 0) / 100), walking = shown < target - 0.0005;
    if (walking) shown = Math.min(target, shown + dt * Math.max(3.2 / route.len, (target - shown) / 10)); else if (shown > target) shown = target;
    const place = (o, tt, lift = 0) => { const p = posAt(route, tt), v = tile(p.x, p.y); o.position.set(v.x, lift + (walking ? Math.abs(Math.sin(t * 10)) * 0.05 : 0), v.z); if (p.dx || p.dy) o.rotation.y = Math.atan2(p.dx, p.dy); return v; };
    const me = place(host, shown); place(champ, Math.max(0, shown - 1.3 / route.len)); if (followerM) { place(followerM, Math.max(0, shown - 2.6 / route.len)); followerM.userData.tick?.(t); }
    for (const pp of [host, champ]) pp.userData.legs.forEach((l, i) => { l.rotation.x = walking ? Math.sin(t * 10 + i * Math.PI) * 0.5 : 0; });
    for (const o of [...itemG.children, ...dropG.children]) { o.visible = o.userData.t > shown + 0.001; o.position.y = 0.4 + Math.sin(t * 3 + o.userData.t * 30) * 0.08; o.rotation.y = t * 2; }
    // The camera: behind and above you, looking up the route (the handhelds' tilt).
    cam.position.set(me.x * 0.6, 7.5, me.z + 7.5); cam.lookAt(me.x * 0.6, 0, me.z - 3);
    const day = tod || timeOfDay(), sk = SKY[day] || SKY.day; scene.background = new THREE.Color(sk[0]); scene.fog = new THREE.Fog(sk[1], 14, 30);
    hemi.intensity = day === 'night' ? 0.5 : 1.15; sun.intensity = day === 'night' ? 0.25 : 1.2; sun.color.set(day === 'sunset' ? 0xffb070 : 0xffffff);
    sceneTick(t, day);
    wxPts.visible = weather === 'rain' || weather === 'snow';
    if (wxPts.visible) { const pa = wxGeo.attributes.position, fast = weather === 'rain'; wxPts.material.size = fast ? 0.05 : 0.12; wxPts.material.color.set(fast ? 0xbfdcff : 0xffffff);
      for (let k = 0; k < pa.count; k++) { const fx = ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1, fz = ((Math.sin(k * 78.233) * 43758.5453) % 1 + 1) % 1, fall = ((t * (fast ? 1.6 : 0.25) + fx * 3) % 1); pa.setXYZ(k, me.x + (fx - 0.5) * 18 + (fast ? 0 : Math.sin(t + k) * 0.4), 8 - fall * 8, me.z + (fz - 0.6) * 18); }
      pa.needsUpdate = true; }
    if (weather === 'fog') scene.fog = new THREE.Fog(0xc8ced8, 6, 20); if (weather === 'heat') { scene.background = new THREE.Color(0xf2a060); scene.fog = new THREE.Fog(0xf6c890, 8, 22); }
    if (weather === 'rain') { scene.background = new THREE.Color(0x7a8a9c); scene.fog = new THREE.Fog(0x8a98a8, 8, 22); } if (weather === 'snow') { scene.background = new THREE.Color(0xc8d4e2); scene.fog = new THREE.Fog(0xe2e8f0, 6, 18); }
    r.render(scene, cam); ctx.drawImage(gl, 0, 0);
  }
  return { set, start() { if (!raf) raf = requestAnimationFrame(frame); }, stop() { cancelAnimationFrame(raf); raf = 0; }, get route() { return route; } };
}
