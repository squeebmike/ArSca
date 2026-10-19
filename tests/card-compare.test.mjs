import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// Store ask: "In Loupe, at the bottom ... compare the images and show what
// might be fake, i.e. font etc. Without using credits." The compare engine
// runs entirely on the phone; these checks drive it with synthetic cards.
const require = createRequire(import.meta.url);
const M = require('../scripts/card-compare.js');
const { REF_W:W, REF_H:H } = M;

// ── Homography ──
{
  const src = [[0, 0], [499, 0], [499, 697], [0, 697]];
  const dst = [[120, 80], [610, 110], [590, 820], [100, 790]];
  const h = M.solveHomography(src, dst);
  src.forEach((p, i) => { const q = M.applyHomography(h, p[0], p[1]); assert.ok(Math.abs(q[0] - dst[i][0]) < 1e-6 && Math.abs(q[1] - dst[i][1]) < 1e-6, 'corner ' + i); });
}

// ── A synthetic card: yellow border, name bar, art, rows of "text" ──
function rng(seed){ let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function makeCard({ seed = 7, textBlur = 0, bold = 0, textShift = 0, artSeed = 3, tint = [0, 0, 0], borderColor = [235, 200, 40] } = {}){
  const px = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, r, g, b) => { if(x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; px[o] = r + tint[0]; px[o + 1] = g + tint[1]; px[o + 2] = b + tint[2]; px[o + 3] = 255; };
  for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){
    const border = x < 22 || x >= W - 22 || y < 24 || y >= H - 24;
    border ? set(x, y, borderColor[0], borderColor[1], borderColor[2]) : set(x, y, 225, 225, 215);
  }
  // Art: deterministic blobs and stripes.
  const ra = rng(artSeed);
  for(let k = 0; k < 14; k++){ const cx = 60 + ra() * 380, cy = 90 + ra() * 240, r = 15 + ra() * 45, col = [ra() * 200, ra() * 200, ra() * 200].map(Math.round);
    for(let y = Math.floor(cy - r); y < cy + r; y++) for(let x = Math.floor(cx - r); x < cx + r; x++) if((x - cx) ** 2 + (y - cy) ** 2 < r * r && y > 80 && y < 349 && x > 40 && x < 460) set(x, y, col[0], col[1], col[2]); }
  // "Text": rows of dark glyph boxes in the name line, rules text and bottom line.
  const rt = rng(seed);
  const rows = [[30, 44, 70], [390, 400, 600], [610, 620, 655]];
  for(const [y0, , y1] of rows){
    for(let y = y0; y < y1; y += 16){
      let x = 40;
      while(x < 460){ const gw = 3 + Math.floor(rt() * 7); if(rt() > 0.18) for(let yy = y; yy < y + 9 + bold; yy++) for(let xx = x; xx < x + gw + bold; xx++) set(xx + textShift, yy, 25, 25, 30); x += gw + 3; }
    }
  }
  if(textBlur){
    const blurred = new Uint8ClampedArray(px);
    for(const [y0, , y1] of rows) for(let y = y0; y < y1 + 10; y++) for(let x = 30; x < 470; x++) for(let c = 0; c < 3; c++){
      let s = 0, n = 0; for(let dy = -textBlur; dy <= textBlur; dy++) for(let dx = -textBlur; dx <= textBlur; dx++){ s += px[((y + dy) * W + x + dx) * 4 + c]; n++; }
      blurred[(y * W + x) * 4 + c] = s / n;
    }
    return blurred;
  }
  return px;
}
// A "photo": the card placed on a dark table with perspective, dimmer and warmer.
function photograph(card, quad, PW = 760, PH = 980, light = 0.82){
  const out = new Uint8ClampedArray(PW * PH * 4);
  for(let i = 0; i < PW * PH; i++){ out[i * 4] = 30; out[i * 4 + 1] = 28; out[i * 4 + 2] = 26; out[i * 4 + 3] = 255; }
  const hInv = M.solveHomography(quad, M.refCorners()); // photo -> card
  for(let y = 0; y < PH; y++) for(let x = 0; x < PW; x++){
    const p = M.applyHomography(hInv, x, y), cx = Math.round(p[0]), cy = Math.round(p[1]);
    if(cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    const o = (y * PW + x) * 4, s = (cy * W + cx) * 4;
    out[o] = card[s] * light + 12; out[o + 1] = card[s + 1] * light + 6; out[o + 2] = card[s + 2] * light; out[o + 3] = 255;
  }
  return { rgba:out, w:PW, h:PH };
}
const quad = [[130, 120], [640, 140], [625, 850], [115, 830]];
const real = makeCard();
const shot = photograph(real, quad);

// ── Card-edge guess lands near the real corners ──
{
  const g = M.guessCardQuad(shot.rgba, shot.w, shot.h);
  g.forEach((p, i) => assert.ok(Math.abs(p[0] - quad[i][0]) < 45 && Math.abs(p[1] - quad[i][1]) < 45, 'corner guess ' + i + ' ' + p));
}

// ── Genuine card, photographed: lines up, no flags ──
const align = (photo, q) => M.warpToRef(photo.rgba, photo.w, photo.h, M.solveHomography(M.refCorners(), q));
{
  const res = M.analyzeCard(real, align(shot, quad));
  assert.ok(res.overall > 0.7, 'overall ' + res.overall);
  assert.equal(res.verdict.level, 'green', JSON.stringify(res.zones.map(z => [z.key, z.match, z.sharpness, z.inkWeight, z.colorDiff, z.findings])));
  assert.equal(res.diff.length, W * H);
}

// ── Fine alignment fixes slightly-off corners ──
{
  const off = quad.map(p => [p[0] + 9, p[1] - 7]);
  const DS = 4, w = W / DS | 0, h = H / DS | 0, small = new Uint8ClampedArray(w * h * 4);
  for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) for(let c = 0; c < 4; c++) small[(y * w + x) * 4 + c] = real[((y * DS) * W + x * DS) * 4 + c];
  const refGrad = M.gradient(M.boxBlur(M.toGray(small, w * h), w, h, 1), w, h);
  const before = M.analyzeCard(real, align(shot, off)).overall;
  const fit = M.refineQuad(shot.rgba, shot.w, shot.h, off, refGrad);
  const after = M.analyzeCard(real, align(shot, fit.quad)).overall;
  assert.ok(after > before + 0.05, `refine should improve the line-up (${before} -> ${after})`);
}

