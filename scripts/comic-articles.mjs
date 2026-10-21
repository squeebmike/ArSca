import {articleMarketplace,sportsArticleSet,renderArticleMarketplace,affiliateTcgImages,tcgImageAffiliateUrl} from './article-marketplace.mjs';
import {articleContents} from './collector-page-ui.mjs';
import {sportsSetKey} from './topps/public-checklist-policy.mjs';
import {cachedPublicCatalog} from './public-catalog-cache.mjs';
import {catalogStoreCopyHtml,tcgplayerAffiliateUrl,marketplaceDisclosureHtml} from './catalog-inventory.mjs';
import { renderBookAlertForm } from './book-alert-ui.mjs';
import { afterFocAvailability } from './foc-preorders.mjs';
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

// Published release guides: match only their verified set names/codes, never
// loosely match a character name to another printing or promise allocations.
export const RELEASE_GUIDES = {
  "2025-topps-series-2-baseball-collector-guide":{game:"baseball",categorySlug:"sports-cards",inventoryLabel:"sports-card",name:"2025 Topps Series 2 Baseball",sets:["2025 Topps Series 2 Baseball","2025 Topps Series 2"],codes:[],checklist:"/baseball/checklists/2025-topps-series-2-baseball",viewer:"/baseball/checklists/2025-topps-series-2-baseball"},
  "pokemon-black-bolt-2025-collector-guide":{"game":"pokemon","name":"Black Bolt","sets":["SV: Black Bolt","Black Bolt"],"codes":[],"checklist":"/pokemon/sets/696e3ca8bb2a772e0d0568df/sv-black-bolt","viewer":"/pokemon-new-releases?set=SV%3A%20Black%20Bolt"},
  "pokemon-white-flare-2025-collector-guide":{"game":"pokemon","name":"White Flare","sets":["SV: White Flare","White Flare"],"codes":[],"checklist":"/pokemon/sets/696e3ca8bb2a772e0d0568e0/sv-white-flare","viewer":"/pokemon-new-releases?set=SV%3A%20White%20Flare"},
  "mtg-innistrad-remastered-2025-collector-guide":{"game":"mtg","name":"Innistrad Remastered","sets":["Innistrad Remastered"],"codes":["inr"],"checklist":"/mtg/inr","viewer":"/mtg-new-releases?set=inr"},
  "mtg-aetherdrift-2025-collector-guide":{"game":"mtg","name":"Aetherdrift","sets":["Aetherdrift"],"codes":["dft"],"checklist":"/mtg/dft","viewer":"/mtg-new-releases?set=dft"},
  "mtg-tarkir-dragonstorm-2025-collector-guide":{"game":"mtg","name":"Tarkir: Dragonstorm","sets":["Tarkir: Dragonstorm"],"codes":["tdm"],"checklist":"/mtg/tdm","viewer":"/mtg-new-releases?set=tdm"},
  "mtg-final-fantasy-mtg-2025-collector-guide":{"game":"mtg","name":"FINAL FANTASY","sets":["FINAL FANTASY"],"codes":["fin"],"checklist":"/mtg/fin","viewer":"/mtg-new-releases?set=fin"},
  "mtg-edge-of-eternities-2025-collector-guide":{"game":"mtg","name":"Edge of Eternities","sets":["Edge of Eternities"],"codes":["eoe"],"checklist":"/mtg/eoe","viewer":"/mtg-new-releases?set=eoe"},
  "mtg-marvel-spider-man-mtg-2025-collector-guide":{"game":"mtg","name":"Marvel’s Spider-Man","sets":["Marvel’s Spider-Man"],"codes":["spm"],"checklist":"/mtg/spm","viewer":"/mtg-new-releases?set=spm"},
  "mtg-avatar-last-airbender-mtg-2025-collector-guide":{"game":"mtg","name":"Avatar: The Last Airbender","sets":["Avatar: The Last Airbender"],"codes":["tla"],"checklist":"/mtg/tla","viewer":"/mtg-new-releases?set=tla"},
  "mtg-lorwyn-eclipsed-2026-collector-guide":{"game":"mtg","name":"Lorwyn Eclipsed","sets":["Lorwyn Eclipsed"],"codes":["ecl"],"checklist":"/mtg/ecl","viewer":"/mtg-new-releases?set=ecl"},
  "mtg-teenage-mutant-ninja-turtles-mtg-2026-collector-guide":{"game":"mtg","name":"Teenage Mutant Ninja Turtles","sets":["Teenage Mutant Ninja Turtles"],"codes":["tmt"],"checklist":"/mtg/tmt","viewer":"/mtg-new-releases?set=tmt"},
  "mtg-secrets-of-strixhaven-2026-collector-guide":{"game":"mtg","name":"Secrets of Strixhaven","sets":["Secrets of Strixhaven"],"codes":["sos"],"checklist":"/mtg/sos","viewer":"/mtg-new-releases?set=sos"},
  "mtg-marvel-super-heroes-mtg-2026-collector-guide":{"game":"mtg","name":"Marvel Super Heroes","sets":["Marvel Super Heroes"],"codes":["msh"],"checklist":"/mtg/msh","viewer":"/mtg-new-releases?set=msh"},
  "mtg-the-hobbit-mtg-2026-collector-guide":{"game":"mtg","name":"The Hobbit","sets":["The Hobbit"],"codes":["hob"],"checklist":"/mtg/hob","viewer":"/mtg-new-releases?set=hob"},
  "mtg-reality-fracture-2026-collector-guide":{"game":"mtg","name":"Reality Fracture","sets":["Reality Fracture"],"codes":["fra"],"checklist":"/mtg/fra","viewer":"/mtg-new-releases?set=fra"},
  "pokemon-prismatic-evolutions-2025-collector-guide":{"game":"pokemon","name":"Prismatic Evolutions","sets":["Prismatic Evolutions","SV: Prismatic Evolutions"],"codes":[],"checklist":"/pokemon/sets/696e3ca8bb2a772e0d0568db/sv-prismatic-evolutions","viewer":"/pokemon-new-releases?set=SV%3A%20Prismatic%20Evolutions"},
  "pokemon-journey-together-2025-collector-guide":{"game":"pokemon","name":"Journey Together","sets":["Journey Together","SV09: Journey Together"],"codes":[],"checklist":"/pokemon/sets/696e3ca8bb2a772e0d0568dc/sv09-journey-together","viewer":"/pokemon-new-releases?set=SV09%3A%20Journey%20Together"},
  "pokemon-destined-rivals-2025-collector-guide":{"game":"pokemon","name":"Destined Rivals","sets":["Destined Rivals","SV10: Destined Rivals"],"codes":[],"checklist":"/pokemon/sets/696e3ca8bb2a772e0d0568de/sv10-destined-rivals","viewer":"/pokemon-new-releases?set=SV10%3A%20Destined%20Rivals"},
  "pokemon-mega-evolution-2025-collector-guide":{"game":"pokemon","name":"Mega Evolution","sets":["Mega Evolution","ME01: Mega Evolution"],"codes":[],"checklist":"/pokemon/sets/696e3ca9bb2a772e0d0568e1/me01-mega-evolution","viewer":"/pokemon-new-releases?set=ME01%3A%20Mega%20Evolution"},
  "pokemon-phantasmal-flames-2025-collector-guide":{"game":"pokemon","name":"Phantasmal Flames","sets":["Phantasmal Flames","ME02: Phantasmal Flames"],"codes":[],"checklist":"/pokemon/sets/696e3ca9bb2a772e0d0568e3/me02-phantasmal-flames","viewer":"/pokemon-new-releases?set=ME02%3A%20Phantasmal%20Flames"},
  "pokemon-ascended-heroes-2026-collector-guide":{"game":"pokemon","name":"Ascended Heroes","sets":["Ascended Heroes","ME: Ascended Heroes"],"codes":[],"checklist":"/pokemon/sets/696e3ca9bb2a772e0d0568e8/me-ascended-heroes","viewer":"/pokemon-new-releases?set=ME%3A%20Ascended%20Heroes"},
  "pokemon-perfect-order-2026-collector-guide":{"game":"pokemon","name":"Perfect Order","sets":["Perfect Order","ME03: Perfect Order"],"codes":[],"checklist":"/pokemon/sets/696e3ca9bb2a772e0d0568ea/me03-perfect-order","viewer":"/pokemon-new-releases?set=ME03%3A%20Perfect%20Order"},
  "pokemon-chaos-rising-2026-collector-guide":{"game":"pokemon","name":"Chaos Rising","sets":["Chaos Rising","ME04: Chaos Rising"],"codes":[],"checklist":"/pokemon/sets/69b9b10516ba1587d25ef232/me04-chaos-rising","viewer":"/pokemon-new-releases?set=ME04%3A%20Chaos%20Rising"},
  "pokemon-pitch-black-2026-collector-guide":{"game":"pokemon","name":"Pitch Black","sets":["Pitch Black","ME05: Pitch Black"],"codes":[],"checklist":"/pokemon/sets/69f562ee6222edcca357f0fc/me05-pitch-black","viewer":"/pokemon-new-releases?set=ME05%3A%20Pitch%20Black"},
  "pokemon-30th-celebration-2026-collector-guide":{"game":"pokemon","name":"30th Celebration","sets":["30th Celebration","ME: 30th Celebration"],"codes":[],"checklist":"/pokemon/sets/6a23994ceef6d8fe7e225ca5/me-30th-celebration","viewer":"/pokemon-new-releases?set=ME%3A%2030th%20Celebration"},

  'pokemon-delta-reign-release-date-card-checklist':{game:'pokemon',name:'Pokémon Delta Reign',sets:['ME06: Delta Reign','Delta Reign'],codes:['me06'],checklist:'/pokemon/sets/6a883dd245dd2d15c8a710d0/me06-delta-reign',viewer:'/pokemon-new-releases?set=ME06%3A%20Delta%20Reign'},
  'mtg-star-trek-release-dates-set-codes-card-guide':{game:'mtg',name:'MTG Star Trek',sets:['Star Trek','Star Trek Commander','Star Trek: Stardates'],codes:['trk','trc','sds'],checklist:'/mtg',viewer:'/mtg-new-releases?set=trk'},
};
// Derive sports guide links from the reviewed release catalog rather than a second registry.
export function releaseGuide(slug){
  if(RELEASE_GUIDES[slug])return RELEASE_GUIDES[slug];
  const set=sportsArticleSet({slug:String(slug||'')});if(!set)return null;
  if(!['collector-guide','guide','checklist-guide','licensed-nfl-guide'].includes(String(slug).slice(set.id.length+1)))return null;
  const game=/football/i.test(set.displayName)?'football':'baseball';
  const checklist='/'+game+'/checklists/'+set.id;
  return {game,categorySlug:'sports-cards',inventoryLabel:'sports-card',name:set.displayName,sets:[set.displayName],codes:[],checklist,viewer:checklist};
}
export function sportsGuideInventoryMatches(item,guide){
  const identity=[item.set,item.sport,item.league].filter(Boolean).join(' ');
  // Never erase an explicit sport conflict when removing importer wrappers.
  if(guide.game==='football'&&!/\b(?:football|nfl)\b/i.test(identity))return false;
  if(guide.game==='football'&&/\bbaseball\b/i.test(identity))return false;
  if(guide.game==='baseball'&&/\b(?:football|nfl)\b/i.test(identity))return false;
  return guide.sets.some(set=>sportsSetKey(set)===sportsSetKey(item.set));
}
export function renderReleaseInventory(slug,inventory,deps){
  const guide=releaseGuide(slug);if(!guide)return '';
  const esc=deps.esc,normalize=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const copies=inventory?.filter(item=>item.categorySlug===(guide.categorySlug||guide.game)&&Number.isFinite(item.price)&&item.price>0&&deps.isAvailable(item)&&(guide.codes.includes(String(item.setCode||'').toLowerCase())||guide.sets.some(set=>(guide.categorySlug==='sports-cards'?sportsGuideInventoryMatches(item,guide):normalize(set)===normalize(item.set)))));
  return `<section id="guide-stock" class="mp-books mp-stock-panel" aria-label="${esc(guide.name)} store availability"><h2>Find the set. Check the actual stock.</h2>${copies?.some(item=>tcgplayerAffiliateUrl(item))?marketplaceDisclosureHtml:''}<p><a href="${guide.checklist}">Set checklists</a> · <a href="${guide.viewer}">${guide.game==='baseball'?'Browse cards and team filters':'Open the card viewer'}</a></p>${copies?.length?`<p>${copies.length} matching store listing${copies.length===1?'':'s'} currently available.</p>${`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px">${copies.slice(0,8).map(item=>'<div>'+catalogStoreCopyHtml(item,{escape:esc,slug:()=>deps.itemSlug(item)})+(tcgplayerAffiliateUrl(item)?'<p><a target="_blank" rel="noopener sponsored" href="'+esc(tcgplayerAffiliateUrl(item))+'">View this product on TCGplayer</a></p>':'')+'</div>').join('')}</div>`}`:`<p>${copies?'No matching store copies are currently listed.':'Store availability could not be checked just now.'} This guide does not reserve copies or guarantee an allocation.</p>`}<p><a href="/category/${guide.categorySlug||guide.game}">Browse current ${guide.inventoryLabel||(guide.game==='mtg'?'MTG':'Pokémon')} inventory</a></p></section>`;
}

