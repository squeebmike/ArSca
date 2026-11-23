// THE FOC FLIPBOOK (store, 2026-11-14: "scroll through books? Flip through books? Show the synopsis. All
// automatically?") and the leader's entrance in the 3DS battle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const F = await import('../scripts/flipbook.mjs');
const row = (t, v, x = {}) => ({ title: t, variant_label: v, cover_image_url: 'https://img.example/' + encodeURIComponent(t + v) + '.jpg', foc_date: '2026-11-16', on_sale_date: '2026-12-10', customer_price_cents: 499, msrp_cents: 499, description: 'A synopsis.', writer: 'W', interior_artist: 'A', cover_artist: 'C', publisher: 'P', ...x });
// One book per title, its covers inside, the ratio cover last; only https covers; the synopsis capped.
const books = F.booksFromSkus([row('HERO #1', 'Cover B 1:25', { is_incentive: true, order_requirement: '1:25', customer_price_cents: 2499 }), row('HERO #1', 'Cover A'), row('SQUAD #2', 'Cover A', { description: 'x'.repeat(5000) }), row('BAD', 'Cover A', { cover_image_url: 'http://insecure/x.jpg' })]);
assert.deepEqual(books.map(b => b.title), ['HERO #1', 'SQUAD #2']); assert.deepEqual(books[0].covers.map(c => c.label), ['Cover A', 'Cover B 1:25']); assert.equal(books[0].covers[1].tag, '1:25'); assert.equal(books[0].covers[1].price, 24.99);
const clean = F.cleanFlipItems(books); assert.equal(clean[1].synopsis.length, F.FLIP_SYN); assert.equal(F.cleanFlipItems([{ title: 'X', covers: [{ image: 'javascript:alert(1)' }] }]).length, 0, 'no unsafe images');
assert.equal(F.cleanFlipItems(Array.from({ length: 300 }, (_, k) => ({ title: 'B' + k, covers: [{ image: 'https://i.example/' + k + '.jpg' }] }))).length, F.FLIP_MAX);
// The page comes from the clock: each book gets its seconds, split between its covers; it wraps round.
const flip = { items: clean, secs: 10, at: 1000 };
assert.deepEqual([F.flipAt(flip, 1000).i, F.flipAt(flip, 1000).c], [0, 0]); assert.equal(F.flipAt(flip, 6500).c, 1, 'the second cover halfway through');
assert.equal(F.flipAt(flip, 11500).i, 1); assert.equal(F.flipAt(flip, 21500).i, 0, 'round again'); assert.equal(F.flipAt({ items: [] }, 0), null);
const fsrc = read('scripts/flipbook.mjs'); assert.ok(!/Math\.random/.test(fsrc), 'nothing random');
// The room keeps it and sends it to every overlay; the remote loads it; the overlay draws it.
const room = read('scripts/live-studio-room.mjs'), api = read('scripts/live-studio-api.mjs'), ov = read('scripts/live-studio-overlay.mjs'), ctl = read('scripts/live-studio-controls.js');
for (const k of ['  setFlip(input = {}) {', 'f.items = cleanFlipItems(input.items)', "f.at -= input.step === 1 ? cur.per - cur.into : -(cur.into + bookMs(f, prev));", 'flip:state.flip || null']) assert.ok(room.includes(k), k);
assert.ok(api.includes("url.pathname==='/live-studio/flip'"));
for (const k of ["import('./flipbook.mjs?v=7')", "if('flip' in m)paintFlip(m.flip);", "if('flip' in ev.data)paintFlip(ev.data.flip);", 'now:()=>Date.now()+offset']) assert.ok(ov.includes(k), k);
for (const k of ['id="fb-go"', 'id="fb-next"', 'id="fb-back"', 'id="fb-off"', 'id="fb-week"', 'id="fb-jump"', "sb.from('comic_skus').select('title,variant_label,cover_image_url,foc_date,on_sale_date,customer_price_cents,msrp_cents,description,writer,interior_artist,cover_artist,publisher,is_incentive,order_requirement').eq('store_id',id).in('cycle_id',ids)", "api('flip',body)", 'flip:flipCtl']) assert.ok(ctl.includes(k), k);
// The leader's entrance: letterboxed camera sweep round the leader, their name and line, then the fight.
const b3 = read('scripts/beasts-3d.mjs');
for (const k of ['const CUT_MS = 3200', 'function camFrame(now) {', "f('GYM LEADER', 8, 96, 5, '#ffd84a')", "gymOf(b.trainer).line", 'introAt = cutStart + cut', 'setTimeout(() => throwComics(), cut + 2200)']) assert.ok(b3.includes(k), k);
console.log('FOC flipbook + leader entrance: passed');
// 2026-11-19: "select a FOC week and it shows all covers in alphabetical order".
{
  assert.deepEqual(F.splitSkuTitle('AMAZING SPIDER-MAN #1007 COVER C MARK BUCKINGHAM 1:25 VARIANT'), { book: 'AMAZING SPIDER-MAN #1007', cover: 'COVER C MARK BUCKINGHAM 1:25 VARIANT' });
  assert.deepEqual(F.splitSkuTitle('ABSOLUTE CATWOMAN #5 (OF 6) CVR E INC 1:25 RICKIE YAGAWA CARD STOCK VAR'), { book: 'ABSOLUTE CATWOMAN #5 (OF 6)', cover: 'COVER E INC 1:25 RICKIE YAGAWA CARD STOCK VAR' });
  assert.equal(F.splitSkuTitle('Hellraiser: Hellbound Hearts #1 H 1:100 INCV (Full Art, Ito)').book, 'Hellraiser: Hellbound Hearts #1');
  assert.equal(F.splitSkuTitle('RED SONJA SOLSTICE SPECIAL #1 (ONE SHOT) CVR A FRANCESCO MATTINA').book, 'RED SONJA SOLSTICE SPECIAL #1 (ONE SHOT)');
  assert.equal(F.splitSkuTitle('VAMPIRE ON AISLE 6 #1 (OF 3) CVR A ZOE THOROGOOD (MR)').cover, 'COVER A ZOE THOROGOOD');
  const week = F.booksFromSkus([
    row('WOLVERINE #31 COVER A', 'Variant Title'), row('AMAZING SPIDER-MAN #1007 COVER D MARK SPEARS VIRGIN 1:100 VARIANT', 'Variant Title', { is_incentive: true }),
    row('AMAZING SPIDER-MAN #1007 COVER B MARK SPEARS VARIANT', 'Variant Title'), row('AMAZING SPIDER-MAN #1007 COVER A', 'Cover A'), row('absolute wonder woman #27 CVR A HAYDEN SHERMAN', 'Cvr A')]);
  assert.deepEqual(week.map(b => b.title), ['absolute wonder woman #27', 'AMAZING SPIDER-MAN #1007', 'WOLVERINE #31'], 'A to Z, whatever the case');
  assert.deepEqual(week[1].covers.map(c => c.label), ['COVER A', 'COVER B MARK SPEARS VARIANT', 'COVER D MARK SPEARS VIRGIN 1:100 VARIANT'], 'Cover A first, the ratio last');
  assert.equal(week[1].covers[2].tag, '1:100');
  // A book with many covers stays up longer; BACK / NEXT and GO TO move by whole books.
  const big = { secs: 12, at: 0, items: [{ title: 'A', covers: Array.from({ length: 12 }, () => ({})) }, { title: 'B', covers: [{}] }] };
  assert.equal(F.bookMs(big, big.items[0]), 48000); assert.equal(F.bookMs(big, big.items[1]), 12000);
  assert.equal(F.flipAt(big, 47000).i, 0); assert.equal(F.flipAt(big, 47000).c, 11); assert.equal(F.flipAt(big, 49000).i, 1); assert.equal(F.flipAt(big, 61000).i, 0, 'round again');
  assert.equal(F.cleanFlipItems(Array.from({ length: 300 }, (_, k) => ({ title: 'B' + k, covers: [{ image: 'https://i.example/' + k + '.jpg' }] }))).length, 250, 'a whole week fits');
  for (const k of ['if (Number.isInteger(input.jump)', "Flipbook: too many books at once"]) assert.ok(room.includes(k), k);
  assert.ok(api.includes("url.pathname==='/live-studio/flip'?800*1024"), 'the whole week fits through the door');
}
console.log('FOC flipbook: a week, A to Z, every cover: passed');

