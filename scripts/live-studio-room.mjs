import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_STUDIO, validateSettings, makeEffect, whatnotEffect, digestToken, applyOrder, advanceStage, emptyStats, publicStats, statsFromOrders, validateStage, eventIsFresh } from './live-studio-model.mjs';
import { WEATHERS, areaOptions, AREA_ICONS, movesFrom, STARTERS, ensureBeasts, addBeastXp, addBeastDrop, adjustBeasts, publicBeasts, beastMoment } from './beasts.mjs';
import { makeSpots, upIndex } from './vending.mjs';
import { cleanFlipItems, flipAt, bookMs, SHOWS, cleanWanted } from './flipbook.mjs';
// The next open slot from i, going dir (+1 or -1) and round; -1 when all are sold.
const openFrom = (items, i, dir) => { const n = items.length; for (let k = 1; k <= n; k++) { const j = (((i + dir * k) % n) + n) % n; if (!items[j].sold) return j; } return -1; };
import { weekKey, ensureWeek, addMana, addTap, adjustDungeon, bossOf, shedFor, showUnlocksCrossed, publicDungeon, WEAPONS, roomById, chestsOpened, chestsToOpen, tapMana, openChest, nextChestLoad, useChestLoad, boxesToOpen, openBox, secretOf, secretToOpen, openVault, merchantPicks, FORKS, DIG_SPOTS, TRIVIA } from './live-studio-dungeon.mjs';
import { chanceWordIn } from './live-studio-model.mjs';
import { bossById } from './live-studio-bosses.mjs';

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

// A chest (or a found item) shows over just walking into a room; a boss or a new floor still wins.
function chestFirst(fx, reached) { return reached && (!fx || fx.kind === 'room' || fx.kind === 'unlock') ? reached : fx || reached || null; }
// 2026-11-18: "one I didn't notice, the other was too quick" -- the next sale's
// pop wiped the chest off screen. A chest, item, boss or floor now plays out;
// sales meanwhile still count (score, flask), they just don't cover it.
const BIG = ['chest', 'found', 'boss', 'floor'];
const holdsScreen = (cur, next, now) => !!cur && BIG.includes(cur.kind) && cur.endsAt > now && !BIG.includes(next.kind);

