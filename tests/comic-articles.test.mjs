import assert from 'node:assert/strict';
import fs from 'node:fs';
import { comicKey, sameComic, parseBookLines, parseFacts, sanitizeRichText, shapeArticle, bookStatus, renderBuyBox, handleArticlesRequest, readingMinutes } from '../scripts/comic-articles.mjs';

// --- Matching a book name to catalog titles -------------------------------------
assert.deepEqual(comicKey("X-Men ’92: Incursions #1"), { series: 'x men 92 incursions', issue: '1' });
assert.ok(sameComic('X-Men: Incursions #1', 'X-MEN: INCURSIONS #1 COVER A BY GLEB MELNIKOV'));
assert.ok(sameComic('Spider-Man: Incursions #1', 'SPIDER-MAN INCURSIONS #1 CVR A'), 'punctuation differences between distributors still match');
assert.ok(!sameComic("X-Men '92: Incursions #1", 'X-MEN: INCURSIONS #1 COVER A'), "X-Men '92 is a different book from X-Men");
assert.ok(!sameComic('X-Men: Incursions #1', 'X-MEN: INCURSIONS #2 COVER A'), 'issue number must match');
assert.ok(sameComic('Batman #01', 'BATMAN #1 COVER A'), 'leading zeros ignored');
assert.deepEqual(parseBookLines(' A #1 \n\nB #2\n'), ['A #1', 'B #2']);
assert.deepEqual(parseFacts('Publisher: Marvel\nnot a fact\nFOC: Nov 23, 2026'), [['Publisher', 'Marvel'], ['FOC', 'Nov 23, 2026']]);
console.log('Comic article matching checks passed');

// --- The body is rendered on the store's domain: no script ---------------------
const dirty = '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><iframe src="//evil"></iframe><img src=x onerror=alert(1)>';
const clean = sanitizeRichText(dirty);
assert.doesNotMatch(clean, /<script|onclick|onerror|javascript:|<iframe/i);
assert.match(clean, /<p>Hi<\/p>/);
assert.equal(readingMinutes('<p>' + 'word '.repeat(690) + '</p>'), 3);
console.log('Rich text sanitizing checks passed');

// --- Buy box states ------------------------------------------------------------
const cycle = (status, cutoff) => ({ status, customer_cutoff_at: cutoff });
const future = '2099-01-01T00:00:00Z', past = '2000-01-01T00:00:00Z';
const deps = (skus, items = []) => ({
  storeId: 'store-1', supabaseAdminFetch: async (env, path) => { assert.match(path, /store_id=eq\.store-1/); return { data: skus }; },
  listItems: async () => items, isAvailable: i => i.available !== false, itemSlug: () => 'slug',
});
{
  const s = await bookStatus({}, deps([
    { id: 'b', title: 'X-MEN: INCURSIONS #1 COVER B', variant_label: 'COVER B', customer_price_cents: 599, customer_enabled: true, cycle: cycle('open', future) },
    { id: 'a', title: 'X-MEN: INCURSIONS #1 COVER A BY GLEB MELNIKOV', variant_label: 'COVER A BY GLEB MELNIKOV', cover_image_url: 'https://c/a.jpg', customer_price_cents: 499, customer_enabled: true, cycle: cycle('open', future) },
    { id: 'z', title: "X-MEN '92: INCURSIONS #1 COVER A", variant_label: 'COVER A', customer_price_cents: 499, customer_enabled: true, cycle: cycle('open', future) },
    { id: 'r', title: 'X-MEN: INCURSIONS #1 1:25 VARIANT', variant_label: '1:25', is_incentive: true, customer_price_cents: 0, customer_enabled: true, cycle: cycle('open', future) },
  ]), 'X-Men: Incursions #1');
  assert.equal(s.state, 'preorder');
  assert.equal(s.href, '/preorder/a', 'links the main (Cover A) cover');
  assert.deepEqual(s.options.map(o => o.id), ['a', 'b', 'r'], 'every cover of this book, main cover first, the incentive last; not the other series');
  assert.deepEqual(s.options.map(o => o.kind), ['pick', 'pick', 'request'], 'incentives are requests, not purchases');
  assert.equal(s.options[0].label, 'Cover A by Gleb Melnikov');
  assert.equal(s.options[0].cover, 'https://c/a.jpg');
  assert.equal(s.priceCents, 499);
  assert.equal(s.covers, 3, "the '92 book is not counted as a cover of this one");
  assert.equal(s.cover, 'https://c/a.jpg');
}
{
  const s = await bookStatus({}, deps([{ id: 'a', title: 'X-MEN: INCURSIONS #1 COVER A', variant_label: 'COVER A', customer_price_cents: 499, customer_enabled: true, on_sale_date: '2026-11-18', cycle: cycle('open', past) }]), 'X-Men: Incursions #1');
  assert.equal(s.state, 'closed', 'past the order cutoff');
}
{
  const s = await bookStatus({}, deps([{ id: 'a', title: 'X-MEN: INCURSIONS #1 COVER A', customer_price_cents: 499, customer_enabled: true, cycle: cycle('open', future) }],
    [{ id: 'i1', name: 'X-Men: Incursions #1 Cover A', price: 5, image: 'https://i/1.jpg' }, { id: 'i2', name: 'X-Men: Incursions #1 Cover B', price: 6, available: false }]), 'X-Men: Incursions #1');
  assert.equal(s.state, 'in_stock', 'on the shelf beats preorder');
  assert.equal(s.href, '/item/i1/slug');
  assert.equal(s.priceCents, 500);
}
{
  const s = await bookStatus({}, deps([]), "X-Men '92: Incursions #1");
  assert.equal(s.state, 'coming');
  const esc = v => String(v);
  const box = renderBuyBox({ focDate: '2026-11-23T12:00:00Z', releaseDate: '2027-01-06T12:00:00Z' }, s, esc);
  assert.match(box, /Coming soon/);
  assert.match(box, /Preorders open here before FOC on Nov 23, 2026 · in shops Jan 6, 2027/);
}
console.log('Buy box state checks passed');

