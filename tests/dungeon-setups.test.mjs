import fs from 'node:fs';
import assert from 'node:assert/strict';
// Store, 2026-11-24: "I want to be able to have you set up the dungeons. Like I tell you what's in each chest each floor,
// tell you boss and stretch goals etc. You set it up. And then it's in the Whatnot show tab saved."
const S = await import('../scripts/dungeon-setups.mjs'), D = await import('../scripts/live-studio-dungeon.mjs');
const plan = S.cleanSetupPlan({ floors: [
  { floor: 2, boss: 'iceberg', room: 'vault', reward: 'Free slab giveaway', chests: [{ t: 'Free giveaway for followers' }, { t: '$1 start', i: { title: 'Ultimate Spider-Man #1', image: 'https://x.test/a.jpg', price: 5 } }] },
  { floor: 1, boss: 'nobody', chests: [{ t: '' }, { t: 'Shoutout' }, { t: 'a' }, { t: 'b' }] },
], stretch: [{ at: 500, text: 'We open a sealed box on stream' }, { at: 100, text: 'Free pack for the top buyer' }] });
assert.deepEqual(plan.floors.map(f => f.floor), [1, 2], 'floors in order');
assert.equal(plan.floors[0].boss, undefined, 'unknown boss dropped'); assert.equal(plan.floors[1].boss, 'iceberg');
assert.equal(plan.floors[0].chests.length, 2, 'at most 3 chests a floor, empty ones dropped');
assert.deepEqual(plan.stretch.map(x => x.at), [100, 500]);
const set = S.setupSettings(plan);
assert.equal(set.floorRewards, '2: Free slab giveaway');
assert.equal(set.showUnlocks, '100: Free pack for the top buyer\n500: We open a sealed box on stream');
const load = JSON.parse(set.chestLoad);
assert.equal(load.length, 4); assert.ok(load.every(c => c.f >= 1)); assert.equal(load.find(c => c.i).i.title, 'Ultimate Spider-Man #1');
// Each floor takes its own chests first; a floor with none set takes only floor-less chests.
const s = { chestLoad: set.chestLoad };
assert.equal(D.nextChestLoad(s, { floor: 2 }).t, 'Free giveaway for followers');
assert.equal(D.nextChestLoad(s, { floor: 1 }).t, 'Shoutout');
assert.equal(D.nextChestLoad(s, { floor: 5 }), null);
assert.equal(D.nextChestLoad({ chestLoad: JSON.stringify([{ id: 'x1', t: 'any floor' }]) }, { floor: 4 }).t, 'any floor');
// The studio settings accept chests with a floor.
const M = await import('../scripts/live-studio-model.mjs');
assert.doesNotThrow(() => M.validateSettings({ ...M.DEFAULT_STUDIO, chestLoad: set.chestLoad }));
// Wiring: the Worker route, the table, the remote's section and LOAD.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8'), ctl = fs.readFileSync('scripts/live-studio-controls.js', 'utf8');
assert.ok(worker.includes("if (url.pathname === '/store/dungeon-setups') { const r = await handleDungeonSetups("));
assert.ok(fs.readFileSync('supabase/migrations/20261124170000_dungeon_setups.sql', 'utf8').includes('create table if not exists public.dungeon_setups'));
assert.ok(ctl.includes('🏰 SAVED DUNGEON SETUPS') && ctl.includes('async function loadSetup(su){') && ctl.includes("api('dungeon-adjust',{boss:f.boss,at:f.floor})") && ctl.includes('refreshSetups();'));
assert.ok(ctl.includes('...(c.f?{f:c.f}:{})'), 'saving the chests keeps their floors');
const calls = []; const db = async (p, i) => { calls.push([p, i]); return { data: [] }; };
const json = (b, st = 200) => ({ b, st }), req = (method, body) => ({ method, headers: new Map(), json: async () => body });
const r = await S.handleDungeonSetups(req('POST', { name: 'Week of 11/26', plan: { floors: [{ floor: 1, boss: 'fister' }] } }), {}, new URL('https://w/store/dungeon-setups?store_id=abc'), { requireStoreUser: async () => ({}), json, db });
assert.equal(r.st, 200); assert.equal(r.b.setup.plan.floors[0].boss, 'fister'); assert.ok(calls[0][0].startsWith('dungeon_setups?on_conflict=id'));
// Demo / PLAY THROUGH: preview only, and the chests open in it with what's loaded for that floor.
assert.ok(ctl.includes('id="mana-demo-run"') && ctl.includes('demoRun=setInterval(step,6000)'));
assert.ok(ctl.includes("dungeonLib.chestsToOpen(demoDungeon,{...v,chestGoals:''})") && ctl.includes("if(chest)steps.push(['chest',chest]);"));
const demoBody = ctl.slice(ctl.indexOf('const demoSale=()=>{'), ctl.indexOf("host.querySelector('#mana-link')"));
assert.ok(!/api\(/.test(demoBody), 'the demo never calls the studio');
console.log('Saved dungeon setups: passed');
// 2026-11-25: "it keeps blowing out what's loaded ... I regularly have a phone open" -- LOAD reads the latest first and
// sends only the setup's own fields (the studio merges them into what it has), retrying on a change from another screen.
{ const c = fs.readFileSync('scripts/live-studio-controls.js', 'utf8'), room = fs.readFileSync('scripts/live-studio-room.mjs', 'utf8');
  assert.ok(c.includes("const fresh=await api('state');revision=fresh.revision;") && c.includes("d=await api('settings',{settings:set,revision});"));
  assert.ok(!/loadSetup[\s\S]{0,1500}settings:values\(\),revision/.test(c.slice(c.indexOf('async function loadSetup(su){'), c.indexOf('async function loadSetup(su){') + 1600)), 'LOAD never sends the whole screen');
  assert.ok(room.includes('s.settings = {...s.settings, ...validateSettings({...s.settings,...settings})};'), 'the studio merges a partial save');
  console.log('LOAD is safe with a phone open: passed'); }
// 2026-11-26: a 7-floor setup (21 chests with covers) plus the marquee templates is bigger than 8 KB -- settings saves
// take up to 64 KB, like the lineup.
{ const api = fs.readFileSync('scripts/live-studio-api.mjs', 'utf8');
  assert.ok(api.includes("'/live-studio/fister-face','/live-studio/settings'].includes(url.pathname)?65536:8192"));
  console.log('Big dungeon setups save: passed'); }
// 2026-11-27: the loaded dungeon kept going back to the old chests -- every save sends only what that screen changed
// (an older copy elsewhere can't undo a LOAD), and LOAD checks the studio kept the chests and says so in a pop-up.
{ const c = fs.readFileSync('scripts/live-studio-controls.js', 'utf8');
  assert.ok(!c.includes('settings:values(),revision'), 'no save sends the whole screen');
  assert.ok(c.includes("function changed(){const v=values(),out={};for(const k of Object.keys(v)){if(!settings||!(k in settings)||JSON.stringify(v[k])!==JSON.stringify(settings[k]))out[k]=v[k];}return out;}"));
  assert.ok(c.includes("if(landed!==want)throw Error('The studio did not keep the chests") && c.includes("alert('LOAD did not finish: '+e.message)"));
  console.log('Saves send only what changed; LOAD checks itself: passed'); }