// "We should be behind our beast" (2026-11-15): the camera over your shoulder, the host and Champ behind your beast.
{ const b3 = readFileSync(new URL('../scripts/beasts-3d.mjs', import.meta.url), 'utf8');
  assert.ok(b3.includes('cam.position.set(-1.9, 1.7, 6.4); cam.lookAt(0.6, 0.7, -1.4);') && b3.includes('CAM_POS = new THREE.Vector3(-1.9, 1.7, 6.4)'));
  const m = /c\.home = i \? new THREE\.Vector3\(([-\d.]+), 0, ([-\d.]+)\) : new THREE\.Vector3\(([-\d.]+), 0, ([-\d.]+)\)/.exec(b3); assert.ok(m);
  assert.ok(+m[2] > 1.7 && +m[4] > 1.7 && +m[1] < -1.5 && +m[3] < -1.5, 'both stand behind your beast (at -1.5, 1.7), between it and the camera'); }

// THE FOC SHOW (2026-11-19: "I want 1 through 5. I want them automated ... No button pressing from me other than to
// change the display type"): AUTO MIX runs the games in turn on the studio clock; one dropdown picks a display.
{
  const items = [{ title: 'A #1', covers: [{ image: 'https://i/1', tag: '1:25', artist: 'Mark Spears' }, { image: 'https://i/2', label: 'COVER B' }] }, { title: 'B #1', coverArtist: 'Jim Lee', covers: [{ image: 'https://i/3' }] }];
  const auto = { items, at: 0, show: 'auto', secs: 12, wanted: [] };
  const kinds = []; for (let t = 0; t < 600000; t += 5000) { const s = F.segmentAt(auto, t); if (kinds[kinds.length - 1] !== s.kind) kinds.push(s.kind); }
  for (const k of ['flip', 'wall', 'versus', 'mystery', 'artist']) assert.ok(kinds.includes(k), 'AUTO MIX shows ' + k);
  assert.ok(!kinds.includes('wanted'), 'nothing ordered yet: MOST WANTED waits');
  const withWanted = { ...auto, wanted: F.cleanWanted([{ title: 'A #1', image: 'https://i/1' }, { title: 'bad', image: 'http://x' }]) };
  assert.equal(withWanted.wanted.length, 1);
  const k2 = new Set(); for (let t = 0; t < 900000; t += 5000) k2.add(F.segmentAt(withWanted, t).kind); assert.ok(k2.has('wanted'));
  // The flipbook carries on where it left off after a game.
  const s0 = F.segmentAt(auto, 74000), s1 = F.segmentAt(auto, 75000 + 40000 + 25000 + 1000);
  assert.equal(s0.kind, 'flip'); assert.equal(s1.kind, 'flip'); assert.equal(s1.flipAt, 75000 + 40000 + 25000 + 1000 - 75000 - 1000, 'flip clock paused during the games');
  // One display held: versus moves to a new pair every 25 seconds; the same moment is the same for every overlay.
  const vs = { ...auto, show: 'versus' };
  assert.equal(F.segmentAt(vs, 10000).kind, 'versus'); assert.equal(F.segmentAt(vs, 30000).k, 1);
  assert.deepEqual(F.gamePick(vs, F.segmentAt(vs, 10000)), F.gamePick(vs, F.segmentAt(vs, 10000)));
  assert.equal(F.gamePick(vs, F.segmentAt(vs, 10000)).b.title, 'A #1', 'only books with 2+ covers go head to head');
  assert.equal(F.segmentAt({ ...auto, show: 'versus', items: [items[1]] }, 1000).kind, 'flip', 'no book with two covers: the flipbook instead');
  const art = F.gamePick({ ...auto, show: 'artist' }, { kind: 'artist', k: 1 }); assert.ok(art.c.artist || art.b.coverArtist);
  assert.equal(F.segmentAt({ ...auto, show: 'wanted' }, 1000).kind, 'wanted', 'MOST WANTED held: says the order is just starting');
  assert.ok(!/Math\.random/.test(read('scripts/flipbook.mjs')), 'nothing drawn');
  const room2 = read('scripts/live-studio-room.mjs'), ctl2 = read('scripts/live-studio-controls.js');
  assert.ok(room2.includes("if (!SHOWS.includes(input.show)) throw new Error('Flipbook: unknown display'); f.show = input.show;") && room2.includes('f.wanted = cleanWanted(input.wanted)'));
  for (const k of ['id="fb-show"', '<option value="auto">', "await flipDo({show:s.value})", ".or('store_quantity.gt.0,secured_quantity.gt.0')", '},120000);']) assert.ok(ctl2.includes(k), k);
}
console.log('FOC show (auto mix, wall, versus, mystery, artist, most wanted): passed');

