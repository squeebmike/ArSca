// Runs on the Mana Pocket dashboard. Hands the extension's not-yet-recorded
// Whatnot sales to the page; the page records them (buyer name, show,
// inventory) and answers with the ids it saved, which are then marked done.
// Sales made while the dashboard was closed go over the next time it opens.
(function(){
  'use strict';
  function post(sales){ if(sales && sales.length) window.postMessage({ source:'wls-extension', type:'wls-sales', sales:sales }, location.origin); }
  function pull(){ try { chrome.runtime.sendMessage({ type:'wls-pending' }, function(sales){ post(sales); }); } catch(e) {} }
  chrome.runtime.onMessage.addListener(function(msg){ if(msg && msg.type === 'wls-push') post(msg.sales); });
  window.addEventListener('message', function(e){
    if(e.source !== window || !e.data || e.data.source !== 'wls-dashboard') return;
    if(e.data.type === 'wls-ack' && e.data.ids && e.data.ids.length) chrome.runtime.sendMessage({ type:'wls-acked', ids:e.data.ids });
    if(e.data.type === 'wls-ready') pull();
  });
  pull();
  setInterval(pull, 30000);
})();