// --- Pages -----------------------------------------------------------------------
const item = { id: 'w1', lastPublished: '2026-09-27T18:00:00Z', fieldData: { name: 'Big <News>', slug: 'big-news', summary: 'Short.', body: '<h2>Part</h2><p>Text</p><script>x</script>', 'published-on-2': '2026-09-27T12:00:00Z', 'books-to-promote': 'X-Men: Incursions #1\nNope #9', 'book-details': 'Price: $4.99' } };
assert.equal(shapeArticle({ fieldData: { name: 'no slug' } }), null);
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async url => { assert.match(String(url), /collections\/6ab95f7914e615c91fc4dbd6\/items\/live/, 'only published (live) items are read'); return { ok: true, json: async () => ({ items: [item, { id: 'd', isDraft: true, fieldData: { name: 'Draft', slug: 'draft' } }] }) }; };
const pageDeps = { ...deps([{ id: 'a', title: 'X-MEN: INCURSIONS #1 COVER A', customer_price_cents: 499, customer_enabled: true, cycle: cycle('open', future) }]),
  esc: v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  pageShell: o => JSON.stringify({ title: o.title, canonicalPath: o.canonicalPath, ogType: o.ogType, robotsNoindex: !!o.robotsNoindex, jsonLd: o.jsonLd }) + o.bodyHtml };
const get = async path => handleArticlesRequest({ method: 'GET' }, { WEBFLOW_TOKEN: 't' }, null, new URL('https://www.themanapocket.com' + path), pageDeps);
{
  // Two books on the page, one inventory load: each is the whole catalog.
  let loads = 0;
  const counted = { ...pageDeps, listItems: async () => { loads++; return []; } };
  const res = await handleArticlesRequest({ method: 'GET' }, { WEBFLOW_TOKEN: 't' }, null, new URL('https://www.themanapocket.com/articles/big-news'), counted);
  assert.equal(res.status, 200);
  assert.equal(loads, 1, 'store inventory is loaded once per article page, not once per book');
}
{
  const res = await get('/articles/big-news');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /"canonicalPath":"\/articles\/big-news"/);
  assert.match(html, /"@type":"Article"/);
  assert.match(html, /<h1>Big &lt;News&gt;<\/h1>/, 'title is escaped');
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /href="#book-x-men-incursions-1">Pick your cover/, 'buy box jumps to the cover picker');
  assert.match(html, /id="book-x-men-incursions-1"[\s\S]*data-picker data-cutoff="[^"]+"[\s\S]*data-sku="a"/, 'every open cover is pickable on the article');
  assert.doesNotMatch(html, /href="\/preorder\/a"/, 'no trip to another page to preorder');
  assert.match(html, /<script>\(function\(\)\{var C=\{"api":"https:\/\/still-resonance-4f87\.swarnerauto\.workers\.dev"[^}]*"store":"store-1"\}/, 'picker script saves to this store');
  assert.match(html, /\?'\/public\/preorders\/waitlist':'\/public\/preorders\/picks'\),\{method:req\?'POST':'PATCH'/, 'covers save to the account pulls API; incentives go to the request list');
  assert.match(html, /mp-foc-session-v1/, 'same sign-in as the preorders page');
  assert.match(html, /Nope #9[\s\S]*Get notified/);
  assert.match(res.headers.get('Cache-Control'), /max-age=300/);
}
{
  const html = await (await get('/articles')).text();
  assert.match(html, /href="\/articles\/big-news"/);
  assert.doesNotMatch(html, /Draft/, 'drafts never show');
}
{
  const res = await get('/articles/missing');
  assert.equal(res.status, 404);
  assert.match(await res.text(), /"robotsNoindex":true/);
}
assert.equal(await handleArticlesRequest({ method: 'GET' }, {}, null, new URL('https://www.themanapocket.com/articlesx'), pageDeps), null);
console.log('Article page checks passed');

// --- Wiring --------------------------------------------------------------------
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /handleArticlesRequest\(request, env, ctx, url/);
assert.match(worker, /\.\.\.\(await articleSitemapPaths\(env\)\)/, 'articles are in sitemap-pages.xml');
assert.match(worker, /\['\/articles', 'Comic Articles'\]/, 'nav link');
assert.match(fs.readFileSync('wrangler.deploy.jsonc', 'utf8'), /"www\.themanapocket\.com\/articles\*"/);
console.log('Comic article wiring checks passed');
