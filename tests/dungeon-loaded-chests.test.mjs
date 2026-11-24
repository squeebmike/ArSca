// LOADED CHESTS (store, 2026-11-17: "We don't use NEXT UP ... I just want to have things in chests" -- "build the part
// where I load chests not from NEXT UP. I want to load each chest with what it says and what item shows").
import assert from 'node:assert/strict';
import fs from 'node:fs';
// The room is a Durable Object; this stand-in for cloudflare:workers lets plain Node load it.
await import('./helpers/cloudflare-modules-hook.mjs');
const D = await import('../scripts/live-studio-dungeon.mjs');
const M = await import('../scripts/live-studio-model.mjs');
const { ManaLiveStudio } = await import('../scripts/live-studio-room.mjs');
const book = (title, price) => ({ title, image: 'https://cdn.example.com/' + price + '.jpg', price });
const load = [
  { id: 'c1', t: 'Free giveaway for followers -- Midnight Spider-Man #2', i: book('Midnight Spider-Man #2 Cover A', 4.99) },
  { id: 'c2', t: 'Low start on X-Orcists #1 Bradshaw 1:25', i: book('X-Orcists #1 Bradshaw 1:25', 30) },
  { id: 'c3', t: 'Free giveaway for followers -- a Momoko Momo-Tone' },
];
const json = JSON.stringify(load);
// Saved with the studio, checked like every other on-screen words.
assert.equal(M.validateSettings({ chestLoad: json }).chestLoad, json);
assert.throws(() => M.validateSettings({ chestLoad: 'nope' }), /chestLoad/);
assert.throws(() => M.validateSettings({ chestLoad: JSON.stringify([{ id: 'x', t: '' }]) }), /chestLoad/);
assert.throws(() => M.validateSettings({ chestLoad: JSON.stringify([{ id: 'x', t: 'ok', i: { title: 'a', image: 'http://plain.example.com/a.jpg' } }]) }), /chestLoad/, 'https photos only');
assert.throws(() => M.validateSettings({ chestLoad: JSON.stringify(Array.from({ length: 22 }, (_, k) => ({ id: "a" + k, t: "x" }))) }), /chestLoad/, "21 at most");
assert.throws(() => M.validateSettings({ chestLoad: JSON.stringify([{ id: 'x', t: 'Mystery raffle chest' }]) }), /game of chance/);
// In order, each used once a week; a new one added later is next.
const s0 = { chestLoad: json };
assert.equal(D.nextChestLoad(s0, {}).id, 'c1');
assert.equal(D.nextChestLoad(s0, D.useChestLoad(D.useChestLoad({}, 'c1'), 'c2')).id, 'c3');
assert.equal(D.nextChestLoad(s0, { chestLoadUsed: ['c1', 'c2', 'c3'] }), null, 'all used: chests go back to how they were');
// In the room: chests open with their own words and book; NEXT UP is untouched and nothing goes to Whatnot.
{
  const settings = { ...M.DEFAULT_STUDIO, chestLoad: JSON.stringify(load.slice(0, 2)), chestGoals: '', giveawayChests: 0 };
  const next = [{ title: 'Chapman\'s book', price: 99, id: '00000000-0000-0000-0000-000000000001' }];
  const s = { settings, dungeon: { ...D.emptyDungeon(D.weekKey()), mana: 95 }, stage: { now: null, next: [...next] } };
  const room = Object.create(ManaLiveStudio.prototype);
  const fx = ManaLiveStudio.prototype.openReachedChests.call(room, s, Date.now());
  assert.deepEqual(s.dungeon.chestLoadUsed, ['c1', 'c2'], 'both loaded chests used, in order');
  assert.equal(s.dungeon.opened[1].length, 3, 'all three chests on the floor opened');
  assert.equal(s.stage.now?.title, 'Chapman\'s book', 'the third (nothing loaded left) works as before -- from NEXT UP');
  const took = ManaLiveStudio.prototype.takeChest.call(room, s);
  assert.equal(took.chestItem?.title, 'Chapman\'s book');
  assert.ok(fx);
}
{
  const settings = { ...M.DEFAULT_STUDIO, chestLoad: JSON.stringify(load.slice(1, 2)), chestGoals: '', giveawayChests: 0 };
  const s = { settings, dungeon: { ...D.emptyDungeon(D.weekKey()), mana: 20 }, stage: { now: null, next: [{ title: 'Keep me', price: 50 }] } };
  const room = Object.create(ManaLiveStudio.prototype);
  const fx = ManaLiveStudio.prototype.openReachedChests.call(room, s, Date.now());
  assert.equal(fx.chestText, 'Low start on X-Orcists #1 Bradshaw 1:25'); assert.equal(fx.item.title, 'X-Orcists #1 Bradshaw 1:25', 'its book spins');
  assert.deepEqual(s.stage.next.map(n => n.title), ['Keep me'], 'NEXT UP untouched'); assert.equal(s.stage.now, null);
  const took = ManaLiveStudio.prototype.takeChest.call(room, s);
  assert.equal(took.chestItem, undefined, 'nothing added to the Whatnot show'); assert.equal(took.chestLoaded, 'Low start on X-Orcists #1 Bradshaw 1:25');
  const shown = M.makeEffect ? M.makeEffect('chest', settings, Date.now(), fx) : null;
  if (shown) assert.equal(shown.item?.title, 'X-Orcists #1 Bradshaw 1:25', 'the overlay gets the book');
}
// The remote: a list to load, a book picked from stock, saved with the studio.
const ctl = fs.readFileSync('scripts/live-studio-controls.js', 'utf8');
assert.ok(ctl.includes('<div id="chest-load" class="chest-load"></div>') && ctl.includes('<input type="hidden" name="chestLoad">'));
assert.ok(ctl.includes("💾 SAVE THE CHESTS") && ctl.includes("+ ADD A CHEST") && ctl.includes("🔎 pick its book"));
assert.ok(fs.readFileSync('assets/live-studio.css', 'utf8').includes('.mana-controls .chest-row{'));
console.log('Loaded chests: passed');
// (2026-11-17: "Fister needs to pump his fist. It looks backwards. He needs to say It's Fistin' Time!")
{
  const g3 = fs.readFileSync('scripts/live-studio-3d.mjs', 'utf8'), ovl = fs.readFileSync('scripts/live-studio-overlay.mjs', 'utf8'), bosses = fs.readFileSync('scripts/live-studio-bosses.mjs', 'utf8');
  // Not the first try either ("he looks like he is doing triceps raises"): the "YES!" pump -- forearm up by his face,
  // yanked down to his chest with the elbow driving back; the knuckles face out.
  assert.ok(g3.includes("shoulder.rotation.x = ease(-0.75, 0.35, pump);") && g3.includes("elbow.rotation.x = ease(-2.35, -1.75, pump);"), 'cocked up, yanked down');
  assert.ok(g3.includes("fist.rotation.set(0, Math.PI, 0.1);"), 'knuckles out');
  assert.ok(!g3.includes("elbow.rotation.z = -ease(1.14, 0.22, pump);"), 'no overhead arm straightening (the triceps raise)');
  assert.ok(!g3.includes('shoulder.rotation.z = -ease(1.9, 2.95, raise) + 0.55 * low;'), 'no more low swing out to the side');
  assert.ok(ovl.includes(`case 'fister': return ['MR FISTER!',"IT'S FISTIN' TIME!",`) && bosses.includes(`taunt: "IT'S FISTIN' TIME!"`), 'his catchphrase');
  assert.ok(!/IF I CAN DO IT, YOU CAN/.test(ovl + bosses));
  console.log('Mr Fister fist pump and catchphrase: passed');
}
// (2026-11-17: "1st boss today won't be Fister. Why's it say 100 until we summon him? I want to select him for a boss
// if needed.") The host picks this floor's boss, and can summon it now.
{
  const s = { ...M.DEFAULT_STUDIO };
  let d = D.emptyDungeon(D.weekKey());
  assert.equal(D.bossOf(d, 1), 'fister', 'floor 1 is Mr Fister by the set order');
  d = D.adjustDungeon(d, { boss: 'mimic' });
  assert.equal(D.bossOf(d, 1), 'mimic'); assert.equal(D.publicDungeon(d, s).boss.character, 'mimic'); assert.equal(D.publicDungeon(d, s).boss.picked, 'mimic');
  assert.throws(() => D.adjustDungeon(d, { boss: 'nobody' }), /Invalid boss/);
  // The flask filling brings out the picked boss.
  let r = D.addMana(d, 1000, s);
  assert.equal(r.events.find(e => e.kind === 'floor')?.bossCharacter, 'mimic');
  // SUMMON NOW: straight to the boss, its full HP.
  let e = D.adjustDungeon(D.adjustDungeon(D.emptyDungeon(D.weekKey()), { boss: 'fister' }), { summon: true, settings: s });
  assert.equal(e.phase, 'boss'); assert.equal(e.bossHp, D.bossMax(s, 1, e)); assert.equal(e.mana, D.floorGoal(s, 1, e));
  assert.throws(() => D.adjustDungeon(e, { summon: true, settings: s }), /already out/);
  assert.throws(() => D.adjustDungeon(e, { boss: 'mimic' }), /already out/, 'pick before summoning');
  // Back to the set order.
  assert.equal(D.bossOf(D.adjustDungeon(D.emptyDungeon(D.weekKey()), { boss: '' }), 1), 'fister');
  // The remote and the room.
  const room = fs.readFileSync('scripts/live-studio-room.mjs', 'utf8'), api = fs.readFileSync('scripts/live-studio-api.mjs', 'utf8');
  assert.ok(room.includes("else if (input.boss !== undefined) s.dungeon = adjustDungeon(s.dungeon, { boss: input.boss, at: input.at }, now);") && room.includes("s.dungeon = adjustDungeon(s.dungeon, { summon: true, settings: s.settings }, now);"));
  assert.ok(api.includes("...(typeof body.boss==='string'?{boss:body.boss.slice(0,20)}:{}),") && api.includes("...(body.summon===true?{summon:true}:{})"));
  assert.ok(ctl.includes('id="mana-boss-pick"') && ctl.includes('⚔ SUMMON THE BOSS NOW') && ctl.includes("api('dungeon-adjust',{summon:true})"));
  assert.ok(fs.readFileSync('scripts/live-studio-overlay.mjs', 'utf8').includes("from './live-studio-bosses.mjs?v=4';"), 'the overlay loads the new catchphrase, not a cached one');
  console.log('Pick and summon the boss: passed');
}
