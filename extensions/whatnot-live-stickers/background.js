// Logs each sale and opens the sticker print window.
var DEFAULTS = { enabled:true, giveaways:true, size:'2x1' };
function settings(){ return chrome.storage.local.get({ settings:DEFAULTS }).then(function(r){ return Object.assign({}, DEFAULTS, r.settings); }); }
async function printSale(id){
  await chrome.windows.create({ url:chrome.runtime.getURL('label.html?id=' + encodeURIComponent(id)), type:'popup', width:420, height:320, focused:false });
}
async function recordSale(sale){
  var s = await settings();
  if(!s.enabled) return;
  if(sale.type === 'giveaway' && !s.giveaways) return;
  var data = await chrome.storage.local.get({ sales:[] });
  var id = 'wls_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  var entry = Object.assign({ id:id }, sale);
  data.sales.unshift(entry);
  await chrome.storage.local.set({ sales:data.sales.slice(0, 1000) });
  await printSale(id);
}
chrome.runtime.onMessage.addListener(function(msg){
  if(msg && msg.type === 'wls-sale' && msg.sale) recordSale(msg.sale);
  if(msg && msg.type === 'wls-reprint' && msg.id) printSale(msg.id);
});
