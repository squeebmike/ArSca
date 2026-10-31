import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_STUDIO, validateSettings, makeEffect, whatnotEffect, digestToken } from './live-studio-model.mjs';

export class ManaLiveStudio extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS studio (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
  }
  read() {
    const row = this.sql.exec('SELECT value FROM studio WHERE id=1').toArray()[0];
    return row ? JSON.parse(row.value) : { settings:{...DEFAULT_STUDIO}, revision:0, effect:null, tokenHash:'', tokenExpires:0, showEventAt:0 };
  }
  write(state) { this.sql.exec('INSERT OR REPLACE INTO studio VALUES (1, ?)', JSON.stringify(state)); }
  publicState(state = this.read()) {
    return { settings:state.settings, revision:state.revision, effect:state.effect, serverNow:Date.now() };
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
  trigger(kind) {
    const s = this.read();
    s.effect = makeEffect(kind,s.settings);
    this.write(s);
    this.broadcast({type:'effect', effect:s.effect, serverNow:Date.now()});
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
    const effect = whatnotEffect(event,s.settings,now);
    this.ctx.storage.transactionSync(()=>{
      this.sql.exec('INSERT INTO seen VALUES (?,?)',id,now+7*86400000);
      if (effect) {
        if (event.type.startsWith('shows.') && effect.at <= s.showEventAt) return;
        if (event.type.startsWith('shows.')) s.showEventAt=effect.at;
        s.effect=makeEffect(effect.kind,s.settings,now);
        this.write(s);
      }
    });
    if (effect && s.effect?.startsAt === now) this.broadcast({type:'effect',effect:s.effect,serverNow:now});
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
