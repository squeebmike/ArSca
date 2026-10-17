// Rankings use existing catalog reference prices; never invent store Offers.
function amount(value) {
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value.trim()))return null;
 const number=Number(value);return Number.isFinite(number)&&number>0?number:null;
}
export function referenceHighlights(cards,game,limit=8) {
 if(!['mtg','pokemon'].includes(game))return [];
 const byId=new Map();
 for(const card of cards){
  const price=amount(game==='mtg'?card.prices?.usd:(card.prices?.market??card.marketPrice));
  const id=String(card.scryfallId||card.tcgPlayerId||card.id||'');
  if(price===null||!id||!card.name||byId.has(id))continue;
  byId.set(id,{card,price,id});
 }
 return [...byId.values()].sort((a,b)=>b.price-a.price||a.id.localeCompare(b.id)).slice(0,Math.max(0,Math.min(12,Number(limit)||0)));
}
export function referenceHighlightsHtml(cards,game,{escape:esc,path,complete=true}={}) {
 const rows=referenceHighlights(cards,game);if(!rows.length)return '';
 const basis=game==='mtg'?'nonfoil USD reference prices':'USD reference prices';
 return '<section class="mp-reference-highlights"><h2>Highest '+(game==='mtg'?'nonfoil ':'')+'reference values'+(complete===false?' among loaded cards':' in this checklist')+'</h2><p>Ranked by the catalog’s '+basis+'. These are market references, separate from our selling prices. '+(game==='mtg'?'Foil and etched treatments have separate values. ':'')+'Price dates are not supplied in this view. Check the exact printing, condition and current listing before buying.</p><ol>'+rows.map(({card,price})=>'<li><a href="'+esc(path(card))+'">'+esc(card.name)+' #'+esc(card.collectorNumber||card.cardNumber||card.number||'')+'</a> · $'+price.toFixed(2)+' USD reference</li>').join('')+'</ol></section>';
}