// ── Fakes: blurry text, bolder font, shifted/different text ──
{
  const res = M.analyzeCard(real, align(photograph(makeCard({ textBlur:2 }), quad), quad));
  const t = res.zones.find(z => z.key === 'text');
  assert.ok(t.findings.some(f => /softer\/blurrier/.test(f)), 'blurry text flagged: ' + JSON.stringify(t));
  assert.notEqual(res.verdict.level, 'green');
}
{
  const res = M.analyzeCard(real, align(photograph(makeCard({ bold:2 }), quad), quad));
  const t = res.zones.find(z => z.key === 'text');
  assert.ok(t.findings.some(f => /heavier\/bolder/.test(f)), 'bold text flagged: ' + JSON.stringify(t));
}
{
  const res = M.analyzeCard(real, align(photograph(makeCard({ seed:99 }), quad), quad));
  const t = res.zones.find(z => z.key === 'text');
  assert.ok(t.severity >= 1 && t.findings.some(f => /line up/.test(f)), 'different text layout flagged: ' + JSON.stringify(t));
  assert.ok(res.hotspots.length >= 1, 'hotspots marked');
}
{
  // Wrong card entirely (different art and text) -> not green.
  const res = M.analyzeCard(real, align(photograph(makeCard({ seed:41, artSeed:12 }), quad), quad));
  assert.ok(['red', 'misaligned'].includes(res.verdict.level), res.verdict.level);
}
{
  // A border printed the wrong yellow. (A tint over the WHOLE card looks
  // exactly like room lighting, so that one is evened out on purpose.)
  const res = M.analyzeCard(real, align(photograph(makeCard({ borderColor:[200, 175, 90] }), quad), quad));
  const b = res.zones.find(z => z.key === 'border');
  assert.ok(b.severity >= 1 && /Border color/.test(b.findings.join(' ')), 'wrong border color flagged: ' + JSON.stringify(b));
}
{
  const res = M.analyzeCard(real, align(photograph(makeCard({ tint:[0, -40, 40] }), quad), quad));
  assert.equal(res.zones.find(z => z.key === 'border').severity, 0, 'a whole-card color cast (lighting) is not called a fake');
}
console.log('Card compare engine checks passed');

