// Public facts only: shared by visible product details and their JSON-LD.
export const storeOrganization = {
  '@context':'https://schema.org','@type':'Organization','@id':'https://www.themanapocket.com/#organization',
  name:'The Mana Pocket',url:'https://www.themanapocket.com/',
  logo:'https://s3.amazonaws.com/webflow-prod-assets/65b15ee0228d06647ca7e4ce/6a7ce7fd8466ce07d3c171d4_the_mana_pocket_patch_1024.png',
  sameAs:['https://www.facebook.com/profile.php?id=61592114016361','https://www.instagram.com/shopthemanapocket','https://whatnot.com/invite/themanapocket'],
};
export function productFacts(item) {
  const comic=item.comic||{};
  const ratio=[item.variant,comic.selectedCover,item.name].filter(Boolean).join(' ').match(/\b1\s*:\s*\d+\b/);
  return Object.entries({
    Category:item.category,Game:item.game,Sport:item.sport,Set:item.set,Year:item.year,
    'Player / character':item.player,Team:item.team,'Card number':item.cardNumber,
    'Product type':item.productType || item.configuration,Variant:item.variant,Finish:item.finish,Treatment:item.treatment,
    Language:item.language,Rarity:item.rarity,Condition:item.condition,'Grading company':item.gradingCompany,Grade:item.grade,
    Manufacturer:item.brand,'Signed by':item.signedBy,
    ...(item.isSigned ? {Autographed:'Yes'} : {}),...(item.isRelic ? {Relic:'Yes'} : {}),
    Publisher:comic.publisher,Series:comic.seriesName,'Issue number':comic.number,
    ...(ratio && item.categorySlug==='comics' ? {'Ratio variant':ratio[0].replace(/\s/g,'')} : {}),
    'Cover designation':comic.selectedCover,'Cover artist':comic.coverArtists?.join(', '),
    Writer:comic.writers?.join(', '),'Interior artist':comic.artists?.join(', '),'Release date':comic.storeDate,
  }).filter(([,value])=>value!=null&&String(value).trim()).map(([name,value])=>({name,value:String(value).trim()}));
}
// Distinct physical listings can share a name. Identify those exact copies
// with their real inventory identifier, without inventing edition metadata.
export function productHeading(item, catalog = []) {
  if (!catalog.some(other => other.id !== item.id && other.name === item.name)) return item.name;
  const uniqueSku = item.supplierSku && !catalog.some(other => other.id !== item.id && other.supplierSku === item.supplierSku);
  const shortId = item.id.slice(0,8);
  const copyId = catalog.some(other => other.id !== item.id && other.id.slice(0,8) === shortId) ? item.id : shortId;
  return `${item.name} — ${[item.condition, uniqueSku ? 'SKU '+item.supplierSku : 'Copy '+copyId].filter(Boolean).join(' · ')}`;
}
export function productCondition(value) {
  if(/^new(?:\b|$)/i.test(value||''))return 'https://schema.org/NewCondition';
  if(/^(?:NM|NM\s*\/\s*MT|NM-MT|LP|MP|HP|DMG|VF|FN|VG|GD|FR|PR)(?:\b|$)/i.test(value||''))return 'https://schema.org/UsedCondition';
  if(/^(?:used|pre.?owned|near mint|very fine|fine|very good|good|fair|poor|lightly played|moderately played|heavily played|damaged)\b/i.test(value||''))return 'https://schema.org/UsedCondition';
  return undefined; // A numeric grade alone doesn't establish condition.
}
export function renderShopPreview(items,esc,itemSlug) {
  const shown=items.slice(0,24);
  if(!shown.length)return '';
  return '<section id="mp-shop-server-products" aria-label="Available shop listings"><style>#mp-shop-server-products{padding:20px;color:inherit}#mp-shop-server-products .mp-preview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}#mp-shop-server-products article{padding:12px;border:1px solid #8b7a9a;border-radius:12px}#mp-shop-server-products img{width:100%;height:180px;object-fit:contain}#mp-shop-server-products a{color:inherit}#mp-shop-server-products h3{font:700 16px/1.4 system-ui,sans-serif}</style><h2>Available from the shop</h2><div class="mp-preview-grid">'+shown.map(item=>{
    const href=item.linkUrl||'/item/'+encodeURIComponent(item.id)+'/'+encodeURIComponent(itemSlug(item));
    const sellingPrice=Number.isFinite(item.price)&&item.price>0?'$'+item.price.toFixed(2)+' USD · In stock':'Price to be confirmed · View item details';
    return '<article><a href="'+esc(href)+'">'+(item.image?'<img src="'+esc(item.image)+'" alt="'+esc(item.name)+'" width="240" height="180" loading="lazy">':'')+'<h3>'+esc(item.name)+'</h3></a><p>'+sellingPrice+'</p>'+(item.condition?'<p>'+esc(item.condition)+'</p>':'')+'</article>';
  }).join('')+'</div><p><a href="/category">Browse all categories and product listings →</a></p></section>';
}
