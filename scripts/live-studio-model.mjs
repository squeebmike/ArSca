export const DEFAULT_STUDIO = Object.freeze({
  message: 'THE MANA POCKET • INSERT COIN', x: 190, y: 850, width: 700, height: 120,
  speed: 16, volume: 35, muted: true, visible: true, countdownSeconds: 5,
  automatic: false, sellerId: '', showId: '', jackpotAmount: 100, currency: 'USD'
});
export const EFFECTS = ['coin', 'jackpot', 'countdown', 'sold', 'ready', 'gameover', 'clear'];
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings required');
  const out = {};
  const limits = { x:[0,1080], y:[0,1920], width:[240,1080], height:[70,300], speed:[4,60], volume:[0,100], countdownSeconds:[3,15], jackpotAmount:[1,1000000] };
  for (const [key,value] of Object.entries(input)) {
    if (!(key in DEFAULT_STUDIO)) throw new Error('Unknown setting: ' + key);
    if (limits[key]) {
      const [min,max] = limits[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid ' + key);
    } else if (typeof DEFAULT_STUDIO[key] === 'boolean') {
      if (typeof value !== 'boolean') throw new Error('Invalid ' + key);
    } else if (typeof value !== 'string' || value.length > (key === 'message' ? 300 : 120)) throw new Error('Invalid ' + key);
    out[key] = value;
  }
  const full = { ...DEFAULT_STUDIO, ...out };
  if (full.x + full.width > 1080 || full.y + full.height > 1920) throw new Error('Sign must fit within 1080 × 1920');
  if (!/^[A-Z]{3}$/.test(full.currency)) throw new Error('Use a three-letter currency');
  if (full.automatic && (!full.sellerId.trim() || !full.showId.trim())) throw new Error('Seller and show IDs are required for automatic effects');
  return out;
}
// Only signed, recent v2 events for the explicitly selected seller/show can animate.
// No inventory writes, buyer data, individual bids, or inferred auction timers.
export function whatnotEffect(event, settings, now = Date.now()) {
  if (!settings.automatic || event?.version !== 'v2' || event.seller_id !== settings.sellerId) return null;
  const at = Date.parse(event.timestamp);
  if (!Number.isFinite(at) || at > now + 30000 || now - at > 60000) return null;
  const d = event.data;
  if (!d || d.show_id !== settings.showId) return null;
  if (event.type === 'shows.started') return { kind:'ready', at };
  if (event.type === 'shows.ended') return { kind:'gameover', at };
  if (event.type !== 'orders.created' || d.transaction_type !== 'auction' || d.status !== 'pending_fulfillment') return null;
  const amount = d.amounts?.subtotal;
  const jackpot = amount?.currency === settings.currency && Number.isFinite(Number(amount.amount)) && Number(amount.amount) >= settings.jackpotAmount;
  return { kind: jackpot ? 'jackpot' : 'sold', at };
}
export function makeEffect(kind, settings, now = Date.now()) {
  if (!EFFECTS.includes(kind)) throw new Error('Unknown effect');
  return { id:crypto.randomUUID(), kind, startsAt:now, endsAt:now + (kind === 'countdown' ? settings.countdownSeconds * 1000 + 1200 : kind === 'clear' ? 0 : 5000) };
}
export async function digestToken(token) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b=>b.toString(16).padStart(2,'0')).join('');
}
