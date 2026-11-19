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
