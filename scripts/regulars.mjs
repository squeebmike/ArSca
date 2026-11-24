// THE REGULARS (store, 2026-11-24: "More regulars added to our show like we did with Fister ... I don't need full bosses").
// Quick cameos the host taps from the remote; each plays once on the overlay and is gone. Original cartoon characters,
// drawn here in code (no photos):
//   seen -- SEEN BUT NOT HEARD: pops up from the bottom of the screen, looks one way, then the other, covers his mouth,
//           and slowly sinks back down. "SEEN BUT NOT HEARD".
//   amos -- AMOS, the hippie: drifts in from the side, long hair, headband, round tinted glasses, beard, tie-dye; flashes
//           a peace sign while flowers and peace signs float up. "AMOS: PEACE, LOVE & COMICS".
// Everything comes from the clock (start time + elapsed) -- every overlay shows the same moment; nothing random.
export const REGULARS = { seen: { ms: 7000, label: '🤫 SEEN BUT NOT HEARD' }, amos: { ms: 8000, label: '✌ AMOS' } };
const ease = k => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const span = (t, a, b) => ease((t - a) / (b - a));

function text(g, s, x, y, size, fill, stroke = '#0b0612', align = 'center') {
  g.font = `900 ${size}px system-ui, "Segoe UI", sans-serif`; g.textAlign = align; g.lineJoin = 'round';
  g.lineWidth = Math.max(4, size / 6); g.strokeStyle = stroke; g.strokeText(s, x, y); g.fillStyle = fill; g.fillText(s, x, y);
}

