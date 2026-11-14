import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_STUDIO, validateSettings, makeEffect, whatnotEffect, digestToken, applyOrder, advanceStage, emptyStats, publicStats, statsFromOrders, validateStage, eventIsFresh } from './live-studio-model.mjs';
import { movesFrom, STARTERS, ensureBeasts, addBeastXp, addBeastDrop, adjustBeasts, publicBeasts, beastMoment } from './beasts.mjs';
import { makeSpots, upIndex } from './vending.mjs';
// The next open slot from i, going dir (+1 or -1) and round; -1 when all are sold.
const openFrom = (items, i, dir) => { const n = items.length; for (let k = 1; k <= n; k++) { const j = (((i + dir * k) % n) + n) % n; if (!items[j].sold) return j; } return -1; };
import { weekKey, ensureWeek, addMana, addTap, adjustDungeon, showUnlocksCrossed, publicDungeon, WEAPONS, roomById, chestsOpened, chestsToOpen, tapMana, openChest, boxesToOpen, openBox, secretOf, secretToOpen, openVault, merchantPicks, FORKS, DIG_SPOTS, TRIVIA } from './live-studio-dungeon.mjs';
import { chanceWordIn } from './live-studio-model.mjs';

// The dungeon's events become the effect to play: a boss beaten beats a
// boss appearing, which beats a show unlock, which beats the sale itself.
function dungeonEffect(events, unlocks, base) {
  const boss = events.filter(e => e.kind === 'boss').pop(), floor = events.filter(e => e.kind === 'floor').pop(), unlock = unlocks[unlocks.length - 1];
  if (boss) return { ...base, kind: 'boss', dungeon: true, ...boss };
  if (floor) return { ...base, kind: 'floor', ...floor };
  if (unlock) return { ...base, kind: 'unlock', unlockText: unlock.text, unlockAt: unlock.n };
  const room = events.filter(e => e.kind === 'room').pop();
  if (room) return { ...base, kind: 'room', ...room };
  return null;
}

