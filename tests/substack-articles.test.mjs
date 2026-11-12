import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanEditedHtml, handleArticleStudio, isBot, referredSales, parseSubstackFeed, cleanSubstackHtml, isComicPost, suggestBooks, substackArticleFields, articleReport, articleStatsScript, SUBSTACK_FEEDS, runSubstackArticlesSync } from '../scripts/substack-articles.mjs';

// A Substack feed the way Substack writes it (made-up posts).
const img = u => `<div class="captioned-image-container"><figure><a class="image-link image2 is-viewable-img" target="_blank" href="${u}"><div class="image2-inset"><picture><source type="image/webp" srcset="${u} 424w" sizes="100vw"><img src="${u}" width="1456" height="2257" data-attrs="{}" class="sizing-normal" alt="" srcset="${u} 424w" loading="lazy"></picture><div class="image-link-expand"><div class="pencraft"><button class="pencraft icon-container"><svg xmlns="http://www.w3.org/2000/svg"><path d="M1"/></svg></button></div></div></div></a></figure></div>`;
const item = (slug, title, body) => `<item><title><![CDATA[${title}]]></title><description><![CDATA[About ${title}]]></description><link>https://savanoverbeke.substack.com/p/${slug}</link><guid isPermaLink="false">https://savanoverbeke.substack.com/p/${slug}</guid><dc:creator><![CDATA[S.A. Van Overbeke]]></dc:creator><pubDate>Tue, 10 Nov 2026 23:32:52 GMT</pubDate><enclosure url="https://substackcdn.com/image/fetch/cover.jpeg" length="0" type="image/jpeg"/><content:encoded><![CDATA[${body}]]></content:encoded></item>`;
const xml = `<rss><channel><title><![CDATA[S.A. Van Overbeke]]></title>` +
  item('avengers-is-back', 'Avengers: back again!', img('https://substackcdn.com/image/fetch/a.jpeg') + '<p>Marvel brings Avengers #1 this month. Here&#8217;s a Skottie Young variant cover, and the Midnight X-Men tie in. Marvel comics at their best; Spider-Man shows up too.</p>') +
  item('tales-of-a-witcher', 'Tales of a 21st century Witcher', '<p>A walk in the woods and a story about my grandmother.</p>') + `</channel></rss>`;

const posts = parseSubstackFeed(xml);
assert.equal(posts.length, 2);
assert.equal(posts[0].slug, 'avengers-is-back');
assert.equal(posts[0].author, 'S.A. Van Overbeke');
assert.equal(posts[0].cover, 'https://substackcdn.com/image/fetch/cover.jpeg');
assert.equal(posts[0].publishedAt, '2026-11-10T23:32:52.000Z');

// His words and images stay; Substack's buttons, icons and zoom wrappers go.
const clean = cleanSubstackHtml(posts[0].html);
assert.ok(clean.includes('<img src="https://substackcdn.com/image/fetch/a.jpeg" alt="">'));
for (const junk of ['<svg', '<button', '<source', 'srcset', 'image-link', '<div', 'data-attrs', 'class=']) assert.ok(!clean.includes(junk), junk);
assert.ok(clean.includes('Avengers #1'));

// Only the comic posts.
assert.equal(isComicPost(posts[0]), true);
assert.equal(isComicPost(posts[1]), false, 'not his Witcher series');

// The books it's about: issues he names, series he names that are in stock.
const books = suggestBooks(posts[0], ['AVENGERS #1 ARTGERM VARIANT', 'AVENGERS #1', 'MIDNIGHT X-MEN #1 COVER F CLAYTON CRAIN', 'VENOM #1', 'Gambit #3']);
assert.deepEqual(books, ['AVENGERS #1', 'MIDNIGHT X-MEN #1']);

// The Webflow item: his title, words, images, the books, credit and a link back.
const f = substackArticleFields(posts[0], SUBSTACK_FEEDS[0], books);
assert.equal(f.slug, 'avengers-is-back'); assert.equal(f.author, 'S.A. Van Overbeke');
assert.equal(f['books-to-promote'], 'AVENGERS #1\nMIDNIGHT X-MEN #1');
assert.equal(f['cover-image'].url, 'https://substackcdn.com/image/fetch/cover.jpeg');
assert.ok(f.body.includes('first appeared on <a href="https://savanoverbeke.substack.com/p/avengers-is-back">his Substack</a>'));

