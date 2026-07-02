(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ArsCaComicIssueHub=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const ALIASES={tmnt:'Teenage Mutant Ninja Turtles',asm:'Amazing Spider-Man',spiderman:'Spider-Man','spider-man':'Spider-Man',xmen:'X-Men','x-men':'X-Men',uxm:'Uncanny X-Men',ff:'Fantastic Four',tec:'Detective Comics',detective:'Detective Comics'};
  const PUBLISHERS=['Mirage','IDW','Marvel','DC','Image','Boom','Dynamite','Dark Horse','Archie','Valiant','Oni','Skybound'];
  const VARIANTS=[['retailer exclusive',/\bretailer(?:\s+exclusive)?\b/i],['second print',/\b(?:second|2nd)\s+print(?:ing)?\b/i],['facsimile',/\bfacsimile\b/i],['newsstand',/\bnewsstand\b/i],['direct',/\bdirect\b/i],['virgin',/\bvirgin\b/i],['foil',/\bfoil\b/i],['ratio',/\b(?:ratio|1:\d+)\b/i],['reprint',/\breprint\b/i],['exclusive',/\bexclusive\b/i],['sketch',/\bsketch\b/i],['signed',/\bsigned\b/i],['cover a',/\bcover\s+a\b/i],['cover b',/\bcover\s+b\b/i],['cover c',/\bcover\s+c\b/i]];
  const clean=s=>String(s||'').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();
  const norm=s=>clean(s).toLowerCase().replace(/[^a-z0-9:#.\-\s]/g,' ').replace(/\s+/g,' ').trim();
  function parseComicQuery(raw){
    const original=clean(raw),normalized=norm(original);
    const aliasToken=normalized.split(' ').find(t=>ALIASES[t]);
    const alias=ALIASES[aliasToken];
    const expanded=alias?clean(normalized.split(' ').map(t=>t===aliasToken?alias:t).join(' ')):original;
    const explicit=normalized.match(/(?:#|\bissue\s+|\bnumber\s+|\bno\.?\s*)(\d+(?:\.\d+)?[a-z]?)/i);
    const nums=[...normalized.matchAll(/\b(\d+(?:\.\d+)?[a-z]?)\b/gi)].map(m=>m[1]);
    const issueNumber=(explicit&&explicit[1])||[...nums].reverse().find(n=>!(Number(n)>=1900&&Number(n)<=2100))||'';
    const year=(nums.find(n=>Number(n)>=1900&&Number(n)<=2100)||'');
    const publisher=PUBLISHERS.find(p=>new RegExp('\\b'+p.replace(/\s/g,'\\s+')+'\\b','i').test(original))||'';
    const variantTerms=VARIANTS.filter(([,re])=>re.test(original)).map(([label])=>label);
    let series=norm(expanded)
      .replace(/(?:#|\bissue\s+|\bnumber\s+|\bno\.?\s*)?\d+(?:\.\d+)?[a-z]?\b/gi,' ')
      .replace(new RegExp('\\b(?:'+PUBLISHERS.join('|')+')\\b','gi'),' ');
    VARIANTS.forEach(([,re])=>{series=series.replace(re,' ');});
    series=clean(series).replace(/\bcomics?\b$/i,'').trim();
    const titleCase=series.replace(/\b\w/g,c=>c.toUpperCase()).replace(/\bIdw\b/g,'IDW').replace(/\bDc\b/g,'DC');
    const runGuess=[publisher,year].filter(Boolean).join(' ')||(normalized.match(/\b(?:saturday morning adventures|last ronin)\b/i)?.[0]||'');
    const confidence=Math.min(100,(titleCase?45:0)+(issueNumber?35:0)+(publisher||year?10:0)+(variantTerms.length?10:0));
    return {raw:original,normalized,seriesGuess:titleCase,issueNumber,publisherGuess:publisher,runGuess:clean(runGuess),yearGuess:year,variantTerms,aliasesExpanded:alias?[expanded]:[],confidence};
  }
  function variantLabels(name){return VARIANTS.filter(([,re])=>re.test(name||'')).map(([label])=>label);}
  function issueFromName(name){return parseComicQuery(name).issueNumber;}
  function scoreCandidate(candidate,context={}){
    const name=clean(candidate.productName||candidate.name),hay=norm(name+' '+(candidate.consoleName||''));
    const title=norm(context.seriesTitle||context.seriesGuess||''),issue=String(context.currentIssueNumber??context.issueNumber??'');
    let score=0;const reasons=[];
    const tokens=title.split(' ').filter(x=>x.length>2);const hit=tokens.filter(t=>hay.includes(t)).length;
    if(tokens.length){score+=Math.round(45*hit/tokens.length);if(hit)reasons.push('series title');}
    if(issue&&issueFromName(name)===issue){score+=30;reasons.push('issue #'+issue);}
    const publisher=norm(context.publisher||context.publisherGuess||'');if(publisher&&hay.includes(publisher)){score+=15;reasons.push('selected run');}
    const year=String(context.yearGuess||'');if(year&&hay.includes(year)){score+=6;reasons.push(year);}
    const wanted=context.variantTerms||[];if(wanted.some(v=>hay.includes(norm(v)))){score+=8;reasons.push('variant terms');}
    if(/omnibus|hardcover|trade paperback|volume set/i.test(name)){score-=35;reasons.push('collected edition penalty');}
    if(issue&&issueFromName(name)&&issueFromName(name)!==issue){score-=45;reasons.push('different issue');}
    return {score:Math.max(0,Math.min(100,score)),reasons};
  }
  function detectRun(candidate,parsed={}){
    const text=clean((candidate.productName||candidate.name||'')+' '+(candidate.consoleName||''));
    const publisher=PUBLISHERS.find(p=>new RegExp('\\b'+p+'\\b','i').test(text))||parsed.publisherGuess||'';
    const special=text.match(/\b(Saturday Morning Adventures|The Last Ronin|Last Ronin)\b/i)?.[1]||'';
    const year=String(candidate.releaseDate||candidate.year||'').match(/\b(19|20)\d{2}\b/)?.[0]||parsed.yearGuess||'';
    return {publisher,year,runLabel:special||(publisher?publisher+' run':year?year+' run':'Unsorted / Needs Review')};
  }
  function groupCandidates(candidates,parsed){
    const groups=new Map();
    (candidates||[]).forEach(c=>{const run=detectRun(c,parsed),key=norm(run.runLabel+'|'+run.year);if(!groups.has(key))groups.set(key,{seriesTitle:parsed.seriesGuess||clean(c.productName),publisher:run.publisher,runLabel:run.runLabel,yearGuess:run.year,issueNumber:parsed.issueNumber,candidateCount:0,topCoverImageUrl:'',priceRangeRaw:{min:null,max:null},priceRange98:{min:null,max:null},confidence:0,examples:[],candidates:[]});const g=groups.get(key),sc=scoreCandidate(c,{...parsed,seriesTitle:parsed.seriesGuess,currentIssueNumber:parsed.issueNumber,publisher:run.publisher});g.candidates.push({...c,hubScore:sc.score,matchReason:sc.reasons});g.candidateCount++;g.confidence=Math.max(g.confidence,sc.score);g.topCoverImageUrl ||= c.imageUrl||'';g.examples.push(clean(c.productName||c.name));[['priceRangeRaw',c.comicPrices?.ungraded??c.prices?.ungraded],['priceRange98',c.comicPrices?.grade9_8]].forEach(([k,v])=>{v=Number(v);if(v>0){g[k].min=g[k].min===null?v:Math.min(g[k].min,v);g[k].max=g[k].max===null?v:Math.max(g[k].max,v);}});});
    return [...groups.values()].sort((a,b)=>b.confidence-a.confidence||b.candidateCount-a.candidateCount);
  }
  function buildSweepQueries(context={},broad=false){
    const series=clean(context.seriesTitle||context.seriesGuess),issue=String(context.currentIssueNumber??context.issueNumber??''),publisher=clean(context.publisher||context.publisherGuess),year=clean(context.yearGuess),alias=Object.entries(ALIASES).find(([,v])=>norm(v)===norm(series))?.[0]?.toUpperCase();
    const qualifier=publisher||year;
    const base=[context.originalQuery&&(!qualifier||norm(context.originalQuery).includes(norm(qualifier)))?context.originalQuery:'',`${series} ${issue} ${publisher}`,`${series} #${issue} ${publisher}`,year&&`${series} ${year} #${issue}`,alias&&`${alias} ${publisher||year} #${issue}`,`${series} ${issue} ${qualifier} variant`,`${series} ${issue} ${qualifier} cover`];
    if(broad)base.push(`${series} ${issue} ${qualifier} virgin`,`${series} ${issue} ${qualifier} retailer exclusive`,`${series} ${issue} ${qualifier} ratio`,`${series} ${issue} ${qualifier} foil`,`${series} ${issue} ${qualifier} second print`,`${series} ${issue} ${qualifier} facsimile`);
    return [...new Set(base.map(clean).filter(q=>q&&series&&issue))].slice(0,broad?10:6);
  }
  function canNavigate(issue){return /^\d+$/.test(String(issue));}
  function adjacentIssue(issue,delta){if(!canNavigate(issue))return null;return Math.max(0,Number(issue)+Number(delta));}
  function hubKey(c){return norm([c.seriesTitle,c.publisher,c.runLabel,c.yearGuess,c.currentIssueNumber??c.issueNumber].join('|'));}
  return {ALIASES,parseComicQuery,variantLabels,scoreCandidate,groupCandidates,buildSweepQueries,canNavigate,adjacentIssue,hubKey};
});