const F = {
  summary: 'summary', body: 'body', image: 'cover-image', author: 'author',
  published: 'published-on-2', books: 'books-to-promote', facts: 'book-details',
  release: 'main-book-release-date', foc: 'main-book-foc-date',
};

// Use editorial titles and promoted books, never unrelated words in the body.
export function articleTopics(article) {
  const text=`${article.slug || ''} ${article.title || ''}`;
  return [
    ['pokemon',/pok[eé]mon/i.test(text)],
    ['mtg',/\bmtg\b|magic.the.gathering/i.test(text)],
    ['sports-cards',/\b(?:topps|bowman|baseball|football|basketball|sports)\b/i.test(text)],
    ['comics',!!article.books?.length || /\b(?:comic|comics|batman|x-men|midnight-universe)\b/i.test(text)],
  ].filter(([,matches])=>matches).map(([topic])=>topic);
}
export function relatedArticles(article, articles, limit=4) {
  const topics=articleTopics(article);
  return articles.filter(other=>other.slug!==article.slug)
    .map((other,index)=>({other,index,score:articleTopics(other).filter(topic=>topics.includes(topic)).length}))
    .sort((a,b)=>b.score-a.score || a.index-b.index).slice(0,limit).map(row=>row.other);
}
function articleShoppingLinks(article) {
  const links={
    pokemon:[['/category/pokemon','Shop Pokémon'],['/pokemon-new-releases','Pokémon set guide']],
    mtg:[['/category/mtg','Shop MTG'],['/mtg','MTG set checklists']],
    'sports-cards':[['/category/sports-cards','Shop sports cards']],
    comics:[['/category/comics','Shop comics'],['/preorders','Comic preorders']],
  };
  const destinations=articleTopics(article).flatMap(topic=>links[topic]);
  return destinations.length?`<nav class="mp-art-shortcuts" aria-label="Explore this collection">${destinations.map(([href,label])=>`<a href="${href}">${label}</a>`).join('')}</nav>`:'';
}

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
  // Use existing article art when an editor has not picked a card image yet.
  const bodyImage = String(f[F.body] || '').match(/<img\b[^>]*\ssrc=["'](https?:\/\/[^"']+)["']/i)?.[1] || '';
  if (!f.slug || !f.name) return null;
  return {
    id: item.id, slug: String(f.slug), title: String(f.name),
    summary: String(f[F.summary] || '').trim(),
    bodyHtml: sanitizeRichText(f[F.body] || ''),
    image: f[F.image]?.url || bodyImage, imageAlt: f[F.image]?.alt || '',
    author: String(f[F.author] || '').trim() || 'The Mana Pocket',
    publishedAt: f[F.published] || item.lastPublished || item.createdOn || null,
    updatedAt: item.lastUpdated || item.lastPublished || null,
    books: parseBookLines(f[F.books]),
    facts: parseFacts(f[F.facts]),
    releaseDate: f[F.release] || null, focDate: f[F.foc] || null,
  };
}

