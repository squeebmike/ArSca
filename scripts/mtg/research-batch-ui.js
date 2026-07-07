(function(){
  'use strict';
  const API = window.ArsCaMtgResearchBatch;
  if(!API) return;

  const repo = API.repository(localStorage);
  let state = { batch:null, parsed:null, filter:'all', hideExcluded:false, selected:new Set(), busy:false };
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const price = value => value === 0 || value ? '$' + Number(value).toFixed(2) : 'No price';
  const imgFor = card => card?.imageUrl || card?.image_uris?.small || card?.image_uris?.normal || card?.card_faces?.[0]?.image_uris?.small || '';

  function installStyles(){
    if($('mtg-research-batch-style')) return;
    const style = document.createElement('style');
    style.id = 'mtg-research-batch-style';
    style.textContent = `
      .mrb-modal{position:fixed;inset:0;z-index:4200;background:rgba(0,0,0,.86);display:none;align-items:stretch;justify-content:center;overflow:hidden}
      .mrb-modal.on{display:flex}.mrb-shell{width:min(1760px,100vw);height:100dvh;background:var(--bg);border-left:1px solid var(--border);border-right:1px solid var(--border);display:flex;flex-direction:column;min-width:0}
      .mrb-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border);background:var(--surf)}
      .mrb-title{font-family:'Orbitron',var(--font-mono);font-size:18px;color:#5ba3f5}.mrb-sub{font-family:var(--font-mono);font-size:11px;color:var(--dim);line-height:1.5}
      .mrb-body{display:grid;grid-template-columns:minmax(320px,430px) minmax(0,1fr);gap:14px;min-height:0;flex:1;padding:14px;overflow:hidden}
      .mrb-panel{border:1px solid var(--border);border-radius:10px;background:var(--surf);padding:12px;min-width:0;overflow:auto}.mrb-panel h3{margin:0 0 8px;font-size:15px;color:var(--text)}
      .mrb-field{display:grid;gap:5px;font-family:var(--font-mono);font-size:10px;color:var(--dim);margin-bottom:9px}.mrb-input,.mrb-select,.mrb-textarea{width:100%;background:var(--surf2);border:1px solid var(--border);border-radius:8px;color:var(--text);font:13px var(--font-mono);padding:9px 10px}.mrb-textarea{min-height:190px;resize:vertical;line-height:1.45}
      .mrb-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.mrb-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:10px 0}.mrb-stat{border:1px solid var(--border);border-radius:8px;background:var(--surf2);padding:9px}.mrb-stat b{font-size:19px;color:var(--text)}.mrb-stat span{display:block;font-family:var(--font-mono);font-size:9px;color:var(--dim);margin-top:3px}
      .mrb-saved{display:grid;gap:8px}.mrb-saved-card{border:1px solid var(--border);border-radius:8px;padding:9px;background:var(--surf2)}.mrb-saved-title{font-weight:800;color:var(--text);font-size:13px}.mrb-meta{font-family:var(--font-mono);font-size:10px;color:var(--dim);line-height:1.55}
      .mrb-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.mrb-table-wrap{overflow:auto;border:1px solid var(--border);border-radius:10px}.mrb-table{width:100%;border-collapse:collapse;min-width:1200px}.mrb-table th,.mrb-table td{border-bottom:1px solid var(--border);padding:9px;vertical-align:top;text-align:left;font-size:12px}.mrb-table th{font:10px var(--font-mono);color:var(--dim);background:var(--surf2);position:sticky;top:0;z-index:1}
      .mrb-card-cell{display:grid;grid-template-columns:54px minmax(0,1fr);gap:10px;align-items:start}.mrb-thumb{width:54px;height:76px;border-radius:5px;object-fit:cover;border:1px solid var(--border);background:#050508}.mrb-no-img{width:54px;height:76px;border:1px dashed var(--border);border-radius:5px;display:grid;place-items:center;font:9px var(--font-mono);color:var(--dim)}
      .mrb-name{font-weight:800;font-size:14px;color:var(--text);line-height:1.25}.mrb-badge{display:inline-flex;border:1px solid var(--border);border-radius:999px;padding:3px 7px;font:9px var(--font-mono);color:var(--dim);margin:2px 3px 2px 0}.mrb-badge.ok{color:var(--g);border-color:rgba(0,255,179,.35)}.mrb-badge.warn{color:var(--gold);border-color:rgba(255,209,102,.36)}.mrb-badge.bad{color:var(--red);border-color:rgba(255,77,109,.34)}
      .mrb-small-input{width:72px;background:var(--surf2);border:1px solid var(--border);border-radius:7px;color:var(--text);padding:7px;font:12px var(--font-mono)}.mrb-note{min-width:170px}.mrb-warning{border:1px solid rgba(255,209,102,.35);background:rgba(255,209,102,.08);color:var(--gold);border-radius:8px;padding:9px 10px;font:11px var(--font-mono);line-height:1.45;margin-bottom:10px}
      @media(max-width:760px){.mrb-body{grid-template-columns:1fr;overflow:auto}.mrb-shell{height:100dvh}.mrb-panel{overflow:visible}.mrb-head{align-items:flex-start}.mrb-title{font-size:15px}.mrb-table{min-width:980px}}
    `;
    document.head.appendChild(style);
  }

  function ensureModal(){
    installStyles();
    if($('mtg-research-batch-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'mtg-research-batch-modal';
    modal.className = 'mrb-modal';
    modal.innerHTML = `
      <div class="mrb-shell">
        <div class="mrb-head">
          <div><div class="mrb-title">MTG RESEARCH BATCH</div><div class="mrb-sub">Saved locally on this device. Not synced to cloud yet.</div></div>
          <div class="mrb-actions"><button class="hbtn" onclick="mtgResearchBatchContinue()">CONTINUE TO RESULTS</button><button class="hbtn" onclick="closeMtgResearchBatch()">CLOSE</button></div>
        </div>
        <div class="mrb-body">
          <aside class="mrb-panel">
            <h3>Import Card List</h3>
            <div class="mrb-warning">Paste or upload a messy MTG list. URL imports are fallback-only for now: open the source app, export/copy the card list, and paste it here.</div>
            <label class="mrb-field">Batch name<input id="mrb-name" class="mrb-input" placeholder="Saturday appraisal pile"></label>
            <label class="mrb-field">Source type<select id="mrb-source" class="mrb-select">${API.SOURCE_TYPES.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
            <label class="mrb-field">Paste list<textarea id="mrb-input" class="mrb-textarea" placeholder="1 Sol Ring (CMM) 400 NM Foil&#10;Lightning Bolt&#10;4 Counterspell"></textarea></label>
            <label class="mrb-field">Upload .txt/.csv<input id="mrb-file" type="file" accept=".txt,.csv,text/plain,text/csv" class="mrb-input"></label>
            <div class="mrb-actions"><button class="hbtn" onclick="mtgResearchBatchParse()">PARSE LIST</button><button class="hbtn" onclick="mtgResearchBatchSample()">SAMPLE LIST</button><button class="hbtn" onclick="mtgResearchBatchClear()">CLEAR</button></div>
            <div id="mrb-review"></div>
            <h3 style="margin-top:16px">Saved Batches</h3>
            <div id="mrb-saved" class="mrb-saved"></div>
          </aside>
          <main class="mrb-panel">
            <div class="mrb-toolbar">
              <button class="hbtn" onclick="mtgResearchBatchSave()">SAVE BATCH</button>
              <button class="hbtn" onclick="mtgResearchBatchAddManual()">ADD CARD</button>
              <button class="hbtn" onclick="mtgResearchBatchBulk('include')">BULK INCLUDE</button>
              <button class="hbtn" onclick="mtgResearchBatchBulk('exclude')">BULK EXCLUDE</button>
              <button class="hbtn" onclick="mtgResearchBatchRemoveExcluded()">REMOVE EXCLUDED</button>
              <label class="mrb-field" style="margin:0;min-width:170px">Filter<select id="mrb-filter" class="mrb-select" onchange="stateMrbFilter(this.value)"><option value="all">All</option><option value="included">Included</option><option value="excluded">Excluded</option><option value="unmatched">Unmatched</option><option value="ambiguous">Ambiguous</option></select></label>
              <label class="mrb-field" style="margin:0;display:flex;align-items:center;gap:7px"><input id="mrb-hide-excluded" type="checkbox" onchange="stateMrbHideExcluded(this.checked)"> Hide excluded</label>
            </div>
            <div id="mrb-results"><div class="empty"><div class="empty-t">NO BATCH OPEN</div><p>Paste a list, parse it, then save locally.</p></div></div>
          </main>
        </div>
      </div>`;
    modal.addEventListener('click', e => { if(e.target === modal) closeMtgResearchBatch(); });
    document.body.appendChild(modal);
    $('mrb-file').addEventListener('change', readFile);
    renderSaved();
  }

  function readFile(event){
    const file = event.target.files?.[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => { $('mrb-input').value = String(reader.result || ''); if(!$('mrb-name').value) $('mrb-name').value = file.name.replace(/\.[^.]+$/, ''); };
    reader.readAsText(file);
  }

  window.openMtgResearchBatch = function(){
    ensureModal();
    $('mtg-research-batch-modal').classList.add('on');
    renderSaved();
    renderResults();
  };
  window.closeMtgResearchBatch = function(){ $('mtg-research-batch-modal')?.classList.remove('on'); };

  window.mtgResearchBatchSample = function(){
    $('mrb-name').value = $('mrb-name').value || 'Sample MTG appraisal pile';
    $('mrb-input').value = `Exported from MTGGoldfish
Artifacts (3)
1 Sol Ring (CMM) 400 NM Foil $1.25
1x Arcane Signet
Command Tower
4 Lightning Bolt (M10) 146 LP
Counterspell
Swords to Plowshares
Beast Within
Fire // Ice
Fable of the Mirror-Breaker`;
  };

  window.mtgResearchBatchClear = function(){
    $('mrb-input').value = '';
    state.batch = null; state.parsed = null; state.selected.clear();
    renderReview(); renderResults();
  };

  window.mtgResearchBatchParse = async function(){
    const raw = $('mrb-input').value;
    const parsed = API.parseList(raw, $('mrb-source').value);
    state.parsed = parsed;
    state.batch = API.createBatch({ name:$('mrb-name').value.trim() || 'MTG Research Batch', sourceType:$('mrb-source').value, rawInput:raw, cards:parsed.cards, ignored:parsed.ignored });
    renderReview();
    renderResults();
    await matchBatch();
  };

  async function matchBatch(){
    if(!state.batch || state.busy) return;
    state.busy = true; renderReview();
    for(const row of state.batch.cards){
      if(row.matchStatus === 'matched' && row.candidatePrintings?.length) continue;
      try {
        const candidates = await fetchPrintings(row);
        row.candidatePrintings = candidates;
        if(!candidates.length){ row.matchStatus = 'unmatched'; row.error = 'No Scryfall candidates'; continue; }
        const exact = chooseExact(row, candidates);
        row.selectedPrinting = exact || candidates[0];
        row.matchStatus = exact || row.matchMode === 'all-printings' ? 'matched' : 'ambiguous';
        row.matchConfidence = exact ? 98 : row.matchMode === 'all-printings' ? 86 : 72;
        row.error = '';
      } catch(e) {
        row.matchStatus = 'unmatched';
        row.error = e.message || 'Scryfall failed';
      }
      renderReview();
      renderResults();
      await new Promise(r => setTimeout(r, 80));
    }
    state.busy = false;
    renderReview(); renderResults();
  }

  async function fetchPrintings(row){
    if(row.setCode && row.collectorNumber){
      const res = await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(row.setCode)}/${encodeURIComponent(row.collectorNumber)}`);
      if(res.ok) return [scryfallToPrinting(await res.json())];
    }
    const qParts = [`!"${row.cleanedName}"`];
    if(row.setCode) qParts.push('set:' + row.setCode);
    else if(row.setName) qParts.push('set:"' + row.setName + '"');
    else if(row.collectorNumber) qParts.push('cn:' + row.collectorNumber);
    const res = await fetch('https://api.scryfall.com/cards/search?q=' + encodeURIComponent(qParts.join(' ')) + '&unique=prints&order=released&dir=desc', { headers:{ Accept:'application/json' } });
    if(!res.ok && row.matchMode !== 'all-printings'){
      return fetchPrintings({ ...row, setCode:'', setName:'', collectorNumber:'', matchMode:'all-printings' });
    }
    const data = await res.json().catch(() => ({}));
    return (data.data || []).slice(0, 40).map(scryfallToPrinting);
  }

  function scryfallToPrinting(c){
    return {
      scryfallId:c.id || '',
      name:c.name || '',
      setName:c.set_name || '',
      setCode:(c.set || '').toUpperCase(),
      collectorNumber:c.collector_number || '',
      rarity:c.rarity || '',
      finishes:Array.isArray(c.finishes) ? c.finishes : [],
      prices:{ usd:c.prices?.usd ?? null, usdFoil:c.prices?.usd_foil ?? null, usdEtched:c.prices?.usd_etched ?? null, eur:c.prices?.eur ?? null, tix:c.prices?.tix ?? null },
      imageUrl:c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small || '',
      normalImage:c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || '',
      typeLine:c.type_line || '',
      raw:c,
    };
  }

  function chooseExact(row, candidates){
    return candidates.find(c => row.setCode && c.setCode.toLowerCase() === row.setCode.toLowerCase() && (!row.collectorNumber || String(c.collectorNumber).toLowerCase() === String(row.collectorNumber).toLowerCase()))
      || candidates.find(c => row.setName && c.setName.toLowerCase().includes(row.setName.toLowerCase()) && (!row.collectorNumber || String(c.collectorNumber).toLowerCase() === String(row.collectorNumber).toLowerCase()))
      || null;
  }

  function renderReview(){
    const host = $('mrb-review');
    if(!host || !state.batch){ host && (host.innerHTML = ''); return; }
    const s = API.batchSummary(state.batch);
    host.innerHTML = `<div class="mrb-stat-grid">${[
      ['RAW', state.batch.totalLines || 0], ['PARSED', state.batch.cards.length], ['SKIPPED', state.batch.ignored.length], ['MATCHED', s.matched], ['UNMATCHED', state.batch.cards.filter(c => c.matchStatus === 'unmatched').length], ['AMBIG', s.ambiguous], ['PRINT DATA', s.exactPrintings], ['ALL PRINTS', state.batch.cards.filter(c => c.matchMode === 'all-printings').length]
    ].map(([label,value]) => `<div class="mrb-stat"><b>${value}</b><span>${label}</span></div>`).join('')}</div>
    <div class="mrb-actions"><button class="hbtn" onclick="mtgResearchBatchSave()">SAVE BATCH</button><button class="hbtn" onclick="mtgResearchBatchContinue()">CONTINUE TO RESULTS</button><button class="hbtn" onclick="stateMrbFilter('unmatched')">FIX UNMATCHED</button><button class="hbtn" onclick="$('mrb-input').focus()">BACK TO PASTE</button></div>`;
  }

  function renderSaved(){
    const host = $('mrb-saved');
    if(!host) return;
    const rows = repo.load();
    host.innerHTML = rows.length ? rows.map(batch => {
      const s = API.batchSummary(batch);
      return `<div class="mrb-saved-card"><div class="mrb-saved-title">${esc(batch.name)}</div><div class="mrb-meta">${esc(batch.sourceType)} · created ${new Date(batch.createdAt).toLocaleString()}<br>updated ${new Date(batch.updatedAt).toLocaleString()} · ${s.totalLines} lines · ${s.matched} matched · ${s.unresolved} unresolved · ${s.included} active</div><div class="mrb-actions" style="margin-top:8px"><button class="hbtn" onclick="mtgResearchBatchOpen('${esc(batch.id)}')">OPEN</button><button class="hbtn" onclick="mtgResearchBatchDuplicate('${esc(batch.id)}')">DUPLICATE</button><button class="hbtn" onclick="mtgResearchBatchDelete('${esc(batch.id)}')">DELETE</button></div></div>`;
    }).join('') : '<div class="empty"><div class="empty-t">NO SAVED BATCHES</div></div>';
  }

  function filteredCards(){
    const cards = state.batch?.cards || [];
    return cards.filter(card => {
      if(state.hideExcluded && card.included === false) return false;
      if(state.filter === 'included') return card.included !== false;
      if(state.filter === 'excluded') return card.included === false;
      if(state.filter === 'unmatched') return card.matchStatus === 'unmatched';
      if(state.filter === 'ambiguous') return card.matchStatus === 'ambiguous';
      return true;
    });
  }

  function renderResults(){
    const host = $('mrb-results');
    if(!host) return;
    if(!state.batch){ host.innerHTML = '<div class="empty"><div class="empty-t">NO BATCH OPEN</div><p>Paste a list, parse it, then save locally.</p></div>'; return; }
    const rows = filteredCards();
    host.innerHTML = `<div class="mrb-table-wrap"><table class="mrb-table"><thead><tr><th>APPRAISE</th><th>QTY</th><th>CARD</th><th>PRINTING / PRICE</th><th>COND</th><th>MATCH</th><th>NOTES</th><th>ACTION</th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`;
  }

  function rowHtml(row){
    const p = row.selectedPrinting || {};
    const image = imgFor(p);
    const statusClass = row.matchStatus === 'matched' ? 'ok' : row.matchStatus === 'ambiguous' ? 'warn' : row.matchStatus === 'unmatched' ? 'bad' : '';
    return `<tr data-row-id="${esc(row.id)}">
      <td><input type="checkbox" ${row.included !== false ? 'checked' : ''} onchange="mtgResearchBatchUpdate('${esc(row.id)}','included',this.checked)"><br><input type="checkbox" onchange="mtgResearchBatchSelect('${esc(row.id)}',this.checked)"></td>
      <td><input class="mrb-small-input" type="number" min="1" value="${Number(row.quantity || 1)}" onchange="mtgResearchBatchUpdate('${esc(row.id)}','quantity',this.value)"></td>
      <td><div class="mrb-card-cell">${image ? `<img class="mrb-thumb" src="${esc(image)}" loading="lazy">` : '<div class="mrb-no-img">NO IMG</div>'}<div><div class="mrb-name">${esc(p.name || row.parsedName)}</div><div class="mrb-meta">Raw: ${esc(row.rawLine)}</div><div class="mrb-meta">Parsed: ${esc(row.cleanedName)}</div></div></div></td>
      <td><div>${esc([p.setName, p.setCode, p.collectorNumber ? '#'+p.collectorNumber : ''].filter(Boolean).join(' · ') || 'All printings available')}</div><div class="mrb-meta">${esc(p.rarity || '')} ${row.finish ? '· '+esc(row.finish) : ''}</div><div><span class="mrb-badge ok">USD ${esc(price(p.prices?.usd))}</span><span class="mrb-badge">FOIL ${esc(price(p.prices?.usdFoil))}</span></div><button class="hbtn" onclick="mtgResearchBatchChoosePrinting('${esc(row.id)}')" style="margin-top:6px">CHOOSE PRINTING</button></td>
      <td><select class="mrb-select" onchange="mtgResearchBatchUpdate('${esc(row.id)}','condition',this.value)">${API.CONDITIONS.map(c => `<option ${row.condition === c ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
      <td><span class="mrb-badge ${statusClass}">${esc(row.matchStatus)}</span><div class="mrb-meta">${esc(row.matchMode)} · ${Number(row.matchConfidence || 0)}%</div><div class="mrb-meta">${esc(row.error || '')}</div></td>
      <td><input class="mrb-input mrb-note" value="${esc(row.notes || '')}" onchange="mtgResearchBatchUpdate('${esc(row.id)}','notes',this.value)"></td>
      <td><button class="hbtn" onclick="mtgResearchBatchRemove('${esc(row.id)}')">REMOVE</button>${row.included === false ? `<button class="hbtn" onclick="mtgResearchBatchUpdate('${esc(row.id)}','included',true)">RESTORE</button>` : ''}</td>
    </tr>`;
  }

  function findRow(id){ return state.batch?.cards?.find(card => card.id === id); }
  window.stateMrbFilter = value => { state.filter = value; if($('mrb-filter')) $('mrb-filter').value = value; renderResults(); };
  window.stateMrbHideExcluded = value => { state.hideExcluded = !!value; renderResults(); };
  window.mtgResearchBatchSelect = (id, checked) => checked ? state.selected.add(id) : state.selected.delete(id);
  window.mtgResearchBatchUpdate = (id, field, value) => { const row = findRow(id); if(!row) return; row[field] = field === 'quantity' ? Math.max(1, Number(value || 1)) : value; renderReview(); };
  window.mtgResearchBatchRemove = id => { if(!state.batch) return; state.batch.cards = state.batch.cards.filter(card => card.id !== id); renderReview(); renderResults(); };
  window.mtgResearchBatchBulk = mode => { (state.batch?.cards || []).forEach(card => { if(!state.selected.size || state.selected.has(card.id)) card.included = mode === 'include'; }); renderReview(); renderResults(); };
  window.mtgResearchBatchRemoveExcluded = () => { if(!state.batch || !confirm('Remove all excluded cards from this local batch?')) return; state.batch.cards = state.batch.cards.filter(card => card.included !== false); renderReview(); renderResults(); };
  window.mtgResearchBatchAddManual = async () => { const name = prompt('Card name to add:'); if(!name || !state.batch) return; const row = API.parseLine(name, state.batch.cards.length + 1); state.batch.cards.push(row); renderResults(); await matchBatch(); };
  window.mtgResearchBatchChoosePrinting = id => {
    const row = findRow(id);
    if(!row?.candidatePrintings?.length) return alert('No printings available yet. Retry parsing/matching first.');
    const list = row.candidatePrintings.slice(0, 20).map((p, i) => `${i + 1}. ${p.name} - ${p.setName} ${p.setCode} #${p.collectorNumber} ${price(p.prices?.usd)}`).join('\n');
    const choice = Number(prompt('Choose printing number:\n' + list, '1'));
    if(choice > 0 && row.candidatePrintings[choice - 1]){ row.selectedPrinting = row.candidatePrintings[choice - 1]; row.matchStatus = 'matched'; renderResults(); }
  };
  window.mtgResearchBatchSave = function(){ if(!state.batch) return; state.batch = repo.save(state.batch); renderSaved(); renderReview(); if(window.toast_dash) toast_dash('MTG batch saved locally'); };
  window.mtgResearchBatchOpen = function(id){ const batch = repo.load().find(row => row.id === id); if(!batch) return; state.batch = batch; $('mrb-name').value = batch.name || ''; $('mrb-source').value = batch.sourceType || API.SOURCE_TYPES[0]; $('mrb-input').value = batch.rawInput || ''; renderReview(); renderResults(); };
  window.mtgResearchBatchDuplicate = function(id){ repo.duplicate(id); renderSaved(); };
  window.mtgResearchBatchDelete = function(id){ if(confirm('Delete this local MTG research batch?')){ repo.remove(id); if(state.batch?.id === id) state.batch = null; renderSaved(); renderReview(); renderResults(); } };
  window.mtgResearchBatchContinue = function(){
    const rows = (state.batch?.cards || []).filter(card => card.included !== false && card.selectedPrinting?.raw);
    if(!rows.length) return alert('No matched included cards to send to Research yet.');
    if(typeof scryfallCardToQplRow === 'function' && typeof renderQuickLookupResults === 'function'){
      qplResults = rows.map(row => ({ ...scryfallCardToQplRow(row.selectedPrinting.raw), qty:row.quantity, condition:row.condition, selectedCondition:row.condition, note:[row.notes, 'MTG research batch: '+(state.batch.name || '')].filter(Boolean).join(' · ') })).filter(Boolean);
      qplMasterResults = qplResults;
      qplLastSearch = state.batch.name || 'MTG Research Batch';
      closeMtgResearchBatch();
      switchTab('research');
      renderQuickLookupResults(qplResults);
      document.getElementById('qpl-result')?.scrollIntoView({ behavior:'smooth', block:'start' });
    }
  };
})();
