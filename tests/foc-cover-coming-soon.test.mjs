import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store asks: "Let's not accidentally list books again if they've already
// been listed. We're doing the variation postings (all covers one
// listing)? Have no-cover-art auto update somehow? Have a cover coming soon
// placeholder? To save on listings?"
const dash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const svc = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const grab = (src, n) => { let s = src.indexOf('function ' + n + '('); assert.ok(s >= 0, n); if (src.slice(s - 6, s) === 'async ') s -= 6; const one = src.slice(s, src.indexOf('\n', s)); if (/\}\s*$/.test(one) && (one.match(/\{/g) || []).length === (one.match(/\}/g) || []).length) return one + '\n'; return src.slice(s, src.indexOf('\n}\n', s) + 3); };

// ── The plan: one listing per issue, placeholders, joining live listings ──
const ctx = {};
vm.runInNewContext(['focListNeedsPrice', 'focListHasQty'].map(n => grab(dash, n)).join('') + grab(dash, 'focListWeekPlan') + 'this.plan=focListWeekPlan;', ctx);
const v = (id, o = {}) => ({ id, ebayPresaleStatus:'ELIGIBLE_NOW', coverImageUrl:'https://img/' + id, priceCents:499, msrpCents:399, storeQuantity:2, ...o });
const plan = ctx.plan([
  { id:'f1', title:'All New #1', variants:[v('a'), v('b', { coverImageUrl:'' }), v('c', { coverImageUrl:'' })] },
  { id:'f2', title:'Live Group #2', variants:[v('d', { ebayPresaleStatus:'LISTED', ebayTradingGroup:true }), v('e', { coverImageUrl:'' }), v('f', { ebayPresaleStatus:'TOO_EARLY', ebayEligibleDate:'2026-11-03' })] },
  { id:'f3', title:'Live Single #3', variants:[v('g', { ebayPresaleStatus:'LISTED' }), v('h')] },
  { id:'f4', title:'Lonely #4', variants:[v('i', { coverImageUrl:'' })] },
  { id:'f5', title:'No Art Anywhere #5', variants:[v('j', { coverImageUrl:'' }), v('k', { coverImageUrl:'' })] },
  { id:'f6', title:'Grouped Now, Later Too #6', variants:[v('l'), v('m'), v('n', { ebayPresaleStatus:'TOO_EARLY', ebayEligibleDate:'2026-11-05' })] },
  { id:'f7', title:'All Later #7', variants:[v('o', { ebayPresaleStatus:'TOO_EARLY', ebayEligibleDate:'2026-11-09' }), v('p', { ebayPresaleStatus:'TOO_EARLY', ebayEligibleDate:'2026-11-09', coverImageUrl:'' })] },
  { id:'f8', title:'Sold Out #8', variants:[v('q', { ebayPresaleStatus:'SOLD_OUT' })] },
]);
const ids = l => [...l].map(x => x.id);
assert.deepEqual([...plan.groups].map(g => [g.familyId, ids(g.covers)]), [['f1', ['a', 'b', 'c']], ['f6', ['l', 'm']]], 'all covers in one listing; covers with no art go in with the coming-soon picture');
assert.deepEqual(ids(plan.adds), ['e'], 'a ready cover joins its issue\'s live multi-cover listing -- no new listing');
assert.deepEqual(ids(plan.singles), ['h'], 'an issue listed one cover per listing keeps doing that');
assert.deepEqual(ids(plan.noArt), ['i', 'j', 'k'], 'no art and nothing with art to list alongside: waits');
assert.deepEqual(ids(plan.laterAdds), ['f', 'n'], 'later covers of a listed (or listing-now) issue queue to join it');
assert.deepEqual([...plan.laterGroups].map(g => [g.familyId, ids(g.covers)]), [['f7', ['o', 'p']]]);
assert.deepEqual(ids(plan.laterSingles), []);
assert.equal(plan.listed, 3, 'listed and sold-out covers are never listed again');
assert.match(svc, /tradingGroup:!!\(prior\.tradingGroup \|\| \(d\.ebayApiSystem === 'trading' && d\.ebayInventoryItemGroupKey && !d\.ebayWithdrawnAt && row\.status !== 'sold'\)\)/);
assert.match(svc, /ebayTradingGroup:!!presale\.tradingGroup, ebayCoverPending:!!presale\.coverPending,/);

