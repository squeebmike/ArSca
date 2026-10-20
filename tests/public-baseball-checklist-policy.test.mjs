import assert from 'node:assert/strict';
import {checklistPublicationProblems,baseballInventoryMatches,ebayChecklistSearch} from '../scripts/topps/public-checklist-policy.mjs';
const set={year:2023,sport:'baseball',brand:'Topps',setName:'2023 Topps Series 1 Baseball',cardCount:330};
const approval={displayName:set.setName,licensedBaseball:true,reviewed:true,sourceUrl:'https://www.topps.com/pages/checklists'};
assert.deepEqual(checklistPublicationProblems(set,approval),[]);
assert.deepEqual(checklistPublicationProblems({...set,year:2019},approval),[]);
assert.ok(checklistPublicationProblems({...set,year:2018},approval).includes('outside_2019_onward'));
assert.ok(checklistPublicationProblems(set).includes('editorial_review_required'));
assert.ok(checklistPublicationProblems({...set,setName:'2023 Bowman Basketball'},approval).includes('not_verified_baseball'));
assert.ok(checklistPublicationProblems({...set,setName:'Checklists provided by Topps reflect the intended'},approval).includes('disclaimer_used_as_set_name'));
assert.ok(checklistPublicationProblems(set,{...approval,sourceUrl:'https://example.com/fake.pdf'}).includes('official_source_required'));
const card={player:'Test Player',cardNumber:'1',section:'Base',variant:'Base'};
const item={categorySlug:'sports-cards',year:2023,set:set.setName,player:card.player,cardNumber:'001',subset:'Base',variant:'Base'};
assert.ok(baseballInventoryMatches(item,card,set));
for(const patch of [{variant:'Gold'},{subset:'Autographs'},{year:2024},{cardNumber:'2'},{isSealed:true},{player:''},{set:''}]) assert.equal(baseballInventoryMatches({...item,...patch},card,set),false);
assert.equal(ebayChecklistSearch(card,set,''),null);
assert.equal(ebayChecklistSearch(card,set,'not-a-campaign'),null);
const link=new URL(ebayChecklistSearch(card,set,'1234567890'));
assert.equal(link.hostname,'www.ebay.com');assert.equal(link.searchParams.get('campid'),'1234567890');
assert.ok(link.searchParams.get('_nkw').includes('Test Player'));
console.log('Baseball source approval, exact printing identity and owner-only affiliate attribution passed');

assert.equal((link.searchParams.get('_nkw').match(/2023/g)||[]).length,1,'search year appears once');
assert.ok(!link.searchParams.get('_nkw').endsWith('Base Base'));

// Legacy imported inventory connects to a numbered base-card reference without
// claiming that a parallel is the base printing.
const {baseballChecklistInventoryMatches:family,sportsSetKey}=await import('../scripts/topps/public-checklist-policy.mjs');
assert.equal(sportsSetKey('Baseball Cards 2023 Topps Chrome'),sportsSetKey('2023 Topps Chrome Baseball'));
const chrome={year:2023,displayName:'2023 Topps Chrome Baseball'};
const raleigh={player:'Cal Raleigh',cardNumber:'141',section:'Base',variant:'Base'};
const legacy={categorySlug:'sports-cards',name:'Cal Raleigh [Green Wave] #141 /99',set:'Baseball Cards 2023 Topps Chrome',year:'',player:'',cardNumber:'',subset:'',variant:'Baseball Card'};
assert.ok(family(legacy,raleigh,chrome));
assert.ok(!baseballInventoryMatches(legacy,raleigh,chrome),'a related parallel is never asserted to be an exact base printing');
for(const patch of [{set:'Baseball Cards 2023 Topps Chrome Update'},{set:'Baseball Cards 2023 Topps Chrome Sapphire'},{year:2024},{cardNumber:'142'},{player:'Other Player'},{name:'Cal Raleigh [SP Variation] #141'},{name:'Cal Raleigh [Image Variation] #141'},{name:'Cal Raleigh Autograph #141'},{name:'Cal Raleigh #141 and #142'},{isRelic:true},{isSigned:true},{subset:'Autographs'},{productType:'Lot'}])assert.equal(family({...legacy,...patch},raleigh,chrome),false,JSON.stringify(patch));
assert.equal(family(legacy,{...raleigh,section:'Autographs'},chrome),false);
assert.ok(family({...legacy,name:'Cal Raleigh #141'},raleigh,chrome));
// Exact player + stated finish + number also supports old titles without '#'.
for(const name of ['Cal Raleigh Magenta Speckle 141','Cal Raleigh Blue Sonar 141 /125','Cal Raleigh Purple Sonar 141 /275','Cal Raleigh Aqua 141 /199'])assert.ok(family({...legacy,name},raleigh,chrome),name);
for(const name of ['Cal Raleigh Jr Aqua 141','Cal Raleigh Aqua 142','Cal Raleigh Unknown Player 141','Cal Raleigh Aqua 141 and 142'])assert.equal(family({...legacy,name},raleigh,chrome),false,name);
// A numbered autograph can connect only within its reviewed autograph section.
const autoSet={year:2025,displayName:'2025 Topps Chrome Baseball'};
const autoCard={player:'Bryan Woo',cardNumber:'RA-BWO',section:'Rookie Autographs',variant:'Base'};
const autoItem={categorySlug:'sports-cards',name:'Bryan Woo [Blue] #RA-BWO /150',set:'Baseball Cards 2025 Topps Chrome Rookie Autograph',year:'',subset:'',variant:'Autograph'};
assert.ok(family(autoItem,autoCard,autoSet));
assert.equal(family({...autoItem,set:'Baseball Cards 2024 Topps Chrome Rookie Autograph'},autoCard,autoSet),false);
assert.equal(family(autoItem,{...autoCard,section:'Base'},autoSet),false);
assert.equal(family({...autoItem,subset:'Relics'},autoCard,autoSet),false);
assert.equal(family({...autoItem,name:'Bryan Woo #RA-BWO',set:'Baseball Cards 2025 Topps Chrome'},autoCard,autoSet),false);