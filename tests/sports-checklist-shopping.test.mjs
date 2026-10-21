import assert from 'node:assert/strict';
import {footballSets} from '../scripts/topps/football-seed.mjs';
import {footballSections} from '../scripts/topps/football-sections.mjs';
import {sportsChecklistNavigation,sportsChecklistRedirect} from '../scripts/sports-checklist-ui.mjs';
import {sportsListings,sportsListingMatches,sportsListingHtml} from '../scripts/sports-card-marketplace.mjs';
import {handleFootballCatalog} from '../scripts/football-catalog-pages.mjs';
import {baseballChecklistInventoryMatches} from '../scripts/topps/public-checklist-policy.mjs';
import {footballOddsHtml,footballOdds} from '../scripts/football-odds.mjs';
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const set=footballSets.find(s=>s.id==='2025-topps-chrome-football'),groups=footballSections[0].sections;
assert.equal(groups.length,40);assert.equal(groups.reduce((n,g)=>n+g.cards.length,0),1975);
const all=groups.flatMap(g=>g.cards);assert.equal(new Set(all.map(c=>c.id)).size,all.length);
const dual=groups.find(g=>g.id==='dual-autographs');assert.equal(dual.cards.length,13);assert.equal(dual.cards.find(c=>c.cardNumber==='DA-AK').subjects.length,2);
assert.ok(!groups.some(g=>g.id==='fanatics-authentics-redemption-cards'),'unnumbered memorabilia redemption subjects are not invented card numbers');
const group=groups.find(g=>g.id==='kaiju'),card=group.cards[0];
const nav=sportsChecklistNavigation(set,groups,esc,{sport:'football',current:group.id});
assert.ok(nav.includes('value="kaiju" selected')&&nav.includes('<optgroup label="Autographs">')&&nav.includes('Pack / box odds'));
assert.ok(nav.includes('/football/checklists/'+set.id+'/sections/kaiju'));
const redirect=sportsChecklistRedirect(new URL('https://example.com/?view=kaiju'),set,groups,'football');assert.equal(redirect.status,303);assert.equal(redirect.headers.get('Location'),'/football/checklists/'+set.id+'/sections/kaiju');
assert.equal(sportsChecklistRedirect(new URL('https://example.com/?view=https://evil.test'),set,groups,'football').status,404);
const listing={itemId:'123',title:'2025 Topps Chrome Football Tom Brady Kaiju KAI-1',imageUrl:'https://i.ebayimg.com/images/card.jpg',affiliateUrl:'https://www.ebay.com/itm/123?campid=5339046175',price:75,currency:'USD'};
assert.ok(sportsListingMatches(listing,card,set,group));
for(const title of ['2025 Topps Chrome Baseball Tom Brady Kaiju KAI-1','2025 Topps Chrome Football Tom Brady KAI-11','2025 Topps Chrome Football Patrick Mahomes KAI-1','2024 Topps Chrome Football Tom Brady KAI-1','2025 Topps Chrome Football Tom Brady KAI-1 LOT','2025 Topps Chrome Tom Brady KAI-1'])assert.ok(!sportsListingMatches({...listing,title},card,set,group),title);
const variation=groups.find(g=>g.id==='base-cards-team-camo-variation'),v=variation.cards[0];
assert.ok(!sportsListingMatches({...listing,title:'2025 Topps Chrome Football '+v.player+' #'+v.cardNumber},v,set,variation));
assert.ok(sportsListingMatches({...listing,title:'2025 Topps Chrome Football '+v.player+' Team Camo #'+v.cardNumber},v,set,variation));
const own={id:'our-kaiju',name:card.player+' #'+card.cardNumber,player:card.player,set:'Football Cards 2025 Topps Chrome',cardNumber:card.cardNumber,categorySlug:'sports-cards',price:60,quantity:1};
assert.ok(baseballChecklistInventoryMatches(own,card,set));assert.ok(!baseballChecklistInventoryMatches({...own,set:'Baseball Cards 2025 Topps Chrome'},card,set));
const mem=new Map(),tasks=[];let searches=0,inventoryLoads=0;
const env={EBAY_PARTNER_CAMPAIGN_ID:'5339046175',LBA_KV:{get:async k=>mem.get(k)||null,put:async(k,v)=>mem.set(k,JSON.parse(v))}};
const deps={ctx:{waitUntil:p=>tasks.push(p)},escape:esc,slug:s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-'),shell:p=>p.bodyHtml,available:i=>i.quantity>0,listItems:async()=>{inventoryLoads++;return [own];},searchEbay:async()=>{searches++;return {listings:[listing]};}};
assert.deepEqual(await sportsListings(env,deps.ctx,set,group,deps),[]);await Promise.all(tasks);
const cached=await sportsListings(env,deps.ctx,set,group,deps);assert.equal(cached.length,1);assert.equal(searches,1);assert.ok(sportsListingHtml(cached[0],esc).includes('eBay asking price: $75.00 USD'));
const root='/football/checklists/'+set.id,path=root+'/sections/kaiju';
const request=async path=>handleFootballCatalog(new Request('https://www.themanapocket.com'+path),env,new URL('https://www.themanapocket.com'+path),deps);
const page=await(await request(path)).text();assert.ok(page.includes('/item/our-kaiju/')&&page.includes('eBay asking price: $75.00 USD'));
assert.ok(page.indexOf('/item/our-kaiju/')<page.indexOf('ebay.com/itm/123'));
const loads=inventoryLoads;const lookup=await request(root+'/cards/'+card.id+'?market=1');assert.equal(lookup.status,200);assert.equal((await lookup.json()).listing.itemId,'123');assert.equal(inventoryLoads,loads,'marketplace lookup never queries inventory');
assert.equal((await request(root+'?view=kaiju')).status,303);
const odds=footballOddsHtml(set.id,esc);assert.ok(odds.includes('1:2,559')&&odds.includes('1:4,813')&&odds.includes('6392')&&odds.includes('name="sports-odds-format"'));
assert.equal(footballOdds[set.id].rows.find(r=>r.name==='Kaiju').odds[3],null);
console.log('Mobile section navigation, 1,975 numbered football references, exact card identity, store-first shopping, bounded affiliate lookup and source odds passed');

for(const section of groups){
 const r=await handleFootballCatalog(new Request('https://www.themanapocket.com'+root+'/sections/'+section.id),{EBAY_PARTNER_CAMPAIGN_ID:'5339046175'},new URL('https://www.themanapocket.com'+root+'/sections/'+section.id),deps);
 assert.equal(r.status,200);const body=await r.text();
 assert.ok(body.includes('value="'+section.id+'" selected'));
 for(const c of [section.cards[0],section.cards.at(-1)]){
  const u=root+'/cards/'+c.id;const res=await handleFootballCatalog(new Request('https://www.themanapocket.com'+u),{EBAY_PARTNER_CAMPAIGN_ID:'5339046175'},new URL('https://www.themanapocket.com'+u),deps);
  assert.equal(res.status,200);assert.ok((await res.text()).includes(esc(c.cardNumber)));
 }
}
