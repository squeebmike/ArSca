// Publisher parallel programs. Never copy a rainbow between releases/subsets.
import {baseballChecklistInventoryMatches,ebayChecklistSearch} from './topps/public-checklist-policy.mjs';
import {catalogStoreCopyHtml} from './catalog-inventory.mjs';
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const variants=rows=>rows.map(([name,printRun,aliases])=>({id:slug(name),name,printRun,aliases:aliases||[name]}));
const source21=n=>'https://www.blowoutcards.net/images/ss/21tp'+n+'BB.pdf';
const insert21=variants([['Blue',null],['Black',299],['Platinum Anniversary',70],['Red',10],['Gold',1]]);
const ink21=variants([['Black',199],['Gold',50],['Red',25],['Platinum',1]]);
const relic21=variants([['Red',25],['Platinum',1]]);
const red5=variants([['Red',5],['Platinum',1]]);
const flagship=(year)=>variants([['Rainbow Foil',null],['Gold Foil',null],['Gold',year],['Vintage Stock',99],['Independence Day',76],['Black',year===2020?69:70],...(year===2021?[['Platinum Anniversary',70]]:[]),["Mother's Day Pink",50,['mothers day','mother s day','pink']], ["Father's Day Blue",50,['fathers day','father s day','blue']],['Memorial Day Camo',25,['memorial day','camo']],['Printing Plates',1,['printing plate','printing plates']], [year===2021?'70th Anniversary':'Platinum',1]]);
const program=(source,base,sections={})=>({source,base,sections});
// These publisher sell sheets are release-specific; Clear is assigned only to
// the 100 subjects in each imported final checklist, never to the entire base.
const flagship23=()=>variants([
 ['Rainbow Foil',null],['Gold Foil',null],['Gold',2023],
 ['Green Foilboard',499,['green foilboard','green foil','green rainbow foilboard']],
 ['Orange Foilboard',299,['orange foilboard','orange foil','orange rainbow foilboard']],
 ['Red Foilboard',199,['red foilboard','red foil','red rainbow foilboard']],
 ['Vintage Stock',99],['Independence Day',76],['Black',72],
 ["Mother's Day Hot Pink",50,['mothers day','mother s day','pink']],
 ["Father's Day Powder Blue",50,['fathers day','father s day','blue']],
 ['Memorial Day Camo',25,['memorial day','camo']],
 ['Printing Plates',1,['printing plate','printing plates']],['Platinum',1]
]);
const insert23=()=>variants([['Blue',null],['Black',299],['Gold',75],['Red',10],['Platinum',1]]);
const config={
 '2023-topps-update':program('https://www.blowoutcards.net/images/ss/23tpupdateBB.pdf',flagship23(),{
  ...Object.fromEntries(['action-stars','time-spanning-tandems','laid-out','2023-all-star-game','topps-black-gold','all-aces','1988-topps-baseball'].map(id=>[id,{variants:insert23()}])),
  ...Object.fromEntries(['action-stars-autograph-parallel','laid-out-autograph-parallel','topps-black-gold-autograph-parallel','all-aces-autograph-parallel','oversized-topps-big-baseball-card-autograph-variation','mvp-medallion-cards-autograph-parallel','commemorative-postseason-trophy-medallion-cards-autograph-parallel'].map(id=>[id,{maxPrintRun:10}])),
  'base-clear-variation':{printRun:10},
  'baseball-stars-autographs':{variants:ink21},'baseball-stars-dual-autographs':{maxPrintRun:5},
  'oversized-topps-big-baseball-card':{variants:variants([['Gold',50],['Red',10],['Platinum',1]])},
  'mvp-medallion-cards':{variants:variants([['Black',299],['Gold',75],['Red',10],['Platinum',1]])},
  'commemorative-postseason-trophy-medallion-cards':{variants:variants([['Gold',75],['Red',10],['Platinum',1]])},
  'major-league-material-cards':{variants:ink21},
  'all-star-stitches-cards':{variants:variants([['Silver',50],['Red',25],['Gold',1]])},
  'all-star-stitches-dual-cards':{printRun:25},'all-star-stitches-triple-cards':{printRun:25},
  'all-star-jumbo-patch-cards':{maxPrintRun:5,variants:variants([['Gold',1]])},
  'topps-reverence-autograph-patch-cards':{printRun:10,variants:red5},
  'mlb-first-stitch-autograph-patch-cards':{printRun:5,variants:variants([['Platinum',1]])},
  'own-the-name-relics':{printRun:1},'cut-signatures':{printRun:1}
 }),
 '2024-topps-baseball-series-2':program('https://www.blowoutcards.net/images/ss/24tpser2BB.pdf',variants([
  ['Rainbow Foil',null],['Gold Foil',null],['Gold',2024],
  ['Blue Foilboard',999,['blue foilboard','blue foil','blue holofoil']],['Purple Foilboard',799,['purple foilboard','purple foil','purple holofoil']],
  ['Green Foilboard',499,['green foilboard','green foil','green crackle']],['Aqua Foilboard',399,['aqua foilboard','aqua foil']],
  ['Orange Foilboard',299,['orange foilboard','orange foil','orange crackle']],['Red Foilboard',199,['red foilboard','red foil','red crackle']],
  ['Vintage Stock',99],['Independence Day',76],['Black',73],
  ["Mother's Day Hot Pink",50,['mothers day','mother s day','pink']],["Father's Day Powder Blue",50,['fathers day','father s day','blue']],
  ['Memorial Day Camo',25,['memorial day','camo']],['Printing Plates',1,['printing plate','printing plates']],['Platinum',1]
 ]),{
  // Clear /10 was announced for 100 subjects, but those subjects are absent
  // from this imported final checklist. Do not assign it to every base card.
  ...Object.fromEntries(['city-to-city','around-the-horn','covering-the-field','fantasy-favorites','2023-first-pitch','2023-play-ball','1989-topps-baseball','1989-topps-all-star-baseball','significant-statistics'].map(id=>[id,{variants:variants([['Blue',null],['Black',299],['Gold',50],['Red',10],['Platinum',1]])}])),
  '40-70':{variants:variants([['Gold',50],['Red',10],['Platinum',1]])},
  'baseball-stars-autographs':{variants:variants([['Black',99],['Gold',50],['Red',25],['Platinum',1]])},
  'baseball-stars-dual-autographs':{maxPrintRun:10,variants:variants([['Platinum',1]])},
  'baseball-stars-triple-autographs':{printRun:5,variants:variants([['Platinum',1]])},
  '40-70-autographs':{printRun:10,variants:red5},'2023-dynamic-dual-autograph':{printRun:10,variants:variants([['Platinum',1]])},
  'signature-tunes-dual-autographs':{printRun:25},
  '2023-silver-slugger-award-winners-cards':{variants:variants([['Black',299],['Gold',75],['Red',10],['Platinum',1]])},
  'in-the-name-relics':{printRun:1},'cut-signatures':{printRun:1}
 }),
 '2023-topps-series-1':program('https://www.blowoutcards.net/images/ss/23tpser1BB.pdf',flagship23(),{
  ...Object.fromEntries(['one-two-punch','welcome-to-the-club','2022-greatest-hits','all-aces','1988-topps-baseball'].map(id=>[id,{variants:insert23()}])),
  // "The Real One" /88 was announced in solicitation. Do not add it without
  // final-production confirmation. Autograph subjects use their own checklist.
  ...Object.fromEntries(['welcome-to-the-club-autographs','2022-greatest-hits-autographs','all-aces-autographs','one-two-punch-dual-autographs'].map(id=>[id,{maxPrintRun:25}])),
  'base-cards-clear-variation':{printRun:10},
  'topps-reverence-autograph-patch-cards':{printRun:10,variants:red5},
  'in-the-name-relics':{printRun:1},'cut-signatures':{printRun:1}
 }),
 '2023-topps-series-2':program('https://www.blowoutcards.net/images/ss/23tpser2BB.pdf',flagship23().filter(v=>v.name!=='Gold'),{
  // This Series 2 solicitation says Gold /2022. Exclude that conflicting
  // specification until independently corroborated by a production source.
  ...Object.fromEntries(['legends-of-the-game','2023-world-baseball-classic-stars','favorite-sons','all-aces','significant-statistics','1988-topps-all-star-baseball','1988-topps-baseball'].map(id=>[id,{variants:insert23()}])),
  ...Object.fromEntries(['legends-of-the-game-autograph-parallel','2023-world-baseball-classic-stars-autograph-parallel','favorite-sons-autograph-parallel','all-aces-autograph-parallel','significant-statistics-autograph-parallel'].map(id=>[id,{maxPrintRun:25}])),
  'base-cards-clear-variation':{printRun:10},
  'luke-the-cardist-base-card-art-variation':{printRun:1},
  'topps-reverence-autograph-patch-cards':{printRun:10,variants:red5},
  'oversized-topps-record-breakers-card':{variants:variants([['Gold',80],['Red',10],['Platinum',1]])},
  'in-the-name-relics':{printRun:1},'cut-signatures':{printRun:1}
 }),
 '2024-topps-baseball-series-1':program('https://ripped.topps.com/2024-topps-series-1-baseball-checklist-spotlight/',variants([
  ['Gold',2024],['Blue Holofoil',999,['blue holofoil','blue holo foil']],['Purple Holofoil',799,['purple holofoil','purple holo foil']],['Green Crackle Foil',499],['Orange Crackle Foil',299],['Red Crackle Foil',199],['Vintage Stock',99],['Independence Day',76],['Black',73],["Mother's Day Hot Pink",50,['mothers day','mother s day','pink']],["Father's Day Powder Blue",50,['fathers day','father s day','blue']],['Memorial Day Camo',25,['memorial day','camo']],['Clear',10],['Printing Plates',1,['printing plate','printing plates']],['Platinum',1]
 ]),{
  ...Object.fromEntries(['2023-all-topps-team','superstar-blueprint','grand-gamers','2023-greatest-hits','1989-topps-baseball'].map(id=>[id,{variants:variants([['Blue',null],['Black',299],['Gold',75],['Red',10],['Platinum',1]])}])),
  'home-sweet-home-stadium-medallion-cards':{variants:variants([['Gold',75],['Red',10],['Platinum',1]])},
  'baseball-stars-autographs':{variants:ink21},'baseball-stars-dual-autographs':{maxPrintRun:10},
  'topps-reverence-autogaph-patch-cards':{variants:red5},'heavy-lumber-autograph-relics':{maxPrintRun:25},'in-the-name-relics':{printRun:1},'cut-signatures':{printRun:1},
  'world-champion-relic-cards':{variants:variants([['Gold',25],['Platinum',1]])},'postseason-performance-relic-cards':{variants:variants([['Gold',25],['Platinum',1]])}
 }),
 '2021-topps-series-1-baseball':program(source21('ser1'),flagship(2021),{
  'topps-through-the-years':{variants:insert21},'stars-in-service':{variants:insert21},'topps-platinum-players-die-cuts':{variants:insert21},'1986-topps-baseball':{variants:insert21},
  '70-years-of-baseball-autographs':{variants:ink21},'1986-topps-baseball-autograph-variation':{variants:ink21},
  'major-league-material-cards':{variants:ink21},'1986-topps-baseball-relics':{variants:ink21},
  'world-champion-autograph-cards':{maxPrintRun:50,variants:relic21},'postseason-performance-autograph-cards':{maxPrintRun:50,variants:relic21},
  'world-champion-relic-cards':{printRun:99,variants:relic21},'postseason-performance-relic-cards':{printRun:99,variants:relic21},
  'topps-reverence-autograph-patch-cards':{printRun:10,variants:red5},
  'major-league-material-autograph-relic-cards':{maxPrintRun:50,variants:red5},'postseason-performance-autograph-relic-cards':{maxPrintRun:50,variants:red5},'world-champion-autograph-relic-cards':{maxPrintRun:50,variants:red5},
  'spring-training-cap-logo-cards':{variants:insert21},'70-years-of-baseball-dual-autographs':{printRun:5},'in-the-name-relics':{printRun:1},'cut-signatures':{printRun:1},'base-cards-clear-variation':{printRun:10}
 }),
 '2021-topps-series-2-baseball':program(source21('ser2'),flagship(2021),{
  ...Object.fromEntries(['dh-debuts','zero-to-60','significant-statistics','topps-platinum-players-die-cuts','1986-topps-baseball','1986-topps-all-star-baseball'].map(id=>[id,{variants:insert21}])),
  '70-years-of-baseball-autograph-cards':{variants:ink21},'1986-topps-baseball-autographs':{variants:ink21},'1986-topps-all-star-baseball-autograph-variation':{variants:ink21},
  'major-league-material-relic-cards':{variants:ink21},'1986-topps-baseball-relics':{variants:ink21},'1986-topps-all-star-baseball-relics':{variants:ink21},
  'topps-reverence-autograph-patch-cards':{printRun:10,variants:red5},'in-the-name-relics':{printRun:1},'cut-signatures':{printRun:1},'base-cards-clear-variation':{printRun:10}
 }),
 '2021-topps-updates-baseball':program(source21('update'),flagship(2021).filter(v=>v.name!=='Gold').concat(variants([['Green Foilboard',499,['green foilboard','green foil','green ice']],['Orange Foilboard',299,['orange foilboard','orange foil','orange ice']],['Red Foilboard',199,['red foilboard','red foil','red ice']]])),{
  // The original sell sheet calls Gold /2020 in this 2021 release. Leave that
  // conflicting specification out until a final-production source is checked.
  ...Object.fromEntries(['1986-topps-baseball','topps-black-and-gold','topps-platinum-player-die-cuts','topps-cards-that-never-were'].map(id=>[id,{variants:insert21}])),
  'baseball-stars-autographs':{variants:ink21},'1986-topps-baseball-autograph-cards':{variants:ink21},'major-league-material-cards':{variants:ink21},
  '2021-mlb-asg-manufactured-sleeve-patch-cards':{variants:variants([['Black',199],['Gold',50],['Red',10],['Platinum',1]])},
  'topps-reverence-autograph-patch-cards':{printRun:10,variants:red5},'baseball-stars-dual-autographs':{maxPrintRun:5},'own-the-name-relics':{printRun:1},'cut-signatures':{printRun:1},'base-cards-clear-variation':{printRun:10}
 }),
 '2020-topps-baseball-series-2':program('https://www.blowoutcards.net/images/ss/20tpser2BB.pdf',flagship(2020),{
  ...Object.fromEntries(['warriors-of-the-diamond','topps-player-of-the-decade','1985-topps-baseball','1985-topps-baseball-all-stars'].map(id=>[id,{variants:variants([['Blue',null],['Black',299],['Gold',50],['Red',10],['Platinum',1]])}])),
  'significant-statistics':{variants:variants([['Gold',50],['Red',10],['Platinum',1]])},
  'baseball-stars-autographs':{variants:ink21},'major-league-material-cards':{variants:ink21},'1985-topps-baseball-relics':{variants:ink21},'1985-topps-baseball-all-star-relics':{variants:ink21},
  'base-cards-clear-variation':{printRun:10},'cut-signatures':{printRun:1},'in-the-name-relics':{printRun:1}
 }),
 '2025-topps-chrome-baseball':program('https://ripped.topps.com/2025-topps-chrome-baseball-checklist-spotlight/',variants([
  ['Teal Refractor',299],['Purple Refractor',250],['Aqua Refractor',199],['Aqua Lava Refractor',199],['Blue Refractor',150],['Blue Lava Refractor',150],
  ...['Green','Green Wave','Green Lava'].map(n=>[n+' Refractor',99]),...['Gold','Gold Wave','Gold Lava'].map(n=>[n+' Refractor',50]),
  ...['Orange','Orange Wave','Orange Lava'].map(n=>[n+' Refractor',25]),...['Black','Black Wave','Black Lava'].map(n=>[n+' Refractor',10]),
  ...['Red','Red Wave','Red Lava'].map(n=>[n+' Refractor',5]),['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]
 ]).concat([{id:'frozenfractor',name:'Frozenfractor',printRun:5,serialDenominator:-5,displayRun:'/-5',aliases:['Frozenfractor']}]),{...Object.fromEntries(['1990-topps-baseball-autographs','chromographs','topps-chrome-ultraviolet-all-stars-autographs','future-stars-autographs','chrome-all-etch-autographs','chrome-all-etch-rookie-rush-autographs','numbers-live-forever-autograph-variation'].map(id=>[id,{variants:variants([['Orange',25],['Black',10],['Red',5],['SuperFractor',1]])}])),
  ...Object.fromEntries(['1990-topps-baseball-insert','fortune-15','future-stars','power-players','chrome-all-etch','chrome-all-etch-rookie-rush'].map(id=>[id,{variants:variants([['Green Refractor',99],['Gold Refractor',50],['Orange Refractor',25],['Black Refractor',10],['Red Refractor',5],['SuperFractor',1]])}])),
  'rookie-autographs':{variants:variants([['Refractor',499],['Purple Speckle',299],['Purple',250],['Aqua Wave',199],['Blue',150],['Blue RayWave',150],['Gold',50],['Gold Wave',50],['Orange',25],['Orange Wave',25],['Black',10],['Red',5],['Red Wave',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]])},
  'chrome-legend-autographs':{printRun:50,variants:variants([['Orange',25],['Black',10],['Red',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]])},
  ...Object.fromEntries(['topps-chrome-radiating-rookies','world-series-at-night','helix','hobby-masters'].map(id=>[id,{variants:variants([['SuperFractor',1]])}])),
  ...Object.fromEntries(['lightning-leaders','shadow-etch','numbers-live-forever'].map(id=>[id,{variants:variants([['Orange Refractor',25],['Black Refractor',10],['Red Refractor',5],['SuperFractor',1]])}])),
  'chrome-home-field-advantage':{variants:variants([['Green Speckle Refractor',99],['Gold Speckle Refractor',50],['Orange Speckle Refractor',25],['Black Speckle Refractor',10],['Red Speckle Refractor',5],['SuperFractor',1]])},
  'ultra-violet-all-stars':{variants:variants([['Green Refractor',99],['Gold Refractor',50],['Orange Refractor',25],['Black Refractor',10],['Red Refractor',5],['SuperFractor',1]])},
  'topps-chrome-expose':{printRun:10,variants:variants([['Red Refractor',5],['SuperFractor',1]])},
  'lets-go':{variants:variants([['Red Refractor',5],['SuperFractor',1]])},
  'topps-chrome-radiating-rookies-autographs':{printRun:25,variants:variants([['SuperFractor',1]])},
  'topps-chrome-ultraviolet-all-stars-autographs':{printRun:99,variants:variants([['Orange',25],['Black',10],['Red',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]])}
 })
};
export const parallelPrograms=config;
export function cardParallelProgram(set,card){
 const p=config[set.id];if(!p)return {variants:[]};
 const section=slug(card.section||'Base');
 const spec=section==='base'?{variants:p.base}:p.sections[section];
 return spec?{...spec,source:p.source,variants:spec.variants||[]}:{variants:[]};
}
export function printRunLabel(n){return n===1?'1/1':Number.isInteger(n)&&n>0?'/'+n:'Unnumbered';}
export function cardNumberingLabel(set,card){const p=cardParallelProgram(set,card);return card.parallelRule?.displayRun||(card.parallelRule?.printRun?printRunLabel(card.parallelRule.printRun):p.printRun?printRunLabel(p.printRun):p.maxPrintRun?'/'+p.maxPrintRun+' or less':'');}
export function selectedParallelCard(set,card,id){
 const p=cardParallelProgram(set,card),rule=p.variants.find(v=>v.id===id);
 return rule?{...card,variant:rule.name,parallelRule:rule,parallelSiblings:p.variants,parallelSource:p.source}:null;
}
export function matchesSerialNumbering(text,rule){
 const marked=String(text||'');
 if(/\bebay\s*1\s*[/of]+\s*1\b/i.test(marked))return false;
 const serials=[...marked.matchAll(/(?:\b(-?\d+)\s*)?\/\s*(-?\d+)\b/g)].map(m=>({numerator:m[1]?Number(m[1]):null,denominator:Number(m[2])}));
 if(rule.printRun||rule.maxPrintRun)return serials.length>0&&serials.every(s=>(rule.maxPrintRun?s.denominator>0&&s.denominator<=rule.maxPrintRun:s.denominator===(rule.serialDenominator||rule.printRun))&&(s.numerator===null||Math.abs(s.numerator)>=1&&Math.abs(s.numerator)<=Math.abs(s.denominator)));
 return serials.length===0;
}
export function matchesParallelPrinting(text,rule,siblings=[rule],section=''){
 let folded=norm(text);const marked=String(text||'');
 // An insert title is identity, not finish evidence (e.g. Topps Black Gold).
 for(const phrase of [norm(section),norm(section).replace(/^topps /,'')].filter(Boolean))folded=(' '+folded+' ').replace(' '+phrase+' ',' ').trim();
 const matched=siblings.flatMap(r=>r.aliases.map(a=>({id:r.id,phrase:norm(a).replace(/\brefractor\b/g,'').trim()||norm(a)})))
  .filter(a=>a.phrase&&(' '+folded+' ').includes(' '+a.phrase+' ')).sort((a,b)=>b.phrase.length-a.phrase.length);
 if(!matched.length||matched[0].id!==rule.id)return false;
 for(const finish of ['raywave','geometric','mini diamond','wave','lava','speckle','shimmer','sonar','reptilian','frozenfractor'])if(folded.includes(finish)&&!norm(rule.name).includes(finish))return false;
 // An eBay 1/1 or jersey-number sales pitch is not publisher serial evidence.
 return matchesSerialNumbering(marked,rule);
}
const familyCollections=new WeakMap();
export function numberedParallelCollection(set,groups,collections){
 if(!config[set?.id])return collections;
 if(familyCollections.has(set))return familyCollections.get(set);
 const original=collections.find(g=>g.id==='all-parallels');
 const originalIds=new Set(original?.cards.map(c=>c.id));
 const cards=[...new Map([...set.cards,...groups.flatMap(g=>g.cards),...(original?.cards||[])].filter(c=>originalIds.has(c.id)||cardParallelProgram(set,c).variants.length||cardParallelProgram(set,c).printRun||cardParallelProgram(set,c).maxPrintRun).map(c=>[c.id,c])).values()];
 const collection={id:'all-parallels',name:'Parallels & numbered cards by card',kind:'Variations',aggregate:true,parallelFamilies:true,cards};
 const result=[...collections.filter(g=>g.id!=='all-parallels'),collection];familyCollections.set(set,result);return result;
}
export function parallelPreviewTile({name,numbering,path,lookup,searchHref='',ownHtml='',escape:esc}){
 return '<li class="mp-parallel-card"><a class="mp-parallel-finish" href="'+esc(path)+'"><span>'+esc(name)+'</span>'+(numbering?'<b>'+esc(numbering)+'</b>':'')+'</a>'+ownHtml+(ownHtml.includes('<img')?'':'<div class="mp-parallel-market"><div data-sports-result aria-live="polite"><span class="mp-parallel-placeholder">Matching photo &amp; price will load here.</span></div><button type="button" data-sports-lookup="'+esc(lookup)+'">Load photo &amp; price</button>'+(searchHref?'<p class="mp-parallel-search"><a href="'+esc(searchHref)+'" target="_blank" rel="noopener sponsored">Search eBay for this finish</a></p>':'')+'</div>')+'</li>';
}
export function inlineParallelStock(items,card,set,deps){
 if(!Array.isArray(items)||!deps?.available)return '';
 const family=card.parallelRule?{...card,variant:'Base'}:card;
 const copy=items.find(i=>Number.isFinite(i.price)&&i.price>0&&deps.available(i)&&baseballChecklistInventoryMatches(i,family,set)&&(!card.parallelRule||matchesParallelPrinting([i.name,i.variant,i.treatment,i.serialNumber].filter(Boolean).join(' '),card.parallelRule,card.parallelSiblings,card.section)));
 return copy?catalogStoreCopyHtml(copy,{escape:deps.escape,slug:deps.slug}):'';
}
export function cardParallelOptionsHtml(set,card,path,esc,{inventory,deps,campaignId}={}){
 const p=cardParallelProgram(set,card);
 // Reuse this page's already loaded public inventory; never query per finish.
 const candidates=Array.isArray(inventory)?inventory.filter(i=>baseballChecklistInventoryMatches(i,{...card,variant:'Base'},set)):[];
 return p.variants.map(v=>parallelPreviewTile({name:v.name,numbering:v.displayRun||printRunLabel(v.printRun),path:path+'?parallel='+v.id,lookup:path+'?market=1&parallel='+v.id,searchHref:ebayChecklistSearch(selectedParallelCard(set,card,v.id),set,campaignId),ownHtml:inlineParallelStock(candidates,selectedParallelCard(set,card,v.id),set,deps),escape:esc})).join('');
}
const parallelBaseStyle='<style>.mp-card-parallels{padding:10px 12px;border:1px solid var(--wo-border,#777);border-radius:10px;margin:8px 0 16px;background:var(--wo-surface,transparent);font:14px/1.45 system-ui}.mp-card-parallels>summary{font:700 14px/1.45 system-ui!important;min-height:44px;cursor:pointer;display:list-item!important}.mp-card-parallels ul{list-style:none;padding:0;margin:8px 0}.mp-card-parallels li a{display:flex!important;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:6px 0;border-bottom:1px solid var(--wo-border,#777);font:600 14px/1.45 system-ui!important}.mp-card-parallels li b{white-space:nowrap}.mp-card-parallels small{display:block;font:12px/1.45 system-ui}</style>';

export const parallelFamilyStyle=parallelBaseStyle+`<style>
.mp-card-parallels ul.mp-parallel-gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}
.mp-parallel-card{min-width:0;padding:9px;border:1px solid var(--wo-border,#777);border-radius:9px;background:var(--wo-bg,transparent)}
.mp-card-parallels li.mp-parallel-card>a.mp-parallel-finish{display:flex!important;flex-direction:column;align-items:flex-start!important;gap:4px;min-height:62px;border:0;padding:0 0 8px;overflow-wrap:anywhere}
.mp-parallel-card button{width:100%;min-height:44px;padding:8px;border:1px solid var(--wo-border,#777);border-radius:7px;color:var(--wo-on-button,#111);background:var(--wo-button,#8bd450);font:650 12px/1.3 system-ui;cursor:pointer}
.mp-parallel-card [data-sports-result]{min-height:180px;overflow-wrap:anywhere;font:12px/1.45 system-ui}
.mp-parallel-card [data-sports-result] img,.mp-parallel-card .mp-store-copy img{display:block;width:100%!important;height:180px!important;object-fit:contain;margin:0 auto 8px}
.mp-parallel-card [data-sports-result] a{display:block!important;min-height:0!important;border:0!important;padding:0!important}
.mp-parallel-card [data-sports-result] strong,.mp-parallel-card .mp-store-copy strong{font:650 12px/1.4 system-ui!important}
.mp-parallel-card [data-sports-result] strong{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.mp-parallel-card [data-sports-result] p{font:12px/1.45 system-ui!important;margin:8px 0}
.mp-card-parallels li .mp-parallel-search a{font:600 12px/1.4 system-ui!important;min-height:44px!important;display:flex!important;align-items:center}.mp-parallel-card .mp-store-copy{display:block!important;padding:0!important;border:0!important;font:12px/1.45 system-ui!important}
.mp-parallel-placeholder{display:flex;min-height:180px;align-items:center;justify-content:center;text-align:center;font:12px/1.45 system-ui;color:var(--wo-muted,inherit);padding:8px}
@media(min-width:768px){.mp-card-parallels ul.mp-parallel-gallery{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}}
@media(max-width:767px){.mp-sports-browser{position:static!important}.mp-sports-links{scrollbar-width:none}.mp-sports-links::-webkit-scrollbar{display:none}}
</style>`;
