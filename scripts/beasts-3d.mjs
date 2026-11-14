// LONG BOX BEASTS IN 3D (store, 2026-11-14: "DS and 3DS mode ... models them kind of like the corresponding games"):
// the battle with real 3D beasts -- each built from its body type (blob, biped, four-legged, bird, bug, serpent) in its
// own colours (from its name), standing on round grass platforms under a sky, the camera low behind yours looking up at
// theirs, the HP boxes and the move panel drawn over it. Same calls as the pixel battle (set, attack, evolve, levelUp).
// Original models built from simple shapes here; nothing from any game. Nothing by chance.
import * as THREE from '../assets/vendor/three-0.160.0.module.min.js';
import { beastType, beastRamp, hashOf, moveAnim, foeMoveFor, DEFAULT_MOVES, STARTER } from './beasts.mjs';

const col = c => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
const mat = (c, o = {}) => new THREE.MeshPhongMaterial({ color: col(c), shininess: 40, ...o });
const ball = (r, m, s = 18) => new THREE.Mesh(new THREE.SphereGeometry(r, s, Math.round(s * 0.7)), m);
const cyl = (a, b, h, m, s = 12) => new THREE.Mesh(new THREE.CylinderGeometry(a, b, h, s), m);
const cone = (r, h, m, s = 10) => new THREE.Mesh(new THREE.ConeGeometry(r, h, s), m);
const at = (p, o, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); p.add(o); return o; };

