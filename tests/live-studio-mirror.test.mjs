import fs from 'node:fs';
import assert from 'node:assert/strict';
// Store, 2026-11-24: "Can you make it so you can read it?" -- the studio's dungeon copied to Supabase every 10 minutes.
const { studioMirror, mirrorLiveStudio } = await import('../scripts/live-studio-mirror.mjs');
const state = { settings: { chestLoad: '[{"id":"a","t":"x","f":1}]', showUnlocks: '100: Free pack', beastsFace: '1'.repeat(144) }, stats: { showId: 's', gross: 50, dungeon: { floor: 2, plan: [{ floor: 2 }] } }, stage: { now: { title: 'Book A' }, next: [{ title: 'Book B' }] }, pics: ['big'], fisterFace: 'data:...', revision: 9 };
const m = studioMirror(state);
assert.equal(m.dungeon.floor, 2); assert.equal(m.settings.showUnlocks, '100: Free pack'); assert.equal(m.settings.beastsFace, undefined);
assert.deepEqual(m.stage, { now: 'Book A', next: ['Book B'] }); assert.ok(!('pics' in m) && !JSON.stringify(m).includes('data:'), 'no photos');
const calls = [];
const env = { MANA_LIVE_STUDIO: { getByName: id => ({ snapshot: async () => state }) } };
const r = await mirrorLiveStudio(env, '0f9dd4bc-42a7-487e-a972-2905d24513e9', async (p, i) => { calls.push([p, i]); return {}; });
assert.ok(r.ok && calls[0][0] === 'live_studio_snapshots?on_conflict=store_id' && JSON.parse(calls[0][1].body).snapshot.dungeon.floor === 2);
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.ok(w.includes("await mirrorLiveStudio(env, whatnotStoreId(env),"), 'runs with the 10-minute Whatnot run');
console.log('Live Studio mirror: passed');
// The remote's refresh doesn't paint over a field being edited (a marquee template mid-typing).
{ const ctl = fs.readFileSync('scripts/live-studio-controls.js', 'utf8');
  assert.ok(ctl.includes("if(!el||unsaved.has(k)||el===document.activeElement)continue;") && ctl.includes("if(path==='settings')unsaved.clear();"));
  console.log('Remote keeps unsaved edits: passed'); }
// 2026-11-24: "make it switch on its own" -- with automatic on, the studio follows the show that's live on Whatnot.
{ const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8'), room = fs.readFileSync('scripts/live-studio-room.mjs', 'utf8');
  assert.ok(room.includes("followShow(showId) {") && room.includes("if (!s.settings.automatic || !/^[0-9a-f-]{36}$/i.test(String(showId || '')) || s.settings.showId === showId) return { changed: false };"));
  assert.ok(w.includes("const liveShow = (synced?.shows || []).find(x => x.status === 'live')?.showId;") && w.includes('await followLiveShowInStudio(env, whatnotStoreId(env), liveShow)'), 'the 10-minute run');
  assert.ok(w.includes('await followLiveShowInStudio(env, storeId, String(showId))'), 'and the moment Whatnot says a show went live');
  assert.ok(/async function followLiveShowInStudio[\s\S]{0,400}await room\.syncStats\(orders\);/.test(w), 'catches up on the show\'s sales');
  console.log('Studio follows the live show: passed'); }
// 2026-11-24: "I want this type of thing easy to see for the viewers ... integrated into the marquee center bar".
{ const ov = fs.readFileSync('scripts/live-studio-overlay.mjs', 'utf8'), css = fs.readFileSync('assets/live-studio.css', 'utf8');
  assert.ok(ov.includes('function paintCenterBar(d,goal,pct){') && ov.includes('paintCenterBar(d,goal,pct);') && ov.includes("'🧰 NEXT CHEST: <b>'") && ov.includes("MORE TO SUMMON <b>"));
  assert.ok(ov.includes('Math.floor(Date.now()/5000)%cbarLines.length'), 'the line turns on the clock');
  assert.ok(css.includes('body.mana-center #mana-sign.cbar #mana-cbar-track{') && !css.includes('#mana-vcard'));
  console.log('Center bar: chests, $ to go, next chest: passed'); }
// 2026-11-25: the demo shows every step of a big sale (boss out, boss down, chest), and Ice Berg is floor 2's boss.
{ const ctl = fs.readFileSync('scripts/live-studio-controls.js', 'utf8'), css = fs.readFileSync('assets/live-studio.css', 'utf8'), D = await import('../scripts/live-studio-dungeon.mjs');
  assert.ok(ctl.includes("for(const ev of r.events){if(ev.kind==='floor')steps.push(['floor',ev]);else if(ev.kind==='boss')steps.push(['boss',{dungeon:true,...ev}]);}") && ctl.includes('[12,25,8,40,15]'));
  assert.equal(D.bossForFloor(1), 'fister'); assert.equal(D.bossForFloor(2), 'iceberg');
  assert.ok(css.includes('body.mana-center #mana-crawl.bar{display:none!important}'), 'the yellow strip is off with the center bar');
  console.log('Demo shows every step; Ice Berg on floor 2; no yellow strip: passed'); }
