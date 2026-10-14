// ── What comics sell here ──
// Store ask, for ordering on the FOC wall: "keep track of runs, or things
// that go well together ... I have a Twelve-Toe Maggie #1 in stock still,
// order #2 to go with it ... series and characters and cover artists ...
// Peach sells well, don't forget these Peach covers ... you sold X
// Spider-Man comics, here's another Spider-Man that will sell."
// Our own comic sales (register + eBay) and what's on the shelf, grouped by
// series (with each issue), character, cover artist (variant covers only)
// and cover type (ratio, virgin, foil, connecting...), plus which series
// sell together in the same sale. familyIntel() turns that into pills for
// one FOC title; whatToOrder() is the per-week summary.
(function(root){
  'use strict';

  // Starting watch list: the store said Peach Momoko covers sell.
  const DEFAULT_WATCH = { artists:['Peach Momoko'], characters:[], series:[] };
  const RULES = {
    windowDays: 180,   // sales older than this don't count
    hotMinSold: 4,     // 4+ sold, and at least as many sold as sit on the shelf = HOT
    steadyMinSold: 2,
    slowStock: 3,      // 3+ on the shelf with at most 1 sold ...
    slowStockAge: 30,  // ... after a month = SLOW
    togetherMin: 2,    // two series in the same sale at least twice = "sells with"
    togetherMaxSeries: 8, // a 30-book collection sale says nothing about what goes together
  };
  const DAY = 86400000;
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const time = v => { const t = new Date(v || 0).getTime(); return Number.isFinite(t) && t > 0 ? t : 0; };

  // "THE AMAZING SPIDER-MAN #1004" and "Amazing Spider-Man (2025)" are one series.
  function seriesKey(s){
    return String(s || '').replace(/#.*$/, '').toUpperCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/^\s*THE\s+/, '').replace(/[^A-Z0-9]+/g, ' ').trim();
  }
  // "MIDNIGHT SPIDER-MAN #1 COVER C PEACH MOMOKO VARIANT -- COVER C ..." ->
  // { series:'MIDNIGHT SPIDER-MAN', issue:'1', cover:'COVER C PEACH MOMOKO VARIANT' }
  function parseTitle(title){
    let t = String(title || '').replace(/\s+-\s+PRESALE\s*$/i, '').trim();
    let tail = '';
    const dash = t.indexOf(' -- ');
    if(dash > -1){ tail = t.slice(dash + 4).trim(); t = t.slice(0, dash).trim(); }
    const m = t.match(/^(.*?)\s*#\s*(\d+(?:\.\d+)?)\b\s*(.*)$/);
    if(!m) return { series:t, issue:'', cover:tail };
    return { series:m[1].trim(), issue:m[2], cover:(m[3] || '').trim() || tail };
  }
  const BUNDLE = /\bbundle\b|\blot\b|^comics?$|\bgrab ?bag\b/i;
  // The regular cover: "Cover A", "(CVR A)", or no cover wording at all.
  function isMainCover(cover){
    const c = String(cover || '').replace(/[()]/g, ' ').trim();
    return !c || /^(?:cvr|cover)\s*a\b/i.test(c) || /^cover\s*1\b/i.test(c);
  }

  // Characters and franchises people collect across titles.
  const CHARACTERS = [
    ['Spider-Man', /spider-?(?:man|woman|gwen|verse|boy|girl|punk)|miles morales|mary jane|\bspidey\b/i],
    ['Venom', /\bvenom\b|\bcarnage\b/i],
    ['X-Men', /\bx-?men\b|x-?force|x-?factor|uncanny|\bmutants?\b(?!\s+ninja)|x-?orcists|jean grey|gambit|\bstorm\b|magneto|\bdnx\b|krakoa/i],
    ['Wolverine', /wolverine/i],
    ['Deadpool', /deadpool|wade wilson/i],
    ['Batman', /batman|gotham|nightwing|\brobin\b|batgirl|catwoman/i],
    ['Joker & Harley', /\bjoker\b|harley quinn/i],
    ['Superman', /superman|supergirl|lois lane/i],
    ['Wonder Woman', /wonder woman/i],
    ['Flash', /\bflash\b/i],
    ['Green Lantern', /green lantern/i],
    ['Justice League', /justice league|\bjla\b/i],
    ['Hulk', /\bhulk\b/i],
    ['Thor', /\bthor\b|\bloki\b/i],
    ['Captain America', /captain america/i],
    ['Iron Man', /iron man/i],
    ['Avengers', /avengers/i],
    ['Daredevil', /daredevil/i],
    ['Punisher', /punisher/i],
    ['Moon Knight', /moon knight|marc spector/i],
    ['Doctor Strange', /doctor strange|dr\.? strange/i],
    ['Doctor Doom', /\bdoom\b/i],
    ['Fantastic Four', /fantastic four/i],
    ['Ghost Rider', /ghost rider/i],
    ['Black Panther', /black panther/i],
    ['TMNT', /teenage mutant ninja turtles|\btmnt\b|ninja turtles/i],
    ['Godzilla', /godzilla|kaiju/i],
    ['Transformers', /transformers/i],
    ['G.I. Joe', /g\.?\s?i\.?\s?joe/i],
    ['Star Wars', /star wars|mandalorian|darth vader|\bjedi\b/i],
    ['Sonic', /\bsonic\b/i],
    ['He-Man', /he-man|masters of the universe|skeletor/i],
    ['Hellboy', /hellboy|b\.?p\.?r\.?d/i],
    ['Spawn', /\bspawn\b/i],
    ['Power Rangers', /power rangers/i],
    ['Conan', /\bconan\b/i],
    ['Red Sonja & Vampirella', /red sonja|vampirella/i],
    ['Something Is Killing the Children', /something is killing|house of slaughter/i],
  ];
  function charactersIn(series){
    const s = String(series || '');
    return CHARACTERS.filter(([, re]) => re.test(s)).map(([label]) => label);
  }

  function splitArtists(v){
    const list = Array.isArray(v) ? v : String(v || '').split(/\s*(?:,|&|\/|;|\band\b)\s*/i);
    return list.map(a => String(a || '').replace(/\s+/g, ' ').trim()).filter(a => a && a.length > 2 && !/^(?:various|tbd|n\/a|cover artist not listed)$/i.test(a));
  }
  // Artist names we know (from FOC covers) found in a sale title. Truncated
  // eBay titles ("Daniel Warren Johnso") still match on the first two words.
  function artistsInTitle(title, known){
    const t = ' ' + String(title || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ') + ' ';
    const out = [];
    for(const a of known || []){
      const words = String(a).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
      if(words.length < 2) continue;
      if(t.includes(' ' + words.join(' ') + ' ') || t.includes(' ' + words.slice(0, 2).join(' ') + ' ')) out.push(a);
    }
    return out;
  }
  const COVER_TYPES = [
    ['Ratio covers', /\b1\s*:\s*\d+\b|\bRI\b\s*\(?\d+|\bratio\b|\bincentive\b/i],
    ['Virgin covers', /virgin/i],
    ['Foil covers', /\bfoil\b/i],
    ['Connecting covers', /connecting/i],
    ['Sketch covers', /sketch/i],
    ['Momo-tone covers', /momo-?tone/i],
  ];
  function coverTypes(cover){
    return COVER_TYPES.filter(([, re]) => re.test(String(cover || ''))).map(([label]) => label);
  }

  // The groups one comic belongs to.
  function groupsFor(it, known){
    const parsed = parseTitle(it.title || it.name || '');
    const series = String(it.series || parsed.series || '').replace(/\s*#.*$/, '').trim();
    const issue = String(it.issue || parsed.issue || '').replace(/^#/, '');
    const cover = String(it.cover || parsed.cover || '');
    const out = [];
    const sk = seriesKey(series);
    if(sk) out.push({ dim:'series', key:'series|' + sk, label:series, issue });
    for(const c of charactersIn(series)) out.push({ dim:'character', key:'character|' + c.toLowerCase(), label:c });
    if(!isMainCover(cover)){
      const artists = splitArtists(it.artist).length ? splitArtists(it.artist) : artistsInTitle(cover || it.title || it.name, known);
      for(const a of artists) out.push({ dim:'artist', key:'artist|' + a.toLowerCase(), label:a });
      for(const t of coverTypes(cover)) out.push({ dim:'type', key:'type|' + t.toLowerCase(), label:t });
    }
    return { series, seriesKey:sk, issue, cover, groups:out };
  }

  // sold:  [{ title, series?, issue?, cover?, artist?, qty, price, saleId, at, ebay }]
  // stock: [{ name, series?, issue?, cover?, artist?, qty, at }]
  // artists: known cover-artist names (FOC covers), for reading sale titles
  function buildComicDemand({ sold = [], stock = [], artists = [], now = Date.now(), rules } = {}){
    const R = { ...RULES, ...(rules || {}) };
    const cutoff = now - R.windowDays * DAY;
    const known = [...new Set(artists.flatMap(splitArtists))];
    const groups = new Map();
    const get = g => {
      let s = groups.get(g.key);
      if(!s){ s = { key:g.key, dim:g.dim, label:g.label, sold:0, revenue:0, ebaySold:0, stockQty:0, stockAges:[], issues:{}, lastSold:0, together:new Map() }; groups.set(g.key, s); }
      return s;
    };
    const issueOf = (s, n) => (s.issues[n] = s.issues[n] || { sold:0, stock:0 });
    let bundles = 0, bundleRevenue = 0, firstSale = now, soldCount = 0;
    const sales = new Map();
    for(const it of sold){
      const at = time(it.at || it.soldAt);
      if(!at || at < cutoff) continue;
      const qty = Math.max(1, num(it.qty) || 1), price = num(it.price);
      if(BUNDLE.test(String(it.title || '')) && !/#\s*\d/.test(String(it.title || ''))){ bundles += qty; bundleRevenue += price * qty; continue; }
      const c = groupsFor(it, known);
      if(!c.groups.length) continue;
      soldCount += qty; firstSale = Math.min(firstSale, at);
      for(const g of c.groups){
        const s = get(g);
        s.sold += qty; s.revenue += price * qty; if(it.ebay) s.ebaySold += qty;
        s.lastSold = Math.max(s.lastSold, at);
        if(g.dim === 'series' && c.issue) issueOf(s, c.issue).sold += qty;
      }
      if(c.seriesKey && it.saleId){ const list = sales.get(it.saleId) || new Map(); list.set(c.seriesKey, c.series); sales.set(it.saleId, list); }
    }
    for(const it of stock){
      const qty = Math.max(0, num(it.qty));
      if(!qty) continue;
      const c = groupsFor(it, known);
      const added = time(it.at || it.addedAt);
      for(const g of c.groups){
        const s = get(g);
        s.stockQty += qty; if(added) s.stockAges.push((now - added) / DAY);
        if(g.dim === 'series' && c.issue) issueOf(s, c.issue).stock += qty;
      }
    }
    // Series bought together in the same sale.
    for(const list of sales.values()){
      if(list.size < 2 || list.size > R.togetherMaxSeries) continue;
      const keys = [...list.keys()];
      for(const a of keys) for(const b of keys){
        if(a === b) continue;
        const s = groups.get('series|' + a); if(!s) continue;
        const prior = s.together.get(b) || { key:b, label:list.get(b), count:0 };
        prior.count++; s.together.set(b, prior);
      }
    }
    const spanDays = Math.max(30, Math.round((now - firstSale) / DAY));
    const list = [...groups.values()].map(s => {
      const stockAge = s.stockAges.length ? Math.round(s.stockAges.reduce((a, b) => a + b, 0) / s.stockAges.length) : null;
      let rating = 'thin';
      if(s.sold >= R.hotMinSold && s.sold >= s.stockQty) rating = 'hot';
      else if(s.stockQty >= R.slowStock && s.sold <= 1 && (stockAge == null || stockAge >= R.slowStockAge)) rating = 'slow';
      else if(s.sold >= R.steadyMinSold) rating = 'steady';
      return { key:s.key, dim:s.dim, label:s.label, sold:s.sold, ebaySold:s.ebaySold, revenue:Math.round(s.revenue * 100) / 100,
        avgPrice:s.sold ? Math.round(s.revenue / s.sold * 100) / 100 : null, stockQty:s.stockQty, stockAge, issues:s.issues, lastSold:s.lastSold, rating,
        together:[...s.together.values()].filter(t => t.count >= R.togetherMin).sort((a, b) => b.count - a.count) };
    });
    return { list, byKey:new Map(list.map(g => [g.key, g])), spanDays, soldCount, bundles, bundleRevenue:Math.round(bundleRevenue * 100) / 100, artists:known };
  }

  const plural = (n, word, many) => n + ' ' + (n === 1 ? word : (many || word + 's'));
  const daysLabel = d => d >= 60 ? Math.round(d / 30) + ' months' : d + ' days';
  function issueNum(family){
    const n = String(family.issueNumber || (String(family.title || '').match(/#\s*(\d+(?:\.\d+)?)/) || [])[1] || '');
    return n;
  }

  // Runs: the earlier issues of this series we have or sold.
  function runFor(series, issue){
    const n = Number(issue);
    if(!series || !(n > 1)) return null;
    const before = Object.keys(series.issues || {}).map(Number).filter(i => Number.isFinite(i) && i < n).sort((a, b) => a - b);
    if(!before.length) return null;
    const rows = before.map(i => ({ issue:String(i), ...series.issues[String(i)] }));
    const inStock = rows.filter(r => r.stock > 0), soldRows = rows.filter(r => r.sold > 0);
    if(!inStock.length && !soldRows.length) return null;
    // The latest earlier issue we have or sold (#2 may not be in yet).
    const last = rows.filter(r => r.stock > 0 || r.sold > 0).pop();
    return { issue:String(n), prevIssue:last.issue, prevStock:last.stock, prevSold:last.sold, missingIssue:Number(last.issue) < n - 1 ? String(n - 1) : '', inStock, sold:soldRows, seriesSlow:series.rating === 'slow',
      stockTotal:inStock.reduce((a, r) => a + r.stock, 0), soldTotal:soldRows.reduce((a, r) => a + r.sold, 0) };
  }
  // Lots of the last issue still on the shelf next to few sales: the run
  // is a reason to go light, not to stock up.
  function runOverstocked(run){ return !!run && (run.seriesSlow || (run.prevStock >= 6 && run.prevStock >= Math.max(1, run.prevSold) * 3)); }
  function runText(run){
    if(!run) return '';
    const have = run.inStock.map(r => '#' + r.issue + (r.stock > 1 ? ' ×' + r.stock : '')).join(', ');
    const sold = run.sold.map(r => '#' + r.issue + ' ×' + r.sold).join(', ');
    if(runOverstocked(run)) return run.prevStock ? '#' + run.prevIssue + ': ' + run.prevStock + ' still on the shelf, ' + run.prevSold + ' sold → go light on #' + run.issue : 'earlier issues: ' + run.stockTotal + ' on the shelf, ' + run.soldTotal + ' sold → go light on #' + run.issue;
    const gap = run.missingIssue ? ' · #' + run.missingIssue + ' not in stock' : '';
    if(have) return have + ' in stock → order #' + run.issue + ' to go with ' + (run.stockTotal === 1 ? 'it' : 'them') + (sold ? ' (sold ' + sold + ')' : '') + gap;
    return 'sold ' + sold + ' → readers will want #' + run.issue;
  }
  // How many extra regular copies the run is worth: what the last issue
  // sold, else enough to pair with the copies still on the shelf (max 2).
  function runBoost(run){
    if(!run || runOverstocked(run)) return 0;
    if(run.prevSold > 0) return Math.min(6, Math.ceil(run.prevSold));
    if(run.soldTotal > 0) return Math.min(4, Math.ceil(run.soldTotal / Math.max(1, run.sold.length)));
    return Math.min(2, run.prevStock || run.stockTotal);
  }

  const KEY_TEXT = /\b(?:1st|first)\s+(?:full\s+)?appearance|\bintroduc(?:es|ing)\s+(?:the\s+)?(?:new|all-new)\b|\bdebut of\b|\borigin of\b/i;
  const TONE = { hot:'hot', steady:'good', slow:'slow', thin:'dim' };

  // Pills for one FOC title (and each of its covers).
  // family: { title, seriesName, issueNumber, isFirstIssue, isNewSeries, description, variants:[{ id, variantLabel, coverArtist, isIncentive, customerQty, ebayPresold }] }
  // watch: the store's own list -- { artists:[], characters:[], series:[] }
  // -- flagged whatever the sales say ("Peach sells well, don't forget these").
  function watching(watch, kind, label){
    const want = String(label || '').toLowerCase().trim();
    return !!want && ((watch && watch[kind]) || []).some(w => { const k = String(w || '').toLowerCase().trim(); return k && (kind === 'series' ? seriesKey(k) === seriesKey(want) : k === want); });
  }
  function familyIntel(family = {}, demand, watch){
    const pills = [], variants = {};
    const sKey = seriesKey(family.seriesName || family.title);
    const issue = issueNum(family);
    const series = demand ? demand.byKey.get('series|' + sKey) : null;
    const span = demand ? daysLabel(demand.spanDays) : '';
    const firstIssue = !!family.isFirstIssue || issue === '1';
    if(series && series.rating !== 'thin'){
      const text = series.rating === 'hot' ? '🔥 HOT · sold ' + series.sold : series.rating === 'slow' ? '🐢 SLOW · ' + series.stockQty + ' on shelf, ' + series.sold + ' sold' : '✓ STEADY · sold ' + series.sold;
      pills.push({ kind:'series', tone:TONE[series.rating], text, title:'This series here in the last ' + span + ': ' + plural(series.sold, 'copy', 'copies') + ' sold' + (series.ebaySold ? ' (' + series.ebaySold + ' on eBay)' : '') + ', ' + series.stockQty + ' on the shelf now.' });
    } else if(series && series.sold){
      pills.push({ kind:'series', tone:'dim', text:'sold ' + series.sold, title:'This series here in the last ' + span + ': ' + plural(series.sold, 'copy', 'copies') + ' sold, ' + series.stockQty + ' on the shelf.' });
    } else if(firstIssue || family.isNewSeries){
      pills.push({ kind:'series', tone:'new', text:'🆕 NEW SERIES', title:'No sales history here yet -- a new #1.' });
    }
    if(watching(watch, 'series', family.seriesName || family.title)) pills.push({ kind:'watch', tone:'hot', text:'👀 ON YOUR WATCH LIST', title:'You put this series on the watch list.' });
    const run = runFor(series, issue);
    if(run) pills.push({ kind:'run', tone:runOverstocked(run) ? 'slow' : 'run', text:'📚 ' + runText(run), title:'Runs sell better together. Earlier issues of this series: ' + run.inStock.concat(run.sold.filter(r => !r.stock)).map(r => '#' + r.issue + ' -- ' + (r.stock || 0) + ' in stock, ' + (r.sold || 0) + ' sold').join('; ') });
    if(firstIssue) pills.push({ kind:'key', tone:'key', text:'⭐ #1', title:'First issue' });
    if(KEY_TEXT.test(String(family.description || ''))) pills.push({ kind:'key', tone:'key', text:'⭐ 1ST APPEARANCE', title:String(family.description || '').match(KEY_TEXT)[0] });
    const characters = charactersIn(family.seriesName || family.title).map(c => {
      const g = demand && demand.byKey.get('character|' + c.toLowerCase());
      const watched = watching(watch, 'characters', c);
      if(g && (g.sold >= 2 || watched)) return { ...g, watched };
      return watched ? { key:'character|' + c.toLowerCase(), dim:'character', label:c, sold:0, stockQty:0, rating:'thin', watched } : null;
    }).filter(Boolean).sort((a, b) => (b.watched - a.watched) || (b.sold - a.sold));
    const character = characters[0] || null;
    if(character) pills.push({ kind:'character', tone:character.watched ? 'hot' : TONE[character.rating], text:'🦸 ' + character.label + (character.sold ? ' · sold ' + character.sold : '') + (character.watched ? ' · ⭐' : ''), title:(character.sold ? "You've sold " + plural(character.sold, character.label + ' comic') + ' in the last ' + span + (character.stockQty ? ', ' + character.stockQty + ' on the shelf' : '') + '.' : 'No ' + character.label + ' sales on file yet.') + (character.watched ? ' On your watch list.' : '') });
    const partner = series && series.together[0];
    if(partner) pills.push({ kind:'together', tone:'good', text:'🤝 sells with ' + partner.label + ' (' + partner.count + ')', title:'Bought in the same sale ' + plural(partner.count, 'time') + ': ' + series.together.slice(0, 4).map(t => t.label + ' ×' + t.count).join(', ') });
    let presold = 0;
    for(const v of family.variants || []){
      const vp = [];
      const p = num(v.customerQty) + num(v.ebayPresold);
      presold += p;
      if(!isMainCover(v.variantLabel) || v.isIncentive){
        for(const a of splitArtists(v.coverArtist)){
          const g = demand && demand.byKey.get('artist|' + a.toLowerCase());
          const watched = watching(watch, 'artists', a);
          const sold = g ? g.sold : 0;
          if(sold >= 2 || watched) vp.push({ kind:'artist', tone:watched ? 'hot' : (TONE[g.rating] || 'good'), artist:a, rating:watched ? 'hot' : g.rating, sold, watched,
            text:'🎨 ' + a + (sold ? ' · sold ' + sold : '') + (watched ? ' · ⭐' : ''),
            title:(sold ? "You've sold " + plural(sold, a + ' variant cover') + ' in the last ' + span + (g.avgPrice ? ', about $' + g.avgPrice.toFixed(2) + ' each' : '') + (g.stockQty ? ', ' + g.stockQty + ' on the shelf' : '') + '.' : 'No ' + a + ' variant sales on file yet.') + (watched ? ' On your watch list.' : '') });
        }
        for(const t of coverTypes(v.variantLabel)){
          const g = demand && demand.byKey.get('type|' + t.toLowerCase());
          if(g && g.rating === 'hot') vp.push({ kind:'type', tone:'hot', text:'🔥 ' + t + ' sell · ' + g.sold, title:"You've sold " + g.sold + ' ' + t.toLowerCase() + ' in the last ' + span + (g.avgPrice ? ', about $' + g.avgPrice.toFixed(2) + ' each' : '') + '.' });
        }
      }
      if(vp.length) variants[v.id] = vp;
    }
    if(presold) pills.splice(1, 0, { kind:'presold', tone:'presold', text:'📦 ' + presold + ' presold', title:'Website preorders + eBay presales across every cover.' });
    const hotArtists = Object.values(variants).flat().filter(p => p.kind === 'artist' && p.rating === 'hot');
    const score = (series ? ({ hot:3, steady:1, slow:-2, thin:0 })[series.rating] : 0) + (run ? (runOverstocked(run) ? -1 : 2) : 0) + (character && (character.rating === 'hot' || character.watched) ? 1 : 0) + (hotArtists.length ? 1 : 0) + (presold ? 1 : 0);
    return { pills, variants, series, run, runText:runText(run), character, runBoost:runBoost(run), presold, score, hot:score >= 3 || (series && series.rating === 'hot') || (!!run && !runOverstocked(run)) };
  }

  // The week's "what to order" list.
  function whatToOrder(families = [], demand, watch){
    const rows = families.map(f => ({ f, intel:familyIntel(f, demand, watch) }));
    const ordered = f => (f.variants || []).reduce((a, v) => a + num(v.customerQty) + num(v.ebayPresold) + num(v.storeQuantity), 0);
    const hot = rows.filter(r => r.intel.series && r.intel.series.rating === 'hot').sort((a, b) => b.intel.series.sold - a.intel.series.sold);
    const runs = rows.filter(r => r.intel.run && !runOverstocked(r.intel.run)).sort((a, b) => (b.intel.run.soldTotal + b.intel.run.stockTotal) - (a.intel.run.soldTotal + a.intel.run.stockTotal));
    const slow = rows.filter(r => (r.intel.series && r.intel.series.rating === 'slow') || runOverstocked(r.intel.run));
    const artistMap = new Map(), characterMap = new Map();
    for(const r of rows){
      for(const v of r.f.variants || []) for(const p of r.intel.variants[v.id] || []){
        if(p.kind !== 'artist') continue;
        const a = artistMap.get(p.artist) || { label:p.artist, sold:p.sold, rating:p.rating, watched:!!p.watched, covers:[] };
        a.covers.push({ family:r.f, variant:v, ordered:num(v.customerQty) + num(v.ebayPresold) + num(v.storeQuantity) });
        artistMap.set(p.artist, a);
      }
      const c = r.intel.character;
      if(c && (c.sold >= 2 || c.watched)){ const e = characterMap.get(c.label) || { label:c.label, sold:c.sold, rating:c.rating, watched:!!c.watched, titles:[] }; e.titles.push({ family:r.f, ordered:ordered(r.f) }); characterMap.set(c.label, e); }
    }
    const artists = [...artistMap.values()].sort((a, b) => (b.watched - a.watched) || (b.sold - a.sold));
    const characters = [...characterMap.values()].sort((a, b) => (b.watched - a.watched) || (b.sold - a.sold));
    const together = rows.filter(r => r.intel.series && r.intel.series.together.length).map(r => ({ family:r.f, partners:r.intel.series.together }));
    const topArtists = demand ? demand.list.filter(g => g.dim === 'artist' && g.sold >= 2).sort((a, b) => b.sold - a.sold).slice(0, 8) : [];
    const topCharacters = demand ? demand.list.filter(g => g.dim === 'character' && g.sold >= 2).sort((a, b) => b.sold - a.sold).slice(0, 8) : [];
    const topTypes = demand ? demand.list.filter(g => g.dim === 'type' && g.sold >= 2).sort((a, b) => b.sold - a.sold) : [];
    return { rows, hot, runs, slow, artists, characters, together, topArtists, topCharacters, topTypes, spanDays:demand ? demand.spanDays : 0, soldCount:demand ? demand.soldCount : 0, bundles:demand ? demand.bundles : 0 };
  }

  // Ratio book value from what we could find: eBay sold comps first, then
  // PriceCharting, then what other sellers ask (asking prices run high, so
  // a bit under the median ask).
  // A PriceCharting match that prices a 1:25 like a regular copy ($5.17)
  // matched the wrong cover -- don't price a ratio book off it.
  function ratioPcSuspicious({ pcUngraded, activeMedian, activeCount, coverPrice, ratio } = {}){
    const pc = num(pcUngraded);
    if(!(pc > 0)) return false;
    if(num(ratio) >= 10 && num(coverPrice) > 0 && pc < num(coverPrice) * 2.5) return true;
    return num(activeMedian) > 0 && num(activeCount) >= 3 && pc < num(activeMedian) * 0.35;
  }
  // ourSales: { count, median, last } -- what this exact cover sold for here
  // (register + our eBay listing). A real sale beats a guide or an ask.
  function ratioValue({ soldMedian, soldCount, pcUngraded, activeMedian, activeCount, ourSales, coverPrice, ratio } = {}){
    const out = [];
    const ours = typeof ourSales === 'number' ? { count:1, median:ourSales } : (ourSales || {});
    if(num(soldMedian) > 0 && num(soldCount) >= 2) out.push({ price:num(soldMedian), basis:'eBay sold median (' + soldCount + ' sold)' });
    if(num(ours.median) > 0 && num(ours.count) >= 1) out.push({ price:num(ours.median), basis:'what it sold for here (' + plural(num(ours.count), 'sale') + ')' });
    if(num(pcUngraded) > 0 && !ratioPcSuspicious({ pcUngraded, activeMedian, activeCount, coverPrice, ratio })) out.push({ price:num(pcUngraded), basis:'PriceCharting raw' });
    if(num(activeMedian) > 0 && num(activeCount) >= 3) out.push({ price:Math.round(num(activeMedian) * 0.9 * 100) / 100, basis:'90% of the median eBay asking price (' + activeCount + ' listed)' });
    return out[0] || null;
  }

  const api = { RULES, DEFAULT_WATCH, CHARACTERS, seriesKey, parseTitle, isMainCover, charactersIn, splitArtists, artistsInTitle, coverTypes, groupsFor, buildComicDemand, runFor, runText, runBoost, runOverstocked, watching, familyIntel, whatToOrder, ratioValue, ratioPcSuspicious };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ArsCaComicDemand = api;
})(typeof window !== 'undefined' ? window : globalThis);
