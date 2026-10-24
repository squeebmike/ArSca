// Publisher parallel programs. Never copy a rainbow between releases/subsets.
import {baseballChecklistInventoryMatches,ebayChecklistSearch} from './topps/public-checklist-policy.mjs';
import {catalogStoreCopyHtml} from './catalog-inventory.mjs';
import {remainingParallelSpecs} from './topps/remaining-parallel-programs.mjs';
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\bfoil board\b/g,'foilboard').replace(/\brainbow foilboard\b/g,'rainbow foil').trim();
const variants=rows=>rows.map(([name,printRun,aliases,metadata])=>({id:slug(name),name,printRun:printRun==='?'?null:printRun,...(printRun==='?'?{numberingUnknown:true,displayRun:'Numbering not confirmed'}:{}),...(/ Border$/.test(name)?{searchTerm:name.replace(/ Border$/,'')}:{}),aliases:aliases||(/ Border$/.test(name)?[name,name.replace(/ Border$/,'')]:/^Pristine (.+) Refractor$/.test(name)?[name,name.replace(/^Pristine (.+) Refractor$/,'$1 Pristine Refractor')]:[name]),...metadata}));
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
// Confirmed separately in the 2023 and 2024 Cosmic publisher spotlights.
const cosmicTail=()=>variants([['Gold Interstellar Refractor',50],['Orange Galactic Refractor',25],['Black Eclipse Refractor',10],['Red Flare Refractor',5],['SuperFractor',1]]);
const cosmicGreen=()=>variants([['Green Space Dust Refractor',75]]).concat(cosmicTail());
const bowman23Paper=()=>variants([['Sky Blue Border',499],['Neon Green Border',399],['Fuchsia Border',299],['Purple Border',250],['Purple Pattern',199],['Pink Border',175],['Blue Border',150],['Blue Pattern',125],['Yellow Border',75],['Gold Border',50],['Orange Border',25],['Black Pattern',15],['Red Border',5],['Platinum Border',1],['Printing Plates',1,['printing plate','printing plates']]]);
const bowman23Insert=()=>variants([['Atomic Refractor',150],['Aqua Refractor',125],['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]]);
const config={
 ...Object.fromEntries(Object.entries(remainingParallelSpecs).map(([id,p])=>[id,{...p,base:variants(p.base),baseRanges:p.baseRanges?.map(r=>({...r,variants:variants(r.variants)})),sections:Object.fromEntries(Object.entries(p.sections||{}).map(([key,spec])=>[key,{...spec,variants:variants(spec.variants||[])}]))}])),
 '2024-bowman-baseball':program('https://ripped.topps.com/2024-bowman-baseball-checklist-spotlight/',bowman23Paper(),{
  'paper-prospects':{variants:bowman23Paper()},
  'chrome-prospects':{variants:variants([['Mini-Diamond Refractor',null],['Lunar Glow',null],['Refractor',499],['Lava Refractor',399],['Speckle Refractor',299],['Purple Refractor',250],['Purple RayWave Refractor',250],['Fuchsia Refractor',199],['Fuchsia Lunar Refractor',199],['Blue Refractor',150],['Blue Shimmer Refractor',150],['Blue RayWave Refractor',150],['Aqua Lunar Refractor',125],['Aqua Shimmer Refractor',125],['Green Grass Refractor',99],['Yellow Refractor',75],['Yellow Lunar Refractor',75],['Gold Refractor',50],['Gold Shimmer Refractor',50],['Orange Refractor',25],['Orange Shimmer Refractor',25],['Black Refractor',10],['Rose Gold Refractor',10],['Rose Gold Mini-Diamond Refractor',10],['Red Refractor',5],['Red Lava Refractor',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']],['Pearl Refractor',null]])},
  'chrome-prospects-special-die-cut-variation':{printRun:49},
  'base-cards-retrofractor-variation':{variants:variants([['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])},
  ...Object.fromEntries(['bowman-scouts-top-100','bowman-ai','roy-favorites','prospect-power-up','bowman-spotlights'].map(id=>[id,{variants:variants([['Mini-Diamond Refractor',150],['Aqua Refractor',125],['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])}])),
  'rising-infernos':{variants:variants([['Mini-Diamond Refractor',150],['Aqua Refractor',125],['Gold Refractor',50]])},
  '55-bowman-anime':{variants:variants([['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])},
  'gladiators-of-the-diamond':{variants:variants([['Mini-Diamond Refractor',150],['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])},
  'origin-of-greatness':{printRun:10},
  'chrome-rookie-autographs':{variants:variants([['Refractor',499],['Blue Refractor',150],['Mini-Diamond Refractor',100],['Yellow Refractor',75],['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]])},
  'chrome-prospect-autographs-i':{variants:variants([['Refractor',499],['Speckle Refractor',299],['Purple Refractor',250],['Blue Refractor',150],['Blue Lunar Refractor',150],['Mini-Diamond Refractor',100],['Yellow Refractor',75],['Green Grass Refractor',99],['Gold Refractor',50],['Gold Shimmer Refractor',50],['Orange Refractor',25],['Orange Shimmer Refractor',25],['Red Refractor',5],['Red Lava Refractor',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']],['Pearl Refractor',10]])},
  'rising-infernos-autograph-variation':{printRun:99,variants:variants([['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])},
  'bowman-scouts-top-100-autograph-variation':{printRun:99,variants:variants([['Gold Refractor',50],['Red Refractor',5],['SuperFractor',1]])},
  'gladiators-of-the-diamond-autograph-variation':{printRun:99,variants:variants([['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])},
  'prospects-power-up-autograph-variation':{variants:variants([['SuperFractor',1]])},
  'dual-bowman-prospect-autographs':{printRun:25,variants:variants([['SuperFractor',1]])},
  '2024-bowman-ultimate-autograph-book-card':{printRun:10},
  'roy-favorites-autograph-variation':{printRun:150,variants:variants([['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])}
 }),
 // The publisher groups five paper colors into a range without individual
 // counts. Include only the explicitly assigned runs until those are verified.
 '2025-bowman-baseball':program('https://ripped.topps.com/2025-bowman-baseball-checklist-spotlight/',variants([['Platinum',1],['Printing Plates',1,['printing plate','printing plates']],['Red',5],['Black Border',10],['Black Pattern',10],['Orange Border',25],['Gold',50],['Yellow',75],['Yellow Pattern',75],['Blue',150],['Blue Pattern',125],['Green Border',99],['Green Pattern',99]]),{
  'paper-prospects':{variants:variants([['Platinum',1],['Printing Plates',1,['printing plate','printing plates']],['Red',5],['Black Border',10],['Black Pattern',10],['Orange Border',25],['Gold',50],['Yellow',75],['Yellow Pattern',75],['Blue',150],['Blue Pattern',125],['Green Border',99],['Green Pattern',99]])},
  'chrome-prospects-i':{variants:variants([['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']],['Red Refractor',5],['Red Lava Refractor',5],['Reptilian Red Refractor',5],['Red Geometric Refractor',5],['Black Refractor',10],['Black X-Fractor',10],['Black Geometric Refractor',10],['Rose Gold Refractor',15],['Rose Gold Mini-Diamond Refractor',15],['Orange Wave Refractor',25],['Reptilian Orange Refractor',25],['Orange Geometric Refractor',25],['Gold Refractor',50],['Gold Shimmer Refractor',50],['Gold Reptilian Refractor',50],['Gold Geometric Refractor',50],['Yellow Refractor',75],['Steel Metal',100],['Green Grass Refractor',99],['Green Shimmer Refractor',99],['Green Reptilian Refractor',99],['Green Geometric Refractor',99],['Aqua X-Fractor',125],['Aqua Shimmer Refractor',125],['Blue Refractor',150],['Blue Shimmer Refractor',150],['Blue RayWave Refractor',150],['Blue Reptilian Refractor',150],['Blue Geometric Refractor',150],['Purple RayWave Refractor',250],['Purple Refractor',250],['Purple Geometric Refractor',250]])},
  ...Object.fromEntries(['base-cards-etched-in-glass-variation','hobby-stars','bowman-scouts-top-100','roy-favorites','very-important-prospects','rockstar-rookies'].map(id=>[id,{variants:variants([['SuperFractor',1],['Red Refractor',5],['Orange Refractor',25],['Gold Refractor',50],['Green Refractor',99],['Aqua Refractor',125],['Mini-Diamond Refractor',150]])}])),
  'chrome-prospects-retrofractor-variation':{variants:variants([['SuperFractor',1],['Red Refractor',5],['Gold Refractor',50]])},
  'bowman-spotlights':{variants:variants([['SuperFractor',1],['Red Refractor',5]])},
  'greatness-loading':{variants:variants([['SuperFractor',1],['Red Refractor',5],['Orange Refractor',25],['Gold Refractor',50],['Aqua Refractor',125],['Mini-Diamond Refractor',150]])},
  'crystalized':{variants:variants([['SuperFractor',1],['Red Refractor',5],['Orange Refractor',25],['Gold Refractor',50]])},
  ...Object.fromEntries(['anime','anime-kanji-variation'].map(id=>[id,{variants:variants([['SuperFractor',1],['Red Refractor',5],['Black Refractor',10]])}])),
  'chrome-prospects-autograph-variation':{variants:variants([['Refractor',499],['Speckle Refractor',299],['Purple Refractor',250],['Blue Refractor',150],['Blue X-Fractor',150],['Mini-Diamond Refractor',100],['Green Grass Refractor',99],['Yellow Refractor',75],['Gold Refractor',50],['Gold Shimmer Refractor',50],['Orange Refractor',25],['Orange Shimmer Refractor',25],['Reptilian Orange Refractor',25],['Black Refractor',10],['Black X-Fractor',10],['Red Refractor',5],['Red Lava Refractor',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]])},
  'hobby-stars-autograph-variation':{printRun:99,variants:variants([['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])},
  ...Object.fromEntries(['paper-rookies-and-veterans-retail-autographs','paper-prospects-autograph-variation'].map(id=>[id,{variants:variants([['Purple',250],['Blue',150],['Green',99],['Gold',50],['Orange',25],['Red',5],['Platinum',1]])}])),
  '2025-ultimate-autograph-book-card':{printRun:10},
  'chrome-rookie-autographs':{variants:variants([['Refractor',499],['Blue Refractor',150],['Mini-Diamond Refractor',100],['Yellow Refractor',75],['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]])},
  'very-important-prospects-autograph-variation':{printRun:99,variants:variants([['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])},
  'rockstar-rookies-autograph-variation':{variants:variants([['SuperFractor',1]])},
  'roy-favorites-autograph-variation':{printRun:150,variants:variants([['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])},
  'chrome-prospects-retrofractor-variation-autograph-variation':{variants:variants([['Gold Refractor',50],['Red Refractor',5],['SuperFractor',1]])}
 }),
 '2025-bowman-draft-baseball':program('https://ripped.topps.com/2025-bowman-draft-baseball-collector-guide/',variants([['Sky Blue Border',499],['Blue Border',150],['Green Border',99],['Gold Border',50],['Orange Border',25],['Red Border',5],['Black Border',1],['Printing Plates',1,['printing plate','printing plates']]]),{
  'chrome-draft-picks':{variants:variants([['Refractor',null],['Sky Blue Refractor',null],['X-Fractor',null],['Purple Refractor',250],['Sparkles Refractor',200],['Blue Refractor',150],['Aqua Wave Refractor',125],['Steel Metal Refractor',100],['Green Refractor',99],['Green Grass Refractor',99],['Yellow Refractor',75],['Gold Refractor',50],['Orange Refractor',25],['Black Refractor',10],['Red Lava Refractor',5],['Red Refractor',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']],['Lazer Refractor',null],['Fuchsia Reptilian Refractor',199],['Aqua Reptilian Refractor',125],['Green Reptilian Refractor',99],['Bowmanfractor',35],['Yellow Reptilian Refractor',75],['Black X-Fractor',10],['Gum Ball Refractor',null],['Sunflower Seeds Refractor',null],['Peanuts Refractor',null],['Pop Corn Refractor',null],...['Purple','Blue','Aqua','Green','Yellow','Gold','Orange','Black','Red'].map((color,i)=>[color+' Geometric',[250,150,125,99,75,50,25,10,5][i]])])},
  'chrome-prospect-autographs-gold-ink-variation':{printRun:15},
  'bowman-spotlights':{variants:variants([['Red Refractor',5],['SuperFractor',1]])},
  'bowman-in-action':{variants:variants([['Mini-Diamond Refractor',150],['Green Refractor',99],['Gold Refractor',50],['Orange Refractor',25],['Black Refractor',10],['Red Refractor',5],['SuperFractor',1]])},
  ...Object.fromEntries(['crystalized','base-cards-retrofractor-variation'].map(id=>[id,{variants:variants([['Gold Refractor',50],['Orange Refractor',25],['Black Refractor',10],['Red Refractor',5],['SuperFractor',1]])}])),
  ...Object.fromEntries(['axis','prized-prospects'].map(id=>[id,{variants:variants([['Refractor',250],['Mini-Diamond Refractor',150],['Green Refractor',99],['Gold Refractor',50],['Orange Refractor',25],['Black Refractor',10],['Red Refractor',5],['SuperFractor',1]])}]))
 }),
 '2023-bowman-chrome':program('https://ripped.topps.com/2023-bowman-chrome-baseball-checklist-spotlight/',variants([
  ['Refractor',499],['Fuchsia Refractor',299],['Aqua Ray Wave Refractor',199],['Blue Refractor',150],['Wave Refractor',100],['Green Refractor',99],['Yellow Refractor',75],['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]
 ]),{
  'bowman-chrome-prospects':{variants:variants([['Shimmer Refractor',null],['Refractor',499],['Speckle',299],['Purple Refractor',250],['Purple Shimmer',250],['Fuchsia Pink Vapor Wave',199],['Fuchsia Shimmer',199],['Blue Refractor',150],['Aqua Refractor',125],['Aqua Pink Vapor',125],['Green Refractor',99],['Green Shimmer',99],['Yellow Refractor',75],['Yellow Orange Vapor Wave',75],['Gold Refractor',50],['Gold Shimmer',50],['Orange Refractor',25],['Orange Shimmer',25],['Red Refractor',5],['Red Aqua Vapor Wave',5],['Red Shimmer',5],['SuperFractor',1]])},
  'color-run-rookie-variations':{printRun:23},
  ...Object.fromEntries(['bowman-iconic','2022-afl-fall-stars','prospect-process'].map(id=>[id,{variants:variants([['Atomic Refractor',150],['Orange Refractor',25],['SuperFractor',1]])}])),
  '2023-bowman-invicta':{variants:variants([['Atomic Refractor',150],['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])},
  'bowman-ascensions':{variants:variants([['Orange Refractor',25],['SuperFractor',1]])},
  'bowman-chrome-prospects-autographs':{variants:variants([['Refractor',499],['Speckle',299],['Purple Refractor',250],['Blue Ray Wave Refractor',150],['Atomic Refractor',100],['Green Refractor',99],['Yellow Refractor',75],['Gold Mini-Diamond',50],['Orange Refractor',25],['Orange Shimmer',25],['Red Refractor',5],['Red Shimmer',5],['SuperFractor',1]])},
  'chrome-rookie-autographs':{variants:variants([['Refractor',499],['Blue Refractor',150],['Green Refractor',99],['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])},
  'prime-chrome-signatures':{printRun:50,variants:variants([['SuperFractor',1]])},
  'prospect-process-autograph-variation':{variants:variants([['Orange Refractor',25],['SuperFractor',1]])},
  'bowman-iconic-autographs':{printRun:99,variants:variants([['Orange Refractor',25],['SuperFractor',1]])},
  '2022-afl-mvp-short-print-autograph-parallel':{printRun:100},
  ...Object.fromEntries(['2022-afl-fall-stars-autograph-parallel','bowman-ascensions-autograph-parallel','2022-afl-relics-autograph-parallel'].map(id=>[id,{variants:variants([['SuperFractor',1]])}])),
  '2023-bowman-invicta-autograph-variation':{variants:variants([['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])},
  'chrome-autograph-relics':{variants:variants([['Gold Refractor',50],['Orange Refractor',25],['SuperFractor',1]])},
  '2022-afl-relics':{variants:variants([['Orange Refractor',25],['SuperFractor',1]])},
  '2022-afl-jumbo-relics':{printRun:10,variants:variants([['Red Refractor',5],['Black Nike Logo Refractor',1],['SuperFractor',1]])}
 }),
 '2023-bowman':program('https://ripped.topps.com/2023-bowman-baseball-checklist-spotlight/',bowman23Paper(),{
  'paper-prospects':{variants:bowman23Paper()},
  'chrome-prospects':{variants:variants([['Atomic Refractor',null],['Lunar Glow',null],['Refractor',499],['Speckle Refractor',299],['Purple Refractor',250],['Fuchsia Refractor',199],['Fuchsia Lunar Refractor',199],['Blue Refractor',150],['Blue Shimmer Refractor',150],['Aqua Lunar Refractor',125],['Aqua Shimmer Refractor',125],['Green Grass Refractor',99],['Yellow Refractor',75],['Yellow Lunar Refractor',75],['Gold Refractor',50],['Gold Shimmer Refractor',50],['Orange Refractor',25],['Orange Shimmer Refractor',25],['Rose Gold Refractor',10],['Rose Gold Lava Refractor',10],['Red Refractor',5],['Red Lava Refractor',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]])},
  'chrome-prospects-special-die-cut-variation':{printRun:49},
  ...Object.fromEntries(['bowman-scouts-top-100','modern-prospect','roy-favorites','sights-on-september'].map(id=>[id,{variants:bowman23Insert()}])),
  ...Object.fromEntries(['bowman-spotlights','2023-bowman-invicta'].map(id=>[id,{variants:bowman23Insert().filter(v=>v.name!=='Aqua Refractor')}])),
  'chrome-prospect-autographs':{variants:variants([['Refractor',499],['Speckle Refractor',299],['Purple Refractor',250],['Blue Refractor',150],['Blue Lunar Refractor',150],['Atomic Refractor',100],['Green Grass Refractor',99],['Yellow Refractor',75],['Gold Refractor',50],['Gold Shimmer Refractor',50],['Orange Refractor',25],['Orange Shimmer Refractor',25],['Red Refractor',5],['Red Lava Refractor',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]])},
  'chrome-rookie-autographs':{variants:variants([['Refractor',499],['Blue Refractor',150],['Atomic Refractor',100],['Yellow Refractor',75],['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]])},
  'bowman-scouts-top-100-autograph-parallel':{printRun:99,variants:variants([['Gold Refractor',50],['Red Refractor',5],['SuperFractor',1]])},
  'modern-prospect-autographs':{printRun:99,variants:variants([['Red Refractor',5],['SuperFractor',1]])},
  '2023-bowman-invicta-autograph-parallel':{printRun:99,variants:variants([['Gold Atomic Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])},
  'sights-on-september-autograph-parallel':{variants:variants([['SuperFractor',1]])},
  'dual-bowman-prospect-autographs':{printRun:25,variants:variants([['SuperFractor',1]])},
  'roy-favorites-autographs':{printRun:150,variants:variants([['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])}
 }),
 '2026-topps-inception-football':program('https://ripped.topps.com/2026-topps-inception-football-collector-cards-guide/',variants([['Gold Electricity',50],['Hot Pink',35]]),{}),
 '2026-topps-series-1-baseball':program('https://ripped.topps.com/2026-topps-series-1-baseball-collectors-guide/',variants([
  ['Diamante Foil',null],['Holo Foil',null],['Pink Diamante Foil',null],['Rainbow Foil',null],['Sandglitter',null],['Silver Crackleboard Foil',null,['silver crackleboard','silver crackle foilboard']],['Spring Training',null],['Topps Foil Pattern',null],['Aqua Holo Foil',null],['Aqua Rainbow Foil',null],['Gold',2026],
  ...['Holo Foil','Rainbow Foil'].flatMap(f=>[['Yellow '+f,399],['Purple '+f,250],['Blue '+f,150],...(f==='Rainbow Foil'?[['Green '+f,99]]:[]),['Gold '+f,50],['Orange '+f,25],['Black '+f,10],['Red '+f,5]]),
  ['Cherry Blossom',99],['Green Diamante Foil',99],['Green Spring Training',99,['green spring training','spring training green']],['Independence Day',76],['75 Years of Topps',75],['Black Border',75],
  ['Gold Diamante Foil',50],['Gold Sandglitter',50],['Gold Spring Training',50,['gold spring training','spring training gold']],['Canvas',50],['Memorial Day Camo',25,['memorial day','camo']],['Orange Diamante Foil',25],['Orange Sandglitter',25],['Orange Spring Training',25,['orange spring training','spring training orange']],['Wood',25],['Black Diamante Foil',10],['Black Sandglitter',10],['Red Diamante Foil',5],['Red Sandglitter',5],['Red Spring Training',5,['red spring training','spring training red']],['First Card',1,['first card','1st card']],['Foilfractor',1],['Rose Gold Holo Foil',1],['Rose Gold Spring Training',1],['Printing Plates',1,['printing plate','printing plates']]
 ]).concat([{id:'pink-holo-foil',name:'Pink Holo Foil',printRun:null,displayRun:'800 copies printed',aliases:['Pink Holo Foil']}]),{
  // Green Holo Foil is named without a print run in the publisher guide.
  // Keep its serial count unresolved rather than copying Green Rainbow /99.
  ...Object.fromEntries(['big-ticket-players','first-pitch','topps-profiles'].map(id=>[id,{variants:variants([['Pink Foil',null],['Blue Foil',150],['Green Foil',99],['Gold Foil',50],['Orange Foil',25],['Black Foil',10],['Red Foil',5],['Foilfractor',1]])}])),
  '1991-topps-baseball':{variants:variants([['Pink',null],['Blue',150],['Green',99],['The Real One',91],['Gold',50],['Orange',25],['Black',10],['Red',5],['Foilfractor',1]])},
  ...Object.fromEntries(['major-league-material-cards','city-connect-swatch-collection'].map(id=>[id,{variants:variants([['Rainbow Foilboard',null],['Blue',150],['Gold',50],['Orange',25],['Black',10],['Red',5],['Platinum',1]])}])),
  'in-the-name-relics':{printRun:1}
 }),
 '2025-topps-series-2-baseball':program('https://ripped.topps.com/2025-topps-series-2-baseball-checklist/',variants([
  ['Rainbow Foilboard',null,['rainbow foilboard','rainbow foil']],['Aqua Rainbow Foilboard',null,['aqua rainbow foilboard','aqua rainbow foil']],['Aqua Holo Foil',null],['Diamante Foil',null],['Holiday',null],['Holo Foil',null],['HTA Sandglitter',null,['hta sandglitter','sandglitter','sanglitter']],['Pink Diamante Foil',null],['Silver Crackle Foilboard',null,['silver crackle foilboard','silver crackle']],['Topps Foil Pattern',null],['Gold',2025],
  ...['Holo Foil','Rainbow Foilboard'].flatMap(f=>[['Purple '+f,250],['Blue '+f,150],['Green '+f,99],['Gold '+f,50],['Orange '+f,25],['Black '+f,10],['Red '+f,5]]),
  ['Holiday Hot Dog',99,['holiday hot dog','hot dog']],['Vintage Stock Retro',99,['vintage stock retro','vintage stock']],['Independence Day',76],['Black',74],['Gold Diamante Foil',50],['Canvas',50],['Holiday Beach Ball',50,['holiday beach ball','beach ball']],['Holiday Beach Umbrella',25,['holiday beach umbrella','beach umbrella']],['Memorial Day Camo',25,['memorial day','camo']],['Orange Diamante Foil',25],['Wood',25],['Black Diamante Foil',10],['Holiday Fireworks',5,['holiday fireworks','fireworks']],['Red Diamante Foil',5],['First Card',1,['first card','1st card']],['Foilfractor',1],['Holiday Waves',1,['holiday waves']],['Platinum Holo Foil',1],['Printing Plates',1,['printing plate','printing plates']]
 ]).concat([{id:'pink-holo-foil',name:'Pink Holo Foil',printRun:null,displayRun:'800 copies printed',aliases:['Pink Holo Foil']}]),{
  'base-cards-all-positions-variations':{printRun:9},
  'rounding-the-bases-relics':{variants:variants([['Green',99],['Gold',50],['Orange',25],['Black',10],['Red',5],['Platinum',1]])}
 }),
 '2023-topps-cosmic-chrome-baseball':program('https://ripped.topps.com/2023-topps-cosmic-chrome-checklist-spotlight/',variants([['Refractor',null],['Nucleus Refractor',null],['Aqua Equinox Refractor',199],['Blue Moon Refractor',99]]).concat(cosmicGreen()),{
  'star-clusters':{variants:cosmicTail()},'extraterrestrial-talent':{variants:variants([['Blue Moon Refractor',99]]).concat(cosmicTail())},
  'stars-in-the-night':{variants:variants([['Eclipse Refractor',10],['Flare Refractor',5],['SuperFractor',1]])},
  'cosmic-chrome-autograph-variation':{variants:cosmicGreen()},'extraterrestrial-talent-autograph-variation':{variants:cosmicTail()}
 }),
 '2024-topps-cosmic-chrome-baseball':program('https://ripped.topps.com/2024-topps-cosmic-chrome-baseball-checklist-spotlight/',variants([['Refractor',null],['Nucleus Refractor',null],['Aqua Equinox Refractor',199],['Purple Nebula Refractor',150],['Blue Moon Refractor',99]]).concat(cosmicGreen()),{
  ...Object.fromEntries(['launched-into-orbit','astrologically-aligned','star-command-autograph-variation'].map(id=>[id,{variants:cosmicTail()}])),
  ...Object.fromEntries(['star-command','into-the-cosmos','galactic-greatness','cosmic-chrome-autograph-variation'].map(id=>[id,{variants:cosmicGreen()}])),
  ...Object.fromEntries(['starfractor','stella-nova'].map(id=>[id,{variants:cosmicTail().filter(v=>v.printRun<=25)}])),
  ...Object.fromEntries(['supernova','solar-flares-autograph-variation'].map(id=>[id,{variants:cosmicTail().filter(v=>v.printRun<=10)}])),
  'stars-in-the-night':{variants:variants([['Eclipse Refractor',10],['Flare Refractor',5],['SuperFractor',1]])}
 }),
 '2023-topps-chrome':program('https://ripped.topps.com/2023-topps-chrome-baseball-checklist-spotlight/',variants([
  ['Refractor',null],['Prism Refractor',null],['Negative Refractor',null],['Magenta Refractor',399],['Magenta Speckle Refractor',350],['Purple Speckle Refractor',299],['Purple Sonar Refractor',275],['Purple Refractor',250],['Aqua Refractor',199],['Aqua Lava Refractor',199],['Blue Refractor',150],['Blue Sonar Refractor',125],['Green Refractor',99],['Green Wave Refractor',99],['Green Sonar Refractor',99],['Blue Wave Refractor',75],['Gold Refractor',50],['Gold Wave Refractor',50],['Orange Wave Refractor',25],['Red Refractor',5],['Red Wave Refractor',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]
 ]),{
  'radiating-rookies':{variants:variants([['SuperFractor',1]])},
  'base-cards-image-variations':{variants:variants([['Green Speckle Refractor',99],['Gold Speckle Refractor',50],['Orange Speckle Refractor',25],['Red Speckle Refractor',5],['SuperFractor',1]])},
  '1988-topps-baseball':{variants:variants([['Green Refractor',99],['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])}
 }),
 '2023-topps-chrome-update-series-baseball':program('https://ripped.topps.com/2023-topps-chrome-update-series-baseball-checklist/',variants([
  ['Prism Refractor',null],['Negative Refractor',null],['Magenta Refractor',399],['Magenta Purple Lava Lamp Refractor',275],['Purple Refractor',250],['Aqua Refractor',199],['Aqua Blue Lava Lamp Refractor',175],['Blue Refractor',150],['Blue Green Lava Lamp Refractor',125],['Green Refractor',99],['Gold Refractor',50],['Gold Mini Diamond Refractor',50],['Orange Refractor',25],['Red Orange Lava Lamp Refractor',10],['Red Refractor',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]
 ]),{

 }),
 '2024-bowman-chrome-baseball':program('https://ripped.topps.com/2024-bowman-chrome-baseball-checklist-spotlight-product/',variants([
  ['Refractor',499],['Fuchsia Refractor',299],['Purple Refractor',250],['Aqua RayWave Refractor',199],['Blue Refractor',150],['Wave Refractor',100],['Green Refractor',99],['Yellow Refractor',75],['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]
 ]),{
  'chrome-prospects':{variants:variants([
   ['Shimmer Refractor',null],['Refractor',499],['Speckle Refractor',299],['Purple Refractor',250],['Purple Shimmer Refractor',250],['Fuchsia Shimmer Refractor',199],['Blue Refractor',150],['Reptilian Blue Refractor',150,['reptilian blue','blue reptilian']],['Aqua Refractor',125],['Green Refractor',99],['Reptilian Green Refractor',99,['reptilian green','green reptilian']],['Green Shimmer Refractor',99],['Yellow Refractor',75],['Gold Refractor',50],['Gold Shimmer Refractor',50],['Reptilian Gold Refractor',50,['reptilian gold','gold reptilian']],['Orange Refractor',25],['Reptilian Orange Refractor',25,['reptilian orange','orange reptilian']],['Orange Shimmer Refractor',25],['Black Refractor',10],['Reptilian Black Refractor',10,['reptilian black','black reptilian']],['Red Refractor',5],['Reptilian Red Refractor',5,['reptilian red','red reptilian']],['Red Shimmer Refractor',5],['SuperFractor',1]
  ])},
  'base-set-retrofractor-variation':{variants:variants([['Gold Refractor',50],['Orange Refractor',25],['Red Refractor',5],['SuperFractor',1]])}
 }),
 // The publisher confirms these base finishes. Do not fill the rest of the
 // football rainbow from baseball releases or unlicensed earlier editions.
 '2025-topps-chrome-football':program('https://ripped.topps.com/2025-topps-chrome-football-best-rookie-cards-collect/',variants([['Blue Refractor',150],['Red Refractor',5],['SuperFractor',1]]),{}),
 '2025-topps-cosmic-chrome-football':program('https://ripped.topps.com/2025-topps-cosmic-chrome-football-hobby-box-breakdown/',variants([['Refractor',null],['Nucleus Refractor',null],['Aqua Equinox Refractor',199],['SuperFractor',1]]),{}),
 '2025-topps-series-1-baseball':program('https://ripped.topps.com/2025-topps-baseball-series-1-checklist-spotlight-product-2/',variants([
  ['Gold',2025],['Rainbow Foil',null],['Aqua Rainbow Foil',null],['Holo Foil',null],['Aqua Holo Foil',null],['Pink Holo Foil',null],
  ...['Holo Foil','Rainbow Foil'].flatMap(f=>[['Purple '+f,250],['Blue '+f,150],['Green '+f,99],['Gold '+f,50],['Orange '+f,25],['Black '+f,10],['Red '+f,5]]),
  ['Independence Day',76],['Canvas',50],['Memorial Day Camo',25,['memorial day','camo']],['Wood',25],['Foilfractor',1],['Platinum Holo Foil',1],['Printing Plates',1,['printing plate','printing plates']],['Confetti',null],
  ['Silver Crackle Foilboard',null,['silver crackle foilboard','silver crackle']],['Diamante Foil',null],['Pink Diamante Foil',null],['Gold Diamante Foil',50],['Orange Diamante Foil',25],['Black Diamante Foil',10],['Red Diamante Foil',5],
  ['Birds',1],['Eggs',null],['Rabbits',null],['Flowers',50],['Umbrellas',10],['Watering Cans',5],
  ['Spring Training',null],...['Green','Gold','Orange','Red','Platinum'].map((c,i)=>['Spring Training '+c,[99,50,25,5,1][i],['spring training '+c,c+' spring training']])
 ]).concat([{id:'black',name:'Black',printRun:74,aliases:['Black'],source:'https://ripped.topps.com/2025-topps-series-2-baseball-checklist/'}]),{
  ...Object.fromEntries(['2024-all-topps-team','training-grounds','call-to-the-hall'].map(id=>[id,{variants:variants([['Pink Foil',null],['Blue Foil',150],['Green Foil',99],['Gold Foil',50],['Orange Foil',25],['Black Foil',10],['Red Foil',5],['Foilfractor',1]])}])),
  // The Greatest Hits Blue count is printed as "15o" on the source page;
  // other shared inserts corroborate the names, not that ambiguous value.
  '2024-greatest-hits':{variants:variants([['Pink Foil',null],['Green Foil',99],['Gold Foil',50],['Orange Foil',25],['Black Foil',10],['Red Foil',5],['Foilfractor',1]])},
  'baseball-stars-autographs':{variants:variants([['Blue',150],['Gold',50],['Orange',25],['Black',10],['Red',5],['Platinum',1]])},
  'baseball-stars-dual-autographs':{maxPrintRun:10},
  '1990-topps-baseball-autograph-cards':{variants:variants([['Gold',50],['Orange',25],['Black',10],['Red',5],['Platinum',1]])},
  'flagship-real-one-autograph-cards':{variants:variants([['Gold Foil',50],['Orange Foil',25],['Black Foil',10],['Red Foil',5],['Foilfractor',1]])},
  'city-connect-swatch-collection-autograph-relic':{variants:variants([['Gold',50],['Orange',25],['Black',10],['Red',5],['Platinum',1]])},
  'rickwood-autograph-relic-collection':{variants:variants([['Orange',25],['Black',10],['Red',5],['Platinum',1]])},
  'heavy-lumber-autograph-relics':{maxPrintRun:10}
 }),
 '2024-topps-chrome-update-series-baseball':program('https://ripped.topps.com/2024-topps-chrome-update-series-checklist-spotlight-product/',variants([
  ['Refractor',null],['Prism Refractor',null],['Negative Refractor',null],['X-Fractor',null],['RayWave Refractor',null],
  ['Magenta Refractor',399],['Magenta Purple Lava Lamp Refractor',299,['magenta purple lava lamp','magenta purple lava']],['Purple Refractor',250],['Aqua Refractor',199],['Aqua RayWave Refractor',199],['Aqua Blue Lava Lamp Refractor',175],['Blue RayWave Refractor',150],['Blue Green Lava Lamp Refractor',125],
  ['Green Refractor',99],['Green Wave Refractor',99],['Green RayWave Refractor',99],
  ['Gold Refractor',50],['Gold Mini Diamond Refractor',50],['Gold RayWave Refractor',50],
  ['Orange Refractor',25],['Orange RayWave Refractor',25],['Orange Black Lava Lamp Refractor',15],['Black Refractor',10],['Black RayWave Refractor',10],['Red Refractor',5],['Red RayWave Refractor',5],['SuperFractor',1],['Printing Plates',1,['printing plate','printing plates']]
 ]).concat([{id:'frozenfractor',name:'Frozenfractor',printRun:5,serialDenominator:-5,displayRun:'/-5',aliases:['Frozenfractor']}]),{}),
 '2022-topps-update-baseball':program('https://www.blowoutcards.net/images/ss/22tpupdateBB.pdf',flagship23().map(v=>v.name==='Gold'?{...v,printRun:2022}:v.name==='Black'?{...v,printRun:71}:v),{
  ...Object.fromEntries(['generation-now','paragons-of-the-postseason','topps-black-gold','diamond-greats-die-cuts','2022-all-star-game'].map(id=>[id,{variants:insert23()}])),
  ...Object.fromEntries(['generation-now-autograph-parallel','paragons-of-the-postseason-autograph-parallel','topps-black-gold-autograph-parallel','diamond-greats-die-cuts-autograph-parallel','oversized-rookie-reprint-boxloader-autograph-variation','2022-special-event-patch-cards-autograph-parallel'].map(id=>[id,{maxPrintRun:10}])),
  'base-cards-clear-variation':{printRun:10},'baseball-stars-autographs':{variants:ink21},'baseball-stars-dual-autographs':{maxPrintRun:5},'1987-topps-baseball-autograph-cards':{variants:ink21},
  '2022-special-event-patch-cards':{variants:variants([['Black',199],['Gold',50],['Red',10],['Platinum',1]])},
  'major-league-material-cards':{variants:ink21},'all-star-stitches-cards':{variants:variants([['Silver',50],['Red',25],['Gold',1]])},
  'all-star-jumbo-patch-cards':{maxPrintRun:5,variants:variants([['Gold',1]])},'all-star-stitches-dual-cards':{printRun:25},'all-star-stitches-triple-cards':{printRun:25},
  'topps-reverence-autograph-patch-cards':{printRun:10,variants:red5},'own-the-name-relics':{printRun:1},'cut-signatures':{printRun:1}
 }),
 '2020-topps-updates-baseball':program('https://www.blowoutcards.net/images/ss/20tpupdateBB.pdf',flagship(2020),{
  ...Object.fromEntries(['prospects-insert','decades-best','20-years-of-the-captain','a-numbers-game','1985-topps-baseball'].map(id=>[id,{variants:variants([['Blue',null],['Black',299],['Gold',50],['Red',10],['Platinum',1]])}])),
  'decades-best-autograph-parallel':{maxPrintRun:25},'a-numbers-game-autographs':{maxPrintRun:25},
  'baseball-stars-autographs':{variants:ink21},'baseball-stars-dual-autographs':{maxPrintRun:5},'1985-topps-baseball-autographs':{variants:ink21},
  ...Object.fromEntries(['20-years-of-the-captain-commemorative-patch-cards','jeter-final-season-commemorative-patch-cards'].map(id=>[id,{variants:variants([['Black',50],['Gold',25],['Red',10],['Platinum',1]])}])),
  '20-years-of-the-captain-commemorative-patch-cards-autograph-parallel':{printRun:1},'jeter-final-season-commemorative-patch-cards-autograph-parallel':{maxPrintRun:25},
  'major-league-material-cards':{variants:ink21},'all-star-stitches-cards':{variants:variants([['Silver',50],['Red',25],['Gold',1]])},
  'all-star-jumbo-patch-cards':{maxPrintRun:5,variants:variants([['Gold',1]])},'all-star-stitches-dual-cards':{printRun:25},'all-star-stitches-triple-cards':{printRun:25},
  'topps-reverence-autograph-patch-cards':{printRun:10,variants:red5},'own-the-name-relics':{printRun:1},'cut-signatures':{printRun:1}
 }),
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
// Supplemental subset lists transcribed from the displayed publisher checklist.
// Missing Orange/Black Crackle counts are deliberately excluded.
Object.assign(config['2025-topps-series-2-baseball'].sections,Object.fromEntries([
 ["2025-topps-flagship-autograph-patch-cards",[["Bronze",25],["Black",10],["Red",5],["Platinum",1]]],
 ["city-connect-swatch-collection-autograph-relic",[["Gold",50],["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["major-league-material-autograph-cards",[["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["major-league-material-dual-autograph-cards",[["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["rickwood-autograph-relic-collection",[["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["rounding-the-bases-autograph-relic",[["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["1990-topps-baseball-all-star-autograph-cards",[["Gold",50],["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["1990-topps-baseball-autograph-cards",[["Gold",50],["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["2024-first-pitch-autograph-variation",[["Gold",50],["Orange",25],["Black",10],["Red",5],["Foilfractor",1]]],
 ["baseball-stars-autographs",[["Blue",150],["Gold",50],["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["flagship-real-one-autograph-cards",[["Green",99],["Gold",50],["Orange",25],["Black",10],["Red",5],["Foilfractor",1]]],
 ["signature-tunes-dual-autographs",[["Black",10],["Red",5],["Platinum",1]]],
 ["world-champion-autograph-cards",[["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["world-champion-dual-autograph-cards",[["Red",5],["Platinum",1]]],
 ["1990-topps-baseball-relics",[["Blue",150],["Gold",50],["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["1990-topps-baseball-all-star-relics",[["Blue",150],["Gold",50],["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["city-connect-swatch-collection",[["Blue",150],["Gold",50],["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["major-league-material-cards",[["Blue",150],["Gold",50],["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["major-league-material-dual-relic-cards",[["Gold",50],["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["real-one-relics",[["Gold",50],["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["rounding-the-bases-relics",[["Green",99],["Gold",50],["Orange",25],["Black",10],["Red",5],["Platinum",1]]],
 ["rounding-the-bases-dual-relics",[["Gold",50],["Orange",25],["Black",10]]],
 ["1990-topps-all-star-baseball",[["Pink",null],["Green Crackle Foil",99],["The Real One",90],["Gold",50],["Gold Crackle Foil",50],["No Name",35],["Orange",25],["Black",10],["Red",5],["Red Crackle Foil",5],["Platinum",1]]],
 ["1990-topps-baseball",[["Pink",null],["Green Crackle Foil",99],["The Real One",90],["Gold",50],["Gold Crackle Foil",50],["No Name",35],["Orange",25],["Black",10],["Red",5],["Red Crackle Foil",5],["Platinum",1]]],
 ["2024-first-pitch",[["Pink Foil",null],["Blue Foil",150],["Green Foil",99],["Gold Foil",50],["Orange Foil",25],["Black Foil",10],["Red Foil",5],["Foilfractor",1]]],
 ["dynamic-duos",[["Pink Foil",null],["Blue Foil",150],["Green Foil",99],["Gold Foil",50],["Orange Foil",25],["Black Foil",10],["Red Foil",5],["Foilfractor",1]]],
 ["ops-bests",[["Pink Foil",null],["Blue Foil",150],["Green Foil",99],["Gold Foil",50],["Orange Foil",25],["Black Foil",10],["Red Foil",5],["Foilfractor",1]]],
 ["stars-of-mlb",[["Gold Foil",50],["Orange Foil",25],["Black Foil",10],["Red Foil",5],["Foilfractor",1]]],
 ["summer-superstars",[["Pink Foil",null],["Blue Foil",150],["Green Foil",99],["Gold Foil",50],["Orange Foil",25],["Black Foil",10],["Red Foil",5],["Foilfractor",1]]],
 ["topps-mega-stars",[["Gold Foil",50],["Orange Foil",25],["Black Foil",10],["Red Foil",5],["Foilfractor",1]]]
].map(([id,rows])=>[id,{variants:variants(rows)}])));
export const parallelPrograms=config;
const baseIdentities=new WeakMap();
export function cardParallelProgram(set,card){
 const p=config[set.id];if(!p)return {variants:[]};
 const section=slug(card.section||'Base');
 if(section==='base'){
  if(!baseIdentities.has(set))baseIdentities.set(set,new Set((set.cards||[]).map(c=>String(c.cardNumber)+'|'+norm(c.player))));
  if(!baseIdentities.get(set).has(String(card.cardNumber)+'|'+norm(card.player)))return {variants:[]};
 }
 const baseRange=section==='base'&&p.baseRanges?.find(r=>/^\d+$/.test(String(card.cardNumber))&&Number(card.cardNumber)>=r.first&&Number(card.cardNumber)<=r.last);
 const spec=section==='base'?(p.baseRanges?baseRange:{variants:p.base}):p.sections[section];
 return spec?{...spec,source:p.source,references:p.references||[],variants:spec.variants||[]}:{variants:[]};
}
export function printRunLabel(n){return n===1?'1/1':Number.isInteger(n)&&n>0?'/'+n:'Unnumbered';}
export function cardNumberingLabel(set,card){const p=cardParallelProgram(set,card);return card.parallelRule?.displayRun||(card.parallelRule?.printRun?printRunLabel(card.parallelRule.printRun):p.printRun?printRunLabel(p.printRun):p.maxPrintRun?'/'+p.maxPrintRun+' or less':'');}
export function selectedParallelCard(set,card,id){
 const p=cardParallelProgram(set,card),rule=p.variants.find(v=>v.id===id);
 const productIdentity=String(set.displayName||'').replace(/\b(?:\d{4}|baseball|football|cards)\b/gi,' ').replace(/\s+/g,' ').trim();
 return rule?{...card,variant:rule.name,parallelRule:{...rule,productIdentity},parallelSiblings:p.variants,parallelSource:rule.source||p.source}:null;
}
export function matchesSerialNumbering(text,rule){
 const marked=String(text||'');
 if(/\bebay\s*1\s*[/of]+\s*1\b/i.test(marked))return false;
 const serials=[...marked.matchAll(/(?:\b(-?\d+)\s*)?\/\s*(-?\d+)\b/g)].map(m=>({numerator:m[1]?Number(m[1]):null,denominator:Number(m[2])}));
 if(rule.numberingUnknown)return serials.every(s=>s.denominator>=1&&(s.numerator===null||s.numerator>=1&&s.numerator<=s.denominator));
 if(rule.printRun||rule.maxPrintRun)return serials.length>0&&serials.every(s=>(rule.maxPrintRun?s.denominator>0&&s.denominator<=rule.maxPrintRun:s.denominator===(rule.serialDenominator||rule.printRun))&&(s.numerator===null||Math.abs(s.numerator)>=1&&Math.abs(s.numerator)<=Math.abs(s.denominator)));
 return serials.length===0;
}
export function matchesParallelPrinting(text,rule,siblings=[rule],section=''){
 let folded=norm(text);const marked=String(text||'');
 if(rule.productIdentity)folded=(' '+folded+' ').replace(' '+norm(rule.productIdentity)+' ',' ').trim();
 // The product name alone is not proof of Pristine's encased treatment.
 if(rule.encased||rule.unencased){
  folded=folded.replace(/\btopps pristine\b/,' ').replace(/\s+/g,' ').trim();
  const encased=/\b(?:encased|uncirculated|pristine)\b/.test(folded);
  if(rule.encased&&!encased||rule.unencased&&encased)return false;
  siblings=siblings.filter(r=>encased?!r.unencased:!r.encased);
 }
 // An insert title is identity, not finish evidence (e.g. Topps Black Gold).
 for(const phrase of [norm(section),norm(section).replace(/^topps /,'')].filter(Boolean))folded=(' '+folded+' ').replace(' '+phrase+' ',' ').trim();
 const matched=siblings.flatMap(r=>r.aliases.map(a=>({id:r.id,generic:norm(r.name)==='refractor',phrase:norm(a).replace(/\brefractor\b/g,'').trim()||norm(a)})))
  .filter(a=>a.phrase&&(' '+folded+' ').includes(' '+a.phrase+' ')).sort((a,b)=>Number(a.generic)-Number(b.generic)||b.phrase.length-a.phrase.length);
 if(!matched.length||matched[0].id!==rule.id)return false;
 // A partial program must not turn an unimported color into a plain finish.
 if(['refractor','prism refractor','raywave refractor','x fractor','shimmer refractor','reptilian refractor','mini diamond refractor','wave refractor','geometric refractor','negative refractor','rainbow foil','holo foil','diamante foil','spring training'].includes(norm(rule.name))&&/\b(?:blue|green|gold|red|purple|pink|aqua|magenta|orange|black|white|yellow|teal|sepia|fuchsia)\b/.test(folded))return false;
 for(const finish of ['raywave','geometric','mini diamond','wave','lava','speckle','shimmer','sonar','reptilian','frozenfractor','prism','negative','nucleus','xfractor','x fractor'])if(folded.includes(finish)&&!norm(rule.name).includes(finish))return false;
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
 // Names, numbering and links stay crawlable. Mount the expensive image and
 // lookup controls only when this card's disclosure opens on the client.
 const needsPhoto=!ownHtml.includes('<img');
 return '<li class="mp-parallel-card"'+(needsPhoto?' data-sports-preview="'+esc(lookup)+'"':'')+'><a class="mp-parallel-finish" href="'+esc(path)+'"><span>'+esc(name)+'</span>'+(numbering?'<b>'+esc(numbering)+'</b>':'')+'</a>'+ownHtml+(needsPhoto&&searchHref?'<p class="mp-parallel-search"><a href="'+esc(searchHref)+'" target="_blank" rel="noopener sponsored">Search eBay for this finish</a></p>':'')+'</li>';
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
.mp-card-parallels li.mp-parallel-card .mp-parallel-finish b{white-space:normal}
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
