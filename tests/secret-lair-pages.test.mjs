import assert from 'node:assert/strict';
import {secretLairDrops} from '../scripts/secret-lair/drop-library.mjs';
import {handleSecretLairPages,secretLairDropPath,secretLairSealedMatches,secretLairCardShopping} from '../scripts/secret-lair-pages.mjs';
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
let page,inventory=[];
const deps={escape,slug:s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-'),available:i=>i.quantity>0,listItems:async()=>inventory,shell:p=>{page=p;return p.bodyHtml;}};
const get=(path,method='GET')=>handleSecretLairPages(new Request('https://www.themanapocket.com'+path,{method}),{},new URL('https://www.themanapocket.com'+path),deps);
const hub=await(await get('/secret-lair')).text(),xml=await(await get('/sitemap-secret-lair.xml')).text();
assert.equal((xml.match(/<loc>/g)||[]).length,secretLairDrops.length+1);
for(const d of secretLairDrops){
 const path=secretLairDropPath(d);assert.ok(hub.includes(path)&&xml.includes(path));const r=await get(path);assert.equal(r.status,200);const body=await r.text();
 assert.equal(page.canonicalPath,path);assert.equal(page.jsonLd['@type'],'Article');assert.equal(page.ogType,'article');assert.equal(page.ogImage,d.cards[0].image);assert.ok(body.includes('full-size artwork'));assert.ok(!page.jsonLd.offers);assert.equal((body.match(/<h1>/g)||[]).length,1);assert.ok(body.includes('not')||body.includes('different'));
 assert.ok(body.includes('Affiliate links:'));assert.ok(body.includes('rel="noopener sponsored"'));assert.ok(!body.includes('"InStock"'));
 const cornCounts=[6,6,7,7,6,4,5,5];assert.equal(d.cards.length,d.id.startsWith('winter-2024-')?(['winter-2024-just-add-milk-second-helpings','winter-2024-showcase-murders-at-karlov-manor'].includes(d.id)?4:5):d.id.startsWith('corn-maze-')?cornCounts[secretLairDrops.filter(x=>x.id.startsWith('corn-maze-')).findIndex(x=>x.id===d.id)]:(d.id==='sonic-friends-and-foes'||d.id==='hobbit-second-breakfast-and-beyond')?7:d.id.startsWith('sonic-')?6:5);for(const token of d.tokens||[])assert.ok(body.includes(escape(token)));for(const c of d.cards){assert.ok(body.includes(encodeURIComponent('https://www.tcgplayer.com/product/'+c.tcgPlayerId)));assert.ok(body.includes(escape(c.image)));assert.ok(body.includes(escape(c.displayName)));if(c.backImage)assert.ok(body.includes(escape(c.backImage))&&body.includes('View reverse artwork'));}
 for(const c of d.cards)for(const p of c.alternatePrintings||[])assert.ok(body.includes(encodeURIComponent('https://www.tcgplayer.com/product/'+p.tcgPlayerId)));
 for(const ref of d.references||[])assert.ok(body.includes(escape(ref.url)));
 const card=d.cards[0];const own={id:'our-single',name:card.name,categorySlug:'mtg',scryfallId:card.scryfallId,price:9,quantity:1};
 const sealed={id:'our-drop',name:d.name+' Non-Foil Sealed',categorySlug:'mtg',isSealed:true,price:99,quantity:1};
 assert.ok(secretLairSealedMatches(sealed,d));assert.ok(!secretLairSealedMatches({...sealed,isSealed:false},d));assert.ok(!secretLairSealedMatches({...sealed,name:'Different Secret Lair'},d));
 inventory=[own,sealed,{...own,id:'other-printing',scryfallId:'different'},{...own,id:'sold',quantity:0},{...own,id:'unpriced',price:0}];
 const shop=await(await get(path)).text();assert.ok(shop.includes('/item/our-single/')&&shop.includes('/item/our-drop/'));for(const id of ['other-printing','sold','unpriced'])assert.ok(!shop.includes('/item/'+id+'/'));
 inventory=[];
}
deps.listItems=async()=>{throw Error('Inventory unavailable');};assert.ok((await(await get(secretLairDropPath(secretLairDrops[0]))).text()).includes('Store availability could not be checked'));
assert.equal((await get('/secret-lair/unknown')).status,404);assert.ok(page.robotsNoindex);assert.equal(await(await get('/secret-lair','HEAD')).text(),'');assert.equal(await get('/other'),null);
const printing={name:'Verified fixture',collectorNumber:'1519',setName:'Secret Lair Drop',setCode:'sld',scryfallId:'nonfoil-id',tcgPlayerId:100,printingLabel:'Non-foil',alternatePrintings:[{name:'Verified fixture',collectorNumber:'1519★',setName:'Secret Lair Drop',setCode:'sld',scryfallId:'foil-id',tcgPlayerId:101,printingLabel:'Foil'}]};
const variants=secretLairCardShopping([{id:'foil-copy',name:'Verified fixture',categorySlug:'mtg',scryfallId:'foil-id',quantity:1,price:5},{id:'ambiguous-copy',name:'Verified fixture',categorySlug:'mtg',set:'Secret Lair Drop',cardNumber:'1519',quantity:1,price:4}],printing,deps);
assert.ok(variants.includes('/item/foil-copy/'));assert.ok(!variants.includes('/item/ambiguous-copy/'));assert.ok(variants.includes('Foil · #1519★'));assert.ok(variants.includes(encodeURIComponent('https://www.tcgplayer.com/product/101')));
console.log('Secret Lair: individual editorial guides, 184 exact product links, real stock matching, sealed gates, schema and discovery passed');
