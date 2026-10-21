import assert from 'node:assert/strict';
import {secretLairDrops} from '../scripts/secret-lair/drop-library.mjs';
import {handleSecretLairPages,secretLairDropPath,secretLairSealedMatches,secretLairCardShopping,secretLairEditorialHtml} from '../scripts/secret-lair-pages.mjs';
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
let page,inventory=[];
const deps={escape,slug:s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-'),available:i=>i.quantity>0,listItems:async()=>inventory,shell:p=>{page=p;return p.bodyHtml;}};
const get=(path,method='GET')=>handleSecretLairPages(new Request('https://www.themanapocket.com'+path,{method}),{},new URL('https://www.themanapocket.com'+path),deps);
const expectedCounts={'summer-2025-artist-series-phil-foglio':4,'summer-2025-featuring-imiri-sakabashira':4,'elevator-2024-monty-python-and-the-holy-grail-vol-2':4,'elevator-2024-brain-dead-lands':10,'commander-goblin-storm':18,'featuring-andrew-maclean':4,'sonic-friends-and-foes':7,'sonic-turbo-gear':6,'sonic-chasing-adventure':6,'hobbit-second-breakfast-and-beyond':7,'corn-maze-jim-henson-s-labyrinth-fear-me-love-me':6,'corn-maze-jim-henson-s-labyrinth-should-you-need-us':6,'corn-maze-jim-henson-s-labyrinth-through-the-labyrinth':7,'corn-maze-kpop-demon-hunters-how-it-s-done':7,'corn-maze-marvel-zombies':6,'corn-maze-artist-series-veronique-meignaud':4,'winter-2024-just-add-milk-second-helpings':4,'winter-2024-showcase-murders-at-karlov-manor':4,'spring-2024-hatsune-miku-sakura-superstar':6,'spring-2024-outlaw-anthology-vol-1-rebellious-renegades':4,'spring-2024-outlaw-anthology-vol-2-sinister-scoundrels':4,'spring-2024-showcase-outlaws-of-thunder-junction':4,'avatar-everything-changed':4,'avatar-a-lot-to-learn':4,'avatar-one-with-the-elements':6};
const hub=await(await get('/secret-lair')).text(),xml=await(await get('/sitemap-secret-lair.xml')).text();
assert.equal((xml.match(/<loc>/g)||[]).length,secretLairDrops.length+1);
for(const d of secretLairDrops){
 const path=secretLairDropPath(d);assert.ok(hub.includes(path)&&xml.includes(path));const r=await get(path);assert.equal(r.status,200);const body=await r.text();
 assert.ok(!body.includes('\u00c2\u00b7')&&!body.includes('\u00e2\u20ac\u2122'));assert.equal(page.canonicalPath,path);assert.equal(page.jsonLd['@type'],'Article');assert.equal(page.ogType,'article');assert.equal(page.ogImage,d.cards[0].image);assert.ok(body.includes('full-size artwork'));if(d.paragraphs.some(p=>d.cards.some(c=>p.toLowerCase().includes(c.name.toLowerCase()))))assert.ok(body.includes('mp-editorial-cards'));assert.ok(!page.jsonLd.offers);assert.equal((body.match(/<h1>/g)||[]).length,1);
 assert.ok(body.includes('Affiliate links:'));assert.ok(body.includes('rel="noopener sponsored"'));assert.ok(!body.includes('"InStock"'));
 assert.equal(d.cards.length,expectedCounts[d.id]||5);if(d.checklistHeading)assert.ok(body.includes(escape(d.checklistHeading)));for(const token of d.tokens||[])assert.ok(body.includes(escape(token)));for(const c of d.cards){assert.ok(body.includes(encodeURIComponent('https://www.tcgplayer.com/product/'+c.tcgPlayerId)));assert.ok(body.includes(escape(c.image)));assert.ok(body.includes(escape(c.displayName)));if(c.backImage)assert.ok(body.includes(escape(c.backImage))&&body.includes('View reverse artwork'));}
 for(const c of d.cards)for(const p of c.alternatePrintings||[])assert.ok(body.includes(encodeURIComponent('https://www.tcgplayer.com/product/'+p.tcgPlayerId)));
 if(d.deckCards){assert.equal(d.deckCards.reduce((n,c)=>n+c.quantity,0),100);assert.equal(d.deckCards.filter(c=>c.printing.startsWith('Planeswalker-stamp')).length,63);for(const c of d.deckCards)assert.ok(body.includes(escape(c.name))&&body.includes(escape(c.printing)));assert.ok(body.includes('Full 100-card Commander deck checklist'));assert.ok(!d.cards.some(c=>c.collectorNumber==='2423'||Number(c.collectorNumber)>7000));}
 for(const related of d.relatedGuides||[])assert.ok(body.includes('/secret-lair/'+related.id));
 for(const ref of d.references||[])assert.ok(body.includes(escape(ref.url)));
 const card=d.cards[0];const own={id:'our-single',name:card.name,categorySlug:'mtg',scryfallId:card.scryfallId,price:9,quantity:1};
 const sealed={id:'our-drop',name:d.name+' Non-Foil Sealed',categorySlug:'mtg',isSealed:true,price:99,quantity:1};
 assert.ok(secretLairSealedMatches(sealed,d));assert.ok(!secretLairSealedMatches({...sealed,isSealed:false},d));assert.ok(!secretLairSealedMatches({...sealed,name:'Different Secret Lair'},d));
 inventory=[own,sealed,{...own,id:'other-printing',scryfallId:'different'},{...own,id:'sold',quantity:0},{...own,id:'unpriced',price:0}];
 const shop=await(await get(path)).text();assert.ok(shop.includes('/item/our-single/')&&shop.includes('/item/our-drop/'));for(const id of ['other-printing','sold','unpriced'])assert.ok(!shop.includes('/item/'+id+'/'));
 inventory=[];
}
const turbo=secretLairDrops.find(d=>d.id==='sonic-turbo-gear');
const legacySealed={id:'legacy-turbo',name:'Magic Secret Lair Drop Series Secret Lair x Sonic The Hedgehog Superdrop Turbo Gear Non Foil',categorySlug:'mtg',productType:'Secret Lair',variant:'Factory Sealed',isSealed:false,tcgPlayerId:'643595',price:55,quantity:1};
assert.ok(secretLairSealedMatches(legacySealed,turbo));assert.ok(!secretLairSealedMatches({...legacySealed,variant:'Near Mint'},turbo));assert.ok(!secretLairSealedMatches(legacySealed,secretLairDrops.find(d=>d.id==='final-fantasy-weapons')));
inventory=[legacySealed];const legacyPage=await(await get(secretLairDropPath(turbo))).text();assert.ok(legacyPage.includes('/item/legacy-turbo/'));assert.ok(!legacyPage.includes('No matching sealed drop is currently listed'));
deps.listItems=async()=>{throw Error('Inventory unavailable');};assert.ok((await(await get(secretLairDropPath(secretLairDrops[0]))).text()).includes('Store availability could not be checked'));
assert.equal((await get('/secret-lair/unknown')).status,404);assert.ok(page.robotsNoindex);assert.equal(await(await get('/secret-lair','HEAD')).text(),'');assert.equal(await get('/other'),null);
const printing={name:'Verified fixture',collectorNumber:'1519',setName:'Secret Lair Drop',setCode:'sld',scryfallId:'nonfoil-id',tcgPlayerId:100,printingLabel:'Non-foil',alternatePrintings:[{name:'Verified fixture',collectorNumber:'1519★',setName:'Secret Lair Drop',setCode:'sld',scryfallId:'foil-id',tcgPlayerId:101,printingLabel:'Foil'}]};
const variants=secretLairCardShopping([{id:'foil-copy',name:'Verified fixture',categorySlug:'mtg',scryfallId:'foil-id',quantity:1,price:5},{id:'ambiguous-copy',name:'Verified fixture',categorySlug:'mtg',set:'Secret Lair Drop',cardNumber:'1519',quantity:1,price:4}],printing,deps);
assert.ok(variants.includes('/item/foil-copy/'));assert.ok(!variants.includes('/item/ambiguous-copy/'));assert.ok(variants.includes('Foil · #1519★'));assert.ok(variants.includes(encodeURIComponent('https://www.tcgplayer.com/product/101')));
console.log('Secret Lair: individual editorial guides, exact printing product links, real stock matching, sealed gates, schema and discovery passed');

const namedCards=[{name:'Witch Enchanter // Witch-Blessed Meadow',displayName:'Witch Enchanter // Witch-Blessed Meadow',collectorNumber:'1',scryfallId:'a',tcgPlayerId:1,image:'https://example.com/a.jpg'},{name:"Hunter's Insight",displayName:"Hunter's Insight",collectorNumber:'2',scryfallId:'b',tcgPlayerId:2,image:'https://example.com/b.jpg'}];
const named=secretLairEditorialHtml({paragraphs:['Witch Enchanter and Hunter’s Insight are discussed here.'],cards:namedCards},[],deps);
assert.equal((named.match(/<figure /g)||[]).length,2,'front-face names and editorial curly apostrophes still get their exact card artwork');

const foglio=secretLairDrops.find(d=>d.id==='summer-2025-artist-series-phil-foglio');assert.equal(foglio.cards.find(c=>c.name==='Goblin Bombardment').collectorNumber,'2024');assert.ok(!foglio.cards.some(c=>c.collectorNumber==='7022'));
const frazetta=secretLairDrops.find(d=>d.id==='summer-2025-the-art-of-frank-frazetta-the-second-exhibition');assert.equal(frazetta.cards.length,5);assert.equal(frazetta.cards.filter(c=>c.name.startsWith('Murderous Rider')).length,1);

// Buying destinations remain visible before editorial paragraphs and point to real sections.
{
 deps.listItems=async()=>[{id:'nav-stock',name:turbo.name+' sealed',categorySlug:'mtg',isSealed:true,price:55,quantity:1}];
 const body=await(await get(secretLairDropPath(turbo))).text();
 assert.match(body,/aria-label="Shop this Secret Lair"/);
 assert.match(body,/href="#sealed-drop-stock">Shop 1 store listing/);
 assert.match(body,/id="sealed-drop-stock"/);
 assert.match(body,/href="#drop-card-shopping"/);
 assert.match(body,/id="drop-card-shopping"/);
 assert.ok(body.indexOf('aria-label="Shop this Secret Lair"')<body.indexOf('<div class="mp-editorial-cards"'));
 assert.ok(body.includes('/item/nav-stock/'));
}
