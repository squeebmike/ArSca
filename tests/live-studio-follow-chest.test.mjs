// Store, 2026-11-18: "the dungeon wasn't going along with the Whatnot when we were getting sales"
// and "the chests ... one I didn't notice, the other was too quick, I didn't see what was in it".
import assert from 'node:assert/strict';
import fs from 'node:fs';
await import('./helpers/cloudflare-modules-hook.mjs');
const D = await import('../scripts/live-studio-dungeon.mjs');
const M = await import('../scripts/live-studio-model.mjs');
const { ManaLiveStudio } = await import('../scripts/live-studio-room.mjs');
const OLD = '11111111-1111-4111-8111-111111111111', LIVE = '22222222-2222-4222-8222-222222222222';
function fakeRoom(state) {
  const room = Object.create(ManaLiveStudio.prototype);
  let saved = structuredClone(state), seen = new Set();
  room.sql = { exec: (q, ...a) => { if (q.startsWith('SELECT id FROM seen')) return { toArray: () => seen.has(a[0]) ? [{}] : [] }; if (q.startsWith('INSERT INTO seen')) seen.add(a[0]); return { toArray: () => [] }; } };
  room.ctx = { storage: { transactionSync: f => f() }, getWebSockets: () => [] };
  room.read = () => structuredClone(saved); room.write = s => { saved = structuredClone(s); };
  room.broadcast = () => {}; room.saved = () => saved;
  return room;
}
const settings = { ...M.DEFAULT_STUDIO, automatic: true, sellerId: 's', showId: OLD, dungeonOn: true, giveawayChests: 0, chestGoals: '',
  chestLoad: JSON.stringify([{ id: 'c1', t: 'Low start on a Momoko', i: { title: 'Venom #2 Momoko', image: 'https://cdn.example.com/v.jpg', price: 20 } }]) };
const base = { settings, revision: 1, effect: null, tokenHash: '', tokenExpires: 0, showEventAt: 0, stats: M.emptyStats(OLD), dungeon: D.emptyDungeon(D.weekKey()), stage: { now: null, next: [] } };
const sale = (id, show, amount, ageMs = 0) => ({ type: 'orders.created', version: 'v2', seller_id: 's', timestamp: new Date(Date.now() - ageMs).toISOString(),
  data: { id, show_id: show, status: 'pending_fulfillment', transaction_type: 'auction', amounts: { subtotal: { amount: String(amount), currency: 'USD' } }, buyer: { username: 'b' } } });
