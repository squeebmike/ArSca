import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: a threshold helper exists and is called on the final composed
// canvas before it's ever encoded to PNG -- this is what strips out the
// anti-aliased gray edges (from text/QR/logo drawing) that were forcing the
// MUNBYN app to auto-dither every label into a grainy stipple pattern, even
// once the label size itself was confirmed correct against a real device. ──
assert.match(dashboard, /function thresholdCanvasToBW\(canvas, cutoff = 128\)\{/, 'missing thresholdCanvasToBW helper');
assert.match(dashboard, /const luminance = 0\.299 \* d\[i\] \+ 0\.587 \* d\[i \+ 1\] \+ 0\.114 \* d\[i \+ 2\];/, 'must use a real luminance-weighted formula, not a flat average, so colored logo pixels threshold sensibly');
assert.match(dashboard, /const v = luminance < cutoff \? 0 : 255;/, 'each pixel must resolve to pure black (0) or pure white (255), nothing in between');
assert.match(dashboard, /thresholdCanvasToBW\(canvas\);\s*\n\s*const blob = await new Promise\(resolve => canvas\.toBlob\(resolve, 'image\/png'\)\);/, 'thresholdCanvasToBW must run on the fully-composed label canvas right before it is encoded to PNG, so it catches every element (text, code, logo) in one pass');

console.log('Label PNG black/white threshold contract checks passed');

// ── Functional: reimplement the threshold logic against a fake ImageData-shaped
// buffer and prove it collapses anti-aliased gray into pure black/white, and
// that pure black/white pixels (already-binary QR modules) pass through unchanged. ──
function thresholdPixels(data, cutoff = 128){
  const d = Float64Array.from(data);
  const out = new Uint8ClampedArray(d.length);
  for(let i = 0; i < d.length; i += 4){
    const luminance = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = luminance < cutoff ? 0 : 255;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = d[i + 3];
  }
  return out;
}

// A mid-gray anti-aliased edge pixel (the exact kind Canvas2D produces around
// every letter/QR-module edge) must collapse to one extreme or the other.
{
  const darkEdge = thresholdPixels([100, 100, 100, 255]); // dark gray -> black
  assert.deepEqual([...darkEdge], [0, 0, 0, 255], 'a dark anti-aliased edge pixel must resolve to pure black');

  const lightEdge = thresholdPixels([200, 200, 200, 255]); // light gray -> white
  assert.deepEqual([...lightEdge], [255, 255, 255, 255], 'a light anti-aliased edge pixel must resolve to pure white');
}

// Already-pure pixels (solid black text fill, solid white background, solid
// black QR modules) must pass through unchanged -- the threshold must not
// introduce noise where there wasn't any.
{
  const pureBlack = thresholdPixels([0, 0, 0, 255]);
  assert.deepEqual([...pureBlack], [0, 0, 0, 255], 'a pure black pixel must stay pure black');

  const pureWhite = thresholdPixels([255, 255, 255, 255]);
  assert.deepEqual([...pureWhite], [255, 255, 255, 255], 'a pure white pixel must stay pure white');
}

// Alpha channel must be preserved untouched -- this is a color threshold, not
// a transparency operation, and the label logo's PNG carries real alpha.
{
  const semiTransparent = thresholdPixels([50, 50, 50, 128]);
  assert.equal(semiTransparent[3], 128, 'alpha must pass through unmodified regardless of the RGB threshold result');
}

// A colored (non-gray) pixel must threshold by perceived brightness, not a
// flat RGB average -- pure green (0,255,0) is visually bright even though its
// R and B channels are 0, and must NOT collapse to black.
{
  const green = thresholdPixels([0, 255, 0, 255]);
  assert.deepEqual([...green], [255, 255, 255, 255], 'a bright green pixel must threshold to white via perceptual luminance weighting, not to black via a naive average');
}

console.log('Label PNG black/white threshold functional checks passed');
