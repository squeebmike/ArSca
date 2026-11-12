// Sean's Substack articles onto the site (store, 2026-11-12: "get his Sean
// Vano articles off Substack and put them on the site with images and his
// words, so he doesn't have to write twice"; Sean is a friend of the store
// and asked for it). A few times a day the Worker reads his Substack feed and
// adds each new post to the Webflow "Comic Articles" collection -- his title,
// words and images, credited to him, with a link back to his Substack. New
// posts arrive as DRAFTS: the store looks them over and publishes in Webflow.
//
// Only the feed's own post (content:encoded) is used: Substack's buttons,
// icons and image-zoom wrappers are dropped; images and captions stay.

export const SUBSTACK_FEEDS = [
  { url: 'https://savanoverbeke.substack.com/feed', author: 'S.A. Van Overbeke', home: 'https://savanoverbeke.substack.com' },
];

const decode = s => String(s || '')
  .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const tagText = (xml, tag) => { const m = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>')); return m ? decode(m[1]).trim() : ''; };

// The feed's posts, newest first, as plain data.
export function parseSubstackFeed(xml) {
  return String(xml || '').split('<item>').slice(1).map(chunk => {
    const it = chunk.split('</item>')[0];
    const link = tagText(it, 'link'), slug = (link.match(/\/p\/([a-z0-9-]+)/i)?.[1] || '').toLowerCase();
    const cover = it.match(/<enclosure\s[^>]*url="([^"]+)"[^>]*type="image\//i)?.[1] || '';
    return {
      guid: tagText(it, 'guid') || link, link, slug,
      title: tagText(it, 'title').replace(/\s+/g, ' ').trim(),
      summary: tagText(it, 'description').replace(/\s+/g, ' ').trim(),
      author: tagText(it, 'dc:creator'),
      publishedAt: (d => isNaN(d) ? null : d.toISOString())(new Date(tagText(it, 'pubDate'))),
      cover: decode(cover),
      html: tagText(it, 'content:encoded'),
    };
  }).filter(p => p.slug && p.title && p.html);
}

// His words and images, without Substack's page furniture.
export function cleanSubstackHtml(html) {
  let s = String(html || '');
  s = s.replace(/<(svg|button|script|style|iframe|form)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<source\b[^>]*>/gi, '').replace(/<\/?picture\b[^>]*>/gi, '');
  // Each image: just the picture and its caption.
  s = s.replace(/<a\b[^>]*class="[^"]*image-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, '$1');
  s = s.replace(/<img\b([^>]*)>/gi, (m, attrs) => {
    const src = attrs.match(/\ssrc="(https:\/\/[^"]+)"/i)?.[1]; if (!src) return '';
    const alt = (attrs.match(/\salt="([^"]*)"/i)?.[1] || '').slice(0, 200);
    return `<img src="${src}" alt="${alt}">`;
  });
  s = s.replace(/<div\b[^>]*class="[^"]*(?:image-link-expand|subscription-widget|share-dialog|button-wrapper|footnote-anchor)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  // Wrapper divs carry no content of their own; paragraphs, headings, lists, figures and quotes stay.
  s = s.replace(/<\/?div\b[^>]*>/gi, '');
  s = s.replace(/\s(class|data-[a-z-]+|style|target|rel|width|height|srcset|sizes)="[^"]*"/gi, '');
  s = s.replace(/<p>\s*<\/p>/gi, '').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// Only his comic posts (store, 2026-11-12: "only the comic ones"): enough