// 1. Following an older show: a fresh sale from today's show moves the studio onto it, and the sale counts.
{
  const room = fakeRoom(base);
  room.receiveWhatnot('e1', sale('o1', LIVE, 12));
  const s = room.saved();
  assert.equal(s.settings.showId, LIVE, 'follows the show the sales are coming from');
  assert.equal(s.stats.gross, 12); assert.ok(s.dungeon.mana >= 12, 'the flask fills');
  // An old retry from another show doesn't pull it back.
  room.receiveWhatnot('e2', sale('o0', OLD, 5, 10 * 60 * 1000));
  assert.equal(room.saved().settings.showId, LIVE);
  // Off-show (marketplace) sales don't move it either.
  room.receiveWhatnot('e3', { ...sale('o9', null, 5), data: { ...sale('o9', null, 5).data, show_id: null } });
  assert.equal(room.saved().settings.showId, LIVE);
}
// 2. Automatic off: nothing is followed.
{
  const room = fakeRoom({ ...base, settings: { ...settings, automatic: false } });
  room.receiveWhatnot('e1', sale('o1', LIVE, 12));
  assert.equal(room.saved().settings.showId, OLD);
}
// 3. A chest opens and stays on screen: the next sale's pop doesn't cover it.
{
  const room = fakeRoom({ ...base, settings: { ...settings, showId: LIVE }, stats: M.emptyStats(LIVE), dungeon: { ...D.emptyDungeon(D.weekKey()), mana: 15 } });
  room.receiveWhatnot('c1', sale('o1', LIVE, 10));
  const chest = room.saved().effect;
  assert.equal(chest.kind, 'chest', 'the chest plays'); assert.equal(chest.item?.title, 'Venom #2 Momoko');
  assert.ok(chest.endsAt - chest.startsAt >= 15000, 'on screen 15 seconds');
  room.receiveWhatnot('c2', sale('o2', LIVE, 3));
  assert.equal(room.saved().effect.id, chest.id, 'a quick sale right after does not wipe the chest');
  assert.equal(room.saved().stats.gross, 13, 'that sale still counts');
}
// 4. SYNC fills the dungeon with the sales it missed -- each order once (store, 2026-11-19: "even when I hit sync").
{
  const room = fakeRoom({ ...base, settings: { ...settings, showId: LIVE, chestLoad: '' }, stats: M.emptyStats(LIVE) });
  room.vendingOnly = () => false; room.beastsOn = () => false;
  const order = (id, amt) => ({ ...sale(id, LIVE, amt).data, created_at: new Date().toISOString() });
  room.receiveWhatnot('w1', sale('o1', LIVE, 10));
  const m1 = room.saved().dungeon.mana;
  const r = room.syncStats([order('o1', 10), order('o2', 25), order('o3', 5)]);
  assert.equal(r.filled, 30, 'only the two the webhook never brought');
  assert.equal(room.saved().dungeon.mana, m1 + 30);
  assert.equal(room.syncStats([order('o1', 10), order('o2', 25), order('o3', 5)]).filled, 0, 'syncing again adds nothing');
  room.resetStats();
  assert.equal(room.syncStats([order('o1', 10), order('o2', 25), order('o3', 5)]).filled, 0, 'a score board reset does not refill the dungeon');
  room.receiveWhatnot('w4', sale('o4', LIVE, 7));
  assert.equal(room.saved().dungeon.mana, m1 + 37, 'a new live sale still fills it');
}
// The remote: picking the live show saves it in one tap.
const ctl = fs.readFileSync('scripts/live-studio-controls.js', 'utf8');
assert.ok(ctl.includes("status.textContent='Following this show -- its sales fill the dungeon.'"));
assert.ok(ctl.includes("api('stats-sync',{}).then(d=>{took(d);if(d.filled>0)status.textContent='Auto sync: +'"), 'the remote syncs by itself once a minute');
console.log('Live Studio follows the live show; chests stay on screen: passed');
// "Boss is too close or too big?" (2026-11-19): the boss's head stays on screen.
{ const fp = fs.readFileSync('scripts/shed-crawl-fp.mjs', 'utf8');
  assert.ok(fp.includes("if (s.kind === 'boss') size = Math.max(2, Math.min(size, floorY - Math.floor((s.lift || 0) * VH / tY) - Math.floor(VH * 0.08)));"));
  assert.ok(fp.includes("s.kind === 'boss' ? (map.layout.arena ? 1.6 : 1.25)"));
  assert.ok(fs.readFileSync('scripts/live-studio-overlay.mjs', 'utf8').includes("import('./shed-crawl-fp.mjs?v=22')") && fs.readFileSync('shed-background.html', 'utf8').includes('shed-background.mjs?v=64')); }
console.log('Boss fits on screen: passed');
// 2026-11-22: "Next chest should tell us what's in it and how much to get to it" / "Get rid of the displayed books off
// the side of the screen" / "Rat walks backwards".
{ const D = await import('../scripts/live-studio-dungeon.mjs');
  const d = { ...D.emptyDungeon(D.weekKey()), mana: 5 };
  assert.deepEqual(D.nextChestInfo({ chestLoad: JSON.stringify([{ id: 'c1', t: 'Low start on a Momoko' }]), giveawayChests: 0 }, d, 100), { k: 0, what: 'Low start on a Momoko', need: 11 });
  assert.equal(D.nextChestInfo({ giveawayChests: 2 }, d, 100).what, 'FREE GIVEAWAY');
  assert.equal(D.nextChestInfo({ giveawayChests: 0 }, { ...d, opened: { 1: [0] } }, 100).need, 42, 'chest 2 sits at 47% of the floor');
  const ov = fs.readFileSync('scripts/live-studio-overlay.mjs', 'utf8'), fp = fs.readFileSync('scripts/shed-crawl-fp.mjs', 'utf8');
  assert.ok(ov.includes("'🧰 NEXT CHEST: '+d.nextChest.what+(d.nextChest.need>0?' · $'+d.nextChest.need+' TO GO':' · OPENS NOW')"));
  assert.equal((ov.match(/settings\.sidePictures!==false/g) || []).length, 2, 'the side pictures stay (2026-11-23)');
  assert.equal(D.DUNGEON_DEFAULTS.sidePictures, true);
  assert.ok(fp.includes('k = ((Math.round(-rel / (Math.PI / 4)) % 8) + 8) % 8'), 'side views the right way round');
  console.log('Next chest, no big side props, rat the right way: passed'); }
