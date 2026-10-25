// Owner audit UI on the normal HTTPS dashboard. Uses existing auth; no tokens
// are copied to extensions, URLs, logs, files, or third-party services.
(() => {
 if(document.getElementById('reference-audit-panel'))return;
 const panel=document.createElement('details');panel.id='reference-audit-panel';panel.style.cssText='position:fixed;left:12px;bottom:12px;z-index:100001;width:min(950px,calc(100vw - 24px));max-height:80vh;overflow:auto;background:#20172b;color:#f8f3fb;border:2px solid #b79acf;border-radius:12px;padding:12px;font:14px/1.5 system-ui;box-shadow:0 8px 30px #0008';
 const summary=document.createElement('summary');summary.textContent='Card reference audit';summary.style.cssText='font-weight:750;cursor:pointer';panel.append(summary);
 const note=document.createElement('p');note.textContent='Owner-only review of actual cloud records. Automated eligibility checks metadata, source identity, image availability and conflicts. It is not visual authentication of every photo.';panel.append(note);
 const buttons=document.createElement('div');buttons.style.cssText='display:flex;gap:8px;flex-wrap:wrap';panel.append(buttons);
 const select=document.createElement('select');select.setAttribute('aria-label','Cloud reference set');select.style.cssText='display:block;width:100%;margin:12px 0;padding:8px;background:#382746;color:white';panel.append(select);
 const status=document.createElement('p');status.setAttribute('role','status');panel.append(status);
 const progress=document.createElement('div');progress.id='reference-audit-progress';panel.append(progress);
 const gallery=document.createElement('div');gallery.id='reference-audit-samples';gallery.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px';panel.append(gallery);
 async function request(path,method='GET',body=null){if(typeof storeWorkerFetch!=='function')throw Error('Wait for the dashboard to finish loading.');const response=await storeWorkerFetch('/reference-collector/'+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(data.error||'Audit request failed');return data;}
 function fill(sets){const selected=select.value;select.replaceChildren();for(const set of sets){const option=document.createElement('option');option.value=set.consoleId;option.textContent=set.name+' — '+set.cards+' records / '+set.photos+' photos';select.append(option);}if(sets.some(s=>s.consoleId===selected))select.value=selected;}
 async function loadArchive(){const data=await request('sets');fill(data.sets);status.textContent='Archive loaded: '+data.sets.length+' source sets. Select a set, then load real samples.';}
 async function samples(){
  if(!select.value)await loadArchive();if(!select.value)return;
  const data=await request('samples?console='+encodeURIComponent(select.value));gallery.replaceChildren();status.textContent=data.samples.length+' real photo samples selected from '+data.scanned+' stored records.';
  for(const row of data.samples){
   const card=document.createElement('article');card.style.cssText='border:1px solid #776585;border-radius:8px;padding:10px;overflow-wrap:anywhere';
   const img=document.createElement('img');img.src=row.image;img.alt=row.title;img.loading='lazy';img.style.cssText='width:100%;height:270px;object-fit:contain;background:#15101b';card.append(img);
   const title=document.createElement('h3');title.textContent=row.title;title.style.fontSize='15px';card.append(title);
   for(const text of ['Card '+row.cardNumber+' · Source finish: '+(row.parallel||'not provided')+' · Source numbering: '+(row.run||'not provided'),'Checks: '+(row.validation?.flags?.join(', ')||'No metadata flags'),'Image: '+(row.health?row.health.ok?'reachable':'failed: '+row.health.reason:'not checked'),...(row.hold?['HELD: '+row.hold.reason]:[])]){const p=document.createElement('p');p.textContent=text;card.append(p);}
   const source=document.createElement('a');source.href=row.url;source.textContent='Source card page';source.target='_blank';source.rel='noopener';source.style.color='#b6e68a';card.append(source);
   for(const match of row.validation?.matches||[]){const p=document.createElement('p'),a=document.createElement('a');a.href='https://www.themanapocket.com'+match.path;a.textContent='Matching website card';a.target='_blank';a.rel='noopener';a.style.color='#b6e68a';p.append(a);card.append(p);}
   const reason=document.createElement('textarea');reason.setAttribute('aria-label','Reason to hold '+row.title);reason.placeholder='Reason this photo should be held';reason.style.cssText='display:block;width:100%;box-sizing:border-box;margin-top:8px;background:#382746;color:white';card.append(reason);
   const hold=document.createElement('button');hold.type='button';hold.textContent='Hold photo: '+row.title;hold.disabled=!!row.hold;hold.onclick=async()=>{hold.disabled=true;try{await request('hold','POST',{consoleId:row.consoleId,url:row.url,reason:reason.value||'Source photo needs visual review'});status.textContent='Photo held from public display: '+row.title;}catch(error){hold.disabled=false;status.textContent=error.message;}};card.append(hold);
   gallery.append(card);
  }
 }
 let timer;
 async function auditStatus(){const data=await request('audit/status');fill(data.sets);progress.replaceChildren();let records=0,photos=0,checked=0,ok=0,eligible=0,held=0;
  for(const set of data.sets){const a=set.audit;records+=a.records||0;photos+=a.photos||0;checked+=a.imagesChecked||0;ok+=a.imagesOk||0;eligible+=a.eligible||0;held+=a.held||0;const p=document.createElement('p');p.textContent=set.consoleId+': '+a.phase+' · '+(a.records||0)+' records · '+(a.imagesChecked||0)+' image URLs checked · '+(a.eligible||0)+' eligible · flags '+JSON.stringify(a.flags||{});progress.append(p);}
  status.textContent=(data.running?'Audit running. ':'Audit status: ')+records+' records scanned; '+photos+' photo references; '+checked+' unique image URLs checked; '+ok+' reachable; '+eligible+' eligible; '+held+' held after final checks.';
  clearTimeout(timer);if(data.running)timer=setTimeout(()=>{if(!document.hidden)void auditStatus().catch(error=>status.textContent=error.message);},30000);
 }
 for(const [label,action]of [['Load cloud archive',loadArchive],['Load real photo samples',samples],['Run automated archive audit',async()=>{await request('audit/start','POST');await auditStatus();}],['Refresh audit progress',auditStatus]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.style.cssText='padding:8px 10px;background:#382746;color:white;border:1px solid #b79acf;border-radius:6px;cursor:pointer';button.onclick=async()=>{button.disabled=true;try{await action();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};buttons.append(button);}
 document.body.append(panel);
})();