export async function fetchArticles(env,ctx) {
  if (!env.WEBFLOW_TOKEN) return [];
  return cachedPublicCatalog(env,ctx,'published-articles-v2',async signal=>{
  const headers = { Authorization: `Bearer ${env.WEBFLOW_TOKEN}`, accept: 'application/json' };
  const items=[],seen=new Set();
  let complete=false;
  // Webflow caps each response at 100. Never cache an incomplete library as
  // success: a failed later page must preserve the existing error behavior.
  for(let offset=0;offset<10000;){
    const res = await fetch(`https://api.webflow.com/v2/collections/${WF_ARTICLES}/items/live?limit=100&offset=${offset}`, { headers,signal });
    if (!res.ok) throw new Error(`Webflow articles ${res.status}`);
    const payload = await res.json();
    if(!Array.isArray(payload?.items))throw new Error('Invalid Webflow article page');
    const batch=payload.items;
    for(const item of batch){
      if(item.id&&seen.has(item.id))continue;
      if(item.id)seen.add(item.id);
      items.push(item);
    }
    offset+=batch.length;
    const total=payload.pagination?.total;
    if(Number.isInteger(total)&&total>=0){
      if(offset>=total){complete=true;break;}
      if(!batch.length)throw new Error('Incomplete Webflow article pagination');
    }else if(batch.length<100){complete=true;break;}
  }
  if(!complete)throw new Error('Webflow article pagination limit exceeded');
  return items
    .filter(item => !item.isArchived && !item.isDraft)
    .map(shapeArticle).filter(Boolean)
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  },{freshMs:180000,maxAgeMs:300000,timeoutMs:8000});
}

// ---------- live book status ----------

function searchWord(book) {
  const { series } = comicKey(book);
  return series.split(' ').filter(w => w.length > 2 && !/^\d+$/.test(w)).sort((a, b) => b.length - a.length)[0] || series.split(' ')[0] || '';
}

