import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// Store report: a show started on one device (and its cash bag) could not
// be seen or joined by anyone else. It was a Sep 6 show still open on that
// device a month later: the shared show list expires after 7 days on the
// Worker, nothing re-shared the open show, and the device silently kept its
// local copy when the Worker no longer had it. A rejected publish also
// looked like success and was never retried.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const slice = (from, to) => { const a = dashboard.indexOf(from); const b = dashboard.indexOf(to, a); assert.ok(a >= 0 && b > a, 'missing ' + from); return dashboard.slice(a, b); };
const code = slice('function getShowMode(){', 'function renderShowSessionSwitcher(){') + slice('function renderShowStaleWarning(show){', 'async function startShowMode(){');

function makeWorld() {
  const kv = new Map();
  const posts = [];
  const queued = [];
  let failPosts = false;
  const store = new Map();
  const elements = {};
  const statusEl = { closest: () => ({ insertAdjacentElement: (_, el) => { elements[el.id] = el; } }) };
  const ctx = {
    console, JSON, Date, Math, Number, String, Array, Object, Map, Set, Error, Promise,
    AbortSignal: { timeout: () => undefined },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    getAccountContext: () => ({ isDemo: false }),
    scopedWorkerPath: p => p,
    storeWorkerFetch: async (path, opts = {}) => {
      const key = path.replace(/^\/kv\//, '');
      const ok = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
      if ((opts.method || 'GET') === 'POST') {
        posts.push(path);
        if (failPosts) return ok({ ok: false, error: 'Session expired or invalid' }, 401);
        const body = JSON.parse(opts.body);
        if (path === '/kv/show-sessions-index/upsert') {
          const index = JSON.parse(kv.get('show_sessions_index') || '[]').filter(r => r.id !== body.entry.id);
          index.unshift(body.entry); kv.set('show_sessions_index', JSON.stringify(index));
          return ok({ ok: true, index });
        }
        kv.set(key, JSON.stringify(body)); return ok({ ok: true });
      }
      return ok({ value: kv.has(key) ? kv.get(key) : null });
    },
    enqueueOrReplaceSync: (type, id, label, payload) => queued.push({ type, id, payload }),
    toast_dash: () => {}, renderShowMode: () => ctx.renderShowStaleWarning(ctx.getShowMode()), renderCashBagSwitcher: () => {}, renderShowSessionSwitcher: () => {},
    fetchSharedCashBags: async () => [], syncSharedShowTransactions: async () => {}, getCurrentUserLabel: () => 'owner',
    escHtml: v => String(v ?? ''),
    document: {
      getElementById: id => id === 'show-mode-status' ? statusEl : (elements[id] || null),
      createElement: () => { const el = { style: {}, remove() { delete elements[this.id]; } }; return el; },
    },
    drawerState: null,
    Response,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.getShowMode=getShowMode;this.syncShowModeFromWorker=syncShowModeFromWorker;this.publishShowSession=publishShowSession;this.renderShowStaleWarning=renderShowStaleWarning;this.reshareStaleShow=reshareStaleShow;this.showIsStale=showIsStale;this.missing=showMissingFromWorker;', ctx);
  return { ctx, kv, posts, queued, store, elements, setFail: v => { failPosts = v; } };
}
const day = 24 * 60 * 60 * 1000;
const showOf = (id, ageDays) => ({ id, eventName: 'Tacoma Mall Show', status: 'open', startedAt: new Date(Date.now() - ageDays * day).toISOString() });

// 4. A rejected publish throws (so callers queue a retry), it never "succeeds".
{
  const w = makeWorld();
  w.setFail(true);
  await assert.rejects(w.ctx.publishShowSession(showOf('s1', 0)), /Session expired/);
}

// 2. The Worker lost a recent show: it's shared again, automatically.
{
  const w = makeWorld();
  w.store.set('pos_show_mode', JSON.stringify(showOf('s2', 0.2)));
  await w.ctx.syncShowModeFromWorker();
  assert.ok(w.posts.includes('/kv/show_session_s2'), 'the show record is re-published');
  assert.ok(JSON.parse(w.kv.get('show_sessions_index')).some(r => r.id === 's2' && r.status === 'open'), 'and it is back on the shared list');
}

// 2. The Worker lost a month-old show that this device still has open: it
// is shared again anyway (an open show must always be joinable -- holding it
// back hid the Oct 3-4 show and its cash bag from every other device), and
// the device still warns that it's been open a long time.
{
  const w = makeWorld();
  w.store.set('pos_show_mode', JSON.stringify(showOf('s3', 27)));
  await w.ctx.syncShowModeFromWorker();
  assert.ok(JSON.parse(w.kv.get('show_sessions_index')).some(r => r.id === 's3' && r.status === 'open'), 'an old open show is shared again too');
  assert.equal(w.ctx.missing.s3, undefined);
  w.ctx.renderShowStaleWarning(w.ctx.getShowMode());
  const box = w.elements['show-stale-warning'];
  assert.ok(box, 'a warning is shown');
  assert.match(box.innerHTML, /open since .* \(27 days\)/);
  assert.doesNotMatch(box.innerHTML, /Other devices can't see or join it/, 'it is shared, so no such claim');
  assert.match(box.innerHTML, /END THIS SHOW/);
  // Still running (a multi-day convention): one tap quiets the warning.
  await w.ctx.reshareStaleShow();
  assert.equal(w.ctx.showIsStale(w.ctx.getShowMode()), false);
  assert.equal(w.elements['show-stale-warning'], undefined, 'warning cleared');
}

// A publish that fails says other devices can't see the show.
{
  const w = makeWorld();
  w.setFail(true);
  w.store.set('pos_show_mode', JSON.stringify(showOf('s5', 27)));
  await w.ctx.syncShowModeFromWorker();
  assert.equal(w.ctx.missing.s5, true);
  assert.ok(w.queued.some(q => q.id === 's5'), 'queued for retry');
  w.ctx.renderShowStaleWarning(w.ctx.getShowMode());
  assert.match(w.elements['show-stale-warning'].innerHTML, /Other devices can't see or join it/);
}

// Shows with an open cash bag in the database are listed even when the
// shared show list lost them.
assert.match(dashboard, /async function addShowsWithOpenCashBags\(\)\{/);
assert.match(dashboard, /knownShowSessionIndex=Array\.isArray\(parsed\)\?parsed:\[\];\n    await addShowsWithOpenCashBags\(\);/);

// 3. An open show that fell off the shared list (it expires after 7 days)
// is put back; one already listed and confirmed today isn't re-written.
{
  const w = makeWorld();
  const show = showOf('s4', 0.5);
  w.store.set('pos_show_mode', JSON.stringify(show));
  w.kv.set('show_session_s4', JSON.stringify(show)); // record exists, list entry expired
  await w.ctx.syncShowModeFromWorker();
  assert.ok(JSON.parse(w.kv.get('show_sessions_index')).some(r => r.id === 's4'), 'back on the list');
  const before = w.posts.length;
  await w.ctx.syncShowModeFromWorker();
  assert.equal(w.posts.length, before, 'no re-write while it is listed and confirmed today');
}

// Any device can end any listed show (END next to it), and a show still
// taking sales lately is listed even without an open bag.
assert.match(dashboard, /async function endSharedShow\(id\)\{/);
assert.match(dashboard, /onclick="endSharedShow\('\$\{escHtml\(show\.id\)\}'\)">END<\/button>/);
assert.match(dashboard, /closed=\{\.\.\.show,id,status:'closed'/);
assert.match(dashboard, /from\('pos_sales'\)\.select\('show_session_id,completed_at'\)\.eq\('store_id',getActiveStoreId\(\)\)/);
assert.match(dashboard, /if\(!show\)return toast_dash\('This device is not in a show\./, 'END SHOW says why instead of doing nothing');

// The retry queue re-runs the same publish, which now really reports failure.
assert.match(dashboard, /if\(item\.type === 'show-session-kv'\) \{\n    await publishShowSession\(item\.payload\.show\);/);
console.log('Shared show stays shared checks passed');
