// Whatnot Live Stickers -- sale detection (pure, no DOM/Chrome APIs; tested in
// tests/whatnot-live-stickers.test.mjs). Works from the page's visible text
// lines, the same way a person reads the screen:
//   "bigbob1 won!"  /  "AC Raw #34"  /  "Near Mint"  /  "$8"  /  "Sold"
//   "themanapocket won the giveaway!"
//   "<user> bought <item> for $12"   (Buy It Now wording -- tune via CAPTURE)
(function(root){
  'use strict';
  var NOT_A_BUYER = /^(i|we|you|he|she|they|someone|somebody|nobody|it|who|host)$/i;
  var USER = '@?([A-Za-z0-9_.\\-]{2,40}(?:\\.\\.\\.|…)?)';
  var WON_LINE = new RegExp('^' + USER + '\\s+won!?$', 'i');
  var GIVEAWAY_LINE = new RegExp('^' + USER + '\\s+won the giveaway!?$', 'i');
  var BIN_LINE = new RegExp('^' + USER + '\\s+(?:just\\s+)?(?:bought|purchased)\\s+(.{2,120}?)(?:\\s+for\\s+\\$\\s?([\\d,]+(?:\\.\\d{2})?))?!?$', 'i');
  var PRICE_LINE = /^\$\s?([\d,]+(?:\.\d{2})?)$/;
  var SKIP_LINE = /^(sold|won the auction!?|awaiting next item|shipping|.*\bshipping\b.*|.*\btaxes\b.*|bid|bids|\d+\s*bids?|buy it now|place bid|custom bid|say something.*)$/i;
  var CONDITION = /^(near mint|nm|lightly played|light played|lp|moderately played|mp|heavily played|hp|damaged|dmg|mint|new|sealed|factory sealed|graded|raw.*|very fine|fine|good|fair|poor|like new|brand new)$/i;

  function cleanUser(u){ return String(u || '').replace(/^@/, '').trim(); }
  function isUser(u){ return !!u && !NOT_A_BUYER.test(u) && !/\s/.test(u); }

  // Reads the item card that follows a winner line.
  function itemAfter(lines, start){
    var title = '', subtitle = '', price = '';
    for(var j = start; j < Math.min(lines.length, start + 9); j++){
      var line = lines[j];
      if(WON_LINE.test(line) || GIVEAWAY_LINE.test(line) || /^won!?$/i.test(line)) break;
      var p = line.match(PRICE_LINE);
      if(p){ if(!price) price = p[1].replace(/,/g, ''); continue; }
      if(SKIP_LINE.test(line)) continue;
      if(!title) { title = line; continue; }
      if(!subtitle && CONDITION.test(line)) { subtitle = line; continue; }
    }
    return { title:title, subtitle:subtitle, price:price };
  }

  // lines: visible text, top to bottom. Returns { auction, giveaway, bin }
  // (each a sale or null) -- the LAST match of each kind on screen wins,
  // since the newest result card sits lowest.
  function parseSales(lines){
    lines = (lines || []).map(function(l){ return String(l || '').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var out = { auction:null, giveaway:null, bin:null };
    for(var i = 0; i < lines.length; i++){
      var line = lines[i], m;
      if((m = line.match(GIVEAWAY_LINE)) || (/^won the giveaway!?$/i.test(line) && i > 0 && (m = [null, lines[i-1]]))){
        var gu = cleanUser(m[1]);
        if(isUser(gu)) out.giveaway = { type:'giveaway', buyer:gu, title:'Giveaway', subtitle:'', price:'' };
        continue;
      }
      if((m = line.match(WON_LINE)) || (/^won!?$/i.test(line) && i > 0 && (m = [null, lines[i-1]]))){
        var u = cleanUser(m[1]);
        if(!isUser(u)) continue;
        var item = itemAfter(lines, i + 1);
        // A real result card always carries its price; a chat message
        // that happens to say "X won!" doesn't.
        if(!item.price) continue;
        // The full name on the result line beats a truncated banner name.
        if(out.auction && /(\.\.\.|…)$/.test(u) && !/(\.\.\.|…)$/.test(out.auction.buyer)) continue;
        out.auction = { type:'auction', buyer:u, title:item.title, subtitle:item.subtitle, price:item.price };
        continue;
      }
      if((m = line.match(BIN_LINE))){
        var bu = cleanUser(m[1]);
        if(isUser(bu)) out.bin = { type:'bin', buyer:bu, title:m[2].trim(), subtitle:'', price:(m[3] || '').replace(/,/g, '') };
      }
    }
    return out;
  }

  function saleKey(s){ return s ? [s.type, s.buyer.toLowerCase(), s.title.toLowerCase(), s.price].join('|') : ''; }

  // A sale is reported once, when its result first appears (or changes).
  // The result stays on screen until the next item starts, so the same
  // buyer winning the same title again only counts after it has gone away
  // in between. The first scan after a page (re)load is a baseline: results
  // already on screen were printed before the reload.
  function createTracker(){
    var last = { auction:'', giveaway:'', bin:'' }, baseline = true;
    return function update(found){
      var fresh = [];
      ['auction','giveaway','bin'].forEach(function(kind){
        var key = saleKey(found[kind]);
        if(key && key !== last[kind] && !baseline) fresh.push(found[kind]);
        last[kind] = key;
      });
      baseline = false;
      return fresh;
    };
  }

  root.WLS = { parseSales:parseSales, createTracker:createTracker, saleKey:saleKey };
})(typeof globalThis !== 'undefined' ? globalThis : this);
