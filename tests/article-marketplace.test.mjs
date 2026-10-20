import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {affiliateTcgImages,tcgImageAffiliateUrl,listingMatchesRelease,articleMarketplace,chooseArticleCards,ebayAffiliateListingUrl,renderArticleMarketplace,sportsArticleSet} from '../scripts/article-marketplace.mjs';
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const campaign='5339046175',href='https://www.ebay.com/itm/123?campid='+campaign;
assert.equal(ebayAffiliateListingUrl(href,campaign),href);
for(const bad of ['https://evil.test/itm/123?campid='+campaign,'javascript:bad','https://www.ebay.com/itm/123?campid=0000000000'])assert.equal(ebayAffiliateListingUrl(bad,campaign),null);
const article={slug:'2025-topps-series-2-baseball-collector-guide',bodyHtml:'<p>Manny Machado Heavy Lumber is here.</p>',updatedAt:'today'};
assert.equal(sportsArticleSet(article).id,'2025-topps-series-2-baseball');
assert.equal(listingMatchesRelease('2025 Topps Series 1 #2 auto',sportsArticleSet(article)),false);
assert.equal(listingMatchesRelease('2025 Topps Chrome Series 2 auto',sportsArticleSet(article)),false);
assert.equal(tcgImageAffiliateUrl('https://evil.test/123.jpg'),null);
const converted=affiliateTcgImages('<a href="https://product-images.tcgplayer.com/123.jpg"><img src="https://product-images.tcgplayer.com/123.jpg"></a><img src="https://product-images.tcgplayer.com/456.jpg">',esc);
const convertedDom=parseHTML('<html><body>'+converted+'</body></html>').document;
for(const image of convertedDom.querySelectorAll('img')){
 assert.ok(image.closest('a').getAttribute('href').startsWith('https://partner.tcgplayer.com/k443Ov?u='));
 assert.ok(image.closest('a').getAttribute('rel').includes('sponsored'));
}
const cards=chooseArticleCards([{name:'Pikachu',tcgPlayerId:123,cardNumber:'025'},{name:'Missing ID'},{name:'Pikachu alternate',tcgPlayerId:123}],{bodyHtml:'<p>Pikachu.</p>'});
assert.equal(cards.length,1);assert.ok(cards[0].href.startsWith('https://partner.tcgplayer.com/k443Ov?u='));
const store=new Map(),tasks=[];
const env={EBAY_PARTNER_CAMPAIGN_ID:campaign,LBA_KV:{get:async k=>store.get(k)||null,put:async(k,v)=>store.set(k,JSON.parse(v))}};
let searches=0;
const deps={searchEbay:async(q,c)=>{searches++;assert.equal(c,campaign);return {listings:[{itemId:q,title:'2025 Topps Series 2 '+(q.includes('autograph')?'Autograph':'Manny Machado Heavy Lumber'),affiliateUrl:href,imageUrl:'https://i.ebayimg.com/images/test.jpg',price:20,currency:'USD'},{itemId:'wrong-player',title:'2025 Topps Series 2 Corey Seager Heavy Lumber',affiliateUrl:href,imageUrl:'https://i.ebayimg.com/images/other.jpg'}, {itemId:'box',title:'2025 Topps Series 2 Baseball Hobby Box Factory Sealed 1 Autograph or Relic',affiliateUrl:href,imageUrl:'https://i.ebayimg.com/images/box.jpg'}, {itemId:'unsafe',title:'2025 Topps autograph',affiliateUrl:href,imageUrl:'https://evil.test/image.jpg'}]};}};
assert.equal(await articleMarketplace(env,{waitUntil:p=>tasks.push(p)},article,null,deps),null,'cold render does not wait for upstream');
await Promise.all(tasks);assert.equal(searches,2);
const hit=await articleMarketplace(env,{waitUntil:p=>tasks.push(p)},article,null,deps);
assert.equal(hit.cards.length,2);assert.equal(searches,2,'fresh gallery does not re-query eBay');
const rendered=renderArticleMarketplace(hit,article.bodyHtml,esc);
assert.ok(rendered.body.includes('mp-market-inline')&&rendered.body.includes('Heavy Lumber'));
const {document}=parseHTML('<html><body>'+rendered.body+rendered.after+'</body></html>');
for(const img of document.querySelectorAll('img')){
 const anchor=img.closest('a');assert.ok(anchor);assert.ok(anchor.getAttribute('rel').includes('sponsored'));assert.equal(new URL(anchor.getAttribute('href')).searchParams.get('campid'),campaign);
}
assert.ok(rendered.after.includes('check shipping')&&rendered.after.includes('third-party sellers'));
for(const v of store.values())v.checkedAt=Date.now()-16*60*1000;
const failedTasks=[];assert.equal(await articleMarketplace(env,{waitUntil:p=>failedTasks.push(p)},article,null,{searchEbay:async()=>{throw Error('offline');}}),null,'expired listing prices are never served');await Promise.all(failedTasks);
console.log('Marketplace cold/fresh/expired behavior, product IDs, inline cards and every-image affiliate attribution passed');
