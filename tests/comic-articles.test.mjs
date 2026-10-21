import assert from 'node:assert/strict';
import {fetchArticles} from '../scripts/comic-articles.mjs';
import {clearPublicCatalogBackoff} from '../scripts/public-catalog-cache.mjs';
import fs from 'node:fs';
import { releaseGuide, renderReleaseInventory, comicKey, sameComic, parseBookLines, parseFacts, sanitizeRichText, shapeArticle, bookStatus, renderBuyBox, handleArticlesRequest, readingMinutes, articleTopics, relatedArticles, renderArticlePage } from '../scripts/comic-articles.mjs';

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
{
  const pokemon={slug:'buying-pokemon-singles',title:'Buying Pokémon singles',books:[]};
  const mixed={slug:'raw-vs-graded-sports-pokemon-cards',title:'Raw or graded sports and Pokémon cards',books:[]};
  const sports={slug:'topps-holiday-baseball',title:'Topps Holiday Baseball',books:[]};
  const comic={slug:'batman-25',title:'Batman #25',books:['Batman #25']};
  assert.deepEqual(articleTopics(mixed),['pokemon','sports-cards']);
  assert.deepEqual(relatedArticles(pokemon,[comic,sports,mixed,pokemon],2),[mixed,comic],'same-collection reading precedes newer unrelated articles and excludes itself');
  assert.deepEqual(articleTopics({title:'Collector notes',bodyHtml:'Pokémon MTG Batman'}),[],'incidental body mentions do not determine shopping destinations');
  const html=renderArticlePage({...pokemon,summary:'Pick a card',bodyHtml:'<p>Read this.</p>',facts:[],author:'The Mana Pocket'},[],[],{esc:String,pageShell:o=>o.bodyHtml});
  assert.match(html,/aria-label="Explore this collection"[\s\S]*href="\/category\/pokemon"[\s\S]*href="\/pokemon-new-releases"/);
  assert.doesNotMatch(html,/Shop sports cards|Shop comics/,'Pokémon article navigation stays relevant');
}

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
{
  const unpriced=[0,null,undefined,-1,'not-priced',Infinity].map((price,n)=>({id:'unpriced-'+n,name:'BATMAN #25',price,image:''}));
  const priced={id:'priced',name:'BATMAN #25',price:6.99,image:''};
  const status=await bookStatus({},deps([], [...unpriced,priced]),'Batman #25');
  assert.equal(status.state,'in_stock');
  assert.equal(status.href,'/item/priced/slug','article must select a copy with a real selling price');
  assert.equal(status.priceCents,699);
  assert.equal(status.covers,1,'unpriced copies must not inflate buyable-cover count');
  assert.equal((await bookStatus({},deps([],unpriced),'Batman #25')).state,'coming','unpriced stock alone must not produce a Buy link');
  const preorder=await bookStatus({},deps([{id:'preorder',title:'BATMAN #25 COVER A',customer_price_cents:599,customer_enabled:true,cycle:cycle('open',future)}],unpriced),'Batman #25');
  assert.equal(preorder.state,'preorder','unpriced stock must not hide a valid preorder');
  assert.equal(preorder.href,'/preorder/preorder');
}
{
  const sku={id:'limited-a',cycle_id:'cycle-1',title:'BATMAN #25 COVER A',customer_enabled:true,customer_price_cents:599,secured_quantity:3,on_sale_date:'2099-12-01',cycle:{id:'cycle-1',status:'closed',customer_cutoff_at:past}};
  const limitedDeps={storeId:'store-1',listItems:async()=>[],isAvailable:()=>false,itemSlug:()=>'',supabaseAdminFetch:async(env,path)=>({data:path.startsWith('comic_skus?')?[sku]:[]})};
  const limited=await bookStatus({},limitedDeps,'Batman #25');
  assert.equal(limited.state,'limited');
  assert.equal(limited.href,'/preorders?sku=limited-a');
  const html=renderBuyBox({},limited,v=>String(v));
  assert.match(html,/Limited presales/);assert.doesNotMatch(html,/order by|Pick your cover/);
  sku.secured_quantity=0;
  assert.equal((await bookStatus({},limitedDeps,'Batman #25')).state,'closed');
}

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
  assert.match(html, /Nope #9[\s\S]*Request updates for this book/);
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
assert.match(worker, /\['\/articles', 'Collector Articles'\]/, 'nav link');
assert.match(fs.readFileSync('wrangler.deploy.jsonc', 'utf8'), /"www\.themanapocket\.com\/articles\*"/);
console.log('Comic article wiring checks passed');

// Paired releases must never borrow one another's stock or an unrelated Zekrom.
{
 const stock=[{id:'black',name:'Black Bolt copy',set:'SV: Black Bolt',categorySlug:'pokemon',quantity:1,price:5},{id:'white',name:'White Flare copy',set:'SV: White Flare',categorySlug:'pokemon',quantity:1,price:6},{id:'other',name:'Other Zekrom',set:'XY Promos',categorySlug:'pokemon',quantity:1,price:7},{id:'sold',name:'Sold Black Bolt',set:'SV: Black Bolt',categorySlug:'pokemon',quantity:0,price:8}];
 const dep={esc:s=>String(s),isAvailable:i=>i.quantity>0,itemSlug:i=>i.id};
 for(const [slug,yes,no] of [['pokemon-black-bolt-2025-collector-guide','Black Bolt copy','White Flare copy'],['pokemon-white-flare-2025-collector-guide','White Flare copy','Black Bolt copy']]){
 const html=renderReleaseInventory(slug,stock,dep);assert.ok(html.includes(yes));assert.ok(!html.includes(no)&&!html.includes('Other Zekrom')&&!html.includes('Sold Black Bolt'));
 }
}

// Every CMS page contributes to discovery; failed pages never cache partial data.
{
 const previousFetch=globalThis.fetch;
 const rows=Array.from({length:205},(_,i)=>({id:'paged-'+i,fieldData:{name:'Guide '+i,slug:'guide-'+i},lastPublished:'2026-10-19'}));
 const offsets=[];let writes=0;
 const env={WEBFLOW_TOKEN:'test',LBA_KV:{get:async()=>null,put:async k=>{if(k.startsWith('public-catalog:'))writes++;}}};
 try{
  globalThis.fetch=async url=>{const offset=Number(new URL(url).searchParams.get('offset'));offsets.push(offset);return {ok:true,json:async()=>({items:rows.slice(offset,offset+100),pagination:{total:205}})};};
  const articles=await fetchArticles(env);
  assert.equal(articles.length,205);assert.equal(articles.at(-1).slug,'guide-204');assert.deepEqual(offsets,[0,100,200]);assert.equal(writes,1);
  writes=0;
  globalThis.fetch=async url=>Number(new URL(url).searchParams.get('offset'))===0?{ok:true,json:async()=>({items:rows.slice(0,100),pagination:{total:205}})}:{ok:false,status:503};
  await assert.rejects(fetchArticles(env),/Webflow articles 503/);assert.equal(writes,0,'partial library must not enter shared cache');
  // A failure pauses new loads for a minute (see public-catalog-cache.mjs).
  await assert.rejects(fetchArticles(env),/retrying shortly/);clearPublicCatalogBackoff();
  globalThis.fetch=async()=>({ok:true,json:async()=>({items:[],pagination:{total:205}})});
  await assert.rejects(fetchArticles(env),/Incomplete Webflow/);
 }finally{globalThis.fetch=previousFetch;}
}
// Flagship sports guides cannot borrow Chrome, another series/year, or TCG stock.
{
 const make=(id,set,categorySlug='sports-cards',quantity=1)=>({id,name:id,set,categorySlug,quantity,price:5});
 const stock=[make('Series2Copy','2025 Topps Series 2'),make('ChromeCopy','2025 Topps Chrome'),make('Series1Copy','2025 Topps Series 1'),make('OldCopy','2024 Topps Series 2'),make('WrongCategory','2025 Topps Series 2','pokemon'),make('SoldCopy','2025 Topps Series 2','sports-cards',0)];
 const html=renderReleaseInventory('2025-topps-series-2-baseball-collector-guide',stock,{esc:String,isAvailable:i=>i.quantity>0,itemSlug:i=>i});
 assert.match(html,/Series2Copy/);assert.doesNotMatch(html,/ChromeCopy|Series1Copy|OldCopy|WrongCategory|SoldCopy/);
 assert.match(html,/href="\/category\/sports-cards"/);assert.match(html,/Browse current sports-card inventory/);
}

// Provider sport prefixes do not require editors to attach a set's stock.
{
 const html=renderReleaseInventory('2025-topps-series-2-baseball-collector-guide',[{id:'imported',name:'Imported Series 2 copy',categorySlug:'sports-cards',set:'Baseball Cards 2025 Topps Series 2',price:4,quantity:1}],{esc:String,isAvailable:i=>i.quantity>0,itemSlug:i=>i});
 assert.match(html,/Imported Series 2 copy/);
}
{
  const guide=releaseGuide('2024-topps-cosmic-chrome-baseball-collector-guide');
  assert.equal(guide.checklist,'/baseball/checklists/2024-topps-cosmic-chrome-baseball');
  assert.equal(releaseGuide('2025-topps-chrome-football-collector-guide').game,'football');
  assert.equal(releaseGuide('2024-topps-cosmic-chrome-baseball-rumors'),null);
  assert.equal(releaseGuide('unverified-release-collector-guide'),null);
  const make=(name,set,quantity=1)=>({id:name,name,categorySlug:'sports-cards',set,quantity,price:5});
  const html=renderReleaseInventory('2024-topps-cosmic-chrome-baseball-collector-guide',[
    make('Exact cosmic copy','Baseball Cards 2024 Topps Cosmic Chrome'),
    make('Wrong year copy','2023 Topps Cosmic Chrome'),
    make('Wrong release copy','2024 Topps Chrome'),
    make('Sold cosmic copy','2024 Topps Cosmic Chrome',0)
  ],{esc:String,isAvailable:i=>i.quantity>0,itemSlug:i=>i});
  assert.match(html,/Exact cosmic copy/);
  assert.doesNotMatch(html,/Wrong year copy|Wrong release copy|Sold cosmic copy/);
}

for(const slug of ['2025-topps-chrome-football-licensed-nfl-guide','2025-topps-chrome-black-football-guide','2025-topps-cosmic-chrome-football-guide','2026-topps-flagship-football-checklist-guide']){assert.equal(releaseGuide(slug)?.game,'football','published sports guide slug styles connect to reviewed releases');}

{
 const row=(id,set)=>({id,name:id,categorySlug:'sports-cards',set,quantity:1,price:5});
 const dep={esc:String,isAvailable:i=>i.quantity>0,itemSlug:i=>i};
 const stock=[row('baseball-copy','Baseball Cards 2025 Topps Chrome'),row('football-copy','Football Cards 2025 Topps Chrome'),row('ambiguous-copy','2025 Topps Chrome')];
 const football=renderReleaseInventory('2025-topps-chrome-football-licensed-nfl-guide',stock,dep);
 assert.ok(football.includes('/item/football-copy/'));
 assert.ok(!football.includes('/item/baseball-copy/')&&!football.includes('/item/ambiguous-copy/'));
 const baseball=renderReleaseInventory('2024-topps-cosmic-chrome-baseball-collector-guide',[row('other-sport','Football Cards 2024 Topps Cosmic Chrome')],dep);
 assert.ok(!baseball.includes('/item/other-sport/'));
}

// All available covers survive status resolution and use live inventory photos.
{
 const {renderStockCovers,refreshComicCoverFigures}=await import('../scripts/comic-articles.mjs');
 const escape=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
 const rows=[{id:'a',name:'ABSOLUTE BATMAN #25 CVR A',price:5.99,quantity:2,image:'https://example.com/new-a.jpg'}, {id:'b',name:'ABSOLUTE BATMAN #25 CVR B',price:6.99,quantity:1,image:'https://example.com/new-b.jpg'}, {id:'sold',name:'ABSOLUTE BATMAN #25 CVR C',price:6.99,available:false}];
 const status=await bookStatus({},deps([],rows),'Absolute Batman #25');
 assert.equal(status.stock.length,2);
 const html=renderStockCovers(status,escape);
 assert.equal((html.match(/data-article-cart=/g)||[]).length,2);
 assert.match(html,/new-b.jpg/);assert.doesNotMatch(html,/CVR C/);
 assert.equal(status.stock[0].available,2);
 const figure='<figure><img src="old.jpg"><figcaption>Cover B — Campbell</figcaption></figure>';
 const refreshed=refreshComicCoverFigures(figure,[status],escape);
 assert.match(refreshed,/new-b.jpg/);assert.match(refreshed,/&quot;image&quot;:&quot;https:\/\/example.com\/new-b.jpg/,'inline cart retains cover image without repeating the displayed image');assert.match(refreshed,/data-article-cart/);assert.doesNotMatch(refreshed,/old.jpg/);
 assert.equal(refreshComicCoverFigures(figure,[status,status],escape),figure,'ambiguous issues must not replace photos');
}

{
 const status=await bookStatus({},deps([{id:'sku-b',title:'ABSOLUTE BATMAN #25 CVR B',variant_label:'COVER B',cover_image_url:'https://example.com/dashboard-b.jpg'}],[{id:'received',focSkuId:'sku-b',name:'ABSOLUTE BATMAN #25 CVR B',price:7,quantity:3}]),'Absolute Batman #25');
 assert.equal(status.stock[0].image,'https://example.com/dashboard-b.jpg','received copy without photo uses its exact linked dashboard SKU art');
}

// Compact mobile index: one topic control; resources belong to the visible topic.
{
 const {renderArticleList}=await import('../scripts/comic-articles.mjs');
 const {createRequire}=await import('node:module');const {parseHTML}=createRequire(import.meta.url)('linkedom');
 const rows=[{slug:'mtg-collector-guide',title:'Magic story',publishedAt:'2026-10-01',image:'https://example.com/m.jpg'},{slug:'pokemon-collector-guide',title:'Pokemon story',publishedAt:'2026-10-01',image:'https://example.com/p.jpg'},{slug:'topps-baseball-guide',title:'Baseball story',publishedAt:'2026-10-01'}];
 let meta;const dep={esc:s=>String(s),pageShell:p=>{meta=p;return p.bodyHtml;},topic:'pokemon'};
 const {document:d}=parseHTML(renderArticleList(rows,dep));
 assert.equal(d.querySelectorAll('.mp-index-filter select').length,1);
 assert.equal(d.querySelectorAll('.mp-art-directories,.mp-article-index>.mp-art-shortcuts').length,0);
 assert.equal(d.querySelectorAll('.mp-art-card').length,1);assert.match(d.querySelector('.mp-art-card').textContent,/Pokemon story/);
 assert.equal(d.querySelector('.mp-art-card h3').textContent,'Pokemon story');assert.equal(d.querySelectorAll('h1').length,1);
 assert.equal(d.querySelector('option[selected]').value,'pokemon');assert.ok(meta.robotsNoindex);
 assert.equal(d.querySelectorAll('a[href="/baseball"],a[href="/secret-lair"]').length,0,'unrelated resource links are absent');
 assert.ok(d.querySelector('a[href="/pokemon"]'));
 const original=caches.default.match,keys=[];caches.default.match=async r=>{keys.push(r.url);return new Response('cached');};
 await get('/articles?topic=pokemon');await get('/articles?topic=baseball');await get('/articles');
 caches.default.match=original;
 assert.equal(new Set(keys).size,3,'topic pages cannot reuse another topic or all-articles cache');
}