// FOC SHOW (store, 2026-11-19: "How is it in its own little section and easy to get to, easy to change?"): its own
// section near the top of the remote, one START / END, and BOOKS ONLY on the overlay (camera on top, books below).
{
  const ctl3 = read('scripts/live-studio-controls.js'), ov3 = read('scripts/live-studio-overlay.mjs'), room3 = read('scripts/live-studio-room.mjs');
  const sec = ctl3.indexOf('<section class="fb-sec" id="foc-show-sec"'), vend = ctl3.indexOf('<h3>🥤 Vending machine</h3>');
  assert.ok(sec > 0 && sec < vend, 'its own section, above the vending machine');
  for (const k of ['id="fb-start"', 'id="fb-end"', '<button type="button" data-click="#foc-show-sec">📚 FOC SHOW</button>', "mode:'lower'", 'only:true,on:true', 'await flipDo({on:false,only:false})']) assert.ok(ctl3.includes(k), k);
  assert.ok(room3.includes("if (typeof input.only === 'boolean') f.only = input.only;"));
  assert.ok(ov3.includes("body.fb-only>*:not(.fb):not(script):not(style){visibility:hidden!important}") && ov3.includes("document.body.classList.toggle('fb-only',!!(flipState&&flipState.on&&flipState.only&&flipState.items?.length))"));
  console.log('FOC show section, START / END, books only: passed');
}
// BAG & BOARD SHOW (store, 2026-11-19: "when we're boarding and bagging the new releases ... flip through all the books
// that we ordered that will be in the show"): the books ordered for that week (PRH's Tuesday + Lunar's Wednesday),
// only the covers ordered, A to Z, books only on the lower half.
{
  const c4 = read('scripts/live-studio-controls.js');
  const sec = c4.indexOf('<section class="fb-sec" id="bb-show-sec"'), vend = c4.indexOf('<h3>🥤 Vending machine</h3>');
  assert.ok(sec > 0 && sec < vend);
  for (const k of ['id="bb-week"', 'id="bb-start"', 'id="bb-end"', '<button type="button" data-click="#bb-show-sec">📦 BAG &amp; BOARD</button>',
    ".or('store_quantity.gt.0,secured_quantity.gt.0').not('cover_image_url','is',null).order('title',{ascending:true})", "gte('on_sale_date',ymd(new Date(Date.parse(day+'T12:00:00Z')-864e5))).lte('on_sale_date',day)",
    "x.setUTCDate(x.getUTCDate()+((3-x.getUTCDay()+7)%7))", "mode:'lower',title:'NEW '+mdy(day)", 'wanted:[],only:true,on:true']) assert.ok(c4.includes(k), k);
  console.log('Bag & board show: passed');
}
// 2026-11-23: "Which one would you pull? Change pull to grab."
assert.ok(read('scripts/flipbook.mjs').includes('WHICH ONE WOULD YOU GRAB?') && !read('scripts/flipbook.mjs').includes('WOULD YOU PULL'));
console.log('Cover vs cover says GRAB: passed');
// 2026-11-23: "The wall should show all the covers and slide across screen ... you can't see anything" / "Change who drew
// this cover to name the artist".
{ const fb = read('scripts/flipbook.mjs');
  assert.ok(fb.includes('export const WALL_PAGE = 90, WALL_COVER_MS = 2400;') && fb.includes('<div class="fbg-row"><div class="fbg-track"') && fb.includes(".fbg-track img{height:100%;aspect-ratio:2/3"));
  assert.ok(fb.includes("tr.style.transform = 'translateX(' + (dir < 0 ? -dist : dist - n * tw) + 'px)';"), 'rows slide on the studio clock, odd rows the other way');
  assert.ok(fb.includes('NAME THE ARTIST! <em>TYPE IT IN CHAT!</em>') && !fb.includes('WHO DREW THIS COVER'));
  const wall = F.gamePick({ items: Array.from({ length: 100 }, (_, k) => ({ title: 'B' + k, covers: [{ image: 'https://i/' + k }] })) }, { kind: 'wall', k: 1 });
  assert.equal(wall.tiles.length, 10, 'the second page: the rest'); assert.equal(wall.pages, 2);
  console.log('The wall slides; name the artist: passed'); }
