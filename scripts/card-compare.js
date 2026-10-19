// Card compare: Loupe's COMPARE TO REAL CARD. Store ask: "someone made a
// fake checker -- real card image, high res, you take a pic of your card and
// slide to show real vs yours ... how can we make it better, without using
// credits? Any way to compare the images and show what might be fake, i.e.
// font etc."
//
// Everything here runs on the phone: no AI call, no paid lookup. The
// official image comes from the card's catalog image (through the Worker's
// /card-image relay only so the browser may read its pixels), the photo is
// lined up to it from its four corners, lighting is evened out, and then
// each part of the card is measured against the real one -- how well the
// printed lines (text, borders, symbols) line up, whether the text is
// softer, bolder or thinner than the real print, and whether the colors
// are off. It points at what to look at under the loupe; it can't prove a
// card is fake (holo glare, sleeves, reprints and 1st edition stamps all
// show up as differences too), and says so.
(function(){
'use strict';

// Reference space: every comparison happens on a 500x698 card (63x88 mm).
var REF_W = 500, REF_H = 698;
// Parts of a standard card, as fractions of the card. Laid out for Pokemon
// and close enough for Magic/most TCGs: name line, artwork, rules text,
// the bottom line (illustrator, copyright, card number) and the border.
var ZONES = [
  { key:'name', label:'Name line', x0:0.06, y0:0.035, x1:0.94, y1:0.115, text:true },
  { key:'art', label:'Artwork', x0:0.08, y0:0.115, x1:0.92, y1:0.50, text:false },
  { key:'text', label:'Rules / attack text', x0:0.06, y0:0.55, x1:0.94, y1:0.86, text:true },
  { key:'bottom', label:'Bottom line (illustrator, copyright, card #)', x0:0.06, y0:0.86, x1:0.94, y1:0.955, text:true },
  { key:'border', label:'Border', x0:0, y0:0, x1:1, y1:1, border:true },
];

// ── Pure math (exported for tests) ──────────────────────────────────────

// Homography mapping 4 source points to 4 destination points (8 unknowns,
// h33 = 1), solved with Gaussian elimination. Returns a 9-element matrix.
function solveHomography(src, dst){
  var A = [], b = [];
  for(var i = 0; i < 4; i++){
    var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  var n = 8;
  for(var c = 0; c < n; c++){
    var p = c;
    for(var r = c + 1; r < n; r++) if(Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if(Math.abs(A[p][c]) < 1e-12) return null;
    var tmp = A[c]; A[c] = A[p]; A[p] = tmp; var tb = b[c]; b[c] = b[p]; b[p] = tb;
    for(var r2 = 0; r2 < n; r2++){
      if(r2 === c) continue;
      var f = A[r2][c] / A[c][c];
      if(!f) continue;
      for(var k = c; k < n; k++) A[r2][k] -= f * A[c][k];
      b[r2] -= f * b[c];
    }
  }
  var h = [];
  for(var j = 0; j < n; j++) h.push(b[j] / A[j][j]);
  h.push(1);
  return h;
}
function applyHomography(h, x, y){
  var w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}
function refCorners(){ return [[0, 0], [REF_W - 1, 0], [REF_W - 1, REF_H - 1], [0, REF_H - 1]]; }

// Straightens the photo: for every reference pixel, where it sits on the
// photo (h maps reference -> photo), sampled bilinearly. src is RGBA.
function warpToRef(src, sw, sh, h, outW, outH){
  outW = outW || REF_W; outH = outH || REF_H;
  var out = new Uint8ClampedArray(outW * outH * 4);
  for(var y = 0; y < outH; y++){
    for(var x = 0; x < outW; x++){
      var p = applyHomography(h, x, y), px = p[0], py = p[1];
      var o = (y * outW + x) * 4;
      if(!(px >= 0 && py >= 0 && px <= sw - 1 && py <= sh - 1)){ out[o + 3] = 255; continue; }
      var x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      var fx = px - x0, fy = py - y0;
      for(var c = 0; c < 3; c++){
        var a = src[(y0 * sw + x0) * 4 + c], bb = src[(y0 * sw + x1) * 4 + c], cc = src[(y1 * sw + x0) * 4 + c], d = src[(y1 * sw + x1) * 4 + c];
        out[o + c] = (a * (1 - fx) + bb * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

function toGray(rgba, n){
  var g = new Float32Array(n);
  for(var i = 0; i < n; i++) g[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return g;
}
function boxBlur(g, w, h, r){
  if(!r) return g;
  var tmp = new Float32Array(w * h), out = new Float32Array(w * h), y, x, k, s, cnt;
  for(y = 0; y < h; y++) for(x = 0; x < w; x++){ s = 0; cnt = 0; for(k = -r; k <= r; k++){ var xx = x + k; if(xx >= 0 && xx < w){ s += g[y * w + xx]; cnt++; } } tmp[y * w + x] = s / cnt; }
  for(y = 0; y < h; y++) for(x = 0; x < w; x++){ s = 0; cnt = 0; for(k = -r; k <= r; k++){ var yy = y + k; if(yy >= 0 && yy < h){ s += tmp[yy * w + x]; cnt++; } } out[y * w + x] = s / cnt; }
  return out;
}
// Sobel gradient magnitude: where printed lines and letter edges are.
function gradient(g, w, h){
  var m = new Float32Array(w * h);
  for(var y = 1; y < h - 1; y++) for(var x = 1; x < w - 1; x++){
    var i = y * w + x;
    var gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
    var gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
    m[i] = Math.sqrt(gx * gx + gy * gy) / 4;
  }
  return m;
}
// Normalized cross-correlation of two maps over a rectangle (1 = identical
// pattern, 0 = unrelated). Brightness/contrast differences don't matter.
function ncc(a, b, w, rect){
  var x0 = rect ? rect[0] : 0, y0 = rect ? rect[1] : 0, x1 = rect ? rect[2] : w, y1 = rect ? rect[3] : a.length / w;
  var n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for(var y = y0; y < y1; y++) for(var x = x0; x < x1; x++){ var i = y * w + x, va = a[i], vb = b[i]; n++; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; }
  if(!n) return 0;
  var cov = sab - sa * sb / n, va2 = saa - sa * sa / n, vb2 = sbb - sb * sb / n;
  if(va2 <= 1e-9 || vb2 <= 1e-9) return 0;
  return cov / Math.sqrt(va2 * vb2);
}
// Evens out lighting / white balance: each color channel of the photo is
// stretched so its 5th and 95th percentiles match the real card's.
function percentile(arr, p){ var s = Array.prototype.slice.call(arr).sort(function(a, b){ return a - b; }); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; }
function normalizeLighting(photo, ref, n){
  var out = new Uint8ClampedArray(photo.length);
  for(var c = 0; c < 3; c++){
    var pc = new Float32Array(Math.ceil(n / 7)), rc = new Float32Array(Math.ceil(n / 7)), k = 0;
    for(var i = 0; i < n; i += 7){ pc[k] = photo[i * 4 + c]; rc[k] = ref[i * 4 + c]; k++; }
    var p5 = percentile(pc, 0.05), p95 = percentile(pc, 0.95), r5 = percentile(rc, 0.05), r95 = percentile(rc, 0.95);
    var scale = p95 - p5 > 4 ? (r95 - r5) / (p95 - p5) : 1;
    for(var j = 0; j < n; j++) out[j * 4 + c] = (photo[j * 4 + c] - p5) * scale + r5;
  }
  for(var a = 0; a < n; a++) out[a * 4 + 3] = 255;
  return out;
}
// Otsu's threshold: splits a zone into "ink" and "paper".
function otsu(g, rect, w){
  var hist = new Array(256).fill(0), total = 0;
  for(var y = rect[1]; y < rect[3]; y++) for(var x = rect[0]; x < rect[2]; x++){ hist[Math.max(0, Math.min(255, Math.round(g[y * w + x])))]++; total++; }
  var sum = 0; for(var t = 0; t < 256; t++) sum += t * hist[t];
  var sumB = 0, wB = 0, best = 0, thr = 128;
  for(var t2 = 0; t2 < 256; t2++){
    wB += hist[t2]; if(!wB) continue; var wF = total - wB; if(!wF) break;
    sumB += t2 * hist[t2];
    var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
    if(between > best){ best = between; thr = t2; }
  }
  return thr;
}
function zoneRect(z, w, h){ return [Math.round(z.x0 * w), Math.round(z.y0 * h), Math.round(z.x1 * w), Math.round(z.y1 * h)]; }
function meanOver(m, w, rect){ var s = 0, n = 0; for(var y = rect[1]; y < rect[3]; y++) for(var x = rect[0]; x < rect[2]; x++){ s += m[y * w + x]; n++; } return n ? s / n : 0; }

// First guess at where the card sits in the photo: the strong edges
// (skipping the outer 3% -- table edges, fingers), then each corner is the
// edge point furthest out in its diagonal direction, so a tilted card
// still gets its real corners. The handles are always adjustable after.
function guessCardQuad(rgba, w, h){
  return findCardQuad(rgba, w, h) || [[w * 0.15, h * 0.15], [w * 0.85, h * 0.15], [w * 0.85, h * 0.85], [w * 0.15, h * 0.85]].map(function(p){ return [Math.round(p[0]), Math.round(p[1])]; });
}
function findCardQuad(rgba, w, h){
  var g = gradient(boxBlur(toGray(rgba, w * h), w, h, 1), w, h);
  var mx = 0; for(var i = 0; i < g.length; i++) if(g[i] > mx) mx = g[i];
  var thr = mx * 0.3, mxX = Math.round(w * 0.03), mxY = Math.round(h * 0.03);
  var best = [null, null, null, null], score = [Infinity, -Infinity, -Infinity, -Infinity];
  var cols = new Array(w).fill(0), rows = new Array(h).fill(0);
  for(var y = mxY; y < h - mxY; y++) for(var x = mxX; x < w - mxX; x++) if(g[y * w + x] > thr){ cols[x]++; rows[y]++; }
  // Ignore stray specks: only rows/columns with a real run of edges count.
  var needC = Math.max(3, h * 0.02), needR = Math.max(3, w * 0.02);
  for(var y2 = mxY; y2 < h - mxY; y2++){
    if(rows[y2] < needR) continue;
    for(var x2 = mxX; x2 < w - mxX; x2++){
      if(cols[x2] < needC || g[y2 * w + x2] <= thr) continue;
      if(x2 + y2 < score[0]){ score[0] = x2 + y2; best[0] = [x2, y2]; }
      if(x2 - y2 > score[1]){ score[1] = x2 - y2; best[1] = [x2, y2]; }
      if(x2 + y2 > score[2]){ score[2] = x2 + y2; best[2] = [x2, y2]; }
      if(y2 - x2 > score[3]){ score[3] = y2 - x2; best[3] = [x2, y2]; }
    }
  }
  var ok = mx > 8 && best.every(Boolean) && Math.abs(best[2][0] - best[0][0]) > w * 0.2 && Math.abs(best[2][1] - best[0][1]) > h * 0.2;
  return ok ? best : null;
}

// Where the corner dots start. With a camera frame (Loupe's capture), the
// card's edges are looked for just around that frame; the frame itself is
// used if they aren't found there.
function startQuad(rgba, w, h, frame){
  if(!frame) return guessCardQuad(rgba, w, h);
  var xs = frame.map(function(p){ return p[0]; }), ys = frame.map(function(p){ return p[1]; });
  var fw = Math.max.apply(null, xs) - Math.min.apply(null, xs), fh = Math.max.apply(null, ys) - Math.min.apply(null, ys);
  var x0 = Math.max(0, Math.round(Math.min.apply(null, xs) - fw * 0.12)), y0 = Math.max(0, Math.round(Math.min.apply(null, ys) - fh * 0.08));
  var x1 = Math.min(w, Math.round(Math.max.apply(null, xs) + fw * 0.12)), y1 = Math.min(h, Math.round(Math.max.apply(null, ys) + fh * 0.08));
  var cw = x1 - x0, ch = y1 - y0;
  if(cw < 40 || ch < 40) return frame.map(function(p){ return p.slice(); });
  var crop = new Uint8ClampedArray(cw * ch * 4);
  for(var y = 0; y < ch; y++) crop.set(rgba.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x1) * 4), y * cw * 4);
  var found = findCardQuad(crop, cw, ch);
  if(!found) return frame.map(function(p){ return p.slice(); });
  var q = found.map(function(p){ return [p[0] + x0, p[1] + y0]; });
  var area = function(a){ var s = 0; for(var i = 0; i < 4; i++){ var j = (i + 1) % 4; s += a[i][0] * a[j][1] - a[j][0] * a[i][1]; } return Math.abs(s) / 2; };
  var ratio = area(q) / Math.max(1, area(frame));
  return ratio > 0.55 && ratio < 1.5 ? q : frame.map(function(p){ return p.slice(); });
}

// Fine alignment after the corners: tries small shifts, scales and
// rotations (on a quarter-size gradient map) and keeps the one where the
// printed lines line up best -- a coarse pass, then a finer one around
// the winner. Returns the improved photo corners and how well it fit.
function refineQuad(srcRgba, sw, sh, quad, refGrad){
  var DS = 4, w = REF_W / DS | 0, hh = REF_H / DS | 0;
  var cx = REF_W / 2, cy = REF_H / 2;
  var base = solveHomography(refCorners(), quad);
  if(!base) return { quad:quad, score:0 };
  var smallCorners = refCorners().map(function(p){ return [p[0] / DS, p[1] / DS]; });
  function tryFit(s, rot, dx, dy){
    var cs = Math.cos(rot), sn = Math.sin(rot);
    var q = refCorners().map(function(p){ var x = p[0] - cx, y = p[1] - cy; return [cx + s * (cs * x - sn * y) + dx, cy + s * (sn * x + cs * y) + dy]; })
      .map(function(p){ return applyHomography(base, p[0], p[1]); });
    var hq = solveHomography(smallCorners, q);
    if(!hq) return null;
    var warped = warpToRef(srcRgba, sw, sh, hq, w, hh);
    return { score:ncc(refGrad, gradient(boxBlur(toGray(warped, w * hh), w, hh, 1), w, hh), w), s:s, rot:rot, dx:dx, dy:dy, quad:q };
  }
  var best = { score:-2, s:1, rot:0, dx:0, dy:0, quad:quad }, deg = Math.PI / 180;
  function consider(f){ if(f && f.score > best.score) best = f; }
  [0.97, 0.985, 1, 1.015, 1.03].forEach(function(s){ [-1.4 * deg, 0, 1.4 * deg].forEach(function(r){
    for(var dy = -12; dy <= 12; dy += 6) for(var dx = -12; dx <= 12; dx += 6) consider(tryFit(s, r, dx, dy));
  }); });
  var c0 = best;
  [-0.0075, 0, 0.0075].forEach(function(ds){ [-0.7 * deg, 0, 0.7 * deg].forEach(function(dr){
    for(var ddy = -3; ddy <= 3; ddy += 3) for(var ddx = -3; ddx <= 3; ddx += 3) consider(tryFit(c0.s + ds, c0.rot + dr, c0.dx + ddx, c0.dy + ddy));
  }); });
  return { quad:best.quad, score:best.score };
}

// The comparison itself. ref and photo are REF_W x REF_H RGBA, the photo
// already straightened. Returns per-zone findings, an overall verdict and
// a 0..1 difference map for the heatmap.
function analyzeCard(ref, photoRaw){
  var w = REF_W, h = REF_H, n = w * h;
  var photo = normalizeLighting(photoRaw, ref, n);
  var gR = boxBlur(toGray(ref, n), w, h, 1), gP = boxBlur(toGray(photo, n), w, h, 1);
  var edR = gradient(gR, w, h), edP = gradient(gP, w, h);
  var whole = [4, 4, w - 4, h - 4];
  var overall = ncc(edR, edP, w, whole);
  // How sharp the photo is overall, judged on the artwork (not text), so
  // blurry text can't hide by dragging the whole card's average down.
  var artRect = zoneRect(ZONES[1], w, h);
  var sharpAll = meanOver(edP, w, artRect) / Math.max(1e-6, meanOver(edR, w, artRect));
  if(!(sharpAll > 0.05)) sharpAll = meanOver(edP, w, whole) / Math.max(1e-6, meanOver(edR, w, whole));
  var zones = ZONES.map(function(z){
    var findings = [], rect = z.border ? null : zoneRect(z, w, h);
    if(z.border){
      // Border: color and evenness only (the outer 4.5% band).
      var bw = Math.round(w * 0.045), bh = Math.round(h * 0.035), sR = [0, 0, 0], sP = [0, 0, 0], cnt = 0;
      for(var y = 2; y < h - 2; y++) for(var x = 2; x < w - 2; x++){
        if(x > bw && x < w - bw && y > bh && y < h - bh) continue;
        var o = (y * w + x) * 4; for(var c = 0; c < 3; c++){ sR[c] += ref[o + c]; sP[c] += photo[o + c]; } cnt++;
      }
      var dB = Math.sqrt([0, 1, 2].reduce(function(a, c){ var d = (sR[c] - sP[c]) / cnt; return a + d * d; }, 0));
      if(dB > 22) findings.push('Border color is off from the real card (' + Math.round(dB) + ' points) -- check the yellow/silver/black border under even light');
      return { key:z.key, label:z.label, colorDiff:Math.round(dB), findings:findings, severity:dB > 35 ? 2 : (dB > 22 ? 1 : 0) };
    }
    var match = ncc(edR, edP, w, rect);
    var sharp = (meanOver(edP, w, rect) / Math.max(1e-6, meanOver(edR, w, rect))) / Math.max(1e-6, sharpAll);
    var thr = otsu(gR, rect, w), inkR = 0, inkP = 0, cntZ = 0, colR = [0, 0, 0], colP = [0, 0, 0];
    for(var yy = rect[1]; yy < rect[3]; yy++) for(var xx = rect[0]; xx < rect[2]; xx++){
      var i = yy * w + xx; if(gR[i] < thr) inkR++; if(gP[i] < thr) inkP++; cntZ++;
      for(var cc = 0; cc < 3; cc++){ colR[cc] += ref[i * 4 + cc]; colP[cc] += photo[i * 4 + cc]; }
    }
    var ink = inkR ? inkP / inkR : 1;
    var colorDiff = Math.sqrt([0, 1, 2].reduce(function(a, c){ var d = (colR[c] - colP[c]) / cntZ; return a + d * d; }, 0));
    var sev = 0;
    if(z.text){
      if(match < 0.35){ findings.push('Printed lines don\'t line up with the real card -- check the font, letter spacing and where each line sits'); sev = Math.max(sev, 2); }
      else if(match < 0.55){ findings.push('Some printing doesn\'t line up -- compare the letters here closely'); sev = Math.max(sev, 1); }
      if(sharp < 0.72){ findings.push('Text is softer/blurrier than the rest of the card -- reprinted fakes often have fuzzy text'); sev = Math.max(sev, 1); }
      if(ink > 1.4){ findings.push('Text looks heavier/bolder than the real print'); sev = Math.max(sev, 1); }
      else if(ink < 0.65){ findings.push('Text looks thinner/lighter than the real print'); sev = Math.max(sev, 1); }
    } else {
      if(match < 0.3){ findings.push('Artwork lines don\'t match the real card -- wrong card picked, or a different/fake print'); sev = Math.max(sev, 2); }
      else if(match < 0.5){ findings.push('Artwork detail is off in places -- compare outlines and fine shading'); sev = Math.max(sev, 1); }
    }
    if(colorDiff > 28){ findings.push('Colors are off from the real card (' + Math.round(colorDiff) + ' points)'); sev = Math.max(sev, colorDiff > 45 ? 2 : 1); }
    return { key:z.key, label:z.label, match:Math.round(match * 100) / 100, sharpness:Math.round(sharp * 100) / 100, inkWeight:Math.round(ink * 100) / 100, colorDiff:Math.round(colorDiff), findings:findings, severity:sev };
  });
  // Difference map: brightness difference plus printed-line difference,
  // blurred so single-pixel noise doesn't light up.
  var diff = new Float32Array(n), dmax = 1;
  for(var k = 0; k < n; k++){ var d = Math.abs(gR[k] - gP[k]) * 0.6 + Math.abs(edR[k] - edP[k]) * 0.8; diff[k] = d; }
  diff = boxBlur(diff, w, h, 3);
  var sorted = Array.prototype.slice.call(diff.filter(function(_, i){ return i % 13 === 0; })).sort(function(a, b){ return a - b; });
  dmax = Math.max(18, sorted[Math.floor(sorted.length * 0.995)] || 18);
  for(var m = 0; m < n; m++) diff[m] = Math.min(1, diff[m] / dmax);
  // Hotspots: the three 50x50 cells that differ most.
  var cells = [];
  for(var cy2 = 0; cy2 + 50 <= h; cy2 += 25) for(var cx2 = 0; cx2 + 50 <= w; cx2 += 25) cells.push({ x:cx2, y:cy2, w:50, h:50, v:meanOver(diff, w, [cx2, cy2, cx2 + 50, cy2 + 50]) });
  cells.sort(function(a, b){ return b.v - a.v; });
  var hotspots = [];
  cells.forEach(function(c){ if(hotspots.length < 3 && c.v > 0.28 && !hotspots.some(function(hs){ return Math.abs(hs.x - c.x) < 50 && Math.abs(hs.y - c.y) < 50; })) hotspots.push(c); });
  var worst = zones.reduce(function(a, z){ return Math.max(a, z.severity); }, 0);
  var flagged = zones.filter(function(z){ return z.severity > 0; }).length;
  var verdict;
  // A poor overall line-up is a corner problem, not evidence of a fake.
  if(overall < 0.45) verdict = { level:'misaligned', title:'Couldn\'t line it up', text:'The photo and the real card don\'t line up. Check you picked the right card (same set and number), then move the corner dots onto the card\'s corners and compare again.' };
  else if(worst >= 2 || flagged >= 3) verdict = { level:'red', title:'Big differences from the real card', text:'Several parts don\'t match the real print. Could be fake, a different printing, or glare -- check the highlighted spots under the loupe.' };
  else if(flagged) verdict = { level:'amber', title:'Some differences', text:'Most of it matches, but look closely at the flagged parts below.' };
  else verdict = { level:'green', title:'Lines up with the real card', text:'Printing, text and colors match the real card closely. A good sign, not proof -- still check the feel, the light test and the back.' };
  return { overall:Math.round(overall * 100) / 100, zones:zones, verdict:verdict, diff:diff, hotspots:hotspots };
}

// Bigger, clearer official images where the host offers one.
function upgradeCardImageUrl(url){
  var u = String(url || '');
  if(/images\.pokemontcg\.io\/[^/]+\/[^/]+\.png$/i.test(u) && !/_hires\.png$/i.test(u)) return u.replace(/\.png$/i, '_hires.png');
  if(/cards\.scryfall\.io\/(small|normal)\//i.test(u)) return u.replace(/cards\.scryfall\.io\/(small|normal)\//i, 'cards.scryfall.io/large/');
  if(/tcgplayer-cdn\.tcgplayer\.com\/product\/\d+_\d+w\.jpg/i.test(u)) return u.replace(/_\d+w\.jpg/i, '_in_1000x1000.jpg');
  if(/product-images\.tcgplayer\.com\/fit-in\/\d+x\d+\//i.test(u)) return u.replace(/fit-in\/\d+x\d+\//i, 'fit-in/1000x1000/');
  return u;
}
// Images the page can read directly (its own blobs/data) skip the relay.
function relayedImageUrl(url, worker){
  var u = upgradeCardImageUrl(url);
  if(/^(blob:|data:)/i.test(u) || !/^https:/i.test(u)) return u;
  return String(worker || '').replace(/\/$/, '') + '/card-image?url=' + encodeURIComponent(u);
}

var api = { REF_W:REF_W, REF_H:REF_H, ZONES:ZONES, solveHomography:solveHomography, applyHomography:applyHomography, warpToRef:warpToRef, toGray:toGray,
  boxBlur:boxBlur, gradient:gradient, ncc:ncc, normalizeLighting:normalizeLighting, otsu:otsu, guessCardQuad:guessCardQuad, refineQuad:refineQuad,
  analyzeCard:analyzeCard, startQuad:startQuad, upgradeCardImageUrl:upgradeCardImageUrl, relayedImageUrl:relayedImageUrl, refCorners:refCorners };
if(typeof window === 'undefined'){ if(typeof module !== 'undefined') module.exports = api; return; }
window.CardCompareMath = api;

// ── UI ───────────────────────────────────────────────────────────────────
var ui = null;
function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function toast(m){ if(typeof toast_dash === 'function') toast_dash(m); }
function workerUrl(){ try { return typeof WORKER !== 'undefined' ? WORKER : ''; } catch(e){ return ''; } }

function loadImage(src){
  return new Promise(function(resolve, reject){
    var img = new Image();
    if(!/^(blob:|data:)/i.test(src)) img.crossOrigin = 'anonymous';
    img.onload = function(){ resolve(img); };
    img.onerror = function(){ reject(new Error('Could not load the official card image')); };
    img.src = src;
  });
}
function imageToRgba(img, w, h){
  var c = document.createElement('canvas'); c.width = w; c.height = h;
  var ctx = c.getContext('2d', { willReadFrequently:true }); ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}
function rgbaToCanvas(rgba, w, h){
  var c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return c;
}

function ensureStyles(){
  if(document.getElementById('ccmp-styles')) return;
  var st = document.createElement('style'); st.id = 'ccmp-styles';
  st.textContent = [
    '.ccmp-overlay{position:fixed;inset:0;z-index:10080;background:#05070a;display:none;overflow:auto;-webkit-overflow-scrolling:touch}',
    '.ccmp-overlay.on{display:block}',
    '.ccmp-sheet{max-width:620px;margin:0 auto;padding:12px 12px 40px;font-family:var(--font-mono,monospace);color:var(--text,#eee)}',
    '.ccmp-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}',
    '.ccmp-title{font:900 13px Orbitron,monospace;letter-spacing:.06em;color:var(--g,#00ffa3)}',
    '.ccmp-stage{position:relative;overflow:auto;border:1px solid var(--border,#333);border-radius:10px;background:#000;max-height:72vh;touch-action:pan-x pan-y}',
    '.ccmp-stage canvas{display:block;width:100%;height:auto}',
    '.ccmp-handle{position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:3px solid var(--g,#00ffa3);background:rgba(0,255,163,.25);touch-action:none}',
    '.ccmp-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0}',
    '.ccmp-row .hbtn{margin-bottom:0}',
    '.ccmp-row .hbtn.active{outline:2px solid var(--g,#00ffa3)}',
    '.ccmp-verdict{padding:10px 12px;border-radius:8px;margin:8px 0;font-size:11px;line-height:1.5}',
    '.ccmp-zone{padding:7px 9px;border-bottom:1px solid var(--border,#333);font-size:10px;line-height:1.5}',
    '.ccmp-note{font-size:9px;color:var(--dim,#999);line-height:1.5}',
  ].join('\n');
  document.head.appendChild(st);
}
function ensureUi(){
  if(ui) return ui;
  ensureStyles();
  var ov = document.createElement('div'); ov.className = 'ccmp-overlay';
  ov.innerHTML = '<div class="ccmp-sheet"><div class="ccmp-head"><div class="ccmp-title">🆚 COMPARE TO REAL CARD</div><button type="button" class="hbtn" data-cc="close">✕ CLOSE</button></div><div class="ccmp-body"></div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', function(e){ var b = e.target.closest('[data-cc]'); if(b) handleAction(b.getAttribute('data-cc'), b); });
  ui = { overlay:ov, body:ov.querySelector('.ccmp-body') };
  return ui;
}
var S = null; // current session

// opts: { card:{ name, set, number, imageUrl }, photo: HTMLCanvasElement }
async function open(opts){
  ensureUi(); ui.overlay.classList.add('on');
  S = { card:opts.card || {}, photo:opts.photo, mode:'slide', zoom:1, split:0.5, fade:0.5, flicker:null };
  ui.body.innerHTML = '<div class="ccmp-note">Loading the official image of ' + esc(S.card.name || 'this card') + '…</div>';
  try {
    var src = relayedImageUrl(S.card.imageUrl, workerUrl());
    var img = await loadImage(src);
    S.ref = imageToRgba(img, REF_W, REF_H);
    S.refCanvas = rgbaToCanvas(S.ref, REF_W, REF_H);
    var pw = S.photo.width, ph = S.photo.height;
    S.photoRgba = S.photo.getContext('2d', { willReadFrequently:true }).getImageData(0, 0, pw, ph).data;
    S.frameQuad = opts.frameQuad || null;
    S.quad = startQuad(S.photoRgba, pw, ph, S.frameQuad);
    renderCorners();
  } catch(e){ ui.body.innerHTML = '<div class="ccmp-verdict" style="border:1px solid var(--red,#f45)">' + esc(e.message) + '. Try a different search result for this card.</div>'; }
}
function close(){ if(S && S.flicker) clearInterval(S.flicker); if(ui) ui.overlay.classList.remove('on'); S = null; }

// Step 1: put the four dots on the card's corners.
function renderCorners(){
  ui.body.innerHTML = '<div class="ccmp-note" style="margin-bottom:6px"><b style="color:var(--text)">Step 1:</b> drag the 4 green dots onto your card\'s 4 corners (top-left, top-right, bottom-right, bottom-left), then tap LINE UP.</div>' +
    '<div class="ccmp-stage" data-stage="corners"></div>' +
    '<div class="ccmp-row"><button type="button" class="hbtn" style="color:var(--g)" data-cc="lineup">LINE UP &amp; COMPARE</button><button type="button" class="hbtn" data-cc="reguess">RESET DOTS</button></div>';
  var stage = ui.body.querySelector('[data-stage]');
  var c = S.photo; c.style.width = '100%'; stage.appendChild(c);
  S.quad.forEach(function(p, i){ var hnd = document.createElement('div'); hnd.className = 'ccmp-handle'; hnd.dataset.i = i; stage.appendChild(hnd); });
  placeHandles();
  stage.querySelectorAll('.ccmp-handle').forEach(function(hnd){
    hnd.addEventListener('pointerdown', function(e){ e.preventDefault(); hnd.setPointerCapture(e.pointerId); hnd._drag = true; });
    hnd.addEventListener('pointermove', function(e){
      if(!hnd._drag) return;
      var r = c.getBoundingClientRect(), k = S.photo.width / r.width;
      S.quad[+hnd.dataset.i] = [Math.max(0, Math.min(S.photo.width - 1, (e.clientX - r.left) * k)), Math.max(0, Math.min(S.photo.height - 1, (e.clientY - r.top) * k))];
      placeHandles();
    });
    hnd.addEventListener('pointerup', function(){ hnd._drag = false; });
  });
}
function placeHandles(){
  var stage = ui.body.querySelector('[data-stage]'); if(!stage) return;
  var c = S.photo, r = c.getBoundingClientRect(), k = r.width / c.width || 1;
  stage.querySelectorAll('.ccmp-handle').forEach(function(hnd){ var p = S.quad[+hnd.dataset.i]; hnd.style.left = (p[0] * k) + 'px'; hnd.style.top = (p[1] * k) + 'px'; });
}

function lineUp(){
  ui.body.innerHTML = '<div class="ccmp-note">Lining up and comparing… (a few seconds)</div>';
  setTimeout(function(){
    try {
      var DS = 4, w = REF_W / DS | 0, h = REF_H / DS | 0;
      var refSmall = new Uint8ClampedArray(w * h * 4);
      for(var y = 0; y < h; y++) for(var x = 0; x < w; x++) for(var c = 0; c < 4; c++) refSmall[(y * w + x) * 4 + c] = S.ref[((y * DS) * REF_W + x * DS) * 4 + c];
      var refGrad = gradient(boxBlur(toGray(refSmall, w * h), w, h, 1), w, h);
      var fit = refineQuad(S.photoRgba, S.photo.width, S.photo.height, S.quad, refGrad);
      var hm = solveHomography(refCorners(), fit.quad);
      S.aligned = warpToRef(S.photoRgba, S.photo.width, S.photo.height, hm, REF_W, REF_H);
      S.alignedCanvas = rgbaToCanvas(S.aligned, REF_W, REF_H);
      S.result = analyzeCard(S.ref, S.aligned);
      S.heatCanvas = heatCanvas(S.result);
      renderCompare();
    } catch(e){ ui.body.innerHTML = '<div class="ccmp-verdict" style="border:1px solid var(--red,#f45)">Compare failed: ' + esc(e.message) + '</div>'; }
  }, 30);
}
function heatCanvas(res){
  var c = document.createElement('canvas'); c.width = REF_W; c.height = REF_H;
  var ctx = c.getContext('2d'), img = ctx.createImageData(REF_W, REF_H);
  for(var i = 0; i < res.diff.length; i++){ var v = res.diff[i]; if(v < 0.3) continue; img.data[i * 4] = 255; img.data[i * 4 + 1] = Math.round(60 * (1 - v)); img.data[i * 4 + 2] = 40; img.data[i * 4 + 3] = Math.round(Math.min(1, (v - 0.3) / 0.5) * 200); }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 3; ctx.font = 'bold 18px monospace'; ctx.fillStyle = '#ffd400';
  res.hotspots.forEach(function(hs, i){ ctx.strokeRect(hs.x, hs.y, hs.w, hs.h); ctx.fillText(String(i + 1), hs.x + 4, hs.y + 18); });
  return c;
}

// Step 2: the side-by-side viewer and what was found.
function renderCompare(){
  var r = S.result, v = r.verdict;
  var color = { green:'var(--g,#00ffa3)', amber:'var(--gold,#ffb800)', red:'var(--red,#ff4d6d)', misaligned:'var(--gold,#ffb800)' }[v.level];
  var modes = [['slide', '↔ SLIDE'], ['fade', '◐ FADE'], ['flicker', '⚡ FLICKER'], ['diff', '🔥 DIFFERENCES']];
  ui.body.innerHTML = '<div class="ccmp-row">' + modes.map(function(m){ return '<button type="button" class="hbtn' + (S.mode === m[0] ? ' active' : '') + '" data-cc="mode" data-mode="' + m[0] + '">' + m[1] + '</button>'; }).join('') + '</div>' +
    '<div class="ccmp-stage" data-stage="compare"><canvas width="' + REF_W + '" height="' + REF_H + '"></canvas></div>' +
    '<div class="ccmp-row">' + [1, 2, 4].map(function(z){ return '<button type="button" class="hbtn' + (S.zoom === z ? ' active' : '') + '" data-cc="zoom" data-zoom="' + z + '">' + z + '×</button>'; }).join('') +
      (S.mode === 'fade' ? '<input type="range" min="0" max="1" step="0.01" value="' + S.fade + '" data-range="fade" style="flex:1;min-width:120px">' : '') +
      '<span class="ccmp-note">' + (S.mode === 'slide' ? 'Drag on the card: left = real, right = yours' : S.mode === 'diff' ? 'Red = differs from the real card · numbered = biggest differences' : S.mode === 'flicker' ? 'Flips between real and yours -- anything that jumps is different' : 'Slide to fade real → yours') + '</span></div>' +
    '<div class="ccmp-verdict" style="border:1px solid ' + color + '"><b style="color:' + color + '">' + esc(v.title) + '</b><br>' + esc(v.text) + '<br><span class="ccmp-note">Overall line-up ' + Math.round(r.overall * 100) + '%</span></div>' +
    r.zones.map(function(z){
      var sev = z.severity === 2 ? 'var(--red,#ff4d6d)' : z.severity === 1 ? 'var(--gold,#ffb800)' : 'var(--g,#00ffa3)';
      var stats = z.match != null ? 'lines match ' + Math.round(z.match * 100) + '% · sharpness ' + Math.round(z.sharpness * 100) + '% · ink ' + Math.round(z.inkWeight * 100) + '% · color off ' + z.colorDiff : 'color off ' + z.colorDiff;
      return '<div class="ccmp-zone"><b style="color:' + sev + '">' + (z.severity ? '⚠ ' : '✓ ') + esc(z.label) + '</b> <span class="ccmp-note">' + stats + '</span>' + (z.findings.length ? '<div>' + z.findings.map(esc).join('<br>') + '</div>' : '') + '</div>';
    }).join('') +
    '<div class="ccmp-note" style="margin-top:8px">Checked on this phone -- no credits used. A tool to point you at what to inspect, not proof: holo/foil glare, sleeves, 1st edition stamps, reprints and different print runs also show as differences. Real cards: crisp tiny text, correct font and spacing, the right holo pattern, and they pass the light test.</div>' +
    '<div class="ccmp-row"><button type="button" class="hbtn" data-cc="corners">↺ ADJUST CORNERS</button></div>';
  var stage = ui.body.querySelector('[data-stage]'), cv = stage.querySelector('canvas');
  cv.style.width = (S.zoom * 100) + '%';
  draw(cv);
  if(S.flicker){ clearInterval(S.flicker); S.flicker = null; }
  if(S.mode === 'flicker'){ var on = false; S.flicker = setInterval(function(){ on = !on; S._flip = on; draw(cv); }, 450); }
  var dragSplit = function(e){ var rr = cv.getBoundingClientRect(); S.split = Math.max(0, Math.min(1, (e.clientX - rr.left) / rr.width)); draw(cv); };
  cv.addEventListener('pointerdown', function(e){ if(S.mode !== 'slide') return; cv.setPointerCapture(e.pointerId); cv._drag = true; dragSplit(e); });
  cv.addEventListener('pointermove', function(e){ if(cv._drag) dragSplit(e); });
  cv.addEventListener('pointerup', function(){ cv._drag = false; });
  if(S.mode === 'slide') cv.style.touchAction = 'pan-y';
  var range = ui.body.querySelector('[data-range="fade"]');
  if(range) range.addEventListener('input', function(){ S.fade = Number(range.value); draw(cv); });
}
function draw(cv){
  var ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, REF_W, REF_H);
  if(S.mode === 'slide'){
    var sx = Math.round(S.split * REF_W);
    ctx.drawImage(S.refCanvas, 0, 0);
    ctx.drawImage(S.alignedCanvas, sx, 0, REF_W - sx, REF_H, sx, 0, REF_W - sx, REF_H);
    ctx.fillStyle = '#fff'; ctx.fillRect(sx - 1, 0, 3, REF_H);
    ctx.font = 'bold 14px monospace'; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(6, 6, 52, 20); ctx.fillRect(REF_W - 58, 6, 52, 20);
    ctx.fillStyle = '#fff'; ctx.fillText('REAL', 12, 21); ctx.fillText('YOURS', REF_W - 54, 21);
  } else if(S.mode === 'fade'){
    ctx.drawImage(S.refCanvas, 0, 0); ctx.globalAlpha = S.fade; ctx.drawImage(S.alignedCanvas, 0, 0); ctx.globalAlpha = 1;
  } else if(S.mode === 'flicker'){
    ctx.drawImage(S._flip ? S.alignedCanvas : S.refCanvas, 0, 0);
    ctx.font = 'bold 14px monospace'; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(6, 6, 58, 20); ctx.fillStyle = '#fff'; ctx.fillText(S._flip ? 'YOURS' : 'REAL', 12, 21);
  } else {
    ctx.drawImage(S.alignedCanvas, 0, 0); ctx.drawImage(S.heatCanvas, 0, 0);
  }
}
function handleAction(act, btn){
  if(act === 'close') return close();
  if(!S) return;
  if(act === 'reguess'){ S.quad = startQuad(S.photoRgba, S.photo.width, S.photo.height, S.frameQuad); return placeHandles(); }
  if(act === 'lineup') return lineUp();
  if(act === 'corners'){ if(S.flicker){ clearInterval(S.flicker); S.flicker = null; } return renderCorners(); }
  if(act === 'mode'){ S.mode = btn.getAttribute('data-mode'); return renderCompare(); }
  if(act === 'zoom'){ S.zoom = Number(btn.getAttribute('data-zoom')) || 1; return renderCompare(); }
}
window.CardCompare = { open:open, close:close };
})();
