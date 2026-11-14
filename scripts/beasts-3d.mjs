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
