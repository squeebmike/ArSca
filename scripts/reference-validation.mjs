import {baseballSets} from './topps/baseball-seed.mjs';
import {footballSets} from './topps/football-seed.mjs';
import {sectionsForSet} from './baseball-section-pages.mjs';
import {cardParallelProgram,selectedParallelCard} from './sports-parallels.mjs';
import {referenceIdentityMatches,safeReferenceImage,referenceNeedsFinish} from './reference-match.mjs';
import {referenceCardNames} from './reference-card-aliases.mjs';
export const REFERENCE_AUDIT_VERSION='2026-10-25.2';
export const REFERENCE_SOURCE_MAPPING_VERSION='2026-10-29.2-big-league-inserts';
export function validReferenceConsoleId(value){return typeof value==='string'&&value.length<=160&&/^[a-z0-9-]+(?:%27[a-z0-9-]+)*$/.test(value);}
const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const slug=s=>fold(s).replaceAll(' ','-');
const sets=[...baseballSets,...footballSets],indexes=new WeakMap();let sourceIndex;
export function referenceConsoles(set,card=null){
 if(['hockey','basketball'].includes(set.sport))return (set.providerConsoles||[]).filter(id=>validReferenceConsoleId(id)&&id.startsWith(set.sport+'-cards-'));
 const sport=set.sport==='football'?'football':'baseball',name=slug(set.displayName.replace(/\b(baseball|football)\b/gi,'')),ids=[sport+'-cards-'+name];
 // Observed 2019 directories from the authorized Big League recovery.
 if(set.id==='2019-topps-big-league-baseball'){
  const sources={'Players Weekend Nicknames':'players%27-weekend-nicknames','Blast Offs':'blast-off','Star Caricature Reproductions':'star-caricature-reproductions','Wall Climbers':'wall-climbers'};
  for(const [section,suffix] of Object.entries(sources))if(!card||card.section===section)ids.push('baseball-cards-2019-topps-big-league-'+suffix);
 }
 // Observed 2020 provider directories collected by the authorized recovery.
 if(set.id==='2020-topps-big-league-baseball'){
  const sources={'Roll Call':'roll-call','Flipping Out':'flipping-out','Defensive Wizards':'defensive-wizards','Star Caricatures Reproductions':'star-caricature-reproductions'};
  for(const [section,suffix] of Object.entries(sources))if(!card||card.section===section)ids.push('baseball-cards-2020-topps-big-league-'+suffix);
 }
 if(set.id==='2023-bowman-s-best-baseball')ids.push('baseball-cards-2023-bowman%27s-best');
 if(set.id==='2023-topps-cosmic-chrome-baseball'){
  const sources={'Cosmic Chrome Autograph Variation':'autographs','Extraterrestrial Talent Autograph Variation':'extraterrestrial-talent-autographs','Launched Into Orbit Autograph Variation':'launched-into-orbit-autographs'};
  for(const [section,suffix]of Object.entries(sources))if(!card||card.section===section)ids.push('baseball-cards-2023-topps-cosmic-chrome-'+suffix);
  if(!card||card.section==='Supernova')ids.push('baseball-cards-2023-topps-cosmic-chrome-supernova');
 }
 if(set.id==='2022-topps-stadium-club-chrome'){
  ids.push('baseball-cards-2022-stadium-club-chrome');
  if(!card||/auto/i.test(card.section||''))ids.push('baseball-cards-2022-stadium-club-chrome-autographs');
 }
 // The provider's flagship console also holds Series 2 card numbers. Exact
 // player/number/finish matching still separates the two published releases.
 if(sport==='baseball'&&/topps.*series [12]/i.test(set.displayName)&&set.year>=2019&&set.year<=2026)ids.push('baseball-cards-'+set.year+'-topps');
 if(sport==='baseball'&&/topps updates?(?: series)? baseball/i.test(set.displayName))ids.push('baseball-cards-'+name.replace(/-updates?(?:-series)?$/,'-update'));
 if(sport==='baseball'&&/topps update series/i.test(set.displayName))ids.push('baseball-cards-'+name.replace('-update-series','-update'));
 if(sport==='baseball'&&/topps chrome updates?(?: series)? baseball/i.test(set.displayName))ids.push('baseball-cards-'+name.replace(/-updates$/,'-update').replace(/-update-series$/,'-update'));
 if(['2023-bowman','2023-bowman-chrome'].includes(set.id)){
  if(!card||['Chrome Prospects','Bowman Chrome Prospects','Extended Bowman Chrome Prospects'].includes(card.section))ids.push('baseball-cards-2023-bowman-chrome-prospects');
  if(!card||['Chrome Prospect Autographs','Bowman Chrome Prospects Autographs'].includes(card.section))ids.push('baseball-cards-2023-bowman-chrome-prospect-autographs');
 }
 if(['2023-topps-series-1','2023-topps-series-2','2023-topps-update'].includes(set.id)&&(!card||card.section==='All Aces'))ids.push('baseball-cards-2023-topps-all-aces');
 if(set.id==='2023-topps-chrome'&&(!card||card.section==='Rookie Autographs'))ids.push('baseball-cards-2023-topps-chrome-rookie-autographs');
 if(set.id==='2023-topps-finest-baseball'&&(!card||card.section==='Finest Autographs'))ids.push('baseball-cards-2023-topps-finest-autographs');
 if(set.id==='2024-topps-cosmic-chrome-baseball'&&(!card||card.section==='Cosmic Chrome Autograph Variation'))ids.push('baseball-cards-2024-topps-cosmic-chrome-autograph');
 for(const year of [2024,2025,2026])if(set.id===year+'-topps-chrome-baseball'&&(!card||card.section==='Rookie Autographs'))ids.push('baseball-cards-'+year+'-topps-chrome-rookie-autograph');
 if(set.id==='2023-topps-chrome-update-series-baseball'&&(!card||card.section==='Autograph Cards'))ids.push('baseball-cards-2023-topps-chrome-update-autographs');
 if(set.id==='2024-topps-chrome-update-series-baseball'&&(!card||['Autograph Cards','Topps Chrome Update Autograph Cards'].includes(card.section)))ids.push('baseball-cards-2024-topps-chrome-update-autograph');
 if(set.id==='2024-topps-five-star-baseball')ids.push('baseball-cards-2024-topps-five-star-autograph');
 // Actual collected source IDs use plural "prospects" in 2024/2025 and
 // combine spring/fall Chrome subjects. Number, player and section still
 // decide the exact published release; these aliases never publish a card.
 if(['2024-bowman-baseball','2024-bowman-chrome-baseball'].includes(set.id)){
  if(!card||card.section==='Chrome Prospects')ids.push('baseball-cards-2024-bowman-chrome-prospects');
  if(!card||['Chrome Prospect Autographs I','Bowman Chrome Prospect Autographs'].includes(card.section))ids.push('baseball-cards-2024-bowman-chrome-prospects-autograph');
  if(set.id==='2024-bowman-baseball'&&(!card||card.section==='Paper Prospects'))ids.push('baseball-cards-2024-bowman-prospects');
 }
 if(set.id==='2025-bowman-baseball'){
  if(!card||card.section==='Chrome Prospects I')ids.push('baseball-cards-2025-bowman-chrome-prospects');
  if(!card||card.section==='Chrome Prospects Autograph Variation')ids.push('baseball-cards-2025-bowman-chrome-prospect-autograph');
  if(!card||card.section==='Paper Prospects')ids.push('baseball-cards-2025-bowman-prospects');
 }
 if(set.id==='2025-bowman-draft-baseball'){
  if(!card||card.section==='Chrome Draft Picks')ids.push('baseball-cards-2025-bowman-draft-chrome');
  if(!card||card.section==='Chrome Prospect Autograph Variation')ids.push('baseball-cards-2025-bowman-draft-chrome-prospect-autograph');
 }
 if(set.id==='2021-bowman-draft-baseball'&&(!card||card.section==='Chrome Draft Picks'))ids.push('baseball-cards-2021-bowman-draft-chrome');
 if(set.id==='2026-bowman-baseball'){
  if(!card||card.section==='Paper Prospects')ids.push('baseball-cards-2026-bowman-paper-prospect');
  if(!card||card.section==='Chrome Prospects')ids.push('baseball-cards-2026-bowman-chrome-prospect');
  if(!card||card.section==='Chrome Prospects Autograph Variation')ids.push('baseball-cards-2026-bowman-chrome-prospect-autograph');
 }
 if(set.id==='2026-bowman-chrome-baseball'){
  if(!card||card.section==='Chrome Prospects')ids.push('baseball-cards-2026-bowman-chrome-prospect');
  if(!card||card.section==='Bowman Chrome Prospect Autographs')ids.push('baseball-cards-2026-bowman-chrome-prospect-autograph');
 }
 return [...new Set(ids)];
}
function possibleSources(consoleId){
 if(!sourceIndex){sourceIndex=new Map();for(const set of sets)for(const id of referenceConsoles(set)){if(!sourceIndex.has(id))sourceIndex.set(id,[]);sourceIndex.get(id).push({set,proposed:false});}}
 return sourceIndex.get(consoleId)||[];
}
function cardIndex(set){
 if(indexes.has(set))return indexes.get(set);
 const index=new Map();
 for(const card of [...set.cards,...sectionsForSet(set).flatMap(g=>g.cards)]){
  for(const name of referenceCardNames(card)){const key=String(card.cardNumber)+'|'+fold(name);if(!index.has(key))index.set(key,[]);if(!index.get(key).includes(card))index.get(key).push(card);}
 }
 indexes.set(set,index);return index;
}
export function referenceCategory(row){return /auto|signature/i.test(row.title+' '+row.consoleId)?'autograph':row.run?'numbered':row.parallel?'parallel':/#[a-z]+-/i.test(row.title)?'insert':'base';}
export function referenceMetadataCheck(row){
 const flags=[],parsed=String(row.title||'').match(/^(.*?)\s*(?:\[([^\]]+)\])?\s*#([^\s]+)\s*$/),matches=[];
 if(!parsed)flags.push('missing_card_identity');
 if(parsed&&String(row.cardNumber)!==parsed[3])flags.push('card_number_conflict');
 if(parsed&&row.player&&fold(row.player)!==fold(parsed[1]))flags.push('player_conflict');
 if(parsed&&fold(row.parallel)!==fold(parsed[2]))flags.push('finish_conflict');
 if(row.run&&!/^\/-?[1-9]\d*$/.test(row.run))flags.push('unrecognized_numbering');
 if(!row.image)flags.push('missing_photo');else if(!safeReferenceImage(row.image))flags.push('invalid_image_host');
 let source;try{source=new URL(row.url);}catch{}
 if(!source||source.protocol!=='https:'||!['www.pricecharting.com','www.sportscardspro.com'].includes(source.hostname)||source.pathname.split('/')[2]!==row.consoleId)flags.push('source_set_conflict');
 const sources=possibleSources(row.consoleId);
 if(!sources.length)flags.push('unmapped_source_set');
 if(parsed&&sources.length){
  for(const {set}of sources)for(const card of cardIndex(set).get(parsed[3]+'|'+fold(parsed[1]))||[]){
   if(!referenceConsoles(set,card).includes(row.consoleId))continue;
   if(!parsed[2]&&referenceNeedsFinish(set,card))continue;
   const variants=[card,...cardParallelProgram(set,card).variants.map(rule=>selectedParallelCard(set,card,rule.id))];
   for(const candidate of variants)if(referenceIdentityMatches(row,candidate)){
    const path='/'+(set.sport==='football'?'football':'baseball')+'/checklists/'+set.id+'/cards/'+card.id+(candidate.parallelRule?'?parallel='+encodeURIComponent(candidate.parallelRule.id):'');
    if(!matches.some(m=>m.path===path))matches.push({setId:set.id,path,source:set.sourceUrl,parallel:candidate.parallelRule?.name||'',run:candidate.parallelRule?.printRun||null});
   }
  }
  if(!matches.length)flags.push('no_exact_checklist_match');
  else if(matches.length>1)flags.push('ambiguous_checklist_match');
 }
 return {version:REFERENCE_AUDIT_VERSION,mappingVersion:REFERENCE_SOURCE_MAPPING_VERSION,category:referenceCategory(row),flags,matches:matches.slice(0,5),metadataMatched:matches.length===1,visuallyReviewed:false,checkedAt:Date.now()};
}
export function referenceImageKey(image){return String(image||'').match(/images\.pricecharting\.com\/([a-z0-9]+)\//)?.[1]||'';}
export async function checkReferenceImage(image,fetcher=fetch){
 if(!safeReferenceImage(image))return {ok:false,reason:'invalid_image_host',checkedAt:Date.now()};
 try{const r=await fetcher(image,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(7000)}),type=r.headers.get('Content-Type')||'';return {ok:r.ok&&/^image\//i.test(type),status:r.status,type,reason:!r.ok?'image_http_'+r.status:!/^image\//i.test(type)?'not_an_image':'',checkedAt:Date.now()};}
 catch{return {ok:false,reason:'image_request_failed',checkedAt:Date.now()};}
}
