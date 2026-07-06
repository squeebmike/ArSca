(function(){
  'use strict';
  const importButton=$('parse-btn');

  function switchHub(view){
    document.querySelectorAll('.hub-tab').forEach(button=>button.classList.toggle('on',button.dataset.importView===view));
    document.querySelectorAll('.hub-view').forEach(panel=>panel.classList.toggle('on',panel.id==='hub-'+view));
  }
  function applyProfile(next={}){
    $('deck-name').value=next.name||'';
    $('deck-format').value=next.format||'Commander';
    $('deck-power').value=next.power||'Shop/customer unknown';
    $('deck-commander').value=next.commander||'';
    $('deck-colors').value=next.colors||'';
    $('deck-goal').value=next.goal||'Customer unknown';
  }
  function safeOpen(url){const safe=DI.normalizeUrl(url);if(!safe){toast('That source URL is not a valid public http(s) link');return}window.open(safe,'_blank','noopener,noreferrer')}

  function detectUrl(){
    detectedUrl=DI.detectProvider($('import-url').value);
    const host=$('url-detection'),provider=detectedUrl.provider;
    $('try-url-import').disabled=!provider;$('open-source-deck').disabled=!provider;
    if(!provider){host.innerHTML='<strong>URL NOT RECOGNIZED</strong>'+esc(detectedUrl.error||'Paste a supported public deck URL.');return}
    host.innerHTML='<strong>'+esc(provider.site)+' DECK LINK · '+esc(detectedUrl.confidence.toUpperCase())+' CONFIDENCE</strong>'+
      'Direct import: '+esc(provider.directImport)+'. Browser/CORS or site protections may prevent a safe fetch.<br><br>'+esc(provider.getManualInstructions());
  }
  async function tryUrlImport(){
    const provider=detectedUrl?.provider;if(!provider)return;
    const host=$('url-detection');host.innerHTML='<strong>TRYING '+esc(provider.site.toUpperCase())+'…</strong>Checking for a safe public import path.';
    try{
      const result=await provider.fetchDeck(detectedUrl.normalizedUrl);
      if(!result?.text)throw new Error('No public decklist was returned.');
      $('deck-input').value=provider.parseExport(result.text);currentImport={providerId:provider.id,sourceType:provider.site+' URL',sourceUrl:detectedUrl.normalizedUrl};switchHub('paste');reviewAndMatch();
    }catch(error){
      host.innerHTML='<strong>DIRECT IMPORT UNAVAILABLE · YOUR DECK IS STILL SAFE</strong>'+esc(error.message||provider.getManualInstructions())+'<br><br>Use “Open Source Deck,” export/copy its text list, then choose “Paste Export Instead.”';
    }
  }

  async function reviewAndMatch(){
    let importText=$('deck-input').value;
    const textDetection=DI.detectProvider(importText);
    if(textDetection.provider?.id==='csv'){importText=textDetection.provider.parseExport(importText);$('deck-input').value=importText}
    if(!currentImport.sourceUrl&&textDetection.provider)currentImport={providerId:textDetection.provider.id,sourceType:textDetection.provider.site+' export',sourceUrl:''};
    const parsed=DL.parseDecklist(importText);entries=parsed.cards;ignored=parsed.ignored;
    if(!entries.length){setNotice('No card lines were recognized. Use a quantity before each card name, such as “1 Sol Ring”.');render();return}
    setNotice('');importButton.disabled=true;$('match-progress').classList.add('on');$('parse-note').textContent='Matching '+entries.length+' lines through Scryfall…';render();
    const unique=new Map();entries.forEach(entry=>{const key=[DL.normalizeName(entry.name),entry.set,entry.collector].join('|');if(!unique.has(key))unique.set(key,entry)});
    await runPool([...unique.values()],1,async seed=>{try{seed.card=await scryfallLookup(seed);seed.status='matched'}catch(error){seed.status=/ambiguous/i.test(error.message)?'ambiguous':'unmatched';seed.error=error.message}});
    const byKey=new Map([...unique.values()].map(entry=>[[DL.normalizeName(entry.name),entry.set,entry.collector].join('|'),entry]));
    entries=entries.map(entry=>{const match=byKey.get([DL.normalizeName(entry.name),entry.set,entry.collector].join('|'));return{...entry,card:match.card,status:match.status,error:match.error}});
    const commander=entries.find(entry=>entry.section==='Commander'&&entry.card);if(commander&&!$('deck-commander').value)$('deck-commander').value=commander.card.name;
    const colors=[...new Set(entries.flatMap(entry=>entry.card?.color_identity||[]))].join('');if(colors&&!$('deck-colors').value)$('deck-colors').value=colors;
    importButton.disabled=false;$('match-progress').classList.remove('on');$('parse-note').textContent=entries.filter(entry=>entry.status==='matched').length+' matched · '+entries.filter(entry=>entry.status!=='matched').length+' unresolved'+(ignored.length?' · '+ignored.length+' ignored line(s)':'');
    refreshInventoryMatches();showImportReview();
  }
  function showImportReview(){
    const metrics=DL.analyze(entries),categories=[...new Set(entries.map(entry=>entry.category).filter(Boolean))],matched=entries.filter(entry=>entry.status==='matched').reduce((sum,entry)=>sum+entry.quantity,0),unmatched=entries.filter(entry=>entry.status!=='matched').reduce((sum,entry)=>sum+entry.quantity,0),printing=entries.filter(entry=>entry.set||entry.collector).reduce((sum,entry)=>sum+entry.quantity,0),commanderCount=metrics.counts.Commander||0;
    $('review-deck-name').value=$('deck-name').value||($('deck-commander').value?$('deck-commander').value+' Deck':'Imported Deck');
    $('review-stats').innerHTML=[['MAIN',metrics.counts.Mainboard||0],['SIDE',metrics.counts.Sideboard||0],['MAYBE',metrics.counts.Maybeboard||0],['MATCHED',matched],['UNMATCHED',unmatched],['PRINT DATA',printing],['COMMANDER',commanderCount],['CATEGORIES',categories.length]].map(([label,value])=>'<div class="review-stat"><b>'+value+'</b><span>'+label+'</span></div>').join('');
    $('review-categories').textContent=categories.length?'Categories found: '+categories.join(', '):'No category headers were found; cards remain in their detected deck sections.';
    const commanderWarning=$('deck-format').value==='Commander'&&commanderCount!==1?'Commander warning: expected exactly 1 Commander card, found '+commanderCount+'. Review the section headers before confirming.':'';
    $('review-warning').textContent=commanderWarning||(unmatched?unmatched+' card(s) remain unmatched. They will stay visibly unresolved and are excluded from verified analysis.':'Ready to confirm. All imported card quantities matched through Scryfall.');
    $('import-review-overlay').hidden=false;
  }
  function confirmImport(){
    $('deck-name').value=$('review-deck-name').value.trim()||'Imported Deck';saveDeck(false);
    const metrics=DL.analyze(entries),compactEntries=entries.map(entry=>({...entry,inventoryMatches:undefined,selectedInventory:undefined,card:entry.card?{id:entry.card.id,name:entry.card.name,oracle_id:entry.card.oracle_id,set:entry.card.set,collector_number:entry.card.collector_number,type_line:entry.card.type_line,cmc:entry.card.cmc,oracle_text:entry.card.oracle_text,color_identity:entry.card.color_identity,prices:entry.card.prices}:null})),record={id:'recent_'+Date.now(),deckName:$('deck-name').value,commander:$('deck-commander').value.trim(),sourceType:currentImport.sourceType,providerId:currentImport.providerId,sourceUrl:currentImport.sourceUrl,importedAt:new Date().toISOString(),cardCount:metrics.total,unmatchedCount:metrics.unmatched,input:$('deck-input').value,profile:profile(),entries:compactEntries,ignored};
    recentRepo.upsert(record);
    if(currentImport.sourceUrl){const saved=sourceRepo.load().find(item=>item.sourceUrl===currentImport.sourceUrl);if(saved)sourceRepo.upsert({...saved,lastImportedAt:record.importedAt})}
    $('import-review-overlay').hidden=true;$('save-status').textContent='Imported '+new Date().toLocaleTimeString();renderRecent();renderSources();toast('Import confirmed and saved locally');
  }

  function renderSources(){
    const items=sourceRepo.load(),host=$('saved-sources');
    host.innerHTML=items.length?items.map(item=>'<div class="source-card" data-source-id="'+esc(item.id)+'"><div class="source-title">'+esc(item.deckName||'Saved source')+'</div><div class="source-meta">'+esc(item.commander||'Commander not set')+' · '+esc(item.sourceSite||'External source')+'<br>'+esc(item.tags||'No tags')+(item.notes?'<br>'+esc(item.notes):'')+'<br>Last imported: '+esc(item.lastImportedAt?new Date(item.lastImportedAt).toLocaleString():'Not yet imported')+'</div><div class="actions"><button class="btn" data-action="source-import">IMPORT AGAIN</button><button class="btn" data-action="source-open">OPEN SOURCE</button><button class="btn red" data-action="source-delete">DELETE</button></div></div>').join(''):'<div class="empty">No saved source decks yet. Save a public deck link above for quick return visits.</div>';
  }
  function saveSource(){
    const sourceUrl=DI.normalizeUrl($('source-url').value),detection=DI.detectProvider(sourceUrl);if(!sourceUrl||!detection.provider){toast('Use a supported public deck URL before saving this source');return}
    sourceRepo.upsert({deckName:$('source-name').value.trim()||'Saved '+detection.provider.site+' deck',commander:$('source-commander').value.trim(),sourceSite:detection.provider.site,providerId:detection.provider.id,sourceUrl,tags:$('source-tags').value.trim(),notes:$('source-notes').value.trim(),lastImportedAt:''});
    ['source-name','source-commander','source-url','source-tags','source-notes'].forEach(id=>$(id).value='');renderSources();toast('Source deck saved locally');
  }
  function renderRecent(){
    const items=recentRepo.load(),host=$('recent-imports');
    host.innerHTML=items.length?items.map(item=>'<div class="source-card" data-recent-id="'+esc(item.id)+'"><div class="source-title">'+esc(item.deckName||'Imported deck')+'</div><div class="source-meta">'+esc(item.commander||'Commander not detected')+' · '+esc(item.sourceType||'Pasted decklist')+'<br>'+new Date(item.importedAt).toLocaleString()+' · '+Number(item.cardCount||0)+' cards · '+Number(item.unmatchedCount||0)+' unmatched</div><div class="actions"><button class="btn" data-action="recent-open">REOPEN</button><button class="btn gold" data-action="recent-reimport">REIMPORT</button><button class="btn red" data-action="recent-delete">DELETE</button></div></div>').join(''):'<div class="empty">No recent imports yet. Confirm an import to keep a local, store-scoped history.</div>';
  }
  function reopenRecent(item){$('deck-input').value=item.input||'';entries=item.entries||[];ignored=item.ignored||[];applyProfile(item.profile||{});currentImport={providerId:item.providerId||'plain',sourceType:item.sourceType||'Recent import',sourceUrl:item.sourceUrl||''};refreshInventoryMatches();switchHub('paste');toast('Recent import reopened')}

  importButton.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();reviewAndMatch()},true);
  document.querySelectorAll('.hub-tab').forEach(button=>button.addEventListener('click',()=>switchHub(button.dataset.importView)));
  $('import-url').addEventListener('input',detectUrl);$('try-url-import').addEventListener('click',tryUrlImport);$('open-source-deck').addEventListener('click',()=>detectedUrl?.normalizedUrl&&safeOpen(detectedUrl.normalizedUrl));$('paste-export-instead').addEventListener('click',()=>{switchHub('paste');$('deck-input').focus()});
  document.querySelectorAll('[data-search-provider]').forEach(button=>button.addEventListener('click',()=>safeOpen(DI.externalSearchUrl(button.dataset.searchProvider,$('external-search').value))));$('save-source-btn').addEventListener('click',saveSource);
  $('saved-sources').addEventListener('click',event=>{const action=event.target.dataset.action,card=event.target.closest('[data-source-id]');if(!action||!card)return;const item=sourceRepo.load().find(row=>row.id===card.dataset.sourceId);if(!item)return;if(action==='source-delete')sourceRepo.remove(item.id);if(action==='source-open')safeOpen(item.sourceUrl);if(action==='source-import'){$('import-url').value=item.sourceUrl;switchHub('url');detectUrl()}renderSources()});
  $('recent-imports').addEventListener('click',event=>{const action=event.target.dataset.action,card=event.target.closest('[data-recent-id]');if(!action||!card)return;const item=recentRepo.load().find(row=>row.id===card.dataset.recentId);if(!item)return;if(action==='recent-delete')recentRepo.remove(item.id);if(action==='recent-open')reopenRecent(item);if(action==='recent-reimport'){reopenRecent(item);reviewAndMatch()}renderRecent()});
  $('confirm-import').addEventListener('click',confirmImport);$('fix-unmatched').addEventListener('click',()=>{$('import-review-overlay').hidden=true;switchHub('paste');setNotice('Edit unresolved card names or printing details in the pasted list, then review the import again.');$('deck-input').focus()});$('back-to-paste').addEventListener('click',()=>{$('import-review-overlay').hidden=true;switchHub('paste')});$('review-export').addEventListener('click',()=>download('arsca-cleaned-decklist.txt',DL.cleanedDecklist(entries)));
  ['deck-name'].forEach(id=>$(id).addEventListener('change',render));
  try{const saved=JSON.parse(localStorage.getItem(deckKey)||'null');if(saved?.profile?.name)$('deck-name').value=saved.profile.name}catch(e){}
  renderSources();renderRecent();
})();
