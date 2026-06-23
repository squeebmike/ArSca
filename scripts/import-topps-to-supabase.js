#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'topps');
const DEFAULT_URL = 'https://vroknjrxubsqyexngwus.supabase.co';

function argValue(name, fallback = '') {
  const hit = process.argv.find(a => a === name || a.startsWith(name + '='));
  if (!hit) return fallback;
  if (hit === name) return 'true';
  return hit.slice(name.length + 1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readSources(file) {
  const raw = zlib.gunzipSync(fs.readFileSync(file));
  return JSON.parse(raw.toString('utf8')).sources || [];
}

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sectionSort(section = '') {
  const s = String(section || '').toLowerCase();
  if (/^base/.test(s)) return 0;
  if (/variation|parallel|mini|foil|refractor|short print/.test(s)) return 1;
  if (/insert|sticker|subset/.test(s)) return 2;
  if (/auto|signature/.test(s)) return 3;
  if (/relic|memorabilia|patch|book/.test(s)) return 4;
  return 5;
}

function cardNumberSort(cardNumber = '') {
  const m = String(cardNumber || '').match(/\d+/);
  return m ? Number(m[0]) : 999999;
}

function cardNumberPrefix(cardNumber = '') {
  return String(cardNumber || '').replace(/\d+.*/, '').toLowerCase();
}

function setRow(set = {}) {
  const product = cleanText(set.product || set.setName);
  return {
    id: set.id,
    year: cleanText(set.year),
    brand: cleanText(set.brand || 'Topps'),
    product,
    sport: cleanText(set.sport),
    set_name: cleanText(set.setName || product),
    release_name: cleanText(set.releaseName || product),
    source_ids: Array.isArray(set.sourceIds) ? set.sourceIds : [],
    card_count: Number(set.cardCount || 0),
    search_text: cleanText([set.year, set.brand || 'Topps', product, set.sport, set.setName, set.releaseName].join(' ')).toLowerCase(),
  };
}

function cardRow(card = {}) {
  const product = cleanText(card.product || card.setName);
  return {
    id: card.id,
    set_id: card.setId,
    source_id: card.sourceId || null,
    year: cleanText(card.year),
    brand: cleanText(card.brand || 'Topps'),
    product,
    sport: cleanText(card.sport),
    set_name: cleanText(card.setName || product),
    release_name: cleanText(card.releaseName || product),
    card_number: cleanText(card.cardNumber),
    card_number_prefix: cardNumberPrefix(card.cardNumber),
    card_number_sort: cardNumberSort(card.cardNumber),
    player: cleanText(card.player || card.subject),
    subject: cleanText(card.subject || card.player),
    team: cleanText(card.team),
    notes: cleanText(card.notes),
    section: cleanText(card.section || 'Checklist'),
    section_sort: sectionSort(card.section),
    flags: card.flags || {},
    parse_confidence: Number(card.parseConfidence || 0),
    search_text: cleanText(card.searchText || [card.year, card.brand, product, card.sport, card.section, card.cardNumber, card.player, card.subject, card.team, card.notes].join(' ')).toLowerCase(),
  };
}

function sourceRow(source = {}) {
  return {
    source_id: source.sourceId,
    file_name: cleanText(source.fileName),
    original_path: cleanText(source.originalPath),
    pdf_url: cleanText(source.pdfUrl),
    pdf_hash: cleanText(source.pdfHash),
    page_count: Number(source.pageCount || 0),
    text_length: Number(source.textLength || String(source.rawText || '').length || 0),
    raw_text: source.rawText || '',
    parsed_set_id: cleanText(source.parsedSetId),
    imported_at: source.importedAt || null,
  };
}

function setsFromCards(cards = [], seedSets = []) {
  const byId = new Map();
  seedSets.forEach(seed => {
    if (seed?.id) byId.set(seed.id, { ...setRow(seed), card_count: 0, source_ids: new Set(seed.sourceIds || seed.source_ids || []) });
  });
  cards.forEach(card => {
    if (!card.setId) return;
    const prior = byId.get(card.setId) || {
      id: card.setId,
      year: cleanText(card.year),
      brand: cleanText(card.brand || 'Topps'),
      product: cleanText(card.product || card.setName),
      sport: cleanText(card.sport),
      set_name: cleanText(card.setName || card.product),
      release_name: cleanText(card.releaseName || card.product),
      source_ids: new Set(),
      card_count: 0,
      search_text: '',
    };
    prior.card_count += 1;
    if (card.sourceId) prior.source_ids.add(card.sourceId);
    if (!prior.year) prior.year = cleanText(card.year);
    if (!prior.product) prior.product = cleanText(card.product || card.setName);
    if (!prior.sport) prior.sport = cleanText(card.sport);
    if (!prior.set_name) prior.set_name = cleanText(card.setName || card.product);
    if (!prior.release_name) prior.release_name = cleanText(card.releaseName || card.product);
    byId.set(card.setId, prior);
  });
  return [...byId.values()].map(row => {
    const sourceIds = row.source_ids instanceof Set ? [...row.source_ids] : row.source_ids || [];
    const product = cleanText(row.product || row.set_name);
    return {
      ...row,
      product,
      set_name: cleanText(row.set_name || product),
      release_name: cleanText(row.release_name || product),
      source_ids: sourceIds,
      search_text: cleanText([row.year, row.brand || 'Topps', product, row.sport, row.set_name, row.release_name].join(' ')).toLowerCase(),
    };
  }).sort((a, b) => String(b.year).localeCompare(String(a.year)) || String(a.product).localeCompare(String(b.product)));
}

function uniquifyCardIds(cards = []) {
  const seen = new Map();
  let duplicateRows = 0;
  const out = cards.map(card => {
    const id = card.id || '';
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    if (n === 1) return card;
    duplicateRows += 1;
    return { ...card, id: `${id}_dup${n}` };
  });
  return { cards: out, duplicateRows };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function supabaseFetch(table, rows, { url, key, returning = 'minimal' }) {
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/${table}?on_conflict=${table === 'topps_import_meta' ? 'id' : table === 'topps_pdf_sources' ? 'source_id' : table === 'topps_sets' ? 'id' : 'id'}`;
  let lastError = '';
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: `resolution=merge-duplicates,return=${returning}`,
      },
      body: JSON.stringify(rows),
    });
    if (res.ok) return;
    const text = await res.text().catch(() => '');
    lastError = `${table} upsert failed ${res.status}: ${text.slice(0, 600)}`;
    if (![429, 500, 502, 503, 504].includes(res.status) || attempt === 5) break;
    await sleep(1000 * attempt * attempt);
  }
  throw new Error(lastError);
}

async function upsertBatches(table, rows, ctx, chunkSize) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await supabaseFetch(table, chunk, ctx);
    const done = Math.min(i + chunk.length, rows.length);
    if (done === rows.length || done % (chunkSize * 10) === 0) console.log(`${table}: ${done}/${rows.length}`);
  }
}

async function main() {
  const url = argValue('--url', process.env.SUPABASE_URL || DEFAULT_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || argValue('--service-role-key');
  const cardsFile = path.resolve(argValue('--cards', path.join(DATA_DIR, 'topps_checklist_cards.json')));
  const setsFile = path.resolve(argValue('--sets', path.join(DATA_DIR, 'topps_sets.json')));
  const sourcesFile = path.resolve(argValue('--sources', path.join(DATA_DIR, 'topps_pdf_sources.json.gz')));
  const chunkSize = Number(argValue('--chunk-size', '500')) || 500;
  const cardsLimit = Number(argValue('--limit-cards', '0')) || 0;
  const cardOffset = Number(argValue('--card-offset', '0')) || 0;
  const skipSources = process.argv.includes('--skip-sources');
  const skipSets = process.argv.includes('--skip-sets');
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(cardsFile)) throw new Error('Missing cards file: ' + cardsFile);
  if (!fs.existsSync(setsFile)) throw new Error('Missing sets file: ' + setsFile);
  if (!fs.existsSync(sourcesFile)) throw new Error('Missing sources file: ' + sourcesFile);

  const allCards = readJson(cardsFile);
  const rawCards = cardsLimit ? allCards.slice(0, cardsLimit) : allCards;
  const { cards: uniqueRawCards, duplicateRows } = uniquifyCardIds(rawCards);
  const seedSets = fs.existsSync(setsFile) ? readJson(setsFile) : [];
  const sets = setsFromCards(uniqueRawCards, seedSets);
  const cards = uniqueRawCards.map(cardRow);
  const sources = readSources(sourcesFile).map(sourceRow);
  const ctx = { url, key };

  console.log(`Importing Topps checklists to Supabase: ${sets.length} sets, ${cards.length} cards, ${sources.length} sources`);
  if (duplicateRows) console.log(`Resolved ${duplicateRows} duplicate parsed card ids with stable _dupN suffixes.`);
  if (dryRun) {
    console.log('Dry run only. No Supabase writes were made.');
    console.log('Sample set:', JSON.stringify(sets[0] || {}, null, 2).slice(0, 900));
    console.log('Sample card:', JSON.stringify(cards[0] || {}, null, 2).slice(0, 900));
    return;
  }
  if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY or pass --service-role-key=... to import.');
  if (skipSources) console.log('Skipping topps_pdf_sources upsert.');
  else await upsertBatches('topps_pdf_sources', sources, ctx, Math.min(chunkSize, 100));
  if (skipSets) console.log('Skipping topps_sets upsert.');
  else await upsertBatches('topps_sets', sets, ctx, Math.min(chunkSize, 500));
  if (cardOffset) console.log(`Resuming card upsert at offset ${cardOffset}/${cards.length}`);
  await upsertBatches('topps_checklist_cards', cards.slice(cardOffset), ctx, chunkSize);
  await supabaseFetch('topps_import_meta', [{
    id: 'topps_checklists',
    imported_at: new Date().toISOString(),
    status: 'ready',
    schema_version: 1,
    set_count: sets.length,
    card_count: cards.length,
    source_count: sources.length,
  }], ctx);
  console.log('Supabase Topps import complete.');
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
