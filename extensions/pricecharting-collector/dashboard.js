import {sourceUrl,csv} from './core.mjs';
const $=id=>document.getElementById(id);let all=[],filtered=[],limit=100,stopDownloads=false,opened=false,refreshVersion=0;
const send=async type=>{const response=await chrome.runtime.sendMessage({type,urls:$('urls').value,discover:$('discover').checked,licensedOnly:$('licensed').checked});if(response?.error)throw new Error(response.error);};
const report=error=>{$('status').textContent=error.message;};
for(const [id,type]of [['start','start'],['pause','pause'],['resume','resume'],['source','open-source']])$(id).onclick=()=>send(type).catch(report);
for(const sport of ['baseball','football'])$(sport).onclick=()=>{$('urls').value='https://www.sportscardspro.com/category/'+sport+'-cards';$('discover').checked=true;send('start').catch(report);};
$('current').onclick=async()=>{const tabs=await chrome.tabs.query({lastFocusedWindow:true});const source=tabs.filter(x=>sourceUrl(x.url)).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];if(source)$('urls').value=source.url;else report(new Error('Open a PriceCharting or SportsCardsPro set/category tab first.'));};
function render(){
  const query=$('search').value.toLowerCase(),set=$('sets').value,kind=$('kind').value;
  filtered=all.filter(x=>(!set||x.consoleId===set)&&(!query||[x.title,x.cardNumber,x.parallel].join(' ').toLowerCase().includes(query))&&(kind==='all'||kind==='missing'&&!x.image||kind==='base'&&!x.parallel||kind==='parallel'&&x.parallel));
  $('cards').replaceChildren();
  for(const row of filtered.slice(0,limit)){
    const article=document.createElement('article');article.className='card';
    if(row.image){const img=document.createElement('img');img.src=row.image;img.alt=row.title;img.loading='lazy';img.referrerPolicy='no-referrer';article.append(img);}else{const p=document.createElement('p');p.className='missing';p.textContent='No source photo';article.append(p);}
    const h=document.createElement('h3');h.textContent=row.title;article.append(h);
    const p=document.createElement('p');p.className='badge';p.textContent=[row.parallel||'Base / unspecified finish',row.run].filter(Boolean).join(' · ');article.append(p);
    const a=document.createElement('a');a.textContent='Review source';a.href=row.url;a.target='_blank';a.rel='noopener noreferrer';article.append(a);$('cards').append(article);
  }
  $('more').hidden=filtered.length<=limit;$('images').textContent=`Download ${filtered.filter(x=>x.image).length} matching photos`;
}
async function refresh(){
  const version=++refreshVersion,job=(await chrome.storage.local.get('job')).job;
  if(version!==refreshVersion)return;
  const selected=$('sets').value;$('sets').replaceChildren(new Option('All saved sets',''));
  const ids=Object.keys(job?.sets||{}).sort();for(const id of ids)$('sets').add(new Option(`${job.sets[id].name||id} (${job.sets[id].cards})`,id));$('sets').value=!opened&&ids.length?ids[0]:ids.includes(selected)?selected:'';
  // Normal progress updates read one set shard, never the entire photo catalog.
  // All-set review/export is still available when deliberately selected.
  const key=$('sets').value,keys=key?['set:'+key]:ids.map(id=>'set:'+id),state=await chrome.storage.local.get(keys);
  if(version!==refreshVersion)return;
  opened=!!ids.length;all=Object.values(state).flat();
  const totals=Object.values(job?.sets||{}).reduce((n,s)=>({cards:n.cards+s.cards,photos:n.photos+s.photos}),{cards:0,photos:0});
  $('counts').textContent=`${ids.length} sets · ${totals.cards} cards · ${totals.photos} photos · ${totals.cards-totals.photos} missing photos`;
  if(job){$('status').textContent=job.message;const done=job.completed.length,total=done+job.queue.length;$('progress').max=total||1;$('progress').value=done;$('start').disabled=job.running;$('resume').disabled=job.running||!job.queue.length;}
  render();
}
$('sets').oninput=()=>{limit=100;void refresh().catch(report);};for(const id of ['search','kind'])$(id).oninput=()=>{limit=100;render();};$('more').onclick=()=>{limit+=100;render();};
async function exportFile(kind){const body=kind==='json'?JSON.stringify({schema:1,source:'mana-pocket-card-collector',exportedAt:new Date().toISOString(),cards:filtered},null,2):csv(filtered);const url=URL.createObjectURL(new Blob([body],{type:kind==='json'?'application/json':'text/csv'}));try{await chrome.downloads.download({url,filename:`mana-pocket-cards-${new Date().toISOString().slice(0,10)}.${kind}`,saveAs:true});}finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}}
$('json').onclick=()=>exportFile('json').catch(report);$('csv').onclick=()=>exportFile('csv').catch(report);
const filename=s=>String(s).replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,110)||'card';
$('stop-images').onclick=()=>{stopDownloads=true;};
$('images').onclick=async()=>{
  stopDownloads=false;$('images').disabled=true;let done=0,failed=0;
  const rows=[...new Map(filtered.filter(x=>x.image).map(x=>[x.url,x])).values()];
  try{for(const row of rows){if(stopDownloads)break;try{
    const id=await chrome.downloads.download({url:row.image,filename:`Mana-Pocket-Cards/${filename(row.consoleId)}/${filename(row.productId+'-'+row.title)}.jpg`,conflictAction:'uniquify',saveAs:false});
    await new Promise(resolve=>{let timer;const listener=delta=>{if(delta.id===id&&['complete','interrupted'].includes(delta.state?.current)){clearTimeout(timer);chrome.downloads.onChanged.removeListener(listener);if(delta.state.current==='interrupted')failed++;resolve();}};chrome.downloads.onChanged.addListener(listener);timer=setTimeout(()=>{chrome.downloads.onChanged.removeListener(listener);resolve();},30000);});
    done++;
  }catch{failed++;} $('download-status').textContent=`Photos: ${done}/${rows.length} processed; ${failed} failed. Keep this review tab open while downloading.`;}
  }finally{$('images').disabled=false;$('download-status').textContent+=stopDownloads?' Stopped.':' Finished.';}
};
let refreshTimer;chrome.storage.onChanged.addListener(()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{void refresh().catch(report);},250);});void refresh().catch(report);