// The import: drafts only, comic posts only, never twice.
{
  const kv = new Map(), made = [];
  const deps = { kv: { get: async k => kv.get(k), put: async (k, v) => { kv.set(k, v); } }, storeId: 's',
    supabaseAdminFetch: async () => ({ data: [{ name: 'AVENGERS #1' }] }),
    webflow: async (path, init) => { if (init?.method === 'POST') { made.push(JSON.parse(init.body)); return {}; } return { items: [] }; } };
  const realFetch = globalThis.fetch; globalThis.fetch = async () => new Response(xml);
  try {
    const r = await runSubstackArticlesSync({ WEBFLOW_TOKEN: 'x' }, deps, { force: true });
    assert.deepEqual(r.created, ['avengers-is-back']); assert.equal(r.notComics, 1);
    assert.equal(made.length, 1); assert.equal(made[0].isDraft, true, 'arrives as a draft');
    const again = await runSubstackArticlesSync({ WEBFLOW_TOKEN: 'x' }, deps, { force: true });
    assert.deepEqual(again.created, [], 'never twice');
    assert.equal((await runSubstackArticlesSync({ WEBFLOW_TOKEN: 'x' }, deps)).skipped, 'ran recently');
  } finally { globalThis.fetch = realFetch; }
}

// The report: views, clicks, and website orders that came through the article.
const items = [
  { id: 'a1', isDraft: false, lastPublished: '2026-11-11', fieldData: { slug: 'avengers-is-back', name: 'Avengers', author: 'S.A. Van Overbeke', 'published-on-2': '2026-11-10T00:00:00Z', 'books-to-promote': 'AVENGERS #1', body: '<p>Hi</p>' } },
  { id: 'a2', isDraft: true, fieldData: { slug: 'other', name: 'Other', author: 'S.A. Van Overbeke', 'published-on-2': '2026-11-12T00:00:00Z' } },
  { id: 'x', isDraft: false, fieldData: { slug: 'store-guide', name: 'Guide', author: 'The Mana Pocket' } },
];
const referred = referredSales(
  [{ referral: 'article:avengers-is-back', sale_id: 's1' }, { referral: 'article:avengers-is-back', sale_id: 's2' }, { referral: 'article:avengers-is-back', sale_id: 'unpaid' }],
  [{ id: 's1' }, { id: 's2' }],
  [{ sale_id: 's1', quantity: 2, adjusted_price: 5, category: 'Comic' }, { sale_id: 's1', quantity: 1, adjusted_price: 6.5, category: 'Shipping' }, { sale_id: 's2', quantity: 1, adjusted_price: 20, category: 'Pokemon TCG' }, { sale_id: 'unpaid', quantity: 9, adjusted_price: 9, category: 'Comic' }]);
const rep = articleReport({ items, authors: ['S.A. Van Overbeke'], referred, stats: [{ slug: 'avengers-is-back', views: 10, clicks: 2 }, { slug: 'avengers-is-back', views: 5, clicks: 1 }] });
assert.equal(rep.length, 2, 'only his articles');
const av = rep.find(a => a.slug === 'avengers-is-back');
assert.equal(av.live, true); assert.equal(av.views, 15); assert.equal(av.clicks, 3);
assert.equal(av.orders, 2, 'paid orders only'); assert.equal(av.sold, 3, 'every item in them, not shipping'); assert.equal(av.soldTotal, 30);
assert.equal(av.body, '<p>Hi</p>');
assert.equal(rep.find(a => a.slug === 'other').draft, true); assert.equal(rep.find(a => a.slug === 'other').orders, 0);
// The page remembers the article for the cart (7 days, this browser).
assert.ok(articleStatsScript('avengers-is-back').includes("localStorage.setItem('mp_article_ref'"));
assert.ok(fs.readFileSync('cloudflare-worker-full.js', 'utf8').includes("/^article:[a-z0-9-]{3,120}$/.test(String(body.referral || ''))"), 'record-order keeps the article');

