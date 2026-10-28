const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\b([a-z]) ([a-z])\b/g,'$1$2');
import {referenceCardNames} from './reference-card-aliases.mjs';
const finishName=s=>fold(s).replace(/^platinum toile /,'toile ').replace(/^bowman logo pattern$/,'logo pattern').replace(/ refractor$/,'');
export function safeReferenceImage(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='storage.googleapis.com'&&/^\/images\.pricecharting\.com\/[a-z0-9]+\/(?:60|240|300|400|1600)\.jpg$/.test(u.pathname)?u.href:null;}catch{return null;}}
export function referenceNeedsFinish(set,card){return !card.parallelRule&&!!set.cards?.some(base=>base.id!==card.id&&String(base.cardNumber)===String(card.cardNumber)&&fold(base.player)===fold(card.player));}
export function referenceIdentityMatches(row,card){
 const m=String(row.title||'').match(/^(.*?)\s*(?:\[([^\]]+)\])?\s*#([^\s]+)\s*$/),rule=card.parallelRule,number=String(card.cardNumber);
 if(!m||!referenceCardNames(card).some(name=>fold(m[1])===fold(name))||m[3]!==number)return false;
 if(!rule){
  if(!card.section||card.section==='Base')return !m[2]&&!row.run;
  // An alphanumeric Update number alone does not identify the Clear/image
  // variation. Those explicit base variations need a matching finish label.
  if(!m[2]&&/^base\b.*\b(?:variation|parallel)/i.test(card.section))return false;
  const stadium=row.consoleId==='baseball-cards-2024-topps-stadium-club'?{'Base Set Chrome Variation':'chrome','Base Cards Image Variations':'image variation','Base Cards Design Variations':'design variation','Base Cards Rookie Design Variations':'rookie design variation'}[card.section]:null;
  if(stadium)return finishName(m[2])===stadium&&!row.run;
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
export function matchReferenceImage(rows,set,card){const needsFinish=referenceNeedsFinish(set,card),matches=rows.filter(row=>safeReferenceImage(row.image)&&(!needsFinish||/\[[^\]]+\]\s*#/.test(row.title))&&referenceIdentityMatches(row,card));return matches.length===1?{...matches[0],source:'PriceCharting / SportsCardsPro',referenceOnly:true}:null;}
