// Comic articles at www.themanapocket.com/articles.
//
// Written in Webflow's CMS ("Comic Articles" collection) so they're edited in
// the Webflow Editor like any other content, but rendered here so every
// article can carry a live buy box: each book named in "Books To Promote" is
// looked up in the FOC catalog and the shop on every (cached) render, so the
// button moves on its own from "coming soon" to "Preorder" to "Buy" as the
// book gets solicited, closes at FOC and lands on the shelf.
//
// The collection's slug is "articles", so Webflow's own sitemap lists
// /articles/<slug> -- the same URLs this Worker answers on www.

export const WF_ARTICLES = '6ab95f7914e615c91fc4dbd6';
const PAGE_CACHE_SECONDS = 300;

const F = {
  summary: 'summary', body: 'body', image: 'cover-image', author: 'author',
  published: 'published-on-2', books: 'books-to-promote', facts: 'book-details',
  release: 'main-book-release-date', foc: 'main-book-foc-date',
};

// ---------- text helpers ----------

// "X-Men ’92: Incursions #1" and "X-MEN '92: INCURSIONS #1 COVER A ..." both
// become { series: 'x men 92 incursions', issue: '1' }.
export function comicKey(value) {
  const text = String(value || '').replace(/[’‘`´]/g, "'");
  const match = text.match(/^(.*?)#\s*(\d+)/);
  const norm = s => s.toLowerCase().replace(/'/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!match) return { series: norm(text), issue: '' };
  return { series: norm(match[1]), issue: String(Number(match[2])) };
}
export function sameComic(a, b) {
  const x = comicKey(a), y = comicKey(b);
  return !!x.series && x.series === y.series && x.issue === y.issue;
}
export function parseBookLines(value) {
  return String(value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 12);
}
export function parseFacts(value) {
  return String(value || '').split(/\r?\n/).map(line => {
    const at = line.indexOf(':');
    return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] : null;
  }).filter(pair => pair && pair[0] && pair[1]).slice(0, 20);
}

// The body comes from the store's own Webflow CMS, but it's still rendered on
// the store's domain -- drop anything that could run script.
export function sanitizeRichText(html) {
  return String(html || '')
    .replace(/<(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|meta|link|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["'])\s*(javascript|vbscript|data):[^"']*\2/gi, ' $1="#"');
}
function plainText(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
export function readingMinutes(html) {
  return Math.max(1, Math.round(plainText(html).split(' ').filter(Boolean).length / 230));
}
function dateLabel(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function shortDate(value) {
  if (!value) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00Z' : value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
const money = cents => '$' + (Number(cents || 0) / 100).toFixed(2);

// ---------- Webflow CMS ----------

export function shapeArticle(item) {
  const f = item?.fieldData || {};
  if (!f.slug || !f.name) return null;
  return {
    id: item.id, slug: String(f.slug), title: String(f.name),
    summary: String(f[F.summary] || '').trim(),
    bodyHtml: sanitizeRichText(f[F.body] || ''),
    image: f[F.image]?.url || '', imageAlt: f[F.image]?.alt || '',
    author: String(f[F.author] || '').trim() || 'The Mana Pocket',
    publishedAt: f[F.published] || item.lastPublished || item.createdOn || null,
    updatedAt: item.lastUpdated || item.lastPublished || null,
    books: parseBookLines(f[F.books]),
    facts: parseFacts(f[F.facts]),
    releaseDate: f[F.release] || null, focDate: f[F.foc] || null,
  };
}

async function fetchArticles(env) {
  if (!env.WEBFLOW_TOKEN) return [];
  const headers = { Authorization: `Bearer ${env.WEBFLOW_TOKEN}`, accept: 'application/json' };
  const res = await fetch(`https://api.webflow.com/v2/collections/${WF_ARTICLES}/items/live?limit=100`, { headers });
  if (!res.ok) throw new Error(`Webflow articles ${res.status}`);
  const payload = await res.json().catch(() => null);
  return (payload?.items || [])
    .filter(item => !item.isArchived && !item.isDraft)
    .map(shapeArticle).filter(Boolean)
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
}

// ---------- live book status ----------

function searchWord(book) {
  const { series } = comicKey(book);
  return series.split(' ').filter(w => w.length > 2 && !/^\d+$/.test(w)).sort((a, b) => b.length - a.length)[0] || series.split(' ')[0] || '';
}

// What the button should say for one book, in order of preference:
// in the shop now > open for preorder > preorders closed (on its way) > not
// solicited yet.
export async function bookStatus(env, deps, book, now = Date.now()) {
  const word = searchWord(book);
  const status = { name: book, state: 'coming', href: '', priceCents: 0, cover: '', covers: 0, cutoff: null, onSale: null };
  if (!word) return status;
  const enc = encodeURIComponent;
  const [skuRes, items] = await Promise.all([
    deps.supabaseAdminFetch(env, `comic_skus?store_id=eq.${enc(deps.storeId)}&title=ilike.${enc('*' + word + '*')}&select=id,title,variant_label,cover_image_url,customer_price_cents,customer_enabled,is_incentive,on_sale_date,cycle:foc_cycles(status,customer_cutoff_at)&order=on_sale_date.desc&limit=300`).catch(() => ({ data: [] })),
    deps.listItems(env).catch(() => []),
  ]);
  const skus = (skuRes.data || []).filter(s => sameComic(s.title, book));
  const stock = items.filter(i => deps.isAvailable(i) && sameComic(i.name, book))
    .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  const main = skus.slice().sort((a, b) => {
    const rank = s => (s.is_incentive ? 10 : 0) + (/cover a\b/i.test(s.variant_label || s.title) ? 0 : 1);
    return rank(a) - rank(b);
  })[0];
  if (main) {
    status.cover = main.cover_image_url || '';
    status.onSale = main.on_sale_date || null;
    status.cutoff = main.cycle?.customer_cutoff_at || null;
  }
  if (stock.length) {
    const item = stock[0];
    return { ...status, state: 'in_stock', href: `/item/${enc(item.id)}/${enc(deps.itemSlug(item))}`, priceCents: Math.round(Number(item.price || 0) * 100), cover: item.image || status.cover, covers: stock.length };
  }
  const orderable = skus.filter(s => s.customer_enabled && Number(s.customer_price_cents) > 0 && s.cycle?.status === 'open' && Date.parse(s.cycle?.customer_cutoff_at || '') > now);
  if (orderable.length) {
    const pick = orderable.includes(main) ? main : orderable[0];
    const cheapest = Math.min(...orderable.map(s => Number(s.customer_price_cents)));
    return { ...status, state: 'preorder', href: `/preorder/${enc(pick.id)}`, priceCents: cheapest, covers: skus.length, cutoff: pick.cycle?.customer_cutoff_at || status.cutoff };
  }
  if (skus.length) return { ...status, state: 'closed', covers: skus.length };
  return status;
}

// ---------- rendering ----------

const STYLE = `<style>
.mp-art{max-width:760px;margin:0 auto}
.mp-art h1{font-size:clamp(28px,5vw,44px);line-height:1.08;margin:6px 0 12px;letter-spacing:-.01em}
.mp-art-meta{font-size:13px;opacity:.65;margin-bottom:22px}
.mp-art-hero{width:100%;max-height:520px;object-fit:contain;border-radius:14px;background:#15101f;margin:0 0 24px}
.mp-art-body{font-size:17px;line-height:1.7;color:#e9e4f6}
.mp-art-body h2{font-size:24px;line-height:1.25;margin:38px 0 10px;color:#fff}
.mp-art-body h3{font-size:19px;margin:28px 0 8px;color:#fff}
.mp-art-body p{margin:0 0 16px}
.mp-art-body blockquote{margin:22px 0;padding:6px 0 6px 18px;border-left:4px solid #8bd450;font-size:20px;font-weight:700;color:#fff}
.mp-art-body ul,.mp-art-body ol{padding-left:22px;margin:0 0 16px}.mp-art-body li{margin:0 0 10px}
.mp-art-body img{max-width:100%;height:auto;border-radius:10px}
.mp-art-body a{color:#8bd450}
.mp-buy{display:flex;gap:16px;align-items:center;border:1px solid rgba(139,212,80,.35);background:linear-gradient(135deg,rgba(139,212,80,.10),rgba(143,85,189,.12));border-radius:14px;padding:16px;margin:0 0 26px}
.mp-buy img{width:78px;height:118px;object-fit:cover;border-radius:6px;flex:none;background:#15101f}
.mp-buy-k{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#8bd450;margin-bottom:4px}
.mp-buy-t{font-size:17px;font-weight:800;margin-bottom:4px}
.mp-buy-s{font-size:13px;opacity:.75;margin-bottom:10px}
.mp-btn{display:inline-block;padding:10px 16px;border-radius:999px;background:#8bd450;color:#111!important;font-weight:800;font-size:14px;text-decoration:none;margin:0 8px 6px 0}
.mp-btn.ghost{background:transparent;color:#f2eefc!important;border:1px solid rgba(255,255,255,.3)}
.mp-facts{border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:16px 18px;margin:30px 0}
.mp-facts h2{font-size:18px;margin:0 0 10px}
.mp-facts dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:0;font-size:14px}.mp-facts dt{opacity:.6}.mp-facts dd{margin:0}
.mp-books{margin:30px 0}.mp-books h2{font-size:20px;margin:0 0 12px}
.mp-book-row{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid rgba(255,255,255,.1)}
.mp-book-row b{display:block;font-size:15px}.mp-book-row span{font-size:12px;opacity:.7}
.mp-book-row .mp-btn{margin:0;white-space:nowrap}
.mp-art-list{display:grid;gap:18px;max-width:900px;margin:0 auto}
.mp-art-card{display:flex;gap:18px;padding:16px;border:1px solid rgba(255,255,255,.12);border-radius:14px;text-decoration:none;color:inherit;background:rgba(255,255,255,.03)}
.mp-art-card:hover{border-color:#8bd450}
.mp-art-card img{width:120px;height:160px;object-fit:cover;border-radius:8px;flex:none;background:#15101f}
.mp-art-card h2{font-size:21px;line-height:1.2;margin:2px 0 6px;color:#fff}
.mp-art-card p{margin:0 0 8px;font-size:14px;opacity:.75;line-height:1.5}
@media(max-width:560px){.mp-art-card{flex-direction:column}.mp-art-card img{width:100%;height:190px}.mp-buy{align-items:flex-start}.mp-book-row{flex-direction:column;align-items:flex-start}}
</style>`;

function statusLine(s, esc) {
  if (s.state === 'in_stock') return `In stock now · ${money(s.priceCents)}`;
  if (s.state === 'preorder') return `Preorder open · from ${money(s.priceCents)}${s.covers > 1 ? ` · ${s.covers} covers` : ''}${s.cutoff ? ` · order by ${esc(shortDate(s.cutoff))}` : ''}`;
  if (s.state === 'closed') return `Preorders closed${s.onSale ? ` · in shops ${esc(shortDate(s.onSale))}` : ''} · we'll have copies in the shop`;
  return 'Not open for preorder yet';
}
function button(s) {
  if (s.state === 'in_stock') return `<a class="mp-btn" href="${s.href}">Buy now</a>`;
  if (s.state === 'preorder') return `<a class="mp-btn" href="${s.href}">Preorder now</a>`;
  if (s.state === 'closed') return `<a class="mp-btn ghost" href="/shop?cat=comics">Shop comics</a>`;
  return `<a class="mp-btn ghost" href="/fan-club">Get notified</a>`;
}

export function renderBuyBox(article, main, esc) {
  if (!main) return '';
  let sub = statusLine(main, esc);
  if (main.state === 'coming') {
    const bits = [];
    if (article.focDate) bits.push(`preorders open here before FOC on ${esc(shortDate(article.focDate))}`);
    if (article.releaseDate) bits.push(`in shops ${esc(shortDate(article.releaseDate))}`);
    sub = bits.length ? bits.join(' · ').replace(/^./, c => c.toUpperCase()) : 'Preorders open here as soon as it’s solicited';
  }
  const kicker = { in_stock: 'Get it now', preorder: 'Preorder it', closed: 'On its way', coming: 'Coming soon' }[main.state];
  const actions = button(main) + (main.state === 'coming' ? `<a class="mp-btn ghost" href="/preorders">Browse comic preorders</a>` : '');
  return `<aside class="mp-buy">${main.cover ? `<img src="${esc(main.cover)}" alt="${esc(main.name)} cover" loading="lazy">` : ''}<div><div class="mp-buy-k">${kicker}</div><div class="mp-buy-t">${esc(main.name)}</div><div class="mp-buy-s">${sub}</div>${actions}</div></aside>`;
}

function renderBooks(statuses, esc) {
  if (statuses.length < 2) return '';
  return `<section class="mp-books"><h2>Get the books</h2>${statuses.map(s => `<div class="mp-book-row"><div><b>${esc(s.name)}</b><span>${statusLine(s, esc)}</span></div>${button(s)}</div>`).join('')}</section>`;
}

export function renderArticlePage(article, statuses, related, deps) {
  const esc = deps.esc;
  const main = statuses[0] || null;
  const image = article.image || main?.cover || '';
  const url = `https://www.themanapocket.com/articles/${article.slug}`;
  const facts = article.facts.length
    ? `<section class="mp-facts"><h2>${esc(main?.name || 'Book details')}</h2><dl>${article.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>`
    : '';
  const more = related.length
    ? `<section class="mp-books"><h2>More comic articles</h2>${related.map(a => `<div class="mp-book-row"><div><b><a href="/articles/${esc(a.slug)}" style="color:#fff;text-decoration:none">${esc(a.title)}</a></b><span>${esc(dateLabel(a.publishedAt))}</span></div></div>`).join('')}</section>`
    : '';
  const description = (article.summary || plainText(article.bodyHtml).slice(0, 180)).slice(0, 300);
  return deps.pageShell({
    title: `${article.title} | The Mana Pocket`,
    description,
    canonicalPath: `/articles/${article.slug}`,
    ogImage: image || undefined,
    ogType: 'article',
    jsonLd: [
      {
        '@context': 'https://schema.org', '@type': 'Article', headline: article.title.slice(0, 110), description,
        datePublished: article.publishedAt || undefined, dateModified: article.updatedAt || article.publishedAt || undefined,
        author: article.author === 'The Mana Pocket' ? { '@type': 'Organization', name: 'The Mana Pocket' } : { '@type': 'Person', name: article.author },
        publisher: { '@type': 'Organization', name: 'The Mana Pocket', url: 'https://www.themanapocket.com' },
        image: image ? [image] : undefined, mainEntityOfPage: url,
      },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Comic Articles', item: 'https://www.themanapocket.com/articles' },
        { '@type': 'ListItem', position: 2, name: article.title, item: url },
      ] },
    ],
    bodyHtml: STYLE + `<article class="mp-art"><div class="mp-crumb"><a href="/articles">← Comic articles</a></div>` +
      `<h1>${esc(article.title)}</h1><div class="mp-art-meta">${esc(article.author)}${article.publishedAt ? ` · ${esc(dateLabel(article.publishedAt))}` : ''} · ${readingMinutes(article.bodyHtml)} min read</div>` +
      (article.image ? `<img class="mp-art-hero" src="${esc(article.image)}" alt="${esc(article.imageAlt || article.title)}">` : '') +
      renderBuyBox(article, main, esc) +
      `<div class="mp-art-body">${article.bodyHtml}</div>` + facts + renderBooks(statuses, esc) + more + `</article>`,
  });
}

