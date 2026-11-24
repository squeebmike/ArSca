// SEEN BUT NOT HEARD in 3D (store, 2026-11-24: "I want seen but not heard as a 3d cameo. No timers. I got buttons
// when people come in"). The same glossy low-poly look as Mr Fister, built here from simple shapes (original, no
// models from anywhere): a hooded guy who rises from the bottom of the screen, looks one way, then the other, raises a
// hand over his mouth, and slowly sinks back down. draw(t) shows the moment t (0..1) of the cameo -- the clock drives
// it, so every overlay shows the same thing.
import * as THREE from '../assets/vendor/three-0.160.0.module.min.js';

const ease = k => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const span = (t, a, b) => ease((t - a) / (b - a));
const mat = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 60, specular: 0x444444, ...o });

// Where he looks (-1 left .. 1 right) and how far the hand is up, at moment t -- shared with the 2D fallback's timing.
export function seenPose(t) {
  const up = Math.min(span(t, 0, 0.16), 1 - span(t, 0.8, 1));
  const look = t < 0.2 ? 0 : t < 0.34 ? -span(t, 0.2, 0.26) : t < 0.48 ? -1 + 2 * span(t, 0.36, 0.44) : t < 0.58 ? 1 - span(t, 0.5, 0.58) : 0;
  const hand = span(t, 0.58, 0.68) * (1 - span(t, 0.92, 1));
  return { up, look, hand };
}

// Knit fleece: a fine rib and a soft speckle (fixed pattern), tinted by the material colour.
function knit(doc, rep) {
  if (!doc) return null;
  const c = doc.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 3) { x.fillStyle = 'rgba(0,0,0,.09)'; x.fillRect(i, 0, 1, 128); }
  for (let k = 0; k < 1400; k++) { const v = Math.sin(k * 12.9898) * 43758.5453, f = v - Math.floor(v), w = Math.sin(k * 78.233) * 9631.17, g = w - Math.floor(w); x.fillStyle = `rgba(0,0,0,${0.04 + f * 0.08})`; x.fillRect(f * 128, g * 128, 2, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); return t;
}