// ── Official image URLs: hi-res upgrade, relay unless already readable ──
assert.equal(M.upgradeCardImageUrl('https://images.pokemontcg.io/base6/29.png'), 'https://images.pokemontcg.io/base6/29_hires.png');
assert.equal(M.upgradeCardImageUrl('https://cards.scryfall.io/normal/front/a/b/ab.jpg'), 'https://cards.scryfall.io/large/front/a/b/ab.jpg');
assert.equal(M.upgradeCardImageUrl('https://tcgplayer-cdn.tcgplayer.com/product/42382_200w.jpg'), 'https://tcgplayer-cdn.tcgplayer.com/product/42382_in_1000x1000.jpg');
assert.equal(M.relayedImageUrl('https://images.pokemontcg.io/base6/29.png', 'https://w.example/'), 'https://w.example/card-image?url=' + encodeURIComponent('https://images.pokemontcg.io/base6/29_hires.png'));
assert.equal(M.relayedImageUrl('blob:https://x/123', 'https://w.example'), 'blob:https://x/123', 'offline cached images need no relay');

// ── Worker relay: card-image hosts only, CORS on, cached ──
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
{
  const s = worker.indexOf('const CARD_IMAGE_HOSTS'), e = worker.indexOf('async function cardImageRelay', s);
  const allowed = new Function(worker.slice(s, e) + '; return cardImageRelayAllowed;')();
  assert.equal(allowed('https://images.pokemontcg.io/base6/29_hires.png'), true);
  assert.equal(allowed('https://product-images.tcgplayer.com/fit-in/1000x1000/42382.jpg'), true);
  assert.equal(allowed('https://evil.example/x.png'), false, 'not an open proxy');
  assert.equal(allowed('https://pokemontcg.io.evil.example/x.png'), false);
  assert.equal(allowed('http://images.pokemontcg.io/x.png'), false, 'https only');
  assert.equal(allowed('https://user:pw@images.pokemontcg.io/x.png'), false);
}
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
const stored = new Map();
globalThis.caches = { default: { match: async k => stored.get(k.url) || null, put: async (k, v) => { stored.set(k.url, v); } } };
let upstream = 0;
globalThis.fetch = async (input) => {
  upstream++;
  if (String(input).includes('notimage')) return new Response('<html>', { headers:{ 'Content-Type':'text/html' } });
  return new Response(new Uint8Array([137, 80, 78, 71]), { headers:{ 'Content-Type':'image/png' } });
};
try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const env = { SUPABASE_URL:'https://database.example', SUPABASE_SERVICE_ROLE_KEY:'test-only' };
  const ctx = { waitUntil(p) { return p; } };
  const img = 'https://images.pokemontcg.io/base6/29_hires.png';
  const res = await api.fetch(new Request('https://api.example/card-image?url=' + encodeURIComponent(img)), env, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*', 'canvas can read it');
  assert.equal(res.headers.get('content-type'), 'image/png');
  await new Promise(r => setTimeout(r, 0));
  const again = await api.fetch(new Request('https://api.example/card-image?url=' + encodeURIComponent(img)), env, ctx);
  assert.equal(again.status, 200);
  assert.equal(upstream, 1, 'second request served from cache');
  const bad = await api.fetch(new Request('https://api.example/card-image?url=' + encodeURIComponent('https://evil.example/a.png')), env, ctx);
  assert.equal(bad.status, 400);
  const notImage = await api.fetch(new Request('https://api.example/card-image?url=' + encodeURIComponent('https://images.pokemontcg.io/notimage')), env, ctx);
  assert.equal(notImage.status, 502, 'only images are relayed');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
}

