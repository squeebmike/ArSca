const crypto = require('crypto');

const TOPPS_CHECKLIST_SCHEMA_VERSION = 1;

function slugify(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'topps-checklist';
}

function decodeToppsFileName(fileName = '') {
  return String(fileName || '')
    .replace(/\.pdf$/i, '')
    .replace(/_20/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\bCheckl?si?t?L?\b/ig, 'Checklist')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferYear(fileName = '', text = '') {
  const hay = [decodeToppsFileName(fileName), String(text || '').slice(0, 900)].join(' ');
  const season = hay.match(/\b(20\d{2}|19\d{2})\s*[-/]\s*(\d{2})\b/);
  if (season) return season[1] + '-' + season[2];
  const full = hay.match(/\b(20\d{2}|19\d{2})\b/);
  if (full) return full[1];
  const short = String(fileName || '').match(/\b(\d{2})(BB|FB|BK|HK|UCL|WWE|GPK|SW|STS|STUD)/i);
  if (short) return (Number(short[1]) > 70 ? '19' : '20') + short[1];
  return '';
}

function inferSport(fileName = '', text = '') {
  const hay = [decodeToppsFileName(fileName), String(text || '').slice(0, 1600)].join(' ').toLowerCase();
  if (/\b(champions league|uefa|soccer|bundesliga|mls|finest champions)\b/.test(hay)) return 'soccer';
  if (/\b(wwe|wrestling)\b/.test(hay)) return 'wrestling';
  if (/\b(basketball|nba|bk)\b/.test(hay)) return 'basketball';
  if (/\b(football|nfl|fb)\b/.test(hay)) return 'football';
  if (/\b(hockey|nhl|hk)\b/.test(hay)) return 'hockey';
  if (/\b(baseball|mlb|bb|allen ginter|bowman|stadium club|heritage|archives|big league)\b/.test(hay)) return 'baseball';
  if (/\b(star wars|stranger things|garbage pail|gpk|tmnt)\b/.test(hay)) return 'entertainment';
  return 'collectibles';
}

function inferProduct(fileName = '', text = '') {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const firstToppsLine = lines.find(l => /topps/i.test(l) && l.length < 150) || '';
  const decoded = decodeToppsFileName(fileName);
  return (firstToppsLine || decoded || 'Topps Checklist')
    .replace(/\bChecklist\b/ig, '')
    .replace(/\bBase Cards?(?: and Inserts)?\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSection(line = '') {
  const clean = String(line || '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 90 || /^\d/.test(clean)) return '';
  if (/^(base|base cards?|base stickers?|insert cards?|inserts?|autographs?|auto(?:graph)? cards?|relics?|memorabilia|parallels?|short prints?|image variations?|character cards?|scene stickers?)$/i.test(clean)) {
    return clean.replace(/\b\w/g, c => c.toUpperCase());
  }
  if (/\b(cards?|stickers?|autographs?|relics?|parallels?|insert|variations?)\b/i.test(clean)) return clean;
  return '';
}

function detectFlags(text = '', section = '') {
  const hay = [text, section].join(' ').toLowerCase();
  return {
    rc: /\b(rc|rookie|rookies)\b/.test(hay),
    auto: /\b(auto|autograph|autographed|signatures?)\b/.test(hay),
    relic: /\b(relic|memorabilia|patch|jersey|bat relic|coin relic)\b/.test(hay),
    parallel: /\b(parallel|foil|refractor|sepia|x-fractor|rainbow|gold|black|red|blue|green|orange|purple|pink|platinum|negative)\b/.test(hay),
    numbered: /\/\d{1,4}\b|\bnumbered\b|\bserial\b|\b\d{1,4}\s*copies\b/.test(hay),
    insert: /\b(insert|tribute|evolution|sticker|variation|short print|subset)\b/.test(hay) || (!!section && !/^base/i.test(section)),
  };
}

function splitSubjectTeam(title = '') {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  const dash = clean.split(/\s+-\s+|\s+--\s+/);
  if (dash.length >= 2 && dash[dash.length - 1].length <= 32) {
    return { subject: dash.slice(0, -1).join(' - ').trim(), team: dash[dash.length - 1].trim() };
  }
  const paren = clean.match(/^(.*?)\s+\(([^)]{2,32})\)$/);
  if (paren) return { subject: paren[1].trim(), team: paren[2].trim() };
  return { subject: clean, team: '' };
}

function lineLooksLikeCardRow(line = '') {
  const clean = String(line || '').trim();
  if (!clean || clean.length < 3) return false;
  if (/^(page|topps|copyright|all rights|odds|look for|available|www\.)\b/i.test(clean)) return false;
  if (/^(20\d{2}|19\d{2})\s+Topps\b/i.test(clean)) return false;
  if (/^\d+\s+of\s+\d+\s+\S+/i.test(clean)) return true;
  if (/^(?:[A-Z]{1,8}-)?\d{1,4}[A-Z]?[\.)]?\s+\S+/.test(clean)) return true;
  if (/^[A-Z]{1,8}\d{1,4}[A-Z]?[\.)]?\s+\S+/.test(clean)) return true;
  if (/^[A-Z]{1,8}-[A-Z0-9]{1,8}[\.)]?\s+\S+/.test(clean)) return true;
  return false;
}