// comic talk in the title and words -- publishers, issues, covers, heroes.
const COMIC_WORDS = /\b(marvel|dc comics|image comics|idw|boom!?|dark horse|variants?|covers? [a-z]\b|comics?|issues?|#\d+|spider-?\w*|x-men|avengers|batman|superman|carnage|venom|wolverine|deadpool|ninja turtles|tmnt|cowabunga|spawn|hulk|thor|daredevil|punisher|witchblade|omnibus|graphic novels?|trade paperback|foc)\b/gi;
export const plainText = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'").replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
const STRONG = /\b(marvel|dc comics|image comics|idw|boom!?|dark horse|#\d+|spider-?\w*|x-men|avengers|batman|superman|carnage|venom|wolverine|deadpool|ninja turtles|tmnt|cowabunga|spawn|hulk|daredevil|punisher|eastman)\b/gi;
export function isComicPost(post) { const t = post.title + ' ' + plainText(post.html); return (t.match(COMIC_WORDS) || []).length >= 5 && (t.match(STRONG) || []).length >= 2; }

// The books an article is about, so its page shows them from the shop and
// the preorders (the "Books To Promote" lines): issues he names ("Avengers
// #1"), and series he names that the store has in stock ("Midnight X-Men").
const norm = s => ' ' + String(s || '').toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9#]+/g, ' ').trim() + ' ';
const seriesOf = t => String(t || '').split('#')[0].replace(/\((?:of \d+|\d{4})\)/gi, '').trim();
export function suggestBooks(post, stockTitles = [], max = 6) {
  const text = norm(post.title + ' ' + plainText(post.html)), out = [], seen = new Set();
  const add = (series, issue) => { const key = norm(series).trim() + '#' + issue; if (!series || seen.has(key) || out.length >= max) return; seen.add(key); out.push(series.trim() + ' #' + issue); };
  // Stock, by series: the issue the store has the most copies of.
  const bySeries = new Map();
  for (const t of stockTitles) { const m = String(t).match(/#\s?(\d{1,4})/); if (!m) continue; const sr = seriesOf(t), k = norm(sr).trim(); if (!k) continue; const e = bySeries.get(k) || { series: sr, issues: new Map() }; e.issues.set(m[1], (e.issues.get(m[1]) || 0) + 1); bySeries.set(k, e); }
  // Named issues first.
  for (const m of (post.title + ' ' + plainText(post.html)).matchAll(/([A-Z][\w.'’:-]*(?:\s+(?:of|the|and|vs\.?|&|[A-Z][\w.'’:-]*)){0,5})\s+#\s?(\d{1,4})\b/g)) {
    const named = norm(m[1]).trim(), hit = [...bySeries.keys()].find(k => k === named || k.endsWith(' ' + named) || named.endsWith(' ' + k));
    // A one-word name that isn't in stock ("Uncanny #19") is too loose to look up.
    if (hit || named.split(' ').length >= 2) add(hit ? bySeries.get(hit).series : m[1], String(Number(m[2])));
  }
  // Series he names that are in stock: two words or more, or named twice.
  for (const [k, e] of bySeries) {
    const n = text.split(' ' + k + ' ').length - 1;
    if (!n || (k.split(' ').length < 2 && n < 2) || k.length < 5) continue;
    const issue = [...e.issues].sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0][0]; // most covers; then the current run's (lower) number over a facsimile
    add(e.series, String(Number(issue)));
  }
  return out;
}

// The Webflow item for a post (the "Comic Articles" collection's fields).
export function substackArticleFields(post, feed, books = []) {
  const by = post.author || feed.author;
  const credit = `<p><em>By ${by}. This article first appeared on <a href="${post.link}">his Substack</a> -- <a href="${feed.home}">subscribe there</a> for more.</em></p>`;
  return {
    name: post.title.slice(0, 250),
    slug: post.slug.slice(0, 100),
    summary: (post.summary || post.title).slice(0, 500),
    body: cleanSubstackHtml(post.html) + '\n' + credit,
    author: by,
    ...(post.cover ? { 'cover-image': { url: post.cover, alt: post.title.slice(0, 120) } } : {}),
    ...(post.publishedAt ? { 'published-on-2': post.publishedAt } : {}),
    ...(books.length ? { 'books-to-promote': books.join('\n') } : {}),
  };
}

// New posts into Webflow as drafts. deps: fetchFeed(url) -> xml,
// existingSlugs() -> Set, create(fieldData), seen(guid) / markSeen(guid).
export async function syncSubstackArticles(deps, { max = 5 } = {}) {
  const out = { checked: 0, created: [], skipped: 0, errors: [] };
  const slugs = await deps.existingSlugs();
  for (const feed of SUBSTACK_FEEDS) {
    let posts = [];
    try { posts = parseSubstackFeed(await deps.fetchFeed(feed.url)); } catch (e) { out.errors.push(feed.url + ': ' + String(e?.message || e).slice(0, 120)); continue; }
    for (const post of posts) {
      out.checked++;
      if (await deps.seen(post.guid) || slugs.has(post.slug)) { out.skipped++; continue; }
      if (out.created.length >= max) break;
      try { await deps.create(substackArticleFields(post, feed)); slugs.add(post.slug); out.created.push(post.slug); await deps.markSeen(post.guid); }
      catch (e) { out.errors.push(post.slug + ': ' + String(e?.message || e).slice(0, 160)); }
    }
  }
  return out;
}

// ── The Worker side ──────────────────────────────────────────────────────────
// deps: { kv, webflow(path, init) -> json, supabaseAdminFetch, storeId }
const WF_ARTICLES_ID = '6ab95f7914e615c91fc4dbd6';
export async function listArticleItems(deps) {
  const out = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const d = await deps.webflow(`/collections/${WF_ARTICLES_ID}/items?limit=100&offset=${offset}`);
    out.push(...(d.items || [])); if ((d.items || []).length < 100) break;
  }
  return out;
}
// The store's in-stock comic titles (names only), for matching books.
export async function stockComicTitles(env, deps) {
  const { data } = await deps.supabaseAdminFetch(env, `inventory_items?store_id=eq.${encodeURIComponent(deps.storeId)}&status=eq.in_stock&data->>category=ilike.*comic*&select=name:data->>name&limit=2000`);
  return (data || []).map(r => String(r.name || '').split(' -- ')[0]).filter(Boolean);
}
// A few times a day: his new comic posts into Webflow as drafts.
export async function runSubstackArticlesSync(env, deps, { force = false, now = Date.now() } = {}) {
  if (!env.WEBFLOW_TOKEN || !deps.kv) return { skipped: 'not connected' };
  const gate = 'substack-articles:last-run';
  if (!force && now - (Number(await deps.kv.get(gate)) || 0) < 3 * 3600 * 1000) return { skipped: 'ran recently' };
  await deps.kv.put(gate, String(now));
  const [items, stock] = await Promise.all([listArticleItems(deps), stockComicTitles(env, deps).catch(() => [])]);
  const slugs = new Set(items.map(i => String(i.fieldData?.slug || '')));
  const out = { checked: 0, created: [], skipped: 0, notComics: 0, errors: [] };
  for (const feed of SUBSTACK_FEEDS) {
    let posts = [];
    try {
      const r = await fetch(feed.url, { headers: { 'User-Agent': 'TheManaPocket/1.0 (themanapocket.com)', Accept: 'application/rss+xml, application/xml' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('feed ' + r.status);
      posts = parseSubstackFeed(await r.text());
    } catch (e) { out.errors.push(String(e?.message || e).slice(0, 120)); continue; }
    for (const post of posts) {
      out.checked++;
      if (slugs.has(post.slug) || await deps.kv.get('substack-seen:' + post.guid)) { out.skipped++; continue; }
      if (!isComicPost(post)) { out.notComics++; await deps.kv.put('substack-seen:' + post.guid, 'not-comic'); continue; }
      if (out.created.length >= 5) break;
      try {
        await deps.webflow(`/collections/${WF_ARTICLES_ID}/items`, { method: 'POST', body: JSON.stringify({ isDraft: true, isArchived: false, fieldData: substackArticleFields(post, feed, suggestBooks(post, stock)) }) });
        slugs.add(post.slug); out.created.push(post.slug); await deps.kv.put('substack-seen:' + post.guid, 'draft');
      } catch (e) { out.errors.push(post.slug + ': ' + String(e?.message || e).slice(0, 160)); }
    }
  }
  return out;
}

// The dashboard's report: each of his articles, on the site or not, its
// views and clicks, and sales of the books it's about since it went up
// (any channel -- shop, website, Whatnot). Not proof the article sold them;
// a guide to which articles move books.
export function articleReport({ items, stats = [], lines = [], sameComic, authors }) {
  const by = new Map();
  for (const s of stats) { const e = by.get(s.slug) || { views: 0, clicks: 0 }; e.views += Number(s.views) || 0; e.clicks += Number(s.clicks) || 0; by.set(s.slug, e); }
  return items.filter(i => authors.includes(String(i.fieldData?.author || ''))).map(i => {
    const f = i.fieldData || {}, books = String(f['books-to-promote'] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const since = Date.parse(f['published-on-2'] || i.createdOn || 0) || 0;
    const sold = lines.filter(l => Date.parse(l.created_at) >= since && books.some(b => sameComic(l.title, b)));
    return {
      id: i.id, slug: f.slug, title: f.name, live: !i.isDraft && !!i.lastPublished, draft: !!i.isDraft, publishedAt: f['published-on-2'] || null,
      image: f['cover-image']?.url || '', books, ...(by.get(f.slug) || { views: 0, clicks: 0 }),
      // What it says, to read before it goes up (the dashboard shows it in a sandbox).
      summary: String(f.summary || ''), body: String(f.body || '').slice(0, 60000),
      sold: sold.reduce((n, l) => n + (Number(l.quantity) || 1), 0), soldTotal: Math.round(sold.reduce((n, l) => n + (Number(l.adjusted_price) || 0) * (Number(l.quantity) || 1), 0) * 100) / 100,
    };
  }).sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
}

// A crawler, by its own name (Google, Bing, social previews, SEO tools, headless browsers).
export const isBot = ua => !ua || /bot|crawl|spider|slurp|mediapartners|lighthouse|headless|preview|facebookexternalhit|embedly|quora link|whatsapp|python-requests|curl|wget|httpclient|ahrefs|semrush|bingpreview/i.test(String(ua));
// Routes: the page's view/click beacon, the report, put on / take off the site, check Substack now.
export async function handleArticleStudio(request, env, url, deps) {
  if (url.pathname === '/public/article-hit' && request.method === 'POST') {
    const slug = String(url.searchParams.get('s') || ''), kind = url.searchParams.get('k') === 'click' ? 'click' : 'view';
    if (!/^[a-z0-9-]{3,120}$/.test(slug)) return new Response(null, { status: 204 });
    // Crawlers that run page scripts (Googlebot and friends) never count.
    if (isBot(request.headers.get('User-Agent'))) return new Response(null, { status: 204 });
    const limited = await deps.enforceUsageLimit(env, 'article-hit:' + (request.headers.get('CF-Connecting-IP') || '') + ':' + slug + ':' + kind, kind === 'view' ? 3 : 10, 3600);
    if (!limited) await deps.supabaseAdminFetch(env, 'rpc/bump_article_stat', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ p_slug: slug, p_kind: kind }) }).catch(() => {});
    return new Response(null, { status: 204 });
  }
  if (!url.pathname.startsWith('/store/articles')) return null;
  const storeId = String(url.searchParams.get('store_id') || request.headers.get('X-Store-Id') || '').trim();
  const auth = await deps.requireStoreUser(request, env, storeId, ['owner', 'admin', 'manager']);
  if (auth.error) return auth.error;
  if (storeId !== deps.storeId) return deps.json({ ok: false, error: 'Articles belong to the main store' }, 403);
  if (!env.WEBFLOW_TOKEN) return deps.json({ ok: false, error: 'Webflow is not connected' }, 503);
  const authors = SUBSTACK_FEEDS.map(f => f.author);
  if (url.pathname === '/store/articles-report' && request.method === 'GET') {
    const items = await listArticleItems(deps);
    const mine = items.filter(i => authors.includes(String(i.fieldData?.author || '')));
    const since = mine.map(i => i.fieldData?.['published-on-2'] || i.createdOn).filter(Boolean).sort()[0] || new Date().toISOString();
    const slugs = mine.map(i => i.fieldData?.slug).filter(Boolean);
    const [stats, lines] = await Promise.all([
      slugs.length ? deps.supabaseAdminFetch(env, `article_stats?slug=in.(${slugs.map(encodeURIComponent).join(',')})&select=slug,views,clicks`).then(r => r.data || []) : [],
      deps.supabaseAdminFetch(env, `pos_sale_lines?store_id=eq.${encodeURIComponent(storeId)}&category=ilike.*comic*&created_at=gte.${encodeURIComponent(since)}&select=title,adjusted_price,quantity,created_at,pos_sales!inner(status)&pos_sales.status=in.(completed,succeeded)&limit=5000`).then(r => r.data || []),
    ]);
    return deps.json({ ok: true, articles: articleReport({ items, stats, lines, sameComic: deps.sameComic, authors }), lastCheck: Number(await deps.kv.get('substack-articles:last-run')) || 0 });
  }
  if (url.pathname === '/store/articles/publish' && request.method === 'POST') {
    const body = await request.json().catch(() => ({})), id = String(body.id || '');
    if (!/^[a-f0-9]{24}$/i.test(id)) return deps.json({ ok: false, error: 'Article id required' }, 400);
    const item = await deps.webflow(`/collections/${WF_ARTICLES_ID}/items/${id}`);
    if (!authors.includes(String(item.fieldData?.author || ''))) return deps.json({ ok: false, error: 'Only Substack articles can be changed here' }, 403);
    if (body.live === false) { await deps.webflow(`/collections/${WF_ARTICLES_ID}/items/${id}/live`, { method: 'DELETE' }); return deps.json({ ok: true, live: false }); }
    await deps.webflow(`/collections/${WF_ARTICLES_ID}/items/${id}`, { method: 'PATCH', body: JSON.stringify({ isDraft: false, fieldData: {} }) });
    await deps.webflow(`/collections/${WF_ARTICLES_ID}/items/publish`, { method: 'POST', body: JSON.stringify({ itemIds: [id] }) });
    return deps.json({ ok: true, live: true, url: 'https://www.themanapocket.com/articles/' + item.fieldData?.slug });
  }
  if (url.pathname === '/store/articles/import' && request.method === 'POST') return deps.json({ ok: true, ...(await runSubstackArticlesSync(env, deps, { force: true })) });
  return deps.json({ ok: false, error: 'Not found' }, 404);
}

// On the article page: count a view, and clicks on its books (buy, preorder, add to cart).
export function articleStatsScript(slug) {
  if (!/^[a-z0-9-]{3,120}$/.test(String(slug || ''))) return '';
  return `<script>(function(){var s=${JSON.stringify(slug)},u=function(k){try{navigator.sendBeacon('/public/article-hit?s='+s+'&k='+k)}catch(e){}};u('view');document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href*="/item/"],a[href*="/preorder/"],.mp-art button');if(a)u('click')},true)})();</script>`;
}
