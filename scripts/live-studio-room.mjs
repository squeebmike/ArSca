import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_STUDIO, validateSettings, makeEffect, whatnotEffect, digestToken, applyOrder, advanceStage, emptyStats, publicStats, statsFromOrders, validateStage, eventIsFresh } from './live-studio-model.mjs';
import { ensureWeek, addMana, addTap, adjustDungeon, showUnlocksCrossed, publicDungeon } from './live-studio-dungeon.mjs';

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
    return { ...publicStats(state.stats, state.settings), dungeon: publicDungeon(state.dungeon, state.settings, state.stats?.showId === state.settings.showId ? state.stats.gross : 0) };
  }
  publicState(state = this.read()) {
    return { settings:state.settings, revision:state.revision, effect:state.effect, stats:this.publicStats(state), stage:state.stage, serverNow:Date.now() };
  }
  // A follow / share / bookmark the host tapped in fills the flask.
  dungeonTap(kind) {
    const s = this.read(), now = Date.now();
    const r = addTap(s.dungeon, kind, s.settings, now);
    s.dungeon = r.dungeon;
    const fx = dungeonEffect(r.events, [], { tapKind: kind, mana: r.amount }) || { kind: 'tap', tapKind: kind, mana: r.amount, floor: s.dungeon.floor };
    s.effect = makeEffect(fx.kind, s.settings, now, fx);
    this.write(s);
    this.broadcast({ type:'effect', effect:s.effect, stats:this.publicStats(s), serverNow:now });
    return this.publicState(s);
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
      fx = dungeonEffect(r.events, [], { mana: Math.round(amount * 100) / 100 });
    } else if (input.door !== undefined) {
      // Chat's vote: the door the host tapped sets this floor's room.
      s.dungeon = adjustDungeon(s.dungeon, { door: input.door }, now);
      fx = { kind: 'room', floor: s.dungeon.floor, room: s.dungeon.rooms[s.dungeon.floor] };
    } else s.dungeon = adjustDungeon(s.dungeon, { floor: input.floor, resetWeek: !!input.resetWeek }, now);
    if (fx) s.effect = makeEffect(fx.kind, s.settings, now, fx);
    this.write(s);
    this.broadcast(fx ? { type:'effect', effect:s.effect, stats:this.publicStats(s), serverNow:now } : { type:'stats', stats:this.publicStats(s), serverNow:now });
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
        if (r.effect) dfx = dungeonEffect(m.events, unlocks, r.effect);
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
    return {ok:true};
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
