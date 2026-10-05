import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store report: after a buy went through (items added to inventory, customer
// paid) the buy tray still had those items in it. Accepting saves the tray
// and closes it right away; the save's POST and index upsert landed AFTER the
// close and re-listed the finished tray, items and all, for every device.
const d = fs.readFileSync('dashboard.html', 'utf8');
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const cut = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, 'missing ' + from); return src.slice(a, b); };

// Worker side: a closed tray record can't be overwritten and can't be re-listed.
const isClosedSrc = cut(w, 'async function buyTrayIsClosed(', '\nfunction safeStoreKey(');
const safeKeySrc = cut(w, 'function safeStoreKey(', '\n}\n') + '\n}\n';
const kv = new Map();
const env = { LBA_KV: { get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); } } };
const wctx = { JSON, String };
vm.createContext(wctx);
vm.runInContext(safeKeySrc + isClosedSrc + ';this.buyTrayIsClosed=buyTrayIsClosed;this.safeStoreKey=safeStoreKey;', wctx);
const store = 's1', key = id => `lba:${wctx.safeStoreKey(store)}:buy_tray_${id}`;
let index = [];
// Mirrors the two Worker routes the client uses.
async function workerPost(path, body){
  if(path === '/kv/buy-trays-index/upsert'){
    if(await wctx.buyTrayIsClosed(env, store, body.entry.id)) index = index.filter(e => e.id !== body.entry.id);
    else { index = index.filter(e => e.id !== body.entry.id); index.push(body.entry); }
    return { ok:true, index };
  }
  if(path === '/kv/buy-trays-index/remove'){ index = index.filter(e => e.id !== body.id); return { ok:true, index }; }
  const k = path.replace('/kv/', '');
  if(k.startsWith('buy_tray_') && await wctx.buyTrayIsClosed(env, store, k.slice(9)) && body.status !== 'closed') return { ok:true, closed:true };
  kv.set(`lba:${wctx.safeStoreKey(store)}:${k}`, JSON.stringify(body));
  return { ok:true };
}
assert.match(w, /if \(await buyTrayIsClosed\(env, storeId, entry\.id\)\) index = index\.filter/, 'the index upsert route drops a closed tray');
assert.match(w, /if \(key\.startsWith\('buy_tray_'\) && await buyTrayIsClosed\(env, storeId, key\.slice\('buy_tray_'\.length\)\)\)/, 'the KV route keeps a closed tray closed');

// Client side, with the tray's save delayed past the close.
const clientSrc = cut(d, 'async function syncBuyListToWorker(){', '\n// Merges in items the server has')
  + cut(d, 'async function upsertBuyTrayIndexEntry(tray){', '\n// Switches which open tray')
  + cut(d, 'function removeBuyTrayEverywhere(id){', '\n}\n') + '\n}\n';
const local = new Map();
let trays = [{ buySessionId:'t1', status:'accepted', items:[{ id:'a' }, { id:'b' }] }];
const pending = [];
const ctx = {
  JSON, Date, Number, Object, Array, Promise,
  AbortSignal:{ timeout:() => undefined },
  localStorage:{ getItem:k => local.get(k) ?? null, setItem:(k, v) => local.set(k, String(v)) },
  safeLocalJson:(k, f) => { try { return JSON.parse(local.get(k)) ?? f; } catch(e) { return f; } },
  scopedWorkerPath:p => p,
  ensureActiveBuyTray:() => trays[0],
  getBuyTrays:() => trays, saveBuyTraysLocal:t => { trays = t; },
  renderBuyTraySwitcher:() => {}, knownBuyTrayIndex:[],
  // The first tray save is slow: it lands after everything else.
  storeWorkerFetch:(path, opts) => new Promise(resolve => {
    const run = async () => { const out = await workerPost(path, JSON.parse(opts.body)); resolve({ ok:true, json:async () => out }); };
    if(path === '/kv/buy_tray_t1' && !pending.length && JSON.parse(opts.body).status !== 'closed') pending.push(run); else run();
  }),
};
vm.createContext(ctx);
vm.runInContext(clientSrc + ';this.syncBuyListToWorker=syncBuyListToWorker;this.removeBuyTrayEverywhere=removeBuyTrayEverywhere;this.isBuyTrayClosed=isBuyTrayClosed;', ctx);

const saving = ctx.syncBuyListToWorker();          // accept: tray saved (slow)
ctx.removeBuyTrayEverywhere('t1');                  // payout: tray closed at once
await new Promise(r => setTimeout(r, 20));
pending.shift()();                                  // the slow save lands last
await saving; await new Promise(r => setTimeout(r, 20));

assert.equal(ctx.isBuyTrayClosed('t1'), true);
assert.equal(JSON.parse(kv.get(key('t1'))).status, 'closed', 'the Worker copy stays closed');
assert.deepEqual(JSON.parse(kv.get(key('t1'))).items, [], 'with no items to bring back');
assert.ok(!index.some(e => e.id === 't1'), 'and the finished tray is not re-listed');

// Other devices drop a tray the Worker says is closed, and never auto-join one.
assert.match(d, /if\(remote\.status === 'closed' \|\| isBuyTrayClosed\(tray\.buySessionId\)\) \{/);
assert.match(d, /!\['complete','closed','accepted','rejected'\]\.includes\(e\.status\) && !isBuyTrayClosed\(e\.id\)/);
console.log('Buy tray stays closed checks passed');
