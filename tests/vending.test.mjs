// THE VENDING MACHINE, polished (store, 2026-11-13: "polish up the vending
// machine ... full screen ... the bid button is the buy button on the machine
// ... for surprise sets ... a break with 75 character spots ... not have all
// those items on the site in inventory"), the battle on the green screen as an
// option, and the dungeon and Beasts kept apart ("are you crossing some things
// from the shed game across by accident? And vice versa?").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const V = await import('../scripts/vending.mjs'), M = await import('../scripts/live-studio-model.mjs'), D = await import('../scripts/live-studio-dungeon.mjs');
const vsrc = read('scripts/vending.mjs'), room = read('scripts/live-studio-room.mjs'), ov = read('scripts/live-studio-overlay.mjs'), bg = read('scripts/shed-background.mjs'), ctl = read('scripts/live-studio-controls.js');
assert.ok(!/Math\.random/.test(vsrc), 'nothing by chance');
assert.ok(!/whatnot/i.test(vsrc.replace(/^\/\/.*$/gm, '').replace(/IN THE APP/g, '')), 'a generic BID button, no one\'s logo or name');

// 1. Spots: a count and a price, or one name a line -- nothing from inventory.
const s75 = V.makeSpots({ count: 75, price: 5 });
assert.equal(s75.length, 75); assert.equal(s75[0].title, 'SPOT 1'); assert.equal(s75[74].title, 'SPOT 75'); assert.equal(s75[3].price, 5);
assert.ok(s75.every(x => !x.id && !x.sold && !x.image), 'spots are not stock items');
const named = V.makeSpots({ names: 'Spider-Man\n\n  Batman \nWolverine', price: 7.5, count: 99 });
assert.deepEqual(named.map(x => x.title), ['Spider-Man', 'Batman', 'Wolverine'], 'names win over the count');
assert.equal(V.makeSpots({ count: 500 }).length, 120, 'at most 120'); assert.equal(V.makeSpots({ count: 3, prefix: 'pack' })[2].title, 'PACK 3');
assert.equal(V.makeSpots({}).length, 0);
for (const x of s75) M.validateStage({ now: null, next: [x] }); // the room's own check takes them
// 2. The slot UP NOW: the host's pick, else the first one open.
const mc = { items: [{ sold: true }, {}, {}], up: 2 };
assert.equal(V.upIndex(mc), 2); assert.equal(V.upIndex({ ...mc, up: 0 }), 1); assert.equal(V.upIndex({ items: [{ sold: true }] }), -1); assert.equal(V.upIndex(null), -1);
// 3. The machine: a BID pill on every slot, SOLD stamped, a big BID in the tray, UP NOW lit; small, full, or in front.
for (const k of ["'BID ' + money(it.price)", '<em class="vm-stamp">SOLD</em>', "(i === up ? ' up' : '')", '.vm.full{', "where === 'overlay' ? mode === 'front' : mode !== 'front'"]) assert.ok(vsrc.includes(k), k);
// 4. The room: modes, step, sold-and-next, spots; a sale takes the spot UP NOW.
for (const k of ["if (['panel', 'full', 'front'].includes(input.mode)) m.mode = input.mode;", 'm.items = clean(makeSpots(input.spots));', "m.kind = 'spots'", 'if (input.soldUp === true)', 'm.up = openFrom(m.items, upIndex(m), input.step);', ".slice(0, 120)", "if (s.machine.kind === 'spots') { if (!s.machine.on) return false;"]) assert.ok(room.includes(k), k);
assert.match(room, /import \{ makeSpots, upIndex \} from '\.\/vending\.mjs';/);
assert.ok(read('.github/workflows/deploy-worker.yml').includes('- scripts/vending.mjs'), 'the worker deploys when the machine changes');
// 5. Both screens draw the same machine.
assert.match(bg, /import\('\.\/vending\.mjs\?v=3'\)/); assert.match(ov, /createVending\(document,\{img:studioImg,where:'overlay'\}\)/);
assert.ok(ov.includes('if(m.machine||m.settings)paintMachine(m.machine||machine);') && ov.includes('if(ev.data.machine||ev.data.settings)paintMachine(ev.data.machine||machine);'));
assert.ok(!read('shed-background.html').includes('#shed-vend'), 'the old machine is gone');
// 6. The remote: sizes, prev/next, sold-and-next, the spots maker; it works in the preview too.
for (const k of ['data-vm-mode="panel"', 'data-vm-mode="full"', 'data-vm-mode="front"', 'id="vm-sold-up"', 'id="vm-make"', 'id="vm-names"', 'async function machineDo(body){if(connectedStore){took(await api(\'machine\',body));return;}']) assert.ok(ctl.includes(k), k);
// 7. The battle on the green screen, if you want it.
assert.equal(D.DUNGEON_DEFAULTS?.beastsBattle ?? M.DEFAULT_STUDIO.beastsBattle, 'overlay');
assert.throws(() => M.validateSettings({ ...M.DEFAULT_STUDIO, beastsBattle: 'moon' }), /beastsBattle/);
assert.ok(ctl.includes('<select name="beastsBattle">') && ctl.includes('id="battle-green"'));
assert.ok(ov.includes("beastMode()&&settings.beastsBattle!=='green'&&beastsLib"), 'the overlay steps aside');
assert.ok(bg.includes("settings0.gameMode === 'beasts' && settings0.beastsBattle === 'green' ? beasts.battleFrom("), 'the green screen draws it');
assert.ok(bg.includes("if (m.effect && (m.type === 'effect' || m.fresh)) battleFx(m.effect);"), 'and it attacks there');
// 8. Kept apart: no dungeon boss, map, chest or taunt in Beasts; no Beasts buttons in the dungeon.
for (const k of ["if(!bm)bossRage(b,d);", "lastPhase!==phase&&!bm){bossView?.enter();bossIntro(b,d);}", "boss.classList.toggle('mana-hidden',!b.show||bm);", "settings.showMap===false||beastMode()", "' MORE TO BATTLE '+rv.name+'!'", "isChest=e.kind==='chest'&&!bm", "'FOUND IT IN THE TALL GRASS!'", "door:'WHICH PATH?'"]) assert.ok(ov.includes(k), k);
for (const k of ["bubble.classList.remove('on'); paintBattle(d);", "const boss = beastsOn || stats?.dungeon?.phase === 'boss'", "if (m.type === 'attack') { if (beastsOn) return;", "if (d && !beastsOn) { let grab"]) assert.ok(bg.includes(k), k);
assert.ok(ctl.includes("host.querySelectorAll('[data-beasts],#beast-moves').forEach(el=>{el.hidden=m!=='beasts';});"));
// 9. More (2026-11-13 "keep going"): a sold slot drops into the tray, LAST 5 SPOTS!, the green machine in Beasts, saved spot lists.
for (const k of ["'<b>' + code(i) + ' VEND!</b>'", 'for (const i of fresh) drop(mc.items[i], i);', "n > 10 && left > 0 && left <= 5", "' SPOTS!'", ".vm.gb{"]) assert.ok(vsrc.includes(k), k);
assert.ok(bg.includes("theme: settings0.gameMode === 'beasts' ? 'gb' : ''") && ov.includes("vendDraw?.(m,{theme:beastMode()?'gb':''})"), 'both screens go green in Beasts');
for (const k of ['id="vm-save-list"', 'id="vm-load-list"', "const SL='mana-spot-lists'"]) assert.ok(ctl.includes(k), k);
// 10. The rival is Beasts' own (2026-11-13: "Leaky roof kraken?"): a trainer and beast a route, never the dungeon's boss.
const B = await import('../scripts/beasts.mjs'), fight = B.battleFrom({ floor: 3, phase: 'boss', pct: 60, boss: { name: 'THE LEAKY ROOF KRAKEN', character: 'kraken' } }, { bossName: 'THE LEAKY ROOF KRAKEN' });
assert.equal(fight.trainer, B.rivalFor(3).name); assert.ok(!/KRAKEN/.test(JSON.stringify(fight)), 'no dungeon boss in Beasts');
assert.ok(!ov.includes('battle?.setRival') && !bg.includes('battle?.setRival'), 'no dungeon boss art as the rival');
assert.equal(B.placeFor({ id: 'vault', name: 'TREASURE VAULT' }).name, 'GOLDEN GROTTO', 'the path vote names places on the route');
assert.ok(ov.includes("options:d.doors.map(r=>({label:pl(r).icon+' '+pl(r).name}))"));
// 11. The kiosk look (2026-11-13: "like that"): white screen, black SOLD OUT bands, name and price under each, an app-style card and BID NOW; an empty machine still shows.
for (const k of ["(theme === 'gb' ? ' gb' : ' kiosk')", '.vm.kiosk .vm-stamp{', '<span class="vm-bigbid">BID NOW ››</span>', '<div class=\"vm-name\">', "vm.hidden = !(mc && mc.on && mine);", "'STOCKING UP -- BACK IN A SEC!'"]) assert.ok(vsrc.includes(k), k);
console.log('Vending machine, spots, the battle on the green screen, and the games kept apart: passed');