// What the button should say for one book, in order of preference:
// in the shop now > open for preorder > preorders closed (on its way) > not
// solicited yet.
// "X-MEN: INCURSIONS #1 COVER B BY ..." -> "Cover B by ..." for the picker.
function coverLabel(sku) {
  const label = String(sku.variant_label || '').trim() || String(sku.title || '').replace(/^.*?#\s*\d+\s*/, '').trim() || 'Main cover';
  return label.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(By|And|Of|The)\b(?!$)/g, w => w.toLowerCase()).replace(/^(.)/, c => c.toUpperCase()).replace(/\b(Tbd|Tba|Nycc|Sdcc)\b/g, w => w.toUpperCase());
}

export async function bookStatus(env, deps, book, now = Date.now()) {
  const word = searchWord(book);
  const status = { name: book, state: 'coming', href: '', priceCents: 0, cover: '', covers: 0, cutoff: null, onSale: null };
  if (!word) return status;
  const enc = encodeURIComponent;
  const [skuRes, items] = await Promise.all([
    deps.supabaseAdminFetch(env, `comic_skus?store_id=eq.${enc(deps.storeId)}&title=ilike.${enc('*' + word + '*')}&select=id,cycle_id,title,variant_label,cover_image_url,customer_price_cents,customer_enabled,is_incentive,on_sale_date,secured_quantity,flags,cycle:foc_cycles(id,status,customer_cutoff_at)&order=on_sale_date.desc&limit=300`).catch(error => { if (deps.strict) throw error; return { data: [] }; }),
    (deps.listItemsForBook ? deps.listItemsForBook(env, word, deps.storeId) : deps.listItems(env)).catch(error => { if (deps.strict) throw error; return []; }),
  ]);
  if (deps.strict && (!Array.isArray(skuRes.data) || skuRes.response?.ok === false)) throw new Error('Book catalog unavailable');
  const skus = (skuRes.data || []).filter(s => sameComic(s.title, book));
  const stock = items.filter(i => deps.isAvailable(i) && Number.isFinite(Number(i.price)) && Number(i.price) > 0 && sameComic(i.name, book))
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
    // Every cover the customer can save from the article, main cover first.
    // Incentives (1:25 etc.) aren't sold; they're requests, same as on the
    // preorders page, so they show as "Request" cards.
    const requestable = skus.filter(s => s.is_incentive && s.customer_enabled && !orderable.includes(s) && s.cycle?.status === 'open' && Date.parse(s.cycle?.customer_cutoff_at || '') > now);
    const options = [pick, ...orderable.filter(s => s !== pick)].map(s => ({
      id: s.id, label: coverLabel(s), cover: s.cover_image_url || '', priceCents: Number(s.customer_price_cents), kind: 'pick',
    })).concat(requestable.map(s => ({ id: s.id, label: coverLabel(s), cover: s.cover_image_url || '', priceCents: 0, kind: 'request' })));
    return { ...status, state: 'preorder', href: `/preorder/${enc(pick.id)}`, priceCents: cheapest, covers: skus.length, cutoff: pick.cycle?.customer_cutoff_at || status.cutoff, options };
  }
  // Reuse the checkout's ordered-copy accounting. Never infer stock from
  // the article text or ignore paid orders/eBay sales while offering copies.
  const limited=[];
  const cycles=new Map(skus.filter(s=>s.cycle?.id&&Number(s.secured_quantity)>0).map(s=>[s.cycle.id,s.cycle]));
  for(const [id,cycle] of cycles){
    const group=skus.filter(s=>s.cycle?.id===id);
    const left=await afterFocAvailability((p,o)=>deps.supabaseAdminFetch(env,p,o),deps.storeId,cycle,group,{now:new Date(now),includePending:true}).catch(()=>new Map());
    limited.push(...group.filter(s=>s.customer_enabled!==false&&Number(s.customer_price_cents)>0&&Number(left.get(s.id))>0));
  }
  if(limited.length){const pick=limited.includes(main)?main:limited[0];return {...status,state:'limited',href:'/preorders?sku='+enc(pick.id),priceCents:Math.min(...limited.map(s=>Number(s.customer_price_cents))),covers:limited.length};}
  if (skus.length) return { ...status, state: 'closed', covers: skus.length };
  return status;
}

// ---------- rendering ----------

