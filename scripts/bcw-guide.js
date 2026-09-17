// SKU references resolve only to the store's published, available listings.
(async function(){
  const slots=[...document.querySelectorAll('[data-bcw-skus]')];if(!slots.length)return;
  const endpoint='https://still-resonance-4f87.swarnerauto.workers.dev/public/bcw';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const requests=new Map();
  function lookup(sku){if(!requests.has(sku))requests.set(sku,fetch(endpoint+'?q='+encodeURIComponent(sku)).then(r=>{if(!r.ok)throw Error('Catalog unavailable');return r.json();}).then(d=>d.items.find(i=>i.supplierSku===sku&&i.supplierAvailability==='in_stock'&&i.quantity>0)));return requests.get(sku);}
  // Sequential slots keep the small recommendation queries bounded.
  for(const slot of slots){
    try{
      const products=[];
      for(const sku of slot.dataset.bcwSkus.split(',')){const item=await lookup(sku.trim());if(item)products.push(item);}
      if(!products.length)continue;
      slot.innerHTML=products.map(i=>`<article class="bcwg-product">${/^https:\/\//i.test(i.image)?`<img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy">`:''}<h3>${esc(i.name)}</h3><small>BCW SKU ${esc(i.supplierSku)}</small><p>${esc(i.supplierSellingUnit)}</p><p class="bcwg-price">$${Number(i.price).toFixed(2)}</p><a class="bcwg-button" href="/bcw?item=${encodeURIComponent(i.id)}">View &amp; buy</a></article>`).join('');
    }catch{slot.textContent='Product recommendations are temporarily unavailable. Browse our BCW supplies for current listings.';}
  }
})();
