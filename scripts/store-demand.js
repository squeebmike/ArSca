// ── What sells here ──
// Store ask: "a section in reports that has what we should be buying and
// looking for -- sets, cards, characters, players." Online prices say what
// a card is worth; our own sales say what WE can sell and how fast. This
// groups sold history by set and by character (Pokemon), player (sports),
// series (comics) or card name (Magic), with how many sold, profit, days
// to sell and what's still on the shelf, and rates each group: HOT (sells
// fast at a good margin), PLENTY (sells, but months of it on the shelf),
// SLOW (sits or piles up), STEADY, or THIN (too few sales to say). The buy signal uses the same groups to pay a little
// more for what moves here and a little less for what sits.
(function(root){
  'use strict';

  const RULES = {
    windowDays: 180,     // sales older than this don't count
    hotMinSold: 3,       // at least this many sold ...
    hotMaxDays: 30,      // ... selling in about a month or less ...
    hotMinMargin: 20,    // ... at 20%+ profit = HOT
    slowStock: 3,        // 3+ on the shelf with at most 1 sale ...
    slowStockAge: 45,    // ... that's been there 45+ days on average = SLOW
                         // (a box of new arrivals isn't "not selling" yet)
    slowDays: 60,        // or taking 60+ days to sell = SLOW
    steadyMinSold: 2,
    plentyMonths: 4,     // sells, but this many months of stock on hand = HAVE PLENTY
  };
  const DAY = 86400000;

  function categoryGroup(item = {}){
    const c = String(item.category || '').toLowerCase();
    if(/pok[eé]mon/.test(c)) return 'pokemon';
    if(/magic|\bmtg\b/.test(c)) return 'mtg';
    if(/comic/.test(c)) return 'comic';
    if(/sport|baseball|football|basketball|hockey|soccer|topps|panini/.test(c)) return 'sports';
    return 'other';
  }

  // "Team Rocket's Mewtwo ex - 213/182" -> "Mewtwo"; "Erika's Tangela" ->
  // "Tangela"; "Mega Charizard X ex" -> "Charizard"; "Moltres & Zapdos &
  // Articuno GX" -> "Moltres & Zapdos & Articuno"; sealed product -> none.
  const POKEMON_SUFFIX = /\s+(?:ex|EX|GX|V|VMAX|VSTAR|V-UNION|LV\.?\s?X|BREAK|Prime|Star|δ|☆|★|δ Delta Species)\b.*$/;
  const POKEMON_PREFIX = /^(?:(?:[A-Z][\w.-]*\s+)?[A-Z][\w.-]*'s\s+|Mega\s+|Radiant\s+|Shining\s+|Dark\s+|Light\s+|Galarian\s+|Alolan\s+|Hisuian\s+|Paldean\s+|Primal\s+|Ancient\s+|Future\s+)+/;
  const SEALED = /\b(?:booster|box|pack|bundle|collection|tin|deck|elite trainer|etb|blister|case|display|binder|sleeves?|lot)\b/i;
  function pokemonCharacter(name = ''){
    if(SEALED.test(name)) return '';
    let n = String(name).replace(/\s*\(.*?\)\s*/g, ' ').trim();
    n = n.replace(/\s*#\s*\w*\d+.*$/, '').replace(/\s*[-–]\s*[A-Z]*\d+[\w/]*\s*$/, '').replace(/\s*\b\d{1,3}\/\d{1,3}\b.*$/, '').trim();
    n = n.replace(/\s+with\s+.*$/i, '').replace(POKEMON_SUFFIX, '').replace(POKEMON_PREFIX, '').trim();
    n = n.replace(/\s+[XY]$/, '').replace(/\s*[-–]\s*$/, '').trim(); // Mega Charizard X/Y
    return n && n.split(/\s+/).length <= (n.includes('&') ? 7 : 3) ? n : '';
  }
  function comicSeries(item = {}){
    const s = String(item.series || '').trim();
    if(s) return s;
    const m = String(item.name || '').match(/^(.*?)\s*#\s*\d/);
    return m ? m[1].trim() : '';
  }
  function sportsPlayer(item = {}){ return String(item.player || item.raw?.player || '').trim(); }

  // One key per set however it's written: "SV10: Destined Rivals" and
  // "Pokemon Destined Rivals" are the same set.
  function setKey(set = ''){
    return String(set).toLowerCase().replace(/^pok[eé]mon\s+(?:tcg\s*[:-]?\s*)?/, '').replace(/^[a-z]{1,4}\d{0,3}[a-z]?\s*:\s*/, '').replace(/[^a-z0-9&]+/g, ' ').trim();
  }
  // The groups an item belongs to: its set, plus who/what it is.
  function groupKeysFor(item = {}){
    const cat = categoryGroup(item);
    const out = [];
    const set = String(item.set || item.setName || '').trim();
    if(set && cat !== 'comic') out.push({ dim:'set', cat, label:set });
    if(cat === 'pokemon'){ const who = pokemonCharacter(item.name); if(who) out.push({ dim:'character', cat, label:who }); }
    if(cat === 'sports'){ const who = sportsPlayer(item); if(who) out.push({ dim:'player', cat, label:who }); }
    if(cat === 'comic'){ const series = comicSeries(item); if(series) out.push({ dim:'series', cat, label:series }); }
    if(cat === 'mtg' && !SEALED.test(item.name || '')){ const card = String(item.name || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s*[-–].*$/, '').trim(); if(card) out.push({ dim:'card', cat, label:card }); }
    return out.map(g => ({ ...g, key:g.cat + '|' + g.dim + '|' + (g.dim === 'set' ? setKey(g.label) : g.label.toLowerCase()) }));
  }

  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const time = v => { const t = new Date(v || 0).getTime(); return Number.isFinite(t) && t > 0 ? t : 0; };

  // sold: [{ name, category, set, player, series, salePrice, cost, qty, addedAt, soldAt }]
  // stock: [{ name, category, set, player, series, price, qty }]
  function buildStoreDemand({ sold = [], stock = [], now = Date.now(), rules } = {}){
    const R = { ...RULES, ...(rules || {}) };
    const cutoff = now - R.windowDays * DAY;
    const groups = new Map();
    const get = g => { let s = groups.get(g.key); if(!s){ s = { key:g.key, dim:g.dim, cat:g.cat, label:g.label, sold:0, revenue:0, profit:0, costed:0, days:[], stockQty:0, stockValue:0, stockAges:[], lastSold:0 }; groups.set(g.key, s); } return s; };
    for(const it of sold){
      const at = time(it.soldAt);
      if(!at || at < cutoff) continue;
      const qty = Math.max(1, num(it.qty) || 1), price = num(it.salePrice), cost = num(it.cost);
      const added = time(it.addedAt);
      for(const g of groupKeysFor(it)){
        const s = get(g);
        s.sold += qty; s.revenue += price;
        if(cost > 0 && price > 0){ s.profit += price - cost; s.costed += price; }
        if(added && at > added) s.days.push((at - added) / DAY);
        s.lastSold = Math.max(s.lastSold, at);
      }
    }
    for(const it of stock){
      const qty = Math.max(1, num(it.qty) || 1);
      const added = time(it.addedAt);
      for(const g of groupKeysFor(it)){ const s = get(g); s.stockQty += qty; s.stockValue += num(it.price) * qty; if(added) s.stockAges.push((now - added) / DAY); }
    }
    // Sales pace is measured over the history we actually have (sales only
    // go back so far), never less than a month.
    const firstSale = Math.min(...sold.map(it => time(it.soldAt)).filter(t => t >= cutoff), now);
    const spanMonths = Math.max(1, (now - firstSale) / DAY / 30);
    const list = [...groups.values()].map(s => {
      const avgDays = s.days.length ? s.days.reduce((a, b) => a + b, 0) / s.days.length : null;
      const marginPct = s.costed > 0 ? s.profit / s.costed * 100 : null;
      const stockAge = s.stockAges.length ? s.stockAges.reduce((a, b) => a + b, 0) / s.stockAges.length : null;
      const perMonth = s.sold / spanMonths;
      const monthsOfStock = perMonth > 0 ? s.stockQty / perMonth : null;
      let rating = 'thin';
      if(s.sold >= R.steadyMinSold && monthsOfStock != null && monthsOfStock >= R.plentyMonths) rating = 'plenty';
      else if(s.sold >= R.hotMinSold && (avgDays == null || avgDays <= R.hotMaxDays) && (marginPct == null || marginPct >= R.hotMinMargin)) rating = 'hot';
      else if((s.stockQty >= R.slowStock && s.sold <= 1 && stockAge != null && stockAge >= R.slowStockAge) || (avgDays != null && avgDays >= R.slowDays && s.sold >= R.steadyMinSold)) rating = 'slow';
      else if(s.sold >= R.steadyMinSold) rating = 'steady';
      return { key:s.key, dim:s.dim, cat:s.cat, label:s.label, sold:s.sold, revenue:Math.round(s.revenue * 100) / 100, profit:Math.round(s.profit * 100) / 100,
        marginPct:marginPct == null ? null : Math.round(marginPct), avgDays:avgDays == null ? null : Math.round(avgDays), stockQty:s.stockQty, stockValue:Math.round(s.stockValue), stockAge:stockAge == null ? null : Math.round(stockAge), perMonth:Math.round(perMonth * 10) / 10, monthsOfStock:monthsOfStock == null ? null : Math.round(monthsOfStock * 10) / 10, lastSold:s.lastSold, rating };
    });
    const byKey = new Map(list.map(g => [g.key, g]));
    return { list, byKey, windowDays:R.windowDays, spanDays:Math.round(spanMonths * 30), soldCount:sold.filter(it => time(it.soldAt) >= cutoff).length };
  }

  // The strongest evidence for one item: who/what it is if we've sold
  // enough of those, else its set.
  function demandFor(item = {}, demand){
    if(!demand) return null;
    const groups = groupKeysFor(item).map(g => demand.byKey.get(g.key)).filter(Boolean);
    const known = groups.filter(g => g.rating !== 'thin');
    if(!known.length) return null;
    return known.find(g => g.dim !== 'set') || known[0];
  }

  // A plain sentence for a group, e.g. "You've sold 9 Charizard in 180 days,
  // about 8 days each, at 41% profit."
  function demandSentence(g, spanDays = RULES.windowDays){
    if(!g) return '';
    const what = g.dim === 'set' ? `from ${g.label}` : g.label;
    const bits = [`You've sold ${g.sold} ${what} in the last ${spanDays} days`];
    if(g.avgDays != null) bits.push(`about ${Math.max(1, g.avgDays)} day${g.avgDays === 1 ? '' : 's'} each`);
    if(g.marginPct != null) bits.push(`at ${g.marginPct}% profit`);
    let s = bits.join(', ') + '.';
    if(g.stockQty) s += ` ${g.stockQty} on the shelf now${g.monthsOfStock != null && g.monthsOfStock >= 1 ? ` (about ${Math.round(g.monthsOfStock)} month${Math.round(g.monthsOfStock) === 1 ? '' : 's'} of supply)` : ''}.`;
    return s;
  }

  const api = { RULES, categoryGroup, pokemonCharacter, comicSeries, setKey, groupKeysFor, buildStoreDemand, demandFor, demandSentence };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ArsCaStoreDemand = api;
})(typeof window !== 'undefined' ? window : globalThis);