const STYLE = `<style>
.mp-art-directories{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.mp-art-directories a{font:650 14px/1.5 system-ui;padding:10px 14px;border:1px solid var(--wo-border,#777);border-radius:10px;text-decoration:none}.mp-art-shortcuts{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 24px}.mp-art-shortcuts a{padding:10px 14px;border:1px solid var(--wo-border,#777);border-radius:24px;color:var(--wo-text,#fff);font-size:14px;text-decoration:none}.mp-art{max-width:760px;margin:0 auto}
.mp-art h1{font-size:clamp(28px,5vw,44px);line-height:1.08;margin:6px 0 12px;letter-spacing:-.01em}
.mp-art-meta{font-size:13px;opacity:.8;margin-bottom:22px;line-height:1.6}.mp-art-deck{font-size:19px;line-height:1.65;margin:0 0 24px;color:var(--wo-text,inherit)}.mp-art-contents{padding:18px 20px;margin:24px 0;border:1px solid var(--wo-border,rgba(255,255,255,.2));border-radius:14px;background:var(--wo-surface,transparent)}.mp-art-contents strong{font-size:14px}.mp-art-contents div{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:4px 18px;margin-top:8px}.mp-art-contents a{display:block;padding:8px 0;min-height:44px;font-size:14px;line-height:1.5;text-decoration:underline;text-underline-offset:3px}.mp-art-body table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse}.mp-art-body th,.mp-art-body td{padding:10px;border:1px solid var(--wo-border,#777);text-align:left}.mp-art-body figure{margin:24px 0}.mp-art-body figcaption{font-size:13px;line-height:1.6;margin-top:8px}
.mp-art-hero{width:100%;max-height:380px;object-fit:contain;border-radius:14px;background:var(--wo-surface,#15101f);margin:0 0 16px}
.mp-art-body{font-size:17px;line-height:1.8;color:var(--wo-text,#e9e4f6)}
.mp-art-body h2{font-size:24px;line-height:1.25;margin:38px 0 10px;color:var(--wo-text,#fff)}
.mp-art-body h3{font-size:19px;margin:28px 0 8px;color:var(--wo-text,#fff)}
.mp-art-body p{margin:0 0 16px}
.mp-art-body blockquote{margin:22px 0;padding:6px 0 6px 18px;border-left:4px solid var(--wo-accent,#8bd450);font-size:20px;font-weight:700;color:var(--wo-text,#fff)}
.mp-art-body ul,.mp-art-body ol{padding-left:22px;margin:0 0 16px}.mp-art-body li{margin:0 0 10px}
.mp-art-body img{max-width:100%;height:auto;border-radius:10px}
.mp-art-body a{color:var(--wo-accent,#8bd450)}
.mp-buy{display:flex;gap:16px;align-items:center;border:1px solid var(--wo-border-strong,rgba(139,212,80,.35));background:linear-gradient(135deg,var(--wo-surface-alt,rgba(139,212,80,.10)),rgba(143,85,189,.12));border-radius:14px;padding:16px;margin:0 0 26px}
.mp-buy img{width:78px;height:118px;object-fit:cover;border-radius:6px;flex:none;background:#15101f}
.mp-buy-k{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--wo-accent,#8bd450);margin-bottom:4px}
.mp-buy-t{font-size:17px;font-weight:800;margin-bottom:4px}
.mp-buy-s{font-size:13px;opacity:.75;margin-bottom:10px}
.mp-btn{display:inline-block;padding:10px 16px;border-radius:999px;background:var(--wo-button,#8bd450);color:var(--wo-on-button,#111)!important;font-weight:800;font-size:14px;text-decoration:none;margin:0 8px 6px 0}
.mp-btn.ghost{background:transparent;color:var(--wo-text,#f2eefc)!important;border:1px solid rgba(255,255,255,.3)}
.mp-facts{border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:16px 18px;margin:30px 0}
.mp-facts h2{font-size:18px;margin:0 0 10px}
.mp-facts dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:0;font-size:14px}.mp-facts dt{opacity:.6}.mp-facts dd{margin:0}
.mp-books{margin:30px 0}.mp-books h2{font-size:20px;margin:0 0 12px}
.mp-book-row{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid rgba(255,255,255,.1)}
.mp-book-row b{display:block;font-size:15px}.mp-book-row span{font-size:12px;opacity:.7}
.mp-book-row .mp-btn{margin:0;white-space:nowrap}
.mp-book{border-top:1px solid rgba(255,255,255,.1);scroll-margin-top:calc(var(--nav-height,90px) + 12px)}.mp-book .mp-book-row{border-top:0}
.mp-book-main{display:flex;gap:12px;align-items:center}
.mp-book-img{width:54px;height:82px;object-fit:cover;border-radius:5px;flex:none;background:#15101f}
.mp-book-noimg{display:flex;align-items:center;justify-content:center;text-align:center;font-size:10px;opacity:.55;border:1px dashed rgba(255,255,255,.2);padding:4px}
.mp-picker{padding:0 0 18px}
.mp-covers{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;margin:4px 0 14px}
.mp-cover{position:relative;display:flex;flex-direction:column;gap:4px;text-align:left;padding:6px;border-radius:10px;border:2px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);color:inherit;font:inherit;cursor:pointer}
.mp-cover img,.mp-cover-blank{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:6px;background:#15101f}
.mp-cover-blank{display:flex;align-items:center;justify-content:center;font-size:12px;opacity:.5}
.mp-cover-l{font-size:12px;line-height:1.3;font-weight:700}.mp-cover-p{font-size:12px;color:var(--wo-accent,#8bd450);font-weight:800}
.mp-cover-tick{position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:50%;background:var(--wo-button,#8bd450);color:var(--wo-on-button,#111);font-weight:900;display:none;align-items:center;justify-content:center}
.mp-cover[aria-pressed="true"]{border-color:var(--wo-accent,#8bd450);background:var(--wo-surface-alt,rgba(139,212,80,.10))}.mp-cover[aria-pressed="true"] .mp-cover-tick{display:flex}
.mp-cover.is-saved .mp-cover-tick{display:flex;background:#fff}
.mp-picker-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.mp-picker-bar .mp-btn{margin:0}
.mp-btn[disabled]{opacity:.45;cursor:default}
.mp-picker-msg{font-size:14px;margin-top:10px;line-height:1.5}.mp-picker-msg.ok{color:var(--wo-accent,#8bd450)}.mp-picker-msg.err{color:#ff8a8a}
.mp-auth{display:grid;gap:8px;max-width:360px;margin-top:12px;padding:14px;border:1px solid rgba(255,255,255,.15);border-radius:12px;background:rgba(255,255,255,.04)}
.mp-auth input{font:inherit;font-size:16px;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#15101f;color:var(--wo-text,#fff)}
.mp-auth b{font-size:15px}.mp-auth p{margin:0;font-size:13px;opacity:.75}.mp-auth .mp-btn{margin:0}
.mp-art-list{display:grid;gap:18px;max-width:900px;margin:0 auto}
.mp-art-card{display:flex;gap:18px;padding:16px;border:1px solid rgba(255,255,255,.12);border-radius:14px;text-decoration:none;color:inherit;background:rgba(255,255,255,.03)}
.mp-art-card:hover{border-color:var(--wo-accent,#8bd450)}
.mp-art-card img{width:120px;height:160px;object-fit:cover;border-radius:8px;flex:none;background:#15101f}
.mp-art-card h2{font-size:21px;line-height:1.2;margin:2px 0 6px;color:var(--wo-text,#fff)}
.mp-art-card p{margin:0 0 8px;font-size:14px;opacity:.75;line-height:1.5}
@media(max-width:560px){.mp-art-card{flex-direction:column}.mp-art-card img{width:100%;height:190px}.mp-buy{align-items:flex-start}.mp-book-row{flex-direction:column;align-items:flex-start}}
</style>`;

