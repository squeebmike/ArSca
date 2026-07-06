(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ArsCaDeckImports=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const manual={
    archidekt:'Open the deck in Archidekt, choose Export and a text export, copy the decklist, then paste it here. Categories and printing details are preserved when included.',
    moxfield:'Open the deck in Moxfield, choose Export or Copy, select a text/MTGO-style list, then paste it here.',
    mtggoldfish:'Open the deck on MTGGoldfish, use its deck export or copy the visible decklist, then paste it here.',
    tappedout:'Open the deck on TappedOut, copy or export the decklist text, then paste it here.',
    aetherhub:'Open the deck on AetherHub, use Export and copy a text or Arena-format list, then paste it here.',
    manabox:'Open the shared deck in ManaBox, export or share it as plain text, then paste that list here.',
    arena:'In MTG Arena, open the deck, choose Export, then paste the Arena-format list here.',
    csv:'Paste CSV with quantity and name columns. Optional set, collector_number, category, and notes columns are supported.',
    plain:'Copy a text decklist with one quantity and card name per line, then paste it here.'
  };
  const definitions=[
    {id:'archidekt',site:'Archidekt',hosts:['archidekt.com','www.archidekt.com'],confidence:'high'},
    {id:'moxfield',site:'Moxfield',hosts:['moxfield.com','www.moxfield.com'],confidence:'high'},
    {id:'mtggoldfish',site:'MTGGoldfish',hosts:['mtggoldfish.com','www.mtggoldfish.com'],confidence:'high'},
    {id:'tappedout',site:'TappedOut',hosts:['tappedout.net','www.tappedout.net'],confidence:'high'},
    {id:'aetherhub',site:'AetherHub',hosts:['aetherhub.com','www.aetherhub.com'],confidence:'high'},
    {id:'manabox',site:'ManaBox',hosts:['manabox.app','www.manabox.app','manabox.io','www.manabox.io'],confidence:'medium'}
  ];
  function parsePublicUrl(value){
    try{const url=new URL(String(value||'').trim());if(!/^https?:$/.test(url.protocol))return null;url.hash='';return url}catch(e){return null}
  }
  function normalizeUrl(value){const url=parsePublicUrl(value);return url?url.toString():''}
  function manualError(provider){const error=new Error(provider.getManualInstructions());error.code='manual_required';error.provider=provider.id;return error}
  function makeProvider(def){return{
    ...def,directImport:'unknown',
    detect(value){const url=parsePublicUrl(value);return !!url&&def.hosts.includes(url.hostname.toLowerCase())},
    normalizeUrl,
    async fetchDeck(){throw manualError(this)},
    parseExport(text){return String(text||'')},
    getManualInstructions(){return manual[def.id]},
  }}
  const providers=definitions.map(makeProvider);
  const plainTextProvider={id:'plain',site:'Plain text',directImport:'yes',confidence:'high',detect:value=>!parsePublicUrl(value)&&/^(?:\s*(?:\d+\s*x?\s+|Commander|Deck|Mainboard|Sideboard|Maybeboard))/im.test(String(value||'')),normalizeUrl:()=>'',async fetchDeck(){throw manualError(this)},parseExport:text=>String(text||''),getManualInstructions:()=>manual.plain};
  function looksLikeArenaExport(value){const lines=String(value||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean),sections=/^(Deck|Sideboard|Commander)$/i,card=/^\d+\s*x?\s+.+/i;if(!lines.some(line=>/^Deck$/i.test(line)))return false;return lines.every(line=>sections.test(line)||card.test(line))}
  const arenaProvider={id:'arena',site:'MTG Arena',directImport:'yes',confidence:'high',detect:looksLikeArenaExport,normalizeUrl:()=>'',async fetchDeck(){throw manualError(this)},parseExport:text=>String(text||''),getManualInstructions:()=>manual.arena};
  function csvCells(line){const cells=[];let value='',quoted=false;for(let i=0;i<line.length;i++){const char=line[i];if(char==='"'&&line[i+1]==='"'&&quoted){value+='"';i++}else if(char==='"')quoted=!quoted;else if(char===','&&!quoted){cells.push(value.trim());value=''}else value+=char}cells.push(value.trim());return cells}
  function parseCsvExport(text){const lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);if(lines.length<2)return'';const headers=csvCells(lines[0]).map(x=>x.toLowerCase().replace(/\s+/g,'_')),index=name=>headers.indexOf(name),qIndex=Math.max(index('quantity'),index('qty')),nIndex=Math.max(index('name'),index('card')),sIndex=Math.max(index('set'),index('set_code')),cIndex=Math.max(index('collector_number'),index('collector')),catIndex=index('category');if(qIndex<0||nIndex<0)return'';let category='',out=[];for(const line of lines.slice(1)){const row=csvCells(line),nextCategory=catIndex>=0?row[catIndex]:'';if(nextCategory&&nextCategory!==category){category=nextCategory;out.push('',category)}const qty=Number(row[qIndex]||1),name=row[nIndex]||'';if(!name||qty<=0)continue;const set=sIndex>=0?row[sIndex]:'',collector=cIndex>=0?row[cIndex]:'';out.push(qty+' '+name+(set?' ('+set.toUpperCase()+')'+(collector?' '+collector:''):collector?' #'+collector:''))}return out.join('\n').trim()}
  const csvProvider={id:'csv',site:'CSV',directImport:'yes',confidence:'medium',detect:value=>/^\s*(?:quantity|qty)\s*,\s*(?:name|card)/im.test(String(value||'')),normalizeUrl:()=>'',async fetchDeck(){throw manualError(this)},parseExport:parseCsvExport,getManualInstructions:()=>manual.csv};
  const allProviders=[...providers,arenaProvider,csvProvider,plainTextProvider];
  function detectProvider(value){
    const raw=String(value||'').trim();
    for(const provider of providers)if(provider.detect(raw))return{provider,confidence:provider.confidence,normalizedUrl:provider.normalizeUrl(raw),valid:true};
    for(const provider of [arenaProvider,csvProvider,plainTextProvider])if(provider.detect(raw))return{provider,confidence:provider.confidence,normalizedUrl:'',valid:true};
    const looksLikeUrl=/^(?:https?:\/\/|www\.)/i.test(raw);
    return{provider:null,confidence:'none',normalizedUrl:'',valid:!looksLikeUrl,error:looksLikeUrl?'That URL is malformed or uses an unsupported site. Paste a public https:// deck link.':'No provider detected.'};
  }
  function providerById(id){return allProviders.find(provider=>provider.id===id)||null}
  function externalSearchUrl(providerId,query){
    const domains={archidekt:'archidekt.com',moxfield:'moxfield.com',edhrec:'edhrec.com',mtggoldfish:'mtggoldfish.com',tappedout:'tappedout.net'};
    const domain=domains[providerId];if(!domain)return'';
    return'https://www.google.com/search?q='+encodeURIComponent('site:'+domain+' '+String(query||'Commander deck'));
  }
  function createLocalRepository(storage,key,max=30){
    function load(){try{const value=JSON.parse(storage.getItem(key)||'[]');return Array.isArray(value)?value:[]}catch(e){return[]}}
    function save(items){const clean=Array.isArray(items)?items.slice(0,max):[];storage.setItem(key,JSON.stringify(clean));return clean}
    function upsert(item){const next={...item,id:item.id||('src_'+Date.now()+'_'+Math.random().toString(36).slice(2,6)),updatedAt:item.updatedAt||new Date().toISOString()};return save([next,...load().filter(row=>row.id!==next.id)])}
    function remove(id){return save(load().filter(row=>row.id!==id))}
    return{load,save,upsert,remove,key}
  }
  return{providers,allProviders,plainTextProvider,arenaProvider,csvProvider,detectProvider,providerById,normalizeUrl,externalSearchUrl,createLocalRepository,parseCsvExport};
});
