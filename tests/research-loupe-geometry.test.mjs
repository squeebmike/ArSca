import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// computeLoupeGeometry is the one piece of Loupe's math worth testing in
// isolation -- it decides where the circular magnifier sits and how far to
// shift its (larger, re-cropped) clone video so the point under the glass
// stays visually centered as the user drags it around the live camera
// preview. Pulled out via window.__researchLoupeInternals (test-only
// export, see bottom of scripts/research-loupe.js) rather than duplicating
// the formula here.

const src = fs.readFileSync('scripts/research-loupe.js', 'utf8');
const sandbox = {
  window: {},
  document: { createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} }, addEventListener(){}, appendChild(){} }), head: { appendChild(){} }, body: { appendChild(){}, style: {} }, addEventListener(){}, getElementById: () => null, hidden: false },
  navigator: {},
  requestAnimationFrame: () => 0,
  console,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const { computeLoupeGeometry } = sandbox.window.__researchLoupeInternals;
assert.equal(typeof computeLoupeGeometry, 'function', 'computeLoupeGeometry must be exposed for testing');

// ── Centered drag point ───────────────────────────────────────────────
{
  const g = computeLoupeGeometry(300, 400, 0.5, 0.5, 4, 148);
  assert.equal(g.glassLeft, 300 * 0.5 - 74, 'glass horizontal center must track the drag fraction');
  assert.equal(g.glassTop, 400 * 0.5 - 74, 'glass vertical center must track the drag fraction');
  assert.equal(g.videoWidth, 300 * 4, 'the cloned video must be scaled by the magnification factor');
  assert.equal(g.videoHeight, 400 * 4);
  // At dead center, the magnified point (containerW*mag*0.5, containerH*mag*0.5)
  // must land exactly at the glass's own center (glassSize/2).
  const pointInClone = { x: g.videoLeft + 300 * 4 * 0.5, y: g.videoTop + 400 * 4 * 0.5 };
  assert.ok(Math.abs(pointInClone.x - 74) < 1e-9, 'the dragged point must be centered under the glass horizontally');
  assert.ok(Math.abs(pointInClone.y - 74) < 1e-9, 'the dragged point must be centered under the glass vertically');
}

// ── Off-center drag point still keeps the same point centered under the glass ──
{
  const g = computeLoupeGeometry(300, 400, 0.2, 0.8, 8, 148);
  const pointInClone = { x: g.videoLeft + 300 * 8 * 0.2, y: g.videoTop + 400 * 8 * 0.8 };
  assert.ok(Math.abs(pointInClone.x - 74) < 1e-9, 'off-center drag: point must still be centered under the glass horizontally');
  assert.ok(Math.abs(pointInClone.y - 74) < 1e-9, 'off-center drag: point must still be centered under the glass vertically');
}

// ── Fractions outside 0..1 are clamped, not extrapolated ─────────────────
{
  const g = computeLoupeGeometry(300, 400, 1.5, -0.5, 4, 148);
  const clamped = computeLoupeGeometry(300, 400, 1, 0, 4, 148);
  assert.equal(g.glassLeft, clamped.glassLeft, 'fx > 1 must clamp to 1, not extrapolate past the camera edge');
  assert.equal(g.glassTop, clamped.glassTop, 'fy < 0 must clamp to 0, not extrapolate past the camera edge');
}

// ── Higher magnification scales the clone without moving the glass itself ──
{
  const low = computeLoupeGeometry(300, 400, 0.5, 0.5, 2, 148);
  const high = computeLoupeGeometry(300, 400, 0.5, 0.5, 8, 148);
  assert.equal(low.glassLeft, high.glassLeft, 'magnification must not move the glass circle itself');
  assert.equal(low.glassTop, high.glassTop);
  assert.ok(high.videoWidth > low.videoWidth, 'higher magnification must produce a larger cloned video');
}

console.log('Research Loupe geometry checks passed');
