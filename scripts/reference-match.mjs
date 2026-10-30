const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\b([a-z]) ([a-z])\b/g,'$1$2');
import {referenceCardNames} from './reference-card-aliases.mjs';
import {cardParallelProgram} from './sports-parallels.mjs';
const finishName=s=>fold(s).replace(/^platinum toile /,'toile ').replace(/^bowman logo pattern$/,'logo pattern').replace(/ refractor$/,'');
export function safeReferenceImage(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='storage.googleapis.com'&&/^\/images\.pricecharting\.com\/[a-z0-9]+\/(?:60|240|300|400|1600)\.jpg$/.test(u.pathname)?u.href:null;}catch{return null;}}
export function referenceNeedsFinish(set,card){return !card.parallelRule&&!!set.cards?.some(base=>base.id!==card.id&&String(base.cardNumber)===String(card.cardNumber)&&fold(base.player)===fold(card.player));}
export function referenceIdentityMatches(row,card,set){
 const m=String(row.title||'').match(/^(.*?)\s*(?:\[([^\]]+)\])?\s*#([^\s]+)\s*$/),rule=card.parallelRule,number=String(card.cardNumber);
 if(!m||!referenceCardNames(card).some(name=>fold(m[1])===fold(name))||m[3]!==number)return false;
 // These observed consoles combine distinct physical programs under shared
 // numbers. Require the printed occasion/variation and its exact serial run.
 if(set?.id==='2026-topps-five-star-baseball'){
  const physical={
   'Rookie Cap Patch Autographs Jackie Robinson Day Mlb Logo':['rookie-cap-patch-autograph-mlb-logo','jackie robinson day','/1'],
   'Rookie Cap Patch Autographs Jackie Robinson Day Side Logo':['rookie-cap-patch-autograph-side-logo','jackie robinson day','/1'],
   'Award Winners Autograph Relics':['award-winner-autograph-relic','','/10'],
   'Award Winners Autograph Relics Image Variation':['award-winner-autograph-relic','image variation','/1']
  }[card.section];
  if(physical)return !rule&&row.consoleId==='baseball-cards-2026-topps-five-star-'+physical[0]&&fold(m[2])===physical[1]&&row.run===physical[2];
 }
 if(!rule){
  if(!card.section||card.section==='Base'){
   if(m[2])return false;const program=set?cardParallelProgram(set,card):null;
   if(program?.printRun||program?.maxPrintRun){const denominator=String(row.run||'').match(/^\/([1-9]\d*)$/)?.[1];return !!denominator&&(program.printRun?Number(denominator)===program.printRun:Number(denominator)<=program.maxPrintRun);}
   return !row.run;
  }
  // An alphanumeric Update number alone does not identify the Clear/image
  // variation. Those explicit base variations need a matching finish label.
  if(!m[2]&&/^base\b.*\b(?:variation|parallel)/i.test(card.section))return false;
  // The collected Platinum root calls its publisher-listed image variants SP.
  // This source label identifies only those variants, never the numbered base.
  if(set?.id==='2022-topps-chrome-platinum-anniversary'&&card.section==='Base Cards Image Variations')return row.consoleId==='baseball-cards-2022-topps-chrome-platinum-anniversary'&&fold(m[2])==='sp variation'&&!row.run;
  const stadium=row.consoleId==='baseball-cards-2024-topps-stadium-club'?{'Base Set Chrome Variation':'chrome','Base Cards Image Variations':'image variation','Base Cards Design Variations':'design variation','Base Cards Rookie Design Variations':'rookie design variation'}[card.section]:null;
  if(stadium)return fold(m[2])===stadium&&!row.run;
  const section=fold(card.section).replace(/\b(?:base|cards?|variations?|parallels?)\b/g,' ').replace(/\s+/g,' ').trim();
  return m[2]?finishName(section)===finishName(m[2]):/[a-z]/i.test(number);
 }
 const sourceAliases=row.consoleId==='baseball-cards-2024-topps-stadium-club'?{'Red Foil':['Red'],'Black Foil':['Black'],'Gold Foil':['Gold'],'Blue Foil':['Blue'],'Green Foil':['Green'],'Purple Foil':['Purple'],'Black and White':['Black White'],"Photographer's Proof":['Proof'],'Gold Rainbow Foil':['Gold Rainbow']}[rule.name]||[]:[];
 if(!m[2]||![rule.name,...(rule.aliases||[]),...sourceAliases].some(n=>finishName(n)===finishName(m[2])))return false;
 const denominator=String(row.run||'').match(/^\/(-?\d+)$/)?.[1];
 if(rule.numberingUnknown)return true;
 if(rule.printRun)return Number(denominator)===(rule.serialDenominator||rule.printRun);
 return !denominator;
}
export function matchReferenceImage(rows,set,card){const needsFinish=referenceNeedsFinish(set,card),matches=rows.filter(row=>safeReferenceImage(row.image)&&(!needsFinish||/\[[^\]]+\]\s*#/.test(row.title))&&referenceIdentityMatches(row,card,set));return matches.length===1?{...matches[0],source:'PriceCharting / SportsCardsPro',referenceOnly:true}:null;}