// One beast, built from its name: body type, colours, ears or horns, a tail, big eyes (front) -- and an idle animation.
export function buildBeast3D(name) {
  const nm = String(name).toUpperCase(), type = beastType(nm), r = beastRamp(nm), h = hashOf(nm);
  const body = mat(r[1]), belly = mat(r[0]), dark = mat(r[2]), eyeW = mat([250, 250, 250], { shininess: 90 }), eyeB = mat([20, 20, 28], { shininess: 120 });
  const g = new THREE.Group(), parts = { legs: [], wings: [], tail: null, head: null };
  const eyes = (p, x, y, z, s = 1) => { for (const sx of [-1, 1]) { at(p, ball(0.11 * s, eyeW, 12), sx * x, y, z).scale.set(1, 1.2, 0.6); at(p, ball(0.055 * s, eyeB, 10), sx * x * 0.95, y - 0.01, z + 0.05 * s); at(p, ball(0.02 * s, eyeW, 6), sx * x * 0.9 - 0.02, y + 0.03, z + 0.08 * s); } };
  if (type === 'blob') { const b = at(g, ball(0.62, body, 24), 0, 0.5, 0); b.scale.set(1.15, 0.85, 1); at(g, ball(0.45, belly, 18), 0, 0.42, 0.25).scale.set(1, 0.7, 0.6); parts.head = b; eyes(g, 0.22, 0.72, 0.5); }
  else if (type === 'biped') {
    for (const sx of [-1, 1]) parts.legs.push(at(g, ball(0.16, dark, 12), sx * 0.24, 0.12, 0.05));
    at(g, ball(0.42, body, 20), 0, 0.55, 0).scale.set(1, 1.05, 0.9); at(g, ball(0.3, belly, 16), 0, 0.5, 0.18).scale.set(1, 1.1, 0.6);
    for (const sx of [-1, 1]) at(g, ball(0.11, body, 10), sx * 0.44, 0.6, 0.05).scale.set(0.8, 1.4, 0.8);
    const head = at(g, new THREE.Group(), 0, 1.15, 0.02); parts.head = head; at(head, ball(0.4, body, 20), 0, 0, 0);
    eyes(head, 0.16, 0.02, 0.33); if (h % 2 === 0 || /SLABBIT/.test(nm)) for (const sx of [-1, 1]) { const e = at(head, cone(0.09, 0.5, body), sx * 0.17, 0.48, -0.02); e.rotation.z = sx * -0.2; }
    else for (const sx of [-1, 1]) at(head, ball(0.12, body, 10), sx * 0.3, 0.3, 0);
  } else if (type === 'quad') {
    const b = at(g, ball(0.5, body, 20), 0, 0.55, -0.1); b.scale.set(0.95, 0.75, 1.35);
    for (const [x, z] of [[-0.3, 0.35], [0.3, 0.35], [-0.3, -0.5], [0.3, -0.5]]) parts.legs.push(at(g, cyl(0.1, 0.08, 0.42, dark), x, 0.2, z));
    const head = at(g, new THREE.Group(), 0, 0.85, 0.6); parts.head = head; at(head, ball(0.33, body, 18), 0, 0, 0); at(head, ball(0.18, belly, 12), 0, -0.1, 0.22);
    eyes(head, 0.14, 0.08, 0.26, 0.9); for (const sx of [-1, 1]) at(head, cone(0.07, 0.25, dark), sx * 0.2, 0.3, -0.05);
    parts.tail = at(g, cone(0.08, 0.5, body), 0, 0.7, -0.75); parts.tail.rotation.x = -1.1;
  } else if (type === 'bird') {
    at(g, ball(0.48, body, 20), 0, 0.7, 0); at(g, ball(0.32, belly, 16), 0, 0.62, 0.25).scale.set(1, 1.1, 0.6);
    eyes(g, 0.17, 0.85, 0.4); at(g, cone(0.08, 0.2, mat([255, 196, 60])), 0, 0.74, 0.5).rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) { const w = at(g, new THREE.Group(), sx * 0.42, 0.75, 0); const f = at(w, ball(0.3, dark, 12), sx * 0.25, 0, 0); f.scale.set(1.3, 0.25, 0.8); parts.wings.push(w); }
    for (const sx of [-1, 1]) at(g, cyl(0.03, 0.03, 0.3, mat([255, 196, 60])), sx * 0.15, 0.15, 0);
  } else if (type === 'bug') {
    at(g, ball(0.38, dark, 18), 0, 0.42, -0.35).scale.set(1, 0.8, 1.2); const hd = at(g, ball(0.36, body, 18), 0, 0.55, 0.2); parts.head = hd;
    eyes(g, 0.15, 0.62, 0.5, 0.9);
    for (let k = 0; k < 3; k++) for (const sx of [-1, 1]) { const l = at(g, cyl(0.025, 0.02, 0.5, dark, 6), sx * 0.35, 0.2, -0.1 - k * 0.2); l.rotation.z = sx * 1.0; parts.legs.push(l); }
    for (const sx of [-1, 1]) { const a = at(g, cyl(0.015, 0.015, 0.4, dark, 6), sx * 0.12, 0.95, 0.3); a.rotation.z = sx * -0.4; }
  } else {
    for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 1.6; at(g, ball(0.2 - k * 0.006, k % 2 ? body : dark, 12), Math.cos(a) * 0.45, 0.18 + k * 0.02, Math.sin(a) * 0.45 - 0.1); }
    const head = at(g, new THREE.Group(), 0.45, 0.85, 0.15); parts.head = head; at(head, ball(0.3, body, 18), 0, 0, 0).scale.set(1, 0.85, 1.2); eyes(head, 0.12, 0.08, 0.28, 0.85);
  }
  if (/FOIL|HOLO/.test(nm)) g.traverse(o => { if (o.material?.shininess !== undefined) { o.material.shininess = 160; o.material.specular = new THREE.Color(0xffffff); } });
  g.userData = { parts, tick(t) { g.position.y = Math.abs(Math.sin(t * 2.2)) * 0.04; const p = parts; if (p.head) p.head.rotation.y = Math.sin(t * 1.3) * 0.15; p.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 4 + i) * 0.08; }); p.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * Math.sin(t * 7) * 0.4; }); if (p.tail) p.tail.rotation.z = Math.sin(t * 3) * 0.3; } };
  return g;
}

