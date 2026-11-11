// The Shed Dungeon (store, 2026-11-04): "with the Whatnot live, I need the
// marquee sign with the bubbling mana to be the hype bar ... we will travel
// through dungeons and unlock more levels of the dungeon." The mana flask
// (the sign) fills with dollars spent plus the follows, shares and bookmarks
// the host taps in. A full flask brings out the floor's boss; sales and taps
// drain its HP; beating it earns stars, unlocks the floor's reward and opens
// the next floor -- deeper, bigger goal. Progress carries over all week and
// starts fresh every Wednesday (new comic book day). The finale show (the
// last before Wednesday) has bigger goals the more stars the week earned.
// Separately, per-show unlocks fire as a show's own sales pass set amounts.
// No chance anywhere: every unlock is a goal reached, never a draw.
import { BOSS_IDS, bossById } from './live-studio-bosses.mjs';

export const SHEDS = ['GARDEN SHED', 'RUSTY TOOL SHED', 'FLOODED SHED', 'HAUNTED POTTING SHED', 'RACCOON-INFESTED SHED', 'BURNT-OUT SHED', 'THE SHED BENEATH THE SHED'];
export const shedFor = floor => SHEDS[Math.min(Math.max(1, floor), SHEDS.length) - 1];
export const bossForFloor = floor => BOSS_IDS[(Math.max(1, floor) - 1) % BOSS_IDS.length];
export const DUNGEON_RESET_DAY = 3; // Wednesday
export const TAP_KINDS = ['follow', 'share', 'bookmark'];
// Chat picks the path (store, 2026-11-05: "more adventure and exploration"):
// after each boss two doors open; chat votes in Whatnot's chat and the host
// taps the winner. The room sets that floor's theme and reward. The two
// doors offered are fixed by the floor number -- a set order, never a draw.
export const ROOMS = [
  { id: 'vault', name: 'TREASURE VAULT', icon: '💰', blurb: '$1 starts glitter in the dark' },
  { id: 'library', name: 'BACK ISSUE LIBRARY', icon: '📚', blurb: 'long boxes, stacked to the ceiling' },
  { id: 'armory', name: 'SLAB ARMORY', icon: '🛡️', blurb: 'graded slabs on every wall' },
  { id: 'forge', name: 'PACK FORGE', icon: '🔥', blurb: 'sealed wax, still warm' },
  { id: 'crypt', name: 'DOLLAR BIN CRYPT', icon: '🕯️', blurb: 'forgotten gems in the bins' },
  { id: 'lab', name: 'VARIANT LAB', icon: '🧪', blurb: 'covers you have never seen' },
];
export const roomById = id => ROOMS.find(r => r.id === id) || null;
export const doorsFor = floor => [ROOMS[(2 * (floor - 2)) % ROOMS.length], ROOMS[(2 * (floor - 2) + 1) % ROOMS.length]].map(r => r.id);
// Every boss drops a relic: it sits on the overlay's shelf all week.
// Original items, one per floor in order.
export const RELICS = [
  { name: 'RUSTY TROWEL', icon: '🪏' }, { name: 'BENT PRICE GUN', icon: '🔫' }, { name: 'SOGGY LONG BOX', icon: '📦' },
  { name: 'HAUNTED SEED PACKET', icon: '👻' }, { name: 'RACCOON CROWN', icon: '👑' }, { name: 'SCORCHED SLAB', icon: '🔥' },
  { name: 'KEY TO THE SHED BELOW', icon: '🗝️' }, { name: 'GOLDEN BAG & BOARD', icon: '🏆' }, { name: 'MANA POCKET WATCH', icon: '⌚' },
  { name: 'CRYSTAL TOPLOADER', icon: '💎' },
];
export const relicFor = floor => RELICS[(Math.max(1, floor) - 1) % RELICS.length];
// Chat picks the hero's weapon for the floor's boss (store, 2026-11-11: "let
// the chat pick things"). Looks and sound only -- every weapon hits for the
// sale's dollars; nothing is random.
export const WEAPONS = [
  { id: 'pricegun', name: 'PRICE GUN', icon: '🔫', hit: 'PEW!' },
  { id: 'fireball', name: 'FIREBALL', icon: '🔥', hit: 'FWOOSH!' },
  { id: 'chicken', name: 'RUBBER CHICKEN', icon: '🐔', hit: 'SQUAWK!' },
  { id: 'longbox', name: 'LONG BOX SLAM', icon: '📦', hit: 'THWACK!' },
];
export const weaponById = id => WEAPONS.find(w => w.id === id) || null;

