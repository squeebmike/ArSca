import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import './helpers/mock-body-html-rewriter.mjs';
const originalFetch=globalThis.fetch,originalCaches=globalThis.caches;
const rows=Array.from({length:125},(_,n)=>({id:'sports-'+n,status:'in_stock',data:{name:'Card '+n,category:'Sports',quantity:1,priceOverride:10,onlineListed:true,player:n<65?'Cal Raleigh':'Julio Rodriguez',team:'Mariners',set:'Topps Chrome',sport:'Baseball',productType:n<65?'Single':'Graded',...(n>=65?{gradingCompany:'PSA',grade:'10'}:{})}}));
globalThis.caches={default:{match:async()=>null,put:async()=>{}}};
globalThis.fetch=async input=>{const u=new URL(String(input.url||input));return new Response(u.hostname==='db.test'?JSON.stringify(Number(u.searchParams.get('offset')||0)===0?rows:[]):'<html><body></body></html>',{headers:{'Content-Type':'application/json'}});};
try{
 const {default:api}=await import('../cloudflare-worker-full.js');
 const get=path=>api.fetch(new Request('https://www.themanapocket.com'+path),{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test'},{waitUntil(){}});
 const path='/category/sports-cards?kind=singles&player=Cal+Raleigh&team=Mariners&set=Topps+Chrome&page=2';
 const response=await get(path);assert.equal(response.status,200);const html=await response.text(),{document}=parseHTML(html);
 assert.equal(document.querySelectorAll('.mp-grid .mp-card').length,5);
 assert.equal(document.querySelector('meta[name=robots]').getAttribute('content'),'noindex,follow');
 assert.equal(document.querySelector('link[rel=canonical]').getAttribute('href'),'https://www.themanapocket.com'+path);
 assert.ok([...document.querySelectorAll('nav[aria-label="Product pages"] a')].every(a=>a.getAttribute('href').includes('player=Cal+Raleigh')));
 assert.equal(document.querySelector('form[role=search]').getAttribute('action'),'/category/sports-cards');
 assert.equal((await get(path.replace('page=2','page=3'))).status,404);
 const empty=parseHTML(await(await get('/category/sports-cards?q=nomatches')).text()).document;
 assert.equal(empty.querySelectorAll('.mp-grid .mp-card').length,0);assert.match(empty.body.textContent,/No listings match/);
 const plain=parseHTML(await(await get('/category/sports-cards')).text()).document;
 assert.equal(plain.querySelector('meta[name=robots]'),null);assert.equal(plain.querySelectorAll('.mp-grid .mp-card').length,60);
 console.log('Department routes: combined filters, complete pagination, crawlable links, canonical/noindex and honest empty state passed');
}finally{globalThis.fetch=originalFetch;globalThis.caches=originalCaches;}