// Which of the followed show's orders have filled the dungeon already (so a webhook and a SYNC never both count one,
// and resetting the score board doesn't refill it). Started from the orders the score board already holds.
function fedInit(s) {
  const id = s.settings.showId;
  if (s.fed?.showId === id && Array.isArray(s.fed.ids)) return;
  s.fed = { showId: id, ids: s.stats?.showId === id ? Object.keys(s.stats.orders || {}) : [] };
}
function unfed(s) {
  fedInit(s);
  if (s.stats?.showId !== s.settings.showId) return 0;
  const have = new Set(s.fed.ids); let sum = 0;
  for (const [id, o] of Object.entries(s.stats.orders || {})) if (!have.has(id) && !o.cancelled && !o.giveaway && o.amount > 0) { sum += o.amount; s.fed.ids.push(id); }
  if (s.fed.ids.length > 2000) s.fed.ids = s.fed.ids.slice(-2000);
  return Math.round(sum * 100) / 100;
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
    s.beasts = ensureBeasts(s.beasts, weekKey(), s.settings?.beastsSeason !== false);
    return s;
  }
  write(state) { this.sql.exec('INSERT OR REPLACE INTO studio VALUES (1, ?)', JSON.stringify(state)); }
  publicStats(state) {
    return { ...publicStats(state.stats, state.settings), dungeon: publicDungeon(state.dungeon, state.settings, state.stats?.showId === state.settings.showId ? state.stats.gross : 0), beasts: publicBeasts(state.beasts, state.settings, state.beastStarter || ''), vote: state.vote ? { kind: state.vote.kind, question: state.vote.question || '', options: state.vote.options } : null, beastMove: state.beastMove || 0, beastStarter: state.beastStarter || '' };
  }
  publicState(state = this.read()) {
    return { settings:state.settings, revision:state.revision, effect:state.effect, stats:this.publicStats(state), stage:state.stage, pics:state.pics || [], fisterFace:state.fisterFace || '', machine:this.pubMachine(state), flip:state.flip || null, serverNow:Date.now() };
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
    const fx = chestFirst(dungeonEffect(r.events, [], { tapKind: kind, mana: r.amount }), reached) || (wallDown ? { kind: 'unlock', unlockText: 'THE CRACKED WALL CRUMBLES! A SECRET VAULT!' } : null) || (chest ? { kind: 'chest', chestText: chest.text, chestGoal: chest.n + ' ' + chest.kind.toUpperCase() + 'S' } : null) || { kind: 'tap', tapKind: kind, mana: r.amount, floor: s.dungeon.floor };
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
      { const reached = this.openReachedChests(s, now) || this.openReachedBoxes(s, now) || this.openReachedVault(s, now); fx = chestFirst(dungeonEffect(r.events, [], { mana: Math.round(amount * 100) / 100 }), reached); }
    } else if (input.door !== undefined) {
      // Chat's vote: the door the host tapped sets this floor's room.
      s.dungeon = adjustDungeon(s.dungeon, { door: input.door }, now);
      fx = { kind: 'room', floor: s.dungeon.floor, room: s.dungeon.rooms[s.dungeon.floor] };
    } else if (input.boss !== undefined) s.dungeon = adjustDungeon(s.dungeon, { boss: input.boss }, now);
    else if (input.summon) {
      // SUMMON THE BOSS NOW: the flask fills and this floor's boss comes out, as when chat fills it.
      s.dungeon = adjustDungeon(s.dungeon, { summon: true, settings: s.settings }, now);
      const id = bossOf(s.dungeon, s.dungeon.floor);
      fx = dungeonEffect([{ kind: 'floor', floor: s.dungeon.floor, shed: shedFor(s.dungeon.floor), bossCharacter: id, bossName: bossById(id).name }], [], {});
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
    if (!this.beastsOn(s) && ['move', 'starter', 'area', 'weather'].includes(kind)) throw new Error('That vote is Long Box Beasts\' -- the dungeon is on');
    let options;
    if (kind === 'weapon') options = WEAPONS.map(w => ({ id: w.id, label: w.icon + ' ' + w.name }));
    else if (kind === 'next') { options = (s.stage.next || []).slice(0, 3).map((n, i) => ({ id: String(i), label: String(n.title || '').slice(0, 60) })); if (options.length < 2) throw new Error('Vote needs two items in NEXT UP'); }
    else if (kind === 'door') { if (!s.dungeon.doors?.length) throw new Error('Vote: no doors are open right now'); options = s.dungeon.doors.map(id => { const r = roomById(id); return { id, label: r.icon + ' ' + r.name }; }); }
    else if (kind === 'fork') options = FORKS.map(f => ({ id: f.id, label: f.label }));
    // BEASTS: chat picks your beast's attack; every sale fires it.
    else if (kind === 'move') options = movesFrom(s.settings.beastsMoves).map((m, i) => ({ id: String(i), label: '⚔️ ' + m }));
    // BEASTS: chat picks your starter.
    else if (kind === 'starter') options = STARTERS.map(n => ({ id: n, label: '🥚 ' + n }));
    // BEASTS: chat picks the country for the next route.
    // BEASTS: chat calls the weather on this route (it changes which wild beasts are out).
    else if (kind === 'weather') options = ['rain', 'heat', 'snow', 'fog', 'clear'].map(id => ({ id, label: WEATHERS[id][0] + ' ' + WEATHERS[id][1] }));
    else if (kind === 'area') options = areaOptions((s.beasts?.route || 1) + 1).map(id => ({ id, label: AREA_ICONS[id] + ' ' + id.toUpperCase() }));
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
    if (v.kind === 'weather') { const rt = s.beasts?.route || 1; s.beasts = { ...s.beasts, weather: opt.id === 'clear' ? null : { route: rt, kind: opt.id } }; fx = makeEffect('mascot', s.settings, now, { mascotState: 'excited', say: opt.id === 'clear' ? 'CHAT CLEARED THE SKIES ON ROUTE ' + rt + '!' : 'CHAT CALLED IN ' + WEATHERS[opt.id][1] + ' ON ROUTE ' + rt + '! NEW WILD BEASTS ARE OUT!' }); }
    if (v.kind === 'area') { const nx = (s.beasts?.route || 1) + 1; s.beasts = { ...s.beasts, areas: { ...(s.beasts?.areas || {}), [nx]: opt.id } }; fx = makeEffect('mascot', s.settings, now, { mascotState: 'excited', say: 'CHAT PICKED ' + opt.id.toUpperCase() + ' FOR ROUTE ' + nx + '!' }); }
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
      // A chest the store loaded itself: its own words, its own book spinning. Nothing is taken from NEXT UP and
      // nothing is added to the Whatnot show -- the host runs it in Whatnot.
      const load = nextChestLoad(s.settings, s.dungeon);
      if (load) {
        s.dungeon = useChestLoad(s.dungeon, load.id);
        this.chestLoaded = load.t;
        fx = { kind: 'chest', chestText: load.t, chestGoal: c.goal ? 'CHAT HIT ' + c.goal.n + ' ' + c.goal.kind.toUpperCase() + 'S' : 'CHEST ' + (c.k + 1) + ' OF 3', ...(load.i ? { item: load.i } : {}) };
        continue;
      }
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
  takeChest(s) { const it = this.chestItem, gv = this.chestGiveaway, ld = this.chestLoaded; this.chestItem = null; this.chestGiveaway = false; this.chestLoaded = null; return { ...(it ? { chestItem: it, showId: s.settings.showId || '' } : {}), ...(gv ? { chestGiveaway: true } : {}), ...(ld ? { chestLoaded: ld } : {}) }; }
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
    // THE SPOTLIGHT (2026-11-14): NOW PLAYING, big on screen with its facts.
    if (extra.spotlight) { const now = s.stage?.now; if (!now?.title) throw new Error('Put an item in NOW PLAYING first'); extra = { item: { title: now.title, image: now.image, price: now.price }, spot: String(now.detail || '').slice(0, 90) }; }
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
  // SHARE A SCREEN (store, 2026-11-14: "a way to display something from my screen to OBS ... show my FOC screen while we
  // do orders, so people can watch along"): the picture goes straight from the remote's computer to the overlay in OBS
  // (WebRTC, peer to peer). Only the handshake -- two short text blobs -- passes through here; nothing is stored.
  screen(input = {}) {
    const now = Date.now(), lay = v => (['corner', 'half', 'full'].includes(v) ? v : 'corner'), title = v => String(v || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 40).toUpperCase();
    if (input.stop === true) { this.scr = null; this.broadcast({ type: 'screen', screen: null, serverNow: now }); return { stopped: true }; }
    if (typeof input.offer === 'string') {
      if (input.offer.length > 20000 || !input.offer.startsWith('v=0')) throw new Error('That screen share did not start right -- try again');
      this.scrN = (this.scrN || 0) + 1; const id = now.toString(36) + '-' + this.scrN;
      this.scr = { id, answer: '', layout: lay(input.layout), title: title(input.title) };
      this.broadcast({ type: 'screen', screen: { id, offer: input.offer, layout: this.scr.layout, title: this.scr.title }, serverNow: now });
      return { id };
    }
    if (typeof input.poll === 'string') return { answer: this.scr && this.scr.id === input.poll ? this.scr.answer : '' };
    if (this.scr && (input.layout !== undefined || input.title !== undefined)) { if (input.layout !== undefined) this.scr.layout = lay(input.layout); if (input.title !== undefined) this.scr.title = title(input.title); this.broadcast({ type: 'screen-look', layout: this.scr.layout, title: this.scr.title, serverNow: now }); return { layout: this.scr.layout }; }
    throw new Error('No screen is being shared');
  }
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
    const clean = list => { const out = []; for (const x of (Array.isArray(list) ? list : []).slice(0, 120)) { const v = validateStage({ now: null, next: [x] }).next[0]; if (v) out.push({ ...v, sold: !!x.sold, ...(['pre', 'bin'].includes(x.shelf) ? { shelf: x.shelf } : {}), ...(typeof x.badge === 'string' && x.badge.trim() ? { badge: x.badge.replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 20).toUpperCase() } : {}) }); } return out; };
    if (input.load === 'stage') { m.items = clean([s.stage?.now, ...(s.stage?.next || [])].filter(Boolean)); m.kind = 'items'; m.up = 0; }
    if (Array.isArray(input.items)) { m.items = clean(input.items); m.kind = input.kind === 'showcase' ? 'showcase' : 'items'; m.up = 0; if (m.kind === 'showcase' && !input.mode) m.mode = 'lower'; }
    // SPOTS for a break or a surprise set: "75 at $5" or one name a line -- in the machine only, never in inventory.
    if (input.spots && typeof input.spots === 'object') { m.items = clean(makeSpots(input.spots)); if (!m.items.length) throw new Error('How many spots? (or one name a line)'); m.kind = 'spots'; m.up = 0;
      // Each spot's own Whatnot id ("spot-<batch>-<n>"), so its listing's sale marks exactly that spot.
      m.batch = Date.now().toString(36); m.items = m.items.map((it, i) => ({ ...it, ext: 'spot-' + m.batch + '-' + (i + 1) })); }
    // Spots listed on Whatnot (the remote lists them, then says which went in).
    if (input.buyer && Number.isInteger(input.buyer.i) && m.items[input.buyer.i]) { const nm = String(input.buyer.name || '').replace(/^@/, '').replace(/[^\w.\-]/g, '').slice(0, 30); const { buyer, ...rest } = m.items[input.buyer.i]; m.items[input.buyer.i] = nm ? { ...rest, buyer: nm, sold: true } : rest; }
    if (Array.isArray(input.listed)) { const on = new Set(input.listed.map(String)); m.items = m.items.map(it => it.ext && on.has(it.ext) ? { ...it, listed: true } : it); }
    if (['panel', 'full', 'front', 'lower'].includes(input.mode)) m.mode = input.mode;
    if (['', 'comics', 'cards', 'arcane'].includes(input.theme)) m.theme = input.theme;
    if (input.giveEvery !== undefined) { const g = Math.floor(Number(input.giveEvery)); if (!Number.isFinite(g) || g < 0 || g > 100) throw new Error('Change return: every 0 to 100 sold'); m.giveEvery = g; }
    // The slot UP NOW: set it, step to the next/previous open one, or mark it sold and move on.
    if (Number.isInteger(input.up) && m.items[input.up]) m.up = input.up;
    if (input.step === 1 || input.step === -1) m.up = openFrom(m.items, upIndex(m), input.step);
    if (input.soldUp === true) { const u = upIndex(m); if (u >= 0) { m.items[u] = { ...m.items[u], sold: true }; m.up = openFrom(m.items, u, 1); } }
    if (Number.isInteger(input.toggle) && m.items[input.toggle]) m.items[input.toggle] = { ...m.items[input.toggle], sold: !m.items[input.toggle].sold };
    // FLASH SALE (2026-11-14): a few slots at a lower price for a few minutes -- the old price shows crossed out.
    // Same price for everyone watching; it just ends on time (no chance in it).
    const unflash = it => { if (!it.flashUntil && !it.wasPrice) return it; const { wasPrice, flashUntil, ...rest } = it; return { ...rest, price: Number(wasPrice) > 0 ? wasPrice : it.price }; };
    m.items = m.items.map(it => it.flashUntil && Date.now() >= it.flashUntil ? unflash(it) : it);
    if (input.flashEnd === true) m.items = m.items.map(unflash);
    if (input.flash && typeof input.flash === 'object') {
      const f = input.flash, pct = Number(f.pct) || 0, to = Number(f.price) || 0, mins = Math.floor(Number(f.minutes) || 0);
      if (!(pct > 0 && pct < 90) && !(to > 0)) throw new Error('Flash sale: % off (1-89) or a sale price');
      if (mins < 1 || mins > 60) throw new Error('Flash sale: 1 to 60 minutes');
      const want = new Set((Array.isArray(f.slots) ? f.slots : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= m.items.length));
      if (!want.size) throw new Error('Flash sale: which slot numbers?');
      const until = Date.now() + mins * 60000; let hit = 0;
      m.items = m.items.map((it, i) => { if (!want.has(i + 1) || it.sold) return it; const base = unflash(it), was = Number(base.price) || 0; if (!(was > 0)) return it;
        const now = Math.round((to > 0 ? to : was * (1 - pct / 100)) * 100) / 100; if (!(now > 0 && now < was)) return it; hit++; return { ...base, wasPrice: was, price: now, flashUntil: until }; });
      if (!hit) throw new Error('Flash sale: those slots need a price above the sale price');
    }
    if (typeof input.on === 'boolean') m.on = input.on;
    if (typeof input.title === 'string') m.title = input.title.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 30).toUpperCase();
    s.machine = m;
    this.write(s);
    this.broadcast({ type:'state', ...this.publicState(s) });
    return this.publicState(s);
  }
  // THE FOC FLIPBOOK (store, 2026-11-14): this week's books flipping on the overlay -- each cover, the price, the
  // synopsis. The remote sends the books; the page on screen comes from the studio clock (flip.at), so every overlay
  // shows the same one. NEXT / BACK move the clock a book; nothing is random.
  setFlip(input = {}) {
    const s = this.read(), f = { on: false, items: [], secs: 12, mode: 'full', title: '', at: Date.now(), ...(s.flip || {}) }, now = Date.now();
    if (Array.isArray(input.items)) { f.items = cleanFlipItems(input.items); if (!f.items.length) throw new Error('No books with covers to flip through'); if (JSON.stringify(f.items).length > 700000) throw new Error('Flipbook: too many books at once -- pick PRH or Lunar'); f.at = now; }
    // GO TO a book (chat asks about one): it starts now, the rest follow in order.
    if (Number.isInteger(input.jump) && input.jump >= 0 && input.jump < f.items.length) { f.show = 'flip'; let before = 0; for (let k = 0; k < input.jump; k++) before += bookMs(f, f.items[k]); f.at = now - before; }
    if (input.secs !== undefined) { const n = Math.round(Number(input.secs)); if (!(n >= 5 && n <= 60)) throw new Error('Flipbook: 5 to 60 seconds a book'); f.secs = n; f.at = now; }
    if (['full', 'lower'].includes(input.mode)) f.mode = input.mode;
    // THE FOC SHOW: which display (AUTO MIX runs them all in turn), and the order's top 5 for MOST WANTED.
    if (input.show !== undefined) { if (!SHOWS.includes(input.show)) throw new Error('Flipbook: unknown display'); f.show = input.show; }
    if (input.wanted !== undefined) f.wanted = cleanWanted(input.wanted);
    if (typeof input.only === 'boolean') f.only = input.only;
    if (typeof input.title === 'string') f.title = input.title.replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 40).toUpperCase();
    if ((input.step === 1 || input.step === -1) && f.items.length) {
      if (f.show && f.show !== 'flip') { f.show = 'flip'; }
      // BACK / NEXT jump a whole book (books with many covers stay up longer).
      const cur = flipAt(f, now), prev = f.items[(cur.i - 1 + f.items.length) % f.items.length];
      f.at -= input.step === 1 ? cur.per - cur.into : -(cur.into + bookMs(f, prev));
    }
    if (typeof input.on === 'boolean') { if (input.on && !f.on) f.at = now; f.on = input.on && f.items.length > 0; }
    s.flip = f; this.write(s);
    this.broadcast({ type:'state', ...this.publicState(s) });
    return { flip: f };
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
  // 2026-11-19: "Why won't live sales hit the show? Even when I hit sync" -- SYNC rebuilt the score but never
  // put those dollars in the dungeon. Now any order of the show the dungeon hasn't had yet fills it (once each).
  syncStats(orders) {
    const s = this.read(), now = Date.now();
    fedInit(s);
    s.stats = statsFromOrders(orders, s.settings, now);
    const fresh = unfed(s);
    let fx = null;
    if (fresh > 0 && this.beastsOn(s)) { const m = addBeastXp(s.beasts, fresh, s.settings, now); s.beasts = m.beasts; fx = this.beastEffect(m.events, s); }
    else if (fresh > 0 && !this.vendingOnly(s)) {
      const m = addMana(s.dungeon, fresh, s.settings, now);
      s.dungeon = m.dungeon;
      const reached = this.openReachedChests(s, now) || this.openReachedBoxes(s, now) || this.openReachedVault(s, now);
      fx = chestFirst(dungeonEffect(m.events, [], { mana: fresh }), reached);
    }
    if (fx && !holdsScreen(s.effect, fx, now)) s.effect = makeEffect(fx.kind, s.settings, now, fx);
    this.write(s);
    this.broadcast({ type:'state', ...this.publicState(s) });
    return { ...this.publicState(s), ...this.takeChest(s), filled: fresh };
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
    // 2026-11-18: sales went in but the dungeon didn't move -- it was still
    // following an older show (Whatnot's "show started" never came, and the
    // picked show wasn't saved). Whatnot runs one live show at a time, so a
    // FRESH sale from another of our shows means that show is the live one now.
    if (!followed && isOrder && s.settings.automatic && event.version === 'v2' && (!s.settings.sellerId || event.seller_id === s.settings.sellerId)
      && /^[0-9a-f-]{36}$/i.test(String(event.data?.show_id || '')) && event.data.show_id !== s.settings.showId && eventIsFresh(event, { ...s.settings, showId: event.data.show_id }, now)) {
      s.settings = { ...s.settings, showId: String(event.data.show_id) };
      s.revision++;
      s.stats = emptyStats(s.settings.showId);
      followed = true;
    }
    // Orders count toward the show's totals even when they arrive late (a
    // webhook retry); only a fresh one plays an effect.
    const ours = s.settings.automatic && event?.version === 'v2' && event.data?.show_id === s.settings.showId && (!s.settings.sellerId || event.seller_id === s.settings.sellerId);
    let effect = null, statsChanged = false, stageMoved = false;
    if (isOrder && ours) {
      const grossBefore = s.stats.showId === s.settings.showId ? s.stats.gross : 0;
      fedInit(s);
      const r = applyOrder(s.stats, event.data, s.settings, now);
      statsChanged = r.stats !== s.stats;
      s.stats = r.stats;
      // A new sale's dollars fill the dungeon's flask (cancellations don't
      // drain it: a floor reached stays reached). Each order fills it once.
      const fresh = unfed(s);
      let dfx = null;
      if (fresh > 0 && this.beastsOn(s)) {
        // Beasts: the sale walks the route (the dungeon stays where it is).
        const m = addBeastXp(s.beasts, fresh, s.settings, now);
        s.beasts = m.beasts;
        if (r.effect) dfx = this.beastEffect(m.events, s);
      } else if (fresh > 0 && !this.vendingOnly(s)) {
        const m = addMana(s.dungeon, fresh, s.settings, now);
        s.dungeon = m.dungeon;
        const unlocks = s.settings.dungeonOn ? showUnlocksCrossed(grossBefore, s.stats.gross, s.settings) : [];
        // A chest the crawl just reached opens (its item comes up next).
        const chestFx = this.openReachedChests(s, now) || this.openReachedBoxes(s, now) || this.openReachedVault(s, now); if (chestFx?.item) { stageMoved = true; statsChanged = true; }
        if (r.effect) dfx = chestFirst(dungeonEffect(m.events, unlocks, r.effect), chestFx);
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
        if (holdsScreen(s.effect, effect, now)) { this.write(s); statsChanged = true; return; }
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
    if (a?.authenticated) {
      // The one thing an overlay may send: its half of a screen-share handshake.
      let m = null; if (typeof message === 'string' && message.length <= 20000) { try { m = JSON.parse(message); } catch {} }
      if (m && m.type === 'screen-answer' && this.scr && m.id === this.scr.id && !this.scr.answer && typeof m.sdp === 'string' && m.sdp.startsWith('v=0') && m.sdp.length <= 20000) { this.scr.answer = m.sdp; return; }
      if (m && m.type === 'screen-answer') return;
      ws.close(1008,'Read-only overlay'); return; }
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