export function buildSeen(root) {
  const doc = typeof document !== 'undefined' ? document : null;
  // A real pullover hoodie: charcoal fleece, a thick rolled hood edge, flat drawstrings with metal tips,
  // a kangaroo pocket, ribbed cuffs and waistband.
  const hoodie = mat(0x343a4a, { shininess: 8, specular: 0x111111, map: knit(doc, [4, 3]) }), rib = mat(0x2b303d, { shininess: 6, map: knit(doc, [10, 1]) });
  const inside = mat(0x161922, { side: THREE.BackSide, shininess: 4 }), cord = mat(0xe8e6df, { shininess: 20 }), metal = mat(0xc9cdd2, { shininess: 200, specular: 0xffffff });
  const seam = mat(0x262b37, { shininess: 4 });
  const skin = mat(0xd9a982, { shininess: 20, specular: 0x2a1a10 }), white = mat(0xffffff, { shininess: 90 }), black = mat(0x141414, { shininess: 120 }), iris = mat(0x5a3a22, { shininess: 120 }), brow = mat(0x3a2618), lip = mat(0x9a5a4a);
  const add = (geo, m, x = 0, y = 0, z = 0, p = root) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); p.add(o); return o; };
  // The body: a lathe with sloping shoulders, slightly baggy, the ribbed waistband.
  const prof = [[0.95, -1.75], [0.98, -1.5], [1.0, -1.1], [1.02, -0.6], [1.0, -0.25], [0.92, 0.0], [0.72, 0.18], [0.42, 0.3], [0.0, 0.32]].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = add(new THREE.LatheGeometry(prof, 36), hoodie, 0, 0, 0); torso.scale.z = 0.62;
  add(new THREE.TorusGeometry(0.96, 0.06, 8, 36), rib, 0, -1.72, 0).scale.set(1, 1, 0.62);
  // The kangaroo pocket: a soft panel, its slanted openings edged with stitching.
  const pocket = add(new THREE.BoxGeometry(1.05, 0.5, 0.06), hoodie, 0, -1.2, 0.62); pocket.scale.set(1, 1, 1);
  for (const sx of [-1, 1]) { const e = add(new THREE.BoxGeometry(0.03, 0.5, 0.07), seam, sx * 0.46, -1.2, 0.635); e.rotation.z = sx * 0.35; }
  add(new THREE.BoxGeometry(1.0, 0.025, 0.07), seam, 0, -0.96, 0.635);
  // The neck.
  add(new THREE.CylinderGeometry(0.2, 0.24, 0.3, 16), skin, 0, 0.42, 0.05);
  const head = new THREE.Group(); head.position.set(0, 0.86, 0); root.add(head);
  // The hood: a shell open at the front, dark inside, a thick rolled edge round the face, a seam down the middle.
  const shell = new THREE.SphereGeometry(0.66, 32, 22, Math.PI * 0.78, Math.PI * 1.44);
  add(shell, hoodie, 0, 0.06, -0.06, head).scale.set(1, 1.12, 1.02);
  add(shell, inside, 0, 0.06, -0.06, head).scale.set(0.985, 1.105, 1.005);
  const edge = add(new THREE.TorusGeometry(0.5, 0.075, 10, 36), hoodie, 0, 0.02, 0.38, head); edge.scale.set(0.95, 1.2, 1); edge.rotation.x = -0.12;
  // The hood drapes down onto the shoulders behind.
  add(new THREE.SphereGeometry(0.62, 22, 14), hoodie, 0, -0.42, -0.28, head).scale.set(1.15, 0.5, 0.8);
  // Drawstrings: out of eyelets either side of the neck, hanging down the chest, metal tips.
  for (const sx of [-1, 1]) {
    add(new THREE.TorusGeometry(0.025, 0.008, 6, 12), metal, sx * 0.17, -0.38, 0.4, head);
    const st = add(new THREE.BoxGeometry(0.04, 0.6, 0.014), cord, sx * 0.19, -0.72, 0.53, head); st.rotation.z = sx * -0.06; st.rotation.x = -0.12;
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 8), metal, sx * 0.21, -1.05, 0.57, head);
  }
  // The face: cheeks, a proper nose, lids, ears tucked away in the hood.
  const face = add(new THREE.SphereGeometry(0.44, 28, 20), skin, 0, -0.01, 0.12, head); face.scale.set(0.9, 1.06, 0.88);
  add(new THREE.SphereGeometry(0.2, 16, 12), skin, 0, -0.2, 0.25, head).scale.set(1.2, 0.8, 0.9); // jaw and chin
  const nose = add(new THREE.ConeGeometry(0.06, 0.16, 10), skin, 0, -0.04, 0.53, head); nose.rotation.x = Math.PI / 2;
  add(new THREE.SphereGeometry(0.05, 12, 10), skin, 0, -0.09, 0.54, head).scale.set(1.3, 0.8, 0.9);
  const pupils = [];
  for (const s of [-1, 1]) {
    const eye = add(new THREE.SphereGeometry(0.085, 18, 14), white, s * 0.15, 0.08, 0.45, head); eye.scale.set(1.1, 1.0, 0.55);
    add(new THREE.SphereGeometry(0.045, 14, 10), iris, s * 0.15, 0.075, 0.486, head).scale.set(1, 1, 0.4);
    const pupil = add(new THREE.SphereGeometry(0.026, 12, 10), black, s * 0.15, 0.075, 0.497, head); pupils.push({ o: pupil, x: s * 0.15 });
    add(new THREE.SphereGeometry(0.01, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), s * 0.15 - 0.015, 0.09, 0.505, head);
    const lid = add(new THREE.SphereGeometry(0.09, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), skin, s * 0.15, 0.085, 0.445, head); lid.scale.set(1.15, 1.0, 0.6);
    const b = add(new THREE.BoxGeometry(0.15, 0.03, 0.04), brow, s * 0.15, 0.2, 0.48, head); b.rotation.z = s * -0.2;
  }
  add(new THREE.BoxGeometry(0.14, 0.022, 0.03), lip, 0, -0.2, 0.47, head); // a flat little mouth
  // The arm that comes up: a sleeve with a ribbed cuff, and a real hand -- palm, four fingers, a thumb.
  const arm = new THREE.Group(); arm.position.set(0.55, -0.2, 0.3); root.add(arm);
  const sleeve = add(new THREE.CylinderGeometry(0.16, 0.18, 0.78, 14), hoodie, 0, -0.39, 0, arm);
  add(new THREE.CylinderGeometry(0.14, 0.15, 0.12, 14), rib, 0, -0.83, 0, arm);
  const hand = new THREE.Group(); hand.position.set(0, -0.98, 0.02); arm.add(hand);
  add(new THREE.BoxGeometry(0.24, 0.2, 0.08), skin, 0, 0, 0, hand);
  for (let k = 0; k < 4; k++) { const f = add(new THREE.CapsuleGeometry(0.03, 0.12 - Math.abs(k - 1.5) * 0.02, 4, 8), skin, -0.09 + k * 0.06, -0.17, 0.0, hand); f.rotation.x = 0.15; }
  const th = add(new THREE.CapsuleGeometry(0.032, 0.09, 4, 8), skin, 0.14, 0.02, 0.02, hand); th.rotation.z = 0.9;
  return { head, pupils, arm, sleeve, hand };
}

export function createSeen3D(canvas, { size = 900 } = {}) {
  let r; try { r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true }); } catch { return null; }
  r.setPixelRatio(1); r.setSize(size, size, false); r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4d6, 0x2a1450, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(-3, 4, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9b5de5, 1.3); rim.position.set(3, 2, -4); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50); cam.position.set(0, 0.3, 7.2); cam.lookAt(0, 0.1, 0);
  const root = new THREE.Group(); scene.add(root); const m = buildSeen(root);
  return {
    draw(t) {
      const { up, look, hand } = seenPose(t);
      root.position.y = -4.3 + up * 3.55;                      // up from below the bottom edge, and slowly back down
      m.head.rotation.y = look * 0.55; m.head.rotation.z = -look * 0.05; m.head.rotation.x = hand * 0.12;
      for (const p of m.pupils) p.o.position.x = p.x + look * 0.045;
      // The hand: from hanging down to across the mouth.
      m.arm.rotation.x = -hand * 2.35; m.arm.position.x = 0.55 * (1 - hand); m.arm.position.y = -0.2 + hand * 0.05;
      r.render(scene, cam);
    },
    clear() { r.clear(); },
  };
}