// The page counts a view and clicks on its books.
assert.ok(articleStatsScript('avengers-is-back').includes("/public/article-hit?s="));
assert.equal(articleStatsScript('bad slug"><script>'), '');
const page = fs.readFileSync('scripts/comic-articles.mjs', 'utf8');
assert.ok(page.includes('+ articleStatsScript(article.slug)'));
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.ok(worker.includes("runSubstackArticlesSync(env, articleStudioDeps(env))") && worker.includes("url.pathname === '/public/article-hit'"));
assert.ok(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8').includes('scripts/substack-articles.mjs'));
// Crawlers don't count; people do.
for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0)', 'facebookexternalhit/1.1', 'Mozilla/5.0 HeadlessChrome/120', '', undefined]) assert.equal(isBot(ua), true, String(ua));
for (const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36']) assert.equal(isBot(ua), false, ua);
// Its own ARTICLES tab under MORE (2026-11-12), not inside Orders.
{ const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8'), html = fs.readFileSync('dashboard.html', 'utf8');
  assert.ok(app.includes("['articles', 'ARTICLES']") && app.includes("if(name === 'articles') setTimeout(()=>renderSubstackArticles(), 0);"));
  const tab = html.slice(html.indexOf('<div id="tab-articles"'), html.indexOf('<!-- DATABASE VIEWER TAB'));
  assert.ok(tab.includes('id="substack-articles-list"')); assert.equal(html.split('id="substack-articles-list"').length, 2, 'only in the ARTICLES tab'); }
// The article can be read in the dashboard before it goes up, in a sandbox.
{ const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
  assert.ok(app.includes('📖 READ IT') && app.includes('<iframe sandbox="allow-popups allow-popups-to-escape-sandbox"') && !/<iframe sandbox="[^"]*allow-scripts/.test(app));
}
// Editing from the dashboard (2026-11-12): what's kept, what's dropped, and the save.
assert.equal(cleanEditedHtml('<div>Hi <b>there</b></div><p onclick="x()">ok <a href="javascript:alert(1)">bad</a> <a href="https://x">good</a></p><script>alert(1)</script><img src="https://a/b.jpg" onerror="x" style="width:1px" alt="A"><p><br></p><span style="color:red">t</span><h2>Head</h2>'),
  '<p>Hi <b>there</b></p><p>ok <a>bad</a> <a href="https://x">good</a></p><img src="https://a/b.jpg" alt="A">t<h2>Head</h2>');
{
  const calls = [], item = { id: 'a'.repeat(24), isDraft: true, lastPublished: null, fieldData: { slug: 'sw-1', author: 'S.A. Van Overbeke' } };
  const deps = { storeId: 'store', json: (d, status = 200) => new Response(JSON.stringify(d), { status }), kv: { get: async () => null },
    requireStoreUser: async () => ({ role: 'owner' }), supabaseAdminFetch: async () => ({ data: [] }),
    webflow: async (path, init = {}) => { calls.push([init.method || 'GET', path, init.body ? JSON.parse(init.body) : null]); return init.method ? {} : item; } };
  const save = body => handleArticleStudio(new Request('https://w/store/articles/save?store_id=store', { method: 'POST', body: JSON.stringify(body) }), { WEBFLOW_TOKEN: 'x' }, new URL('https://w/store/articles/save?store_id=store'), deps).then(r => r.json());
  let r = await save({ id: item.id, title: '  New  title ', summary: 'S', books: 'SPIDER-WOMAN #1\n\n  Venom #1 ', body: '<p onclick="x">Words</p><img src="https://cdn/a.jpg">' });
  assert.equal(r.ok, true); assert.equal(r.live, false, 'a draft stays a draft');
  const patch = calls.find(c => c[0] === 'PATCH')[2].fieldData;
  assert.deepEqual(patch, { name: 'New title', summary: 'S', 'books-to-promote': 'SPIDER-WOMAN #1\nVenom #1', body: '<p>Words</p><img src="https://cdn/a.jpg">' });
  assert.ok(!calls.some(c => c[1].endsWith('/items/publish')));
  calls.length = 0; r = await save({ id: item.id, title: 'T', publish: true });
  assert.equal(r.live, true); assert.ok(calls.some(c => c[1].endsWith('/items/publish')), 'SAVE & PUT ON SITE publishes');
  item.isDraft = false; item.lastPublished = '2026-11-12'; calls.length = 0; await save({ id: item.id, title: 'T' });
  assert.ok(calls.some(c => c[1].endsWith('/items/publish')), 'a live article updates live');
  assert.equal((await save({ id: item.id, title: '   ' })).ok, false, 'a title is required');
  item.fieldData.author = 'The Mana Pocket'; assert.equal((await save({ id: item.id, title: 'T' })).ok, false, 'only his articles here');
}
{ const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
  assert.ok(app.includes('✏️ EDIT') && app.includes("'/store/articles/save'") && app.includes('function articleEditSafe(') && app.includes('SAVE &amp; PUT ON SITE')); }
console.log('Substack articles: feed, clean-up, comic posts only, books, drafts, report and counters passed');