// THE DUNGEON PLAN (store, 2026-11-22: "make it easier to see what is set up in each chest and floor, so we can change
// them ... and the thing that says pack forge"): rooms and bosses set ahead, one card a floor in the remote.
{ const D = await import('../scripts/live-studio-dungeon.mjs');
  let d = D.emptyDungeon(D.weekKey());
  d = D.adjustDungeon(d, { room: 'forge', at: 2 }); d = D.adjustDungeon(d, { boss: D.BOSS_PICKS[3].id, at: 3 });
  const plan = D.planOf({ floorRewards: '2: Low start on a Momoko' }, d);
  assert.equal(plan[0].floor, 1); assert.equal(plan[1].room, 'forge'); assert.equal(plan[1].reward, 'Low start on a Momoko'); assert.equal(plan[2].boss.picked, D.BOSS_PICKS[3].id);
  assert.deepEqual(plan[0].chestAt, [16, 47, 80]);
  assert.throws(() => D.adjustDungeon(d, { room: 'nope', at: 2 }), /Invalid room/);
  // A room set ahead: that floor's doors never open.
  let e = { ...d, mana: 0 }; const r = D.addMana(e, 1000, { floorBase: 100 }, Date.now()); let w = r.dungeon;
  for (let i = 0; i < 5 && w.floor < 2; i++) w = D.addMana(w, 1000, { floorBase: 100 }, Date.now()).dungeon;
  if (w.floor === 2) { assert.equal(w.doors, null, 'preset room: no door vote'); assert.equal(w.rooms[2], 'forge'); }
  // Clearing a preset room on the current floor brings the doors back.
  const f1 = D.adjustDungeon(D.adjustDungeon(D.emptyDungeon(D.weekKey()), { room: 'vault' }), { room: '' });
  assert.equal(f1.rooms[1], undefined);
  const ctl = fs.readFileSync('scripts/live-studio-controls.js', 'utf8'), api = fs.readFileSync('scripts/live-studio-api.mjs', 'utf8');
  for (const k of ['<details id="dg-plan" class="dg-plan" open>', '<button type="button" data-click="#dg-plan">🗺 DUNGEON PLAN</button>', "api('dungeon-adjust',{room:s.value,at:Number(s.dataset.planRoom)})", "api('dungeon-adjust',{boss:s.value,at:Number(s.dataset.planBoss)})", 'data-plan-reward=', 'id="dg-plan-edit"']) assert.ok(ctl.includes(k), k);
  assert.ok(api.includes("...(typeof body.room==='string'?{room:body.room.slice(0,20)}:{}),...(Number.isInteger(body.at)?{at:body.at}:{}),"));
  console.log('Dungeon plan: rooms and bosses ahead, chests and rewards per floor: passed'); }
// 2026-11-23: "I don't like that top right corner book. It's always popping up in my way" -- off unless ticked.
{ const sb = fs.readFileSync('scripts/shed-background.mjs', 'utf8'), D = await import('../scripts/live-studio-dungeon.mjs');
  assert.ok(sb.includes("i = boss || settings0.itemCard !== true ? -1 : fp?.nearItem?.() ?? -1,"));
  assert.equal(D.DUNGEON_DEFAULTS.itemCard, false);
  assert.ok(fs.readFileSync('scripts/live-studio-controls.js', 'utf8').includes("box('itemCard','ITEM CARD: the book you walk past pops up top right')"));
  console.log('Item card top right: off: passed'); }
// THE REGULARS (store, 2026-11-24: "More regulars added to our show like we did with Fister ... I need seen but not heard
// ... and another person, pretty hippie, Amos"): quick cameos from the remote, drawn in code, on the clock.
{ const M = await import('../scripts/live-studio-model.mjs'), R = await import('../scripts/regulars.mjs');
  for (const k of ['seen', 'amos']) { assert.ok(M.EFFECTS.includes(k), k); const e = M.makeEffect(k, M.DEFAULT_STUDIO, 0); assert.equal(e.endsAt, R.REGULARS[k].ms); }
  const calls = []; const g = new Proxy({}, { get: (_, k) => typeof k === 'string' && !['font', 'textAlign', 'lineJoin', 'lineWidth', 'strokeStyle', 'fillStyle', 'globalAlpha', 'lineCap'].includes(k) ? (...a) => { calls.push(k); } : undefined, set: () => true });
  for (const t of [0, 0.1, 0.3, 0.45, 0.7, 0.95, 1]) { R.drawSeen(g, 1080, 900, t); R.drawAmos(g, 1080, 900, t); }
  assert.ok(calls.includes('ellipse') && calls.includes('fillText'), 'they draw');
  const src = fs.readFileSync('scripts/regulars.mjs', 'utf8'), ov = fs.readFileSync('scripts/live-studio-overlay.mjs', 'utf8'), ctl = fs.readFileSync('scripts/live-studio-controls.js', 'utf8');
  assert.ok(!/Math\.random/.test(src), 'nothing random');
  assert.ok(src.includes("'SEEN BUT'") && src.includes("'NOT HEARD'") && src.includes("'PEACE, LOVE & COMICS ✌'"));
  assert.ok(ov.includes("if(e.kind==='seen'||e.kind==='amos'){regulars?.play(e.kind,e.startsAt,e.endsAt);return;}") && ov.includes("effect.kind!=='seen' && effect.kind!=='amos'"));
  assert.ok(ctl.includes("['seen','🤫 SEEN BUT NOT HEARD'],['amos','✌ AMOS']"));
  console.log('The regulars: Seen But Not Heard and Amos: passed'); }
