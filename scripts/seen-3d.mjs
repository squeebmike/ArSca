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

export function buildSeen(root) {
  const hoodie = mat(0x2e3342), skin = mat(0xd9a982), white = mat(0xffffff, { shininess: 90 }), black = mat(0x141414), brow = mat(0x4a3222), lip = mat(0x7a3e2e);
  const add = (geo, m, x = 0, y = 0, z = 0, p = root) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); p.add(o); return o; };
  // Body: broad shoulders and chest in the hoodie.
  const torso = add(new THREE.CylinderGeometry(0.95, 1.08, 1.6, 20), hoodie, 0, -0.75, 0); torso.scale.z = 0.6;
  add(new THREE.SphereGeometry(0.98, 22, 14), hoodie, 0, 0.02, 0).scale.set(1, 0.36, 0.6);
  const head = new THREE.Group(); head.position.set(0, 0.72, 0); root.add(head);
  // The hood: a shell open at the front (dark inside), framing the face.
  const shell = new THREE.SphereGeometry(0.66, 28, 20, Math.PI * 0.8, Math.PI * 1.4);
  add(shell, hoodie, 0, 0.06, -0.06, head).scale.set(1, 1.1, 1);
  add(shell, mat(0x14161d, { side: THREE.BackSide }), 0, 0.06, -0.06, head).scale.set(0.99, 1.09, 0.99);
  const face = add(new THREE.SphereGeometry(0.46, 24, 18), skin, 0, 0, 0.1, head); face.scale.set(0.9, 1.05, 0.9);
  const pupils = [];
  for (const s of [-1, 1]) {
    const eye = add(new THREE.SphereGeometry(0.1, 18, 14), white, s * 0.15, 0.08, 0.46, head); eye.scale.set(1, 1.2, 0.6);
    const pupil = add(new THREE.SphereGeometry(0.048, 14, 10), black, s * 0.15, 0.07, 0.52, head); pupils.push({ o: pupil, x: s * 0.15 });
    const b = add(new THREE.BoxGeometry(0.16, 0.035, 0.04), brow, s * 0.15, 0.23, 0.47, head); b.rotation.z = s * -0.18;
  }
  add(new THREE.BoxGeometry(0.15, 0.025, 0.03), lip, 0, -0.2, 0.5, head); // a flat little mouth
  // The arm that comes up: sleeve from the shoulder, a hand that ends over the mouth.
  const arm = new THREE.Group(); arm.position.set(0.55, -0.2, 0.3); root.add(arm);
  const sleeve = add(new THREE.CylinderGeometry(0.15, 0.17, 0.9, 12), hoodie, 0, -0.45, 0, arm);
  const hand = add(new THREE.SphereGeometry(0.17, 16, 12), skin, 0, -0.95, 0.02, arm); hand.scale.set(1.25, 0.8, 0.55);
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
      root.position.y = -4.2 + up * 3.4;                      // up from below the bottom edge, and slowly back down
      m.head.rotation.y = look * 0.55; m.head.rotation.z = -look * 0.05; m.head.rotation.x = hand * 0.12;
      for (const p of m.pupils) p.o.position.x = p.x + look * 0.045;
      // The hand: from hanging down to across the mouth.
      m.arm.rotation.x = -hand * 2.35; m.arm.position.x = 0.55 * (1 - hand); m.arm.position.y = -0.2 + hand * 0.05;
      r.render(scene, cam);
    },
    clear() { r.clear(); },
  };
}
