function productShoppingClient(){
  var image=document.getElementById('mp-product-image'),out=document.getElementById('mp-product-cart-status'),button=document.getElementById('mp-product-add');
  document.querySelectorAll('[data-product-photo]').forEach(function(link){link.addEventListener('click',function(event){if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button)return;event.preventDefault();if(!image)return;image.src=link.href;var full=document.getElementById('mp-product-full-image');if(full)full.href=link.href;document.querySelectorAll('[data-product-photo]').forEach(function(other){other.removeAttribute('aria-current');});link.setAttribute('aria-current','true');});});
  if(!button)return;
  if(typeof MutationObserver==='function')new MutationObserver(function(){
    if(!out||!out.textContent||!window.WO||typeof window.WO.getCart!=='function')return;
    var data;try{data=JSON.parse(document.getElementById('mp-product-cart-data').textContent);}catch(error){return;}
    var line=window.WO.getCart().find(function(row){return row.id===data.id;});
    if(!line||!line.qty)out.textContent='';
  }).observe(document.body,{childList:true,subtree:true});
  button.addEventListener('click',function(event){
    if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button)return;
    var cart=window.WO;if(!cart||typeof cart.addToCart!=='function'||typeof cart.getCart!=='function')return;
    var data;try{data=JSON.parse(document.getElementById('mp-product-cart-data').textContent);}catch(error){return;}
    event.preventDefault();var before=(cart.getCart().find(function(line){return line.id===data.id;})||{}).qty||0;
    if(before>=data.available){out.textContent='You already have all available copies in your cart.';return;}
    cart.addToCart(data,button);
    var after=(cart.getCart().find(function(line){return line.id===data.id;})||{}).qty||0;
    out.textContent=after>before?'Added to your cart. '+after+' in cart.':'This item could not be added. Please try the shop.';
  });
}
export function productShoppingParts(item,available,esc){
  const photos=[...new Set([item.image,...(item.photos||[])].filter(Boolean))].slice(0,8);
  const gallery=photos.length?`<div class="mp-product-gallery"><a href="${esc(photos[0])}" id="mp-product-full-image" target="_blank" rel="noopener" aria-label="Open larger image of ${esc(item.name)}"><img id="mp-product-image" src="${esc(photos[0])}" alt="${esc(item.name)}" width="600" height="600" style="width:100%;height:auto;aspect-ratio:1/1;object-fit:contain;background:#16101f" fetchpriority="high"></a>${photos.length>1?`<nav class="mp-product-thumbs" aria-label="Product photos">${photos.map((src,i)=>`<a href="${esc(src)}" data-product-photo${i===0?' aria-current="true"':''} aria-label="View photo ${i+1} of ${photos.length}"><img src="${esc(src)}" alt="${esc(item.name)} — photo ${i+1}" width="64" height="64" loading="lazy"></a>`).join('')}</nav>`:''}<p class="mp-product-note">Tap the image to view it larger.</p></div>`:'<div class="mp-product-no-photo">Photo not available yet.</div>';
  const qty=Math.max(0,Math.floor(Number(item.quantity)||0)),priced=Number.isFinite(Number(item.price))&&Number(item.price)>0;
  const buy=`<div id="mp-buy" class="mp-product-buy"><p class="mp-product-stock">${available?`In stock · ${qty===1?'Only 1 available':qty+' available'}`:'Currently unavailable'}</p>${available&&priced?`<a id="mp-product-add" href="/shop?item=${encodeURIComponent(item.id)}" class="mp-product-add">Add to cart →</a><a class="mp-product-shop" href="/shop">Keep shopping</a><p id="mp-product-cart-status" role="status" aria-live="polite"></p><script id="mp-product-cart-data" type="application/json">${JSON.stringify({id:item.id,name:item.name,category:item.category||'',price:Number(item.price),image:item.image||'',available:qty}).replace(/</g,'\\u003c')}</script>`:available?'<p>Price has not been confirmed. <a href="/links">Contact the shop</a> before buying.</p>':'<p>This listing is currently unavailable. Browse the category for available copies.</p>'}</div>`;
  const styles='<style>.mp-product-gallery{min-width:0}.mp-detail h2{font:800 20px/1.3 system-ui!important}.mp-detail dt{font:750 14px/1.5 system-ui!important}.mp-detail dd{font:400 14px/1.5 system-ui!important}.mp-product-thumbs{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.mp-product-thumbs a{display:block;width:64px;border:2px solid transparent;border-radius:8px}.mp-product-thumbs a[aria-current]{border-color:#9be34c}.mp-detail .mp-product-thumbs img{width:60px;height:60px;object-fit:contain}.mp-product-note{font:13px/1.4 system-ui;color:#c8b8d9}.mp-product-stock{font:750 15px/1.5 system-ui;margin:0 0 12px}.mp-product-add{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 22px;background:#9be34c;color:#1d1028!important;border-radius:10px;text-decoration:none;font:850 16px system-ui}.mp-product-shop{display:inline-block;margin:12px;font:650 14px system-ui}.mp-product-buy{padding:16px;border:1px solid #73518e;border-radius:12px;background:#281b36;margin:12px 0 18px;scroll-margin-top:100px}.mp-product-buy [role=status]{font:14px/1.5 system-ui;min-height:20px;margin:8px 0 0}.mp-product-no-photo{min-height:180px;display:grid;place-items:center;background:#21172c;border-radius:12px}.mp-product-add:focus-visible,.mp-product-thumbs a:focus-visible{outline:3px solid #fff;outline-offset:3px}</style>';
  return {gallery,buy,styles,script:'<script>('+productShoppingClient.toString()+')();</script>'};
}
