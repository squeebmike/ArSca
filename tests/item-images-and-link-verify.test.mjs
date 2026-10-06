import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store report: some items had no image (cards added from a pasted
// TCGplayer link carried the product id but no image), and links in item
// info wouldn't verify for MTG and some sports cards.
const dash = fs.readFileSync('dashboard.html', 'utf8');
const between = (from, to) => { const a = dash.indexOf(from); const b = dash.indexOf(to, a); assert.ok(a >= 0 && b > a, 'missing ' + from); return dash.slice(a, b); };

// ── Images ──
{
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(between('function catalogImageFromIds(item={}){', 'function inventoryImageUrl(item={}){') + 'this.f=catalogImageFromIds;', ctx);
  assert.equal(ctx.f({ tcgPlayerId:'715952' }), 'https://product-images.tcgplayer.com/fit-in/437x437/715952.jpg');
  assert.equal(ctx.f({ raw:{ tcgPlayerUrl:'https://www.tcgplayer.com/product/568102/Pokemon%20Japan-SV6' } }), 'https://product-images.tcgplayer.com/fit-in/437x437/568102.jpg', 'id read from a saved TCGplayer link');
  assert.equal(ctx.f({ scryfallId:'0000579f-7b35-4ed3-b44c-db2a538066fe' }), 'https://api.scryfall.com/cards/0000579f-7b35-4ed3-b44c-db2a538066fe?format=image&version=normal');
  assert.equal(ctx.f({ name:'Mystery' }), '');
}
assert.match(dash, /durableImageUrl\(raw\.images\?\.\[0\]\) \|\|\n    catalogImageFromIds\(item\);\n\}/, 'the image picker falls back to the catalog image');
assert.match(dash, /if\(!hasImage\)\{const img=catalogImageFromIds\(\{\.\.\.item,\.\.\.out,raw:item\.raw\}\);if\(img\)\{out\.image=img;out\.imageUrl=img;out\.thumbnail=img;\}\}/, 'saved with the item when it has no image');