// Settings (merged into DEFAULT_STUDIO).
export const DUNGEON_DEFAULTS = Object.freeze({
  dungeonOn: true,
  floorBase: 100,      // floor 1's mana goal ($)
  floorGrowth: 25,     // each floor needs this % more
  bossShare: 50,       // a floor's boss has this % of the floor goal as HP
  manaFollow: 5, manaShare: 5, manaBookmark: 2,
  starsPerFloor: 1,
  finale: false,       // tonight is the week's finale
  finaleBoost: 10,     // finale goals: +this % for each star the week earned
  floorRewards: '',    // lines "3: Free giveaway in the Whatnot tool"
  roomRewards: '',     // lines "vault: $1 start on a grail" (a room's reward when a floor has none)
  showMap: true,       // the dungeon map + relic shelf panel
  centerStage: true,   // the big mana bar across the middle, the boss standing on it (2026-11-11)
  mapX: 800, mapY: 330,
  showUnlocks: '',     // lines "100: Shoutout to everyone in chat"
  chestGoals: '',      // treasure chests: lines "10 follows: Free giveaway in the Whatnot tool"
});
export const DUNGEON_LIMITS = { mapX: [0, 900], mapY: [0, 1700], floorBase: [1, 1000000], floorGrowth: [0, 500], bossShare: [1, 500], manaFollow: [0, 1000], manaShare: [0, 1000], manaBookmark: [0, 1000], starsPerFloor: [0, 10], finaleBoost: [0, 500] };
export const DUNGEON_STRINGS = { floorRewards: 1200, showUnlocks: 1200, roomRewards: 1200, chestGoals: 1200 };
// TREASURE CHESTS (store, 2026-11-11: "add treasure chests that open when chat
// hits a goal"). Goals are chat's follows, shares and bookmarks this week (or
// all three as "taps") -- never sales or what anyone spends -- and each
// chest's reward is the line the store wrote, for everyone watching. Fixed,
// listed rewards; nothing is drawn.
const CHEST_KINDS = { follow: 'follow', follows: 'follow', share: 'share', shares: 'share', bookmark: 'bookmark', bookmarks: 'bookmark', tap: 'tap', taps: 'tap' };
export function parseChestLines(text) {
  return String(text || '').split(/\r?\n/).map(l => l.match(/^\s*(\d{1,5})\s*([a-z]+)\s*[:=\-–]\s*(.+?)\s*$/i)).filter(m => m && CHEST_KINDS[m[2].toLowerCase()] && Number(m[1]) > 0)
    .slice(0, 6).map(m => ({ n: Number(m[1]), kind: CHEST_KINDS[m[2].toLowerCase()], text: m[3].slice(0, 120) }));
}
export function chestsOf(s, d = {}) {
  const t = d.taps || {}, total = (t.follow || 0) + (t.share || 0) + (t.bookmark || 0);
  return parseChestLines(s.chestGoals).map(c => { const have = c.kind === 'tap' ? total : (t[c.kind] || 0); return { ...c, have: Math.min(have, c.n), open: have >= c.n }; });
}
// The chests a tap just opened.
export const chestsOpened = (before, after, s) => { const a = chestsOf(s, before); return chestsOf(s, after).filter((c, i) => c.open && !a[i]?.open); };