// 2026-11-24: "I want seen but not heard as a 3d cameo. No timers. I got buttons when people come in" -- the same button,
// now a 3D guy (three.js, like Mr Fister); the 2D drawing stays as the fallback when WebGL isn't there.
{ const S = await import('../scripts/seen-3d.mjs'), R = await import('../scripts/regulars.mjs');
  assert.equal(S.seenPose(0).up, 0); assert.equal(S.seenPose(1).up, 0); assert.equal(S.seenPose(0.5).up, 1);
  assert.equal(S.seenPose(0.3).look, -1); assert.equal(S.seenPose(0.46).look, 1); assert.equal(S.seenPose(0.75).hand, 1); assert.equal(S.seenPose(0.3).hand, 0);
  const three = await import('../assets/vendor/three-0.160.0.module.min.js'), root = new three.Group(), m = S.buildSeen(root);
  assert.ok(m.head && m.arm && m.pupils.length === 2 && root.children.length > 3, 'built from shapes');
  const calls = []; const g = new Proxy({}, { get: (_, k) => typeof k === 'string' && !['font', 'textAlign', 'lineJoin', 'lineWidth', 'strokeStyle', 'fillStyle', 'globalAlpha', 'lineCap'].includes(k) ? (...a) => { calls.push(k); } : undefined, set: () => true });
  R.drawSeen(g, 1080, 900, 0.5, { figure: false }); assert.ok(calls.includes('fillText') && !calls.includes('ellipse'), 'only the words over the 3D guy');
  const src = fs.readFileSync('scripts/regulars.mjs', 'utf8'), s3 = fs.readFileSync('scripts/seen-3d.mjs', 'utf8');
  assert.ok(src.includes("import('./seen-3d.mjs?v=1')") && src.includes('else drawSeen(g, c.width, c.height, t);'), '3D when it loads, 2D otherwise');
  assert.ok(!/Math\.random|setInterval/.test(s3), 'nothing random, no timers: it plays on the button');
  assert.ok(fs.readFileSync('scripts/live-studio-overlay.mjs', 'utf8').includes("import('./regulars.mjs?v=2')"));
  console.log('Seen But Not Heard in 3D: passed'); }
// 2026-11-24: "covers show in the dashboard but not in OBS" -- the Lunar covers live on our own Worker; through the image
// relay the Worker had to fetch itself, which Cloudflare refuses. They load straight from it now; the relay sends its own.
{ const ov = fs.readFileSync('scripts/live-studio-overlay.mjs', 'utf8'), sb = fs.readFileSync('scripts/shed-background.mjs', 'utf8'), wk = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
  assert.ok(ov.includes('if(w&&new URL(u).origin===w.origin)return u;'));
  assert.ok(sb.includes("return new URL(u).origin === o ? u : o + '/public/studio-img?u=' + encodeURIComponent(u);"));
  assert.ok(wk.includes('if (target.hostname === url.hostname) return Response.redirect(target.href, 302);'));
  console.log('Lunar covers load in OBS: passed'); }
// The live dungeon card (2026-11-24): floor, bar to its goal with the chests on it, the next chest and its $, boss HP.
{ const ctl = fs.readFileSync('scripts/live-studio-controls.js', 'utf8'), css = fs.readFileSync('assets/live-studio.css', 'utf8');
  for (const k of ['<div id="dg-live" class="dg-live" hidden></div>', 'function paintLive(){', "'🧰 NEXT CHEST: <b>'+esc(next.what)+'</b> · '", "<b>BOSS HP $'+hp+' / $'+max+'</b>", "<button type=\"button\" data-click=\"#dg-plan\">🗺 FLOOR PLAN &amp; CHESTS</button>"]) assert.ok(ctl.includes(k), k);
  assert.ok(css.includes('.mana-controls .dg-live{') && css.includes('@media (max-width:640px){'));
  console.log('Live dungeon card: passed'); }
