// Card numbers to checklist pages for ByteRider (store, 2026-11-09: "Can it
// point you to the checklist for sports or mtg or tcg cards based on some
// information? 143/142 pulls up the Bulbasaur ... BLA-JR pulls up this card
// on the website"). Public checklist data only: no inventory or prices of
// ours. A Pokemon set is read only from what's already saved (never a paid
// provider call from a chat question).
import { sportsReferenceRows, normalizeSportsCardNumber } from './sports-card-finder.mjs';

const fold = v => String(v || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = v => fold(v).split(/[^a-z0-9]+/).filter(w => w.length >= 3);

// Sports codes ("BLA-JR"): every checklist card with that number, the one
// whose player, set or year the question names first, then the newest.
export function sportsByCode(codes = [], q = '', rows = sportsReferenceRows()) {
  const asked = new Set(words(q));
  const year = (String(q).match(/\b(19|20)\d{2}\b/) || [])[0];
  const out = [];
  for (const code of codes) {
    const want = normalizeSportsCardNumber(code);
    const hits = rows.filter(r => normalizeSportsCardNumber(r.card.cardNumber) === want);
    const score = r => (year && String(r.set.year) === year ? 3 : 0) + words(r.card.player).filter(w => asked.has(w)).length * 2 + words(r.set.displayName).filter(w => asked.has(w)).length;
    hits.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 3)
      .forEach(({ r }) => out.push({ number: r.card.cardNumber, name: r.card.player, set: r.set.displayName, section: r.section, url: r.href }));
  }
  return out;
}

// Pokemon "143/142": sets about that size (printed total up to 80 secret
// rares under the card count), a set the question names first.
const numKey = v => String(v || '').trim().toLowerCase().replace(/^0+(?=\d)/, '');
export async function pokemonBySlash(slashes = [], q = '', { sets = [], cardsFor, cardPath, maxSets = 12 } = {}) {
  const asked = new Set(words(q));
  const out = [];
  for (const { number, total } of slashes) {
    const t = Number(total);
    const named = s => words(s.name).filter(w => asked.has(w)).length;
    const candidates = sets.filter(s => Number(s.cardCount) >= t && Number(s.cardCount) <= t + 80)
      .sort((a, b) => named(b) - named(a)).slice(0, maxSets);
    for (const set of candidates) {
      const cards = await cardsFor(set).catch(() => []);
      const card = (cards || []).find(c => { const [n, of] = String(c.cardNumber || '').split('/'); return numKey(n) === numKey(number) && numKey(of) === numKey(total); });
      if (card) out.push({ number: card.cardNumber, name: card.name, set: set.name, section: card.rarity || '', price: Number(card.prices?.market) || 0, url: cardPath(set, card) });
      if (out.length >= 3) break;
    }
  }
  return out;
}