function statusLine(s, esc) {
  if (s.state === 'in_stock') return `In stock now · ${money(s.priceCents)}`;
  if (s.state === 'preorder') return `Preorder open · from ${money(s.priceCents)}${s.covers > 1 ? ` · ${s.covers} covers` : ''}${s.cutoff ? ` · order by ${esc(shortDate(s.cutoff))}` : ''}`;
  if (s.state === 'limited') return `Limited presales · from ${money(s.priceCents)} · ${s.covers} cover${s.covers===1?'':'s'} available`;
  if (s.state === 'closed') return `Preorder deadline passed${s.onSale ? ` · scheduled release ${esc(shortDate(s.onSale))}` : ''} · check current shop availability`;
  return 'Not open for preorder yet';
}
function button(s) {
  if (s.state === 'in_stock') return `<a class="mp-btn" href="${s.href}">Buy now</a>`;
  if (s.state === 'limited') return `<a class="mp-btn" href="${s.href}">Choose available presale covers</a>`;
  if (s.state === 'preorder') return `<a class="mp-btn" href="#${bookAnchor(s)}">Pick your cover</a>`;
  if (s.state === 'closed') return `<a class="mp-btn ghost" href="/shop?cat=comics">Shop comics</a>`;
  return `<a class="mp-btn ghost" href="#book-updates" data-update-book="${encodeURIComponent(s.name)}">Request updates for this book</a>`;
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
  const kicker = { in_stock: 'Get it now', preorder: 'Preorder it', limited:'Limited copies', closed: 'Check availability', coming: 'Coming soon' }[main.state];
  const actions = button(main) + (main.state === 'coming' ? `<a class="mp-btn ghost" href="/preorders">Browse comic preorders</a>` : '');
  return `<aside class="mp-buy">${main.cover ? `<img src="${esc(main.cover)}" alt="${esc(main.name)} cover" loading="lazy">` : ''}<div><div class="mp-buy-k">${kicker}</div><div class="mp-buy-t">${esc(main.name)}</div><div class="mp-buy-s">${sub}</div>${actions}</div></aside>`;
}

function bookAnchor(s) { return 'book-' + comicKey(s.name).series.replace(/ /g, '-') + '-' + (comicKey(s.name).issue || '0'); }

// Every open cover as a tappable card; the picked ones are saved to the
// customer's account (their comic pulls) right here -- see PICKER_SCRIPT.
function renderCoverPicker(s, esc) {
  const covers = (s.options || []).map(o => `<button type="button" class="mp-cover" data-sku="${esc(o.id)}" data-kind="${o.kind === 'request' ? 'request' : 'pick'}" aria-pressed="false">` +
    (o.cover ? `<img src="${esc(o.cover)}" alt="${esc(s.name)} ${esc(o.label)}" loading="lazy">` : `<span class="mp-cover-blank">No image yet</span>`) +
    `<span class="mp-cover-l">${esc(o.label)}</span><span class="mp-cover-p">${o.kind === 'request' ? 'Incentive · request' : money(o.priceCents)}</span><span class="mp-cover-tick" aria-hidden="true">✓</span></button>`).join('');
  return `<div class="mp-picker" data-picker data-cutoff="${esc(s.cutoff ? shortDate(s.cutoff) : '')}">` +
    `<div class="mp-covers">${covers}</div>` +
    `<div class="mp-picker-bar"><button type="button" class="mp-btn" data-save disabled>Pick a cover</button>` +
    `<a class="mp-btn ghost" href="/preorders">See all my preorders</a></div>` +
    `<div class="mp-picker-msg" data-msg role="status"></div></div>`;
}

