import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_STUDIO, validateSettings, makeEffect, whatnotEffect, digestToken, applyOrder, advanceStage, emptyStats, publicStats, statsFromOrders, validateStage, eventIsFresh } from './live-studio-model.mjs';
import { ensureWeek, addMana, addTap, adjustDungeon, showUnlocksCrossed, publicDungeon, WEAPONS, roomById, chestsOpened, chestsToOpen, openChest, FORKS, DIG_SPOTS, TRIVIA } from './live-studio-dungeon.mjs';
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
    return s;
  }
  write(state) { this.sql.exec('INSERT OR REPLACE INTO studio VALUES (1, ?)', JSON.stringify(state)); }
  publicStats(state) {
    return { ...publicStats(state.stats, state.settings), dungeon: publicDungeon(state.dungeon, state.settings, state.stats?.showId === state.settings.showId ? state.stats.gross : 0), vote: state.vote ? { kind: state.vote.kind, question: state.vote.question || '', options: state.vote.options } : null };
  }
  publicState(state = this.read()) {
    return { settings:state.settings, revision:state.revision, effect:state.effect, stats:this.publicStats(state), stage:state.stage, pics:state.pics || [], serverNow:Date.now() };
  }
  // A follow / share / bookmark the host tapped in fills the flask.
  dungeonTap(kind) {
    const s = this.read(), now = Date.now();
    const r = addTap(s.dungeon, kind, s.settings, now);
    // A treasure chest this tap opened (chat's goal reached).
    const chest = chestsOpened(s.dungeon, r.dungeon, s.settings).pop();
    s.dungeon = r.dungeon;
    const reached = this.openReachedChests(s, now);
    const fx = dungeonEffect(r.events, [], { tapKind: kind, mana: r.amount }) || reached || (chest ? { kind: 'chest', chestText: chest.text, chestGoal: chest.n + ' ' + chest.kind.toUpperCase() + 'S' } : null) || { kind: 'tap', tapKind: kind, mana: r.amount, floor: s.dungeon.floor };
    s.effect = makeEffect(fx.kind, s.settings, now, fx);
    this.write(s);
    this.broadcast({ type:'effect', effect:s.effect, stats:this.publicStats(s), stage:s.stage, serverNow:now });
    return { ...this.publicState(s), ...this.takeChest(s) };
  }
  // Manual: + $ mana (a sale off Whatnot), set the floor, or start the week over.
  dungeonAdjust(input = {}) {
    const s = this.read(), now = Date.now();
    let fx = null;
    if (input.mana !== undefined) {
      const amount = Number(input.mana);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error('Invalid mana');
      const r = addMana(s.dungeon, amount, s.settings, now);
      s.dungeon = r.dungeon;
      fx = dungeonEffect(r.events, [], { mana: Math.round(amount * 100) / 100 }) || this.openReachedChests(s, now);
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
    let options;
    if (kind === 'weapon') options = WEAPONS.map(w => ({ id: w.id, label: w.icon + ' ' + w.name }));
    else if (kind === 'next') { options = (s.stage.next || []).slice(0, 3).map((n, i) => ({ id: String(i), label: String(n.title || '').slice(0, 60) })); if (options.length < 2) throw new Error('Vote needs two items in NEXT UP'); }
    else if (kind === 'door') { if (!s.dungeon.doors?.length) throw new Error('Vote: no doors are open right now'); options = s.dungeon.doors.map(id => { const r = roomById(id); return { id, label: r.icon + ' ' + r.name }; }); }
    else if (kind === 'fork') options = FORKS.map(f => ({ id: f.id, label: f.label }));
    // FOUND IT!: each spot holds one of the next lineup items.
    else if (kind === 'dig') { const next = s.stage.next || []; if (next.length < 2) throw new Error('Vote needs two items in NEXT UP'); options = DIG_SPOTS.slice(0, Math.min(3, next.length)).map((label, i) => ({ id: String(i), label })); }
    else throw new Error('Invalid vote');
    s.vote = { kind, options, at: now };
    this.write(s);
    this.broadcast({ type:'stats', stats:this.publicStats(s), serverNow:now });
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
    if (v.kind === 'trivia') { const r = addMana(s.dungeon, Number(s.settings.triviaMana) || 0, s.settings, now); s.dungeon = r.dungeon; const name = String(who || '').replace(/^@/, '').replace(/[^\w.\-]/g, '').slice(0, 30); fx = makeEffect('trivia', s.settings, now, { answer: v.answer, who: name, mana: Number(s.settings.triviaMana) || 0 }); }
    s.vote = null;
    s.effect = fx || makeEffect('mascot', s.settings, now, { mascotState: 'happy', say: 'CHAT PICKED: ' + opt.label.replace(/^\S+\s/, '') });
    this.write(s);
    this.broadcast({ type:'effect', effect:s.effect, stats:this.publicStats(s), stage:s.stage, serverNow:now });
    return this.publicState(s);
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
      const next = [...(s.stage.next || [])];
      let best = -1; next.forEach((n, i) => { if (best < 0 || (Number(n.price) || 0) > (Number(next[best].price) || 0)) best = i; });
      const [item] = best >= 0 ? next.splice(best, 1) : [];
      // It runs now (store, 2026-11-11: "run that item automatically after it's
      // revealed"): NOW PLAYING, and what was playing goes back to the front of NEXT UP.
      if (item) { s.stage = { now: item, next: s.stage.now ? [s.stage.now, ...next] : next }; this.chestItem = item; }
      // Nothing in it (no item in NEXT UP, no goal's reward): it opens quietly.
      if (!item && !c.goal) continue;
      fx = { kind: 'chest', chestText: c.goal?.text || '$1 START!', chestGoal: c.goal ? 'CHAT HIT ' + c.goal.n + ' ' + c.goal.kind.toUpperCase() + 'S' : 'CHEST ' + (c.k + 1) + ' OF 3', ...(item ? { item } : {}) };
    }
    return fx;
  }
  // The chest item that just opened (once), for the Worker to add to the Whatnot show.
  takeChest(s) { const it = this.chestItem; this.chestItem = null; return it ? { chestItem: it, showId: s.settings.showId || '' } : {}; }
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
  setPics(list) {
    const s = this.read();
    s.pics = validateStage({ now: null, next: (Array.isArray(list) ? list : []).slice(0, 24) }).next.filter(x => x.image).map(x => ({ title: x.title, image: x.image, ...(x.kind ? { kind: x.kind } : {}) }));
    this.write(s);
    this.broadcast({ type:'state', ...this.publicState(s) });
    return this.publicState(s);
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
      if (s.stats.gross > grossBefore) {
        const m = addMana(s.dungeon, Math.round((s.stats.gross - grossBefore) * 100) / 100, s.settings, now);
        s.dungeon = m.dungeon;
        const unlocks = s.settings.dungeonOn ? showUnlocksCrossed(grossBefore, s.stats.gross, s.settings) : [];
        // A chest the crawl just reached opens (its item comes up next).
        const chestFx = this.openReachedChests(s, now); if (chestFx?.item) { stageMoved = true; statsChanged = true; }
        if (r.effect) dfx = dungeonEffect(m.events, unlocks, r.effect) || chestFx;
      }
      if (r.effect && eventIsFresh(event, s.settings, now)) effect = dfx || r.effect;
      // A fresh auction sale moves NOW PLAYING to the next item.
      const moved = effect && r.effect.kind !== 'winner' ? advanceStage(s.stage, event.data, s.settings) : null;
      if (moved) { s.stage = moved; statsChanged = true; stageMoved = true; }
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
    if (emitted) this.broadcast({type:'effect',effect:s.effect,stats:this.publicStats(s),...(stageMoved?{stage:s.stage}:{}),serverNow:now});
    else if (statsChanged) this.broadcast({type:'stats',stats:this.publicStats(s),serverNow:now});
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
