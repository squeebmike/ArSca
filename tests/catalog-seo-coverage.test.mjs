import assert from 'node:assert/strict';
import './helpers/mock-body-html-rewriter.mjs';
import {productFacts,productHeading} from '../scripts/storefront-seo.mjs';
import {preorderDirectoryEntries,handleFocRequest} from '../scripts/foc-preorders.mjs';
const rows=Array.from({length:145},(_,n)=>({id:'comic-'+String(n).padStart(3,'0'),status:'in_stock',updated_at:'2026-10-14T00:00:00Z',data:{name:'Comic '+n,category:'Comics',quantity:1,priceOverride:5,onlineListed:true}}));
rows.push({id:'special',status:'in_stock',data:{name:'Custom print',category:'Collectibles',quantity:1,priceOverride:10,linkUrl:'https://www.themanapocket.com/dougvana-print'}});
const oldFetch=globalThis.fetch,oldCaches=globalThis.caches;
globalThis.caches={default:{match:async()=>null,put:async()=>{}}};
globalThis.fetch=async input=>{
 const u=new URL(String(input));
 if(u.hostname==='db.example'){
  const id=u.searchParams.get('id');
  return new Response(JSON.stringify(id?rows.filter(r=>r.id===id.slice(3)):Number(u.searchParams.get('offset')||0)===0?rows:[]),{headers:{'Content-Type':'application/json'}});
 }
 return new Response('<html><body></body></html>',{headers:{'Content-Type':'text/html'}});
};
try{
 const {default:worker}=await import('../cloudflare-worker-full.js');
 const get=p=>worker.fetch(new Request('https://www.themanapocket.com'+p),{SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'test'},{waitUntil(){}});
 const seen=new Set();
 for(let n=1;n<=3;n++){
  const path='/category/comics'+(n>1?'?page='+n:'');const r=await get(path);assert.equal(r.status,200);const html=await r.text();
  assert.ok(html.includes('href="https://www.themanapocket.com'+path+'"'),'each page has a self canonical');
  const links=[...html.matchAll(/href="(\/item\/comic-[^"]+)"/g)].map(m=>m[1]);
  assert.equal(links.length,n===3?25:60);links.forEach(link=>{assert.ok(!seen.has(link),'pages must not overlap');seen.add(link)});
  if(n<3)assert.match(html,new RegExp('href="/category/comics\\?page='+(n+1)+'"'));
 }
 assert.equal(seen.size,145,'every eligible item is reachable through ordinary HTML links');
 for(const p of ['0','-1','1.5','nope','4','99999999999999999999'])assert.equal((await get('/category/comics?page='+p)).status,404);
 assert.equal((await get('/category/comics?page=1')).status,301);
 assert.match(await (await get('/category/collectibles')).text(),/href="https:\/\/www.themanapocket.com\/dougvana-print"/);
 const a={id:'one',name:'Same card',condition:'NM'},b={id:'two',name:'Same card',condition:'NM'};
 assert.notEqual(productHeading(a,[a,b]),productHeading(b,[a,b]));assert.equal(productHeading(a,[a]),'Same card');
 const facts=productFacts({rarity:'Rare',language:'Japanese',grade:'10',gradingCompany:'CGC',finish:'Foil'});
 for(const name of ['Rarity','Language','Grade','Grading company','Finish'])assert.ok(facts.some(f=>f.name===name));
 const deps={mtgSlugify:s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),mtgEscapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'),mtgPageShell:p=>`<title>${p.title}</title><link rel="canonical" href="https://www.themanapocket.com${p.canonicalPath}">${p.bodyHtml}`};
 const variants=[{id:'ready',canPreorder:true,variantLabel:'Cover A',priceCents:500},{id:'request',canPreorder:true,waitlistOnly:true,priceCents:500}];
 const entries=preorderDirectoryEntries([{cycle:{isOpen:true},families:[{seriesName:'Batman',issueNumber:'25',variants}]},{cycle:{isOpen:false},families:[{title:'Closed',variants:[{id:'unsecured',canPreorder:true},{id:'secured',canPreorder:true,afterFoc:true,afterFocLeft:2,priceCents:600}]}]}],deps);
 assert.deepEqual(entries.map(e=>e.id).sort(),['ready','secured']);
 const directoryRows=Array.from({length:121},(_,n)=>({...entries[0],id:String(n),url:'/preorder/'+n+'/batman'}));
 globalThis.caches.default.match=async key=>key.url.includes('preorder-directory')?new Response(JSON.stringify(directoryRows)):null;
 const directory=await handleFocRequest(new Request('https://www.themanapocket.com/preorders/catalog?page=3'),{},new URL('https://www.themanapocket.com/preorders/catalog?page=3'),deps);
 assert.equal(directory.status,200);const directoryHtml=await directory.text();
 assert.match(directoryHtml,/href="\/preorder\/120\/batman"/);assert.match(directoryHtml,/not received shelf stock|after we receive the books/);assert.match(directoryHtml,/href="\/preorders\/catalog\?page=2"/);
 assert.equal((await handleFocRequest(new Request('https://www.themanapocket.com/preorders/catalog?page=4'),{},new URL('https://www.themanapocket.com/preorders/catalog?page=4'),deps)).status,404);
 console.log('Full category pagination, canonical bounds, custom destinations, distinct copies and saved collector facts passed');
}finally{globalThis.fetch=oldFetch;globalThis.caches=oldCaches;}
