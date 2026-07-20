import crypto from 'node:crypto';

const STOP_WORDS = new Set([
  'a','an','and','at','card','cards','edition','for','from','in','magic','of','on','or','set','the','to','with',
  'foil','nonfoil','borderless','showcase','extended','art','etched','collector','number','mtg'
]);

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function searchableTokens(value = '') {
  return [...new Set(normalizeText(value).split(' ').filter(token => token.length > 1 && !STOP_WORDS.has(token)))];
}

export function stableHash(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function moneyFromPennies(value) {
  if(value === null || value === undefined || value === '') return null;
  const pennies = Number(String(value).replace(/[$,]/g, '').trim());
  return Number.isFinite(pennies) && pennies >= 0 ? Math.round(pennies) / 100 : null;
}

function compactCardFace(face = {}) {
  return {
    name: face.name || '', printedName: face.printed_name || '', manaCost: face.mana_cost || '',
    typeLine: face.type_line || '', oracleText: face.oracle_text || '',
    colors: Array.isArray(face.colors) ? face.colors : [], artist: face.artist || '', imageUris: face.image_uris || {},
  };
}

export function normalizeScryfallCard(card = {}, downloadedAt = new Date().toISOString()) {
  const faces = Array.isArray(card.card_faces) ? card.card_faces.map(compactCardFace) : [];
  const oracleText = card.oracle_text || faces.map(face => face.oracleText).filter(Boolean).join(' // ');
  const typeLine = card.type_line || faces.map(face => face.typeLine).filter(Boolean).join(' // ');
  const normalizedName = normalizeText(card.name || card.printed_name || '');
  const searchText = normalizeText([
    card.name, card.printed_name, card.set, card.set_name, card.collector_number, card.artist,
    card.rarity, card.mana_cost, typeLine, oracleText, ...(card.keywords || []), ...(card.colors || []),
    ...faces.flatMap(face => [face.name, face.printedName, face.artist, face.typeLine, face.oracleText])
  ].filter(Boolean).join(' '));

  return {
    source:'scryfall', category:'mtg', scryfallId:card.id || '', oracleId:card.oracle_id || '',
    name:card.name || '', normalizedName, printedName:card.printed_name || '', setCode:card.set || '',
    setName:card.set_name || '', collectorNumber:card.collector_number || '', rarity:card.rarity || '',
    artist:card.artist || faces.find(face => face.artist)?.artist || '', manaCost:card.mana_cost || faces[0]?.manaCost || '',
    cmc:Number.isFinite(Number(card.cmc)) ? Number(card.cmc) : null, typeLine, oracleText,
    keywords:Array.isArray(card.keywords) ? card.keywords : [], colors:Array.isArray(card.colors) ? card.colors : (faces[0]?.colors || []),
    colorIdentity:Array.isArray(card.color_identity) ? card.color_identity : [], legalities:card.legalities || {},
    finishes:Array.isArray(card.finishes) ? card.finishes : [], prices:card.prices || {}, imageUris:card.image_uris || {},
    frameEffects:Array.isArray(card.frame_effects) ? card.frame_effects : [], promoTypes:Array.isArray(card.promo_types) ? card.promo_types : [],
    borderColor:card.border_color || '', frame:card.frame || '',
    cardFaces:faces, scryfallUri:card.scryfall_uri || '', purchaseUris:card.purchase_uris || {}, tcgplayerId:String(card.tcgplayer_id || ''),
    releasedAt:card.released_at || '', downloadedAt, searchText,
  };
}

function pick(row, ...keys) {
  for(const key of keys) if(row[key] !== undefined && row[key] !== '') return row[key];
  return null;
}

export function normalizePriceChartingRow(row = {}, updatedAt = new Date().toISOString()) {
  const pricechartingId = String(pick(row, 'id', 'product-id', 'productId') || '').trim();
  const productName = String(pick(row, 'product-name', 'productName', 'name') || '').trim();
  const consoleName = String(pick(row, 'console-name', 'consoleName', 'console') || '').trim();
  return {
    source:'pricecharting', category:'mtg', pricechartingId, productName,
    normalizedProductName:normalizeText(productName), consoleName,
    loosePrice:moneyFromPennies(pick(row, 'loose-price', 'loosePrice')),
    grade7Price:moneyFromPennies(pick(row, 'cib-price', 'cibPrice')),
    grade8Price:moneyFromPennies(pick(row, 'new-price', 'newPrice')),
    grade9Price:moneyFromPennies(pick(row, 'graded-price', 'gradedPrice')),
    grade95Price:moneyFromPennies(pick(row, 'box-only-price', 'boxOnlyPrice')),
    psa10Price:moneyFromPennies(pick(row, 'manual-only-price', 'manualOnlyPrice')),
    bgs10Price:moneyFromPennies(pick(row, 'bgs-10-price', 'bgs10Price')),
    cgc10Price:moneyFromPennies(pick(row, 'condition-17-price', 'condition17Price')),
    sgc10Price:moneyFromPennies(pick(row, 'condition-18-price', 'condition18Price')),
    rawPricesPennies:{
      loose:pick(row, 'loose-price', 'loosePrice'), grade7:pick(row, 'cib-price', 'cibPrice'),
      grade8:pick(row, 'new-price', 'newPrice'), grade9:pick(row, 'graded-price', 'gradedPrice'),
      grade95:pick(row, 'box-only-price', 'boxOnlyPrice'), psa10:pick(row, 'manual-only-price', 'manualOnlyPrice'),
      bgs10:pick(row, 'bgs-10-price', 'bgs10Price'), cgc10:pick(row, 'condition-17-price', 'condition17Price'),
      sgc10:pick(row, 'condition-18-price', 'condition18Price'),
    },
    updatedAt:String(pick(row, 'updated-at', 'updatedAt', 'last-updated') || updatedAt), raw:row,
  };
}

function numberMatches(productText, collectorNumber) {
  const number = normalizeText(collectorNumber);
  if(!number) return false;
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[ /-]*');
  return new RegExp(`(?:^|\\s|#)${escaped}(?:$|\\s)`, 'i').test(productText.replace(/[^a-z0-9# /-]+/gi, ' '));
}

export function scorePriceChartingMatch(card, price) {
  const product = price.normalizedProductName || normalizeText(price.productName);
  const name = card.normalizedName || normalizeText(card.name);
  const setName = normalizeText(card.setName);
  const setCode = normalizeText(card.setCode);
  const nameMatch = !!name && (` ${product} `.includes(` ${name} `) || product.startsWith(name + ' '));
  const setMatch = !!setName && product.includes(setName);
  const setCodeMatch = !!setCode && new RegExp(`(?:^| )${setCode}(?: |$)`).test(product);
  const collectorMatch = numberMatches(product, card.collectorNumber);
  const finishTerms = (card.finishes || []).filter(finish => product.includes(normalizeText(finish)));
  const matchedOn = [];
  let confidence = 0;
  if(nameMatch) { confidence += 55; matchedOn.push('exact normalized name'); }
  if(setMatch || setCodeMatch) { confidence += 30; matchedOn.push(setMatch ? 'set name' : 'set code'); }
  if(collectorMatch) { confidence += 20; matchedOn.push('collector number'); }
  if(finishTerms.length) { confidence += 3; matchedOn.push('finish/variant'); }
  if(card.releasedAt?.slice(0, 4) && product.includes(card.releasedAt.slice(0, 4))) { confidence += 2; matchedOn.push('release year'); }
  confidence = Math.min(100, confidence);
  if(!nameMatch) confidence = Math.min(confidence, 60);
  return { confidence, matchedOn };
}

export function createPriceIndex(prices = []) {
  const byToken = new Map();
  prices.forEach(price => searchableTokens(price.productName).forEach(token => {
    const rows = byToken.get(token) || [];
    rows.push(price);
    byToken.set(token, rows);
  }));
  return { prices, byToken };
}

export function bestPriceChartingMatch(card, index) {
  const nameTokens = searchableTokens(card.name).sort((a, b) => (index.byToken.get(a)?.length || Infinity) - (index.byToken.get(b)?.length || Infinity));
  const candidates = nameTokens.length ? (index.byToken.get(nameTokens[0]) || []) : [];
  let best = null;
  for(const price of candidates) {
    const scored = scorePriceChartingMatch(card, price);
    if(!best || scored.confidence > best.confidence) best = { price, ...scored };
  }
  return !best || best.confidence < 75 ? null : best;
}

export function buildLinkRecord(card, match) {
  if(!match) return null;
  return {
    scryfallId:card.scryfallId, oracleId:card.oracleId, pricechartingId:match.price.pricechartingId,
    confidence:match.confidence, matchedOn:match.matchedOn, scryfallName:card.name, scryfallSet:card.setName,
    collectorNumber:card.collectorNumber, pricechartingProductName:match.price.productName,
  };
}
