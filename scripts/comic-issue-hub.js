(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ArsCaComicIssueHub=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const ALIASES={tmnt:'Teenage Mutant Ninja Turtles',asm:'Amazing Spider-Man',spiderman:'Spider-Man','spider-man':'Spider-Man',xmen:'X-Men','x-men':'X-Men',uxm:'Uncanny X-Men',ff:'Fantastic Four',tec:'Detective Comics',detective:'Detective Comics'};
  const PUBLISHERS=['Mirage','IDW','Marvel','DC','Image','Boom','Dynamite','Dark Horse','Archie','Valiant','Oni','Skybound'];
  const VARIANTS=[['retailer exclusive',/\bretailer(?:\s+exclusive)?\b/i],['second print',/\b(?:second|2nd)\s+print(?:ing)?\b/i],['facsimile',/\bfacsimile\b/i],['newsstand',/\bnewsstand\b/i],['direct',/\bdirect\b/i],['virgin',/\bvirgin\b/i],['foil',/\b(?:foil|holofoil|metallic\s+foil)\b/i],['ratio',/\b(?:ratio|1:\d+)\b/i],['incentive',/\bincentive\b/i],['reprint',/\breprint\b/i],['exclusive',/\bexclusive\b/i],['sketch',/\bsketch\b/i],['signed',/\bsigned\b/i],['variant',/\bvariant\b/i]];
  const clean=s=>String(s||'').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();
  const norm=s=>clean(s).toLowerCase().replace(/[^a-z0-9:#.\-\s]/g,' ').replace(/\s+/g,' ').trim();
  function parseComicQuery(raw){
    const original=clean(raw),normalized=norm(original);
    const creatorMatch=original.match(/^\s*(?:creator|artist|writer|cover\s+artist)\s*:\s*(.+)$/i)||original.match(/^\s*(?:creator|artist|writer|cover\s+artist)\s+(.+)$/i);
    const creatorGuess=clean(creatorMatch?.[1]||'');
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
    return {raw:original,normalized,seriesGuess:creatorGuess?'':titleCase,issueNumber:creatorGuess?'':issueNumber,publisherGuess:publisher,runGuess:clean(runGuess),yearGuess:year,variantTerms,aliasesExpanded:alias?[expanded]:[],aliasKey:aliasToken||'',creatorGuess,confidence:creatorGuess?75:confidence};
  }
  function preferenceKeys(parsed={}){
    return [...new Set([parsed.aliasKey,parsed.seriesGuess,parsed.raw].map(norm).filter(Boolean))];
  }
  function pickSeriesPreference(preferences={},parsed={}){
    const entries=Array.isArray(preferences)?preferences:Object.values(preferences||{});
    const keys=preferenceKeys(parsed);
    return entries.filter(Boolean).sort((a,b)=>String(b.lastUsedAt||'').localeCompare(String(a.lastUsedAt||''))).find(pref=>{
      const prefKeys=[...(pref.aliases||[]),pref.aliasKey,pref.seriesName].map(norm).filter(Boolean);
      return keys.some(key=>prefKeys.includes(key));
    })||null;
  }
  function variantLabels(name){const text=String(name||''),labels=VARIANTS.filter(([,re])=>re.test(text)).map(([label])=>label),cover=text.match(/\bcover\s+([a-z])\b/i);if(cover)labels.unshift('cover '+cover[1].toUpperCase());return [...new Set(labels)];}
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
    // Series-title word overlap alone lets a totally different book through
    // with a deceptively high score -- "Superman vs. The Amazing Spider-Man
    // #1 (1976)" and "The Official Marvel Index to the Amazing Spider-Man #1
    // (1985)" both hit every title token and the right issue number against
    // a 2018 run, scoring 75% with nothing to tell them apart from the real
    // 2018 #1. A comic's own cover-printed year rarely drifts far from its
    // run's start year for an early issue, so a big gap is strong evidence
    // of a different printing/crossover/reference book entirely.
    const candidateYear=name.match(/\b(19|20)\d{2}\b/)?.[0]||'';
    if(year&&candidateYear&&Math.abs(Number(candidateYear)-Number(year))>3){score-=50;reasons.push('wrong era');}
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
    return [...groups.values()].sort((a,b)=>{
      const ay=Number(a.yearGuess)||9999,by=Number(b.yearGuess)||9999;
      return ay-by||b.confidence-a.confidence||b.candidateCount-a.candidateCount;
    });
  }
  function buildSweepQueries(context={},broad=false){
    const series=clean(context.seriesTitle||context.seriesGuess),issue=String(context.currentIssueNumber??context.issueNumber??''),publisher=clean(context.publisher||context.publisherGuess),year=clean(context.yearGuess),alias=Object.entries(ALIASES).find(([,v])=>norm(v)===norm(series))?.[0]?.toUpperCase();
    const qualifier=publisher||year;
    const base=[context.originalQuery&&(!qualifier||norm(context.originalQuery).includes(norm(qualifier)))?context.originalQuery:'',`${series} ${issue} ${publisher}`,`${series} #${issue} ${publisher}`,year&&`${series} ${year} #${issue}`,alias&&`${alias} ${publisher||year} #${issue}`,`${series} ${issue} ${qualifier} variant`,`${series} ${issue} ${qualifier} foil`,`${series} ${issue} ${qualifier} cover`];
    // A book with a heavy variant-cover run (retailer exclusives, ratios,
    // sketch/signed editions, etc.) needs one search angle per variant type --
    // generic "variant/foil/cover" terms alone won't surface a "Jetpack
    // Comics Exclusive" or "1:25 Ratio" edition. Reuse the same variant
    // vocabulary the filter dropdown already classifies covers by, instead of
    // a separate, shorter hardcoded list that silently missed most of it.
    if(broad){
      const seen=new Set(base.map(norm));
      VARIANTS.forEach(([label])=>{
        const q=`${series} ${issue} ${qualifier} ${label}`;
        if(!seen.has(norm(q))){ seen.add(norm(q)); base.push(q); }
      });
    }
    return [...new Set(base.map(clean).filter(q=>q&&series&&issue))].slice(0,broad?24:8);
  }
  function canNavigate(issue){return /^\d+$/.test(String(issue));}
  function adjacentIssue(issue,delta){if(!canNavigate(issue))return null;return Math.max(0,Number(issue)+Number(delta));}
  function hubKey(c){return norm([c.seriesTitle,c.publisher,c.runLabel,c.yearGuess,c.currentIssueNumber??c.issueNumber].join('|'));}
  return {ALIASES,parseComicQuery,preferenceKeys,pickSeriesPreference,variantLabels,scoreCandidate,groupCandidates,buildSweepQueries,canNavigate,adjacentIssue,hubKey};
});
