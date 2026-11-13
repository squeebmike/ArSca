import { BOSS_IDS } from './live-studio-bosses.mjs';
import { MASCOT_STATES } from './byterider.mjs';
import { DUNGEON_DEFAULTS, DUNGEON_LIMITS, DUNGEON_STRINGS, TAP_KINDS, roomById } from './live-studio-dungeon.mjs';
// Live Studio: the OBS overlay for Whatnot shows. 90s comic + arcade look
// (store, 2026-11-01: "I want 90s comic. Arcade style").
//
// Whatnot rules this stays inside (store: "Lets make sure we dont get in
// trouble for doing things whatnot doesnt like. Ie gambling"):
//  - nothing on it is a game of chance: no wheels, slots, spins, random
//    pulls or "jackpot" draws, and no words for them in the sign;
//  - no prize is tied to buying or to how much someone spends -- the boss
//    battle's reward is something for everyone watching (a $1 start, a box
//    opened on stream, a free Whatnot giveaway), never a buyers-only prize;
//  - no buyer leaderboard ("top spender"), and buyer usernames stay off
//    unless the store turns them on;
//  - giveaways run in Whatnot's own giveaway tool; the overlay only shows
//    the banner and the winner Whatnot picked.
// Whatnot doesn't share live bids. It does send each order as it's made, so
// the overlay keeps the show's money total, items sold and biggest sale.
export const DEFAULT_STUDIO = Object.freeze({
  message: 'THE MANA POCKET • INSERT COIN', x: 190, y: 850, width: 700, height: 120,
  speed: 16, volume: 35, muted: true, visible: true, countdownSeconds: 5,
  automatic: false, sellerId: '', showId: '', jackpotAmount: 100, currency: 'USD',
  // Score board (top) and boss bar.
  showHud: true, hudY: 40,
  // bossCharacter: one of the original villains in live-studio-bosses.mjs.
  showBoss: true, bossCharacter: 'scalper', bossName: 'THE SCALPER', bossGoal: 500, bossReward: '$1 START ON THE GRAIL!',
  // Now playing card + next up.
  showCard: true, cardX: 40, cardY: 1340, showQueue: true,
  // Big photo: the now playing card fills the bottom camera with the item's
  // photo (store: "display the book we auction's image ... on the bottom cam").
  bigArt: false, bigArtY: 1000,
  // When an auction sells, NOW PLAYING moves to the next item lined up.
  autoAdvance: true,
  // ByteRider_97, the mascot (scripts/byterider.mjs): the screen is his monitor.
  // mascotFaceY: where his face's center sits; mascotScale: its size (%);
  // mascotBorder: his bezel round the frame; mascotIdleFace: a faint face
  // stays up between reactions (off: the cameras are clear).
  mascotOn: true, mascotFaceY: 900, mascotScale: 100, mascotBorder: true, mascotIdleFace: false,
  // The marquee (store: "I need ByteRider to say all the stuff from the
  // marquee. Toggle to turn off the marquee"): marqueeOn shows the scrolling
  // text on the sign; mascotSaysMarquee has ByteRider say its lines (split at
  // • or |), one every mascotSayEvery seconds when he isn't busy.
  marqueeOn: true, mascotSaysMarquee: false, mascotSayEvery: 45,
  // ByteRider's sounds (chiptune blips, under the overlay's volume and mute)
  // and the hype meter (store, 2026-11-02: "do sounds and hype meter").
  mascotSounds: true, showHype: true,
  // Boss look: 'ps1' (store, 2026-11-04: "animated and PS1 graphics") or 'n64'.
  bossStyle: 'ps1',
  showCombo: true, showBuyerNames: false, attract: true,
  panelAlpha: 70, // panel backgrounds' opacity (%): the score board, card, queue and map let the cameras show through
  // The Shed Dungeon (scripts/live-studio-dungeon.mjs): the sign is the mana flask.
  ...DUNGEON_DEFAULTS,
});
// mascot: a ByteRider_97 reaction or line from the dashboard (no burst).
export const EFFECTS = ['coin', 'jackpot', 'countdown', 'sold', 'ready', 'gameover', 'clear', 'boss', 'giveaway', 'winner', 'mascot', 'floor', 'unlock', 'tap', 'room', 'chest', 'found', 'trivia', 'move', 'beast'];
export const EFFECT_LABELS = { coin: 'INSERT COIN', jackpot: 'BIG HIT!', countdown: 'COUNTDOWN', sold: 'SOLD!', ready: 'PLAYER 1 READY', gameover: 'GAME OVER', clear: 'CLEAR', boss: 'BOSS DEFEATED!', giveaway: 'FREE GIVEAWAY!', winner: 'GIVEAWAY WINNER!', mascot: 'BYTERIDER_97', floor: 'FLOOR CLEARED!', unlock: 'UNLOCKED!', tap: 'MANA!', room: 'CHAT PICKED A DOOR!', chest: 'TREASURE CHEST!', found: 'FOUND IT!', trivia: 'TRIVIA!', beast: 'LONG BOX BEASTS!' };
// Comic sound effects for a sale (a cycle, not chance -- the next one in line).
export const SOUND_WORDS = ['POW!', 'BAM!', 'KRAK!', 'ZAP!', 'BLAM!', 'WHAM!', 'KA-CHING!', 'THWIP!', 'SNIKT!', 'BOOM!'];
// Words for games of chance / raffles: not allowed on the sign or the boss reward.
const CHANCE_WORDS = /\b(raffles?|lotter(?:y|ies)|lotto|sweepstakes?|spin(?:s|ning)?\s+the\s+wheel|wheel\s+spin|slots?\s+machine|slot\s+pull|gambl(?:e|ing)|bets?|betting|wager|roulette|casino|scratch(?:er|\s+off)|lucky\s+draw|chance\s+to\s+win|buy\s+(?:to|for\s+a\s+chance\s+to)\s+win|purchase\s+to\s+(?:enter|win))\b/i;
export const COMBO_WINDOW_MS = 90 * 1000;
const STRINGS = { message: 300, bossReward: 120, bossName: 40, ...DUNGEON_STRINGS };