// Saves the picked covers to the customer's account with the same session
// (localStorage "mp-foc-session-v1") and API the preorders page uses, so a
// visitor already signed in there is signed in here. Paying still happens on
// the preorders page before FOC.
const PICKER_API = 'https://still-resonance-4f87.swarnerauto.workers.dev';
const SUPABASE_URL = 'https://vroknjrxubsqyexngwus.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wbpX2nL8l-4NbXtZNG_bjA_nabSYaJ5';
export function pickerScript(storeId) {
  const cfg = JSON.stringify({ api: PICKER_API, sb: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY, store: storeId }).replace(/</g, '\\u003c');
  return `<script>(function(){var C=${cfg},SK='mp-foc-session-v1';
function read(){try{return JSON.parse(localStorage.getItem(SK)||'null')}catch(e){return null}}
function write(v){try{v?localStorage.setItem(SK,JSON.stringify(v)):localStorage.removeItem(SK)}catch(e){}}
function auth(path,body){return fetch(C.sb+'/auth/v1/'+path,{method:'POST',headers:{apikey:C.key,'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(!r.ok)throw new Error(d.error_description||d.msg||d.message||'Sign in failed');return d;});});}
function session(){var s=read();if(!s||!s.access_token)return Promise.resolve(null);if(!s.expires_at||s.expires_at*1000>Date.now()+60000)return Promise.resolve(s);
return auth('token?grant_type=refresh_token',{refresh_token:s.refresh_token}).then(function(n){if(!n.access_token)throw 0;write(n);return n;}).catch(function(){write(null);return null;});}
function msg(p,text,kind){var m=p.querySelector('[data-msg]');m.className='mp-picker-msg'+(kind?' '+kind:'');m.innerHTML=text;}
function picked(p){return Array.prototype.slice.call(p.querySelectorAll('.mp-cover[aria-pressed="true"]'));}
function refresh(p){var n=picked(p).length,b=p.querySelector('[data-save]');b.disabled=!n;b.textContent=n?('Save '+(n>1?n+' covers':'this cover')+' to my preorders'):'Pick a cover';}
function signIn(p){if(p.querySelector('.mp-auth'))return;var f=document.createElement('form');f.className='mp-auth';
f.innerHTML='<b>Sign in to save your covers</b><p>Same account as the preorders page. New here? Create one in a second.</p><input name="email" type="email" autocomplete="email" placeholder="Email" required><input name="password" type="password" autocomplete="current-password" minlength="8" placeholder="Password · 8+ characters" required><div class="mp-picker-bar"><button class="mp-btn" type="submit">Sign in &amp; save</button><button class="mp-btn ghost" type="button" data-signup>Create account</button></div>';
p.appendChild(f);f.querySelector('input').focus();
function go(kind){var email=f.email.value.trim(),pw=f.password.value;if(!email||pw.length<8){msg(p,'Enter your email and a password with at least 8 characters.','err');return;}msg(p,kind==='signup'?'Creating your account…':'Signing in…');
(kind==='signup'?auth('signup',{email:email,password:pw}):auth('token?grant_type=password',{email:email,password:pw})).then(function(s){if(!s.access_token){msg(p,'Check your email to confirm your account, then sign in here.','ok');return;}write(s);f.remove();save(p);}).catch(function(e){msg(p,e.message,'err');});}
f.addEventListener('submit',function(e){e.preventDefault();go('signin');});f.querySelector('[data-signup]').addEventListener('click',function(){go('signup');});}
function save(p){var covers=picked(p);if(!covers.length)return;session().then(function(s){if(!s){msg(p,'');signIn(p);return;}
var b=p.querySelector('[data-save]'),kept=0,asked=0;b.disabled=true;b.textContent='Saving…';msg(p,'');
return covers.reduce(function(chain,c){return chain.then(function(){var req=c.getAttribute('data-kind')==='request';return fetch(C.api+(req?'/public/preorders/waitlist':'/public/preorders/picks'),{method:req?'POST':'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify({storeId:C.store,skuId:c.getAttribute('data-sku'),quantity:1})}).then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(r.status===401){write(null);throw new Error('SIGNIN');}if(!r.ok||d.ok===false)throw new Error(d.error||'That cover could not be saved');c.setAttribute('aria-pressed','false');c.classList.add('is-saved');if(req)asked++;else kept++;});});});},Promise.resolve())
.then(function(){var due=p.getAttribute('data-cutoff'),t=[];if(kept)t.push('Saved to your account ✓ Pay for your preorders'+(due?' by '+due:'')+' on the <a href="/preorders">preorders page</a> to lock them in.');if(asked)t.push('Incentive request'+(asked>1?'s':'')+' sent ✓ You are not charged unless we secure a copy for you.');msg(p,t.join(' '),'ok');})
.catch(function(e){if(e.message==='SIGNIN'){msg(p,'');signIn(p);}else msg(p,e.message,'err');})
.then(function(){refresh(p);});});}
document.querySelectorAll('[data-picker]').forEach(function(p){p.addEventListener('click',function(e){var c=e.target.closest('.mp-cover');if(c){c.setAttribute('aria-pressed',c.getAttribute('aria-pressed')==='true'?'false':'true');refresh(p);return;}if(e.target.closest('[data-save]'))save(p);});});
})();</script>`;
}

function renderBooks(statuses, esc) {
  if (!statuses.length) return '';
  return `<section class="mp-books"><h2>Get the books</h2>${statuses.map(s => `<div class="mp-book" id="${bookAnchor(s)}"><div class="mp-book-row">` +
    `<div class="mp-book-main">${s.cover ? `<img class="mp-book-img" src="${esc(s.cover)}" alt="${esc(s.name)} cover" loading="lazy">` : `<span class="mp-book-img mp-book-noimg">Cover coming</span>`}` +
    `<div><b>${esc(s.name)}</b><span>${statusLine(s, esc)}</span></div></div>` +
    `${s.state === 'preorder' ? '' : button(s)}</div>` +
    `${s.state === 'preorder' && s.options?.length ? renderCoverPicker(s, esc) : ''}</div>`).join('')}</section>`;
}

export function renderArticlePage(article, statuses, related, deps) {
  const esc = deps.esc;
  const marketplace=renderArticleMarketplace(deps.articleMarketplace,affiliateTcgImages(article.bodyHtml,esc),esc);
  const contents=articleContents(marketplace.body,esc);
  const guide=releaseGuide(article.slug);
  const main = statuses[0] || null;
  const image = article.image || main?.cover || '';
  const affiliateHero=tcgImageAffiliateUrl(image);
  const url = `https://www.themanapocket.com/articles/${article.slug}`;
  const facts = article.facts.length
    ? `<section class="mp-facts"><h2>${esc(main?.name || 'Book details')}</h2><dl>${article.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>`
    : '';
  const more = related.length
    ? `<section class="mp-books"><h2>More collector articles</h2>${related.map(a => `<div class="mp-book-row"><div><b><a href="/articles/${esc(a.slug)}" style="color:var(--wo-text,#fff);text-decoration:none">${esc(a.title)}</a></b><span>${esc(dateLabel(a.publishedAt))}</span></div></div>`).join('')}</section>`
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
        { '@type': 'ListItem', position: 1, name: 'Collector Articles', item: 'https://www.themanapocket.com/articles' },
        { '@type': 'ListItem', position: 2, name: article.title, item: url },
      ] },
    ],
    bodyHtml: STYLE + `<article class="mp-art"><div class="mp-crumb"><a href="/articles">← Collector articles</a></div>` +
      `<header><p class="mp-set-kicker">The Mana Pocket · Pocket Guides</p><h1>${esc(article.title)}</h1><div class="mp-art-meta">${esc(article.author)}${article.publishedAt ? ` · ${esc(dateLabel(article.publishedAt))}` : ''} · ${readingMinutes(article.bodyHtml)} min read</div>${article.summary?`<p class="mp-art-deck">${esc(article.summary)}</p>`:''}</header>` +
      (guide?`<nav class="mp-set-actions" aria-label="Explore this release"><a href="${esc(guide.checklist)}">Explore the checklist</a><a href="#guide-stock">Shop available copies</a></nav>`:'') + contents.nav +
      (image ? `<a href="${esc(affiliateHero||image)}" target="_blank" rel="${affiliateHero?'noopener sponsored':'noopener'}" aria-label="${affiliateHero?'View this card on TCGplayer':'Open full-size article image'}"><img class="mp-art-hero" width="660" height="1000" fetchpriority="high" decoding="async" src="${esc(image)}" alt="${esc(article.imageAlt || article.title)}"></a><p class="mp-art-meta">${affiliateHero?'Affiliate image link · View sellers on TCGplayer.':'Tap the image to see it full size.'}</p>` : '') +
      renderBuyBox(article, main, esc) +
      (main ? `<nav class="mp-art-shortcuts" aria-label="Book actions"><a href="#${bookAnchor(main)}">Covers &amp; availability</a><a href="/comics/search?q=${encodeURIComponent(comicKey(main.name).series)}">Find related comics</a><a href="#book-updates">Book updates</a></nav>` : '') +
      `<div class="mp-art-body">${contents.html}</div>` + (deps.releaseInventoryHtml || '') + marketplace.after + facts + renderBooks(statuses, esc) + renderBookUpdates(article, deps.storeId, esc) + articleShoppingLinks(article) + more + `</article>` +
      (statuses.some(st => st.options?.length) ? pickerScript(deps.storeId) : ''),
  });
}

