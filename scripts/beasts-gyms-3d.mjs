// THE GYM LEADERS IN 3D (store, 2026-11-14: "cool trainers. Or thematic. Not AI lameness slop"). Four people from
// the hobby, turned up to eleven, each standing in their own arena with their own signature move:
//   THE GRADER    -- the grading lab: a white lab coat, a loupe glowing over one eye, a slab held up to the UV light.
//                    PERFECT 10: a giant slab slams down over your beast and seals it in.
//   FOIL QUEEN    -- the prism hall: a cape of shifting holo foil, a crown of fanned cards, a platinum bob.
//                    PRISM BURST: a fan of foil cards in every colour, flung at your beast.
//   THE ARCHIVIST -- the stacks: a long coat, round glasses, a lantern swinging; long boxes stacked to the ceiling.
//                    BOX AVALANCHE: the stacks come down on your beast.
//   THE INKER     -- the splash page: tattoo sleeves, an inky apron, a brush pen as long as a spear; the floor is a
//                    comic page. SPLASH PAGE: a wave of ink, and a sound effect drawn in the air.
// Toon-shaded with a dark outline like the beasts. Built here from simple shapes (original; nothing traced). Nothing by
// chance: every sway and drip runs on the clock.
import * as THREE from '../assets/vendor/three-0.160.0.module.min.js';