// ── PriceCharting reference: an untouched reference keeps its id ──
{
  const elements = {};
  const ctx = { document:{ getElementById: id => elements[id] || (elements[id] = { value:'', style:{}, textContent:'' }) }, fetch: async () => { throw new Error('should not verify an unchanged reference'); }, WORKER:'https://w', URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext(between('let inventoryPcReferenceState = ', '// PriceCharting comic URLs are slug-based') + 'this.populate=populateInventoryPcReference;this.patch=inventoryPcReferencePatch;', ctx);
  // A sports card pinned by id, edited for something else.
  ctx.populate({ pricechartingProductId:'6297730', pricechartingProductName:'Felnin Celesten', providerUrl:'https://www.sportscardspro.com/game/x/y' });
  let p = await ctx.patch({ pricechartingProductId:'6297730', pricechartingProductName:'Felnin Celesten', providerUrl:'https://www.sportscardspro.com/game/x/y' });
  assert.equal(p.pricechartingProductId, '6297730', 'saving an edit no longer wipes the id');
  assert.equal(p.providerUrl, 'https://www.sportscardspro.com/game/x/y');
  // A short /game/<id> link carries its id.
  ctx.populate({ providerUrl:'https://www.sportscardspro.com/game/12461202' });
  p = await ctx.patch({ providerUrl:'https://www.sportscardspro.com/game/12461202' });
  assert.equal(p.pricechartingProductId, '12461202');
  // An MTG card's TCGplayer link stays out of the PriceCharting box.
  ctx.populate({ providerUrl:'https://www.tcgplayer.com/product/715952/Magic-Reality' });
  assert.equal(elements['edit-pricecharting-ref'].value, '', 'no TCGplayer link in the PriceCharting box');
}

// ── TCGplayer VERIFY for every game ──
{
  const elements = {};
  const calls = [];
  const ctx = {
    WORKER:'https://w', Number, String, Math,
    fetch: async (url) => {
      calls.push(String(url));
      if (String(url).startsWith('https://w/pricing/tcgplayer/product/715952')) return new Response(JSON.stringify({ ok:true, imageUrl:'img', pricepoints:[{ printingType:'Normal', marketPrice:12.5 }, { printingType:'Foil', marketPrice:30 }] }), { status:200 });
      if (String(url).startsWith('https://api.scryfall.com/cards/tcgplayer/715952')) return new Response(JSON.stringify({ name:'Denzilore Fatehold', set_name:'Reality Fracture' }), { status:200 });
      if (String(url).startsWith('https://w/pricing/tcgplayer/product/999')) return new Response(JSON.stringify({ ok:false, error:'TCGplayer HTTP 404' }), { status:404 });
      throw new Error('unexpected ' + url);
    },
    inventoryTcgReferenceState:{ verified:null },
  };
  vm.createContext(ctx);
  vm.runInContext(between('async function verifyTcgplayerProductAnyGame(', 'async function inventoryTcgReferencePatch(') + 'this.v=verifyTcgplayerProductAnyGame;this.state=()=>inventoryTcgReferenceState;', ctx);
  const status = { style:{}, textContent:'' }, input = { value:'715952' };
  const ok = await ctx.v('715952', { category:'Magic: The Gathering', selectedFinish:'Normal' }, { input, status, button:{} });
  assert.ok(ok, 'an MTG product verifies');
  assert.match(status.textContent, /✓ TCGplayer #715952 · Denzilore Fatehold · Reality Fracture · NM market \$12\.50/);
  assert.equal(input.value, 'https://www.tcgplayer.com/product/715952');
  const bad = await ctx.v('999', { category:'Magic: The Gathering' }, { input:{ value:'999' }, status, button:{} });
  assert.equal(bad, null);
  assert.match(status.textContent, /TCGplayer has no product #999/);
}
assert.match(dash, /if\(!\/pok\[eé\]mon\/i\.test\(String\(formItem\.category \|\| ''\)\)\) return verifyTcgplayerProductAnyGame\(id, formItem, \{ input, status, button \}\);/, 'non-Pokémon items use the any-game check');
console.log('Item images and link verify (dashboard) checks passed');

// ── Worker: reading a PriceCharting/SportsCardsPro product link ──
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const seen = [];
globalThis.fetch = async (input) => {
  const url = String(input); seen.push(url);
  const ok = d => new Response(JSON.stringify(d), { status:200, headers:{ 'Content-Type':'application/json' } });
  if (url.startsWith('https://www.sportscardspro.com/game/') || url.startsWith('https://www.pricecharting.com/game/')) return new Response('blocked', { status:403 });
  if (url.startsWith('https://www.pricecharting.com/api/products?')) return ok({ products:[
    { id:'111', 'product-name':'Nick Kurtz [Blue Lights] #H40', 'console-name':'Baseball Cards 2025 Topps Holiday' },
    { id:'222', 'product-name':'Nick Kurtz [Blue Lights] #H40', 'console-name':'Baseball Cards 2025 Topps Chrome' },
  ] });
  if (url.startsWith('https://www.pricecharting.com/api/product?id=111')) return ok({ 'product-name':'Nick Kurtz [Blue Lights] #H40', 'console-name':'Baseball Cards 2025 Topps Holiday', 'loose-price':450 });
  if (url.startsWith('https://www.pricecharting.com/api/product?id=')) return ok({});
  return ok({});
};
try {
  const { default: api } = await import('../cloudflare-worker-full.js');
  const env = { PRICECHARTING_TOKEN:'t' };
  const read = async link => (await api.fetch(new Request('https://api.example/pricing/sportscardspro/resolve-url?url=' + encodeURIComponent(link)), env, { waitUntil() {} })).json();
  // The page read is blocked: the id comes from the API, exact names only.
  let d = await read('https://www.sportscardspro.com/game/baseball-cards-2025-topps-holiday/nick-kurtz-blue-lights-h40');
  assert.equal(d.ok, true);
  assert.equal(d.match.productId, '111', 'the exact console + name match, not the Chrome card with the same name');
  assert.equal(d.match.market, 4.5);
  // A PriceCharting (non-sports) link is read on pricecharting.com.
  seen.length = 0;
  d = await read('https://www.pricecharting.com/game/magic-reality-fracture/omnipresence-110');
  assert.ok(seen.some(u => u.startsWith('https://www.pricecharting.com/game/magic-reality-fracture/omnipresence-110')), 'read on its own site');
  assert.ok(!seen.some(u => u.startsWith('https://www.sportscardspro.com/game/magic')), 'not on sportscardspro.com');
  // A search results link gets a clear message.
  d = await read('https://www.pricecharting.com/search-products?q=Demonic%20Consultation&type=prices');
  assert.equal(d.ok, false);
  assert.match(d.error, /search results page/);
} finally {
  globalThis.fetch = originalFetch; globalThis.caches = originalCaches;
}
console.log('Product link reading (Worker) checks passed');