export function renderBookUpdates(article,storeId,esc) { return renderBookAlertForm(article.books,storeId,esc); }

export function renderArticleList(articles, deps) {
  const esc = deps.esc;
  const category=a=>/baseball|bowman/.test(a.slug)?'baseball':/football/.test(a.slug)?'football':articleTopics(a).find(t=>['mtg','pokemon','comics'].includes(t))||'collecting';
  const groups=[['mtg','Magic: The Gathering'],['pokemon','Pokémon'],['baseball','Baseball'],['football','Football'],['comics','Comics'],['collecting','Collector guides']];
  const cardHtml=a => `<a class="mp-art-card" href="/articles/${esc(a.slug)}">${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy">` : ''}<div><div class="mp-meta">${esc(dateLabel(a.publishedAt))}</div><h2>${esc(a.title)}</h2>${a.summary ? `<p>${esc(a.summary)}</p>` : ''}<span style="color:var(--wo-accent,#8bd450);font-weight:700;font-size:14px">Read it →</span></div></a>`;
  const cards=groups.filter(([key])=>articles.some(a=>category(a)===key)).map(([key,label])=>`<section id="articles-${key}" style="scroll-margin-top:110px"><h2>${label}</h2><div class="mp-art-list">${articles.filter(a=>category(a)===key).map(cardHtml).join('')}</div></section>`).join('');
  const sectionNav=groups.filter(([key])=>articles.some(a=>category(a)===key)).map(([key,label])=>`<a href="#articles-${key}">${label}</a>`).join('');
  return deps.pageShell({
    title: 'Collector Articles | The Mana Pocket',
    description: 'Comics, Pokémon, MTG and sports cards: release news, set guides, covers and collector notes from The Mana Pocket.',
    canonicalPath: '/articles',
    jsonLd: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Collector Articles',
      hasPart: articles.slice(0, 20).map(a => ({ '@type': 'Article', headline: a.title, url: `https://www.themanapocket.com/articles/${a.slug}`, datePublished: a.publishedAt || undefined })) },
    bodyHtml: STYLE + `<div style="max-width:900px;margin:0 auto"><div class="mp-crumb"><a href="/shop">← Shop</a></div><h1>Collector articles</h1><p><a href="/pocket-guides">Browse all Pocket Guides →</a></p><p class="mp-sub">New releases, set guides, and the cards and covers we’re watching.</p><nav class="mp-art-directories" aria-label="Checklists and drop guides"><a href="/secret-lair">Secret Lair drops</a><a href="/mtg">MTG checklists</a><a href="/pokemon">Pokémon checklists</a><a href="/baseball">Baseball checklists</a><a href="/football">Football checklists</a></nav><nav class="mp-art-shortcuts" aria-label="Article topics">${sectionNav}<a href="/secret-lair">Secret Lair</a></nav></div>` +
      (cards ? cards : `<p class="mp-sub" style="text-align:center">The first articles are on their way.</p>`),
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
  try { articles = await fetchArticles(env,ctx); }
  catch (error) {
    console.error('Articles unavailable:', error.message);
    return new Response(deps.pageShell({ title: 'Collector Articles | The Mana Pocket', description: 'Collector articles from The Mana Pocket.', canonicalPath: '/articles', robotsNoindex: true,
      bodyHtml: `<h1>Collector articles</h1><p><a href="/pocket-guides">Browse all Pocket Guides →</a></p><p class="mp-sub">Articles are temporarily unavailable. Please try again in a minute.</p>` }), { status: 503, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Retry-After': '60' } });
  }
  let html, status = 200;
  if (path === '/articles') html = renderArticleList(articles, deps);
  else {
    const slug = decodeURIComponent(path.slice('/articles/'.length)).split('/')[0];
    const article = articles.find(a => a.slug === slug);
    if (!article) {
      status = 404;
      html = deps.pageShell({ title: 'Article not found | The Mana Pocket', description: 'That article is not available.', canonicalPath: '/articles', robotsNoindex: true,
        bodyHtml: `<div class="mp-crumb"><a href="/articles">← Collector articles</a></div><h1>Article not found</h1><p class="mp-sub">It may have been renamed or taken down. <a href="/articles">See all collector articles</a>.</p>` });
    } else {
      // One inventory load shared by every book on the page. Each is the
      // whole store catalog (~5MB); five in parallel ran the Worker out of
      // memory, so the article page failed while the list page worked.
      let stock;
      const pageDeps = { ...deps, listItems: e => (stock ||= deps.listItems(e)) };
      const statuses = await Promise.all(article.books.map(book => bookStatus(env, pageDeps, book).catch(() => ({ name: book, state: 'coming', href: '' }))));
      if(releaseGuide(slug)) pageDeps.releaseInventoryHtml=renderReleaseInventory(slug,await pageDeps.listItems(env).catch(()=>null),deps);
      pageDeps.articleMarketplace=await articleMarketplace(env,ctx,article,releaseGuide(slug),deps).catch(()=>null);
      const related = relatedArticles(article, articles);
      html = renderArticlePage(article, statuses, related, pageDeps);
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
