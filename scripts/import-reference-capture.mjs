// Local reviewed import only. This command never contacts Supabase or a provider.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {baseballSets} from './topps/baseball-seed.mjs';
import {footballSets} from './topps/football-seed.mjs';
import {sectionsForSet} from './baseball-section-pages.mjs';
import {cardParallelProgram,selectedParallelCard} from './sports-parallels.mjs';
import {safeReferenceImage,matchReferenceImage} from './sports-reference-images.mjs';
import {referenceImageSeeds} from './topps/reference-image-seeds.mjs';
const slug=s=>String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export function reviewCapture(capture,set){
  if(capture?.schema!==1||!Array.isArray(capture.cards)||capture.cards.length>200000)throw Error('Expected a collector schema 1 export (up to 200,000 rows).');
  const consoleId=(set.sport==='football'?'football':'baseball')+'-cards-'+slug(set.displayName.replace(/\b(baseball|football)\b/gi,''));
  // The public directory names flagship Series 1 "YEAR Topps" (verified
  // 2019–2026). Individual checklist identity still filters Series 2 cards.
  const allowedConsoles=new Set([consoleId]);
  if(set.sport!=='football'&&/topps.*series 1/i.test(set.displayName)&&set.year>=2019&&set.year<=2026)allowedConsoles.add('baseball-cards-'+set.year+'-topps');
  const report={setId:set.id,consoleId,total:capture.cards.length,accepted:[],failures:[]},rows=[];
  for(const row of capture.cards){
    let url;try{url=new URL(row.url);}catch{}
    const reason=!url||url.protocol!=='https:'||url.username||url.password||!['www.pricecharting.com','www.sportscardspro.com','pricecharting.com','sportscardspro.com'].includes(url.hostname)||!allowedConsoles.has(url.pathname.split('/')[2])||!/^\/game\/[^/]+\/[^/]+$/.test(url.pathname)?'Different set or invalid source URL':!safeReferenceImage(row.image)?'Missing or invalid reference photo':!row.title||row.title.length>500?'Invalid title':'';
    if(reason){report.failures.push({url:row.url,title:row.title,reason});continue;}
    rows.push({title:row.title,image:row.image,url:url.href,run:String(row.run||'').trim()});
  }
  const unique=[...new Map(rows.map(r=>[r.url,r])).values()];
  const candidates=[...(set.cards||[]),...sectionsForSet(set).flatMap(g=>g.cards)];
  const byNumber=new Map();
  for(const card of candidates){const key=String(card.cardNumber);if(!byNumber.has(key))byNumber.set(key,[]);byNumber.get(key).push(card);}
  for(const row of unique){
    const number=row.title.match(/#([^\s]+)\s*$/)?.[1];let exact=false;
    for(const card of byNumber.get(number)||[]){
      const possibilities=[card,...cardParallelProgram(set,card).variants.map(rule=>selectedParallelCard(set,card,rule.id))];
      if(possibilities.some(c=>matchReferenceImage(unique,set,c)?.url===row.url)){exact=true;break;}
    }
    // The same source picture for different finishes of one card needs review.
    const family=row.title.replace(/\[[^\]]+\]/g,'').replace(/\s+/g,' ').trim();
    const shared=unique.some(other=>other.url!==row.url&&other.image===row.image&&other.title.replace(/\[[^\]]+\]/g,'').replace(/\s+/g,' ').trim()===family&&other.title!==row.title);
    if(exact&&!shared)report.accepted.push(row);
    else report.failures.push({url:row.url,title:row.title,reason:shared?'Photo reused across finishes; review exact printing':'No unique exact checklist / finish / print-run match'});
  }
  return report;
}
async function main(){
  const args=process.argv.slice(2),file=args.find(x=>!x.startsWith('--')),setId=args.find(x=>x.startsWith('--set='))?.slice(6);
  const set=[...baseballSets,...footballSets].find(s=>s.id===setId);
  if(!file||!set)throw Error('Usage: node scripts/import-reference-capture.mjs capture.json --set=SET-ID [--write]');
  const stat=await fs.stat(file);if(stat.size>80000000)throw Error('Capture exceeds 80 MB. Export one set at a time.');
  const report=reviewCapture(JSON.parse(await fs.readFile(file,'utf8')),set);
  await fs.writeFile(file+'.review.json',JSON.stringify(report,null,2)+'\n');
  if(args.includes('--write')){
    if(!report.accepted.length)throw Error('No verified images to import. Read the review report.');
    const seeds={...referenceImageSeeds,[set.id]:[...new Map([...(referenceImageSeeds[set.id]||[]),...report.accepted].map(r=>[r.url,r])).values()]};
    await fs.writeFile(new URL('./topps/reference-image-seeds.mjs',import.meta.url),'// Reviewed card identities and reference image links. No price data.\nexport const referenceImageSeeds='+JSON.stringify(seeds,null,2)+';\n');
  }
  console.log(JSON.stringify({setId:set.id,accepted:report.accepted.length,needsReview:report.failures.length,report:file+'.review.json',written:args.includes('--write')}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
