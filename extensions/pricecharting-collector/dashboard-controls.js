// Controls on the normal HTTPS dashboard let collection run without opening
// an internal Chrome extension page. No tokens or general API access exposed.
(() => {
 if(location.origin!=='https://squeebmike.github.io'||location.pathname!=='/ArSca/dashboard.html'||document.getElementById('mp-cloud-collector'))return;
 const panel=document.createElement('details');panel.id='mp-cloud-collector';panel.open=location.hash==='#cloud-card-collector';
 panel.style.cssText='position:fixed;right:12px;bottom:12px;z-index:100000;width:min(440px,calc(100vw - 24px));max-height:65vh;overflow:auto;background:#21172f;color:#f7f1fa;border:2px solid #8bd450;border-radius:12px;padding:12px;font:14px/1.5 system-ui;box-shadow:0 8px 30px #0008';
 const heading=document.createElement('summary');heading.textContent='Cloud card collector · v'+(chrome.runtime.getManifest?.()?.version||'1.3.1');heading.style.cssText='cursor:pointer;font-weight:750';panel.append(heading);
 const intro=document.createElement('p');intro.textContent='Collect linked Topps/Bowman sets from 2019 onward, newest set year first. Verified dates and provider New Releases help order sets within a year. Card details and photo URLs go to Cloudflare; no image files.';panel.append(intro);
 const label=document.createElement('label');label.textContent='Source directories or sets';
 const urls=document.createElement('textarea');urls.setAttribute('aria-label','Cloud collector source URLs');urls.rows=3;urls.value='https://www.sportscardspro.com/category/baseball-cards\nhttps://www.sportscardspro.com/category/football-cards';urls.style.cssText='display:block;width:100%;box-sizing:border-box;background:#382746;color:white;border:1px solid #a493b4;border-radius:6px;padding:8px';label.append(urls);panel.append(label);
 const controls=document.createElement('div');controls.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin:12px 0';panel.append(controls);
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.append(status);
 async function send(type,extra={}){const result=await chrome.runtime.sendMessage({type,...extra});if(result?.error)throw Error(result.error);return result;}
 function show(data){const job=data.job;if(!job){status.textContent='Ready. Keep the dashboard signed in while collection runs.';return;}const totals=Object.values(job.sets||{}).reduce((n,s)=>({cards:n.cards+s.cards,photos:n.photos+s.photos}),{cards:0,photos:0});const backfill=job.priceBackfill?' Price backfill: '+(job.priceBackfill.complete?'source revisit complete':job.priceBackfill.active?job.queue.length+' sources left':job.priceBackfill.planned+' sources queued for afterward')+'.':'';status.textContent=job.message+' Cloud saved: '+totals.cards+' cards, '+totals.photos+' photo URLs. '+job.completed.length+' sources completed; '+job.queue.length+' queued.'+(job.queue[0]?' Current: '+job.queue[0].url:'')+backfill+(data.pending?' Pending acknowledgement: '+data.pending:'');}
 async function refresh(){try{show(await send('collector-status'));}catch(error){status.textContent=error.message;}}
 for(const [text,type]of [['Connect cloud','connect-cloud'],['Start newest first','start'],['Queue verified sources','queue-verified-sources'],['Recheck source directories','rescan-directories'],['Queue earlier price backfill','queue-price-backfill'],['Pause collection','pause'],['Resume collection','resume'],['Refresh collection status','collector-status']]){
  const button=document.createElement('button');button.type='button';button.textContent=text;button.style.cssText='padding:8px 10px;border:1px solid #8bd450;border-radius:6px;background:#382746;color:white;font:650 13px system-ui;cursor:pointer';
  button.addEventListener('click',async()=>{button.disabled=true;try{const data=await send(type,{urls:urls.value,discover:true,licensedOnly:true});if(type==='collector-status')show(data);else{status.textContent=type==='connect-cloud'?'Cloud connected. Start newest first to begin.':'Request accepted.';if(type!=='connect-cloud')await refresh();}}catch(error){status.textContent=error.message;}finally{button.disabled=false;}});controls.append(button);
 }
 chrome.storage.onChanged.addListener(changes=>{if(changes.job||changes.pendingCloudBatch)void refresh();});
 document.body.append(panel);void refresh();
})();
