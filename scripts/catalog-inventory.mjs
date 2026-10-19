// Match exact catalog printings to public inventory; never match by name alone.
const key=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const number=v=>String(v||'').split('/')[0].trim().toLowerCase().replace(/^0+(?=\d)/,'');
export function catalogInventoryMatches(item,card,game,set={}) {
  if(item.categorySlug!==game||item.isSealed||/sealed|booster|box|bundle|pack|deck/i.test(item.productType||''))return false;
  if(item.scryfallId&&card.scryfallId)return item.scryfallId===card.scryfallId;
  const productId=card.tcgPlayerId||card.tcgplayerId;
  if(item.tcgPlayerId&&productId)return String(item.tcgPlayerId)===String(productId);
  const sets=[card.setName,set.setName,set.name,card.setCode,set.setCode,set.id].map(key).filter(Boolean);
  const itemSets=[item.set,item.setCode].map(key).filter(Boolean);
  return !!number(card.collectorNumber||card.number)&&number(item.cardNumber)===number(card.collectorNumber||card.number)
    &&itemSets.some(s=>sets.includes(s))&&key(item.name)===key(card.name);
}
export function catalogInventoryHtml(items,card,game,set,deps) {
  if(!Array.isArray(items))return '<p class="mp-meta">Store availability is temporarily unavailable. The card details and checklist remain available.</p>';
  const found=items.filter(i=>Number.isFinite(i.price)&&i.price>0&&deps.available(i)&&catalogInventoryMatches(i,card,game,set));
  if(!found.length)return '<p class="mp-meta">No matching copies currently listed at The Mana Pocket.</p>';
  return renderCopies(found,deps);
}
export function tcgplayerAffiliateUrl(card) {
  const id=String(card.tcgPlayerId||card.tcgplayerId||'');
  if(!/^[1-9]\d*$/.test(id))return null;
  return 'https://partner.tcgplayer.com/k443Ov?u='+encodeURIComponent('https://www.tcgplayer.com/product/'+id);
}
export const marketplaceDisclosureHtml='<p class="mp-meta">Affiliate links: The Mana Pocket may earn a commission from qualifying purchases. Marketplace links open product pages or searches, not confirmed stock. Check the exact edition, finish, condition and seller before buying.</p>';
// Use the actual listing photo for our stock; reference artwork is not a photo
// of a physical copy and must not stand in for one.
export function catalogStoreCopyHtml(item,deps) {
  const esc=deps.escape,href=item.linkUrl||'/item/'+encodeURIComponent(item.id)+'/'+deps.slug(item.name);
  return '<a class="mp-store-copy" href="'+esc(href)+'" style="display:flex;gap:14px;align-items:center;padding:14px;border:1px solid var(--wo-border-strong,rgba(139,212,80,.35));border-radius:12px;text-decoration:none;color:inherit;min-width:0">'+(item.image?'<img src="'+esc(item.image)+'" alt="'+esc(item.name+' — our listing photo')+'" width="96" height="134" loading="lazy" decoding="async" style="width:96px;height:134px;object-fit:contain;flex:0 0 96px;border-radius:6px">':'')+'<span style="min-width:0;overflow-wrap:anywhere"><strong>'+esc(item.name)+'</strong><br><span>'+esc([item.condition,item.variant,item.gradingCompany&&item.gradingCompany+' '+(item.grade||'')].filter(Boolean).join(' · ')||'See listing for condition')+'</span><br><strong style="color:var(--wo-accent,#8bd450)">Buy our copy · $'+Number(item.price).toFixed(2)+' USD</strong></span></a>';
}
export function catalogShoppingIndex(items) {
  const byId=new Map(),byNameNumber=new Map();
  const add=(map,k,item)=>{if(!map.has(k))map.set(k,[]);map.get(k).push(item);};
  for(const item of Array.isArray(items)?items:[]){
    if(item.scryfallId)add(byId,'s:'+item.scryfallId,item);
    if(item.tcgPlayerId)add(byId,'t:'+item.tcgPlayerId,item);
    add(byNameNumber,key(item.name)+'|'+number(item.cardNumber),item);
  }
  return {candidates(card){return [...new Set([...(byId.get('s:'+card.scryfallId)||[]),...(byId.get('t:'+(card.tcgPlayerId||card.tcgplayerId))||[]),...(byNameNumber.get(key(card.name)+'|'+number(card.collectorNumber||card.number))||[])])];}};
}
// Keep real shop copies first. No marketplace prices or inventory claims are inferred.
export function catalogShoppingLinksHtml(items,card,game,set,deps) {
  const candidates=Array.isArray(items)?items:items?.candidates?.(card)||[];
  const found=candidates.filter(i=>Number.isFinite(i.price)&&i.price>0&&deps.available(i)&&catalogInventoryMatches(i,card,game,set));
  const own=found.slice(0,3).map(i=>catalogStoreCopyHtml(i,deps)).join('');
  const external=tcgplayerAffiliateUrl(card);
  return '<div class="mp-card-shopping">'+(own?'<div style="display:grid;gap:10px">'+own+'</div>':'')+(external?'<p><a target="_blank" rel="noopener sponsored" href="'+deps.escape(external)+'">View sellers on TCGplayer</a></p>':'')+'</div>';
}
function renderCopies(found,deps) {
  return '<section class="mp-catalog-stock"><h2>Available at The Mana Pocket</h2><p>These are store listings for matching printings. Open a copy for its photos, condition and available quantity.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px">'+found.map(i=>catalogStoreCopyHtml(i,deps)).join('')+'</div></section>';
}
export function catalogSetInventoryHtml(items,cards,game,set,deps) {
  if(!Array.isArray(items))return '<p class="mp-meta">Store availability is temporarily unavailable. The card details and checklist remain available.</p>';
  const found=items.filter(i=>Number.isFinite(i.price)&&i.price>0&&deps.available(i)&&cards.some(card=>catalogInventoryMatches(i,card,game,set)));
  return found.length?renderCopies([...new Map(found.map(i=>[i.id,i])).values()],deps):'<p class="mp-meta">No matching singles from this set are currently listed at The Mana Pocket. <a href="/category/'+game+'">Browse current '+(game==='mtg'?'MTG':'Pokémon')+' inventory</a>.</p>';
}