const toonGrad = (() => { let t = null; return () => { if (t) return t; t = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat); t.needsUpdate = true; t.minFilter = t.magFilter = THREE.NearestFilter; return t; }; })();
const toon = (c, o = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonGrad(), ...o });
const basic = (c, o = {}) => new THREE.MeshBasicMaterial({ color: c, ...o });
const at = (p, o, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); p.add(o); return o; };
const ball = (r, m, s = 18) => new THREE.Mesh(new THREE.SphereGeometry(r, s, Math.round(s * 0.7)), m);
const cyl = (a, b, h, m, s = 14) => new THREE.Mesh(new THREE.CylinderGeometry(a, b, h, s), m);
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const cone = (r, h, m, s = 10) => new THREE.Mesh(new THREE.ConeGeometry(r, h, s), m);
const OUT = new THREE.MeshBasicMaterial({ color: 0x141018, side: THREE.BackSide });
function outline(g, w = 0.022) { const add = []; g.traverse(o => { if (o.isMesh && !o.userData.noOutline && o.material !== OUT && !o.material.transparent) add.push(o); }); for (const o of add) { const h = new THREE.Mesh(o.geometry, OUT); h.userData.noOutline = true; const sz = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()), m = Math.max(0.04, Math.min(sz.x, sz.y, sz.z) || 0.1); h.scale.setScalar(Math.min(1.12, 1 + w / m * 2)); o.add(h); } }
const glow = o => { o.userData.noOutline = true; return o; };
function canvasTex(w, h, draw, repeat = false) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
const RAINBOW = ['#ff6b9e', '#ffb347', '#ffe95c', '#6dfc9b', '#5fd3ff', '#9b7bff'];
const holoTex = () => canvasTex(256, 64, (x, w, h) => { const g = x.createLinearGradient(0, 0, w, 0); RAINBOW.concat(RAINBOW[0]).forEach((c, i) => g.addColorStop(i / RAINBOW.length, c)); x.fillStyle = g; x.fillRect(0, 0, w, h); x.globalAlpha = 0.35; x.fillStyle = '#fff'; for (let i = 0; i < w; i += 18) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 8, 0); x.lineTo(i - 12, h); x.lineTo(i - 20, h); x.fill(); } }, true);
// A slab's card: our own art (a burst behind a little figure), never a real card.
const slabArt = () => canvasTex(96, 128, (x, w, h) => { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#2b6cff'); g.addColorStop(1, '#ff3d7f'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#ffe95c'; x.beginPath(); for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, r = k % 2 ? 22 : 44; x.lineTo(48 + Math.cos(a) * r, 60 + Math.sin(a) * r); } x.fill(); x.fillStyle = '#141018'; x.beginPath(); x.arc(48, 52, 10, 0, 7); x.fill(); x.fillRect(40, 60, 16, 26); x.strokeStyle = '#fff'; x.lineWidth = 5; x.strokeRect(3, 3, w - 6, h - 6); });
const labelTex = (txt, bg = '#d8262e') => canvasTex(128, 36, (x, w, h) => { x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.fillText(txt, w / 2, 26); x.fillStyle = '#ffffffaa'; x.fillRect(6, 30, w - 12, 2); });
const sfxTex = (word, fill, ink = '#141018') => canvasTex(512, 160, (x, w, h) => { x.font = 'italic 900 112px Impact, "Arial Black", sans-serif'; x.textAlign = 'center'; x.lineJoin = 'round'; x.lineWidth = 22; x.strokeStyle = ink; x.strokeText(word, w / 2, 120); x.fillStyle = fill; x.fillText(word, w / 2, 120); x.lineWidth = 4; x.strokeStyle = '#fff'; x.strokeText(word, w / 2, 120); });

// One person, feet at y = 0, looking down +z. Arms hang from shoulder pivots (rotate them to pose); a head group to turn.
function person({ skin = 0xf1c9a6, top = 0x222222, legs = 0x2a2a34, shoes = 0x161616, h = 1, shoulders = 0.36, sleeves = null, cuffs = null } = {}) {
  const g = new THREE.Group(), sk = toon(skin), P = { g, sk, arms: {}, hands: {} };
  for (const sx of [-1, 1]) { at(g, cyl(0.1, 0.09, 0.9 * h, toon(legs)), sx * 0.13, 0.47 * h, 0); at(g, box(0.17, 0.12, 0.3, toon(shoes)), sx * 0.13, 0.06, 0.06); }
  P.torso = at(g, cyl(0.3, 0.25, 0.72 * h, toon(top), 16), 0, 1.25 * h, 0); P.torso.scale.z = 0.72;
  for (const sx of [-1, 1]) { const piv = at(g, new THREE.Group(), sx * shoulders, 1.55 * h, 0); at(piv, ball(0.11, toon(top), 12), 0, 0, 0); at(piv, cyl(sleeves !== null ? 0.085 : 0.07, sleeves !== null ? 0.08 : 0.06, 0.62, sleeves !== null ? toon(sleeves) : sk), 0, -0.33, 0); if (cuffs !== null) at(piv, cyl(0.088, 0.088, 0.06, toon(cuffs)), 0, -0.6, 0); P.hands[sx] = at(piv, ball(0.075, sk, 10), 0, -0.68, 0); P.arms[sx] = piv; }
  at(g, cyl(0.08, 0.09, 0.14, sk), 0, 1.66 * h, 0);
  P.head = at(g, new THREE.Group(), 0, 1.92 * h, 0); P.skull = at(P.head, ball(0.24, sk, 22), 0, 0, 0); P.skull.scale.set(0.92, 1.06, 0.96);
  return P;
}
const pose = (P, sx, z, fwd = 0) => { P.arms[sx].rotation.set(-fwd, 0, z); }; // fwd: swing the arm forward, toward you
// Eyes, brows, a nose and a mouth on the front of a head group.
function faceOn(head, { eyes = 0x141018, brow = 0x2a2018, mouth = 0x6a2a2a, browTilt = 0, mouthW = 0.07, squint = 1, y = 0.02, z = 0.215 } = {}) {
  const e = basic(eyes); for (const sx of [-1, 1]) { at(head, ball(0.027, e, 10), sx * 0.085, y, z).scale.set(1, 1.3 * squint, 0.6); const b = at(head, box(0.085, 0.018, 0.02, toon(brow)), sx * 0.085, y + 0.065, z + 0.005); b.rotation.z = sx * browTilt; }
  at(head, cone(0.026, 0.07, toon(0xe0aa86), 6), 0, y - 0.05, z + 0.03).rotation.x = Math.PI / 2;
  at(head, box(mouthW, 0.016, 0.02, basic(mouth)), 0, y - 0.115, z - 0.01);
}

const LEADERS = {
  // THE GRADER: nothing gets past her. White coat to the knee, black turtleneck, silver hair slicked back with a hard part,
  // the loupe over her right eye glowing cyan, purple gloves, a slab held up to the light in her left hand.
  grader() {
    const P = person({ skin: 0xf3cdb0, top: 0xf4f6fb, legs: 0x2b2a3a, shoes: 0x111111, sleeves: 0xf4f6fb, cuffs: 0x8a5cf0 }), g = P.g;
    const coatM = toon(0xf4f6fb), coat = at(g, cyl(0.31, 0.45, 1.2, coatM, 20), 0, 1.15, 0); coat.scale.z = 0.75; at(g, box(0.02, 0.62, 0.02, toon(0xc9ccd8)), 0, 0.86, 0.335);
    for (const sx of [-1, 1]) { const col = at(g, box(0.16, 0.12, 0.05, coatM), sx * 0.15, 1.76, 0.12); col.rotation.set(-0.5, 0, sx * -0.5); }
    const turtle = toon(0x15141c); at(g, cyl(0.1, 0.11, 0.16, turtle), 0, 1.7, 0);
    const vee = at(g, new THREE.Mesh(new THREE.CircleGeometry(0.17, 3), turtle), 0, 1.5, 0.215); vee.rotation.z = -Math.PI / 2; vee.scale.set(1.25, 0.6, 1);
    for (const sx of [-1, 1]) { const lap = at(g, box(0.06, 0.42, 0.03, toon(0xdfe3ee)), sx * 0.11, 1.45, 0.225); lap.rotation.z = sx * 0.32; }
    at(g, box(0.12, 0.1, 0.02, toon(0xdfe3ee)), -0.17, 1.32, 0.235); at(g, cyl(0.012, 0.012, 0.13, basic(0x2b6cff)), -0.19, 1.37, 0.24); at(g, cyl(0.012, 0.012, 0.13, basic(0xd8262e)), -0.15, 1.37, 0.24);
    // Silver hair, slicked back, a part on the side.
    const hair = toon(0xc7ccd8), cap = at(P.head, new THREE.Mesh(new THREE.SphereGeometry(0.255, 22, 14, 0, Math.PI * 2, 0, 1.45), hair), 0, 0.03, -0.02); cap.scale.set(0.95, 1, 1.05);
    at(P.head, box(0.012, 0.012, 0.3, toon(0x8f96a6)), 0.07, 0.24, -0.02); at(P.head, ball(0.1, hair, 14), 0, 0.02, -0.27); for (let k = 0; k < 4; k++) at(P.head, box(0.006, 0.006, 0.26, toon(0x9aa1b0)), -0.15 + k * 0.06, 0.21 - Math.abs(k - 1.5) * 0.02, -0.04);
    faceOn(P.head, { browTilt: 0.05, mouthW: 0.06, squint: 0.7 });
    // THE LOUPE over her right eye: a black barrel, a cyan lens, a strap round her head; it lights her face.
    const lp = at(P.head, cyl(0.055, 0.045, 0.1, toon(0x1b1b22)), -0.085, 0.02, 0.255); lp.rotation.x = Math.PI / 2;
    const lens = glow(at(P.head, new THREE.Mesh(new THREE.CircleGeometry(0.043, 18), basic(0x6ff3ff)), -0.085, 0.02, 0.307)); const lamp = glow(at(P.head, new THREE.Mesh(new THREE.CircleGeometry(0.075, 18), basic(0x6ff3ff, { transparent: true, opacity: 0.35, depthWrite: false })), -0.085, 0.02, 0.31));
    const strap = at(P.head, new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.012, 6, 30), toon(0x1b1b22)), 0, 0.05, 0); strap.rotation.set(Math.PI / 2, 0.12, 0);
    // Gloves; her left arm up holding THE SLAB to the light (a clear case, the art inside, a red label with a 10).
    const glove = toon(0x8a5cf0); for (const sx of [-1, 1]) P.hands[sx].material = glove;
    pose(P, 1, 2.75, -0.15); pose(P, -1, -0.35, 0.25);
    const slab = at(P.arms[1], new THREE.Group(), 0, -0.98, 0.04); slab.rotation.z = -2.75;
    at(slab, new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), basic(0xffffff, { map: slabArt() })), 0, -0.04, 0.012).userData.noOutline = true;
    at(slab, new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.09), basic(0xffffff, { map: labelTex('GEM 10') })), 0, 0.22, 0.014).userData.noOutline = true;
    at(slab, box(0.4, 0.58, 0.05, new THREE.MeshPhongMaterial({ color: 0xeef6ff, transparent: true, opacity: 0.32, shininess: 120, specular: 0xffffff })), 0, 0.02, 0);
    outline(g);
    return { g, tick(t) { slab.rotation.y = Math.sin(t * 0.9) * 0.6; P.head.rotation.set(0.12 + Math.sin(t * 0.7) * 0.05, -0.25 + Math.sin(t * 0.9) * 0.2, 0.08); lamp.scale.setScalar(1 + Math.sin(t * 5) * 0.15); lens.material.color.setHSL(0.5, 1, 0.68 + Math.sin(t * 5) * 0.08); g.position.y = Math.sin(t * 1.4) * 0.01; }, hand: slab };
  },
  // FOIL QUEEN: a long dark gown, a cape of holo foil that runs through the rainbow as she moves, a standing collar, a
  // platinum bob cut dead straight, a crown of five fanned cards, three more fanned in her raised hand.
  foil() {
    const P = person({ skin: 0xf3cdb4, top: 0x1c1630, legs: 0x1c1630, shoes: 0x1c1630, sleeves: 0x1c1630 }), g = P.g, holo = holoTex();
    const foilM = toon(0xffffff, { map: holo, side: THREE.DoubleSide, emissive: 0x332255 });
    const gown = at(g, cyl(0.24, 0.62, 1.55, toon(0x1c1630), 24), 0, 0.78, 0); gown.scale.z = 0.8;
    for (let k = 0; k < 5; k++) { const st = glow(at(g, ball(0.018, basic(0xffffff), 6), Math.cos(k * 1.3) * 0.3, 0.3 + k * 0.22, 0.38 - k * 0.04)); st.userData.twinkle = k; }
    const cape = at(g, new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.98, 1.85, 28, 1, true, Math.PI * 0.42, Math.PI * 1.16), foilM), 0, 0.98, -0.02); cape.scale.z = 0.85; cape.userData.noOutline = true;
    const collar = at(g, new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.2, 0.34, 20, 1, true, Math.PI * 0.55, Math.PI * 0.9), foilM), 0, 1.78, 0); collar.userData.noOutline = true;
    // The bob: platinum, to the jaw, the fringe straight across.
    const hairM = toon(0xf1f0ff, { emissive: 0x1a1a2a }), bob = at(P.head, new THREE.Mesh(new THREE.SphereGeometry(0.29, 24, 16, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, 2.05), hairM), 0, 0.02, -0.02); const crownTop = at(P.head, new THREE.Mesh(new THREE.SphereGeometry(0.292, 24, 10, 0, Math.PI * 2, 0, 0.9), hairM), 0, 0.02, -0.02); crownTop.scale.set(1, 1.02, 1.05); bob.scale.set(1, 1.02, 1.05);
    for (const sx of [-1, 1]) { const side = at(P.head, box(0.07, 0.3, 0.22, hairM), sx * 0.245, -0.08, 0.02); side.rotation.z = sx * 0.06; }
    at(P.head, box(0.4, 0.09, 0.08, hairM), 0, 0.12, 0.2);
    P.skull.material = P.sk; faceOn(P.head, { brow: 0x1c1630, mouth: 0x7a1c4c, mouthW: 0.055, browTilt: -0.2, y: 0.0 });
    for (const sx of [-1, 1]) { const lash = at(P.head, box(0.05, 0.012, 0.012, basic(0x141018)), sx * 0.125, 0.02, 0.215); lash.rotation.z = sx * 0.5; }
    // THE CROWN: five cards fanned up, the middle one tallest.
    const crown = at(P.head, new THREE.Group(), 0, 0.27, -0.02); const cards = [];
    for (let k = 0; k < 5; k++) { const hgt = [0.18, 0.25, 0.31, 0.25, 0.18][k], c = at(crown, new THREE.Group(), (k - 2) * 0.07, 0, 0); c.rotation.z = (2 - k) * 0.3; const card = at(c, box(0.11, hgt, 0.016, foilM), 0, hgt / 2, 0); cards.push(card); at(c, ball(0.022, basic(0xffffff), 8), 0, hgt + 0.02, 0).userData.noOutline = true; }
    // Her left hand up, three foil cards fanned in it; her right out, palm down, commanding.
    pose(P, 1, 2.4, -0.4); pose(P, -1, -0.75, 0.55);
    const fan = at(P.arms[1], new THREE.Group(), 0, -0.76, 0.02); fan.rotation.z = -2.4; const fanCards = [];
    for (let k = 0; k < 3; k++) { const f = at(fan, new THREE.Group(), 0, 0, 0.005 * k); f.rotation.z = (k - 1) * 0.4; at(f, box(0.12, 0.17, 0.008, foilM), 0, 0.1, 0); fanCards.push(f); }
    outline(g);
    return { g, tick(t) { holo.offset.x = (t * 0.12) % 1; foilM.emissive.setHSL((t * 0.08) % 1, 0.6, 0.12); fanCards.forEach((f, k) => { f.rotation.z = (k - 1) * (0.4 + Math.sin(t * 2) * 0.08); }); g.children.forEach(o => { if (o.userData.twinkle !== undefined) o.scale.setScalar(0.6 + Math.abs(Math.sin(t * 3 + o.userData.twinkle))); }); P.head.rotation.set(-0.05, Math.sin(t * 0.6) * 0.15, Math.sin(t * 0.8) * 0.04); cape.rotation.y = Math.sin(t * 1.1) * 0.06; }, hand: fan };
  },
  // THE ARCHIVIST: tall and thin, a long brown duster with the collar up over a moss cardigan, grey hair long at the
  // back, round gold spectacles, a neat moustache; a lantern swinging from his right hand, a bagged back issue in his left.
  archivist() {
    const P = person({ skin: 0xe6b48e, top: 0x5b4330, legs: 0x3a2c22, shoes: 0x1d1610, h: 1.1, shoulders: 0.33, sleeves: 0x5b4330, cuffs: 0x5e6b45 }), g = P.g;
    const coatM = toon(0x5b4330), coat = at(g, cyl(0.29, 0.5, 1.75, coatM, 20), 0, 1.0, 0); coat.scale.z = 0.72;
    at(g, box(0.2, 1.05, 0.04, toon(0x5e6b45)), 0, 1.25, 0.215); for (let k = 0; k < 5; k++) at(g, ball(0.015, toon(0xc9a24a), 6), 0, 1.65 - k * 0.2, 0.24);
    for (const sx of [-1, 1]) { const flap = at(g, box(0.16, 0.24, 0.04, coatM), sx * 0.15, 1.85, 0.1); flap.rotation.set(-0.25, 0, sx * -0.35); }
    // Keys on a ring at the belt (every storage unit's).
    const ring = at(g, new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 16), toon(0xc9a24a)), 0.2, 1.0, 0.25); for (let k = 0; k < 3; k++) { const key = at(ring, box(0.015, 0.07, 0.006, toon(0xb8b8c0)), (k - 1) * 0.025, -0.07, 0); key.rotation.z = (k - 1) * 0.3; }
    // Thin hair, grey, long at the back and the sides; a moustache; round gold spectacles catching the lamplight.
    P.skull.scale.set(0.84, 1.12, 0.92); const grey = toon(0xb8b4ac);
    const back = at(P.head, ball(0.24, grey, 18), 0, -0.05, -0.08); back.scale.set(0.9, 1.05, 0.8); for (const sx of [-1, 1]) at(P.head, ball(0.08, grey, 10), sx * 0.19, 0.02, 0).scale.set(0.6, 1.4, 1);
    at(g, box(0.16, 0.22, 0.06, grey), 0, 1.98, -0.17);
    faceOn(P.head, { brow: 0x8a857c, browTilt: 0.12, mouthW: 0.05, y: 0.03 });
    const tache = at(P.head, box(0.13, 0.03, 0.03, grey), 0, -0.06, 0.225); tache.rotation.z = 0.02;
    const gold = toon(0xd8b04a); for (const sx of [-1, 1]) { at(P.head, new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.009, 6, 20), gold), sx * 0.085, 0.03, 0.235); glow(at(P.head, new THREE.Mesh(new THREE.CircleGeometry(0.046, 18), basic(0xfff1c8, { transparent: true, opacity: 0.35 })), sx * 0.085, 0.03, 0.238)); }
    at(P.head, box(0.06, 0.008, 0.008, gold), 0, 0.035, 0.24);
    // THE LANTERN, swinging from his right hand; it is the room's warm light.
    pose(P, -1, -0.12, 0.35); pose(P, 1, 0.35, 0.9);
    const lan = at(P.arms[-1], new THREE.Group(), 0, -0.74, 0.02), frameM = toon(0x2a2018);
    at(lan, cyl(0.004, 0.004, 0.12, frameM), 0, -0.06, 0); const body = at(lan, new THREE.Group(), 0, -0.24, 0);
    at(body, cone(0.11, 0.08, frameM, 4), 0, 0.14, 0).rotation.y = Math.PI / 4; at(body, box(0.18, 0.025, 0.18, frameM), 0, -0.13, 0);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) at(body, box(0.02, 0.24, 0.02, frameM), x * 0.08, 0, z * 0.08);
    glow(at(body, box(0.14, 0.2, 0.14, basic(0xffc46a, { transparent: true, opacity: 0.85 })), 0, 0, 0)); glow(at(body, ball(0.035, basic(0xffffff), 8), 0, -0.02, 0));
    const light = at(body, new THREE.PointLight(0xffb44a, 1.2, 2.4), 0, 0, 0.25);
    // A back issue in a bag and board, held up to read the spine.
    g.updateMatrixWorld(true); const hold = P.hands[1].getWorldPosition(new THREE.Vector3()); g.worldToLocal(hold);
    const book = at(g, new THREE.Group(), hold.x - 0.04, hold.y + 0.12, hold.z + 0.06); book.rotation.set(-0.15, -0.25, -0.12);
    at(book, new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.38), basic(0xffffff, { map: canvasTex(64, 96, (x, w, h) => { x.fillStyle = '#c63a2c'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffe2a0'; x.fillRect(0, 0, w, 20); x.fillStyle = '#141018'; x.font = 'bold 13px sans-serif'; x.fillText('No.1', 6, 15); x.fillStyle = '#ffe95c'; x.beginPath(); x.arc(32, 60, 18, 0, 7); x.fill(); x.fillStyle = '#141018'; x.fillRect(26, 50, 12, 28); }) , side: THREE.DoubleSide })), 0, 0, 0).userData.noOutline = true;
    at(book, new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.44), new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, shininess: 140, side: THREE.DoubleSide })), 0, 0.01, 0.006);
    outline(g); g.scale.setScalar(1.04);
    return { g, tick(t) { lan.rotation.z = Math.sin(t * 1.6) * 0.22; lan.rotation.x = Math.cos(t * 1.6) * 0.06; light.intensity = 1.1 + Math.sin(t * 9) * 0.12 + Math.sin(t * 23) * 0.06; P.head.rotation.set(0.18 + Math.sin(t * 0.5) * 0.04, 0.22 + Math.sin(t * 0.35) * 0.18, 0); book.rotation.z = -0.12 + Math.sin(t * 0.8) * 0.06; }, hand: book };
  },
  // THE INKER: black tee, an off-white apron splashed with ink, tattoo sleeves in black linework, a red bandana over
  // shaggy black hair, headphones round the neck, and THE BRUSH PEN -- longer than she is tall, ink dripping off the tip.
  inker() {
    const tattoo = canvasTex(64, 128, (x, w, h) => { x.fillStyle = '#e9b088'; x.fillRect(0, 0, w, h); x.strokeStyle = '#141018'; x.lineWidth = 3; for (let y = 8; y < h; y += 26) { x.beginPath(); for (let k = 0; k <= w; k += 8) x.lineTo(k, y + Math.sin(k / 6) * 5); x.stroke(); } x.fillStyle = '#141018'; for (const [cx, cy] of [[16, 22], [46, 60], [20, 96]]) { x.beginPath(); for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, r = k % 2 ? 4 : 10; x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } x.fill(); } }, true);
    const P = person({ skin: 0xe9b088, top: 0x141418, legs: 0x2d3a52, shoes: 0x141418 }), g = P.g;
    for (const sx of [-1, 1]) P.arms[sx].children[1].material = toon(0xffffff, { map: tattoo });
    const apron = at(g, box(0.46, 1.0, 0.03, toon(0xffffff, { map: canvasTex(64, 128, (x, w, h) => { x.fillStyle = '#f4efe2'; x.fillRect(0, 0, w, h); x.fillStyle = '#141018'; for (const [cx, cy, r] of [[18, 30, 7], [44, 70, 10], [24, 98, 5], [50, 22, 4], [12, 66, 4], [36, 112, 6]]) { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); for (let k = 0; k < 6; k++) { const a = k * 1.05; x.beginPath(); x.arc(cx + Math.cos(a) * r * 1.7, cy + Math.sin(a) * r * 1.7, r * 0.3, 0, 7); x.fill(); } } x.fillStyle = '#d23b3b'; x.fillRect(0, 0, w, 6); }) })), 0, 1.05, 0.225);
    for (const sx of [-1, 1]) { const st = at(g, box(0.035, 0.32, 0.02, toon(0xf4efe2)), sx * 0.15, 1.68, 0.17); st.rotation.x = -0.4; }
    // Headphones round her neck.
    const hp = at(g, new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 8, 24, Math.PI), toon(0x2a2a30)), 0, 1.66, 0.04); hp.rotation.x = Math.PI / 2 + 0.3; hp.rotation.z = Math.PI;
    for (const sx of [-1, 1]) { const cup = at(g, cyl(0.07, 0.07, 0.05, toon(0xd23b3b)), sx * 0.16, 1.66, 0.06); cup.rotation.z = Math.PI / 2; }
    // Shaggy black hair, a red bandana knotted at the side.
    const black = toon(0x141418), cap = at(P.head, new THREE.Mesh(new THREE.SphereGeometry(0.255, 20, 12, 0, Math.PI * 2, 0, 1.4), black), 0, 0.04, -0.02);
    for (let k = 0; k < 9; k++) { const sp = at(P.head, cone(0.06, 0.2, black, 6), Math.cos(k * 0.7 + 1) * 0.16, 0.22 + (k % 3) * 0.02, Math.sin(k * 0.7 + 1) * 0.12 - 0.04); sp.rotation.set(Math.sin(k) * 0.6, 0, Math.cos(k * 1.3) * 0.7); }
    const red = toon(0xd23b3b), band = at(P.head, new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.035, 8, 30), red), 0, 0.1, 0); band.rotation.x = Math.PI / 2 - 0.12;
    for (const k of [0, 1]) { const tail = at(P.head, box(0.05, 0.16, 0.03, red), 0.25, 0.04 - k * 0.04, -0.06 - k * 0.05); tail.rotation.z = -0.5 - k * 0.3; }
    faceOn(P.head, { brow: 0x141418, browTilt: -0.15, mouthW: 0.09, y: 0.0 });
    const smear = glow(at(P.head, new THREE.Mesh(new THREE.CircleGeometry(0.03, 10), basic(0x141018)), 0.14, -0.06, 0.205)); smear.scale.set(1.6, 0.6, 1);
    // THE BRUSH PEN, in her right hand: a long black barrel, a silver band, a brush tip; ink drips off it.
    pose(P, -1, -0.28, 0.55); pose(P, 1, 0.25, 0.1);
    g.updateMatrixWorld(true); const grip = P.hands[-1].getWorldPosition(new THREE.Vector3()); g.worldToLocal(grip);
    const pen = at(g, new THREE.Group(), grip.x, grip.y, grip.z); pen.rotation.set(0.12, 0, -0.14);
    at(pen, cyl(0.035, 0.03, 2.3, black, 12), 0, 0.6, 0); at(pen, cyl(0.04, 0.04, 0.08, toon(0xcfd3dc)), 0, 1.72, 0); const tip = at(pen, cone(0.04, 0.22, toon(0x141418, { emissive: 0x090909 }), 10), 0, 1.87, 0);
    const drips = []; for (let k = 0; k < 3; k++) drips.push(glow(at(g, ball(0.03, basic(0x141018), 8), 0, -10, 0)));
    outline(g, 0.03);
    const tipW = new THREE.Vector3();
    return { g, tick(t) { pen.rotation.z = -0.14 + Math.sin(t * 1.2) * 0.05; P.head.rotation.set(-0.04, -0.2 + Math.sin(t * 0.7) * 0.15, Math.sin(t * 1.4) * 0.06); g.position.y = Math.abs(Math.sin(t * 2.4)) * 0.02; tip.getWorldPosition(tipW); g.worldToLocal(tipW); drips.forEach((d, k) => { const f = ((t * 0.6 + k / 3) % 1); d.position.set(tipW.x, tipW.y - 0.12 - f * 2.4, tipW.z); d.scale.set(0.8, 1 + f, 0.8); d.visible = f < 0.95; }); }, hand: tip };
  },
};
export const LEADER_IDS = Object.keys(LEADERS);
export function buildLeader3D(id) { const f = LEADERS[id]; return f ? f() : null; }