export function createBattle3D(canvas, { scale = 3 } = {}) {
  const W = 240, H = 160; canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d'), gl = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas: gl, antialias: true, alpha: false, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.setSize(W * scale, 106 * scale, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fd6ff); scene.fog = new THREE.Fog(0x9fd6ff, 9, 20);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6fae4a, 1.2)); const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(-3, 6, 4); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(36, W / 106, 0.1, 60); cam.position.set(-0.4, 1.5, 5.6); cam.lookAt(0.9, 0.6, -1.4);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: 0x8ccf6a })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const pad = (x, z, rad) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.05, 0.12, 40), new THREE.MeshLambertMaterial({ color: 0x5fa845 })); p.position.set(x, 0.06, z); scene.add(p); const rim = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.04, 6, 40), new THREE.MeshLambertMaterial({ color: 0x3c7a2a })); rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.12, z); scene.add(rim); return p; };
  pad(2.3, -2.2, 1.1); pad(-1.5, 1.7, 1.2);
  for (let k = 0; k < 7; k++) { const tr = new THREE.Group(); tr.position.set(-6 + k * 2.3, 0, -8 - (k % 3)); const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 8), new THREE.MeshLambertMaterial({ color: 0x6b4a2a })); tk.position.y = 0.6; tr.add(tk); const lf = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 9), new THREE.MeshLambertMaterial({ color: 0x3f8f3a })); lf.position.y = 1.7; tr.add(lf); scene.add(tr); }
  let b = null, mineM = null, foeM = null, mineName = '', foeName = '', moves = DEFAULT_MOVES, pick = 0, msg = '', anim = null, foeAnim = null, evo = null, raf = 0, last = 0, key = '', introAt = -1e9, lastTenth = 10, foeHits = 0, shownFoe = 1;
  const shot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 9), new THREE.MeshBasicMaterial({ color: 0xffe14a })); shot.visible = false; scene.add(shot);
  const place = (name, mine) => { const m = buildBeast3D(name); if (mine) { m.position.set(-1.5, 0.12, 1.7); m.rotation.y = 2.5; m.scale.setScalar(0.95); } else { m.position.set(2.3, 0.12, -2.2); m.rotation.y = -0.55; m.scale.setScalar(1.15); } scene.add(m); return m; };
  const say = (t, ms = 2600) => { msg = t; clearTimeout(say.t); say.t = setTimeout(() => { msg = ''; }, ms); };
  function ui() {
    const S = scale, f = (s, x, y, size = 6, c = '#202830') => { ctx.fillStyle = c; ctx.font = `${size * S}px "Press Start 2P", monospace`; ctx.fillText(s, x * S, y * S); };
    const box = (x, y, w, hh, name, hp, lv) => { ctx.fillStyle = '#f8f8f8ee'; ctx.strokeStyle = '#202830'; ctx.lineWidth = 2 * S; ctx.beginPath(); ctx.roundRect(x * S, y * S, w * S, hh * S, 6 * S); ctx.fill(); ctx.stroke(); f(name.slice(0, 11), x + 6, y + 11, 6); if (lv) f('L' + lv, x + w - 26, y + 11, 6); ctx.fillStyle = '#3a4250'; ctx.fillRect((x + 20) * S, (y + 16) * S, (w - 28) * S, 5 * S); ctx.fillStyle = hp < 0.25 ? '#e84a3a' : hp < 0.5 ? '#f2c230' : '#3ccf5a'; ctx.fillRect((x + 21) * S, (y + 17) * S, Math.max(0, (w - 30) * hp) * S, 3 * S); f('HP', x + 6, y + 21, 5); };
    if (b) { box(6, 6, 104, 26, b.foe.name, Math.max(0, shownFoe)); box(130, 72, 104, 28, b.mine.name, b.mine.hp, b.mine.level || 1); }
    // The DS-style touch panel: the line of text, then the four moves as big rounded buttons.
    ctx.fillStyle = '#2a3240'; ctx.fillRect(0, 106 * S, W * S, 54 * S);
    f(msg || (b ? (b.mine.hp <= 0 ? b.mine.name.slice(0, 10) + ' FAINTED! CHAT: FOLLOW/SHARE TO REVIVE' : b.kind === 'rival' ? b.trainer.slice(0, 22) + ' SENT OUT ' + b.foe.name.slice(0, 10) + '!' : 'WHAT WILL ' + b.mine.name + ' DO?') : ''), 8, 117, 6, '#f8f8f8');
    moves.forEach((m, i) => { const x = 6 + (i % 2) * 116, y = 122 + Math.floor(i / 2) * 18, on = i === pick; ctx.fillStyle = on ? '#ffd84a' : '#4d6fbf'; ctx.beginPath(); ctx.roundRect(x * S, y * S, 112 * S, 15 * S, 5 * S); ctx.fill(); f((i + 1) + ' ' + m, x + 6, y + 10, 6, on ? '#202830' : '#ffffff'); });
  }
  function frame(now) {
    raf = requestAnimationFrame(frame); if (now - last < 33) return; last = now; const t = now / 1000;
    if (mineM) mineM.userData.tick(t); if (foeM) foeM.userData.tick(t + 1.3);
    // Intro: the foe drops in, yours slides in.
    const it = (now - introAt) / 1600; if (foeM && it < 1) { foeM.position.y = 0.12 + Math.max(0, 1 - it * 1.6) * 3; } if (mineM && it < 1) mineM.position.x = -1.5 - Math.max(0, 1 - it * 1.3) * 3;
    // Attacks: a glowing shot from one to the other, the one hit flashing and shaking.
    const a = anim ? (now - anim.at) / 1200 : -1, fa = foeAnim ? (now - foeAnim.at) / 1200 : -1;
    shot.visible = false;
    if (a >= 0 && a < 0.6 && mineM && foeM) { shot.visible = true; shot.position.lerpVectors(mineM.position, foeM.position, a / 0.6).add(new THREE.Vector3(0, 0.8 + Math.sin(a / 0.6 * Math.PI) * 0.8, 0)); }
    if (fa >= 0 && fa < 0.6 && mineM && foeM) { shot.visible = true; shot.position.lerpVectors(foeM.position, mineM.position, fa / 0.6).add(new THREE.Vector3(0, 0.8 + Math.sin(fa / 0.6 * Math.PI) * 0.6, 0)); }
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
      if (k && k !== key) { introAt = performance.now(); shownFoe = next.foe.hp; lastTenth = Math.ceil((next.mine?.hp ?? 1) * 10); }
      if (next && b && k === key) { const tenth = Math.ceil((next.mine?.hp ?? 1) * 10); if (tenth < lastTenth && performance.now() - introAt > 1600) { const m = foeMoveFor(next.foe.name, foeHits++); foeAnim = { kind: moveAnim(m), at: performance.now() }; say((next.kind === 'wild' ? 'WILD ' : 'FOE ') + next.foe.name.slice(0, 10) + ' USED ' + m + '!'); } lastTenth = tenth; }
      key = k; b = next; if (mv) moves = mv; if (Number.isInteger(p)) pick = p;
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
import { routeFor, posAt, walkAt, ENCOUNTERS, TILE_RAMPS, timeOfDay, MAP_W, MAP_H } from './beasts.mjs';
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
  function build() {
    if (routeG) scene.remove(routeG); routeG = new THREE.Group(); scene.add(routeG);
    const g = route.grid, n = MAP_W * MAP_H, ground = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.2, 1), new THREE.MeshLambertMaterial(), n), m4 = new THREE.Matrix4(), c = new THREE.Color();
    let i = 0; const kinds = {};
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const t = g[y][x], base = [3, 9, 10, 13, 21, 22].includes(t) ? (route.biomeAt(y) === 'snow' ? 19 : route.biomeAt(y) === 'city' ? 20 : route.biomeAt(y) === 'cave' ? 18 : route.biomeAt(y) === 'volcano' ? 24 : 0) : [5, 6, 7, 11, 12].includes(t) ? 1 : t;
      const p = tile(x, y), lift = t === 4 || t === 23 ? -0.12 : t === 16 ? 0.15 : t === 17 ? 0.7 : 0;
      m4.makeScale(1, t === 17 ? 8 : 1, 1); m4.setPosition(p.x, lift - 0.1, p.z); ground.setMatrixAt(i, m4);
      const rc = (TILE_RAMPS[base] || TILE_RAMPS[0])[t === 4 ? 1 : t === 23 ? 1 : t === 17 ? 2 : 1]; ground.setColorAt(i, c.setRGB(rc[0] / 255, rc[1] / 255, rc[2] / 255)); i++;
      (kinds[t] ||= []).push(p);
    }
    ground.instanceMatrix.needsUpdate = true; ground.instanceColor.needsUpdate = true; routeG.add(ground);
    const inst = (list, geo, material, f) => { if (!list?.length) return; const m = new THREE.InstancedMesh(geo, material, list.length); list.forEach((p, k) => { f(m4, p, k); m.setMatrixAt(k, m4); }); m.instanceMatrix.needsUpdate = true; routeG.add(m); };
    // Trees (pines in the snow), flowers, tall grass, boulders, lamps, gravestones, lava glow.
    const snowy = p => route.biomeAt(Math.floor(p.z)) === 'snow';
    inst(kinds[3], new THREE.CylinderGeometry(0.08, 0.12, 0.5, 6), mat([107, 74, 42]), (m, p) => m.makeTranslation(p.x, 0.25, p.z));
    inst(kinds[3], new THREE.ConeGeometry(0.42, 1.1, 8), mat([47, 127, 58]), (m, p, k) => { m.makeScale(1, 1 + ((k * 7) % 5) * 0.08, 1); m.setPosition(p.x, 0.95, p.z); });
    inst((kinds[3] || []).filter(snowy), new THREE.ConeGeometry(0.3, 0.45, 8), mat([250, 250, 255]), (m, p) => m.makeTranslation(p.x, 1.35, p.z));
    inst(kinds[2], new THREE.ConeGeometry(0.12, 0.45, 4), mat([60, 150, 50]), (m, p, k) => { m.makeTranslation(p.x + ((k % 3) - 1) * 0.22, 0.22, p.z + (((k >> 1) % 3) - 1) * 0.22); });
    inst(kinds[9], new THREE.SphereGeometry(0.08, 6, 5), mat([242, 84, 132]), (m, p, k) => m.makeTranslation(p.x + ((k % 3) - 1) * 0.25, 0.08, p.z + (((k >> 2) % 3) - 1) * 0.25));
    inst(kinds[13], new THREE.DodecahedronGeometry(0.4), mat([150, 150, 140]), (m, p) => m.makeTranslation(p.x, 0.3, p.z));
    inst(kinds[21], new THREE.CylinderGeometry(0.04, 0.05, 1.4, 6), mat([60, 60, 70]), (m, p) => m.makeTranslation(p.x, 0.7, p.z));
    inst(kinds[21], new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff3a0 }), (m, p) => m.makeTranslation(p.x, 1.45, p.z));
    inst(kinds[22], new THREE.BoxGeometry(0.4, 0.55, 0.12), mat([170, 170, 182]), (m, p) => m.makeTranslation(p.x, 0.27, p.z));
    inst(kinds[23], new THREE.BoxGeometry(1, 0.05, 1), new THREE.MeshBasicMaterial({ color: 0xff7a1a }), (m, p) => m.makeTranslation(p.x, -0.1, p.z));
    inst(kinds[4], new THREE.BoxGeometry(1, 0.05, 1), new THREE.MeshPhongMaterial({ color: 0x3a8ae0, transparent: true, opacity: 0.85, shininess: 120 }), (m, p) => m.makeTranslation(p.x, -0.05, p.z));
    // Houses: the wall and roof tiles grouped into buildings.
    inst(kinds[5], new THREE.BoxGeometry(1, 1.2, 1), mat([240, 232, 214]), (m, p) => m.makeTranslation(p.x, 0.6, p.z));
    inst(kinds[6], new THREE.BoxGeometry(1, 0.5, 1), mat([210, 80, 64]), (m, p) => m.makeTranslation(p.x, 1.35, p.z));
    inst(kinds[7], new THREE.BoxGeometry(0.5, 0.8, 1.02), mat([120, 72, 34]), (m, p) => m.makeTranslation(p.x, 0.4, p.z));
    inst([...(kinds[11] || []), ...(kinds[12] || [])], new THREE.BoxGeometry(1.02, 0.4, 1.02), mat([255, 210, 64]), (m, p) => m.makeTranslation(p.x, 1.2, p.z));
    inst(kinds[8], new THREE.BoxGeometry(1, 0.35, 0.08), mat([200, 170, 120]), (m, p) => m.makeTranslation(p.x, 0.18, p.z));
    // The route's items.
    itemG.clear(); for (const it of route.items) { const p = posAt(route, it.t), o = ball(0.16, mat(it.kind === 'STONE' ? [140, 255, 120] : it.kind === 'CANDY' ? [255, 140, 220] : it.kind === 'COIN' ? [255, 210, 60] : [240, 80, 80], { emissive: 0x222222 }), 12); o.position.copy(tile(p.x, p.y)).setY(0.4); o.userData.t = it.t; itemG.add(o); }
  }
  function set(s) {
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
    r.render(scene, cam); ctx.drawImage(gl, 0, 0);
  }
  return { set, start() { if (!raf) raf = requestAnimationFrame(frame); }, stop() { cancelAnimationFrame(raf); raf = 0; }, get route() { return route; } };
}