export function renderArticleList(articles, deps) {
  const esc = deps.esc;
  const cards = articles.map(a => `<a class="mp-art-card" href="/articles/${esc(a.slug)}">${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy">` : ''}<div><div class="mp-meta">${esc(dateLabel(a.publishedAt))}</div><h2>${esc(a.title)}</h2>${a.summary ? `<p>${esc(a.summary)}</p>` : ''}<span style="color:#8bd450;font-weight:700;font-size:14px">Read it →</span></div></a>`).join('');
  return deps.pageShell({
    title: 'Comic Articles | The Mana Pocket',
    description: 'Comic news, upcoming books worth preordering, and collector notes on covers and variants from The Mana Pocket.',
    canonicalPath: '/articles',
    jsonLd: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Comic Articles',
      hasPart: articles.slice(0, 20).map(a => ({ '@type': 'Article', headline: a.title, url: `https://www.themanapocket.com/articles/${a.slug}`, datePublished: a.publishedAt || undefined })) },
    bodyHtml: STYLE + `<div style="max-width:900px;margin:0 auto"><div class="mp-crumb"><a href="/preorders">← Comic preorders</a></div><h1>Comic articles</h1><p class="mp-sub">What we're reading, what's worth preordering, and which covers to watch.</p></div>` +
      (cards ? `<div class="mp-art-list">${cards}</div>` : `<p class="mp-sub" style="text-align:center">The first articles are on their way.</p>`),
  });
}