// ── THE ARENAS ──────────────────────────────────────────────────────────────────────────────────────────────────
// Each one a group to show behind the fight, with its sky and haze, and its platform colours.
export function buildArena3D(id) {
  const a = new THREE.Group(), ticks = [];
  const floor = (m, r = 12) => { const f = new THREE.Mesh(new THREE.CircleGeometry(r, 48), m); f.rotation.x = -Math.PI / 2; f.position.y = 0.004; a.add(f); return f; };
  const wall = (m, z = -9, w = 30, h = 12) => at(a, new THREE.Mesh(new THREE.PlaneGeometry(w, h), m), 0, h / 2 - 0.5, z);
  let cfg = { sky: 0x9fd6ff, fog: [9, 20], pad: 0x5fa845, rim: 0x3c7a2a };
  if (id === 'grader') {
    // THE GRADING LAB: a white tiled floor, UV tubes across the ceiling, racks of slabs on the back wall, the sealing press.
    floor(new THREE.MeshPhongMaterial({ color: 0xeef0f6, shininess: 60 })); const grid = new THREE.GridHelper(24, 32, 0xb7a6ef, 0xd2c9f4); grid.position.y = 0.01; a.add(grid);
    wall(toon(0xe2def5)); for (let k = 0; k < 3; k++) { const tube = glow(at(a, box(14, 0.12, 0.12, basic(0xd9c4ff)), 0, 5.4, -2 - k * 2.5)); const halo = at(a, box(14, 0.5, 0.5, basic(0xb98cff, { transparent: true, opacity: 0.18, depthWrite: false })), 0, 5.4, -2 - k * 2.5); halo.userData.noOutline = true; ticks.push(t => { tube.material.color.setHSL(0.74, 1, 0.86 + Math.sin(t * 3 + k) * 0.04); }); }
    const uv = new THREE.PointLight(0xb98cff, 2.2, 14); uv.position.set(1, 4.5, -3); a.add(uv);
    const art = slabArt(); for (let r = 0; r < 4; r++) { at(a, box(16, 0.06, 0.4, toon(0xb8b2d6)), 0, 1.4 + r * 1.05, -8.7); for (let c = 0; c < 22; c++) { const s = at(a, box(0.5, 0.72, 0.06, toon(0xf2f2f8)), -7.6 + c * 0.72, 1.82 + r * 1.05, -8.6); const face = at(s, new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.46), basic(0xffffff, { map: art })), 0, -0.05, 0.035); face.userData.noOutline = true; at(s, box(0.42, 0.12, 0.02, basic([0xd8262e, 0x2b6cff, 0x1e9e5a][(r + c) % 3])), 0, 0.27, 0.03); } }
    const press = at(a, new THREE.Group(), -5.2, 0, -5.5); at(press, box(1.6, 1.0, 1.2, toon(0x6d6a86)), 0, 0.5, 0); at(press, box(0.25, 2.6, 0.25, toon(0x4a4762)), -0.6, 1.8, 0); at(press, box(0.25, 2.6, 0.25, toon(0x4a4762)), 0.6, 1.8, 0); at(press, box(1.6, 0.3, 1.2, toon(0x6d6a86)), 0, 3.2, 0); const ram = at(press, box(1.1, 0.5, 0.9, toon(0xb98cff)), 0, 2.4, 0);
    ticks.push(t => { ram.position.y = 1.55 + Math.max(0, Math.sin(t * 1.3)) * 1.1; });
    cfg = { sky: 0xe6e2f6, fog: [11, 26], pad: 0xd9dbe8, rim: 0x8a5cf0 };
  } else if (id === 'foil') {
    // THE PRISM HALL: a dark mirror floor, rainbow beams sweeping, prisms turning in the air, stars.
    floor(new THREE.MeshPhongMaterial({ color: 0x14122c, shininess: 140, specular: 0x9b7bff }));
    const beams = RAINBOW.map((c, k) => { const b = at(a, new THREE.Mesh(new THREE.ConeGeometry(1.1, 10, 20, 1, true), basic(c, { transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })), -7 + k * 2.8, 5, -6); b.userData.noOutline = true; return b; });
    ticks.push(t => beams.forEach((b, k) => { b.rotation.z = Math.sin(t * 0.5 + k) * 0.45; }));
    const prisms = []; for (let k = 0; k < 9; k++) { const p = at(a, new THREE.Mesh(new THREE.OctahedronGeometry(0.35 + (k % 3) * 0.12), new THREE.MeshNormalMaterial({ flatShading: true })), -6 + k * 1.6, 2.6 + (k % 3) * 1.1, -5.5 - (k % 2) * 1.5); p.userData.noOutline = true; prisms.push(p); }
    ticks.push(t => prisms.forEach((p, k) => { p.rotation.set(t * 0.7 + k, t * 0.9 + k * 2, 0); p.position.y = 2.6 + (k % 3) * 1.1 + Math.sin(t * 1.2 + k) * 0.25; }));
    const sg = new THREE.BufferGeometry(), sp = []; for (let k = 0; k < 220; k++) sp.push(((k * 73) % 300) / 10 - 15, ((k * 37) % 90) / 10 + 0.5, -4 - ((k * 53) % 70) / 10); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07 })); a.add(stars);
    ticks.push(t => { stars.material.opacity = 1; stars.material.size = 0.06 + Math.sin(t * 4) * 0.015; });
    const pl = new THREE.PointLight(0xc9a2ff, 2, 12); pl.position.set(3, 4, -2); a.add(pl);
    cfg = { sky: 0x0c0a1e, fog: [8, 24], pad: 0x2c2558, rim: 0xc9a2ff };
  } else if (id === 'archivist') {
    // THE STACKS: worn floorboards, long boxes stacked to the ceiling all round, bare bulbs on cords, dust in the air.
    floor(toon(0xffffff, { map: canvasTex(128, 128, (x, w, h) => { for (let k = 0; k < 8; k++) { x.fillStyle = k % 2 ? '#6b4a2e' : '#5e4028'; x.fillRect(0, k * 16, w, 16); x.fillStyle = '#3a2616'; x.fillRect(0, k * 16 + 15, w, 1); x.fillRect(((k * 47) % 100) + 10, k * 16, 1, 16); } }, true) }));
    a.children[a.children.length - 1].material.map.repeat.set(6, 6);
    const boxM = toon(0xe8dfc8), lidM = toon(0xd2c6a8), labM = basic(0xffffff, { map: canvasTex(64, 24, (x, w, h) => { x.fillStyle = '#f8f4ea'; x.fillRect(0, 0, w, h); x.fillStyle = '#2a2018'; x.font = 'bold 11px sans-serif'; x.fillText('A - F', 6, 16); x.fillRect(40, 8, 18, 2); x.fillRect(40, 13, 14, 2); }) });
    const stack = (x, z, n, ry = 0) => { for (let k = 0; k < n; k++) { const b = at(a, new THREE.Group(), x + ((k * 13) % 5 - 2) * 0.03, 0.27 + k * 0.52, z); b.rotation.y = ry + ((k * 7) % 5 - 2) * 0.03; at(b, box(1.15, 0.5, 0.62, boxM), 0, 0, 0); at(b, box(1.2, 0.08, 0.66, lidM), 0, 0.22, 0); const lab = at(b, new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), labM), 0, -0.02, 0.315); lab.userData.noOutline = true; } };
    for (let c = 0; c < 13; c++) stack(-7.8 + c * 1.25, -7.2, 6 + ((c * 5) % 5));
    for (let c = 0; c < 4; c++) { stack(-7.5, -5.4 + c * 1.3, 4 + (c % 3), Math.PI / 2); stack(8.8, -5.6 + c * 1.3, 5 + (c % 2), -Math.PI / 2); }
    for (const [x, z] of [[-3, -3.5], [2.5, -4.5], [6.5, -2.5]]) { at(a, cyl(0.008, 0.008, 3, basic(0x111111)), x, 5.3, z); const bulb = glow(at(a, ball(0.12, basic(0xffe2a0), 10), x, 3.8, z)); const l = new THREE.PointLight(0xffc070, 1.6, 7); l.position.set(x, 3.6, z); a.add(l); ticks.push(t => { l.intensity = 1.4 + Math.sin(t * 7 + x) * 0.08; bulb.position.x = x + Math.sin(t * 0.8 + z) * 0.04; }); }
    const dg = new THREE.BufferGeometry(), dp = []; for (let k = 0; k < 160; k++) dp.push(((k * 61) % 160) / 10 - 8, ((k * 29) % 50) / 10, -1 - ((k * 43) % 60) / 10); dg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3)); const dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffe9b8, size: 0.035, transparent: true, opacity: 0.7 })); a.add(dust);
    ticks.push(t => { dust.position.y = (t * 0.05) % 0.5; dust.position.x = Math.sin(t * 0.2) * 0.2; });
    cfg = { sky: 0x1a130e, fog: [7, 19], pad: 0xa8402e, rim: 0xe8c47a };
  } else if (id === 'inker') {
    // THE SPLASH PAGE: the floor is a comic page (panel borders, halftone in three inks), a giant page behind with a sound
    // effect drawn on it, ink splats on the ground.
    const page = (w, h, word) => canvasTex(w, h, (x) => { x.fillStyle = '#f6f1e4'; x.fillRect(0, 0, w, h); const cols = [['#ff5a8c', 3], ['#50c8ff', 4], ['#ffdc3c', 3]]; const cells = [[0, 0, 0.55, 0.45], [0.55, 0, 0.45, 0.45], [0, 0.45, 0.35, 0.55], [0.35, 0.45, 0.65, 0.55]]; cells.forEach(([cx, cy, cw, ch], k) => { const [c, r] = cols[k % 3]; x.fillStyle = c; for (let yy = cy * h + 10; yy < (cy + ch) * h - 6; yy += 12) for (let xx = cx * w + 10 + ((yy / 12) % 2) * 6; xx < (cx + cw) * w - 6; xx += 12) { x.beginPath(); x.arc(xx, yy, r, 0, 7); x.fill(); } x.lineWidth = 12; x.strokeStyle = '#141018'; x.strokeRect(cx * w + 6, cy * h + 6, cw * w - 12, ch * h - 12); }); if (word) { x.save(); x.translate(w * 0.55, h * 0.3); x.rotate(-0.12); x.font = 'italic 900 ' + Math.round(h * 0.2) + 'px Impact, "Arial Black", sans-serif'; x.textAlign = 'center'; x.lineJoin = 'round'; x.lineWidth = 26; x.strokeStyle = '#141018'; x.strokeText(word, 0, 0); x.fillStyle = '#ffdc3c'; x.fillText(word, 0, 0); x.lineWidth = 5; x.strokeStyle = '#ff5a8c'; x.strokeText(word, 0, 0); x.restore(); } });
    floor(toon(0xffffff, { map: page(512, 512) }), 11);
    wall(basic(0xffffff, { map: page(1024, 512, 'KRAKA-THOOM!') }), -8.5, 26, 13);
    for (const [x, z, r] of [[-3.5, -1.5, 0.9], [5.5, -1, 0.6], [-1, -5, 0.7], [7, -5.5, 1.1]]) { const s = at(a, new THREE.Mesh(new THREE.CircleGeometry(r, 18), basic(0x141018)), x, 0.012, z); s.rotation.x = -Math.PI / 2; s.userData.noOutline = true; for (let k = 0; k < 6; k++) { const d = at(a, new THREE.Mesh(new THREE.CircleGeometry(r * 0.22, 10), basic(0x141018)), x + Math.cos(k * 1.05) * r * 1.5, 0.012, z + Math.sin(k * 1.05) * r * 1.5); d.rotation.x = -Math.PI / 2; } }
    cfg = { sky: 0xf6f1e4, fog: [14, 32], pad: 0xffffff, rim: 0x141018 };
  }
  a.userData = { ...cfg, tick: t => ticks.forEach(f => f(t)) };
  return a;
}

