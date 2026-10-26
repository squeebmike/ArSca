const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\b([a-z]) ([a-z])\b/g,'$1$2');
import {referenceCardNames} from './reference-card-aliases.mjs';
const finishName=s=>fold(s).replace(/^platinum toile /,'toile ').replace(/^bowman logo pattern$/,'logo pattern').replace(/ refractor$/,'');
export function safeReferenceImage(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='storage.googleapis.com'&&/^\/images\.pricecharting\.com\/[a-z0-9]+\/(?:60|240|300|400|1600)\.jpg$/.test(u.pathname)?u.href:null;}catch{return null;}}
export function referenceIdentityMatches(row,card){
 const m=String(row.title||'').match(/^(.*?)\s*(?:\[([^\]]+)\])?\s*#([^\s]+)\s*$/),rule=card.parallelRule,number=String(card.cardNumber);
 if(!m||!referenceCardNames(card).some(name=>fold(m[1])===fold(name))||m[3]!==number)return false;
 if(!rule){
  if(!card.section||card.section==='Base')return !m[2]&&!row.run;
  const section=fold(card.section).replace(/\b(?:base|cards?|variations?|parallels?)\b/g,' ').replace(/\s+/g,' ').trim();
  return m[2]?finishName(section)===finishName(m[2]):/[a-z]/i.test(number);
 }
 if(!m[2]||![rule.name,...(rule.aliases||[])].some(n=>finishName(n)===finishName(m[2])))return false;
 const denominator=String(row.run||'').match(/^\/(-?\d+)$/)?.[1];
 if(rule.numberingUnknown)return true;
 if(rule.printRun)return Number(denominator)===(rule.serialDenominator||rule.printRun);
 return !denominator;
}
export function matchReferenceImage(rows,set,card){const matches=rows.filter(row=>safeReferenceImage(row.image)&&referenceIdentityMatches(row,card));return matches.length===1?{...matches[0],source:'PriceCharting / SportsCardsPro',referenceOnly:true}:null;}