export class ManaLiveStudio extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS studio (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
  }
  read() {
    const row = this.sql.exec('SELECT value FROM studio WHERE id=1').toArray()[0];
    const s = row ? JSON.parse(row.value) : { settings:{...DEFAULT_STUDIO}, revision:0, effect:null, tokenHash:'', tokenExpires:0, showEventAt:0 };
    // Settings added later fill in from the defaults.
    s.settings = { ...DEFAULT_STUDIO, ...s.settings };
    s.stats ||= emptyStats(s.settings.showId);
    s.stage ||= { now:null, next:[] };
    // The dungeon runs all week (Wednesday to Wednesday), across shows.
    s.dungeon = ensureWeek(s.dungeon);
    // LONG BOX BEASTS keeps its own track (2026-11-13: "they should be totally separate games").
    s.beasts = ensureBeasts(s.beasts, weekKey());
    return s;
  }
  write(state) { this.sql.exec('INSERT OR REPLACE INTO studio VALUES (1, ?)', JSON.stringify(state)); }
  publicStats(state) {
    return { ...publicStats(state.stats, state.settings), dungeon: publicDungeon(state.dungeon, state.settings, state.stats?.showId === state.settings.showId ? state.stats.gross : 0), beasts: publicBeasts(state.beasts, state.settings, state.beastStarter || ''), vote: state.vote ? { kind: state.vote.kind, question: state.vote.question || '', options: state.vote.options } : null, beastMove: state.beastMove || 0, beastStarter: state.beastStarter || '' };
  }
  publicState(state = this.read()) {
    return { settings:state.settings, revision:state.revision, effect:state.effect, stats:this.publicStats(state), stage:state.stage, pics:state.pics || [], fisterFace:state.fisterFace || '', machine:this.pubMachine(state), serverNow:Date.now() };
  }
  // Which game is on.
  beastsOn(s) { return s.settings.gameMode === 'beasts'; }
  // VENDING ONLY: no game; sales move nothing but the score and the machine.
  vendingOnly(s) { return s.settings.gameMode === 'vending'; }
  // Beasts' biggest moment in a batch of events: a badge beats the rival stepping up, which beats a catch.
  beastEffect(events, s) { return beastMoment(events, s?.beastStarter || '', s?.settings?.beastsEvolveReward || ''); }

  // Dollars (a tap, a manual + $, trivia) into Beasts: its own effect, or the fallback.
  beastsIn(s, amount, now, fallback) {
    const m = addBeastXp(s.beasts, amount, s.settings, now); s.beasts = m.beasts;
    const fx = this.beastEffect(m.events, s) || fallback;
    if (fx) s.effect = makeEffect(fx.kind, s.settings, now, fx);
    this.write(s);
    this.broadcast(fx ? { type:'effect', effect:s.effect, stats:this.publicStats(s), serverNow:now } : { type:'stats', stats:this.publicStats(s), serverNow:now });
    return this.publicState(s);
  }
  // A follow / share / bookmark the host tapped in fills the flask.
  dungeonTap(kind) {
    const s = this.read(), now = Date.now();
    if (this.beastsOn(s)) { s.beasts = addBeastDrop(s.beasts, kind, s.settings, now); return this.beastsIn(s, tapMana(s.settings, kind), now, { kind: 'tap', tapKind: kind, mana: tapMana(s.settings, kind) }); } // chat's gift lands a few steps ahead
    if (this.vendingOnly(s)) { s.effect = makeEffect('tap', s.settings, now, { tapKind: kind, mana: 0 }); this.write(s); this.broadcast({ type:'effect', effect:s.effect, stats:this.publicStats(s), serverNow:now }); return this.publicState(s); }
    const r = addTap(s.dungeon, kind, s.settings, now);
    // A treasure chest this tap opened (chat's goal reached).
    const chest = chestsOpened(s.dungeon, r.dungeon, s.settings).pop();
    // This tap brought the cracked wall down (a secret vault behind it).
    const wallDown = r.dungeon.floor === s.dungeon.floor && !secretOf(s.dungeon, s.settings)?.broken && !!secretOf(r.dungeon, s.settings)?.broken;
    s.dungeon = r.dungeon;
    const reached = this.openReachedChests(s, now) || this.openReachedBoxes(s, now) || this.openReachedVault(s, now);
    const fx = dungeonEffect(r.events, [], { tapKind: kind, mana: r.amount }) || reached || (wallDown ? { kind: 'unlock', unlockText: 'THE CRACKED WALL CRUMBLES! A SECRET VAULT!' } : null) || (chest ? { kind: 'chest', chestText: chest.text, chestGoal: chest.n + ' ' + chest.kind.toUpperCase() + 'S' } : null) || { kind: 'tap', tapKind: kind, mana: r.amount, floor: s.dungeon.floor };
    s.effect = makeEffect(fx.kind, s.settings, now, fx);
    this.write(s);
    this.broadcast({ type:'effect', effect:s.effect, stats:this.publicStats(s), stage:s.stage, serverNow:now });
    return { ...this.publicState(s), ...this.takeChest(s) };
  }
  // Manual: + $ mana (a sale off Whatnot), set the floor, or start the week over.
  dungeonAdjust(input = {}) {
    const s = this.read(), now = Date.now();
    if (this.vendingOnly(s)) throw new Error('Vending only: no game is on (pick the dungeon or Long Box Beasts first)');
    if (this.beastsOn(s)) {
      if (input.mana !== undefined) { const amount = Number(input.mana); if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error('Invalid amount'); return this.beastsIn(s, amount, now, null); }
      if (input.door !== undefined) throw new Error('Long Box Beasts has no doors -- that is the dungeon');
      s.beasts = adjustBeasts(s.beasts, { route: input.floor, reset: !!input.resetWeek }, weekKey(now), now);
      this.write(s); this.broadcast({ type:'stats', stats:this.publicStats(s), serverNow:now }); return this.publicState(s);
    }
    let fx = null;
    if (input.mana !== undefined) {
      const amount = Number(input.mana);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error('Invalid mana');
      const r = addMana(s.dungeon, amount, s.settings, now);
      s.dungeon = r.dungeon;
      fx = dungeonEffect(r.events, [], { mana: Math.round(amount * 100) / 100 }) || this.openReachedChests(s, now) || this.openReachedBoxes(s, now) || this.openReachedVault(s, now);
    } else if (input.door !== undefined) {
      // Chat's vote: the door the host tapped sets this floor's room.
      s.dungeon = adjustDungeon(s.dungeon, { door: input.door }, now);
      fx = { kind: 'room', floor: s.dungeon.floor, room: s.dungeon.rooms[s.dungeon.floor] };
    } else s.dungeon = adjustDungeon(s.dungeon, { floor: input.floor, resetWeek: !!input.resetWeek }, now);
    if (fx) s.effect = makeEffect(fx.kind, s.settings, now, fx);
    this.write(s);
    this.broadcast(fx ? { type:'effect', effect:s.effect, stats:this.publicStats(s), stage:s.stage, serverNow:now } : { type:'stats', stats:this.publicStats(s), serverNow:now });
    return { ...this.publicState(s), ...this.takeChest(s) };
  }
  // CHAT PICKS (2026-11-11): the overlay shows numbered choices, chat types a
  // number in Whatnot's chat, and the host taps the winner. Doors, the hero's
  // weapon, or which of the next items comes up first. Nothing is drawn.
  openVote(kind) {
    const s = this.read(), now = Date.now();
    if (this.vendingOnly(s) && !['next', 'trivia'].includes(kind)) throw new Error('Vending only: no game is on');
    if (this.beastsOn(s) && ['weapon', 'door', 'fork', 'dig', 'merchant'].includes(kind)) throw new Error('That vote is the dungeon\'s -- Long Box Beasts is on');
    if (!this.beastsOn(s) && ['move', 'starter'].includes(kind)) throw new Error('That vote is Long Box Beasts\' -- the dungeon is on');
    let options;
    if (kind === 'weapon') options = WEAPONS.map(w => ({ id: w.id, label: w.icon + ' ' + w.name }));
    else if (kind === 'next') { options = (s.stage.next || []).slice(0, 3).map((n, i) => ({ id: String(i), label: String(n.title || '').slice(0, 60) })); if (options.length < 2) throw new Error('Vote needs two items in NEXT UP'); }
    else if (kind === 'door') { if (!s.dungeon.doors?.length) throw new Error('Vote: no doors are open right now'); options = s.dungeon.doors.map(id => { const r = roomById(id); return { id, label: r.icon + ' ' + r.name }; }); }
    else if (kind === 'fork') options = FORKS.map(f => ({ id: f.id, label: f.label }));
    // BEASTS: chat picks your beast's attack; every sale fires it.
    else if (kind === 'move') options = movesFrom(s.settings.beastsMoves).map((m, i) => ({ id: String(i), label: '⚔️ ' + m }));
    // BEASTS: chat picks your starter.
    else if (kind === 'starter') options = STARTERS.map(n => ({ id: n, label: '🥚 ' + n }));
    // THE MERCHANT (2026-11-12): two items, what makes each special; chat picks, it runs.
    else if (kind === 'merchant') { const picks = merchantPicks(s.stage.next || []); if (picks.length < 2) throw new Error('The merchant needs two items in NEXT UP'); options = picks.map(p => ({ id: String(p.i), label: p.tag + ': ' + String(p.item.title || '').slice(0, 60), ...(p.item.image ? { image: p.item.image } : {}) })); }
    // FOUND IT!: each spot holds one of the next lineup items.
    else if (kind === 'dig') { const next = s.stage.next || []; if (next.length < 2) throw new Error('Vote needs two items in NEXT UP'); options = DIG_SPOTS.slice(0, Math.min(3, next.length)).map((label, i) => ({ id: String(i), label })); }
    else throw new Error('Invalid vote');
    s.vote = { kind, options, at: now };
    this.write(s);
    this.broadcast({ type:'stats', stats:this.publicStats(s), serverNow:now });
    return this.publicState(s);
  }
  // BEASTS: the host picks the attack straight away (no vote) -- it's used now.
  pickMove(index) {
    const s = this.read(), now = Date.now(), list = movesFrom(s.settings.beastsMoves);
    if (!Number.isInteger(index) || !list[index]) throw new Error('Invalid attack');
    s.beastMove = index;
    s.effect = makeEffect('move', s.settings, now, { move: list[index] });
    this.write(s);
    this.broadcast({ type:'effect', effect:s.effect, stats:this.publicStats(s), serverNow:now });
    return this.publicState(s);
  }
  pickVote(index, who = '') {
    const s = this.read(), now = Date.now(), v = s.vote;
    if (!v) throw new Error('Vote: nothing is open');
    const opt = v.options[index];
    if (!Number.isInteger(index) || !opt) throw new Error('Invalid vote choice');
    if (v.kind === 'weapon') s.dungeon = adjustDungeon(s.dungeon, { weapon: opt.id }, now);
    else if (v.kind === 'door') s.dungeon = adjustDungeon(s.dungeon, { door: index }, now);
    else if (v.kind === 'next') { const next = [...(s.stage.next || [])]; const [item] = next.splice(index, 1); if (item) s.stage = { ...s.stage, next: [item, ...next] }; }
    else if (v.kind === 'fork') s.dungeon = adjustDungeon(s.dungeon, { fork: opt.id }, now);
    let fx = null;
    if (v.kind === 'dig') { const next = [...(s.stage.next || [])]; const [item] = next.splice(index, 1); if (item) { s.stage = { ...s.stage, next: [item, ...next] }; fx = makeEffect('found', s.settings, now, { item, spot: opt.label.replace(/^\S+\s/, '') }); } }
    if (v.kind === 'merchant') { const next = [...(s.stage.next || [])], k = next.findIndex((n, i) => String(i) === opt.id); const [item] = k >= 0 ? next.splice(k, 1) : []; if (item) { s.stage = { now: item, next: s.stage.now ? [s.stage.now, ...next] : next }; this.chestItem = item; fx = makeEffect('found', s.settings, now, { item, spot: 'THE MERCHANT' }); } }
    if (v.kind === 'starter') { s.beastStarter = opt.id; fx = makeEffect('mascot', s.settings, now, { mascotState: 'excited', say: 'CHAT CHOSE ' + opt.id + '! GO, ' + opt.id + ' -- LET\'S SELL SOME COMICS!' }); }
    if (v.kind === 'move') { s.beastMove = index; fx = makeEffect('move', s.settings, now, { move: opt.label.replace(/^\S+\s/, '') }); }
    if (v.kind === 'trivia') { if (this.vendingOnly(s)) {} else if (this.beastsOn(s)) s.beasts = addBeastXp(s.beasts, Number(s.settings.triviaMana) || 0, s.settings, now).beasts; else { const r = addMana(s.dungeon, Number(s.settings.triviaMana) || 0, s.settings, now); s.dungeon = r.dungeon; } const name = String(who || '').replace(/^@/, '').replace(/[^\w.\-]/g, '').slice(0, 30); fx = makeEffect('trivia', s.settings, now, { answer: v.answer, who: name, mana: Number(s.settings.triviaMana) || 0 }); }
    s.vote = null;
    s.effect = fx || makeEffect('mascot', s.settings, now, { mascotState: 'happy', say: 'CHAT PICKED: ' + opt.label.replace(/^\S+\s/, '') });
    this.write(s);
    this.broadcast({ type:'effect', effect:s.effect, stats:this.publicStats(s), stage:s.stage, serverNow:now });
    return { ...this.publicState(s), ...this.takeChest(s) };
  }
  // ByteRider's trivia: the next question in the list (or the host's own);
  // the host taps CORRECT when chat gets it, and everyone's mana goes up.
  askTrivia(input = {}) {
    const s = this.read(), now = Date.now();
    let q = String(input.question || '').trim().slice(0, 160), a = String(input.answer || '').trim().slice(0, 80);
    if (!q) { const i = (s.dungeon.triviaAt || 0) % TRIVIA.length; ({ q, a } = TRIVIA[i]); s.dungeon = { ...s.dungeon, triviaAt: i + 1 }; }
    const word = chanceWordIn(q + ' ' + a); if (word) throw new Error(`"${word}" reads as a game of chance -- Whatnot doesn't allow those.`);
    s.vote = { kind: 'trivia', question: q.toUpperCase(), answer: a.toUpperCase(), options: [{ id: 'correct', label: '✅ CHAT GOT IT' }], at: now };
    this.write(s);
    this.broadcast({ type:'stats', stats:this.publicStats(s), serverNow:now });
    // The answer goes back to the host's dashboard only, never to the overlay.
    return { ...this.publicState(s), triviaAnswer: s.vote.answer };
  }
  // NAME THE FLOOR: a chatter's name for this floor, on screen all week.
  nameFloor(name) {
    const s = this.read(), now = Date.now(), word = chanceWordIn(name);
    if (word) throw new Error(`"${word}" reads as a game of chance -- Whatnot doesn't allow those.`);
    s.dungeon = adjustDungeon(s.dungeon, { name }, now);
    const nm = s.dungeon.names?.[s.dungeon.floor] || '';
    s.effect = makeEffect('mascot', s.settings, now, { mascotState: 'excited', say: nm ? 'FLOOR ' + s.dungeon.floor + ' IS NOW "' + nm + '"!' : 'FLOOR NAME CLEARED' });
    this.write(s);
    this.broadcast({ type:'effect', effect:s.effect, stats:this.publicStats(s), serverNow:now });
    return this.publicState(s);
  }
  // Chests the crawl just reached (their goals met) open: each gives the most
  // valuable item still in NEXT UP, moved to the front -- a $1 start for everyone.
  openReachedChests(s, now) {
    let fx = null;
    for (const c of chestsToOpen(s.dungeon, s.settings)) {
      s.dungeon = openChest(s.dungeon, c.k, now);
      // The first chests are a FREE giveaway for everyone watching (store,
      // 2026-11-12: "place the 1st 2 chests as givys"). No item runs; the host
      // starts a giveaway in the Whatnot app, free to enter.
      if (c.k < (Number(s.settings.giveawayChests ?? 2) || 0)) {
        this.chestGiveaway = true;
        fx = { kind: 'chest', chestText: 'FREE GIVEAWAY!', chestGoal: c.goal ? 'CHAT HIT ' + c.goal.n + ' ' + c.goal.kind.toUpperCase() + 'S' : 'CHEST ' + (c.k + 1) + ' OF 3' };
        continue;
      }
      const next = [...(s.stage.next || [])];
      let best = -1; next.forEach((n, i) => { if (best < 0 || (Number(n.price) || 0) > (Number(next[best].price) || 0)) best = i; });
      const [item] = best >= 0 ? next.splice(best, 1) : [];
      // It runs now (store, 2026-11-11: "run that item automatically after it's
      // revealed"): NOW PLAYING, and what was playing goes back to the front of NEXT UP.
      if (item) { s.stage = { now: item, next: s.stage.now ? [s.stage.now, ...next] : next }; this.chestItem = item; }
      // Nothing in it (no item in NEXT UP, no goal's reward): it opens quietly.
      if (!item && !c.goal) continue;
      fx = { kind: 'chest', chestText: c.goal?.text || 'LOW START!', chestGoal: c.goal ? 'CHAT HIT ' + c.goal.n + ' ' + c.goal.kind.toUpperCase() + 'S' : 'CHEST ' + (c.k + 1) + ' OF 3', ...(item ? { item } : {}) };
    }
    return fx;
  }
  // Locked long boxes the crawl reached once chat's taps unlocked them: each
  // shows the next item in NEXT UP coming out of the box (FOUND IT!).
  openReachedBoxes(s, now) {
    let fx = null;
    for (const b of boxesToOpen(s.dungeon, s.settings)) {
      s.dungeon = openBox(s.dungeon, b.k, now);
      const item = (s.stage.next || [])[0];
      fx = { kind: 'found', spot: 'THE LOCKED LONG BOX', lockbox: b.k + 1, ...(item ? { item } : { chestText: 'UNLOCKED!' }) };
    }
    return fx;
  }
  // The secret vault behind the cracked wall, once it's down and the crawl
  // gets there: the best item in NEXT UP comes out of it and runs.
  openReachedVault(s, now) {
    if (!secretToOpen(s.dungeon, s.settings)) return null;
    s.dungeon = openVault(s.dungeon, now);
    const next = [...(s.stage.next || [])];
    let best = -1; next.forEach((n, i) => { if (best < 0 || (Number(n.price) || 0) > (Number(next[best].price) || 0)) best = i; });
    const [item] = best >= 0 ? next.splice(best, 1) : [];
    if (item) { s.stage = { now: item, next: s.stage.now ? [s.stage.now, ...next] : next }; this.chestItem = item; }
    return { kind: 'found', spot: 'THE SECRET VAULT', ...(item ? { item } : {}) };
  }
  // The chest item that just opened (once), for the Worker to add to the Whatnot show.
  takeChest(s) { const it = this.chestItem, gv = this.chestGiveaway; this.chestItem = null; this.chestGiveaway = false; return { ...(it ? { chestItem: it, showId: s.settings.showId || '' } : {}), ...(gv ? { chestGiveaway: true } : {}) }; }
  closeVote() {
    const s = this.read(); s.vote = null; this.write(s);
    this.broadcast({ type:'stats', stats:this.publicStats(s), serverNow:Date.now() });
    return this.publicState(s);
  }
  snapshot() { return this.publicState(); }
  update(settings, revision) {
    const s = this.read();
    if (revision !== s.revision) return { conflict:true, ...this.publicState(s) };
    s.settings = {...s.settings, ...validateSettings({...s.settings,...settings})};
    s.revision++;
    this.write(s);
    this.broadcast({ type:'state', ...this.publicState(s) });
    return this.publicState(s);
  }
  trigger(kind, extra = {}) {
    const s = this.read();
    s.effect = makeEffect(kind,s.settings,Date.now(),extra);
    this.write(s);
    this.broadcast({type:'effect', effect:s.effect, serverNow:Date.now()});
    return this.publicState(s);
  }
  // The store's in-stock item photos for the shed's walls and the props in
  // front (2026-11-11: "I don't see my items in the shed as we walk by").
  // The host's camera (2026-11-12: "can I move the camera from the dashboard?
  // joystick?"): look around, scout ahead, look back. Not saved -- only passed
  // on to the screens; how far along the floor you are still comes from mana.
  camera(input = {}) {
    const clamp = v => Math.max(-1, Math.min(1, Number(v) || 0)), now = Date.now();
    const cam = { yaw: clamp(input.yaw), pitch: clamp(input.pitch), action: ['scout', 'back'].includes(input.action) ? input.action : '', at: now };
    this.broadcast({ type: 'camera', cam, serverNow: now });
    return { cam };
  }
  // MR FISTER's face (store, 2026-11-14: "use the picture so we get his face to map over"): a small JPEG the remote
  // cropped from his photo, kept in the room (never in the code), mapped onto his 3D head. '' clears it.
  setFisterFace(face) {
    const f = String(face || '');
    if (f && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(f) || f.length > 40000)) throw new Error('Face: a small JPEG only');
    const s = this.read(); s.fisterFace = f; this.write(s);
    this.broadcast({ type:'state', ...this.publicState(s) });
    return this.publicState(s);
  }
  setPics(list) {
    const s = this.read();
    s.pics = validateStage({ now: null, next: (Array.isArray(list) ? list : []).slice(0, 24) }).next.filter(x => x.image).map(x => ({ title: x.title, image: x.image, ...(x.kind ? { kind: x.kind } : {}), ...(x.tag ? { tag: x.tag } : {}) }));
    this.write(s);
    this.broadcast({ type:'state', ...this.publicState(s) });
    return this.publicState(s);
  }
  // THE VENDING MACHINE (store, 2026-11-13: "a vending machine with the items
  // we have for sale scrolling in the back, or when we do breaks or surprise
  // sets -- it shows what's sold out and what's still available"): its items
  // (loaded from NOW PLAYING + NEXT UP, or sent in), each sold out or not; on or off.
  setMachine(input = {}) {
    const s = this.read(), m = { on: false, items: [], ...(s.machine || {}) };
    const clean = list => { const out = []; for (const x of (Array.isArray(list) ? list : []).slice(0, 120)) { const v = validateStage({ now: null, next: [x] }).next[0]; if (v) out.push({ ...v, sold: !!x.sold }); } return out; };
    if (input.load === 'stage') { m.items = clean([s.stage?.now, ...(s.stage?.next || [])].filter(Boolean)); m.kind = 'items'; m.up = 0; }
    if (Array.isArray(input.items)) { m.items = clean(input.items); m.kind = 'items'; m.up = 0; }
    // SPOTS for a break or a surprise set: "75 at $5" or one name a line -- in the machine only, never in inventory.
    if (input.spots && typeof input.spots === 'object') { m.items = clean(makeSpots(input.spots)); if (!m.items.length) throw new Error('How many spots? (or one name a line)'); m.kind = 'spots'; m.up = 0;
      // Each spot's own Whatnot id ("spot-<batch>-<n>"), so its listing's sale marks exactly that spot.
      m.batch = Date.now().toString(36); m.items = m.items.map((it, i) => ({ ...it, ext: 'spot-' + m.batch + '-' + (i + 1) })); }
    // Spots listed on Whatnot (the remote lists them, then says which went in).
    if (input.buyer && Number.isInteger(input.buyer.i) && m.items[input.buyer.i]) { const nm = String(input.buyer.name || '').replace(/^@/, '').replace(/[^\w.\-]/g, '').slice(0, 30); const { buyer, ...rest } = m.items[input.buyer.i]; m.items[input.buyer.i] = nm ? { ...rest, buyer: nm, sold: true } : rest; }
    if (Array.isArray(input.listed)) { const on = new Set(input.listed.map(String)); m.items = m.items.map(it => it.ext && on.has(it.ext) ? { ...it, listed: true } : it); }
    if (['panel', 'full', 'front'].includes(input.mode)) m.mode = input.mode;
    // The slot UP NOW: set it, step to the next/previous open one, or mark it sold and move on.
    if (Number.isInteger(input.up) && m.items[input.up]) m.up = input.up;
    if (input.step === 1 || input.step === -1) m.up = openFrom(m.items, upIndex(m), input.step);
    if (input.soldUp === true) { const u = upIndex(m); if (u >= 0) { m.items[u] = { ...m.items[u], sold: true }; m.up = openFrom(m.items, u, 1); } }
    if (Number.isInteger(input.toggle) && m.items[input.toggle]) m.items[input.toggle] = { ...m.items[input.toggle], sold: !m.items[input.toggle].sold };
    if (typeof input.on === 'boolean') m.on = input.on;
    if (typeof input.title === 'string') m.title = input.title.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 30).toUpperCase();
    s.machine = m;
    this.write(s);
    this.broadcast({ type:'state', ...this.publicState(s) });
    return this.publicState(s);
  }
  // A sale marks its item sold out in the machine (by our item id, or the item that was NOW PLAYING).
  // THE BREAK BOARD (2026-11-13): who has which spot -- only with SHOW BUYER NAMES on (off by default); otherwise no names leave the room.
  pubMachine(s) { const m = s.machine || { on:false, items:[] }; return s.settings.showBuyerNames ? m : { ...m, items: (m.items || []).map(({ buyer, ...it }) => it) }; }
  machineSold(s, order, wasNow) {
    if (!s.machine?.items?.length) return false;
    const who = s.settings.showBuyerNames ? String(order?.buyer?.username || '').replace(/[^\w.\-]/g, '').slice(0, 30) : '', tag = it => ({ ...it, sold: true, ...(who ? { buyer: who } : {}) });
    // Spots (a break, a surprise set) have no item ids: a sale while the machine is up takes the spot UP NOW.
    if (s.machine.kind === 'spots') {
      // Listed on Whatnot: the sale names its spot.
      const exts = new Set((order?.items || []).flatMap(it => [it.product_external_id, it.variant_external_id]).filter(Boolean).map(String));
      const hitAt = s.machine.items.findIndex(it => !it.sold && it.ext && exts.has(it.ext));
      if (hitAt >= 0) { s.machine.items[hitAt] = tag(s.machine.items[hitAt]); if (upIndex(s.machine) < 0 || s.machine.up === hitAt) s.machine.up = openFrom(s.machine.items, hitAt, 1); return true; }
      if (!s.machine.on) return false; const u = upIndex(s.machine); if (u < 0) return false; s.machine.items[u] = tag(s.machine.items[u]); s.machine.up = openFrom(s.machine.items, u, 1); return true; }
    const ids = new Set((order?.items || []).flatMap(it => [it.product_external_id, it.variant_external_id]).filter(Boolean).map(String));
    let changed = false;
    s.machine.items = s.machine.items.map(it => { const hit = !it.sold && ((it.id && ids.has(it.id)) || (wasNow && ((wasNow.id && it.id === wasNow.id) || (!wasNow.id && it.title === wasNow.title)))); if (hit) changed = true; return hit ? tag(it) : it; });
    return changed;
  }
  // Now playing / next up, from the dashboard.
  setStage(input) {
    const s = this.read();
    s.stage = validateStage(input);
    this.write(s);
    this.broadcast({ type:'state', ...this.publicState(s) });
    return this.publicState(s);
  }
  resetStats() {
    const s = this.read();
    s.stats = emptyStats(s.settings.showId);
    this.write(s);
    this.broadcast({ type:'state', ...this.publicState(s) });
    return this.publicState(s);
  }
  // Totals rebuilt from Whatnot's order list for the selected show.
  syncStats(orders) {
    const s = this.read();
    s.stats = statsFromOrders(orders, s.settings);
    this.write(s);
    this.broadcast({ type:'state', ...this.publicState(s) });
    return this.publicState(s);
  }
  async rotateOverlay() {
    const token = crypto.randomUUID() + crypto.randomUUID();
    const hash = await digestToken(token);
    const s = this.read();
    s.tokenHash = hash;
    s.tokenExpires = Date.now() + 12 * 60 * 60 * 1000;
    this.write(s);
    for (const ws of this.ctx.getWebSockets()) ws.close(1008,'Overlay link replaced');
    return { token, expiresAt:s.tokenExpires };
  }
  revokeOverlay() {
    const s=this.read(); s.tokenHash=''; s.tokenExpires=0; this.write(s);
    for (const ws of this.ctx.getWebSockets()) ws.close(1008,'Overlay link revoked');
    return {ok:true};
  }
  receiveWhatnot(id, event) {
    const now = Date.now();
    this.sql.exec('DELETE FROM seen WHERE expires < ?', now);
    if (this.sql.exec('SELECT id FROM seen WHERE id=?',id).toArray().length) return {duplicate:true};
    const s = this.read();
    // Store, 2026-11-11: "do 1" -- the dungeon runs itself. When Whatnot says
    // one of our shows went live, the studio follows that show (its sales,
    // the flask, the boss) without anyone tapping USE LIVE first.
    let followed = false;
    if (event?.type === 'shows.started' && s.settings.automatic && event.version === 'v2' && (!s.settings.sellerId || event.seller_id === s.settings.sellerId)
      && /^[0-9a-f-]{36}$/i.test(String(event.data?.show_id || '')) && event.data.show_id !== s.settings.showId) {
      s.settings = { ...s.settings, showId: String(event.data.show_id) };
      s.revision++;
      s.stats = emptyStats(s.settings.showId);
      followed = true;
    }
    const isOrder = /^orders\./.test(String(event?.type || ''));
    // Orders count toward the show's totals even when they arrive late (a
    // webhook retry); only a fresh one plays an effect.
    const ours = s.settings.automatic && event?.version === 'v2' && event.data?.show_id === s.settings.showId && (!s.settings.sellerId || event.seller_id === s.settings.sellerId);
    let effect = null, statsChanged = false, stageMoved = false;
    if (isOrder && ours) {
      const grossBefore = s.stats.showId === s.settings.showId ? s.stats.gross : 0;
      const r = applyOrder(s.stats, event.data, s.settings, now);
      statsChanged = r.stats !== s.stats;
      s.stats = r.stats;
      // A new sale's dollars fill the dungeon's flask (cancellations don't
      // drain it: a floor reached stays reached).
      let dfx = null;
      if (s.stats.gross > grossBefore && this.beastsOn(s)) {
        // Beasts: the sale walks the route (the dungeon stays where it is).
        const m = addBeastXp(s.beasts, Math.round((s.stats.gross - grossBefore) * 100) / 100, s.settings, now);
        s.beasts = m.beasts;
        if (r.effect) dfx = this.beastEffect(m.events, s);
      } else if (s.stats.gross > grossBefore && !this.vendingOnly(s)) {
        const m = addMana(s.dungeon, Math.round((s.stats.gross - grossBefore) * 100) / 100, s.settings, now);
        s.dungeon = m.dungeon;
        const unlocks = s.settings.dungeonOn ? showUnlocksCrossed(grossBefore, s.stats.gross, s.settings) : [];
        // A chest the crawl just reached opens (its item comes up next).
        const chestFx = this.openReachedChests(s, now) || this.openReachedBoxes(s, now) || this.openReachedVault(s, now); if (chestFx?.item) { stageMoved = true; statsChanged = true; }
        if (r.effect) dfx = dungeonEffect(m.events, unlocks, r.effect) || chestFx;
      }
      if (r.effect && eventIsFresh(event, s.settings, now)) effect = dfx || r.effect;
      // A fresh auction sale moves NOW PLAYING to the next item.
      const wasNow = s.stage?.now || null;
      const moved = effect && r.effect.kind !== 'winner' ? advanceStage(s.stage, event.data, s.settings) : null;
      if (moved) { s.stage = moved; statsChanged = true; stageMoved = true; }
      // The vending machine: what just sold is SOLD OUT.
      if (r.effect && r.effect.kind !== 'winner' && this.machineSold(s, event.data, moved ? wasNow : null)) { statsChanged = true; stageMoved = true; }
    } else if (!isOrder) effect = whatnotEffect(event,s.settings,now);
    let emitted=false;
    this.ctx.storage.transactionSync(()=>{
      this.sql.exec('INSERT INTO seen VALUES (?,?)',id,now+7*86400000);
      if (effect) {
        if (event.type.startsWith('shows.') && effect.at <= s.showEventAt) { if (statsChanged) this.write(s); return; }
        if (event.type.startsWith('shows.')) s.showEventAt=effect.at;
        s.effect=makeEffect(effect.kind,s.settings,now,effect);
        emitted=true;
      }
      if (emitted || statsChanged || followed) this.write(s);
    });
    if (followed) this.broadcast({ type:'state', ...this.publicState(s) });
    if (emitted) this.broadcast({type:'effect',effect:s.effect,stats:this.publicStats(s),...(stageMoved?{stage:s.stage,machine:this.pubMachine(s)}:{}),serverNow:now});
    else if (statsChanged) this.broadcast({type:'stats',stats:this.publicStats(s),...(stageMoved?{stage:s.stage,machine:this.pubMachine(s)}:{}),serverNow:now});
    return {ok:true, ...this.takeChest(s)};
  }
  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required',{status:426});
    if (this.ctx.getWebSockets().length >= 16) return new Response('Too many overlay connections',{status:429});
    const [client,server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({authenticated:false, expires:Date.now()+5000});
    await this.ctx.storage.setAlarm(Date.now()+5000);
    return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(ws,message) {
    const a=ws.deserializeAttachment();
    if (a?.authenticated) { ws.close(1008,'Read-only overlay'); return; }
    if (typeof message !== 'string' || message.length > 200 || a.expires < Date.now()) {ws.close(1008,'Invalid authentication');return;}
    let token; try { token=JSON.parse(message).token; } catch { ws.close(1008,'Invalid authentication');return; }
    if (typeof token !== 'string' || token.length !== 72) {ws.close(1008,'Invalid authentication');return;}
    const hash=await digestToken(token), s=this.read();
    if (!s.tokenHash || hash !== s.tokenHash || s.tokenExpires <= Date.now()) {ws.close(1008,'Expired or revoked link');return;}
    ws.serializeAttachment({authenticated:true,expires:s.tokenExpires});
    ws.send(JSON.stringify({type:'snapshot',...this.publicState(s)}));
  }
  broadcast(message) {
    for (const ws of this.ctx.getWebSockets()) {
      const a=ws.deserializeAttachment();
      if (!a?.authenticated || a.expires<=Date.now()) continue;
      try { ws.send(JSON.stringify(message)); } catch { ws.close(1011,'Reconnect'); }
    }
  }
  async alarm() {
    let next=Infinity;
    for (const ws of this.ctx.getWebSockets()) {
      const a=ws.deserializeAttachment();
      if (!a || a.expires <= Date.now()) ws.close(1008,'Session expired');
      else next=Math.min(next,a.expires);
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }
  webSocketClose(ws,code) {ws.close(code);}
  webSocketError(ws) {ws.close(1011,'Reconnect');}
}
