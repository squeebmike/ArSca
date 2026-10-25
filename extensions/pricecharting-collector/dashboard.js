import {sourceUrl} from './core.mjs';
const $=id=>document.getElementById(id);let rows=[],sets=[],cursor=null,loadedSet='',refreshing=false,catalogLoaded=false;
const report=error=>{$('status').textContent=error.message;};
async function message(type,extra={}){const response=await chrome.runtime.sendMessage({type,...extra});if(response?.error)throw Error(response.error);return response;}
for(const [id,type]of [['start','start'],['pause','pause'],['resume','resume'],['source','open-source']])$(id).onclick=()=>message(type,{urls:$('urls').value,discover:$('discover').checked,licensedOnly:$('licensed').checked}).catch(report);
for(const sport of ['baseball','football'])$(sport).onclick=()=>{$('urls').value='https://www.sportscardspro.com/category/'+sport+'-cards';$('discover').checked=true;$('start').click();};
$('current').onclick=async()=>{const tabs=await chrome.tabs.query({lastFocusedWindow:true});const tab=tabs.filter(t=>sourceUrl(t.url)).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];if(tab)$('urls').value=tab.url;else report(Error('Open a source set or set directory first.'));};
$('connect').onclick=async()=>{try{await message('connect-cloud');$('connection').textContent='Connected through your signed-in dashboard. No login token is copied into the extension.';await loadSets(true);}catch(error){$('connection').textContent=error.message;}};
$('sync-earlier').onclick=async()=>{try{$('sync-earlier').disabled=true;const data=await message('sync-earlier');$('status').textContent=data.message;await loadSets(true);}catch(error){report(error);}finally{$('sync-earlier').disabled=false;}};
function render(){
 const query=$('search').value.toLowerCase(),kind=$('kind').value;
 const filtered=rows.filter(x=>(!query||[x.title,x.cardNumber,x.parallel].join(' ').toLowerCase().includes(query))&&(kind==='all'||kind==='base'&&!x.parallel||kind==='parallel'&&x.parallel||kind==='missing'&&!x.image));
 $('cards').replaceChildren();
 for(const row of filtered){
  const article=document.createElement('article');article.className='card';
  if(row.image){const img=document.createElement('img');img.src=row.image;img.alt=row.title;img.loading='lazy';img.referrerPolicy='no-referrer';article.append(img);}else{const p=document.createElement('p');p.className='missing';p.textContent='No source photo';article.append(p);}
  const h=document.createElement('h3');h.textContent=row.title;article.append(h);
  const p=document.createElement('p');p.className='badge';p.textContent=[row.parallel||'Base / unspecified finish',row.run].filter(Boolean).join(' · ');article.append(p);
  const a=document.createElement('a');a.textContent='Review source';a.href=row.url;a.target='_blank';a.rel='noopener noreferrer';article.append(a);$('cards').append(article);
 }
 $('loaded').textContent=rows.length+' cards loaded from cloud; '+filtered.length+' match these filters.';$('more').hidden=!cursor;
}
async function loadCards(append=false){
 const id=$('sets').value;if(!id){rows=[];cursor=null;render();return;}
 const data=await message('cloud-cards',{console:id,cursor:append?cursor:''});
 if($('sets').value!==id)return;
 rows=append?[...rows,...data.cards]:data.cards;cursor=data.cursor;loadedSet=id;render();
}
async function loadSets(reloadCards=false){
 const data=await message('cloud-sets');sets=data.sets||[];catalogLoaded=true;showSets();
 if(reloadCards||loadedSet!==$('sets').value)await loadCards();
}
function showSets(){
 const selected=$('sets').value;
 $('sets').replaceChildren(new Option('Select a cloud set',''));for(const set of sets)$('sets').add(new Option(set.name+' ('+set.cards+')',set.consoleId));
 $('sets').value=sets.some(s=>s.consoleId===selected)?selected:sets[0]?.consoleId||'';
 const totals=sets.reduce((n,s)=>({cards:n.cards+s.cards,photos:n.photos+s.photos}),{cards:0,photos:0});
 $('counts').textContent='Cloud: '+sets.length+' sets · '+totals.cards+' cards · '+totals.photos+' photo URLs · '+(totals.cards-totals.photos)+' missing photos';
}
async function refresh(){
 if(refreshing)return;refreshing=true;
 try{const {job,cloudConnection,pendingCloudBatch}=await chrome.storage.local.get(['job','cloudConnection','pendingCloudBatch']);
  if(job){$('status').textContent=job.message;const done=job.completed.length;$('progress').max=done+job.queue.length||1;$('progress').value=done;$('start').disabled=job.running;$('resume').disabled=job.running||!job.queue.length;}
  if(pendingCloudBatch?.length)$('connection').textContent=pendingCloudBatch.length+' card references await cloud acknowledgement. Resume retries safely.';
  if(cloudConnection&&!catalogLoaded)await loadSets();
  else if(job?.sets){
   const summaries=new Map(sets.map(s=>[s.consoleId,s]));
   for(const [id,s]of Object.entries(job.sets)){const old=summaries.get(id);if(!old||(s.updatedAt||0)>=(old.updatedAt||0))summaries.set(id,{...s,consoleId:id});}
   sets=[...summaries.values()];showSets();
  }
 }catch(error){$('connection').textContent=error.message;}finally{refreshing=false;}
}
$('sets').oninput=()=>{void loadCards().catch(report);};for(const id of ['search','kind'])$(id).oninput=render;
$('more').onclick=async()=>{try{$('more').disabled=true;await loadCards(true);}catch(error){report(error);}finally{$('more').disabled=false;}};
let timer;chrome.storage.onChanged.addListener(changes=>{if(!changes.job&&!changes.pendingCloudBatch&&!changes.cloudConnection)return;clearTimeout(timer);timer=setTimeout(()=>{void refresh();},500);});void refresh();
