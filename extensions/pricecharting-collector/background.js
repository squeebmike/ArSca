import {sourceUrl,eligibleSet,inspectPage,newestSetQueue,recheckSourceDirectories,queueEarlierPriceBackfill,queueVerifiedSources} from './core.mjs';
import {cloudRequest,uploadReferences,DASHBOARD} from './cloud.mjs';
let pumping;
const read = async () => {const job=(await chrome.storage.local.get('job')).job;const paused=(await chrome.storage.local.get('collectorPaused')).collectorPaused;return paused&&job?{...job,running:false,message:typeof paused==='string'?paused:'Paused. Uploaded references are safe in the cloud.'}:job;};
const save = job => chrome.storage.local.set({job});
const nap = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function schedule(){await chrome.alarms.create('collector-resume',{periodInMinutes:0.5});}
async function capture(job, data) {
  for(const summary of await uploadReferences(chrome,data.cards||[]))job.sets[summary.consoleId]=summary;
  // Set pages contain unrelated navigation/recommendations. Discover sets only
  // from directories, rather than recursively walking the entire site.
  if(job.discover && !data.cards?.length)for(const raw of data.sets || []){
    const url=sourceUrl(raw);
    if(url && eligibleSet(url,job.licensedOnly) && !job.seen.includes(url) && job.seen.length<500){const recentRank=(data.recentSets||[]).map(x=>sourceUrl(x)).indexOf(url);job.queue.push({url,pages:0,...(recentRank>=0?{recentRank}:{})});job.seen.push(url);}
  }
  // Keep the active source in place; discover all directory roots before sets.
  job.queue=[job.queue[0],...newestSetQueue(job.queue.slice(1))];
}
async function pause(message){await chrome.storage.local.set({collectorPaused:message});const job=await read();if(job){job.running=false;job.message=message;await save(job);}}
async function preserveAndUpdateQueue(transform){
 const before=await read();if(!before)throw Error('Start a collection first.');
 const marker='Pausing briefly to preserve the active source while updating the queue.';
 if(before.running)await pause(marker);await pumping;
 const latch=(await chrome.storage.local.get('collectorPaused')).collectorPaused;
 const resume=before.running&&latch===marker||!before.queue.length&&!latch;
 const job=transform(await read());job.running=!!resume;
 if(resume)await chrome.storage.local.set({collectorPaused:false});
 await save(job);await schedule();if(resume)void run();
}
async function run(){
  if(pumping)return pumping;
  pumping=(async()=>{
    for(let step=0;step<6;step++){
      let job=await read(); if(!job?.running)return;
      if(Number(job.notBefore)>Date.now())return;
      if(!job.queue.length){
       if(job.priceBackfill?.queue?.length&&!job.priceBackfill.active){job.queue=job.priceBackfill.queue;job.priceBackfill.queue=[];job.priceBackfill.active=true;job.message='Initial collection complete. Revisiting earlier sources for available prices.';await save(job);continue;}
       job.running=false;if(job.priceBackfill?.active)job.priceBackfill.complete=true;
       job.message='Collection complete. Stored references still need website matching; missing source prices remain unavailable.';await save(job);return;
      }
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
      if(result.signature&&result.signature!==job.queue[0].signature){job.queue[0].paginationWaits=0;job.queue[0].signature=result.signature;}
      await capture(job,result);
      job.queue[0].pages++;job.message=`Cloud saved: ${Object.values(job.sets).reduce((n,s)=>n+s.cards,0)} cards across ${Object.keys(job.sets).length} sets.`;
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
        if(more?.blocked)return pause(more.message);
        if(more?.stalled){
          job=await read();if(!job.running)return;
          const waits=(job.queue[0].paginationWaits||0)+1;
          if(waits>3)return pause(more.message+' Automatic source waits were exhausted; review the source tab.');
          job.queue[0].paginationWaits=waits;job.navigating=current.url;job.notBefore=Date.now()+30000;
          job.message='Source pagination is slow; waiting 30 seconds before continuing this set.';await save(job);return;
        }
        if(more?.advanced)continue;
        // Chrome can return no script result when a POST replaces the whole
        // document. Capture that next document; do not mark the set complete.
        if(!more?.done){job=await read();job.navigating=current.url;await save(job);return;}
      }
      job=await read();if(!job.running)return;
      const completedUrl=job.queue.shift().url;if(!job.completed.includes(completedUrl))job.completed.push(completedUrl);await save(job);
    }
  })().catch(async error=>{await pause('Collection paused: '+String(error.message).slice(0,180));}).finally(()=>{pumping=null;});
  return pumping;
}
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}));
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='collector-resume')void run();});
chrome.tabs.onUpdated.addListener((_id,change)=>{if(change.status==='complete')void run();});
chrome.runtime.onStartup.addListener(()=>{void schedule().then(run);});
chrome.runtime.onInstalled.addListener(()=>{void schedule();void chrome.tabs.query({url:DASHBOARD+'*'}).then(tabs=>Promise.all(tabs.map(tab=>chrome.scripting.executeScript({target:{tabId:tab.id},files:['dashboard-controls.js']})))).catch(()=>{});});
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(!['start','pause','resume','rescan-directories','queue-price-backfill','queue-verified-sources','open-source','connect-cloud','cloud-sets','cloud-cards','sync-earlier','collector-status'].includes(message.type))return;
  (async()=>{
    if(message.type==='start'){
      const old=await read();if(old?.running)throw new Error('Pause the existing collection first.');
      await cloudRequest(chrome,'/reference-collector/sets');
      const urls=[...new Set(String(message.urls||'').split(/\s+/).map(x=>sourceUrl(x)).filter(Boolean))];
      const licensedOnly=message.licensedOnly!==false;
      const eligible=urls.filter(x=>eligibleSet(x,licensedOnly));
      if(!eligible.length)throw new Error('Add an allowed set or category URL. The licensed sports filter accepts Topps/Bowman sets from 2019 onward.');
      if(eligible.length>500)throw new Error('Collect up to 500 starting URLs per job.');
      await chrome.storage.local.set({collectorPaused:false});
      await save({running:true,queue:newestSetQueue(eligible.map(url=>({url,pages:0}))),seen:eligible,completed:[],sets:old?.sets||{},discover:message.discover!==false,licensedOnly,tabId:old?.tabId||null,message:'Starting newest-first collection…'});
      await schedule();void run();
    }else if(message.type==='queue-verified-sources'){
      await preserveAndUpdateQueue(job=>queueVerifiedSources(job,message.urls,message.revisitCompleted===true));
    }else if(message.type==='rescan-directories'){
      await preserveAndUpdateQueue(recheckSourceDirectories);
    }else if(message.type==='queue-price-backfill'){
      const data=await cloudRequest(chrome,'/reference-collector/sets');
      await preserveAndUpdateQueue(job=>queueEarlierPriceBackfill(job,data.sets));
    }else if(message.type==='collector-status'){const job=await read();return {job:job||null,pending:((await chrome.storage.local.get('pendingCloudBatch')).pendingCloudBatch||[]).length};}
    else if(message.type==='pause')await pause('Paused. Uploaded references are safe in the cloud.');
    else if(message.type==='resume'){const job=await read();if(!job?.queue.length)throw new Error('Start a new collection first.');const pending=(await chrome.storage.local.get('pendingCloudBatch')).pendingCloudBatch;if(pending?.length)await uploadReferences(chrome,pending);await chrome.storage.local.set({collectorPaused:false});job.running=true;await save(job);void run();}
    else if(message.type==='open-source'){const job=await read();if(job?.tabId)await chrome.tabs.update(job.tabId,{active:true});}
    else if(message.type==='connect-cloud'){
      const tabs=await chrome.tabs.query({url:DASHBOARD+'*'});if(!tabs.length){await chrome.tabs.create({url:DASHBOARD,active:true});throw Error('Sign in to the dashboard, then click Connect cloud again.');}
      return await cloudRequest(chrome,'/reference-collector/sets');
    }else if(message.type==='cloud-sets')return await cloudRequest(chrome,'/reference-collector/sets');
    else if(message.type==='cloud-cards'){
      if(typeof message.console!=='string'||message.console.length>160||!/^[a-z0-9-]+(?:%27[a-z0-9-]+)*$/.test(message.console)||message.cursor&&!/^row:[a-z0-9-]{1,250}$/.test(message.cursor))throw Error('Invalid source set or cursor.');
      return await cloudRequest(chrome,'/reference-collector/cards?console='+encodeURIComponent(message.console)+'&cursor='+encodeURIComponent(message.cursor||''));
    }else if(message.type==='sync-earlier'){
      if((await read())?.running)throw Error('Pause collection before syncing earlier captures.');
      const keys=(await chrome.storage.local.getKeys()).filter(key=>key.startsWith('set:'));
      for(const key of keys){const rows=(await chrome.storage.local.get(key))[key]||[];await uploadReferences(chrome,rows);await chrome.storage.local.remove(key);}
      return {ok:true,message:'Earlier captures are saved in the cloud.'};
    }
    return {ok:true};
  })().then(respond,error=>respond({error:error.message}));
  return true;
});