// ── THE SIGNATURE MOVES ─────────────────────────────────────────────────────────────────────────────────────────
// Each returns an effect: { update(now) -> still going? }, added to the scene and taken back out when it ends.
export function signatureFx(id, scene, from, target) {
  const t0 = performance.now(), parts = [], add = o => { scene.add(o); parts.push(o); return o; }, done = () => { parts.forEach(o => scene.remove(o)); return false; };
  const to = target.clone();
  if (id === 'grader') {
    // PERFECT 10: a giant slab drops from above over your beast, seals it in (a flash of the label), then lifts away.
    const slab = add(new THREE.Group()); at(slab, box(1.5, 1.75, 1.2, new THREE.MeshPhongMaterial({ color: 0xeef6ff, transparent: true, opacity: 0.28, shininess: 140, specular: 0xffffff, depthWrite: false })), 0, 0, 0);
    const lab = at(slab, new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.38), basic(0xffffff, { map: labelTex('PERFECT 10'), transparent: true })), 0, 0.62, 0.61);
    const flash = add(new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 12), basic(0xb98cff, { transparent: true, opacity: 0, depthWrite: false })));
    return { update(now) { const k = (now - t0) / 1600; if (k >= 1) return done(); const drop = Math.min(1, k / 0.22); slab.position.set(to.x + 0.1, to.y + 0.7 + (1 - drop * drop) * 5 + (k > 0.8 ? (k - 0.8) * 20 : 0), to.z); slab.rotation.y = -0.25; flash.position.copy(to).add(new THREE.Vector3(0, 0.9, 0)); flash.material.opacity = k > 0.22 && k < 0.4 ? 0.45 * (1 - (k - 0.22) / 0.18) : 0; lab.scale.setScalar(k > 0.22 && k < 0.5 ? 1 + Math.sin((k - 0.22) * 30) * 0.06 : 1); return true; } };
  }
  if (id === 'foil') {
    // PRISM BURST: seven foil cards, one of each colour and a white, fanned out of her hand and spinning into your beast.
    const holo = holoTex(), cards = RAINBOW.concat('#ffffff').map((c, k) => { const m = add(new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.48), basic(c, { map: holo, side: THREE.DoubleSide }))); m.userData.k = k; return m; });
    return { update(now) { const k = (now - t0) / 1300; if (k >= 1) return done(); cards.forEach(c => { const j = c.userData.k, f = Math.min(1, Math.max(0, (k - j * 0.04) / 0.75)); c.visible = f > 0; const spread = (j - 3) * 0.55 * Math.sin(f * Math.PI); c.position.lerpVectors(from, to.clone().add(new THREE.Vector3(0, 0.8, 0)), f).add(new THREE.Vector3(spread, Math.sin(f * Math.PI) * 1.1, -spread * 0.4)); c.rotation.set(f * 8 + j, f * 11, f * 4); }); return true; } };
  }
  if (id === 'archivist') {
    // BOX AVALANCHE: five long boxes tumble down out of the dark onto your beast, bounce once and settle, then they're gone.
    const boxM = toon(0xe8dfc8), lidM = toon(0xd2c6a8);
    const boxes = [0, 1, 2, 3, 4].map(k => { const b = add(new THREE.Group()); at(b, box(1.15, 0.5, 0.62, boxM), 0, 0, 0); at(b, box(1.2, 0.08, 0.66, lidM), 0, 0.22, 0); b.userData = { k, ox: ((k * 7) % 5 - 2) * 0.35, oz: ((k * 3) % 5 - 2) * 0.25, spin: 1 + (k % 3) }; return b; });
    return { update(now) { const k = (now - t0) / 1700; if (k >= 1) return done(); boxes.forEach(b => { const u = b.userData, f = Math.min(1, Math.max(0, (k - u.k * 0.09) / 0.4)), bounce = f >= 1 ? Math.abs(Math.sin(Math.min(1, (k - u.k * 0.09 - 0.4) / 0.25) * Math.PI)) * 0.4 * Math.max(0, 1 - (k - u.k * 0.09 - 0.4) * 3) : 0; b.visible = k - u.k * 0.09 > 0 && k < 0.95; b.position.set(to.x + u.ox, to.y + 0.25 + u.k * 0.12 + (1 - f * f) * 7 + bounce, to.z + u.oz); b.rotation.set(f < 1 ? f * u.spin * 3 : 0.1 * u.k, u.k * 0.5, f < 1 ? f * u.spin * 2 : 0); }); return true; } };
  }
  if (id === 'inker') {
    // SPLASH PAGE: a string of ink flung off the brush tip, a black splat spreading under your beast, and the sound
    // effect drawn in the air over it.
    const ink = basic(0x141018), blobs = [0, 1, 2, 3, 4, 5, 6, 7].map(k => { const m = add(new THREE.Mesh(new THREE.SphereGeometry(0.12 - k * 0.008, 10, 8), ink)); m.userData.k = k; return m; });
    const splat = add(new THREE.Mesh(new THREE.CircleGeometry(1, 24), ink)); splat.rotation.x = -Math.PI / 2;
    const word = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: sfxTex('SPLOOSH!', '#ffdc3c'), transparent: true, depthWrite: false })));
    return { update(now) { const k = (now - t0) / 1700; if (k >= 1) return done(); blobs.forEach(m => { const f = Math.min(1, Math.max(0, (k - m.userData.k * 0.025) / 0.4)); m.visible = f > 0 && f < 1; m.position.lerpVectors(from, to.clone().add(new THREE.Vector3(0, 0.6, 0)), f).add(new THREE.Vector3(0, Math.sin(f * Math.PI) * 1.4, 0)); m.scale.set(1, 1 + f * 0.8, 1); }); const s = Math.min(1, Math.max(0, (k - 0.38) / 0.12)); splat.position.set(to.x, 0.14, to.z); splat.scale.setScalar(0.01 + s * 1.3); splat.visible = s > 0 && k < 0.92; const w = Math.min(1, Math.max(0, (k - 0.4) / 0.1)); word.visible = w > 0 && k < 0.95; word.position.set(to.x + 1.5, to.y + 1.15 + w * 0.15, to.z - 1.2); word.scale.set(2.6 * (0.6 + w * 0.4), 0.81 * (0.6 + w * 0.4), 1); word.material.rotation = -0.12; return true; } };
  }
  return { update() { return false; } };
}
