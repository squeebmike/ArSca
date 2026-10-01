var DEFAULTS = { enabled:true, giveaways:true, size:'2x1' };
function $(id){ return document.getElementById(id); }
function say(text){ $('status').textContent = text; }
async function load(){
  var data = await chrome.storage.local.get({ settings:DEFAULTS, sales:[] });
  var s = Object.assign({}, DEFAULTS, data.settings);
  $('enabled').checked = s.enabled; $('giveaways').checked = s.giveaways; $('size').value = s.size;
  $('count').textContent = data.sales.length;
  var host = $('sales'); host.textContent = '';
  data.sales.slice(0, 100).forEach(function(sale){
    var row = document.createElement('div'); row.className = 'sale';
    var info = document.createElement('div');
    var who = document.createElement('b'); who.textContent = '@' + sale.buyer;
    var what = document.createElement('small');
    what.textContent = (sale.type === 'giveaway' ? 'Giveaway' : sale.title || 'Item') + (sale.price ? ' · $' + sale.price : '') + ' · ' + new Date(sale.at).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) + (sale.test ? '' : sale.synced ? ' \u00b7 \u2713 in dashboard' : ' \u00b7 waiting for dashboard');
    info.appendChild(who); info.appendChild(what);
    var btn = document.createElement('button'); btn.textContent = 'REPRINT';
    btn.addEventListener('click', function(){ chrome.runtime.sendMessage({ type:'wls-reprint', id:sale.id }); });
    row.appendChild(info); row.appendChild(btn); host.appendChild(row);
  });
}
async function saveSettings(){
  await chrome.storage.local.set({ settings:{ enabled:$('enabled').checked, giveaways:$('giveaways').checked, size:$('size').value } });
  say('Saved');
}
['enabled','giveaways','size'].forEach(function(id){ $(id).addEventListener('change', saveSettings); });
$('test').addEventListener('click', async function(){
  var data = await chrome.storage.local.get({ sales:[] });
  var id = 'wls_test';
  var sales = data.sales.filter(function(s){ return s.id !== id; });
  sales.push({ id:id, type:'auction', buyer:'test_buyer', title:'Test sticker -- Amazing Spider-Man #300', subtitle:'Near Mint', price:'25', at:new Date().toISOString(), test:true });
  await chrome.storage.local.set({ sales:sales });
  chrome.runtime.sendMessage({ type:'wls-reprint', id:id });
  say('Test sticker sent to the printer');
});
$('capture').addEventListener('click', async function(){
  var tabs = await chrome.tabs.query({ active:true, currentWindow:true });
  var tab = tabs[0];
  if(!tab || !/^https:\/\/www\.whatnot\.com\//.test(tab.url || '')){ say('Open your Whatnot show in this window first'); return; }
  chrome.tabs.sendMessage(tab.id, { type:'wls-capture' }, async function(result){
    if(!result){ say('Could not read the page -- reload it and try again'); return; }
    await navigator.clipboard.writeText(JSON.stringify(result, null, 1));
    say('Page text copied -- paste it to Claude to tune detection');
  });
});
$('export').addEventListener('click', async function(){
  var data = await chrome.storage.local.get({ sales:[] });
  var q = function(v){ v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var rows = [['Order ID','Date','Buyer','Title','Condition','Price','Type']].concat(data.sales.filter(function(s){ return !s.test; }).map(function(s){
    return ['whatnot-live-' + s.id, s.at, s.buyer, s.type === 'giveaway' ? 'Giveaway' : s.title, s.subtitle, s.price, s.type];
  }));
  var blob = new Blob([rows.map(function(r){ return r.map(q).join(','); }).join('\n')], { type:'text/csv' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'whatnot-live-sales-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
});
$('clear').addEventListener('click', async function(){
  if(!confirm('Clear this show’s sale log? Stickers already printed are not affected.')) return;
  await chrome.storage.local.set({ sales:[] }); load(); say('Log cleared');
});
chrome.storage.onChanged.addListener(load);
load();