// The marquee's lines, as ByteRider says them.
export function marqueeLines(message) {
  return String(message || '').split(/\s*[•|]\s*/).map(l => l.trim()).filter(Boolean).slice(0, 30);
}
// The hype meter: each sale fills it (a big hit or the boss K.O. by two),
// every 20 quiet seconds it drains one, five is OVERDRIVE. ByteRider's mood
// follows it: happy, happy, excited, dizzy, then glitching.
export const HYPE_MAX = 5, HYPE_DECAY_MS = 20000;
export const HYPE_MOOD = ['idle', 'happy', 'happy', 'excited', 'dizzy', 'glitch'];
export function hypeNow(h, now = Date.now()) {
  if (!h || !(h.level > 0)) return { level: 0, at: now };
  const drops = Math.floor((now - h.at) / HYPE_DECAY_MS);
  return drops > 0 ? { level: Math.max(0, h.level - drops), at: h.at + drops * HYPE_DECAY_MS } : h;
}
export function hypeAfterSale(h, { big = false } = {}, now = Date.now()) {
  return { level: Math.min(HYPE_MAX, hypeNow(h, now).level + (big ? 2 : 1)), at: now };
}
export function chanceWordIn(text) {
  const m = String(text || '').match(CHANCE_WORDS);
  return m ? m[0] : '';
}
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings required');
  const out = {};
  const limits = { x:[0,1080], y:[0,1920], width:[240,1080], height:[70,300], speed:[4,60], volume:[0,100], countdownSeconds:[3,15], jackpotAmount:[1,1000000],
    hudY:[0,1700], bossGoal:[1,10000000], cardX:[0,700], cardY:[0,1560], bigArtY:[0,1400], mascotFaceY:[250,1650], mascotScale:[40,150], mascotSayEvery:[10,600], panelAlpha:[0,100], ...DUNGEON_LIMITS };
  for (const [key,value] of Object.entries(input)) {
    if (!(key in DEFAULT_STUDIO)) throw new Error('Unknown setting: ' + key);
    if (limits[key]) {
      const [min,max] = limits[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid ' + key);
    } else if (typeof DEFAULT_STUDIO[key] === 'boolean') {
      if (typeof value !== 'boolean') throw new Error('Invalid ' + key);
    } else if (typeof value !== 'string' || value.length > (STRINGS[key] || 120)) throw new Error('Invalid ' + key);
    out[key] = value;
  }
  const full = { ...DEFAULT_STUDIO, ...out };
  if (full.x + full.width > 1080 || full.y + full.height > 1920) throw new Error('Sign must fit within 1080 × 1920');
  if (!/^[A-Z]{3}$/.test(full.currency)) throw new Error('Use a three-letter currency');
  if (!BOSS_IDS.includes(full.bossCharacter)) throw new Error('Invalid bossCharacter');
  if (!['ps1', 'n64'].includes(full.bossStyle)) throw new Error('Invalid bossStyle');
  if (!['dungeon', 'beasts'].includes(full.gameMode)) throw new Error('Invalid gameMode');
  if (!['overlay', 'green'].includes(full.beastsBattle)) throw new Error('Invalid beastsBattle');
  for (const k of ['beastsFace', 'beastsBuddy']) if (full[k] && !/^[0-3]{144}$/.test(full[k])) throw new Error('Invalid ' + k);
  if (full.automatic && !full.showId.trim()) throw new Error('A Whatnot show is required for automatic effects (IDs from USE LIVE / NEXT SHOW)');
  const WHERE = { beastsMoves: 'attacks', message: 'sign', bossReward: 'boss reward', bossName: 'boss name', floorRewards: 'floor rewards', showUnlocks: 'show unlocks', roomRewards: 'room rewards', chestGoals: 'treasure chests' };
  for (const key of Object.keys(WHERE)) {
    const word = chanceWordIn(full[key]);
    if (word) throw new Error(`"${word}" reads as a game of chance -- Whatnot doesn't allow those. Reword the ${WHERE[key]}.`);
  }
  return out;
}

