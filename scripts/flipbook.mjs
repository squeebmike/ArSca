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
    const covers = (Array.isArray(b?.covers) ? b.covers : []).map(c => ({ label: str(c?.label, 60), image: https(c?.image), price: cents(c?.price), tag: str(c?.tag, 20) })).filter(c => c.image).slice(0, FLIP_COVERS);
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
    b.covers.push({ label, image: r.cover_image_url, price: (Number(r.customer_price_cents) || Number(r.msrp_cents) || 0) / 100, tag: r.is_incentive ? (r.order_requirement || (/\b1:\d+\b/.exec(label) || ['RATIO'])[0]) : '', inc: !!r.is_incentive });
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
.fb.lower .fb-meta{font-size:21px}.fb.lower .fb-dates span{font-size:20px;padding:3px 9px}.fb.lower .fb-syn{font-size:25px}.fb.lower .fb-title{font-size:40px}.fb.lower .fb-thumbs img{width:66px}
`;
export function createFlipbook(doc, { img = u => u } = {}) {
  if (!doc.getElementById('fb-css')) { const st = doc.createElement('style'); st.id = 'fb-css'; st.textContent = FLIP_CSS; doc.head.appendChild(st); }
  const el = doc.createElement('div'); el.className = 'fb full'; el.hidden = true;
  el.innerHTML = '<div class="fb-head"><b>NEW THIS WEEK</b><span></span></div><div class="fb-stage"><img class="fb-cover" alt=""><i class="fb-tag" hidden></i></div><div class="fb-info"><div class="fb-title"></div><div class="fb-var"></div><div class="fb-meta"></div><div class="fb-dates"></div><div class="fb-syn"><div></div></div><div class="fb-thumbs"></div><div class="fb-bar"><i></i></div><div class="fb-count"></div></div>';
  doc.body.appendChild(el);
  const q = s => el.querySelector(s); let flip = null, clock = () => Date.now(), shown = '', raf = 0, lastK = '';
  function paint() {
    raf = 0; if (!flip || !flip.on || !flip.items?.length) { el.hidden = true; return; }
    el.hidden = false; el.className = 'fb ' + (flip.mode === 'lower' ? 'lower' : 'full');
    const at = flipAt(flip, clock()), b = flip.items[at.i], c = b.covers[at.c], key = at.i + ':' + at.c + ':' + (flip.at || 0);
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
  return function draw(next, { now } = {}) { flip = next || null; if (typeof now === 'function') clock = now; const k = JSON.stringify([next?.on, next?.at, next?.mode, next?.secs, next?.title, (next?.items || []).map(b => b.title)]); if (k !== lastK) { lastK = k; shown = ''; } if (raf) clearTimeout(raf); paint(); };
}