const r2 = n => Math.round(n * 100) / 100;
function pacificParts(at) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date(at)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
// The week's key: the Pacific date of its Wednesday ("2026-11-04").
export function weekKey(now = Date.now()) {
  const p = pacificParts(now);
  const back = (p.dow - DUNGEON_RESET_DAY + 7) % 7;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d - back));
  return t.toISOString().slice(0, 10);
}
export function nextResetKey(now = Date.now()) {
  const t = new Date(weekKey(now) + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 7);
  return t.toISOString().slice(0, 10);
}
export function emptyDungeon(week = weekKey()) {
  return { week, floor: 1, phase: 'floor', mana: 0, bossHp: 0, stars: 0, cleared: [], taps: {}, rooms: {}, doors: null, lastAt: 0 };
}
// A new week (Wednesday) starts at floor 1; last week's result is kept.
export function ensureWeek(d, now = Date.now()) {
  const week = weekKey(now);
  if (d && d.week === week) return d;
  const fresh = emptyDungeon(week);
  if (d?.week) fresh.lastWeek = { week: d.week, floor: d.floor, stars: d.stars, relics: (d.cleared || []).length };
  return fresh;
}
// "3: Free giveaway" lines -> [{ n:3, text }], sorted.
export function parseLines(text) {
  return String(text || '').split(/\r?\n/).map(l => l.match(/^\s*\$?\s*(\d+(?:\.\d+)?)\s*[:=\-–]\s*(.+?)\s*$/)).filter(Boolean)
    .map(m => ({ n: Number(m[1]), text: m[2].slice(0, 120) })).filter(x => x.n > 0).sort((a, b) => a.n - b.n);
}
export function floorGoal(s, floor, d = {}) {
  const base = Number(s.floorBase) || 100, g = Number(s.floorGrowth) || 0;
  const finale = s.finale ? 1 + (Number(s.finaleBoost) || 0) / 100 * (Number(d.stars) || 0) : 1;
  return Math.max(1, Math.round(base * Math.pow(1 + g / 100, Math.max(0, floor - 1)) * finale));
}
export const bossMax = (s, floor, d) => Math.max(1, Math.round(floorGoal(s, floor, d) * (Number(s.bossShare) || 50) / 100));
// "vault: $1 start" lines -> { vault: '$1 start' }.
export function parseRoomLines(text) {
  const out = {};
  for (const l of String(text || '').split(/\r?\n/)) { const m = l.match(/^\s*([a-z]+)\s*[:=\-–]\s*(.+?)\s*$/i); if (m && roomById(m[1].toLowerCase())) out[m[1].toLowerCase()] = m[2].slice(0, 120); }
  return out;
}
// A floor's reward: its own line, else its room's.
export const floorReward = (s, floor, d = {}) => parseLines(s.floorRewards).find(x => x.n === floor)?.text || (d.rooms?.[floor] ? parseRoomLines(s.roomRewards)[d.rooms[floor]] || '' : '');
export const tapMana = (s, kind) => kind === 'follow' ? Number(s.manaFollow) || 0 : kind === 'share' ? Number(s.manaShare) || 0 : kind === 'bookmark' ? Number(s.manaBookmark) || 0 : 0;

// Mana in: fills the floor, then (a full flask) brings out the boss, then
// drains its HP; beating it opens the next floor. Leftover mana carries on.
// Returns { dungeon, events } -- events in order: { kind:'floor' } (the
// boss appears) and { kind:'boss' } (floor cleared, next one unlocked).
export function addMana(dIn, amount, s, now = Date.now()) {
  const w = ensureWeek(dIn, now);
  let d = { ...w, cleared: [...(w.cleared || [])], taps: { ...(w.taps || {}) }, rooms: { ...(w.rooms || {}) } };
  const events = [];
  if (!s.dungeonOn || !(amount > 0)) return { dungeon: d, events };
  let left = r2(amount);
  for (let guard = 0; left > 0 && guard < 60; guard++) {
    if (d.phase === 'floor') {
      const goal = floorGoal(s, d.floor, d), need = r2(goal - d.mana);
      if (left < need) { d.mana = r2(d.mana + left); left = 0; break; }
      left = r2(left - need); d.mana = goal; d.phase = 'boss'; d.bossHp = bossMax(s, d.floor, d);
      // Chat didn't pick in time: the first door it is (stated on the overlay).
      if (d.doors?.length) { d.rooms[d.floor] = d.doors[0]; d.doors = null; events.push({ kind: 'room', floor: d.floor, room: d.rooms[d.floor], auto: true }); }
      const id = bossForFloor(d.floor);
      events.push({ kind: 'floor', floor: d.floor, shed: shedFor(d.floor), bossCharacter: id, bossName: bossById(id).name });
    } else {
      if (left < d.bossHp) { d.bossHp = r2(d.bossHp - left); left = 0; break; }
      left = r2(left - d.bossHp); d.bossHp = 0;
      const cleared = d.floor, id = bossForFloor(cleared);
      d.stars += Number(s.starsPerFloor) || 0;
      const relic = relicFor(cleared);
      d.cleared.push({ floor: cleared, at: now, room: d.rooms[cleared] || '' });
      d.floor = cleared + 1; d.phase = 'floor'; d.mana = 0; d.doors = doorsFor(d.floor);
      events.push({ kind: 'boss', floor: cleared, nextFloor: d.floor, shed: shedFor(d.floor), bossCharacter: id, bossName: bossById(id).name, reward: floorReward(s, cleared, d), stars: d.stars, relic: relic.name, relicIcon: relic.icon, doors: d.doors });
    }
  }
  d.lastAt = now;
  return { dungeon: d, events };
}
// A follow / share / bookmark the host tapped in.
export function addTap(dIn, kind, s, now = Date.now()) {
  if (!TAP_KINDS.includes(kind)) throw new Error('Invalid tap');
  const w = ensureWeek(dIn, now), taps = { ...(w.taps || {}) };
  taps[kind] = (taps[kind] || 0) + 1;
  const amount = tapMana(s, kind);
  return { ...addMana({ ...w, taps }, amount, s, now), amount };
}
// The host's fixes: set the floor, or start the week over.
export function adjustDungeon(dIn, { floor, resetWeek, door, weapon } = {}, now = Date.now()) {
  const w = ensureWeek(dIn, now);
  // The weapon chat picked for this floor.
  if (weapon !== undefined) {
    if (!weaponById(weapon)) throw new Error('Invalid weapon');
    return { ...w, weapons: { ...(w.weapons || {}), [w.floor]: weapon }, lastAt: now };
  }
  // The door chat voted for (0 or 1) sets this floor's room.
  if (door !== undefined) {
    if (!w.doors?.length) throw new Error('Invalid door: no doors are open right now');
    if (door !== 0 && door !== 1) throw new Error('Invalid door');
    return { ...w, rooms: { ...(w.rooms || {}), [w.floor]: w.doors[door] }, doors: null, lastAt: now };
  }
  if (resetWeek) { const fresh = emptyDungeon(w.week); if (w.lastWeek) fresh.lastWeek = w.lastWeek; return fresh; }
  if (floor !== undefined) {
    if (!Number.isInteger(floor) || floor < 1 || floor > 99) throw new Error('Invalid floor');
    return { ...w, floor, phase: 'floor', mana: 0, bossHp: 0, doors: floor > 1 && !w.rooms?.[floor] ? doorsFor(floor) : null, lastAt: now };
  }
  return w;
}
// Per-show unlocks crossed when the show's own sales went from before to after.
export const showUnlocksCrossed = (before, after, s) => parseLines(s.showUnlocks).filter(u => u.n > before && u.n <= after);

