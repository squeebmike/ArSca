// Watches the Whatnot live page and reports each sale to the background
// worker, which logs it and prints the sticker.
(function(){
  'use strict';
  var track = WLS.createTracker(), timer = null;
  function visibleLines(){ return (document.body && document.body.innerText || '').split('\n'); }
  function scan(){
    timer = null;
    var fresh = track(WLS.parseSales(visibleLines()));
    fresh.forEach(function(sale){
      sale.at = new Date().toISOString();
      sale.page = location.pathname;
      try { chrome.runtime.sendMessage({ type:'wls-sale', sale:sale }); } catch(e) {}
    });
  }
  function schedule(){ if(!timer) timer = setTimeout(scan, 400); }
  new MutationObserver(schedule).observe(document.documentElement, { childList:true, subtree:true, characterData:true });
  scan();
  // CAPTURE: hands the popup what the page currently says, so detection
  // can be tuned to new wording (e.g. Buy It Now).
  chrome.runtime.onMessage.addListener(function(msg, _sender, reply){
    if(msg && msg.type === 'wls-capture'){
      reply({ url:location.href, at:new Date().toISOString(), lines:visibleLines().map(function(l){ return l.trim(); }).filter(Boolean).slice(-400), parsed:WLS.parseSales(visibleLines()) });
    }
  });
})();
