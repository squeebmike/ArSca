// THE FOC FLIPBOOK (store, 2026-11-14: "we can do the FOC scroll instead of share screen. Have it scroll through books?
// Flip through books? Show the synopsis. All automatically?"). This week's new books on the overlay, one at a time: the
// cover turns like a page, each of the book's covers takes its turn, with the title, price, credits, the FOC and
// on-sale dates and the synopsis (scrolling up slowly when it's long). Every overlay shows the same page at the same
// moment -- the page comes from the studio's clock, not from anything random. Full screen or the lower half.
// 2026-11-19: "select a FOC week and it shows all covers in alphabetical order" -- a whole week, every cover.
export const FLIP_MAX = 250, FLIP_COVERS = 16, FLIP_SYN = 520;
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const https = u => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length < 600 ? u : '';
const cents = v => { const n = Math.round(Number(v) * 100) / 100; return Number.isFinite(n) && n > 0 && n < 100000 ? n : 0; };
// The room's check on what the remote sends (and the remote's own shaping of it).
export function cleanFlipItems(list) {
  const out = [];
  for (const b of (Array.isArray(list) ? list : []).slice(0, FLIP_MAX)) {
    const covers = (Array.isArray(b?.covers) ? b.covers : []).map(c => ({ label: str(c?.label, 60), image: https(c?.image), price: cents(c?.price), tag: str(c?.tag, 20), artist: str(c?.artist, 60) })).filter(c => c.image).slice(0, FLIP_COVERS);
    const title = str(b?.title, 90); if (!title || !covers.length) continue;
    out.push({ title, covers, publisher: str(b?.publisher, 40), writer: str(b?.writer, 80), artist: str(b?.artist, 80), coverArtist: str(b?.coverArtist, 80), foc: str(b?.foc, 10), onSale: str(b?.onSale, 10), synopsis: str(b?.synopsis, FLIP_SYN) });
  }
  return out;
}
// A SKU title split into the book ("AMAZING SPIDER-MAN #1007") and its cover ("COVER C MARK BUCKINGHAM 1:25 VARIANT"):
// everything after the issue number (and "(OF 6)" / "(ONE SHOT)") is the cover.
export function splitSkuTitle(title) {
  const t = str(title, 160), m = /^(.*?#\s?\d+(?:\.\d+)?[A-Z]?(?:\s*\((?:OF \d+|ONE[- ]SHOT)\))*)\s+(.+)$/i.exec(t);
  if (!m) return { book: t, cover: '' };
  const c = m[2].replace(/^(?:CVR|COVER)\s+/i, '').replace(/\s*\(MR\)\s*$/i, '').trim();
  return { book: m[1].trim(), cover: /^[A-Z]\b/i.test(c) ? 'COVER ' + c : c };
}
const LABEL_JUNK = /^(variant title|cover a|non-book item)?$/i;
// Comic SKU rows (one per cover) to books (one per issue, its covers inside): A to Z, Cover A first, the ratio covers last.
export function booksFromSkus(rows) {
  const by = new Map();
  for (const r of rows || []) {
    if (!https(r.cover_image_url)) continue;
    const { book, cover } = splitSkuTitle(r.title), t = str(book, 90); if (!t) continue;
    const key = t.toUpperCase();
    if (!by.has(key)) by.set(key, { title: t, covers: [], publisher: r.publisher, writer: r.writer, artist: r.interior_artist, coverArtist: r.cover_artist, foc: r.foc_date, onSale: r.on_sale_date, synopsis: r.description });
    const b = by.get(key); if (!b.synopsis && r.description) b.synopsis = r.description;
    const label = cover || (LABEL_JUNK.test(String(r.variant_label || '').trim()) ? '' : r.variant_label) || 'Cover A';
    b.covers.push({ label, image: r.cover_image_url, price: (Number(r.customer_price_cents) || Number(r.msrp_cents) || 0) / 100, tag: r.is_incentive ? (r.order_requirement || (/\b1:\d+\b/.exec(label) || ['RATIO'])[0]) : '', inc: !!r.is_incentive, artist: str(r.cover_artist, 60) });
  }
  const az = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
  return [...by.values()].sort((a, b) => az(a.title, b.title)).map(b => ({ ...b, covers: b.covers.sort((a, c) => Number(a.inc) - Number(c.inc) || az(a.label, c.label)) }));
}
// A book's time on screen: its seconds, longer when it has many covers (each cover gets a third of the seconds at least).
export const bookMs = (flip, b) => Math.max(5, Math.min(60, Number(flip?.secs) || 12)) * 1000 * Math.max(1, (b?.covers?.length || 1) / 3);
// Which book and which of its covers is up, from the studio clock: each book gets `secs`, split between its covers.
export function flipAt(flip, now) {
  const n = flip?.items?.length || 0; if (!n) return null;
  const durs = flip.items.map(b => bookMs(flip, b)), total = durs.reduce((a, d) => a + d, 0);
  let into = Math.max(0, now - (Number(flip.at) || 0)) % total, i = 0;
  while (into >= durs[i]) { into -= durs[i]; i++; }
  const per = durs[i], covers = flip.items[i].covers.length, c = Math.min(covers - 1, Math.floor(into / (per / covers)));
  return { i, c, into, per, n };
}
// THE FOC SHOW (store, 2026-11-19: "I want 1 through 5. I want them automated. I'm ordering ... keep them engaged
// while I order and talk. No button pressing from me other than to change the display type"). Besides the flipbook:
//   wall    -- every cover tiled, a spotlight moving cover to cover
//   versus  -- two covers of one book side by side: "which would you grab? 1 or 2 in chat"
//   mystery -- a cover starts blurred and sharpens; the book is named at the end
//   artist  -- "who drew this cover?", the artist named at the end
//   wanted  -- the top 5 books in the shop's FOC order so far (no quantities)
// AUTO MIX runs them in turn on the studio clock. Which book a game uses steps through the week in order -- nothing is
// drawn, and every overlay shows the same thing at the same moment. Chat answers in Whatnot's chat; nothing is counted.
export const SHOWS = ['auto', 'flip', 'wall', 'versus', 'mystery', 'artist', 'wanted'];
export const SEG_MS = { flip: 75000, wall: 40000, versus: 25000, mystery: 25000, artist: 25000, wanted: 20000 };
const AUTO_ORDER = ['flip', 'wall', 'versus', 'flip', 'mystery', 'wanted', 'flip', 'artist', 'wall', 'versus', 'flip', 'mystery', 'artist', 'wanted'];
// The wall (2026-11-23: "should show all the covers and slide across screen"): rows of whole covers sliding by, a
// page of covers per turn (the next turn, the next page), every overlay in step.
export const WALL_PAGE = 90, WALL_COVER_MS = 2400;
export const cleanWanted = list => (Array.isArray(list) ? list : []).map(w => ({ title: str(w?.title, 90), image: https(w?.image) })).filter(w => w.title && w.image).slice(0, 5);
// What each game can use this week.
export function gamePools(flip) {
  const items = flip?.items || [], covers = items.flatMap((b, i) => b.covers.map((c, j) => ({ i, j, b, c })));
  return { covers, versus: items.filter(b => b.covers.length >= 2), mystery: covers.filter(x => x.c.tag).length >= 3 ? covers.filter(x => x.c.tag) : covers,
    artist: covers.filter(x => x.c.artist || (x.b.covers.length === 1 && x.b.coverArtist)), wanted: flip?.wanted || [] };
}
const canShow = (kind, pools) => kind === 'flip' || kind === 'wall' ? pools.covers.length > 0 : (pools[kind] || []).length > 0;
// What's on screen now: { kind, k (how many of this kind came before), into, len, flipAt (the flipbook's own clock) }.
export function segmentAt(flip, now) {
  if (!flip?.items?.length) return null;
  const t = Math.max(0, now - (Number(flip.at) || 0)), show = SHOWS.includes(flip.show) ? flip.show : 'flip', pools = gamePools(flip);
  if (show !== 'auto') {
    if (show === 'flip' || !canShow(show, pools)) return { kind: show === 'flip' || show === 'wanted' ? show : 'flip', k: 0, into: t, len: Infinity, flipAt: flip.at };
    const len = SEG_MS[show]; return { kind: show, k: Math.floor(t / len), into: t % len, len, flipAt: flip.at };
  }
  const order = AUTO_ORDER.filter(k => canShow(k, pools)), cycle = order.reduce((a, k) => a + SEG_MS[k], 0);
  const round = Math.floor(t / cycle); let into = t % cycle, n = 0;
  while (into >= SEG_MS[order[n]]) { into -= SEG_MS[order[n]]; n++; }
  const kind = order[n], per = order.filter(k => k === kind).length, before = order.slice(0, n).filter(k => k === kind).length;
  // The flipbook carries on where it left off: its clock only runs during its own turns.
  const flipPerRound = order.filter(k => k === 'flip').length * SEG_MS.flip, flipBefore = order.slice(0, n).filter(k => k === 'flip').length * SEG_MS.flip;
  const flipT = round * flipPerRound + flipBefore + (kind === 'flip' ? into : 0);
  return { kind, k: round * per + before, into, len: SEG_MS[kind], flipAt: now - flipT };
}
// The game's picks, stepping through the week (a stride so it moves around the alphabet).
export function gamePick(flip, seg) {
  const p = gamePools(flip), at = (list, step) => list.length ? list[(seg.k * step) % list.length] : null;
  if (seg.kind === 'versus') { const b = at(p.versus, 7); if (!b) return null; const other = 1 + (seg.k % (b.covers.length - 1)); return { b, a: b.covers[0], z: b.covers[other] }; }
  if (seg.kind === 'mystery') return at(p.mystery, 11);
  if (seg.kind === 'artist') return at(p.artist, 13);
  if (seg.kind === 'wall') { const pages = Math.max(1, Math.ceil(p.covers.length / WALL_PAGE)), page = seg.k % pages; return { page, pages, tiles: p.covers.slice(page * WALL_PAGE, page * WALL_PAGE + WALL_PAGE) }; }
  if (seg.kind === 'wanted') return { list: p.wanted };
  return null;
}
const money = n => n > 0 ? '$' + (n % 1 ? n.toFixed(2) : n.toFixed(0)) : '';
const md = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? (+m[2]) + '/' + (+m[3]) : ''; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const FLIP_CSS = `
.fb{position:absolute;z-index:40;box-sizing:border-box;display:flex;gap:28px;padding:30px;background:linear-gradient(160deg,#141826,#0b0d14 70%);border:8px solid #0b0612;border-radius:30px;box-shadow:0 0 0 5px #ffd84a,0 30px 80px #000c;color:#f4f1e8;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.fb[hidden]{display:none}
.fb.full{left:24px;top:24px;right:24px;bottom:24px;flex-direction:row;flex-wrap:wrap;align-content:flex-start;row-gap:18px}.fb.full .fb-head{flex:0 0 100%}.fb.full .fb-stage,.fb.full .fb-info{height:calc(100% - 70px)}
.fb.lower{left:24px;right:24px;bottom:24px;height:900px;flex-direction:row}
.fb-head{display:flex;align-items:center;gap:14px}.fb.lower .fb-head{display:none}
.fb-head b{background:#ffd84a;color:#141018;border-radius:12px;padding:8px 16px;font:900 34px/1 system-ui;letter-spacing:1px}.fb-head span{font:800 30px system-ui;color:#aab0bf}
.fb-stage{position:relative;perspective:1800px;display:flex;justify-content:center;flex:0 0 auto}
.fb.lower .fb-stage{width:540px;height:100%}
.fb-cover{height:100%;max-width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:16px;box-shadow:0 20px 50px #000d;transform-origin:left center;backface-visibility:hidden}
.fb-cover.turn{animation:fb-turn .9s cubic-bezier(.3,.7,.3,1)}
@keyframes fb-turn{0%{transform:rotateY(-95deg);filter:brightness(.4)}60%{filter:brightness(1.15)}100%{transform:rotateY(0)}}
.fb-tag{position:absolute;top:18px;left:50%;transform:translateX(-50%);background:#e8213a;color:#fff;border-radius:10px;padding:6px 14px;font:900 28px system-ui;box-shadow:0 4px 14px #0009}
.fb-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;min-height:0}
.fb-title{font:900 54px/1.05 system-ui;letter-spacing:.5px}.fb.lower .fb-title{font-size:46px}
.fb-var{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font:800 32px system-ui;color:#ffd84a}.fb-var i{font-style:normal;background:#ffd84a;color:#141018;border-radius:10px;padding:4px 14px;font:900 38px system-ui}
.fb-meta{font:700 26px/1.35 system-ui;color:#aab4c8}.fb-meta b{color:#f4f1e8}
.fb-dates{display:flex;gap:12px;flex-wrap:wrap}.fb-dates span{background:#1f2636;border:2px solid #3a4560;border-radius:10px;padding:4px 12px;font:800 26px system-ui}
.fb-syn{position:relative;flex:1;min-height:0;overflow:hidden;font:500 30px/1.45 system-ui;color:#e6e9f0;-webkit-mask-image:linear-gradient(#000 85%,#0000)}
.fb-syn div{will-change:transform}
.fb-thumbs{display:flex;gap:12px;flex-wrap:wrap}.fb-thumbs.many{gap:8px}.fb-thumbs.many img{width:58px;border-width:3px}.fb-thumbs img{width:86px;aspect-ratio:2/3;object-fit:cover;border-radius:8px;opacity:.45;border:4px solid transparent;transition:all .3s}.fb-thumbs img.on{opacity:1;border-color:#ffd84a;transform:translateY(-6px)}
.fb-bar{height:10px;background:#1f2636;border-radius:6px;overflow:hidden}.fb-bar i{display:block;height:100%;background:linear-gradient(90deg,#9dff6a,#ffd84a)}
.fb-count{font:800 24px system-ui;color:#7f889c;text-align:right}
.fb.gaming>:not(.fbg){display:none!important}.fbg{display:none}.fb.gaming .fbg{display:flex;flex-direction:column;position:absolute;inset:30px;gap:18px}
.fbg-head{display:flex;align-items:center;gap:16px}.fbg-head b{background:#e8213a;color:#fff;border-radius:12px;padding:8px 18px;font:900 40px/1 system-ui;letter-spacing:1px}.fbg-head span{font:800 32px system-ui;color:#ffd84a}
.fbg-q{font:900 52px/1.1 system-ui;text-align:center}.fbg-q em{font-style:normal;color:#ffd84a}
.fbg-main{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;gap:40px}
.fbg-card{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;gap:10px}.fbg-card img{height:calc(100% - 44px);width:auto;aspect-ratio:2/3;flex:none;object-fit:cover;border-radius:16px;box-shadow:0 20px 50px #000d}
.fbg-card i{position:absolute;top:-14px;left:-14px;width:84px;height:84px;border-radius:50%;background:#ffd84a;color:#141018;font:900 56px/84px system-ui;text-align:center;font-style:normal;box-shadow:0 6px 18px #000a}
.fbg-card span{font:800 26px system-ui;color:#aab4c8;max-width:560px;text-align:center}
.fbg-vs{font:900 90px system-ui;color:#e8213a;text-shadow:0 0 30px #e8213a88}
.fbg-ans{font:900 46px/1.1 system-ui;text-align:center;color:#9dff6a;min-height:52px}
.fbg-bar{height:14px;background:#1f2636;border-radius:8px;overflow:hidden}.fbg-bar i{display:block;height:100%;background:linear-gradient(90deg,#e8213a,#ffd84a)}
.fbg-wall{flex:1;min-height:0;display:flex;flex-direction:column;gap:14px;overflow:hidden}.fbg-row{flex:1;min-height:0;overflow:hidden;position:relative}.fbg-track{display:flex;gap:14px;height:100%;width:max-content;will-change:transform}.fbg-track img{height:100%;aspect-ratio:2/3;object-fit:cover;border-radius:10px;box-shadow:0 8px 24px #000c;flex:none}
.fbg-wanted{flex:1;min-height:0;display:flex;align-items:flex-end;justify-content:center;gap:26px}.fbg-wanted div{display:flex;flex-direction:column;align-items:center;gap:8px;width:300px}.fbg-wanted img{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:12px;box-shadow:0 14px 40px #000c}
.fbg-wanted b{font:900 60px system-ui;color:#ffd84a}.fbg-wanted span{font:800 24px/1.2 system-ui;text-align:center}.fbg-wanted div:nth-child(1){order:2;width:360px}.fbg-wanted div:nth-child(2){order:1}.fbg-wanted div:nth-child(3){order:3}.fbg-wanted div:nth-child(4){order:0;width:240px}.fbg-wanted div:nth-child(5){order:4;width:240px}
.fb.lower .fbg-q{font-size:40px}.fb.lower .fbg-wanted div{width:220px}.fb.lower .fbg-wanted div:nth-child(1){width:260px}
.fb.lower .fb-meta{font-size:21px}.fb.lower .fb-dates span{font-size:20px;padding:3px 9px}.fb.lower .fb-syn{font-size:25px}.fb.lower .fb-title{font-size:40px}.fb.lower .fb-thumbs img{width:66px}
`;
export function createFlipbook(doc, { img = u => u } = {}) {
  if (!doc.getElementById('fb-css')) { const st = doc.createElement('style'); st.id = 'fb-css'; st.textContent = FLIP_CSS; doc.head.appendChild(st); }
  const el = doc.createElement('div'); el.className = 'fb full'; el.hidden = true;
  el.innerHTML = '<div class="fb-head"><b>NEW THIS WEEK</b><span></span></div><div class="fb-stage"><img class="fb-cover" alt=""><i class="fb-tag" hidden></i></div><div class="fb-info"><div class="fb-title"></div><div class="fb-var"></div><div class="fb-meta"></div><div class="fb-dates"></div><div class="fb-syn"><div></div></div><div class="fb-thumbs"></div><div class="fb-bar"><i></i></div><div class="fb-count"></div></div>';
  doc.body.appendChild(el);
  const game = doc.createElement('div'); game.className = 'fbg'; el.appendChild(game);
  const q = s => el.querySelector(s); let flip = null, clock = () => Date.now(), shown = '', raf = 0, lastK = '', gameKey = '';
  const gq = s => game.querySelector(s), cnt = ms => Math.max(0, Math.ceil(ms / 1000));
  // One of the games: built once when it comes up, then the countdown, blur and spotlight move on the clock.
  function paintGame(seg, now) {
    const key = seg.kind + ':' + seg.k + ':' + (flip.at || 0) + ':' + (flip.wanted || []).map(w => w.title).join('|');
    const pick = gamePick(flip, seg); if (!pick) { gameKey = ''; return false; }
    if (key !== gameKey) {
      gameKey = key; const head = (b, s) => '<div class="fbg-head"><b>' + b + '</b><span>' + esc(s || flip.title || '') + '</span></div>';
      if (seg.kind === 'versus') game.innerHTML = head('COVER VS COVER', pick.b.title) + '<div class="fbg-q">WHICH ONE WOULD YOU GRAB? <em>TYPE 1 OR 2 IN CHAT!</em></div><div class="fbg-main"><div class="fbg-card"><i>1</i><img src="' + esc(img(pick.a.image)) + '" alt=""><span>' + esc(pick.a.label) + '</span></div><div class="fbg-vs">VS</div><div class="fbg-card"><i>2</i><img src="' + esc(img(pick.z.image)) + '" alt=""><span>' + esc(pick.z.label) + '</span></div></div><div class="fbg-ans"></div><div class="fbg-bar"><i></i></div>';
      else if (seg.kind === 'mystery') game.innerHTML = head('MYSTERY COVER', '') + '<div class="fbg-q">WHAT BOOK IS THIS? <em>GUESS IN CHAT!</em></div><div class="fbg-main"><div class="fbg-card"><img class="blur" src="' + esc(img(pick.c.image)) + '" alt=""></div></div><div class="fbg-ans"></div><div class="fbg-bar"><i></i></div>';
      else if (seg.kind === 'artist') game.innerHTML = head('NAME THAT ARTIST', pick.b.title) + '<div class="fbg-q">NAME THE ARTIST! <em>TYPE IT IN CHAT!</em></div><div class="fbg-main"><div class="fbg-card"><img src="' + esc(img(pick.c.image)) + '" alt=""></div></div><div class="fbg-ans"></div><div class="fbg-bar"><i></i></div>';
      else if (seg.kind === 'wall') { const rows = flip.mode === 'lower' ? 2 : 3, per = Math.ceil(pick.tiles.length / rows);
        game.innerHTML = head('THE WALL', 'EVERY COVER THIS WEEK' + (pick.pages > 1 ? ' · ' + (pick.page + 1) + ' OF ' + pick.pages : '')) + '<div class="fbg-wall">'
          + Array.from({ length: rows }, (_, r) => { const row = pick.tiles.slice(r * per, r * per + per); return '<div class="fbg-row"><div class="fbg-track" data-n="' + row.length + '" data-dir="' + (r % 2 ? 1 : -1) + '">' + Array.from({ length: Math.max(2, 2 * Math.ceil(12 / Math.max(1, row.length))) }, () => row).flat().map(x => '<img src="' + esc(img(x.c.image)) + '" alt="">').join('') + '</div></div>'; }).join('') + '</div><div class="fbg-ans"></div>'; }
      else if (seg.kind === 'wanted') game.innerHTML = head('MOST WANTED', 'TOP OF THE ORDER SO FAR') + (pick.list.length ? '<div class="fbg-wanted">' + pick.list.map((w, k) => '<div><b>#' + (k + 1) + '</b><img src="' + esc(img(w.image)) + '" alt=""><span>' + esc(w.title) + '</span></div>').join('') + '</div>' : '<div class="fbg-q">THE ORDER IS JUST GETTING STARTED -- <em>TELL US WHAT YOU WANT IN CHAT!</em></div>');
    }
    const left = seg.len - seg.into, reveal = Number.isFinite(seg.len) && left <= 6000, bar = gq('.fbg-bar i'), ans = gq('.fbg-ans');
    if (bar) bar.style.width = (Math.min(1, seg.into / Math.max(1, seg.len - 6000)) * 100).toFixed(1) + '%';
    if (seg.kind === 'versus' && ans) ans.textContent = reveal ? 'TELL US IN CHAT: 1 OR 2?' : 'VOTING ' + cnt(left - 6000) + 's';
    if (seg.kind === 'mystery') { const im = gq('img'), f = Math.min(1, seg.into / (seg.len - 6000)); if (im) im.style.filter = reveal ? 'none' : 'blur(' + (34 * (1 - f) + 6).toFixed(1) + 'px) saturate(' + (0.4 + 0.6 * f).toFixed(2) + ')'; if (ans) ans.textContent = reveal ? "IT'S " + pick.b.title + '!' : 'REVEAL IN ' + cnt(left - 6000) + 's'; }
    if (seg.kind === 'artist' && ans) ans.textContent = reveal ? 'COVER BY ' + (pick.c.artist || pick.b.coverArtist).toUpperCase() + '!' : 'ANSWER IN ' + cnt(left - 6000) + 's';
    if (seg.kind === 'wall') {
      // Each row slides on the studio clock (the same spot on every overlay); odd rows the other way. The cover passing
      // the middle of the top row is named underneath.
      let named = null;
      game.querySelectorAll('.fbg-track').forEach((tr, r) => { const n = Number(tr.dataset.n) || 1, im = tr.querySelector('img'); if (!im) return;
        const tw = im.offsetWidth + 14, cycle = n * WALL_COVER_MS, f = (seg.into % cycle) / cycle, dist = f * n * tw, dir = Number(tr.dataset.dir);
        tr.style.transform = 'translateX(' + (dir < 0 ? -dist : dist - n * tw) + 'px)';
        if (r === 0 && tw > 14) { const mid = (tr.parentElement.clientWidth / 2 + dist) / tw; named = Math.floor(mid) % n; } });
      const per = Math.ceil(pick.tiles.length / (flip.mode === 'lower' ? 2 : 3)), x = named == null ? null : pick.tiles[Math.min(named, per - 1)];
      if (ans && x) ans.textContent = x.b.title + ' · ' + x.c.label; }
    return true;
  }
  function paint() {
    raf = 0; if (!flip || !flip.on || !flip.items?.length) { el.hidden = true; return; }
    el.hidden = false;
    const now = clock(), seg = segmentAt(flip, now), gaming = seg && seg.kind !== 'flip' && paintGame(seg, now);
    el.className = 'fb ' + (flip.mode === 'lower' ? 'lower' : 'full') + (gaming ? ' gaming' : '');
    if (gaming) { raf = setTimeout(paint, seg.kind === 'wall' ? 33 : 120); return; } // the wall slides smoothly
    const at = flipAt({ ...flip, at: seg ? seg.flipAt : flip.at }, now), b = flip.items[at.i], c = b.covers[at.c], key = at.i + ':' + at.c + ':' + (flip.at || 0);
    if (key !== shown) {
      const newBook = !shown.startsWith(at.i + ':'); shown = key;
      const im = q('.fb-cover'); im.classList.remove('turn'); void im.offsetWidth; im.src = img(c.image); im.classList.add('turn');
      const tg = q('.fb-tag'); tg.hidden = !c.tag; tg.textContent = c.tag;
      q('.fb-var').innerHTML = esc(c.label) + (money(c.price) ? ' <i>' + money(c.price) + '</i>' : '');
      q('.fb-thumbs').classList.toggle('many', b.covers.length > 6);
      q('.fb-thumbs').innerHTML = b.covers.length > 1 ? b.covers.map((o, k) => '<img src="' + esc(img(o.image)) + '" class="' + (k === at.c ? 'on' : '') + '" alt="">').join('') : '';
      if (newBook) {
        q('.fb-head span').textContent = flip.title || '';
        q('.fb-title').textContent = b.title;
        q('.fb-meta').innerHTML = [b.publisher && '<b>' + esc(b.publisher) + '</b>', b.writer && 'Writer <b>' + esc(b.writer) + '</b>', b.artist && 'Art <b>' + esc(b.artist) + '</b>', b.coverArtist && 'Cover <b>' + esc(b.coverArtist) + '</b>'].filter(Boolean).join(' · ');
        q('.fb-dates').innerHTML = (b.foc ? '<span>ORDER BY ' + md(b.foc) + '</span>' : '') + (b.onSale ? '<span>IN STORES ' + md(b.onSale) + '</span>' : '') + '<span>PREORDER WITH US</span>';
        q('.fb-syn div').textContent = b.synopsis || 'No synopsis from the publisher yet -- ask us about it!';
      }
    }
    // The synopsis rolls up slowly over the book's time when it doesn't fit; the bar shows the time left on this book.
    const box = q('.fb-syn'), inner = q('.fb-syn div'), over = Math.max(0, inner.scrollHeight - box.clientHeight + 30), f = Math.min(1, Math.max(0, (at.into / at.per - 0.15) / 0.75));
    inner.style.transform = 'translateY(' + (-over * f) + 'px)';
    q('.fb-bar i').style.width = (at.into / at.per * 100).toFixed(1) + '%'; q('.fb-count').textContent = (b.covers.length > 1 ? 'COVER ' + (at.c + 1) + ' OF ' + b.covers.length + '  ·  ' : '') + 'BOOK ' + (at.i + 1) + ' OF ' + at.n;
    raf = setTimeout(paint, 120); // ~8 times a second is smooth enough for a slow roll
  }
  return function draw(next, { now } = {}) { flip = next || null; if (typeof now === 'function') clock = now; const k = JSON.stringify([next?.on, next?.at, next?.mode, next?.secs, next?.title, next?.show, (next?.items || []).map(b => b.title)]); if (k !== lastK) { lastK = k; shown = ''; gameKey = ''; } if (raf) clearTimeout(raf); paint(); };
}
