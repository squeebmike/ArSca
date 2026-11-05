// Link imported Pokémon to their TCGplayer product (store, 2026-11-05,
// Crull001's PriceCharting/Collectr import: "Do the pokemon fix link"). The
// daily price update (pokemon-daily-sync.mjs) only prices cards that carry
// a TCGplayer product id, and an import from another app brings none. Each
// hour a batch of a second store's unlinked raw cards and sealed products is
// looked up in PokemonPriceTracker by name, set and number -- a short list
// (a few credits each) -- and linked only on a sure match: same name, same
// card number, the set named the same. Anything else is left as it was and
// marked, so it is never looked up twice. The Mana Pocket's own stock is
// not touched by this job.
import { tcgPlayerIdOf, isSealedRow, languageOf } from './pokemon-daily-sync.mjs';

export const LINK_BATCH = 40;
const POKEMON_CAT = /^pok[eé]mon(\s+(tcg|cards?|trading card game|singles|sealed))?$/i;
const SLAB_RE = /\b(PSA|BGS|BECKETT|CGC|SGC|TAG|HGA|ACE)\s*(?:GEM\s*(?:MINT|MT)\s*|MINT\s*|PRISTINE\s*)?(10|[1-9](?:\.5)?)(?![\d.])/i;
export const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'of', 'pokemon', 'tcg', 'japanese', 'english', 'set', 'series']);
const tokens = s => norm(s).split(' ').filter(t => t && !STOP.has(t));
export const cardNum = s => { const m = String(s || '').trim().match(/^[a-z]*0*(\d+[a-z]?)|^([a-z]+\d+)/i); return m ? (m[1] || m[2]).toLowerCase() : norm(s); };
function overlap(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}

export function linkCandidate(row = {}) {
  const d = row.data || {};
  if (row.status !== 'in_stock' || d.archivedAt || d.pptLinkCheckedAt) return false;
  if (!POKEMON_CAT.test(String(d.category || '').trim())) return false;
  if (d.dropship === true || d.ownershipType === 'supplier' || tcgPlayerIdOf(d)) return false;
  // Slabs price from the graded guide, not TCGplayer.
  if (d.isSlabbed === true || (String(d.grader || '').trim() && String(d.grade || '').trim()) || SLAB_RE.test(String(d.name || ''))) return false;
  if (!/^(english|japanese)?$/i.test(String(d.selectedLanguage || d.language || '').trim())) return false;
  return !!String(d.name || '').trim();
}
const setOf = d => String(d.set || d.setName || '').replace(/^japanese\s+/i, '').trim();
export function linkQuery(d = {}) {
  const sealed = isSealedRow(d), language = languageOf(d);
  const search = (sealed ? d.name : [d.name, setOf(d), d.card_number || d.cardNumber].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
  return { path: sealed ? '/sealed-products' : '/cards', params: { search, language, limit: sealed ? '5' : '5' } };
}
// The one sure match in a result list, or null.
export function pickMatch(d = {}, cards = []) {
  const sealed = isSealedRow(d);
  const ok = (cards || []).filter(c => c && /^\d+$/.test(String(c.tcgPlayerId || c.tcgplayerId || ''))).filter(c => {
    if (sealed) return norm(c.name) === norm(d.name) || (overlap(c.name, d.name) >= 0.85 && overlap(c.setName || c.set, setOf(d)) >= 0.6);
    if (norm(c.name) !== norm(d.name)) return false;
    const want = cardNum(d.card_number || d.cardNumber);
    if (!want || cardNum(c.cardNumber || c.number) !== want) return false;
    return overlap(c.setName || c.set?.name || c.set, setOf(d)) >= 0.6;
  });
  const ids = [...new Set(ok.map(c => String(c.tcgPlayerId || c.tcgplayerId)))];
  return ids.length === 1 ? ok.find(c => String(c.tcgPlayerId || c.tcgplayerId) === ids[0]) : null;
}
// What a linked row gets: the product id (and its picture if it had none).
export function linkedData(d = {}, card = {}, at) {
  const id = String(card.tcgPlayerId || card.tcgplayerId);
  const img = card.imageCdnUrl400 || card.imageCdnUrl800 || card.imageCdnUrl || card.imageUrl || '';
  const edition = /\b1st\b/i.test(d.variant || '') ? '1st Edition' : /shadowless/i.test(d.variant || '') ? 'Shadowless' : '';
  return {
    ...d, tcgPlayerId: id, tcgplayerId: id, tcgPlayerUrl: 'https://www.tcgplayer.com/product/' + id,
    externalRefs: { ...(d.externalRefs && typeof d.externalRefs === 'object' ? d.externalRefs : {}), tcgPlayerId: id, tcgplayerProductId: id, ...(card.id ? { pokemonPriceTrackerCardId: String(card.id) } : {}) },
    ...(card.id ? { pokemonPriceTrackerCardId: String(card.id) } : {}),
    ...(!d.imageUrl && img ? { imageUrl: img, thumbnail: img, image: img } : {}),
    ...(edition && !d.selectedPrinting ? { selectedPrinting: edition, printing: edition } : {}),
    pptLinkCheckedAt: at, pptLinkResult: 'linked',
  };
}

// deps: { db(path, opts), pptList(path, params) -> { ok, status, cards }, isPlatform(storeId) }
export async function runPokemonLinkSync(storeId, deps, { now = Date.now(), size = LINK_BATCH } = {}) {
  if (deps.isPlatform?.(storeId)) return { skipped: 'The Mana Pocket is not linked by this job' };
  const s = encodeURIComponent(storeId);
  const { data: rows } = await deps.db(`inventory_items?store_id=eq.${s}&status=eq.in_stock&select=id,status,data&limit=5000`);
  const todo = (rows || []).filter(linkCandidate);
  const out = { linked: 0, noMatch: 0, failed: 0, left: Math.max(0, todo.length - size) };
  const at = new Date(now).toISOString();
  for (const row of todo.slice(0, size)) {
    const d = row.data || {};
    const q = linkQuery(d);
    let got;
    try { got = await deps.pptList(q.path, q.params); } catch (e) { got = { ok: false, status: 0 }; }
    if (!got.ok && (got.status === 429 || got.status === 403)) { out.failed++; break; } // out of credits: next hour
    if (!got.ok) { out.failed++; continue; }
    const card = pickMatch(d, got.cards);
    const data = card ? linkedData(d, card, at) : { ...d, pptLinkCheckedAt: at, pptLinkResult: (got.cards || []).length ? 'no sure match' : 'not found' };
    try { await deps.db(`inventory_items?id=eq.${encodeURIComponent(row.id)}&store_id=eq.${s}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ data, updated_at: at }) }); }
    catch (e) { out.failed++; continue; }
    if (card) out.linked++; else out.noMatch++;
  }
  return out;
}
