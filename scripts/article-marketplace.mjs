import {tcgplayerAffiliateUrl,marketplaceDisclosureHtml} from './catalog-inventory.mjs';
import {baseballSets} from './topps/baseball-seed.mjs';
import {footballSets} from './topps/football-seed.mjs';
const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ');
const httpsHost=(value,host)=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname===host||u.hostname.endsWith('.'+host));}catch{return false;}};
export function tcgImageAffiliateUrl(image){
 if(!httpsHost(image,'tcgplayer.com'))return null;
 const id=new URL(image).pathname.match(/\/(\d+)(?:_[^/]*)?\.(?:jpg|png|webp)$/i)?.[1];
 return id?tcgplayerAffiliateUrl({tcgPlayerId:id}):null;
}
export function affiliateTcgImages(body,esc){
 return body.replace(/<a\b[^>]*>[\s\S]*?<\/a>|<img\b[^>]*>/gi,markup=>{
  const image=markup.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  const href=image&&tcgImageAffiliateUrl(image);if(!href)return markup;
  const attrs=' href="'+esc(href)+'" target="_blank" rel="noopener sponsored"';
  if(/^<a\b/i.test(markup))return markup.replace(/^<a\b([^>]*)>/i,(_,old)=>'<a'+old.replace(/\s+(?:href|target|rel)\s*=\s*(?:"[^"]*"|'[^']*')/gi,'')+attrs+'>');
  return '<a'+attrs+'>'+markup+'</a>';
 });
}
export function ebayAffiliateListingUrl(value,campaign){
 if(!/^\d{10}$/.test(String(campaign||''))||!httpsHost(value,'ebay.com'))return null;
 const url=new URL(value);return url.searchParams.get('campid')===String(campaign)?url.href:null;
}
export function sportsArticleSet(article){
 return [...baseballSets,...footballSets].filter(s=>article.slug===s.id||article.slug.startsWith(s.id+'-')).sort((a,b)=>b.id.length-a.id.length)[0]||null;
}
export function listingMatchesRelease(title,set){
 const text=fold(title),release=fold(set.displayName),words=new Set(text.split(' '));
 if(!words.has(String(set.year)))return false;
 const series=release.match(/\bseries (\d+)\b/);
 if(series&&!text.includes('series '+series[1]))return false;
 if(!release.includes('chrome')&&words.has('chrome'))return false;
 return release.split(' ').filter(w=>w&&!['baseball','football','cards','s','series'].includes(w)&&!/^\d+$/.test(w)).every(w=>text.includes(w));
}
export function chooseArticleCards(cards,article){
 const text=fold(article.bodyHtml.replace(/<[^>]*>/g,' ')),seen=new Set(),names=new Set();
 return cards.filter(c=>c.name&&/^[1-9]\d*$/.test(String(c.tcgPlayerId||c.tcgplayer_id||'')))
  .map(c=>({...c,tcgPlayerId:String(c.tcgPlayerId||c.tcgplayer_id),mentioned:text.includes(fold(c.name))}))
  .sort((a,b)=>Number(b.mentioned)-Number(a.mentioned)||Number(b.prices?.usd||b.prices?.market||b.marketPrice||0)-Number(a.prices?.usd||a.prices?.market||a.marketPrice||0))
  .filter(c=>{if(seen.has(c.tcgPlayerId)||names.has(fold(c.name)))return false;seen.add(c.tcgPlayerId);names.add(fold(c.name));return true;}).slice(0,6)
  .map(c=>({kind:'tcgplayer',id:c.tcgPlayerId,name:c.name,number:c.collector_number||c.collectorNumber||c.cardNumber||'',set:c.set_name||c.setName||'',image:'https://product-images.tcgplayer.com/fit-in/437x437/'+c.tcgPlayerId+'.jpg',href:tcgplayerAffiliateUrl(c)}));
}
// Public marketplace references only. Cold/expired reads enqueue refresh and
// return immediately; no marketplace API request blocks article rendering.
export async function articleMarketplace(env,ctx,article,guide,deps){
 const set=sportsArticleSet(article),tcg=['mtg','pokemon'].includes(guide?.game);
 if(!set&&!tcg)return null;
 const campaign=String(env.EBAY_PARTNER_CAMPAIGN_ID||'');
 if(set&&!/^\d{10}$/.test(campaign))return null;
 if(!env.LBA_KV||!ctx?.waitUntil)return null;
 const key='article-marketplace:v2:'+article.slug+':'+String(article.updatedAt||'')+':'+(set?campaign:'tcg');
 const now=Date.now(),ttl=set?15*60*1000:6*60*60*1000;
 let cached;try{cached=await env.LBA_KV.get(key,'json');}catch{}
 const fresh=cached&&Number(cached.checkedAt)<=now&&now-Number(cached.checkedAt)<ttl;
 const refresh=async()=>{
  try{
   let cards=[];
   if(tcg)cards=chooseArticleCards(await deps.loadCards(guide),article);
   else{
    const text=fold(article.bodyHtml),insert=text.includes('heavy lumber')?'Heavy Lumber':'insert';
    const groups=[['Autographs','autograph'],[insert==='insert'?'Inserts':'Heavy Lumber',insert]];
    const seen=new Set();
    // Sequential requests keep eBay traffic bounded for each known article.
    for(const [label,term] of groups){
     const result=await deps.searchEbay(set.displayName+' '+term,campaign);
     if(result.warning)continue;
     for(const listing of result.listings||[]){
      const href=ebayAffiliateListingUrl(listing.affiliateUrl,campaign),title=fold(listing.title);
      if(!href||!httpsHost(listing.imageUrl,'ebayimg.com')||seen.has(listing.itemId)||!listingMatchesRelease(listing.title,set)||/\b(?:break|digital|reprint|lot|replica|box|boxes|pack|packs|case|cases|sealed)\b/.test(title))continue;
      if(/you pick|choose your|complete set|set of/.test(title))continue;
      if(term==='autograph'&&!/\b(?:auto|autograph|autographs|signed)\b/.test(title))continue;
      if(term==='Heavy Lumber'&&!title.includes('heavy lumber'))continue;
      if(term==='insert'&&!/\binsert\b/.test(title))continue;
      if(listing.endTime&&Date.parse(listing.endTime)<=Date.now())continue;
      seen.add(listing.itemId);cards.push({kind:'ebay',id:listing.itemId,name:listing.title,image:listing.imageUrl,href,label,price:listing.currency==='USD'?listing.price:null,endTime:listing.endTime});
      if(cards.filter(c=>c.label===label).length>=3)break;
     }
    }
   }
   await env.LBA_KV.put(key,JSON.stringify({checkedAt:Date.now(),cards}),{expirationTtl:Math.ceil(ttl/1000)});
  }catch{console.warn('Article marketplace refresh unavailable',{slug:article.slug});}
 };
 if(!fresh||now-Number(cached.checkedAt)>ttl*.8)ctx.waitUntil(refresh());
 return fresh?{...cached,cards:(cached.cards||[]).filter(c=>!c.endTime||Date.parse(c.endTime)>now)}:null;
}
export const articleMarketplaceStyles=`<style>.mp-market-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:18px;margin:18px 0 28px}.mp-market-card{padding:14px;border:1px solid var(--wo-border,rgba(255,255,255,.2));border-radius:14px;background:var(--wo-surface,transparent);min-width:0}.mp-market-card img{display:block;width:100%;height:240px;object-fit:contain;border-radius:8px;background:var(--wo-bg,transparent)}.mp-market-card h3{font-size:16px;line-height:1.5;margin:12px 0 8px}.mp-market-card p{font-size:13px;line-height:1.6;margin:8px 0}.mp-market-card a{color:var(--wo-accent,inherit)}.mp-market-card>a:last-child{display:inline-flex;align-items:center;min-height:44px;font:700 14px/1.5 system-ui}.mp-market-inline{max-width:320px;margin:22px auto}</style>`;
function cardHtml(c,esc){
 const label=c.kind==='ebay'?'View listing on eBay':'View sellers on TCGplayer';
 return '<article class="mp-market-card"><a href="'+esc(c.href)+'" target="_blank" rel="noopener sponsored" aria-label="'+esc(c.name+' â€” '+label)+'"><img src="'+esc(c.image)+'" alt="'+esc(c.name+(c.number?' #'+c.number:''))+'" width="300" height="420" loading="lazy" decoding="async"></a><h3>'+esc(c.name)+'</h3><p>'+esc(c.kind==='ebay'?(c.label+' Â· Seller listing photo'):[c.set,c.number&&'#'+c.number,'Product reference image'].filter(Boolean).join(' Â· '))+'</p>'+(Number(c.price)>0?'<p>Listed at $'+Number(c.price).toFixed(2)+' USD Â· check shipping with the seller</p>':'')+'<a href="'+esc(c.href)+'" target="_blank" rel="noopener sponsored">'+label+' â†’</a></article>';
}
export function renderArticleMarketplace(data,body,esc){
 if(!data?.cards?.length)return {body,after:''};
 const remaining=new Set(data.cards);
 let inlineCount=0;
 const mixed=body.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi,p=>{
  if(inlineCount>=2)return p;
  const text=fold(p.replace(/<[^>]*>/g,' '));
  const found=[...remaining].find(c=>c.kind==='tcgplayer'?text.includes(fold(c.name)):c.label==='Heavy Lumber'&&text.includes('heavy lumber'));
  if(!found)return p;remaining.delete(found);inlineCount++;
  return p+'<aside class="mp-market-inline" aria-label="Affiliate marketplace card">'+cardHtml(found,esc)+'<p class="mp-meta">Affiliate link Â· Check the exact printing and seller.</p></aside>';
 });
 const stamp=new Date(data.checkedAt).toISOString().replace('T',' ').slice(0,16)+' UTC';
 const after=articleMarketplaceStyles+'<section class="mp-article-marketplace"><h2>More cards to explore</h2>'+marketplaceDisclosureHtml+'<p class="mp-meta">Marketplace data checked '+esc(stamp)+'. Listings can sell or change. These are third-party sellers, separate from our stock. Cards shown are selected from this set, not a live popularity ranking.</p>'+(remaining.size?'<div class="mp-market-grid">'+[...remaining].map(c=>cardHtml(c,esc)).join('')+'</div>':'')+'</section>';
 return {body:mixed,after};
}