// SEEN BUT NOT HEARD: a hooded head and shoulders, big watchful eyes; t = 0..1 through the cameo.
export function drawSeen(g, W, H, t) {
  g.clearRect(0, 0, W, H);
  const up = Math.min(span(t, 0, 0.16), 1 - span(t, 0.8, 1)); // up fast, down slowly
  const cx = W / 2, baseY = H + 20 - up * 430, s = 1;
  // Where he looks: middle, left, middle, right, middle -- then down while the hand comes up.
  const look = t < 0.2 ? 0 : t < 0.34 ? -span(t, 0.2, 0.26) : t < 0.48 ? -1 + 2 * span(t, 0.36, 0.44) : t < 0.58 ? 1 - span(t, 0.5, 0.58) : 0;
  const hand = span(t, 0.58, 0.68) * (1 - span(t, 0.92, 1));
  g.save(); g.translate(cx + look * 14, baseY); g.rotate(look * 0.06); g.scale(s, s); // the head turns a little with the look
  // Shoulders + hoodie.
  g.fillStyle = '#2b2f3a'; g.beginPath(); g.moveTo(-210, 260); g.quadraticCurveTo(-200, 60, 0, 40); g.quadraticCurveTo(200, 60, 210, 260); g.closePath(); g.fill();
  g.fillStyle = '#353a48'; g.beginPath(); g.ellipse(0, -60, 150, 175, 0, 0, Math.PI * 2); g.fill(); // hood
  g.fillStyle = '#1c1f27'; g.beginPath(); g.ellipse(0, -40, 112, 135, 0, 0, Math.PI * 2); g.fill(); // hood opening
  // Face.
  g.fillStyle = '#d9a982'; g.beginPath(); g.ellipse(0, -30, 92, 112, 0, 0, Math.PI * 2); g.fill();
  // Eyes: wide, the pupils sliding with the look; brows up.
  for (const side of [-1, 1]) {
    const ex = side * 38, ey = -55;
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(ex, ey, 26, 30, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1b1b1b'; g.beginPath(); g.arc(ex + look * 15, ey + 4 - hand * 4, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(ex + look * 15 + 4, ey - 1 - hand * 4, 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#4a3222'; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(ex - 22, ey - 42 - hand * 6); g.lineTo(ex + 20, ey - 46 - hand * 10 + side * 3); g.stroke();
  }
  // Mouth (a small flat line), then the hand covers it.
  g.strokeStyle = '#7a3e2e'; g.lineWidth = 7; g.beginPath(); g.moveTo(-18, 38); g.lineTo(18, 38); g.stroke();
  if (hand > 0) {
    const hy = 150 - hand * 120;
    g.fillStyle = '#d9a982'; g.strokeStyle = '#a87a58'; g.lineWidth = 4;
    g.beginPath(); g.roundRect(-70, hy, 140, 70, 34); g.fill(); g.stroke();
    for (let f = 0; f < 3; f++) { g.beginPath(); g.moveTo(-40 + f * 30, hy + 10); g.lineTo(-40 + f * 30, hy + 40); g.stroke(); }
    g.fillStyle = '#2b2f3a'; g.fillRect(-46, hy + 66, 92, 140); // sleeve
  }
  g.restore();
  // The words, beside him while he's up.
  const a = Math.min(span(t, 0.12, 0.24), 1 - span(t, 0.78, 0.9));
  if (a > 0) { g.globalAlpha = a; text(g, 'SEEN BUT', cx + 330, H - 330, 62, '#e9e4ff'); text(g, 'NOT HEARD', cx + 330, H - 260, 62, '#c9b6ff'); text(g, '🤫', cx - 330, H - 290, 90, '#fff', 'transparent'); g.globalAlpha = 1; }
}

// AMOS, the hippie: drifts in from the left, peace sign up, flowers and peace signs floating.
const TIE = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#9b5de5', '#f15bb5'];
export function drawAmos(g, W, H, t) {
  g.clearRect(0, 0, W, H);
  const inn = Math.min(span(t, 0, 0.18), 1 - span(t, 0.85, 1));
  const cx = -260 + inn * (260 + W * 0.3), cy = H - 40, sway = Math.sin(t * Math.PI * 6) * 6;
  // Floating flowers and peace signs (fixed positions, rising on the clock).
  for (let i = 0; i < 14; i++) {
    const x = (i * 157) % W, rise = ((t * 1.4 + i * 0.137) % 1), y = H - rise * H * 0.9, a = Math.min(1, inn * 1.4) * (1 - rise);
    if (a <= 0) continue; g.globalAlpha = a;
    if (i % 3) { const c = TIE[i % TIE.length]; for (let p = 0; p < 5; p++) { g.fillStyle = c; g.beginPath(); g.arc(x + Math.cos(p * 1.257) * 16, y + Math.sin(p * 1.257) * 16, 11, 0, Math.PI * 2); g.fill(); } g.fillStyle = '#ffd166'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); }
    else { g.strokeStyle = '#e9e4ff'; g.lineWidth = 6; g.beginPath(); g.arc(x, y, 24, 0, Math.PI * 2); g.moveTo(x, y - 24); g.lineTo(x, y + 24); g.moveTo(x, y); g.lineTo(x - 17, y + 17); g.moveTo(x, y); g.lineTo(x + 17, y + 17); g.stroke(); }
  }
  g.globalAlpha = 1;
  g.save(); g.translate(cx, cy); g.rotate(sway * 0.004);
  // Tie-dye shirt: rings of color.
  g.save(); g.beginPath(); g.moveTo(-190, 0); g.quadraticCurveTo(-180, -230, 0, -250); g.quadraticCurveTo(180, -230, 190, 0); g.closePath(); g.clip();
  for (let r = 9; r >= 0; r--) { g.fillStyle = TIE[r % TIE.length]; g.beginPath(); g.arc(0, -110, 30 + r * 26, 0, Math.PI * 2); g.fill(); }
  g.restore();
  // Hair (long, behind the face), face, beard.
  g.fillStyle = '#6b4a2b'; g.beginPath(); g.ellipse(0, -370, 125, 170, 0, 0, Math.PI * 2); g.fill(); g.fillRect(-125, -380, 250, 160);
  g.fillStyle = '#e2b48c'; g.beginPath(); g.ellipse(0, -375, 88, 105, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#7a5532'; g.beginPath(); g.moveTo(-80, -360); g.quadraticCurveTo(-70, -230, 0, -215); g.quadraticCurveTo(70, -230, 80, -360); g.quadraticCurveTo(0, -300, -80, -360); g.fill();
  // Headband with a flower, round tinted glasses, a grin.
  g.fillStyle = '#ff4d6d'; g.fillRect(-96, -450, 192, 20); g.fillStyle = '#ffd166'; g.beginPath(); g.arc(70, -440, 16, 0, Math.PI * 2); g.fill();
  for (const sx of [-34, 34]) { g.fillStyle = 'rgba(155,93,229,.75)'; g.strokeStyle = '#3b2a1a'; g.lineWidth = 5; g.beginPath(); g.arc(sx, -385, 26, 0, Math.PI * 2); g.fill(); g.stroke(); }
  g.beginPath(); g.moveTo(-8, -385); g.lineTo(8, -385); g.stroke();
  g.strokeStyle = '#5a2e1e'; g.lineWidth = 6; g.beginPath(); g.arc(0, -330, 26, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  // The peace sign hand, up and waving.
  const wave = span(t, 0.2, 0.3) * (1 - span(t, 0.8, 0.88)), hx = 170, hy = -250 - wave * 170 + Math.sin(t * Math.PI * 10) * 8 * wave;
  if (wave > 0) {
    g.strokeStyle = '#e2b48c'; g.lineWidth = 34; g.lineCap = 'round'; g.beginPath(); g.moveTo(130, -150); g.lineTo(hx, hy + 30); g.stroke();
    g.fillStyle = '#e2b48c'; g.beginPath(); g.ellipse(hx, hy, 34, 30, 0, 0, Math.PI * 2); g.fill();
    for (const a of [-0.25, 0.25]) { g.save(); g.translate(hx + a * 30, hy - 20); g.rotate(a); g.beginPath(); g.roundRect(-11, -70, 22, 72, 11); g.fill(); g.restore(); }
  }
  g.restore();
  const a = Math.min(span(t, 0.16, 0.28), 1 - span(t, 0.8, 0.92));
  if (a > 0) { g.globalAlpha = a; text(g, 'AMOS', W * 0.68, H - 380, 88, '#ffd166'); text(g, 'PEACE, LOVE & COMICS ✌', W * 0.68, H - 300, 48, '#e9e4ff'); g.globalAlpha = 1; }
}

// One canvas over the overlay: play(kind, startedAt, endsAt) runs the cameo on the given clock.
export function createRegulars(doc, { now = () => Date.now() } = {}) {
  const c = doc.createElement('canvas'); c.id = 'mana-regular'; c.width = 1080; c.height = 900;
  c.style.cssText = 'position:fixed;left:50%;bottom:0;width:1080px;height:900px;transform:translateX(-50%);pointer-events:none;z-index:60;display:none';
  doc.body.appendChild(c); const g = c.getContext('2d');
  let cur = null, raf = 0;
  const frame = () => {
    raf = 0; if (!cur) return;
    const t = (now() - cur.at) / Math.max(1, cur.end - cur.at);
    if (t >= 1 || t < 0) { cur = null; c.style.display = 'none'; g.clearRect(0, 0, c.width, c.height); return; }
    (cur.kind === 'amos' ? drawAmos : drawSeen)(g, c.width, c.height, t);
    raf = (doc.defaultView || globalThis).requestAnimationFrame(frame);
  };
  return { play(kind, at, end) { if (!REGULARS[kind]) return; cur = { kind, at, end }; c.style.display = 'block'; if (!raf) frame(); }, stop() { cur = null; c.style.display = 'none'; } };
}