const money = v => { const n = Number(v?.amount ?? v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
export function emptyStats(showId = '') {
  return { showId, gross: 0, sold: 0, giveaways: 0, biggest: 0, combo: 0, lastSaleAt: 0, defeatedAt: 0, orders: {}, recent: [] };
}
// One Whatnot order (an orders.created / orders.updated event's data) into
// the show's running totals. Returns the effect to play, if any.
export function applyOrder(stats, order, settings, now = Date.now()) {
  if (!order?.id || order.show_id !== settings.showId) return { stats, effect: null };
  if (stats.showId !== settings.showId) stats = emptyStats(settings.showId);
  stats = { ...stats, orders: { ...stats.orders }, recent: [...stats.recent] };
  const id = String(order.id), status = String(order.status || '');
  const before = stats.orders[id];
  const giveaway = order.transaction_type === 'giveaway' || !(money(order.amounts?.subtotal) > 0);
  if (status === 'cancelled' || status === 'failed') {
    if (before && !before.cancelled) {
      if (before.giveaway) stats.giveaways = Math.max(0, stats.giveaways - 1);
      else { stats.gross = Math.max(0, Math.round((stats.gross - before.amount) * 100) / 100); stats.sold = Math.max(0, stats.sold - 1); }
      stats.orders[id] = { ...before, cancelled: true };
      stats.biggest = Object.values(stats.orders).filter(o => !o.cancelled && !o.giveaway).reduce((m, o) => Math.max(m, o.amount), 0);
    }
    return { stats, effect: null };
  }
  if (before) return { stats, effect: null };
  const amount = giveaway ? 0 : money(order.amounts?.subtotal);
  const buyer = settings.showBuyerNames ? String(order.buyer?.username || '').slice(0, 30) : '';
  stats.orders[id] = { amount, giveaway, at: now };
  if (giveaway) {
    stats.giveaways++;
    return { stats, effect: { kind: 'winner', buyer } };
  }
  const wasAlive = stats.gross < settings.bossGoal;
  stats.gross = Math.round((stats.gross + amount) * 100) / 100;
  stats.sold++;
  stats.combo = now - stats.lastSaleAt <= COMBO_WINDOW_MS ? stats.combo + 1 : 1;
  stats.lastSaleAt = now;
  const record = amount > stats.biggest && stats.sold > 1;
  stats.biggest = Math.max(stats.biggest, amount);
  stats.recent = [{ amount, at: now }, ...stats.recent].slice(0, 5);
  const word = SOUND_WORDS[(stats.sold - 1) % SOUND_WORDS.length];
  const base = { amount, word, combo: stats.combo, buyer, record, auction: order.transaction_type === 'auction' };
  // With the dungeon on, its floor boss (not the show's boss bar) is the fight.
  if (!settings.dungeonOn && settings.showBoss && wasAlive && stats.gross >= settings.bossGoal) {
    stats.defeatedAt = now;
    return { stats, effect: { kind: 'boss', ...base } };
  }
  return { stats, effect: { kind: amount >= settings.jackpotAmount ? 'jackpot' : 'sold', ...base } };
}
// Whatnot's API can't start or run live auctions (they're run in Whatnot's
// app). What it can do: when an auction sells, the next item lined up here
// becomes NOW PLAYING. Buy It Now sales (the shop sells all day) don't move it.
export function advanceStage(stage, order, settings) {
  if (!settings.autoAdvance || order?.transaction_type !== 'auction' || !stage?.next?.length) return null;
  const [now, ...next] = stage.next;
  return { now, next };
}
// Rebuilt from Whatnot's own order list (SYNC TOTALS, or a missed webhook).
export function statsFromOrders(orders, settings, now = Date.now()) {
  let stats = emptyStats(settings.showId);
  const sorted = [...(orders || [])].filter(o => o.show_id === settings.showId).sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  for (const o of sorted) stats = applyOrder(stats, o, { ...settings, showBuyerNames: false }, Date.parse(o.created_at || '') || now).stats;
  // A rebuild isn't a run of sales happening now.
  stats.combo = 0; stats.lastSaleAt = 0;
  if (stats.gross >= settings.bossGoal && !stats.defeatedAt) stats.defeatedAt = now;
  return stats;
}
// What the overlay sees: totals only, never the order list or buyers.
export function publicStats(stats, settings) {
  const s = stats && stats.showId === settings.showId ? stats : emptyStats(settings.showId);
  const hp = Math.max(0, settings.bossGoal - s.gross);
  // When the show's first sale came in (the crawl's morning-to-night clock).
  let startedAt = 0; for (const o of Object.values(s.orders || {})) if (o.at && (!startedAt || o.at < startedAt)) startedAt = o.at;
  return { gross: s.gross, sold: s.sold, giveaways: s.giveaways, biggest: s.biggest, combo: s.combo, lastSaleAt: s.lastSaleAt, startedAt,
    boss: { character: settings.bossCharacter, name: settings.bossName, goal: settings.bossGoal, hp, pct: Math.round(hp / settings.bossGoal * 1000) / 10, defeated: hp <= 0, reward: settings.bossReward } };
}

// Now playing + next up, set from the dashboard.
const cleanText = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const cleanUrl = v => { const s = String(v || '').trim(); return /^https:\/\/[^\s"'<>]{1,600}$/.test(s) ? s : ''; };
export function validateStage(input) {
  if (!input || typeof input !== 'object') throw new Error('Stage required');
  const item = v => v && typeof v === 'object' ? { title: cleanText(v.title, 90), detail: cleanText(v.detail, 90), image: cleanUrl(v.image), price: money(v.price), ...(/^[0-9a-f-]{36}$/i.test(String(v.id || '')) ? { id: String(v.id) } : {}), ...(['comic', 'sealed', 'card'].includes(v.kind) ? { kind: v.kind } : {}) } : null;
  const now = item(input.now);
  const next = Array.isArray(input.next) ? input.next.slice(0, 60).map(item).filter(x => x && x.title) : [];
  for (const t of [now?.title, now?.detail, ...next.map(n => n.title)]) { const w = chanceWordIn(t); if (w) throw new Error(`"${w}" reads as a game of chance -- Whatnot doesn't allow those.`); }
  return { now: now && now.title ? now : null, next };
}

// Only signed, recent v2 events for the selected show can animate.
// No inventory writes, individual bids, or inferred auction timers.
export function eventIsFresh(event, settings, now = Date.now()) {
  if (!settings.automatic || event?.version !== 'v2') return false;
  if (settings.sellerId && event.seller_id !== settings.sellerId) return false;
  const at = Date.parse(event.timestamp);
  return Number.isFinite(at) && at <= now + 30000 && now - at <= 60000 && event.data?.show_id === settings.showId;
}
export function whatnotEffect(event, settings, now = Date.now()) {
  if (!eventIsFresh(event, settings, now)) return null;
  const at = Date.parse(event.timestamp), d = event.data;
  if (event.type === 'shows.started') return { kind:'ready', at };
  if (event.type === 'shows.ended') return { kind:'gameover', at };
  if (event.type !== 'orders.created' || d.transaction_type !== 'auction' || d.status !== 'pending_fulfillment') return null;
  const amount = d.amounts?.subtotal;
  const big = amount?.currency === settings.currency && Number.isFinite(Number(amount.amount)) && Number(amount.amount) >= settings.jackpotAmount;
  return { kind: big ? 'jackpot' : 'sold', at };
}
const DURATION = { countdown: 0, clear: 0, boss: 9000, jackpot: 6500, winner: 7000, giveaway: 8000, mascot: 4000, floor: 8000, unlock: 7000, tap: 2500, room: 6000, chest: 8000, found: 8000, trivia: 7000, beast: 7000 };
export function makeEffect(kind, settings, now = Date.now(), extra = {}) {
  if (!EFFECTS.includes(kind)) throw new Error('Unknown effect');
  const length = kind === 'countdown' ? settings.countdownSeconds * 1000 + 1200 : DURATION[kind] ?? 5000;
  const safe = {};
  if (Number.isFinite(extra.amount)) safe.amount = extra.amount;
  if (typeof extra.word === 'string') safe.word = extra.word.slice(0, 12);
  if (Number.isFinite(extra.combo)) safe.combo = extra.combo;
  if (typeof extra.buyer === 'string' && extra.buyer) safe.buyer = extra.buyer.slice(0, 30);
  if (extra.record) safe.record = true;
  const txt = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  if (kind === 'boss') {
    // A dungeon floor's boss carries its own name, floor and reward.
    if (extra.dungeon) { safe.dungeon = true; safe.reward = txt(extra.reward, 120); safe.bossName = txt(extra.bossName, 40); safe.bossCharacter = BOSS_IDS.includes(extra.bossCharacter) ? extra.bossCharacter : settings.bossCharacter; }
    else { safe.reward = settings.bossReward; safe.bossName = settings.bossName; safe.bossCharacter = settings.bossCharacter; }
  }
  if (kind === 'floor') { safe.bossName = txt(extra.bossName, 40); safe.bossCharacter = BOSS_IDS.includes(extra.bossCharacter) ? extra.bossCharacter : settings.bossCharacter; }
  if (kind === 'unlock') safe.unlockText = txt(extra.unlockText, 120);
  if (kind === 'chest') { safe.chestText = txt(extra.chestText, 120); safe.chestGoal = txt(extra.chestGoal, 40); }
  // A lineup item revealed (a chest, or where chat said to dig): its photo spins on screen.
  if (extra.item && typeof extra.item === 'object') { const im = String(extra.item.image || ''); safe.item = { title: txt(extra.item.title, 90), image: /^https:\/\/[^\s"'<>]{1,600}$/.test(im) ? im : '', price: Number.isFinite(Number(extra.item.price)) ? Number(extra.item.price) : 0 }; }
  if (kind === 'found') safe.spot = txt(extra.spot, 40);
  if (kind === 'move') safe.move = txt(extra.move, 16).toUpperCase();
  // Beasts' own moments: a wild beast beaten, the rival steps up, a badge won.
  if (kind === 'beast') { safe.beastEvent = ['caught', 'rival', 'badge'].includes(extra.beastEvent) ? extra.beastEvent : 'caught'; safe.beastName = txt(extra.beastName, 16).toUpperCase(); safe.trainer = txt(extra.trainer, 20).toUpperCase(); for (const k of ['route', 'badges']) if (Number.isFinite(extra[k])) safe[k] = extra[k]; }
  if (kind === 'found' && Number.isInteger(extra.lockbox)) safe.lockbox = extra.lockbox;
  if (kind === 'trivia') { safe.answer = txt(extra.answer, 80); safe.who = txt(extra.who, 30); }
  if (TAP_KINDS.includes(extra.tapKind)) safe.tapKind = extra.tapKind;
  for (const k of ['floor', 'nextFloor', 'stars', 'mana', 'unlockAt']) if (Number.isFinite(extra[k])) safe[k] = extra[k];
  if (typeof extra.shed === 'string') safe.shed = txt(extra.shed, 40);
  // Rooms, doors and relics (the dungeon's fixed lists -- ids only in, names out).
  if (roomById(extra.room)) safe.room = extra.room;
  if (Array.isArray(extra.doors)) safe.doors = extra.doors.filter(id => roomById(id)).slice(0, 2);
  if (typeof extra.relic === 'string') { safe.relic = txt(extra.relic, 40); safe.relicIcon = txt(extra.relicIcon, 4); }
  if (extra.auto) safe.auto = true;
  if (kind === 'mascot') {
    if (!MASCOT_STATES.includes(extra.mascotState)) throw new Error('Unknown ByteRider reaction');
    safe.mascotState = extra.mascotState;
    const say = String(extra.say || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
    const word = chanceWordIn(say);
    if (word) throw new Error(`"${word}" reads as a game of chance -- Whatnot doesn't allow those.`);
    if (say) safe.say = say;
  }
  return { id:crypto.randomUUID(), kind, startsAt:now, endsAt:now + length, ...safe };
}
export async function digestToken(token) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b=>b.toString(16).padStart(2,'0')).join('');
}