// Joining: straight to the add route (or queued for its eBay date).
{
  const calls = [];
  const c = { api:async (path, o) => { calls.push([path, JSON.parse(o.body)]); return { ok:true, warnings:[] }; }, getActiveStoreId:() => 'st', toast_dash:() => {} };
  vm.runInNewContext(grab(dash, 'focListWeekAdd') + 'this.add=focListWeekAdd;', c);
  assert.deepEqual({ ...(await c.add({ id:'e', qtys:{ e:4 }, mode:'list' })) }, { ok:true });
  assert.deepEqual(calls[0], ['/foc/ebay/add-to-group-listing', { storeId:'st', skuId:'e', quantity:4 }]);
  const q = await c.add({ id:'f', qtys:{ f:1 }, mode:'queue' });
  assert.deepEqual({ ...q.payload }, { skuId:'f', quantity:1 });
  assert.equal(calls.length, 1, 'queuing posts nothing now');
}
assert.match(grab(dash, 'focListWeekRun'), /r=j\.kind==='add'\?await focListWeekAdd\(j\):await focListWeekOne\(/);

// ── The placeholder picture ──
const { COVER_COMING_SOON_JPEG_BASE64 } = await import('../scripts/cover-coming-soon.mjs');
const jpeg = Buffer.from(COVER_COMING_SOON_JPEG_BASE64, 'base64');
assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a real JPEG');
assert.ok(jpeg.length > 20000 && jpeg.length < 200000);
assert.match(worker, /import \{ COVER_COMING_SOON_JPEG_BASE64 \} from '\.\/scripts\/cover-coming-soon\.mjs';/);
assert.match(worker, /if \(url\.pathname === '\/foc\/cover-coming-soon\.jpg' && \(request\.method === 'GET' \|\| request\.method === 'HEAD'\)\) \{/);
assert.match(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8'), /- scripts\/cover-coming-soon\.mjs/);
// Multi-cover listings use it (marked), instead of borrowing another cover's art.
assert.match(worker, /built\.forEach\(v => \{ if \(!v\.imageUrl\) \{ v\.imageUrl = FOC_COVER_COMING_SOON_URL; v\.coverPending = true; \} \}\);/);
assert.doesNotMatch(worker, /built\.forEach\(v => \{ if \(!v\.imageUrl\) v\.imageUrl = anyCoverImage; \}\);/);
assert.match(worker, /\.\.\.\(v\.coverPending \? \{ focCoverPending: true \} : \{\}\),/);
assert.ok(worker.indexOf('const allCoverImages = [...new Set(built.map(v => v.imageUrl).filter(Boolean))];') < worker.indexOf('v.imageUrl = FOC_COVER_COMING_SOON_URL'), 'the bundle shows real covers only');

// ── Adding a cover to a live listing: never twice, every Cover choice kept ──
const add = worker.slice(worker.indexOf("if (url.pathname === '/foc/ebay/add-to-group-listing') {"), worker.indexOf("if (url.pathname === '/foc/ebay/repair-group-listing-photos') {"));
assert.match(add, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/);
assert.match(add, /if \(\(liveRows \|\| \[\]\)\.some\(r => r\.data\?\.focSkuId === skuId && !r\.data\?\.ebayWithdrawnAt\)\) return json\(\{ ok: false, error: 'Already listed on eBay -- not adding it again' \}, 409\);/);
assert.match(add, /if \(new Date\(\) < eligibleDate\) return json\(/, 'still waits for the eBay presale date');
assert.match(add, /if \(!liveLabels\.size\) return json\(/, 'never revises without knowing the live covers');
assert.match(add, /const allLabels = \[\.\.\.new Set\(\[\.\.\.liveLabels\.values\(\), label\]\)\];/);
assert.match(add, /<VariationSpecificsSet><NameValueList><Name>Cover<\/Name>\$\{allLabels\.map/);
assert.match(add, /ebayTradingApiCall\(ebayToken, 'ReviseFixedPriceItem', reviseXml\)/);
assert.match(add, /image, \.\.\.\(sku\.cover_image_url \? \{\} : \{ focCoverPending: true \}\),/);
assert.match(add, /data->>ebayInventoryItemGroupKey=eq\.\$\{encodeURIComponent\(groupKey\)\}/, 'photos re-bound with every row of the listing, the bundle too');
assert.match(add, /for \(let n = 2; taken\.has\(label\.toLowerCase\(\)\); n\+\+\)/, 'its Cover name never repeats one already there');

// ── Art swap every 6 hours ──
{
  const patches = [], posts = [];
  const c = {
    supabaseAdminFetch:async (e, path, o = {}) => {
      if (o.method === 'PATCH') { patches.push([path, JSON.parse(o.body)]); return { data:null }; }
      if (path.startsWith('inventory_items?data->>focCoverPending=eq.true')) return { data:[
        { id:'r1', store_id:'S', data:{ focSkuId:'11111111-1111-4111-8111-111111111111', image:'https://w/foc/cover-coming-soon.jpg', focCoverPending:true, ebayInventoryItemGroupKey:'G1' } },
        { id:'r2', store_id:'S', data:{ focSkuId:'22222222-2222-4222-8222-222222222222', image:'https://w/foc/cover-coming-soon.jpg', focCoverPending:true, ebayInventoryItemGroupKey:'G1' } },
      ] };
      if (path.startsWith('comic_skus?')) return { data:[{ id:'11111111-1111-4111-8111-111111111111', cover_image_url:'https://art/1.jpg' }, { id:'22222222-2222-4222-8222-222222222222', cover_image_url:'' }] };
      return { data:[] };
    },
  };
  c.logged = [];
  vm.runInNewContext(grab(worker, 'runScheduledFocCoverSwap') + 'async function focLogActivity(env, storeId, lines){ logged.push([storeId, ...lines]); }\nthis.swap=runScheduledFocCoverSwap;', c);
  c.focInternalPost = async (env, cx, storeId, path, body) => { posts.push([storeId, path, body]); return { res:{ ok:true }, data:{ ok:true, failed:[] } }; };
  const out = await c.swap({}, {});
  assert.deepEqual({ ...out }, { swapped:1, groups:1 });
  assert.equal(patches.length, 1);
  assert.equal(patches[0][1].data.image, 'https://art/1.jpg');
  assert.ok(!('focCoverPending' in patches[0][1].data), 'no longer waiting for art');
  assert.equal(JSON.stringify(posts), JSON.stringify([['S', '/foc/ebay/repair-group-listing-photos', { groupKey:'G1' }]]));
  assert.equal(c.logged.length, 1, 'noted for the next FOC email');
}
assert.match(worker, /try \{ await runScheduledFocCoverSwap\(env, ctx\); \} catch \(e\) \{ console\.error\('FOC cover swap failed:', e\.message\); \}/);
// Queued listings: an issue (or a cover joining one) goes up with placeholders.
assert.match(worker, /if \(item\.kind === 'single' \? noArt\.length : item\.kind === 'group' \? noArt\.length === \(skuRows \|\| \[\]\)\.length : false\) \{/);
assert.match(worker, /const path = item\.kind === 'group' \? '\/foc\/ebay\/create-presale-group' : item\.kind === 'add' \? '\/foc\/ebay\/add-to-group-listing' : '\/foc\/ebay\/create-presale';/);
assert.match(worker, /const kind = \['group', 'single', 'add'\]\.includes\(raw\?\.kind\) \? raw\.kind : '';/);
console.log('FOC cover-coming-soon, one-listing-per-issue and no-double-listing checks passed');
