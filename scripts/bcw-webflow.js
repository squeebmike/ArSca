// Native Webflow page owns the heading, copy, navbar and footer.
// This enhancement displays only published BCW listings from the public API.
(function(){
  'use strict';
  const root=document.getElementById('bcw-catalog');if(!root)return;
  const endpoint='https://still-resonance-4f87.swarnerauto.workers.dev/public/bcw';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>'$'+Number(v||0).toFixed(2);
  const available=i=>i.quantity>0&&(!i.supplierAvailability||i.supplierAvailability==='in_stock');
  const safeImage=v=>{try{const u=new URL(v);return u.protocol==='https:'?u.href:'';}catch{return '';}};
  const style=document.createElement('style');style.textContent=`
  #bcw-catalog{color:var(--wo-text,#f4f3f8)}#bcw-catalog a{color:inherit}#bcw-catalog .bcw-controls{display:flex;gap:14px;flex-wrap:wrap;margin:20px 0}#bcw-catalog label{display:grid;gap:8px;flex:1;min-width:180px}#bcw-catalog input,#bcw-catalog select{font:inherit;width:100%;padding:12px;border:1px solid #555;border-radius:8px;background:var(--wo-surface-alt,#191b25);color:inherit}#bcw-catalog button,.bcw-catalog-button{font:inherit;padding:12px 18px;border:0;border-radius:8px;background:var(--wo-accent,#bdff69);color:var(--wo-surface,#111);cursor:pointer;font-weight:700}#bcw-catalog button:disabled{opacity:.5;cursor:default}#bcw-catalog .bcw-controls button{align-self:end}#bcw-catalog .bcw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:20px}#bcw-catalog .bcw-card{border:1px solid #555;border-radius:12px;overflow:hidden;background:var(--wo-surface-alt,#191b25)}#bcw-catalog .bcw-card a{text-decoration:none;display:block}#bcw-catalog .bcw-card img{background:white;width:100%;height:230px;object-fit:contain;padding:12px}#bcw-catalog .bcw-card-copy{padding:18px}#bcw-catalog h2{font-size:23px;line-height:1.3}#bcw-catalog .bcw-card h2{font-size:18px}#bcw-catalog .bcw-sku{font-size:12px;opacity:.75;overflow-wrap:anywhere}#bcw-catalog .bcw-price{font-size:24px;color:var(--wo-accent,#bdff69);font-weight:700}#bcw-catalog .bcw-empty{padding:42px 24px;border:1px solid #555;border-radius:12px;text-align:center}#bcw-catalog .bcw-pager{display:flex;justify-content:space-between;margin-top:28px}#bcw-catalog .bcw-detail{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:24px}#bcw-catalog .bcw-detail img{width:100%;max-height:500px;object-fit:contain;background:white;border-radius:12px}#bcw-catalog .bcw-photos{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}#bcw-catalog .bcw-photos img{height:90px}#bcw-catalog .bcw-description{white-space:pre-line;line-height:1.7}#bcw-catalog th,#bcw-catalog td{text-align:left;padding:10px;border-bottom:1px solid #555}#bcw-catalog a:focus-visible,#bcw-catalog button:focus-visible{outline:3px solid var(--wo-accent,#bdff69);outline-offset:4px}@media(max-width:767px){#bcw-catalog .bcw-detail{grid-template-columns:1fr}#bcw-catalog .bcw-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}#bcw-catalog .bcw-card img{height:160px}#bcw-catalog .bcw-card-copy{padding:12px}}
  `;document.head.appendChild(style);
  let active=null,requestNumber=0;
  const href=p=>'/bcw'+(p.size?'?'+p:'');
  async function load(){
    const token=++requestNumber;active=null;root.setAttribute('aria-busy','true');
    root.innerHTML='<p role="status">Loading our BCW selection…</p>';
    const params=new URLSearchParams(location.search),query=new URLSearchParams();
    for(const key of ['q','category','page','item'])if(params.has(key))query.set(key,params.get(key));
    try{
      const response=await fetch(endpoint+'?'+query,{credentials:'omit'});
      if(!response.ok)throw Error(response.status===404?'That product is no longer listed.':'The catalog is temporarily unavailable. Please try again.');
      const data=await response.json();if(token!==requestNumber)return;
      if(data.item){active=data.item;renderProduct(active);}else renderCatalog(data);
    }catch(error){if(token!==requestNumber)return;root.innerHTML='<div class="bcw-empty"><h2>Unable to load supplies</h2><p>'+esc(error.message)+'</p><button type="button" data-bcw-retry>Try again</button> <a href="/bcw">Browse all supplies</a></div>';}
    finally{if(token===requestNumber)root.removeAttribute('aria-busy');}
  }
  function renderCatalog(data){
    const pageHref=n=>{const p=new URLSearchParams();if(data.q)p.set('q',data.q);if(data.category)p.set('category',data.category);if(n>1)p.set('page',n);return href(p);};
    root.innerHTML=`<form class="bcw-controls" action="/bcw"><label>Find a product or BCW SKU<input name="q" type="search" value="${esc(data.q)}" placeholder="Comic bags, sleeves, storage…"></label><label>Category<select name="category"><option value="">All categories</option>${data.categories.map(c=>`<option value="${esc(c)}"${c===data.category?' selected':''}>${esc(c)}</option>`).join('')}</select></label><button>Search supplies</button></form><p role="status">${data.total} products${data.total?' · Page '+data.page+' of '+data.pages:''}</p>${data.items.length?`<div class="bcw-grid">${data.items.map(i=>`<article class="bcw-card"><a href="/bcw?item=${encodeURIComponent(i.id)}">${safeImage(i.image)?`<img src="${esc(safeImage(i.image))}" alt="${esc(i.name)}" loading="lazy">`:''}<div class="bcw-card-copy"><p class="bcw-sku">BCW · ${esc(i.supplierSku)}</p><h2>${esc(i.name)}</h2><p>${esc(i.supplierSellingUnit)}</p><p class="bcw-price">${money(i.price)}</p><p class="bcw-sku">${available(i)?'Ships from supplier':'Currently unavailable'}</p></div></a></article>`).join('')}</div>`:`<div class="bcw-empty"><h2>${data.q||data.category?'No matching supplies':'BCW supplies are coming soon'}</h2><p>${data.q||data.category?'Try another product name, SKU, or category.':'We’re preparing our selection of comic bags, card protection, storage, and display supplies.'}</p><a href="${data.q||data.category?'/bcw':'/shop'}">${data.q||data.category?'Browse all supplies':'Explore the shop'} →</a></div>`}<nav class="bcw-pager" aria-label="Catalog pages">${data.page>1?`<a href="${esc(pageHref(data.page-1))}">← Previous</a>`:'<span></span>'}${data.page<data.pages?`<a href="${esc(pageHref(data.page+1))}">Next →</a>`:''}</nav>`;
  }
  function renderProduct(i){
    const photos=(i.photos||[i.image]).map(safeImage).filter(Boolean);
    const productUrl='https://themanapocket.com/bcw?item='+encodeURIComponent(i.id);
    document.title=i.name+' | BCW Supplies | The Mana Pocket';
    let canonical=document.querySelector('link[rel="canonical"]');if(!canonical){canonical=document.createElement('link');canonical.rel='canonical';document.head.appendChild(canonical);}canonical.href=productUrl;
    const description=String(i.description||i.name+' from BCW at The Mana Pocket.').replace(/\s+/g,' ').slice(0,160);
    for(const [name,content] of [['description',description],['og:title',document.title],['og:description',description],['og:url',productUrl]]){let meta=document.querySelector('meta['+(name.startsWith('og:')?'property':'name')+'="'+name+'"]');if(!meta){meta=document.createElement('meta');meta.setAttribute(name.startsWith('og:')?'property':'name',name);document.head.appendChild(meta);}meta.content=content;}
    const schema=document.createElement('script');schema.type='application/ld+json';schema.textContent=JSON.stringify({'@context':'https://schema.org','@type':'Product',name:i.name,description:i.description||description,image:photos,sku:i.supplierSku||i.id,brand:{'@type':'Brand',name:'BCW'},offers:{'@type':'Offer',url:productUrl,priceCurrency:'USD',price:i.price,availability:'https://schema.org/'+(available(i)?'InStock':'OutOfStock')}});document.head.appendChild(schema);
    root.innerHTML=`<a href="/bcw">← All BCW supplies</a><article class="bcw-detail"><div>${photos[0]?`<img src="${esc(photos[0])}" alt="${esc(i.name)}">`:''}<div class="bcw-photos">${photos.slice(1).map(p=>`<a href="${esc(p)}"><img src="${esc(p)}" alt="${esc(i.name)} additional view" loading="lazy"></a>`).join('')}</div></div><div><h2>${esc(i.name)}</h2><p class="bcw-sku">BCW SKU: ${esc(i.supplierSku)}</p><p>${esc(i.supplierSellingUnit)}</p><p class="bcw-price">${money(i.price)}</p><p>${available(i)?'Ships directly from our supplier':'Currently unavailable'}</p><button type="button" data-bcw-add ${available(i)?'':'disabled'}>${available(i)?'Add to cart':'Out of stock'}</button><p role="status" id="bcw-cart-status"></p><p class="bcw-description">${esc(i.description)}</p><table>${Object.entries(i.supplierSpecifications||{}).map(([k,v])=>`<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></div></article>`;
  }
  root.addEventListener('click',e=>{
    if(e.target.closest('[data-bcw-retry]')){load();return;}
    const button=e.target.closest('[data-bcw-add]');if(!button||!active||!available(active))return;
    const status=document.getElementById('bcw-cart-status');
    if(!window.WO?.addToCart){status.textContent='The cart is still loading. Please try again in a moment.';return;}
    window.WO.addToCart({id:active.id,name:active.name,price:active.price,image:active.image,available:active.quantity,dropship:true},button);status.textContent='Added to your cart.';
  });
  load();
})();
