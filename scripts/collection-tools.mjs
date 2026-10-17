export function cleanCollection(value) {
 const result=Object.create(null);
 if(!value||typeof value!=='object'||Array.isArray(value))return result;
 for(const [key,state]of Object.entries(value).slice(0,50000))if(/^[a-zA-Z0-9._:/-]{1,220}$/.test(key)&&['have','need','want'].includes(state))result[key]=state;
 return result;
}
export function mergeCollection(current,incoming,allowed) {
 const result=cleanCollection(current),valid=cleanCollection(incoming),keys=new Set(allowed);
 for(const [key,state]of Object.entries(valid))if(keys.has(key))result[key]=state;
 return result;
}
export function collectionCsv(cards,state,mode='need') {
 const quote=v=>{let text=String(v??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const rows=cards.filter(c=>mode==='all'||state[c.key]===mode);
 return [['Status','Card','Number','URL'],...rows.map(c=>[state[c.key]||'unmarked',c.name,c.number,c.url])].map(row=>row.map(quote).join(',')).join('\r\n');
}
export function collectionClient(root,cards,clean,merge,csv) {
 if(!root)return;
 const storageKey='mana-pocket:collection:v1',status=root.querySelector('[data-collection-status]'),list=root.querySelector('[data-collection-list]');
 const allowed=cards.map(c=>c.key);let state={},canSave=true;
 try{state=clean(JSON.parse(localStorage.getItem(storageKey)||'{}'));}catch{canSave=false;}
 let mode='all';
 function updateStatus(message='') {
  const count=type=>cards.filter(c=>state[c.key]===type).length;
  status.textContent=(message?message+' ':'')+count('have')+' have · '+count('need')+' need · '+count('want')+' want. '+(canSave?'Saved on this device.':'Saving is unavailable; changes are only kept while this page stays open.');
 }
 function render(){
  list.replaceChildren();
  for(const card of cards){
   if(mode!=='all'&&state[card.key]!==mode)continue;
   const row=document.createElement('p'),a=document.createElement('a'),select=document.createElement('select');
   a.href=card.url;a.textContent=card.name+(card.number?' #'+card.number:'');
   select.setAttribute('aria-label','Collection status for '+a.textContent);
   for(const [value,label]of [['','Unmarked'],['have','Have'],['need','Need'],['want','Want']]){const o=document.createElement('option');o.value=value;o.textContent=label;select.appendChild(o);}
   select.value=state[card.key]||'';
   select.addEventListener('change',()=>{if(select.value)state[card.key]=select.value;else delete state[card.key];try{localStorage.setItem(storageKey,JSON.stringify(state));canSave=true;}catch{canSave=false;}render();});
   row.append(a,document.createTextNode(' '),select);list.appendChild(row);
  }
  updateStatus();
 }
 function download(name,text,type){const u=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
 root.querySelector('[data-collection-filter]').addEventListener('change',e=>{mode=e.target.value;render();});
 root.querySelector('[data-export-needs]').addEventListener('click',()=>download('mana-pocket-needs.csv',csv(cards,state,'need'),'text/csv;charset=utf-8'));
 root.querySelector('[data-export-backup]').addEventListener('click',()=>download('mana-pocket-collection.json',JSON.stringify(state,null,2),'application/json'));
 root.querySelector('[data-import-backup]').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024){updateStatus('That backup is too large.');return;}try{state=merge(state,JSON.parse(await file.text()),allowed);try{localStorage.setItem(storageKey,JSON.stringify(state));canSave=true;}catch{canSave=false;}render();}catch{updateStatus('That file could not be read as a collection backup.');}e.target.value='';});
 root.querySelector('[data-print-collection]').addEventListener('click',()=>{document.body.classList.add('mp-print-collection');window.addEventListener('afterprint',()=>document.body.classList.remove('mp-print-collection'),{once:true});window.print();});
 root.querySelector('[data-share-collection-page]').addEventListener('click',async()=>{const url=location.origin+location.pathname;try{if(navigator.share)await navigator.share({title:document.title,url});else if(navigator.clipboard){await navigator.clipboard.writeText(url);updateStatus('Checklist link copied.');}else updateStatus('Copy this page address to share the checklist.');}catch(e){if(e.name!=='AbortError')updateStatus('Copy this page address to share the checklist.');}});
 root.addEventListener('toggle',()=>{if(root.open)render();});
 if(root.open)render();else updateStatus();
}
export function collectionToolsHtml(cards,{scope,path,escape:esc}={}) {
 const seen=new Set(),model=[];
 for(const card of cards){const key=scope+'/'+String(card.scryfallId||card.tcgPlayerId||card.id||'');if(seen.has(key)||!card.name)continue;seen.add(key);model.push({key,name:card.name,number:card.collectorNumber||card.cardNumber||card.number||'',url:'https://www.themanapocket.com'+path(card)});}
 if(!model.length)return '';
 const data=JSON.stringify(model).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
 return '<style>@media print{body.mp-print-collection #navbarID,body.mp-print-collection footer,body.mp-print-collection .footer-section,body.mp-print-collection .mp-wrap>*{display:none!important}body.mp-print-collection .mp-wrap>details.mp-collection{display:block!important;color:black!important;background:white!important}body.mp-print-collection .mp-collection button,body.mp-print-collection .mp-collection>label,body.mp-print-collection .mp-collection>summary{display:none!important}body.mp-print-collection .mp-collection a{color:black!important}}</style><details class="mp-collection"><summary>Track Have / Need / Want for this checklist</summary><p>Your marks are saved on this device. They are not synced to your account. Export a backup before switching devices. Sharing sends the checklist page link; export your marked needs separately.</p><label>Show <select data-collection-filter><option value="all">All cards</option><option value="have">Have</option><option value="need">Need</option><option value="want">Want</option></select></label> <button type="button" data-export-needs>Export marked needs</button> <button type="button" data-export-backup>Back up collection</button> <label>Restore this checklist <input type="file" accept="application/json,.json" data-import-backup></label> <button type="button" data-share-collection-page>Share checklist</button> <button type="button" data-print-collection>Print selection</button><p role="status" data-collection-status></p><div data-collection-list></div><noscript>Collection tracking needs JavaScript. The card checklist below is available without it.</noscript></details><script>(function(){const cleanCollection='+cleanCollection.toString()+';const mergeCollection='+mergeCollection.toString()+';const collectionCsv='+collectionCsv.toString()+';('+collectionClient.toString()+')(document.currentScript.previousElementSibling,'+data+',cleanCollection,mergeCollection,collectionCsv);})();</script>';
}
