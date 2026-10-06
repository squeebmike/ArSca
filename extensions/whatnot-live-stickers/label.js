// Renders one sticker, prints it, and closes. Start Chrome with
// --kiosk-printing (see README) and this prints straight to the default
// printer with no dialog.
(async function(){
  var id = new URLSearchParams(location.search).get('id');
  var data = await chrome.storage.local.get({ sales:[], settings:{ size:'2x1' } });
  var sale = data.sales.find(function(s){ return s.id === id; });
  var size = (data.settings && data.settings.size) || '2x1';
  var el = document.getElementById('label');
  if(!sale){ el.textContent = 'Sale not found'; return; }
  var dims = { '2x1':'2in 1in', '3x2':'3in 2in', '4x6':'4in 6in' }[size] || '2in 1in';
  var page = document.createElement('style');
  page.textContent = '@page { size:' + dims + '; margin:0; }';
  document.head.appendChild(page);
  el.className = 'label size-' + size;
  var when = new Date(sale.at || Date.now());
  var stamp = (when.getMonth() + 1) + '/' + when.getDate() + ' ' + when.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  var buyer = document.createElement('div'); buyer.className = 'buyer'; buyer.textContent = '@' + sale.buyer;
  var title = document.createElement('div'); title.className = 'title';
  title.textContent = sale.type === 'giveaway' ? 'GIVEAWAY' : [sale.title, sale.subtitle].filter(Boolean).join(' · ') || 'Whatnot item';
  var meta = document.createElement('div'); meta.className = 'meta';
  var left = document.createElement('span'); left.textContent = sale.price ? '$' + sale.price : (sale.type === 'bin' ? 'Buy It Now' : '');
  var right = document.createElement('span'); right.textContent = stamp;
  meta.appendChild(left); meta.appendChild(right);
  el.appendChild(buyer); el.appendChild(title); el.appendChild(meta);
  // Tell the extension this sticker went to the printer (anything that never
  // reports back shows up as missed).
  window.addEventListener('afterprint', function(){ try { chrome.runtime.sendMessage({ type:'wls-printed', id:id }); } catch(e) {} setTimeout(function(){ window.close(); }, 200); });
  setTimeout(function(){ window.print(); }, 150);
})();