// ---------- request handling ----------

export async function handleArticlesRequest(request, env, ctx, url, deps) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/articles' && !path.startsWith('/articles/')) return null;
  const cacheKey = new Request(`https://www.themanapocket.com${path}`, { method: 'GET' });
  const cached = url.searchParams.has('fresh') ? null : await caches.default.match(cacheKey);
  if (cached) return cached;
  let articles;
  try { articles = await fetchArticles(env); }
  catch (error) {
    console.error('Articles unavailable:', error.message);
    return new Response(deps.pageShell({ title: 'Comic Articles | The Mana Pocket', description: 'Comic articles from The Mana Pocket.', canonicalPath: '/articles', robotsNoindex: true,
      bodyHtml: `<h1>Comic articles</h1><p class="mp-sub">Articles are temporarily unavailable. Please try again in a minute.</p>` }), { status: 503, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Retry-After': '60' } });
  }
  let html, status = 200;
  if (path === '/articles') html = renderArticleList(articles, deps);
  else {
    const slug = decodeURIComponent(path.slice('/articles/'.length)).split('/')[0];
    const article = articles.find(a => a.slug === slug);
    if (!article) {
      status = 404;
      html = deps.pageShell({ title: 'Article not found | The Mana Pocket', description: 'That article is not available.', canonicalPath: '/articles', robotsNoindex: true,
        bodyHtml: `<div class="mp-crumb"><a href="/articles">← Comic articles</a></div><h1>Article not found</h1><p class="mp-sub">It may have been renamed or taken down. <a href="/articles">See all comic articles</a>.</p>` });
    } else {
      const statuses = await Promise.all(article.books.map(book => bookStatus(env, deps, book).catch(() => ({ name: book, state: 'coming', href: '' }))));
      const related = articles.filter(a => a.slug !== slug).slice(0, 4);
      html = renderArticlePage(article, statuses, related, deps);
    }
  }
  const response = new Response(html, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': `public, max-age=${PAGE_CACHE_SECONDS}` } });
  if (status === 200 && ctx?.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

export async function articleSitemapPaths(env) {
  try { return ['/articles', ...(await fetchArticles(env)).map(a => `/articles/${a.slug}`)]; }
  catch (_) { return ['/articles']; }
}
