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
  showUnlocks: '',     // lines "100: Shoutout to everyone in chat"
});
export const DUNGEON_LIMITS = { floorBase: [1, 1000000], floorGrowth: [0, 500], bossShare: [1, 500], manaFollow: [0, 1000], manaShare: [0, 1000], manaBookmark: [0, 1000], starsPerFloor: [0, 10], finaleBoost: [0, 500] };
export const DUNGEON_STRINGS = { floorRewards: 1200, showUnlocks: 1200 };

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
  return { week, floor: 1, phase: 'floor', mana: 0, bossHp: 0, stars: 0, cleared: [], taps: {}, lastAt: 0 };
}
// A new week (Wednesday) starts at floor 1; last week's result is kept.
export function ensureWeek(d, now = Date.now()) {
  const week = weekKey(now);
  if (d && d.week === week) return d;
  const fresh = emptyDungeon(week);
  if (d?.week) fresh.lastWeek = { week: d.week, floor: d.floor, stars: d.stars };
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
export const floorReward = (s, floor) => parseLines(s.floorRewards).find(x => x.n === floor)?.text || '';
export const tapMana = (s, kind) => kind === 'follow' ? Number(s.manaFollow) || 0 : kind === 'share' ? Number(s.manaShare) || 0 : kind === 'bookmark' ? Number(s.manaBookmark) || 0 : 0;

// Mana in: fills the floor, then (a full flask) brings out the boss, then
// drains its HP; beating it opens the next floor. Leftover mana carries on.
// Returns { dungeon, events } -- events in order: { kind:'floor' } (the
// boss appears) and { kind:'boss' } (floor cleared, next one unlocked).
export function addMana(dIn, amount, s, now = Date.now()) {
  const w = ensureWeek(dIn, now);
  let d = { ...w, cleared: [...(w.cleared || [])], taps: { ...(w.taps || {}) } };
  const events = [];
  if (!s.dungeonOn || !(amount > 0)) return { dungeon: d, events };
  let left = r2(amount);
  for (let guard = 0; left > 0 && guard < 60; guard++) {
    if (d.phase === 'floor') {
      const goal = floorGoal(s, d.floor, d), need = r2(goal - d.mana);
      if (left < need) { d.mana = r2(d.mana + left); left = 0; break; }
      left = r2(left - need); d.mana = goal; d.phase = 'boss'; d.bossHp = bossMax(s, d.floor, d);
      const id = bossForFloor(d.floor);
      events.push({ kind: 'floor', floor: d.floor, shed: shedFor(d.floor), bossCharacter: id, bossName: bossById(id).name });
    } else {
      if (left < d.bossHp) { d.bossHp = r2(d.bossHp - left); left = 0; break; }
      left = r2(left - d.bossHp); d.bossHp = 0;
      const cleared = d.floor, id = bossForFloor(cleared);
      d.stars += Number(s.starsPerFloor) || 0;
      d.cleared.push({ floor: cleared, at: now });
      d.floor = cleared + 1; d.phase = 'floor'; d.mana = 0;
      events.push({ kind: 'boss', floor: cleared, nextFloor: d.floor, shed: shedFor(d.floor), bossCharacter: id, bossName: bossById(id).name, reward: floorReward(s, cleared), stars: d.stars });
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
export function adjustDungeon(dIn, { floor, resetWeek } = {}, now = Date.now()) {
  const w = ensureWeek(dIn, now);
  if (resetWeek) { const fresh = emptyDungeon(w.week); if (w.lastWeek) fresh.lastWeek = w.lastWeek; return fresh; }
  if (floor !== undefined) {
    if (!Number.isInteger(floor) || floor < 1 || floor > 99) throw new Error('Invalid floor');
    return { ...w, floor, phase: 'floor', mana: 0, bossHp: 0, lastAt: now };
  }
  return w;
}
// Per-show unlocks crossed when the show's own sales went from before to after.
export const showUnlocksCrossed = (before, after, s) => parseLines(s.showUnlocks).filter(u => u.n > before && u.n <= after);

// What the overlay sees.
export function publicDungeon(dIn, s, showGross = 0, now = Date.now()) {
  const d = ensureWeek(dIn, now);
  const goal = floorGoal(s, d.floor, d), max = bossMax(s, d.floor, d), id = bossForFloor(d.floor);
  const unlocks = parseLines(s.showUnlocks).map(u => ({ at: u.n, text: u.text, done: showGross >= u.n }));
  return {
    on: !!s.dungeonOn, week: d.week, resets: nextResetKey(now), floor: d.floor, shed: shedFor(d.floor), phase: d.phase,
    mana: d.mana, goal, pct: d.phase === 'boss' ? Math.round(d.bossHp / max * 1000) / 10 : Math.round(Math.min(1, d.mana / goal) * 1000) / 10,
    boss: { character: id, name: bossById(id).name, hp: d.phase === 'boss' ? d.bossHp : max, max, active: d.phase === 'boss' },
    stars: d.stars, taps: { follow: d.taps?.follow || 0, share: d.taps?.share || 0, bookmark: d.taps?.bookmark || 0 }, finale: !!s.finale, reward: floorReward(s, d.floor), unlocks, nextUnlock: unlocks.find(u => !u.done) || null,
    lastWeek: d.lastWeek || null,
  };
}
