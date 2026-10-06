import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// ── 1. Whatnot missed-sticker queue ──
{
  const dir = 'extensions/whatnot-live-stickers/';
  const bg = fs.readFileSync(dir + 'background.js', 'utf8');
  const manifest = JSON.parse(fs.readFileSync(dir + 'manifest.json', 'utf8'));
  assert.ok(manifest.permissions.includes('alarms'), 'the missed check survives the service worker sleeping');
  assert.match(fs.readFileSync(dir + 'label.js', 'utf8'), /chrome\.runtime\.sendMessage\(\{ type:'wls-printed', id:id \}\)/, 'the label reports back after printing');
  // isMissed: not printed a minute after it was sent (or never sent); tests never count.
  const ctx = { Date };
  vm.createContext(ctx);
  vm.runInContext(bg.match(/var MISSED_AFTER_MS = [^\n]*\n/)[0] + bg.match(/function isMissed\(sale, now\)\{[^\n]*\}/)[0] + ';this.m=isMissed;', ctx);
  const now = Date.parse('2026-10-10T20:00:00Z'), ago = s => new Date(now - s * 1000).toISOString();
  assert.equal(ctx.m({ printRequestedAt:ago(90) }, now), true);
  assert.equal(ctx.m({ printRequestedAt:ago(20) }, now), false, 'still within the grace minute');
  assert.equal(ctx.m({ printRequestedAt:ago(90), printedAt:ago(80) }, now), false);
  assert.equal(ctx.m({}, now), true, 'never sent to the printer');
  assert.equal(ctx.m({ test:true }, now), false);
  assert.match(bg, /if\(msg\.type === 'wls-print-missed'\)/);
  assert.match(bg, /chrome\.action\.setBadgeText\(\{ text:n \? String\(n\) : '' \}\)/);
  assert.match(fs.readFileSync(dir + 'popup.html', 'utf8'), /id="print-missed">PRINT MISSED</);
  const dashboard = fs.readFileSync('dashboard.html', 'utf8');
  const list = JSON.parse(dashboard.match(/const WHATNOT_STICKER_EXTENSION_FILES = (\[[^\]]+\]);/)[1].replace(/'/g, '"'));
  assert.deepEqual([...list].sort(), fs.readdirSync(dir).sort(), 'the dashboard download still packs every extension file');
}

// ── 2. Collectors missing a connecting part ──
{
  const d = fs.readFileSync('dashboard.html', 'utf8');
  const start = d.indexOf('function connectingCollectorAlerts(');
  const src = d.slice(start, d.indexOf('\n}\n', start) + 2);
  const ctx = { Map, Set, String };
  vm.createContext(ctx);
  vm.runInContext(src + ';this.f=connectingCollectorAlerts;', ctx);
  const covers = [
    { id:'p1', part:1, title:'DNX #3', foc_date:'2026-09-01', customers:['Sam ×2', 'Jo'] },
    { id:'p2', part:2, title:'DNX #4', foc_date:'2026-10-12', customers:['Jo'] },
    { id:'p3', part:3, title:'DNX #5', foc_date:'2026-10-19', customers:[], pullSubscribers:['Lee'] },
  ];
  const sets = [{ id:'s', name:'Vicentini 5-part', skuIds:['old', 'p2', 'p3'] }];
  const out = JSON.parse(JSON.stringify(ctx.f(sets, covers, { old:'p1' }, '2026-10-06')));
  // Lee is on the pull list for the series, so is missing both upcoming parts.
  assert.deepEqual(out.map(a => [a.name, a.cover.id]), [['Lee', 'p2'], ['Sam', 'p2'], ['Jo', 'p3'], ['Lee', 'p3'], ['Sam', 'p3']]);
  assert.deepEqual(out[1].has, ['part 1 DNX #3'], 'old saved id resolves through aliases');
  assert.equal(out.find(a => a.name === 'Lee').pull, true, 'pull-list subscriber with no preorder yet');
  assert.ok(!out.some(a => a.name === 'Jo' && a.cover.id === 'p2'), 'already preordered that part');
  assert.match(d, /const collectors = connectingCollectorAlerts\(sets, data\.covers \|\| \[\], aliases\);/, 'shown on Home too');
  assert.match(fs.readFileSync('scripts/foc-dashboard.js', 'utf8'), /connectUpNext\(\)\+connectCollectorsHtml\(\)\+/);
  assert.match(fs.readFileSync('scripts/foc-preorders.mjs', 'utf8'), /c\.pullSubscribers=subscribers\.get\(seriesKey\(c\.title\)\)\|\|\[\];/);
}

// ── 3. Shows: rename, split a day off, merge ──
{
  const ex = fs.readFileSync('scripts/expenses.js', 'utf8');
  assert.match(ex, /renameShow:async function\(id\)\{/);
  assert.match(ex, /Object\.assign\(\{ id:id, status:'closed', startedAt:'' \}, rec \|\| \{\}, \{ eventName:name\.trim\(\)/, 'rename keeps the rest of the show record');
  assert.match(ex, /filter\(function\(r\)\{ return pacificDay\(r\.completed_at\) === day; \}\)/, 'split moves only that day (Pacific)');
  assert.match(ex, /client\.from\('pos_sales'\)\.update\(\{ show_session_id:nid \}\)\.eq\('store_id', store\)\.in\('id', ids\)/);
  for (const table of ['pos_sales', 'store_expenses', 'pos_drawer_sessions']) {
    assert.match(ex, new RegExp("client\\.from\\('" + table + "'\\)\\.update\\(\\{ show_session_id:target\\.id \\}\\)\\.eq\\('store_id', store\\)\\.eq\\('show_session_id', id\\)"), 'merge moves ' + table);
  }
  assert.match(ex, /btn\('SPLIT OFF ' \+ esc\(d\.label\)\.toUpperCase\(\)/);
}
console.log('Missed stickers, collector alerts and show editing checks passed');
