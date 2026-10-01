// Logs each sale, opens the sticker print window, and hands sales to the
// Mana Pocket dashboard (through an open dashboard tab) until it confirms
// they're recorded.
var DEFAULTS = { enabled:true, giveaways:true, size:'2x1' };
var DASHBOARD_URLS = ['https://squeebmike.github.io/ArSca/*', 'https://arsca-beta.pages.dev/*'];
function settings(){ return chrome.storage.local.get({ settings:DEFAULTS }).then(function(r){ return Object.assign({}, DEFAULTS, r.settings); }); }
async function printSale(id){
  await chrome.windows.create({ url:chrome.runtime.getURL('label.html?id=' + encodeURIComponent(id)), type:'popup', width:420, height:320, focused:false });
}
async function pendingSales(){
  var data = await chrome.storage.local.get({ sales:[] });
  return data.sales.filter(function(s){ return !s.synced && !s.test; }).reverse();
}
async function pushToDashboards(sales){
  if(!sales.length) return;
  var tabs = await chrome.tabs.query({ url:DASHBOARD_URLS }).catch(function(){ return []; });
  tabs.forEach(function(tab){ chrome.tabs.sendMessage(tab.id, { type:'wls-push', sales:sales }).catch(function(){}); });
}
async function markSynced(ids){
  var data = await chrome.storage.local.get({ sales:[] });
  var set = new Set(ids || []);
  data.sales.forEach(function(s){ if(set.has(s.id)) s.synced = true; });
  await chrome.storage.local.set({ sales:data.sales });
}
async function recordSale(sale){
  var s = await settings();
  if(!s.enabled) return;
  if(sale.type === 'giveaway' && !s.giveaways) return;
  var data = await chrome.storage.local.get({ sales:[] });
  var id = 'wls_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  var entry = Object.assign({ id:id, synced:false }, sale);
  data.sales.unshift(entry);
  await chrome.storage.local.set({ sales:data.sales.slice(0, 1000) });
  await printSale(id);
  pushToDashboards([entry]);
}
chrome.runtime.onMessage.addListener(function(msg, _sender, reply){
  if(!msg) return;
  if(msg.type === 'wls-sale' && msg.sale) recordSale(msg.sale);
  if(msg.type === 'wls-reprint' && msg.id) printSale(msg.id);
  if(msg.type === 'wls-pending'){ pendingSales().then(reply); return true; }
  if(msg.type === 'wls-acked'){ markSynced(msg.ids).then(function(){ reply({ ok:true }); }); return true; }
});
