import {sourceUrl,eligibleSet,mergeCards,inspectPage} from './core.mjs';
let pumping;
const read = async () => (await chrome.storage.local.get('job')).job;
const save = job => chrome.storage.local.set({job});
const nap = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function schedule(){await chrome.alarms.create('collector-resume',{periodInMinutes:0.5});}
async function capture(job, data) {
  const grouped = new Map();
  for(const row of data.cards || []) {if(!grouped.has(row.consoleId))grouped.set(row.consoleId,[]);grouped.get(row.consoleId).push(row);}
  for(const [id,rows] of grouped){
    const key='set:'+id, old=(await chrome.storage.local.get(key))[key] || [];
    const merged=mergeCards(old,rows); await chrome.storage.local.set({[key]:merged});
    job.sets[id]={name:rows[0].setName || id,cards:merged.length,photos:merged.filter(x=>x.image).length};
  }
  // Set pages contain unrelated navigation/recommendations. Discover sets only
  // from directories, rather than recursively walking the entire site.
  if(job.discover && !data.cards?.length)for(const raw of data.sets || []){
    const url=sourceUrl(raw);
    if(url && eligibleSet(url,job.licensedOnly) && !job.seen.includes(url) && job.seen.length<500){job.queue.push({url,pages:0});job.seen.push(url);}
  }
}
async function pause(message){const job=await read();if(job){job.running=false;job.message=message;await save(job);}}
async function run(){
  if(pumping)return pumping;
  pumping=(async()=>{
    for(let step=0;step<6;step++){
      let job=await read(); if(!job?.running)return;
      if(!job.queue.length){job.running=false;job.message='Collection complete. Review and export the saved sets.';await save(job);return;}
      const current=job.queue[0];let tab;
      try{tab=job.tabId?await chrome.tabs.get(job.tabId):null;}catch{}
      if(!tab){tab=await chrome.tabs.create({url:current.url,active:false});job.tabId=tab.id;job.navigating=current.url;await save(job);return;}
      if(job.navigating){
        if(tab.status!=='complete')return;
        if(!sourceUrl(tab.url))return pause('The source redirected outside the allowed pages. Review the collector tab.');
        job.navigating='';await save(job);
      }else if(sourceUrl(tab.url)!==current.url){
        job.navigating=current.url;await save(job);await chrome.tabs.update(tab.id,{url:current.url});return;
      }
      let result;
      try{result=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:inspectPage,args:[false]}))[0]?.result;}
      catch{return pause('Could not read the collector tab. Open it, then resume.');}
      if(!result || result.blocked)return pause(result?.message || 'Could not read this page.');
      // Reload state so a Pause clicked during navigation is respected.
      job=await read();if(!job.running)return;
      await capture(job,result);
      job.queue[0].pages++;job.message=`Saved ${Object.values(job.sets).reduce((n,s)=>n+s.cards,0)} cards across ${Object.keys(job.sets).length} sets.`;
      const latestState=await read();if(!latestState.running){job.running=false;job.message=latestState.message;}
      await save(job);
      if(!job.running)return;
      if(job.queue[0].pages>=1000)return pause('Reached the 1,000-batch safety limit for this source. Saved results are ready to review.');
      if(!result.cards.length && !result.sets.length)return pause('No card or set rows found. Review this page before resuming.');
      if(result.hasNext){
        await nap(4000);if(!(await read())?.running)return;
        let more;
        try{more=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:inspectPage,args:[true]}))[0]?.result;}
        catch{ // A normal full-page form navigation can destroy the script context.
          const latest=await chrome.tabs.get(tab.id).catch(()=>null);
          if(latest && sourceUrl(latest.url)===current.url){job=await read();job.navigating=current.url;await save(job);return;}
          return pause('Pagination was interrupted. Review the source tab, then resume.');
        }
        if(more?.blocked || more?.stalled)return pause(more.message);
        if(more?.advanced)continue;
      }
      job=await read();if(!job.running)return;
      job.completed.push(job.queue.shift().url);await save(job);
    }
  })().catch(async error=>{await pause('Collection paused: '+String(error.message).slice(0,180));}).finally(()=>{pumping=null;});
  return pumping;
}
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}));
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='collector-resume')void run();});
chrome.tabs.onUpdated.addListener((_id,change)=>{if(change.status==='complete')void run();});
chrome.runtime.onStartup.addListener(()=>{void schedule().then(run);});
chrome.runtime.onInstalled.addListener(()=>{void schedule();});
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(!['start','pause','resume','open-source','download-images'].includes(message.type))return;
  (async()=>{
    if(message.type==='start'){
      const old=await read();if(old?.running)throw new Error('Pause the existing collection first.');
      const urls=[...new Set(String(message.urls||'').split(/\s+/).map(x=>sourceUrl(x)).filter(Boolean))];
      const licensedOnly=message.licensedOnly!==false;
      const eligible=urls.filter(x=>eligibleSet(x,licensedOnly));
      if(!eligible.length)throw new Error('Add an allowed set or category URL. The licensed sports filter accepts Topps/Bowman sets from 2019 onward.');
      if(eligible.length>500)throw new Error('Collect up to 500 starting URLs per job.');
      await save({running:true,queue:eligible.map(url=>({url,pages:0})),seen:eligible,completed:[],sets:old?.sets||{},discover:message.discover!==false,licensedOnly,tabId:old?.tabId||null,message:'Starting collection…'});
      await schedule();void run();
    }else if(message.type==='pause')await pause('Paused. Saved cards are safe; resume whenever you want.');
    else if(message.type==='resume'){const job=await read();if(!job?.queue.length)throw new Error('Start a new collection first.');job.running=true;await save(job);void run();}
    else if(message.type==='open-source'){const job=await read();if(job?.tabId)await chrome.tabs.update(job.tabId,{active:true});}
    else if(message.type==='download-images')throw new Error('Use the download button in the review page.');
    return {ok:true};
  })().then(respond,error=>respond({error:error.message}));
  return true;
});
