(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  root.ArsCaMtgResearchBatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  const STORAGE_KEY = 'arsca_mtg_research_batches_v1';
  const CONDITIONS = ['NM','LP','MP','HP','DMG'];
  const FINISHES = ['normal','foil','etched'];
  const SOURCE_TYPES = ['Plain text','MTGGoldfish','Moxfield','Archidekt','Manabox','Dragon Shield','TCGplayer CSV','Generic CSV','Arena','Other / messy list'];
  const HEADER_RE = /^(commander|deck|mainboard|sideboard|maybeboard|considering|creatures?|artifacts?|enchantments?|instants?|sorceries?|lands?|planeswalkers?|collection|inventory|cards?)\s*(?:\(\d+\))?:?$/i;
  const JUNK_RE = /^(exported from|total\s*:?\s*\d+|deck total|sideboard total|maybeboard|buy this deck|view as|download|copy|prices?|quantity\s*,|qty\s*,|name\s*,|cards?\s+\d+)/i;

  function htmlDecode(value){
    return String(value || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:div|p|li|tr)>/gi, '\n')
      .replace(/<([^>]+)>/g, (all, inner) => /^\d{1,4}[A-Za-z]?$/.test(String(inner).trim()) ? ' #' + String(inner).trim() + ' ' : ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
  }

  function normalizeSpaces(value){
    return String(value || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function splitCsvLine(line){
    const cells = [];
    let cur = '', quote = false;
    for(let i = 0; i < line.length; i++){
      const ch = line[i];
      if(ch === '"' && line[i + 1] === '"'){ cur += '"'; i++; continue; }
      if(ch === '"'){ quote = !quote; continue; }
      if(ch === ',' && !quote){ cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function csvRows(input){
    const lines = htmlDecode(input).replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
    if(!lines.length || (!lines[0].includes(',') && !lines[0].includes('\t'))) return null;
    const delimiter = lines[0].includes('\t') && !lines[0].includes(',') ? '\t' : ',';
    const split = line => delimiter === '\t' ? line.split('\t').map(cell => cell.trim()) : splitCsvLine(line);
    const headers = split(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    if(!headers.some(h => ['name','card_name','product_name'].includes(h)) || !headers.some(h => ['quantity','qty','count'].includes(h))) return null;
    return lines.slice(1).map((line, index) => {
      const cells = split(line), row = {};
      headers.forEach((h, i) => row[h] = cells[i] || '');
      return { line:index + 2, raw:line, row };
    });
  }

  function stripPricesAndComments(value){
    return normalizeSpaces(htmlDecode(value))
      .replace(/\s*(?:\/\/|--)\s*(?:price|usd|eur|tix|owned|comment).*$/i, '')
      .replace(/\s+\$[\d,]+(?:\.\d{1,2})?(?:\s*(?:usd|eur))?\s*$/i, '')
      .replace(/\s+(?:usd|eur|tix)\s*[\d,]+(?:\.\d{1,2})?\s*$/i, '')
      .replace(/\s+\d+(?:\.\d{1,2})?\s*tix\s*$/i, '')
      .replace(/\s+\*[A-Z]+\*\s*$/i, '')
      .trim();
  }

  function extractConditionFinish(value){
    let text = stripPricesAndComments(value), condition = '', finish = '';
    const shortFoil = text.match(/\s+\(F\)\s*$/i);
    if(shortFoil){
      finish = 'foil';
      text = text.slice(0, shortFoil.index).trim();
    }
    const finishMatch = !finish && text.match(/(?:^|\s|-)(foil|nonfoil|non-foil|etched)(?:\s*)$/i);
    if(finishMatch){
      finish = /etched/i.test(finishMatch[1]) ? 'etched' : /non/i.test(finishMatch[1]) ? 'normal' : 'foil';
      text = text.slice(0, finishMatch.index).replace(/\s*-\s*$/, '').trim();
    }
    const condMatch = text.match(/(?:^|\s|-)(NM|LP|MP|HP|DMG|NEAR MINT|LIGHTLY PLAYED|MODERATELY PLAYED|HEAVILY PLAYED|DAMAGED)(?:\s*)$/i);
    if(condMatch){
      const raw = condMatch[1].toUpperCase();
      condition = raw === 'NEAR MINT' ? 'NM' : raw === 'LIGHTLY PLAYED' ? 'LP' : raw === 'MODERATELY PLAYED' ? 'MP' : raw === 'HEAVILY PLAYED' ? 'HP' : raw === 'DAMAGED' ? 'DMG' : raw;
      text = text.slice(0, condMatch.index).replace(/\s*-\s*$/, '').trim();
    }
    return { text:normalizeSpaces(text), condition:condition || 'NM', finish:finish || 'normal' };
  }

  function parseQuantity(value){
    const line = normalizeSpaces(value);
    let m = line.match(/^(?:(\d+)\s*x?\s+(.+)|x\s*(\d+)\s+(.+)|(.+?)\s+x\s*(\d+))$/i);
    if(!m) return { quantity:1, rest:line };
    return { quantity:Number(m[1] || m[3] || m[6] || 1), rest:normalizeSpaces(m[2] || m[4] || m[5] || '') };
  }

  function parseSetCollector(value){
    let text = normalizeSpaces(value), setCode = '', setName = '', collectorNumber = '';
    let m = text.match(/\s+\(([A-Z0-9]{2,8})\)\s*#?([A-Za-z0-9-]+)?\s*$/i);
    if(m){ setCode = m[1].toLowerCase(); collectorNumber = m[2] || ''; text = text.slice(0, m.index).trim(); return { text, setCode, setName, collectorNumber }; }
    m = text.match(/^(.+?)\s+#([A-Za-z0-9-]+)\s+\[([A-Z0-9]{2,8})\]\s*$/i);
    if(m) return { text:normalizeSpaces(m[1]), setCode:m[3].toLowerCase(), setName:'', collectorNumber:m[2] };
    m = text.match(/\s+\[([A-Z0-9]{2,8})\]\s*#?([A-Za-z0-9-]+)?\s*$/i);
    if(m){ setCode = m[1].toLowerCase(); collectorNumber = m[2] || ''; text = text.slice(0, m.index).trim(); return { text, setCode, setName, collectorNumber }; }
    m = text.match(/^(.+?)\s+[|]\s*([A-Za-z0-9]{2,20})\s*[|]\s*#?([A-Za-z0-9-]+)\s*$/);
    if(m) return { text:normalizeSpaces(m[1]), setCode:m[2].toLowerCase(), setName:'', collectorNumber:m[3] };
    m = text.match(/^(.+?)\s+-\s*([A-Za-z0-9]{2,20})\s+-\s*#?([A-Za-z0-9-]+)\s*$/);
    if(m) return { text:normalizeSpaces(m[1]), setCode:m[2].toLowerCase(), setName:'', collectorNumber:m[3] };
    m = text.match(/^(.+?)\s+([A-Z0-9]{2,8})\s+#?([A-Za-z0-9-]+)\s*$/);
    if(m) return { text:normalizeSpaces(m[1]), setCode:m[2].toLowerCase(), setName:'', collectorNumber:m[3] };
    m = text.match(/^(.+?)\s+#([A-Za-z0-9-]+)\s*$/);
    if(m) return { text:normalizeSpaces(m[1]), setCode:'', setName:'', collectorNumber:m[2] };
    m = text.match(/^(.+?)\s+((?:Magic|Commander|Modern|Innistrad|Ravnica|Dominaria|Zendikar|Theros|Tarkir|Lorwyn|Mirrodin|Kamigawa|Ixalan|Core|Masters|Horizons)[A-Za-z0-9 :'’-]*(?:\d{4})?)\s+#?([A-Za-z0-9-]+)?$/i);
    if(m && m[2].split(/\s+/).length <= 5) return { text:normalizeSpaces(m[1]), setCode:'', setName:normalizeSpaces(m[2]), collectorNumber:m[3] || '' };
    return { text, setCode, setName, collectorNumber };
  }

  function parseLine(raw, sourceLine = 1){
    const stripped = stripPricesAndComments(raw);
    if(!stripped || /^\/\//.test(stripped) || HEADER_RE.test(stripped) || JUNK_RE.test(stripped)) return { ignored:true, reason:'metadata/header', rawLine:raw, sourceLine };
    const { quantity, rest } = parseQuantity(stripped.replace(/^(SB|SIDEBOARD|CMDR|COMMANDER)\s*[:\-]\s*/i, ''));
    const cf = extractConditionFinish(rest);
    const parsed = parseSetCollector(cf.text);
    const cleanedName = normalizeSpaces(parsed.text.replace(/\s+\{[^}]*\}\s*$/, ''));
    if(!cleanedName) return { ignored:true, reason:'no card name', rawLine:raw, sourceLine };
    return {
      id:'mrb_' + sourceLine + '_' + Math.random().toString(36).slice(2, 7),
      rawLine:normalizeSpaces(raw),
      sourceLine,
      quantity:Math.max(1, Number(quantity || 1)),
      parsedName:cleanedName,
      cleanedName,
      setCode:parsed.setCode,
      setName:parsed.setName,
      collectorNumber:parsed.collectorNumber,
      condition:cf.condition,
      finish:cf.finish,
      included:true,
      selectedPrinting:null,
      candidatePrintings:[],
      matchStatus:'pending',
      matchConfidence:parsed.setCode && parsed.collectorNumber ? 98 : parsed.setCode || parsed.setName || parsed.collectorNumber ? 82 : 70,
      matchMode:parsed.setCode || parsed.setName || parsed.collectorNumber ? 'exact-printing' : 'all-printings',
      notes:'',
      error:'',
    };
  }

  function parseCsv(input){
    const rows = csvRows(input);
    if(!rows) return null;
    const cards = [], ignored = [];
    rows.forEach(({ line, raw, row }) => {
      const name = row.name || row.card_name || row.product_name || '';
      if(!name){ ignored.push({ line, text:raw, reason:'missing name' }); return; }
      const qty = Number(row.quantity || row.qty || row.count || 1) || 1;
      const condition = String(row.condition || row.card_condition || 'NM').toUpperCase();
      const foilRaw = String(row.foil || row.finish || row.printing || '').toLowerCase();
      cards.push({
        ...parseLine(`${qty} ${name}`, line),
        rawLine:raw,
        quantity:qty,
        setCode:String(row.set || row.set_code || row.expansion || '').toLowerCase(),
        setName:String(row.set_name || '').trim(),
        collectorNumber:String(row.collector_number || row.number || row.card_number || '').replace(/^#/, ''),
        condition:CONDITIONS.includes(condition) ? condition : 'NM',
        finish:/foil|true|yes|1/.test(foilRaw) ? 'foil' : /etched/.test(foilRaw) ? 'etched' : 'normal',
      });
    });
    return { cards:cards.filter(c => !c.ignored), ignored, rawLines:rows.length };
  }

  function parseList(input, sourceType = 'Other / messy list'){
    const raw = htmlDecode(input || '').replace(/^\uFEFF/, '');
    const csv = /csv/i.test(sourceType) ? parseCsv(raw) : parseCsv(raw);
    if(csv) return { ...csv, sourceType };
    const cards = [], ignored = [];
    raw.split(/\r?\n/).forEach((line, index) => {
      const parsed = parseLine(line, index + 1);
      if(parsed.ignored) {
        if(normalizeSpaces(line)) ignored.push({ line:index + 1, text:normalizeSpaces(line), reason:parsed.reason });
      } else cards.push(parsed);
    });
    return { cards, ignored, rawLines:raw.split(/\r?\n/).length, sourceType };
  }

  function batchSummary(batch){
    const cards = batch.cards || [];
    return {
      totalLines:batch.totalLines || cards.length,
      matched:cards.filter(c => c.matchStatus === 'matched').length,
      unresolved:cards.filter(c => !['matched','excluded'].includes(c.matchStatus)).length,
      ambiguous:cards.filter(c => c.matchStatus === 'ambiguous').length,
      included:cards.filter(c => c.included !== false).length,
      exactPrintings:cards.filter(c => c.selectedPrinting?.collectorNumber || (c.setCode && c.collectorNumber)).length,
    };
  }

  function createBatch({ name, sourceType, rawInput, cards, ignored }){
    const now = new Date().toISOString();
    return { id:'mtgb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), version:1, name:name || 'MTG Research Batch', sourceType:sourceType || SOURCE_TYPES[0], rawInput:rawInput || '', createdAt:now, updatedAt:now, totalLines:(rawInput || '').split(/\r?\n/).length, cards:cards || [], ignored:ignored || [] };
  }

  function repository(storage, key = STORAGE_KEY){
    const safe = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const load = () => {
      try { return JSON.parse(safe?.getItem(key) || '[]'); } catch(e) { return []; }
    };
    const saveAll = rows => safe?.setItem(key, JSON.stringify((rows || []).slice(0, 80)));
    return {
      load,
      save(batch){
        const rows = load();
        const now = new Date().toISOString();
        const next = { ...batch, updatedAt:now };
        const idx = rows.findIndex(row => row.id === next.id);
        if(idx >= 0) rows[idx] = next; else rows.unshift(next);
        saveAll(rows);
        return next;
      },
      remove(id){ saveAll(load().filter(row => row.id !== id)); },
      duplicate(id){
        const item = load().find(row => row.id === id);
        if(!item) return null;
        return this.save({ ...item, id:'mtgb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), name:(item.name || 'Batch') + ' Copy', createdAt:new Date().toISOString() });
      },
    };
  }

  return { STORAGE_KEY, CONDITIONS, FINISHES, SOURCE_TYPES, parseLine, parseList, createBatch, batchSummary, repository, normalizeSpaces };
});
