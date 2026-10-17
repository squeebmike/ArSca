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
function renderCopies(found,deps) {
  return '<section class="mp-catalog-stock"><h2>Available at The Mana Pocket</h2><p>These are store listings for matching printings. Open a copy for its photos, condition and available quantity.</p>'+found.map(i=>'<a class="mp-set-row" href="'+deps.escape(i.linkUrl||'/item/'+encodeURIComponent(i.id)+'/'+deps.slug(i.name))+'"><span>'+deps.escape(i.name)+' · '+deps.escape([i.condition,i.variant,i.gradingCompany&&i.gradingCompany+' '+(i.grade||'')].filter(Boolean).join(' · '))+'</span><strong>$'+Number(i.price).toFixed(2)+' USD · View this copy →</strong></a>').join('')+'</section>';
}
export function catalogSetInventoryHtml(items,cards,game,set,deps) {
  if(!Array.isArray(items))return '<p class="mp-meta">Store availability is temporarily unavailable. The card details and checklist remain available.</p>';
  const found=items.filter(i=>Number.isFinite(i.price)&&i.price>0&&deps.available(i)&&cards.some(card=>catalogInventoryMatches(i,card,game,set)));
  return found.length?renderCopies([...new Map(found.map(i=>[i.id,i])).values()],deps):'<p class="mp-meta">No matching singles from this set are currently listed at The Mana Pocket. <a href="/category/'+game+'">Browse current '+(game==='mtg'?'MTG':'Pokémon')+' inventory</a>.</p>';
}
