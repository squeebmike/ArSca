// Logs each sale, opens the sticker print window, and hands sales to the
// Mana Pocket dashboard (through an open dashboard tab) until it confirms
// they're recorded.
var DEFAULTS = { enabled:true, giveaways:true, size:'2x1' };
var DASHBOARD_URLS = ['https://squeebmike.github.io/ArSca/*', 'https://arsca-beta.pages.dev/*'];
function settings(){ return chrome.storage.local.get({ settings:DEFAULTS }).then(function(r){ return Object.assign({}, DEFAULTS, r.settings); }); }
// Missed stickers: a sale whose sticker never confirmed it printed (the
// label window reports back after printing). After a minute it counts as
// missed -- a red number on the extension icon, and PRINT MISSED in the
// popup reprints them all.
var MISSED_AFTER_MS = 60 * 1000;
function isMissed(sale, now){ return !sale.test && !sale.printedAt && (!sale.printRequestedAt || (now || Date.now()) - Date.parse(sale.printRequestedAt) >= MISSED_AFTER_MS); }
async function updateBadge(){
  var data = await chrome.storage.local.get({ sales:[] });
  var n = data.sales.filter(function(s){ return isMissed(s); }).length;
  try { await chrome.action.setBadgeBackgroundColor({ color:'#ff4d6d' }); await chrome.action.setBadgeText({ text:n ? String(n) : '' }); } catch(e) {}
  return n;
}
async function patchSale(id, patch){
  var data = await chrome.storage.local.get({ sales:[] });
  data.sales.forEach(function(s){ if(s.id === id) Object.assign(s, patch); });
  await chrome.storage.local.set({ sales:data.sales });
}
async function printSale(id){
  await patchSale(id, { printRequestedAt:new Date().toISOString() });
  try {
    await chrome.windows.create({ url:chrome.runtime.getURL('label.html?id=' + encodeURIComponent(id)), type:'popup', width:420, height:320, focused:false });
  } catch(e) { await patchSale(id, { printError:String(e && e.message || e) }); }
  // Check back once the grace period is over (the service worker may sleep).
  try { chrome.alarms.create('wls-missed-check', { when:Date.now() + MISSED_AFTER_MS + 2000 }); } catch(e) {}
}
// Reprints every missed sticker, one at a time so the printer keeps up.
async function printMissed(){
  var data = await chrome.storage.local.get({ sales:[] });
  var missed = data.sales.filter(function(s){ return isMissed(s); }).reverse();
  for(var i = 0; i < missed.length; i++){
    await printSale(missed[i].id);
    await new Promise(function(r){ setTimeout(r, 2500); });
  }
  return missed.length;
}
chrome.alarms.onAlarm.addListener(function(a){ if(a.name === 'wls-missed-check') updateBadge(); });
chrome.runtime.onStartup.addListener(updateBadge);
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
  if(msg.type === 'wls-printed' && msg.id){ patchSale(msg.id, { printedAt:new Date().toISOString(), printError:'' }).then(updateBadge); }
  if(msg.type === 'wls-print-missed'){ printMissed().then(function(n){ reply({ count:n }); }); return true; }
  if(msg.type === 'wls-missed-count'){ updateBadge().then(function(n){ reply({ count:n }); }); return true; }
  if(msg.type === 'wls-pending'){ pendingSales().then(reply); return true; }
  if(msg.type === 'wls-acked'){ markSynced(msg.ids).then(function(){ reply({ ok:true }); }); return true; }
});