const roomPublic = id => { const r = roomById(id); return r ? { id: r.id, name: r.name, icon: r.icon, blurb: r.blurb } : null; };
// The map: the floors around this one, the next still dark.
function mapOf(d) {
  const out = [];
  // The floor ahead, this one and up to three behind (the relic shelf keeps the rest).
  const last = Math.max(d.floor + 1, 4);
  for (let f = Math.max(1, last - 4); f <= last; f++) {
    const r = roomById(d.rooms?.[f]);
    out.push({ floor: f, shed: shedFor(f), room: r ? r.name : '', icon: r ? r.icon : '', cleared: f < d.floor, current: f === d.floor, dark: f > d.floor });
  }
  return out;
}
// What the overlay sees.
export function publicDungeon(dIn, s, showGross = 0, now = Date.now()) {
  const d = ensureWeek(dIn, now);
  const goal = floorGoal(s, d.floor, d), max = bossMax(s, d.floor, d), id = bossForFloor(d.floor);
  const unlocks = parseLines(s.showUnlocks).map(u => ({ at: u.n, text: u.text, done: showGross >= u.n }));
  return {
    on: !!s.dungeonOn, week: d.week, resets: nextResetKey(now), floor: d.floor, shed: shedFor(d.floor), phase: d.phase,
    mana: d.mana, goal, pct: d.phase === 'boss' ? Math.round(d.bossHp / max * 1000) / 10 : Math.round(Math.min(1, d.mana / goal) * 1000) / 10,
    boss: { character: id, name: bossById(id).name, hp: d.phase === 'boss' ? d.bossHp : max, max, active: d.phase === 'boss' },
    weapon: weaponById(d.weapons?.[d.floor]) || null,
    room: roomPublic(d.rooms?.[d.floor]), doors: d.doors?.length ? d.doors.map(roomPublic) : null,
    map: mapOf(d), relics: (d.cleared || []).map(c => ({ floor: c.floor, ...relicFor(c.floor) })),
    chests: chestsOf(s, d),
    stars: d.stars, taps: { follow: d.taps?.follow || 0, share: d.taps?.share || 0, bookmark: d.taps?.bookmark || 0 }, finale: !!s.finale, reward: floorReward(s, d.floor, d), unlocks, nextUnlock: unlocks.find(u => !u.done) || null,
    lastWeek: d.lastWeek || null,
  };
}
