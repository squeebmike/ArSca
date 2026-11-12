// What every article page adds on top of the writer's words (store,
// 2026-11-12: "the goal is to sell books from people getting to the site via
// the article ... seo / aeo ... books close to the article's books, like a
// you may also love, similar cover artist"):
//   1. Image descriptions (alt text) where the writer left none -- image
//      search, screen readers.
//   2. The first mention of each of the article's books links to it.
//   3. Quick answers (an FAQ, marked up for search and answer engines) from
//      the store's own catalog: when it came out, who drew the covers, where
//      to get it.
//   4. "You may also love": in-stock books by the same cover artists, from
//      the same series, with the same characters.
// Nothing is made up: answers and picks come only from the catalog and stock.

const plain = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'").replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
const norm = s => ' ' + String(s || '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9#]+/g, ' ').trim() + ' ';
const attr = s => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// "SPIDER-WOMAN #1" reads as "Spider-Woman #1"; names already in mixed case stay as they are.
export const nice = s => { s = String(s || '').trim(); return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s\-:(/])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bJr\b/g, 'Jr') : s; };
const clip = (s, n) => { s = String(s || '').trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };

// 1. Alt text: an image with none gets the article's book (or title) and the
// sentence right after it when that sentence talks about the art.
export function fillImageAlts(html, title, bookName = '') {
  let n = 0;
  const lead = nice(bookName) || title;
  return String(html || '').replace(/<img\b([^>]*)>/gi, (tag, attrs, at, all) => {
    n++;
    if (/\salt\s*=\s*"[^"]+"/i.test(attrs)) return tag;
    const after = plain(all.slice(at + tag.length, at + tag.length + 700)).split(/(?<=[.!?])\s/)[0] || '';
    const alt = /\b(cover|variant|art|artist|page|panel|interior|drawn|by)\b/i.test(after) && after.length > 8 ? `${lead}: ${clip(after, 110)}` : `${lead} (image ${n})`;
    return '<img' + attrs.replace(/\salt\s*=\s*("[^"]*"|'[^']*')/i, '') + ` alt="${attr(clip(alt, 125))}">`;
  });
}

// 2. Link the first mention of each book in the text (never inside a link or a tag).
export function linkBookMentions(html, statuses) {
  let out = String(html || '');
  for (const s of statuses) {
    if (!s.href) continue;
    const m = String(s.name || '').match(/^(.*?)#\s*(\d+)/); if (!m) continue;
    const words = m[1].trim().split(/[\s:]+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[-\\s]?'));
    if (!words.length) continue;
    const re = new RegExp('\\b(' + words.join('[\\s:]+') + '\\s*#\\s?' + Number(m[2]) + ')\\b(?!\\d)', 'i');
    let inLink = 0, done = false;
    out = out.split(/(<[^>]+>)/).map(part => {
      if (part.startsWith('<')) { if (/^<a\b/i.test(part)) inLink++; else if (/^<\/a>/i.test(part)) inLink = Math.max(0, inLink - 1); return part; }
      if (done || inLink) return part;
      return part.replace(re, hit => { done = true; return `<a href="${attr(s.href)}">${hit}</a>`; });
    }).join('');
  }
  return out;
}

// Cover artists named in variant titles ("COVER E MARK BROOKS VARIANT",
// "CVR B J SCOTT CAMPBELL CARD STOCK VAR", "Variant B (Eastman & Bishop)").
const NOT_ARTIST = /\b(cover|cvr|variant|var|card|stock|foil|virgin|ratio|inc|incv|blank|sketch|wraparound|connecting|glow|in|the|dark|full|art|homage|momo|tone|workout|legacy|part|left|middle|right|main|dressed|unlimited|polybagged|nsfw|mr|of|edition|facsimile|gatefold|triptych|animation|line|spot|bad|seeds|batman|showcase|dc|marvel|idw|reveal|foc|bagged|collectible|special|midnight|horror|style|color|block|red|true|believers|blind|bag|collection|noir|sensational|ri)\b/gi;
export function coverArtists(name) {
  const tail = String(name || '').split(/#\s*\d+/)[1] || '';
  return tail.replace(/\b(?:cover|cvr|variant|var)\s+[a-z]\b/gi, ' ').replace(/^\s*[a-z]\s+/i, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\d+:\d+|\(\s*of \d+\s*\)|\d+/g, ' ').split(/[(),&\/]|\s-\s|\band\b/i)
    .map(p => p.replace(NOT_ARTIST, ' ').replace(/[^a-z' .-]/gi, ' ').replace(/(^|\s)-+|-+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(p => p.length >= 4 && p.split(' ').some(w => w.length >= 3));
}
const seriesOf = name => norm(String(name || '').split('#')[0].replace(/\((?:of \d+|\d{4})\)/gi, '')).trim();
const CHARACTERS = ['spider-man', 'spider-woman', 'venom', 'carnage', 'x-men', 'wolverine', 'deadpool', 'hulk', 'avengers', 'daredevil', 'black cat', 'captain america', 'iron man', 'batman', 'superman', 'wonder woman', 'harley quinn', 'joker', 'catwoman', 'poison ivy', 'spawn', 'teenage mutant ninja turtles', 'tmnt', 'thundercats', 'godzilla', 'transformers', 'power rangers', 'doctor doom', 'gambit', 'storm', 'magneto', 'punisher', 'thor', 'mary jane', 'miles morales', 'nightwing', 'supergirl', 'sonic'];

// 4. "You may also love": in-stock books close to the article's, best first.
export function alsoLove({ text, statuses = [], comics = [], max = 8 }) {
  const t = norm(text), shown = new Set(statuses.flatMap(s => (s.stock || []).map(c => c.id)));
  const bookSeries = new Set(statuses.map(s => seriesOf(s.name)).filter(Boolean));
  const chars = CHARACTERS.filter(c => t.includes(norm(c)));
  const scored = [];
  for (const c of comics) {
    if (shown.has(c.id) || !(Number(c.price) > 0)) continue;
    const artist = coverArtists(c.name).find(a => a.split(' ').length >= 2 ? t.includes(norm(a)) : (a.length >= 5 && t.includes(norm(a))));
    const sameSeries = bookSeries.has(seriesOf(c.name));
    const ch = chars.find(x => norm(c.name).includes(norm(x)));
    const score = (artist ? 3 : 0) + (sameSeries ? 2 : 0) + (ch ? 1 : 0);
    if (score) scored.push({ c, score, why: artist ? 'Cover by ' + nice(artist) : sameSeries ? 'More ' + nice(String(c.name).split('#')[0]) : 'More ' + nice(ch.toUpperCase()) });
  }
  // Best first; one copy per book (series + issue), so it isn't eight covers of one comic.
  const seen = new Set(), out = [];
  for (const s of scored.sort((a, b) => b.score - a.score || Number(a.c.price) - Number(b.c.price))) {
    const key = seriesOf(s.c.name) + '#' + (String(s.c.name).match(/#\s*(\d+)/)?.[1] || '') + (s.score >= 3 ? '|' + s.c.id : '');
    if (seen.has(key)) continue; seen.add(key); out.push(s); if (out.length >= max) break;
  }
  return out;
}

// 3. Quick answers from the catalog (and the FAQ markup for search engines).
const day = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }); };
export function quickAnswers(statuses, now = Date.now()) {
  const qa = [];
  for (const s of statuses.slice(0, 3)) {
    const name = nice(s.name); if (!name) continue;
    if (s.onSale) { const past = Date.parse(s.onSale) <= now; qa.push([`When ${past ? 'did' : 'does'} ${name} come out?`, `${name} ${past ? 'went' : 'goes'} on sale ${day(s.onSale)}.`]); }
    const artists = [...new Set((s.stock || []).flatMap(c => coverArtists(c.name)).map(nice))].slice(0, 8);
    if (artists.length > 1) qa.push([`Who drew the ${name} variant covers?`, `The covers The Mana Pocket has in stock are by ${artists.slice(0, -1).join(', ')} and ${artists.at(-1)}.`]);
    if (s.state === 'in_stock' && s.stock?.length) { const low = Math.min(...s.stock.map(c => Number(c.price) || Infinity)); qa.push([`Where can I buy ${name}?`, `The Mana Pocket has ${s.stock.length} ${s.stock.length === 1 ? 'copy' : 'covers'} of ${name} in stock${Number.isFinite(low) ? ` from $${low.toFixed(2)}` : ''}, with pickup in Washington or shipping.`]); }
    else if (s.state === 'preorder') qa.push([`Can I preorder ${name}?`, `Yes. The Mana Pocket takes preorders for ${name}${s.cutoff ? ` until ${day(s.cutoff)}` : ''}.`]);
  }
  return qa.slice(0, 6);
}
export function renderQuickAnswers(qa, esc) {
  if (!qa.length) return '';
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
  return `<section class="mp-faq"><h2>Quick answers</h2>${qa.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}</section>` +
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
}