// ── Loupe wiring ──
const loupe = fs.readFileSync('scripts/research-loupe.js', 'utf8');
assert.match(loupe, /'<div class="rloupe-compare"><\/div>'/, 'the compare section sits at the bottom of Loupe');
assert.match(loupe, /🆚 COMPARE TO REAL CARD <span>free -- no credits used<\/span>/);
assert.match(loupe, /storeWorkerFetch\('\/card-compare\/search\?game=' \+ game \+ '&q=' \+ encodeURIComponent\(q\)/, 'finds the real card without Research credits');
assert.match(loupe, /data-cmp="camera">📸 USE CAMERA<\/button>/);
assert.match(loupe, /else if\(act === 'camera'\) enterCompareCapture\(\);/, 'the camera opens with a frame and shutter on the preview');
assert.match(loupe, /dom\.camera\.scrollIntoView\(/, 'the camera is brought into view to line the card up');
assert.match(loupe, /'\.rloupe-camera\.rloupe-capture\{max-height:none;height:70vh;min-height:320px;\}'/, 'a tall preview for a tall card');
assert.match(loupe, /window\.CardCompare\.open\(\{ card:card, photo:canvas, frameQuad:frameQuad \|\| null \}\)/);
{
  // Frame geometry: card-shaped, centered, mapped through object-fit:cover.
  const src = ['guideRect', 'boxToVideo'].map(n => { const i = loupe.indexOf('function ' + n + '('); return loupe.slice(i, loupe.indexOf('\n}\n', i) + 2); }).join('\n');
  const g = new Function('var CARD_RATIO = 63 / 88;\n' + src + '\nreturn { guideRect, boxToVideo };')();
  const r = g.guideRect(400, 600);
  assert.ok(Math.abs(r.w / r.h - 63 / 88) < 1e-9 && Math.abs(r.x + r.w / 2 - 200) < 1e-9 && Math.abs(r.y + r.h / 2 - 300) < 1e-9);
  // 400x600 box showing a 1920x1080 video (cover): center maps to center.
  const c = g.boxToVideo(200, 300, 400, 600, 1920, 1080);
  assert.ok(Math.abs(c[0] - 960) < 1e-6 && Math.abs(c[1] - 540) < 1e-6);
  const tl = g.boxToVideo(0, 0, 400, 600, 1920, 1080); // cover scale = 600/1080, so x is cropped
  assert.ok(Math.abs(tl[1]) < 1e-6 && tl[0] > 0);
}
// Starting corners from the camera frame: the card's real edges near it, or the frame.
{
  const frame = [[110, 100], [660, 100], [660, 870], [110, 870]];
  const q = M.startQuad(shot.rgba, shot.w, shot.h, frame);
  q.forEach((p, i) => assert.ok(Math.abs(p[0] - quad[i][0]) < 40 && Math.abs(p[1] - quad[i][1]) < 40, 'snapped to the card edge ' + i + ' ' + p));
  const blank = new Uint8ClampedArray(shot.w * shot.h * 4).fill(40);
  assert.deepEqual(M.startQuad(blank, shot.w, shot.h, frame), frame, 'no edges found: the frame itself');
}

// ── Free card search (TCGdex + Scryfall): no credits ──
{
  const s0 = worker.indexOf('function parseCompareQuery'), e0 = worker.indexOf('\n}\n', s0) + 2;
  const parse = new Function(worker.slice(s0, e0) + '; return parseCompareQuery;')();
  assert.deepEqual(parse('143/142'), { name:'', number:'143', total:142 });
  assert.deepEqual(parse('Charizard 4/102'), { name:'Charizard', number:'4', total:102 });
  assert.deepEqual(parse('Dark Slowbro #029'), { name:'Dark Slowbro', number:'29', total:0 });
  assert.deepEqual(parse('Nymris'), { name:'Nymris', number:'', total:0 });
}
{
  const originalFetch2 = globalThis.fetch, originalCaches2 = globalThis.caches;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = decodeURIComponent(String(input)); calls.push(url);
    const ok = d => new Response(JSON.stringify(d), { headers:{ 'Content-Type':'application/json' } });
    if (url.includes('/auth/v1/user')) return ok({ id:'u1', email:'staff@example.com' });
    if (url.includes('store_members')) return ok([{ role:'owner' }]);
    if (url === 'https://api.tcgdex.net/v2/en/sets') return ok([{ id:'sv06', name:'Twilight Masquerade', cardCount:{ official:167 } }, { id:'sv07', name:'Stellar Crown', cardCount:{ official:142 } }]);
    if (url === 'https://api.tcgdex.net/v2/en/sets/sv07/143') return ok({ id:'sv07-143', localId:'143', name:'Bulbasaur', image:'https://assets.tcgdex.net/en/sv/sv07/143' });
    if (url.startsWith('https://api.tcgdex.net/v2/en/cards?name=')) return ok([{ id:'base6-29', localId:'29', name:'Dark Slowbro', image:'https://assets.tcgdex.net/en/base/base6/29' }]);
    if (url.startsWith('https://api.scryfall.com/cards/search')) return ok({ data:[{ name:'Nymris, Oona\'s Trickster', set_name:'Wilds of Eldraine Commander', collector_number:'7', image_uris:{ large:'https://cards.scryfall.io/large/front/n/y/nymris.jpg' } }] });
    return ok([]);
  };
  try {
    const { default: api } = await import('../cloudflare-worker-full.js');
    const env = { SUPABASE_URL:'https://database.example', SUPABASE_SERVICE_ROLE_KEY:'test-only' };
    const get = async q => (await api.fetch(new Request('https://api.example/card-compare/search?q=' + encodeURIComponent(q), { headers:{ Authorization:'Bearer t', 'X-Store-Id':'store-1' } }), env, { waitUntil(){} })).json();
    const a = await get('143/142');
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.deepEqual(a.cards.map(c => [c.name, c.set, c.number, c.imageUrl]), [['Bulbasaur', 'Stellar Crown', '143', 'https://assets.tcgdex.net/en/sv/sv07/143/high.png']], 'number/total finds the card in the set with 142 official cards');
    const b = await get('Dark Slowbro');
    assert.ok(b.cards.some(c => c.name === 'Dark Slowbro' && c.imageUrl.endsWith('/high.png')));
    const c = await get('Nymris');
    assert.ok(c.cards.some(c2 => c2.game === 'mtg' && /cards\.scryfall\.io\/large/.test(c2.imageUrl)), 'Magic from Scryfall');
    assert.ok(!calls.some(u => /pokemonpricetracker|anthropic|cardsight/i.test(u)), 'no paid lookups');
    const noAuth = await api.fetch(new Request('https://api.example/card-compare/search?q=x'), env, { waitUntil(){} });
    assert.ok(noAuth.status >= 400, 'store sign-in required');
  } finally { globalThis.fetch = originalFetch2; globalThis.caches = originalCaches2; }
}
const html = fs.readFileSync('dashboard.html', 'utf8');
const tag = html.match(/<script src="scripts\/card-compare\.js\?v=([^"]+)" defer><\/script>/);
assert.ok(tag, 'card-compare.js is loaded');
assert.equal(tag[1], html.match(/<meta name="version" content="([^"]+)">/)[1], 'card-compare.js cache key is the app version');
const compare = fs.readFileSync('scripts/card-compare.js', 'utf8');
assert.doesNotMatch(compare, /anthropic|claude|cardsight|openai/i, 'no AI / paid lookups');
console.log('Card compare relay + Loupe wiring checks passed');
