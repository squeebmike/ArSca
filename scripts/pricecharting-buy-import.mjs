// A PriceCharting collection export into the Buy tab (store, 2026-11-09:
// "PriceCharting has something where you can take pictures, it puts the
// cards into an export. I want to bring that into the buy").
//
// Reads PriceCharting's collection CSV (id, product-name, console-name,
// price-in-pennies, include-string, condition-string, quantity, grading-
// company ...) and Collectr's export (Category, Set, Product Name, Card
// Number, Grade, Card Condition, Quantity, Market Price ...). Each row
// becomes a buy line priced at the export's own guide value.

// RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes.
export function parseCsv(text = '') {
  const rows = []; let row = [], field = '', quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim()));
}

const slug = v => String(v || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export function categoryFrom(text = '') {
  const s = String(text).toLowerCase();
  if (/pok[eé]mon/.test(s)) return 'Pokemon TCG';
  if (/magic|mtg/.test(s)) return 'Magic: The Gathering';
  if (/one piece/.test(s)) return 'One Piece';
  if (/lorcana/.test(s)) return 'Lorcana';
  if (/yu-?gi-?oh/.test(s)) return 'Yu-Gi-Oh';
  if (/comic/.test(s)) return 'Comic';
  if (/baseball|football|basketball|hockey|soccer|sport|topps|panini|bowman|upper deck|wrestling|ufc|racing/.test(s)) return 'Sports Card';
  if (/funko/.test(s)) return 'Funko Pops';
  if (/nintendo|playstation|xbox|sega|switch|game ?boy|atari/.test(s)) return 'Video Games';
  return 'Collectibles';
}
const languageFrom = text => { const m = String(text).match(/\b(japanese|chinese|korean|german|french|italian|spanish|portuguese)\b/i); return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : ''; };
// "Pokemon Obsidian Flames" -> "Obsidian Flames"; "Comic Books Absolute Batman" -> "Absolute Batman".
const setFrom = consoleName => String(consoleName || '').replace(/^(pokemon(?:\s+(?:japanese|chinese|korean))?|magic|yugioh|one piece|lorcana|comic books|(?:baseball|football|basketball|hockey|soccer) cards)\s+/i, '').trim();
// PriceCharting's 'Normal wear' is its plain ungraded copy: NM.
const CONDITIONS = [[/near mint|mint|^nm|normal wear/i, 'NM'], [/lightly|light|^lp|excellent/i, 'LP'], [/moderate|^mp|good|normal wear/i, 'MP'], [/heav|^hp|poor/i, 'HP'], [/damag|^dmg/i, 'DMG']];
const conditionFrom = v => (CONDITIONS.find(([re]) => re.test(String(v || '').trim())) || [0, 'NM'])[1];
const money = v => { const n = Number(String(v || '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };

export function importRows(text = '') {
  const rows = parseCsv(text);
  if (rows.length < 2) return { format: '', items: [], skipped: 0 };
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const col = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const get = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const items = []; let skipped = 0, format = '';
  if (col('product-name') >= 0 && col('console-name') >= 0) {
    format = 'PriceCharting';
    const [id, name, cons, pennies, include, cond, qty, grader, cert, notes] = [col('id'), col('product-name'), col('console-name'), col('price-in-pennies'), col('include-string'), col('condition-string'), col('quantity'), col('grading-company'), col('grading-cert-id'), col('notes')];
    for (const r of rows.slice(1)) {
      const product = get(r, name), consoleName = get(r, cons);
      if (!product) { skipped++; continue; }
      const inc = get(r, include), company = get(r, grader);
      const graded = !!company || /\b(psa|bgs|cgc|sgc|tag|grade|graded)\b/i.test(inc);
      const number = (product.match(/#\s*([A-Za-z0-9-]+)\s*$/) || [])[1] || '';
      items.push({
        name: product, set: setFrom(consoleName), category: categoryFrom(consoleName + ' ' + product), card_number: number,
        language: languageFrom(consoleName), condition: graded ? 'Graded' : conditionFrom(get(r, cond)),
        grade: graded ? ((inc.match(/(\d+(?:\.\d)?)/) || [])[1] || '') : '', grader: company || ((inc.match(/^(psa|bgs|beckett|cgc|sgc|tag)/i) || [])[1] || '').toUpperCase(), cert_number: get(r, cert),
        quantity: Math.max(1, Math.min(100, Math.floor(Number(get(r, qty)) || 1))), market: Math.round(Number(get(r, pennies)) || 0) / 100,
        pricechartingProductId: get(r, id), providerUrl: product && consoleName ? `https://www.pricecharting.com/game/${slug(consoleName)}/${slug(product)}` : '',
        notes: get(r, notes), source: 'PriceCharting export',
      });
    }
  } else if (col('product name') >= 0) {
    format = 'Collectr';
    const marketCol = head.findIndex(h => /^market price/.test(h));
    const [cat, set, name, num, grade, cond, qty, notes] = [col('category'), col('set'), col('product name'), col('card number'), col('grade'), col('card condition'), col('quantity'), col('notes')];
    for (const r of rows.slice(1)) {
      const product = get(r, name);
      if (!product) { skipped++; continue; }
      const g = get(r, grade), graded = !!g && !/ungraded/i.test(g);
      items.push({
        name: product, set: get(r, set), category: categoryFrom(get(r, cat) + ' ' + get(r, set) + ' ' + product), card_number: get(r, num),
        language: languageFrom(get(r, set)), condition: graded ? 'Graded' : conditionFrom(get(r, cond)),
        grade: graded ? g.replace(/^(psa|bgs|cgc|sgc)\s*/i, '') : '', grader: graded ? ((g.match(/^(psa|bgs|cgc|sgc)/i) || [])[1] || '').toUpperCase() : '', cert_number: '',
        quantity: Math.max(1, Math.min(100, Math.floor(Number(get(r, qty)) || 1))), market: money(get(r, marketCol)),
        pricechartingProductId: '', providerUrl: '', notes: get(r, notes), source: 'Collectr export',
      });
    }
  }
  return { format, items, skipped };
}

// MAGIC LISTS, PASTED (store, 2026-11-14: "can the buy importer do this format? For MTG ... I'd like to be able to
// copy and paste it in the buy import section"): one card a line, the way deck builders and collection apps export:
//   1 Corpses of the Lost (Extended Art) [LCI] 366          (bracketed set, collector number)
//   2 Agonizing Remorse (JP Alternate Art) (Foil Etched) [STA] 87
//   1 Prosper, Tome-Bound (Display Commander) - Thick Stock [AFC] 2
//   1 Sewer Nemesis [LIST] 075/312
//   1x Sol Ring (C21) 263 *F*                               (Moxfield / Archidekt style)
//   Lightning Bolt                                          (just a name: 1 copy)
// Each card: quantity, the plain name, the printing's extras (Extended Art, Showcase, ...), set code, collector
// number, and whether it's foil or foil-etched (a "Foil" / "Foil Etched" tag, or *F* / *E*). Lines it can't read
// come back in `skipped` so nothing is silently dropped.
const MTG_FINISH = s => /foil\s*etched|\betched\b/i.test(s) ? 'etched' : /\bfoil\b/i.test(s) ? 'foil' : '';
export function parseMtgList(text = '') {
  const items = [], skipped = [];
  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw.replace(/\s+/g, ' ').trim();
    if (!line || /^(?:\/\/|#)/.test(line) || /^(?:sideboard|deck|main ?deck|commander|maybeboard|companion|tokens?)\s*:?\s*$/i.test(line)) continue; // comments and section headers
    let finish = '';
    const star = line.match(/\s\*([FE])\*\s*$/i); if (star) { finish = star[1].toUpperCase() === 'E' ? 'etched' : 'foil'; line = line.slice(0, star.index).trim(); }
    let m = line.match(/^(\d{1,3})\s*x?\s+(.+)$/i), qty = 1, rest = line;
    if (m) { qty = Math.max(1, Math.min(100, Number(m[1]))); rest = m[2]; }
    let set = '', number = '';
    const br = rest.match(/^(.*?)\s*\[([A-Za-z0-9]{2,6})\]\s*([A-Za-z0-9★\-\/]{1,12})?\s*$/);
    if (br) { rest = br[1]; set = br[2].toUpperCase(); number = br[3] || ''; }
    else {
      const pa = rest.match(/^(.*\S)\s*\(([A-Za-z0-9]{2,6})\)\s*([A-Za-z0-9★\-\/]{1,12})?\s*$/);
      if (pa && /^[A-Z0-9]{2,6}$/.test(pa[2])) { rest = pa[1]; set = pa[2]; number = pa[3] || ''; }
    }
    const extras = [];
    rest = rest.replace(/\s*-\s*(thick stock)\s*$/i, (_, t) => { extras.push('Thick Stock'); return ''; });
    rest = rest.replace(/\s*\(([^()]{1,40})\)/g, (_, t) => { extras.push(t.trim()); return ''; }).trim();
    if (!finish) finish = MTG_FINISH(extras.join(' '));
    const shown = extras.filter(e => !/^foil$/i.test(e) && !/^foil etched$/i.test(e));
    if (!rest || /^\d+$/.test(rest)) { skipped.push(raw.trim()); continue; }
    items.push({ quantity: qty, name: rest, extras: shown, set, number, finish });
  }
  return { items, skipped };
}
// The name a buy-list row shows: the card, its printing extras and finish, e.g. "Jacob Frye (Foil Etched)".
export function mtgDisplayName(it) { return [it.name, ...it.extras.map(e => '(' + e + ')'), it.finish === 'etched' ? '(Foil Etched)' : it.finish === 'foil' ? '(Foil)' : ''].filter(Boolean).join(' '); }
// Scryfall lookups (api.scryfall.com/cards/collection, 75 a request): by set + collector number when there is one,
// else by name (+ set). The List ([LIST] 075/312) and similar set-less promos go by name in their own pass.
export function mtgIdentifier(it) {
  const set = String(it.set || '').toLowerCase();
  if (set && it.number && !['list', 'plst', 'media'].includes(set) && !/\//.test(it.number)) return { set, collector_number: String(it.number).replace(/^0+(?=\d)/, '') };
  return set && !['list', 'plst', 'media'].includes(set) ? { name: it.name, set } : { name: it.name };
}
// Scryfall's price for the finish asked for (USD): etched, foil, then regular -- falling back sensibly.
export function mtgPriceOf(card = {}, finish = '') {
  const p = card.prices || {}, n = v => Number(v) > 0 ? Number(v) : 0;
  if (finish === 'etched') return n(p.usd_etched) || n(p.usd_foil) || n(p.usd);
  if (finish === 'foil') return n(p.usd_foil) || n(p.usd_etched) || n(p.usd);
  return n(p.usd) || n(p.usd_foil) || n(p.usd_etched);
}