function splitMultiColumnLine(line = '') {
  const clean = String(line || '').replace(/\s+/g, ' ').trim();
  if (/^\d+\s+of\s+\d+\s+/i.test(clean)) return [clean];
  const starts = [];
  const re = /(?:^|\s)((?:[A-Z]{1,8}-)?\d{1,4}[A-Z]?|[A-Z]{1,8}\d{1,4}[A-Z]?|[A-Z]{1,8}-[A-Z0-9]{1,8})(?=\s+\S)/g;
  let match;
  while ((match = re.exec(clean))) {
    const idx = match.index + (match[0].startsWith(' ') ? 1 : 0);
    if (!/^\d{4}$/.test(match[1])) starts.push(idx);
  }
  if (starts.length <= 1) return [clean];
  return starts.map((start, i) => clean.slice(start, starts[i + 1] || clean.length).trim()).filter(Boolean);
}

function parseCardLine(line = '', section = '') {
  const rows = [];
  for (const part of splitMultiColumnLine(line)) {
    const special = part.match(/^(\d+\s+of\s+\d+)\s+(.+)$/i);
    const normal = part.match(/^((?:[A-Z]{1,8}-)?\d{1,4}[A-Z]?|[A-Z]{1,8}\d{1,4}[A-Z]?|[A-Z]{1,8}-[A-Z0-9]{1,8})[\.)]?\s+(.+)$/);
    const m = special || normal;
    if (!m) continue;
    const cardNumber = m[1].trim();
    const title = m[2].replace(/\s+/g, ' ').trim();
    if (!title || title.length < 2) continue;
    const { subject, team } = splitSubjectTeam(title);
    rows.push({ cardNumber, player: subject, subject, team, notes: '', section: section || 'Checklist', flags: detectFlags(title, section) });
  }
  return rows;
}

function parseChecklistText({ text = '', fileName = '', sourceId = '' } = {}) {
  const year = inferYear(fileName, text);
  const sport = inferSport(fileName, text);
  const product = inferProduct(fileName, text);
  const setId = slugify([year, product, sport].filter(Boolean).join(' '));
  const lines = String(text || '').split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let section = 'Base';
  const cards = [];

  for (const line of lines) {
    const nextSection = normalizeSection(line);
    if (nextSection && !lineLooksLikeCardRow(line)) {
      section = nextSection;
      continue;
    }
    if (!lineLooksLikeCardRow(line)) continue;
    parseCardLine(line, section).forEach((row, offset) => {
      const flags = { ...detectFlags([row.subject, row.notes].join(' '), row.section), ...(row.flags || {}) };
      const idSeed = [sourceId, setId, row.section, row.cardNumber, row.subject, offset].join('|');
      cards.push({
        id: 'topps_card_' + crypto.createHash('sha1').update(idSeed).digest('hex').slice(0, 16),
        setId,
        sourceId,
        year,
        brand: 'Topps',
        product,
        sport,
        setName: product,
        releaseName: product,
        cardNumber: row.cardNumber,
        player: row.player,
        subject: row.subject,
        team: row.team,
        notes: row.notes,
        section: row.section,
        flags,
        parseConfidence: row.team ? 0.72 : 0.62,
        searchText: [year, 'Topps', product, sport, row.section, row.cardNumber, row.subject, row.team, row.notes, Object.entries(flags).filter(([, v]) => v).map(([k]) => k).join(' ')].filter(Boolean).join(' ').toLowerCase(),
      });
    });
  }

  return {
    set: {
      id: setId,
      year,
      brand: 'Topps',
      product,
      sport,
      setName: product,
      releaseName: product,
      sourceIds: sourceId ? [sourceId] : [],
      cardCount: cards.length,
    },
    cards,
  };
}

function buildChecklistIndex(sources = []) {
  const setsById = new Map();
  const cards = [];
  const normalizedSources = [];

  sources.forEach((source, idx) => {
    const sourceId = source.sourceId || 'topps_pdf_' + crypto.createHash('sha1').update(source.originalPath || source.fileName || String(idx)).digest('hex').slice(0, 12);
    const parsed = parseChecklistText({ text: source.rawText || '', fileName: source.fileName || '', sourceId });
    normalizedSources.push({
      sourceId,
      fileName: source.fileName || '',
      originalPath: source.originalPath || source.fileName || '',
      pdfUrl: source.pdfUrl || '',
      pageCount: source.pageCount || 0,
      textLength: String(source.rawText || '').length,
      rawText: source.rawText || '',
      parsedSetId: parsed.set.id,
      importedAt: source.importedAt || new Date().toISOString(),
    });
    const prior = setsById.get(parsed.set.id);
    setsById.set(parsed.set.id, prior ? {
      ...prior,
      sourceIds: [...new Set([...(prior.sourceIds || []), sourceId])],
      cardCount: prior.cardCount + parsed.cards.length,
    } : parsed.set);
    cards.push(...parsed.cards);
  });

  return {
    schemaVersion: TOPPS_CHECKLIST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    models: {
      topps_sets: 'sets[]',
      topps_checklist_cards: 'cards[]',
      topps_pdf_sources: 'sources[]',
      pricecharting_matches_cache: 'Worker KV key topps_pc_match:{cardId}',
    },
    sets: [...setsById.values()].sort((a, b) => String(b.year).localeCompare(String(a.year)) || String(a.product).localeCompare(String(b.product))),
    cards,
    sources: normalizedSources,
  };
}

module.exports = {
  TOPPS_CHECKLIST_SCHEMA_VERSION,
  buildChecklistIndex,
  decodeToppsFileName,
  detectFlags,
  inferProduct,
  inferSport,
  inferYear,
  lineLooksLikeCardRow,
  parseCardLine,
  parseChecklistText,
  slugify,
};