// 2026-11-23: "Some of the covers aren't loading" -- PRH's full-size covers (up to ~6 MB) were over the image relay's
// 4 MB cap. The relay asks PRH for its 600-pixel copy; the wall, thumbnails and podium ask for smaller ones still.
{ assert.equal(F.sizedCover('https://images.penguinrandomhouse.com/cover/d/9781506754949', 300), 'https://images.penguinrandomhouse.com/cover/300/9781506754949');
  assert.equal(F.sizedCover('https://still-resonance-4f87.swarnerauto.workers.dev/foc/lunar-cover/1126IM0354.jpg', 300), 'https://still-resonance-4f87.swarnerauto.workers.dev/foc/lunar-cover/1126IM0354.jpg', 'Lunar covers are already small');
  const fb = read('scripts/flipbook.mjs'), wk = read('cloudflare-worker-full.js');
  assert.equal((fb.match(/sizedCover\((x\.c|o|w)\.image, \d+\)/g) || []).length, 3, 'wall, thumbnails, podium');
  assert.ok(wk.includes("if (target.hostname === 'images.penguinrandomhouse.com' && /^\\/cover\\/d\\//.test(target.pathname)) target.pathname = target.pathname.replace(/^\\/cover\\/d\\//, '/cover/600/');"));
  console.log('Covers load (PRH sized down): passed'); }
