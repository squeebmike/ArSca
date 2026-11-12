import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSubstackFeed, cleanSubstackHtml, isComicPost, suggestBooks, substackArticleFields, articleReport, articleStatsScript, SUBSTACK_FEEDS, runSubstackArticlesSync } from '../scripts/substack-articles.mjs';
import { sameComic } from '../scripts/comic-articles.mjs';

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

// The report: views, clicks and sales of its books since it went up.
const items = [
  { id: 'a1', isDraft: false, lastPublished: '2026-11-11', fieldData: { slug: 'avengers-is-back', name: 'Avengers', author: 'S.A. Van Overbeke', 'published-on-2': '2026-11-10T00:00:00Z', 'books-to-promote': 'AVENGERS #1' } },
  { id: 'a2', isDraft: true, fieldData: { slug: 'other', name: 'Other', author: 'S.A. Van Overbeke', 'published-on-2': '2026-11-12T00:00:00Z' } },
  { id: 'x', isDraft: false, fieldData: { slug: 'store-guide', name: 'Guide', author: 'The Mana Pocket' } },
];
const rep = articleReport({ items, authors: ['S.A. Van Overbeke'], sameComic,
  stats: [{ slug: 'avengers-is-back', views: 10, clicks: 2 }, { slug: 'avengers-is-back', views: 5, clicks: 1 }],
  lines: [{ title: 'AVENGERS #1 SKOTTIE YOUNG VARIANT', adjusted_price: 6, quantity: 1, created_at: '2026-11-11T01:00:00Z' }, { title: 'AVENGERS #1', adjusted_price: 5, quantity: 2, created_at: '2026-11-09T01:00:00Z' }, { title: 'VENOM #1', adjusted_price: 5, quantity: 1, created_at: '2026-11-11T01:00:00Z' }] });
assert.equal(rep.length, 2, 'only his articles');
const av = rep.find(a => a.slug === 'avengers-is-back');
assert.equal(av.live, true); assert.equal(av.views, 15); assert.equal(av.clicks, 3);
assert.equal(av.sold, 1, 'only after it went up, only its books'); assert.equal(av.soldTotal, 6);
assert.equal(rep.find(a => a.slug === 'other').draft, true);

// The page counts a view and clicks on its books.
assert.ok(articleStatsScript('avengers-is-back').includes("/public/article-hit?s="));
assert.equal(articleStatsScript('bad slug"><script>'), '');
const page = fs.readFileSync('scripts/comic-articles.mjs', 'utf8');
assert.ok(page.includes('+ articleStatsScript(article.slug)'));
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.ok(worker.includes("runSubstackArticlesSync(env, articleStudioDeps(env))") && worker.includes("url.pathname === '/public/article-hit'"));
assert.ok(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8').includes('scripts/substack-articles.mjs'));
console.log('Substack articles: feed, clean-up, comic posts only, books, drafts, report and counters passed');
