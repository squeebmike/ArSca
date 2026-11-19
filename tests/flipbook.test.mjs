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
for (const k of ["import('./flipbook.mjs?v=2')", "if('flip' in m)paintFlip(m.flip);", "if('flip' in ev.data)paintFlip(ev.data.flip);", 'now:()=>Date.now()+offset']) assert.ok(ov.includes(k), k);
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
