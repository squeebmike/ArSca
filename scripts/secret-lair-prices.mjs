import {cachedPublicCatalog} from './public-catalog-cache.mjs';
const FRESH_MS=6*60*60*1000;

// Public printing IDs only. One batch per drop, shared refresh/backoff, no SQL.
export async function secretLairPrices(env,ctx,drop,{fetcher=fetch}={}){
 if(!env.LBA_KV||!ctx?.waitUntil)return [];
 const key='secret-lair-prices-v1:'+drop.id;
 let saved;try{saved=await env.LBA_KV.get('public-catalog:'+key,'json');}catch{}
 const age=Date.now()-Number(saved?.at);
 const fresh=Array.isArray(saved?.items)&&age>=0&&age<FRESH_MS;
 if(!fresh){
  const refresh=cachedPublicCatalog(env,ctx,key,async signal=>{
   const cards=drop.cards.flatMap(c=>[c,...(c.alternatePrintings||[])]);
   const ids=[...new Set(cards.map(c=>c.scryfallId).filter(Boolean))];
   if(!ids.length||ids.length>75)throw new Error('Invalid Secret Lair price batch');
   const response=await fetcher('https://api.scryfall.com/cards/collection',{
    method:'POST',headers:{'User-Agent':'TheManaPocket/1.0 (themanapocket.com)','Accept':'application/json','Content-Type':'application/json'},
    body:JSON.stringify({identifiers:ids.map(id=>({id}))}),signal
   });
   if(!response.ok)throw new Error('Secret Lair prices unavailable');
   const payload=await response.json();
   if(!Array.isArray(payload.data))throw new Error('Invalid Secret Lair prices');
   const checkedAt=Date.now();
   return payload.data.filter(c=>ids.includes(c.id)&&cards.some(p=>p.scryfallId===c.id&&String(p.tcgPlayerId)===String(c.tcgplayer_id)))
    .map(c=>({scryfallId:c.id,tcgPlayerId:String(c.tcgplayer_id),prices:c.prices||{},priceCheckedAt:checkedAt}));
  },{freshMs:FRESH_MS,maxAgeMs:FRESH_MS,staleMs:86400000,timeoutMs:6000});
  ctx.waitUntil(refresh.catch(()=>{}));
 }
 return fresh?saved.items:[];
}

export function withSecretLairPrices(drop,rows){
 const enrich=c=>({...c,...(rows.find(p=>p.scryfallId===c.scryfallId&&String(p.tcgPlayerId)===String(c.tcgPlayerId))||{}),
  ...(c.alternatePrintings?{alternatePrintings:c.alternatePrintings.map(enrich)}:{})});
 return {...drop,cards:drop.cards.map(enrich)};
}
