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
  const conditionMult = { NM:1, LP:.85, MP:.70, HP:.50, DMG:.35 };
  const finishLabel = value => value === 'foil' ? 'Foil' : value === 'etched' ? 'Etched' : 'Normal';
  function finishPrice(printing, finish){
    const p = printing?.prices || {};
    if(finish === 'foil') return p.usdFoil ?? p.usd ?? null;
    if(finish === 'etched') return p.usdEtched ?? p.usdFoil ?? p.usd ?? null;
    return p.usd ?? p.usdFoil ?? p.usdEtched ?? null;
  }
  function adjustedPrice(row){
    const base = finishPrice(row.selectedPrinting, row.finish);
    if(base == null || base === '') return null;
    return Math.round(Number(base) * (conditionMult[row.condition || 'NM'] ?? 1) * 100) / 100;
  }
  function conditionPills(row){
    const base = finishPrice(row.selectedPrinting, row.finish);
    if(base == null || base === '') return '<span class="mrb-badge">No price</span>';
    return API.CONDITIONS.map(c => `<span class="mrb-badge ${row.condition === c ? 'ok' : ''}">${c} ${price(Number(base) * (conditionMult[c] ?? 1))}</span>`).join('');
  }
  function availableFinishes(row){
    const p = row.selectedPrinting?.prices || {};
    const out = ['normal', row.finish].filter(Boolean);
    if(p.usdFoil != null || row.selectedPrinting?.finishes?.includes?.('foil')) out.push('foil');
    if(p.usdEtched != null || row.selectedPrinting?.finishes?.includes?.('etched')) out.push('etched');
    return [...new Set(out)];
  }
  function normName(value){
    return String(value || '').toLowerCase().replace(/\/\/.*$/, '').replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
  }
  function invQty(item){
    const raw = item?.qty ?? item?.quantity ?? item?.count ?? 1;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  function rowInventoryCount(row){
    const inv = Array.isArray(window.all) ? window.all : [];
    const targets = [row.selectedPrinting?.name, row.cleanedName, row.parsedName].map(normName).filter(Boolean);
    if(!targets.length) return 0;
    return inv.reduce((sum, item) => {
      const status = String(item?.status || '').toLowerCase();
      if(status.includes('sold') || status.includes('archiv')) return sum;
      const text = [item?.name, item?.title, item?.cardName, item?.productName, item?.displayName].map(normName).filter(Boolean);
      const match = text.some(name => targets.includes(name) || targets.some(target => name === target || name.startsWith(target + ' ')));
      return match ? sum + invQty(item) : sum;
    }, 0);
  }

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
      .mrb-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.mrb-table-wrap{overflow:visible;border:0;border-radius:0}.mrb-table{display:block;width:100%;min-width:0;border-collapse:separate}.mrb-table thead{display:none}.mrb-table tbody{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(760px,100%),1fr));gap:12px}.mrb-table tr{display:grid;grid-template-columns:86px 74px minmax(250px,1.25fr) minmax(250px,1.05fr) minmax(170px,.75fr);grid-template-areas:'checks qty card price meta' 'checks qty card price match' 'notes notes notes actions actions';gap:10px;align-items:start;border:1px solid var(--border);border-radius:10px;background:var(--surf2);padding:11px}.mrb-table td{display:block;border:0!important;padding:0!important;vertical-align:top;text-align:left;font-size:13px;min-width:0}.mrb-table td:nth-child(1){grid-area:checks}.mrb-table td:nth-child(2){grid-area:qty}.mrb-table td:nth-child(3){grid-area:card}.mrb-table td:nth-child(4){grid-area:price}.mrb-table td:nth-child(5){grid-area:meta}.mrb-table td:nth-child(6){grid-area:match}.mrb-table td:nth-child(7){grid-area:notes}.mrb-table td:nth-child(8){grid-area:actions}
      .mrb-card-cell{display:grid;grid-template-columns:82px minmax(0,1fr);gap:12px;align-items:start}.mrb-thumb{width:82px;height:114px;border-radius:6px;object-fit:cover;border:1px solid var(--border);background:#050508;cursor:zoom-in}.mrb-no-img{width:82px;height:114px;border:1px dashed var(--border);border-radius:6px;display:grid;place-items:center;font:9px var(--font-mono);color:var(--dim)}
      .mrb-name{font-weight:800;font-size:14px;color:var(--text);line-height:1.25}.mrb-badge{display:inline-flex;border:1px solid var(--border);border-radius:999px;padding:3px 7px;font:9px var(--font-mono);color:var(--dim);margin:2px 3px 2px 0}.mrb-badge.ok{color:var(--g);border-color:rgba(0,255,179,.35)}.mrb-badge.warn{color:var(--gold);border-color:rgba(255,209,102,.36)}.mrb-badge.bad{color:var(--red);border-color:rgba(255,77,109,.34)}
      .mrb-small-input{width:72px;background:var(--surf2);border:1px solid var(--border);border-radius:7px;color:var(--text);padding:7px;font:12px var(--font-mono)}.mrb-note{min-width:0}.mrb-warning{border:1px solid rgba(255,209,102,.35);background:rgba(255,209,102,.08);color:var(--gold);border-radius:8px;padding:9px 10px;font:11px var(--font-mono);line-height:1.45;margin-bottom:10px}
      .mrb-checks{display:grid;gap:8px;font:9px var(--font-mono);color:var(--dim);min-width:0}.mrb-checks label{display:flex;gap:6px;align-items:center}.mrb-price-main{font:17px var(--font-mono);color:var(--g);font-weight:800;margin:4px 0}.mrb-stock{font:11px var(--font-mono);margin-top:6px;color:var(--dim)}.mrb-stock b{color:var(--g)}.mrb-printing-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}.mrb-printing-card{border:1px solid var(--border);border-radius:8px;background:var(--surf);padding:10px;display:grid;gap:8px}.mrb-printing-card img{width:100%;max-height:260px;object-fit:contain;background:#050508;border-radius:6px;cursor:zoom-in}.mrb-lightbox{position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.9);display:none;align-items:center;justify-content:center;padding:24px}.mrb-lightbox.on{display:flex}.mrb-lightbox img{max-width:min(92vw,620px);max-height:88vh;border-radius:10px}.mrb-picker{position:fixed;inset:0;z-index:4900;background:rgba(0,0,0,.82);display:none;padding:24px;overflow:auto}.mrb-picker.on{display:block}.mrb-picker-inner{max-width:1400px;margin:0 auto;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px}
      @media(max-width:1180px){.mrb-body{grid-template-columns:minmax(280px,360px) minmax(0,1fr)}.mrb-table tbody{grid-template-columns:1fr}.mrb-table tr{grid-template-columns:84px 74px minmax(240px,1fr) minmax(240px,1fr);grid-template-areas:'checks qty card price' 'checks qty meta match' 'notes notes notes actions'}}@media(max-width:1050px){.mrb-body{grid-template-columns:1fr;overflow:auto}.mrb-panel{overflow:visible}}@media(max-width:760px){.mrb-shell{height:100dvh}.mrb-head{align-items:flex-start}.mrb-title{font-size:15px}.mrb-table tbody{grid-template-columns:1fr}.mrb-table tr{grid-template-columns:74px minmax(0,1fr);grid-template-areas:'checks qty' 'card card' 'price price' 'meta meta' 'match match' 'notes notes' 'actions actions';gap:9px}.mrb-card-cell{grid-template-columns:72px minmax(0,1fr)}.mrb-thumb,.mrb-no-img{width:72px;height:100px}.mrb-picker{padding:12px}.mrb-printing-grid{grid-template-columns:repeat(auto-fill,minmax(145px,1fr))}}
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
              <button class="hbtn" onclick="mtgResearchBatchSendToBuy()">SEND INCLUDED TO BUY</button>
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
      </div>
      <div class="mrb-lightbox" id="mrb-lightbox" onclick="this.classList.remove('on')"><img id="mrb-lightbox-img" alt=""></div>
      <div class="mrb-picker" id="mrb-printing-picker"></div>`;
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
    const tryFetch = async url => {
      try { return await fetch(url, { headers:{ Accept:'application/json' } }); }
      catch(e) { return null; }
    };
    const searchAll = () => fetchPrintings({ ...row, setCode:'', setName:'', collectorNumber:'', matchMode:'all-printings' });
    if(row.setCode && row.collectorNumber){
      const res = await tryFetch(`https://api.scryfall.com/cards/${encodeURIComponent(row.setCode)}/${encodeURIComponent(row.collectorNumber)}`);
      if(res?.ok) {
        const data = await res.json().catch(() => ({}));
        if(data?.name) return [scryfallToPrinting(data)];
      }
    }
    const qParts = [`!"${row.cleanedName}"`];
    if(row.setCode) qParts.push('set:' + row.setCode);
    else if(row.setName) qParts.push('set:"' + row.setName + '"');
    else if(row.collectorNumber) qParts.push('cn:' + row.collectorNumber);
    const res = await tryFetch('https://api.scryfall.com/cards/search?q=' + encodeURIComponent(qParts.join(' ')) + '&unique=prints&order=released&dir=desc');
    if(!res?.ok && row.matchMode !== 'all-printings') return searchAll();
    if(!res?.ok) throw new Error('Scryfall search failed');
    const data = await res.json().catch(() => ({}));
    return (data.data || []).filter(card => card?.name).slice(0, 40).map(scryfallToPrinting);
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
    host.innerHTML = `<div class="mrb-table-wrap"><table class="mrb-table"><thead><tr><th>INCLUDE / SELECT</th><th>QTY</th><th>CARD</th><th>PRINTING / PRICE</th><th>COND / FINISH</th><th>MATCH</th><th>NOTES</th><th>ACTION</th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`;
  }

  function rowHtml(row){
    const p = row.selectedPrinting || row.candidatePrintings?.[0] || {};
    const image = imgFor(p);
    const statusClass = row.matchStatus === 'matched' ? 'ok' : row.matchStatus === 'ambiguous' ? 'warn' : row.matchStatus === 'unmatched' ? 'bad' : '';
    const adj = adjustedPrice(row);
    const finishOptions = availableFinishes(row).map(f => `<option value="${esc(f)}" ${row.finish === f ? 'selected' : ''}>${finishLabel(f)}</option>`).join('');
    const inStock = rowInventoryCount(row);
    return `<tr data-row-id="${esc(row.id)}">
      <td><div class="mrb-checks"><label><input type="checkbox" ${row.included !== false ? 'checked' : ''} onchange="mtgResearchBatchUpdate('${esc(row.id)}','included',this.checked)"> include</label><label><input type="checkbox" onchange="mtgResearchBatchSelect('${esc(row.id)}',this.checked)"> select</label></div></td>
      <td><input class="mrb-small-input" type="number" min="1" value="${Number(row.quantity || 1)}" onchange="mtgResearchBatchUpdate('${esc(row.id)}','quantity',this.value)"></td>
      <td><div class="mrb-card-cell">${image ? `<img class="mrb-thumb" src="${esc(image)}" loading="lazy" onclick="mtgResearchBatchZoom('${esc(p.normalImage || image)}')">` : '<div class="mrb-no-img">NO IMG</div>'}<div><div class="mrb-name">${esc(p.name || row.parsedName)}</div><div class="mrb-meta">Raw: ${esc(row.rawLine)}</div><div class="mrb-meta">Parsed: ${esc(row.cleanedName)}</div></div></div></td>
      <td><div>${esc([p.setName, p.setCode, p.collectorNumber ? '#'+p.collectorNumber : ''].filter(Boolean).join(' · ') || 'All printings available')}</div><div class="mrb-meta">${esc(p.rarity || '')} · ${finishLabel(row.finish || 'normal')}</div><div class="mrb-price-main">${adj == null ? 'No price' : price(adj)} <span class="mrb-meta">condition estimate</span></div><div><span class="mrb-badge">Normal ${esc(price(p.prices?.usd))}</span><span class="mrb-badge">Foil ${esc(price(p.prices?.usdFoil))}</span><span class="mrb-badge">Etched ${esc(price(p.prices?.usdEtched))}</span></div><div>${conditionPills(row)}</div><div class="mrb-stock">${inStock ? `<b>${inStock}</b> in stock` : 'Not in stock'}</div><button class="hbtn" onclick="mtgResearchBatchChoosePrinting('${esc(row.id)}')" style="margin-top:6px">CHOOSE PRINTING</button></td>
      <td><select class="mrb-select" onchange="mtgResearchBatchUpdate('${esc(row.id)}','condition',this.value)">${API.CONDITIONS.map(c => `<option ${row.condition === c ? 'selected' : ''}>${c}</option>`).join('')}</select><select class="mrb-select" style="margin-top:6px" onchange="mtgResearchBatchUpdate('${esc(row.id)}','finish',this.value)">${finishOptions}</select></td>
      <td><span class="mrb-badge ${statusClass}">${esc(row.matchStatus)}</span><div class="mrb-meta">${esc(row.matchMode)} · ${Number(row.matchConfidence || 0)}%</div><div class="mrb-meta">${esc(row.error || '')}</div></td>
      <td><input class="mrb-input mrb-note" value="${esc(row.notes || '')}" onchange="mtgResearchBatchUpdate('${esc(row.id)}','notes',this.value)"></td>
      <td><button class="hbtn" onclick="mtgResearchBatchRemove('${esc(row.id)}')">REMOVE</button>${row.included === false ? `<button class="hbtn" onclick="mtgResearchBatchUpdate('${esc(row.id)}','included',true)">RESTORE</button>` : ''}</td>
    </tr>`;
  }

  function findRow(id){ return state.batch?.cards?.find(card => card.id === id); }
  window.stateMrbFilter = value => { state.filter = value; if($('mrb-filter')) $('mrb-filter').value = value; renderResults(); };
  window.stateMrbHideExcluded = value => { state.hideExcluded = !!value; renderResults(); };
  window.mtgResearchBatchSelect = (id, checked) => checked ? state.selected.add(id) : state.selected.delete(id);
  window.mtgResearchBatchUpdate = (id, field, value) => { const row = findRow(id); if(!row) return; row[field] = field === 'quantity' ? Math.max(1, Number(value || 1)) : value; renderReview(); renderResults(); };
  window.mtgResearchBatchRemove = id => { if(!state.batch) return; state.batch.cards = state.batch.cards.filter(card => card.id !== id); renderReview(); renderResults(); };
  window.mtgResearchBatchBulk = mode => { (state.batch?.cards || []).forEach(card => { if(!state.selected.size || state.selected.has(card.id)) card.included = mode === 'include'; }); renderReview(); renderResults(); };
  window.mtgResearchBatchRemoveExcluded = () => { if(!state.batch || !confirm('Remove all excluded cards from this local batch?')) return; state.batch.cards = state.batch.cards.filter(card => card.included !== false); renderReview(); renderResults(); };
  window.mtgResearchBatchAddManual = async () => { const name = prompt('Card name to add:'); if(!name || !state.batch) return; const row = API.parseLine(name, state.batch.cards.length + 1); state.batch.cards.push(row); renderResults(); await matchBatch(); };
  window.mtgResearchBatchZoom = url => {
    if(!url) return;
    const box = $('mrb-lightbox'), img = $('mrb-lightbox-img');
    if(img) img.src = url;
    box?.classList.add('on');
  };
  window.mtgResearchBatchChoosePrinting = async id => {
    const row = findRow(id);
    if(!row) return;
    if(!row.candidatePrintings?.length){
      row.error = 'Loading all printings...';
      renderResults();
      try {
        row.candidatePrintings = await fetchPrintings({ ...row, setCode:'', setName:'', collectorNumber:'', matchMode:'all-printings' });
        row.matchMode = 'all-printings';
        if(row.candidatePrintings.length){
          row.selectedPrinting = row.selectedPrinting || row.candidatePrintings[0];
          row.matchStatus = 'matched';
          row.matchConfidence = Math.max(Number(row.matchConfidence || 0), 86);
          row.error = '';
        }
      } catch(e) {
        row.error = e.message || 'Scryfall search failed';
      }
      renderReview();
      renderResults();
    }
    if(!row.candidatePrintings?.length) return alert('No Scryfall printings found for ' + (row.cleanedName || row.parsedName || 'this card') + '. You can edit the parsed name or retry later.');
    const picker = $('mrb-printing-picker');
    if(!picker) return;
    picker.innerHTML = `<div class="mrb-picker-inner"><div class="mrb-actions" style="justify-content:space-between;margin-bottom:12px"><div><div class="mrb-title">Choose Printing</div><div class="mrb-sub">${esc(row.cleanedName)} · click image to zoom, Select to use it</div></div><button class="hbtn" onclick="mtgResearchBatchClosePicker()">CLOSE</button></div><div class="mrb-printing-grid">${row.candidatePrintings.slice(0,40).map((p,i) => {
      const img = imgFor(p);
      return `<div class="mrb-printing-card"><div>${img ? `<img src="${esc(img)}" loading="lazy" onclick="mtgResearchBatchZoom('${esc(p.normalImage || img)}')">` : '<div class="mrb-no-img">NO IMG</div>'}</div><div class="mrb-name">${esc(p.name)}</div><div class="mrb-meta">${esc([p.setName,p.setCode,p.collectorNumber ? '#'+p.collectorNumber : ''].filter(Boolean).join(' · '))}</div><div><span class="mrb-badge">Normal ${esc(price(p.prices?.usd))}</span><span class="mrb-badge">Foil ${esc(price(p.prices?.usdFoil))}</span></div><button class="hbtn" onclick="mtgResearchBatchUsePrinting('${esc(row.id)}',${i})">SELECT</button></div>`;
    }).join('')}</div></div>`;
    picker.classList.add('on');
  };
  window.mtgResearchBatchClosePicker = () => $('mrb-printing-picker')?.classList.remove('on');
  window.mtgResearchBatchUsePrinting = (id, index) => {
    const row = findRow(id);
    const printing = row?.candidatePrintings?.[index];
    if(!row || !printing) return;
    row.selectedPrinting = printing;
    row.matchStatus = 'matched';
    if(row.finish === 'foil' && printing.prices?.usdFoil == null) row.finish = 'normal';
    $('mrb-printing-picker')?.classList.remove('on');
    renderReview();
    renderResults();
  };
  window.mtgResearchBatchSendToBuy = function(){
    const rows = (state.batch?.cards || []).filter(row => row.included !== false && (row.selectedPrinting || row.candidatePrintings?.[0]));
    if(!rows.length) return alert('No included matched cards to send to Buy.');
    const items = rows.map(row => {
      const p = row.selectedPrinting || row.candidatePrintings?.[0] || {};
      const market = adjustedPrice(row);
      const id = 'mrb_buy_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const finish = row.finish || 'normal';
      const base = finishPrice(p, finish);
      const buyPriceOptions = base == null ? [] : API.CONDITIONS.map(c => ({ key:c.toLowerCase() + '_' + finish, condition:c, finish, finishLabel:finishLabel(finish), price:Math.round(Number(base) * (conditionMult[c] ?? 1) * 100) / 100, source:'MTG Research Batch estimate' }));
      return {
        id,
        name:p.name || row.cleanedName,
        category:'Magic: The Gathering',
        set:p.setName || row.setName || '',
        card_number:p.collectorNumber || row.collectorNumber || '',
        variant:[p.rarity, finishLabel(finish), row.quantity > 1 ? 'Qty ' + row.quantity : ''].filter(Boolean).join(' · '),
        condition:row.condition || 'NM',
        selectedCondition:row.condition || 'NM',
        finish,
        selectedFinish:finish,
        qty:Number(row.quantity || 1),
        quantity:Number(row.quantity || 1),
        market:Number(market || 0),
        priceUsed:Number(market || 0),
        priceLabel:market == null ? 'No Scryfall price' : 'Scryfall ' + finishLabel(finish) + ' condition estimate',
        priceSource:'MTG Research Batch',
        pricingSource:'MTG Research Batch',
        buyPriceOptions,
        selectedBuyPriceKey:(row.condition || 'NM').toLowerCase() + '_' + finish,
        imageUrl:p.normalImage || p.imageUrl || '',
        scryfallId:p.scryfallId || '',
        productId:p.scryfallId || '',
        buySessionId:typeof getActiveBuySession === 'function' ? (getActiveBuySession()?.buySessionId || '') : '',
        storeId:typeof getActiveStoreId === 'function' ? getActiveStoreId() : '',
        status:'offered',
        notes:row.notes || '',
        source:'mtg_research_batch',
        sourceBatchId:state.batch?.id || '',
      };
    });
    if(typeof buyList !== 'undefined'){
      buyList.push(...items);
      if(typeof saveBuyList === 'function') saveBuyList();
      if(typeof renderBuyList === 'function') renderBuyList();
      if(typeof switchTab === 'function') switchTab('intake');
      if(window.toast_dash) toast_dash('Added ' + items.length + ' MTG batch row(s) to Buy');
    } else {
      const current = JSON.parse(localStorage.getItem('pos_buy_list') || '[]');
      localStorage.setItem('pos_buy_list', JSON.stringify(current.concat(items).slice(0,100)));
    }
  };
  window.mtgResearchBatchSave = function(){ if(!state.batch) return; state.batch = repo.save(state.batch); renderSaved(); renderReview(); if(window.toast_dash) toast_dash('MTG batch saved locally'); };
  window.mtgResearchBatchOpen = function(id){ const batch = repo.load().find(row => row.id === id); if(!batch) return; state.batch = batch; $('mrb-name').value = batch.name || ''; $('mrb-source').value = batch.sourceType || API.SOURCE_TYPES[0]; $('mrb-input').value = batch.rawInput || ''; renderReview(); renderResults(); };
  window.mtgResearchBatchDuplicate = function(id){ repo.duplicate(id); renderSaved(); };
  window.mtgResearchBatchDelete = function(id){ if(confirm('Delete this local MTG research batch?')){ repo.remove(id); if(state.batch?.id === id) state.batch = null; renderSaved(); renderReview(); renderResults(); } };
  window.mtgResearchBatchContinue = function(){
    const rows = (state.batch?.cards || []).filter(card => card.included !== false && (card.selectedPrinting?.raw || card.candidatePrintings?.[0]?.raw));
    if(!rows.length) return alert('No matched included cards to send to Research yet.');
    if(typeof scryfallCardToQplRow === 'function' && typeof renderQuickLookupResults === 'function'){
      qplResults = rows.map(row => ({ ...scryfallCardToQplRow((row.selectedPrinting || row.candidatePrintings?.[0]).raw), qty:row.quantity, condition:row.condition, selectedCondition:row.condition, selectedFinish:row.finish, finish:row.finish, note:[row.notes, 'MTG research batch: '+(state.batch.name || '')].filter(Boolean).join(' · ') })).filter(Boolean);
      qplMasterResults = qplResults;
      qplLastSearch = state.batch.name || 'MTG Research Batch';
      closeMtgResearchBatch();
      switchTab('research');
      renderQuickLookupResults(qplResults);
      document.getElementById('qpl-result')?.scrollIntoView({ behavior:'smooth', block:'start' });
    }
  };
})();
