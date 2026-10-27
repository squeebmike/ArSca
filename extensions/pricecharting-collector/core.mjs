export function sourceUrl(raw, base) {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'https:' || !/^(www\.)?(pricecharting|sportscardspro)\.com$/.test(u.hostname) || u.username || u.password) return '';
    u.pathname=u.pathname.replace(/'/g,'%27');
    if (!/^\/(?:console|game|category)\/(?:[a-z0-9/-]|%27)+\/?$/.test(u.pathname)) return '';
    u.hash = ''; u.search = '';
    if (u.pathname.startsWith('/console/')) { u.searchParams.set('exclude-variants', 'false'); u.searchParams.set('sort', 'model-number'); }
    return u.href;
  } catch { return ''; }
}
export function eligibleSet(url, licensedOnly = true) {
  let path;try{path=new URL(url).pathname.replace(/'/g,'%27');}catch{return false;}
  if (!licensedOnly || !/\/(?:console|game)\/(?:baseball|football)-cards-/.test(path)) return true;
  const year = Number(path.match(/-cards-(\d{4})-/)?.[1]);
  return year >= 2019 && (/-(topps|bowman(?:%27s)?)(?:-|\/|$)/.test(path)||/^\/(?:console|game)\/baseball-cards-\d{4}-stadium-club(?:-|\/|$)/.test(path));
}
export function queueVerifiedSources(job,raw,revisitCompleted=false){
 if(!job)throw Error('Connect to the existing collector job first.');
 const urls=[...new Set(String(raw||'').split(/\s+/).filter(Boolean).map(value=>{const url=sourceUrl(value);if(!url||!new URL(url).pathname.startsWith('/console/')||!eligibleSet(url,true))throw Error('Use verified licensed set URLs from the allowed source hosts.');return url;}))];
 if(!urls.length||urls.length>100)throw Error('Queue 1–100 verified set URLs.');
 const recovered=job.referenceRecoverySources||[],seen=new Set([...(revisitCompleted?recovered:[...(job.seen||[]),...(job.completed||[])]),...(job.queue||[]).map(item=>item.url)]),added=urls.filter(url=>!seen.has(url)).map(url=>({url,pages:0}));
 const queue=job.queue?.length?[job.queue[0],...newestSetQueue([...job.queue.slice(1),...added])]:newestSetQueue(added);
 return {...job,queue,seen:[...new Set([...(job.seen||[]),...urls])],...(revisitCompleted?{referenceRecoverySources:[...new Set([...recovered,...added.map(item=>item.url)])]}:{}),...(job.queue?.length?{}:{navigating:'',notBefore:0}),message:added.length+' verified sources appended; saved records and existing queue preserved.'};
}
export function recheckSourceDirectories(job){
 if(!job)throw Error('Start a collection before rechecking directories.');
 const seen=[...(job.seen||[])],queue=[...(job.queue||[])],queued=new Set(queue.map(q=>q.url));
 let roots=[...new Set(seen.map(u=>sourceUrl(u)).filter(u=>u&&new URL(u).pathname.startsWith('/category/')))];
 if(!roots.length)roots=['https://www.sportscardspro.com/category/baseball-cards','https://www.sportscardspro.com/category/football-cards'];
 const additions=roots.filter(u=>!queued.has(u)).map(url=>({url,pages:0}));
 // Keep the active source's page/signature/navigation position. Only the
 // pending tail is reordered; already saved cards and estimates are untouched.
 const next=queue.length?[queue[0],...newestSetQueue([...queue.slice(1),...additions])]:newestSetQueue(additions);
 return {...job,queue:next,seen:[...new Set([...seen,...roots])],discover:true,message:'Directory recheck queued; saved records and the existing queue are preserved.'};
}
export function queueEarlierPriceBackfill(job,sets){
 if(!job)throw Error('Start a collection before queuing a price backfill.');
 if(job.priceBackfill)return job;
 const urls=[...new Set((sets||[]).filter(s=>Number(s.cards)>0&&/^(?:baseball|football)-cards-202[56]-(?:topps|bowman)(?:-|$)/.test(s.consoleId||'')).map(s=>sourceUrl('https://www.sportscardspro.com/console/'+s.consoleId)).filter(u=>u&&eligibleSet(u,true)))];
 if(!urls.length)throw Error('No earlier 2025/2026 cloud sources were found.');
 return {...job,priceBackfill:{queue:newestSetQueue(urls.slice(0,500).map(url=>({url,pages:0}))),planned:Math.min(urls.length,500),active:false,complete:false},message:'Earlier price revisit queued after the current collection; existing progress is preserved.'};
}
// Sort by set year, then verified release date where available. The provider's
// New Releases list breaks ties before alphabetical fallback; import/write
// timestamps are never treated as release dates.
export function newestSetQueue(items){
  const year=item=>Number(item.url.match(/\/console\/[^/?]*?((?:19|20)\d{2})(?:-|\?|$)/)?.[1])||0;
  const verified={'baseball-cards-2026-topps-holiday':'2026-10-21','football-cards-2026-topps-heritage':'2026-10-21'};
  const date=item=>verified[new URL(item.url).pathname.split('/')[2]]||'';
  return [...items].sort((a,b)=>Number(b.url.includes('/category/'))-Number(a.url.includes('/category/'))||year(b)-year(a)||date(b).localeCompare(date(a))||(a.recentRank??99999)-(b.recentRank??99999)||a.url.localeCompare(b.url));
}
export function mergeCards(oldRows, newRows) {
  const rows = new Map(oldRows.map(row => [row.url, row]));
  for (const row of newRows) {
    if (!sourceUrl(row.url) || !row.title || !row.consoleId) continue;
    const old = rows.get(row.url);
    rows.set(row.url, {...old, ...row, image: row.image || old?.image || ''});
  }
  return [...rows.values()];
}
export function csv(rows) {
  const keys = ['consoleId','setName','productId','title','player','cardNumber','parallel','run','image','url','capturedAt'];
  const cell = value => '"' + String(value ?? '').replaceAll('"','""') + '"';
  return [keys.map(cell).join(','), ...rows.map(row => keys.map(key => cell(row[key])).join(','))].join('\r\n');
}
// Self-contained: Chrome serializes this function into the permitted source tab.
export async function inspectPage(advance = false) {
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const blocked = /just a moment|access denied|verify (?:that )?you are human|too many requests|captcha|unusual traffic/i.test(document.title + ' ' + (document.querySelector('h1')?.textContent || '')) || !!document.querySelector('iframe[src*="captcha"],#challenge-running');
  if (blocked) return {blocked: true, message: 'Source site requested a pause. Open the collector tab and review it.'};
  const safe = raw => { try { const u = new URL(raw, location.href);u.pathname=u.pathname.replace(/'/g,'%27'); return u.protocol === 'https:' && !u.username&&!u.password&&/^(www\.)?(pricecharting|sportscardspro)\.com$/.test(u.hostname) && /^\/(console|game|category)\/(?:[a-z0-9/-]|%27)+\/?$/.test(u.pathname) ? u.href : ''; } catch { return ''; } };
  const photo = img => {
    for (const raw of [img?.getAttribute('data-src'),img?.getAttribute('data-original'),img?.currentSrc,img?.src]) {
      if (/^https:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[a-z0-9]+\/(60|240|300|400|1600)\.jpg$/i.test(raw || '')) return raw.replace(/\/60\.jpg$/, '/240.jpg');
    }
    return '';
  };
  const title = clean(document.querySelector('h1')?.textContent || document.title);
  const rowNodes = () => [...document.querySelectorAll('tr[id^="product-"]')];
  const next = () => document.querySelector('form.js-next-page input[type="submit"],a[rel="next"]') || [...document.querySelectorAll('a,button,input[type="submit"]')].find(x => /^(more results\s*[»›]?|next\s*[»›]?)$/i.test(clean(x.value || x.textContent)));
  if (advance) {
    const control = next();
    if (!control) return {done: true};
    if(control.disabled)return {stalled:true,message:'Source pagination is still loading. Review the source tab, then resume.'};
    if (control.tagName === 'A' && !safe(control.href)) return {blocked:true,message:'Pagination left the allowed source.'};
    const before = rowNodes().map(x=>x.id).join(',');
    return await new Promise(resolve => {
      let timer;
      const observer = new MutationObserver(() => {
        const rows=rowNodes();
        if (rows.length && rows.map(x=>x.id).join(',') !== before) finish({advanced:true});
      });
      const finish = value => { clearTimeout(timer); observer.disconnect(); resolve(value); };
      observer.observe(document.body, {childList:true,subtree:true});
      // The provider removes the More form while fetching the next batch.
      // Its temporary absence is not the end of the set. Wait for real rows
      // or the bounded timeout before deciding whether pagination is done.
      timer = setTimeout(() => finish({stalled:true,message:'More results did not add cards. Resume after reviewing the source tab.'}), 15000);
      control.click();
    });
  }
  const cards = [];
  // Use the visible column labels, not generic price-class names that mean
  // different conditions for games, comics and cards. Unknown currency is held.
  const currency=clean(document.querySelector('#currency_selector')?.textContent).match(/^([A-Z]{3})\b/)?.[1];
  const headers=[...document.querySelectorAll('#games_table th')].map(th=>clean(th.textContent));
  const priceFields={'Ungraded':'ungraded','Grade 9':'grade9','PSA 10':'psa10'};
  const pricesFor=row=>{
    if(currency!=='USD')return null;
    const cells=[...row.querySelectorAll('td')],prices={currency:'USD'};
    headers.forEach((label,i)=>{const field=priceFields[label],value=clean(cells[i]?.textContent);if(!field||!/^\$?\s*\d[\d,]*(?:\.\d{1,2})?$/.test(value))return;const amount=Number(value.replace(/[$,\s]/g,''));if(Number.isFinite(amount)&&amount>0&&amount<=100000000)prices[field]=amount;});
    return Object.keys(prices).length>1?prices:null;
  };
  for (const row of rowNodes()) {
    const a = row.querySelector('td.title a[href*="/game/"]');
    const url = safe(a?.href); if (!url) continue;
    const name = clean(a.textContent), match = name.match(/#([a-z0-9][a-z0-9.-]*)\b/i);
    cards.push({consoleId:new URL(url).pathname.split('/')[2],setName:title.replace(/^(Cheapest|Most Expensive)\s+/i,''),productId:row.getAttribute('data-product') || row.id.replace('product-',''),title:name,player:clean(name.replace(/\[[^\]]+\]/g,'').replace(/#.*$/,'')),cardNumber:match?.[1] || '',parallel:(name.match(/\[([^\]]+)\]/)?.[1] || ''),run:clean(row.querySelector('.list-print-run')?.textContent),image:photo(row.querySelector('td.image img')),url,capturedAt:new Date().toISOString()});
    const prices=pricesFor(row);if(prices)cards[cards.length-1].referencePrices=prices;
  }
  if (!cards.length && location.pathname.startsWith('/game/')) {
    const img = document.querySelector('#product_details img, #product-image img, img[itemprop="image"]');
    const og = document.querySelector('meta[property="og:image"]')?.content;
    const number = title.match(/#([a-z0-9][a-z0-9.-]*)\b/i)?.[1] || '';
    cards.push({consoleId:location.pathname.split('/')[2].replace(/'/g,'%27'),setName:'',productId:'',title,player:clean(title.replace(/\[[^\]]+\]/g,'').replace(/#.*$/,'')),cardNumber:number,parallel:title.match(/\[([^\]]+)\]/)?.[1] || '',run:clean(document.querySelector('.list-print-run')?.textContent),image:photo(img) || photo({src:og}),url:safe(location.href),capturedAt:new Date().toISOString()});
  }
  const sets = [...new Set([...document.querySelectorAll('a[href*="/console/"]')].map(a=>safe(a.href)).filter(Boolean))];
  const recentSets=[];
  for(const heading of document.querySelectorAll('h2,h3'))if(/new releases/i.test(heading.textContent)){
    for(let node=heading.nextElementSibling;node&&!/^H[1-3]$/.test(node.tagName);node=node.nextElementSibling){for(const a of node.querySelectorAll('a[href*="/console/"]')){const url=safe(a.href);if(url&&!recentSets.includes(url))recentSets.push(url);}}
  }
  return {url:location.href,title,cards,sets,recentSets,hasNext:!!next(),signature:cards.map(x=>x.url).join('|')};
}
