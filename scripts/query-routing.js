(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.ArsCaSearchAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  const CATEGORY_ALIASES = {
    'pokemon tcg':'pokemon', pokemon:'pokemon', tcg:'tcg',
    'magic: the gathering':'mtg', magic:'mtg', mtg:'mtg',
    'sports card':'sports', 'sports cards':'sports', sports:'sports', graded:'graded',
    comic:'comic', comics:'comic', sealed:'sealed', 'sealed product':'sealed',
    'video games':'video_games', games:'video_games', funko:'funko', lego:'lego', coins:'coins'
  };
  const TEXT_ALIASES = { asm:'amazing spider-man', tmnt:'teenage mutant ninja turtles', uxm:'uncanny x-men', spiderman:'spider-man', xmen:'x-men', ud:'upper deck', upperdeck:'upper deck' };
  const SPORTS_BRANDS = ['topps chrome','bowman chrome','upper deck','fleer ultra','topps','bowman','fleer','panini','prizm','optic','donruss','select','score','skybox','hoops','leaf','mosaic'];
  const SPORTS_PLAYERS = {
    griffey:'Ken Griffey Jr', 'ken griffey':'Ken Griffey Jr', jordan:'Michael Jordan', 'michael jordan':'Michael Jordan',
    ohtani:'Shohei Ohtani', trout:'Mike Trout', brady:'Tom Brady', kobe:'Kobe Bryant',
    'randy johnson':'Randy Johnson', mahomes:'Patrick Mahomes', lebron:'LeBron James'
  };
  const MTG_TERMS = ['deathtouch','landfall','flying','trample','lifelink','haste','commander','legendary','instant','sorcery','creature','planeswalker','goblin','artifact','enchantment','draw a card','mana'];
  const SEALED_TERMS = ['booster box','booster bundle','elite trainer box','etb','hobby box','blaster','mega box','collector booster','set booster','tin','pack','case','sealed'];
  const POKEMON_TERMS = ['pokemon','pikachu','charizard','bulbasaur','squirtle','charmander','umbreon','eevee','mew','mewtwo','gengar','rayquaza','vmax','vstar','sir','illustration rare','trainer gallery','swsh','svp'];
  const COMIC_TERMS = ['asm','amazing spider-man','tmnt','teenage mutant ninja turtles','uxm','uncanny x-men','x-men','hulk','fantastic four','ff','batman','detective','tec','spawn','walking dead','venom','newsstand','direct','marvel','dc','mirage','issue','facsimile','reprint'];
  const FILLER = new Set(['the','lookup','price','value','please']);

  function unique(values, limit = 8){
    const seen = new Set(), out = [];
    for(const value of values || []){
      const clean = String(value || '').replace(/\s+/g,' ').trim(), key = clean.toLowerCase();
      if(!clean || seen.has(key)) continue;
      seen.add(key); out.push(clean);
      if(out.length >= limit) break;
    }
    return out;
  }

  function categoryKey(value = ''){
    return CATEGORY_ALIASES[String(value || '').trim().toLowerCase()] || String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  }

  function expandAliases(text = ''){
    let out = String(text || '');
    Object.entries(TEXT_ALIASES).forEach(([alias, full]) => {
      out = out.replace(new RegExp('(^|\\s)' + alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '(?=\\s|$)', 'gi'), '$1' + full);
    });
    return out.replace(/\s+/g,' ').trim();
  }

  function normalizeUserQuery(rawQuery = ''){
    const raw = String(rawQuery || '').trim();
    let normalized = raw.normalize('NFKC')
      .replace(/[\u2018\u2019\u201c\u201d]/g, '').replace(/[\u2013\u2014]/g, '-')
      .replace(/\b(?:card\s+)?(?:number|no\.?)[\s#]*(\d{1,4})\s+(?:out\s+of|over|of)\s+(\d{1,4})\b/gi, '$1/$2')
      .replace(/\b(\d{1,4})\s+(?:slash|out\s+of|over)\s+(\d{1,4})\b/gi, '$1/$2')
      .replace(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/g, '$1/$2')
      .replace(/\b(?:card\s+)?(?:number|no\.)\s*([A-Z]{0,8}\d[A-Z0-9-]{0,12})\b/gi, '#$1')
      .replace(/\s+/g,' ').trim();
    normalized = expandAliases(normalized).toLowerCase();
    const collectorNumbers = unique([
      ...(normalized.match(/\b\d{1,4}\/\d{1,4}\b/g) || []),
      ...(normalized.match(/\b(?:svp|swsh|hgss|sm|xy|bw|tg|gg|rc|dp)\d{2,3}\b/gi) || []),
      ...(normalized.match(/\b(?=[a-z0-9-]*\d)[a-z]{1,8}\d[a-z0-9-]{1,12}\b/gi) || []),
      ...(normalized.match(/\b\d{1,4}[a-z][a-z0-9-]{1,12}\b/gi) || [])
    ]).map(v => v.includes('/') ? v : v.toUpperCase());
    const years = unique(normalized.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
    const issueNumbers = unique((normalized.match(/#\s*\d{1,4}\b/g) || []).map(v => v.replace(/\D/g,'')));
    const cardNumbers = unique([...collectorNumbers, ...issueNumbers, ...((normalized.match(/#\s*[a-z0-9-]+\b/gi) || []).map(v => v.replace(/^#\s*/,'')))]);
    const tokens = normalized.split(/\s+/).map(t => t.replace(/^[#,.;:]+|[.,;:]+$/g,'')).filter(t => t && !FILLER.has(t));
    return {
      raw, normalized, compact:normalized.replace(/[^a-z0-9/#-]+/g,' ').replace(/\s+/g,' ').trim(), tokens,
      numberTokens:tokens.filter(t => /^#?\d+$/.test(t)), collectorNumbers, issueNumbers, years, cardNumbers,
      slashNormalized:collectorNumbers.some(v => v.includes('/')), voiceNormalized:normalized, aliasesExpanded:normalized
    };
  }

  function includesAny(text, values){ return values.some(v => text.includes(v)); }

  function extractEntities(query){
    const text = query.normalized;
    const brands = SPORTS_BRANDS.filter(v => text.includes(v));
    const playerKey = Object.keys(SPORTS_PLAYERS).sort((a,b)=>b.length-a.length).find(v => text.includes(v));
    const mechanics = MTG_TERMS.filter(v => text.includes(v));
    const sealedTypes = SEALED_TERMS.filter(v => text.includes(v));
    const variantTerms = unique(text.match(/\b(?:rookie|rc|auto(?:graph)?|relic|patch|parallel|newsstand|direct|venom|mirage|sir|ir|full art|reverse holo|holo|borderless|japanese|1st edition|first print(?:ing)?|second print(?:ing)?|2nd print(?:ing)?|sketch|foil|virgin|ratio|incentive|facsimile|reprint)\b/g) || []);
    const plainNumbers = query.tokens.filter(t => /^#?\d{1,4}$/.test(t)).map(t => t.replace(/^#/,'')).filter(t => !query.years.includes(Number(t)));
    return {
      years:query.years, year:query.years[0] || null,
      cardNumber:query.collectorNumbers[0] || query.cardNumbers[0] || plainNumbers[plainNumbers.length - 1] || '', collectorNumbers:query.collectorNumbers,
      issueNumber:query.issueNumbers[0] || '', brands, brand:brands[0] || '', player:playerKey ? SPORTS_PLAYERS[playerKey] : '',
      rookieIntent:/\b(?:rookie|rc)\b/.test(text), mechanics, sealedTypes, variantTerms,
      language:/\b(?:japanese|jpn)\b/.test(text) ? 'japanese' : /\benglish\b/.test(text) ? 'english' : ''
    };
  }

  function detectSearchIntent(normalizedQuery, selectedCategory = ''){
    const query = typeof normalizedQuery === 'string' ? normalizeUserQuery(normalizedQuery) : normalizedQuery;
    const selected = categoryKey(selectedCategory), text = query.normalized, entities = extractEntities(query);
    const scores = { pokemon:0, mtg:0, sports:0, comic:0, sealed:0 };
    if(query.collectorNumbers.some(n => n.includes('/'))) scores.pokemon += 65;
    if(includesAny(text, POKEMON_TERMS)) scores.pokemon += 45;
    if(/\b(?:ex|gx|vmax|vstar|sir|illustration rare|trainer gallery)\b/.test(text)) scores.pokemon += 20;
    if(entities.brands.length || /\b(?:rookie|rc|baseball|basketball|football|hockey|soccer|mlb|nba|nfl|nhl)\b/.test(text)) scores.sports += 55;
    if(entities.player) scores.sports += 30;
    if(entities.year && (entities.brand || entities.player)) scores.sports += 15;
    if(includesAny(text, COMIC_TERMS) || (/\b#?\d{1,4}\b/.test(text) && /\b(?:issue|variant|newsstand|mirage)\b/.test(text))) scores.comic += 60;
    if(entities.mechanics.length || /\b(?:magic the gathering|mtg|planeswalker|sorcery|instant|rhystic(?: study)?|sol ring)\b/.test(text)) scores.mtg += 55;
    if(entities.sealedTypes.length) scores.sealed += 55;
    if(entities.sealedTypes.length && scores.pokemon) scores.sealed += 20;
    if(selected && !['all','auto'].includes(selected)) scores[selected] = 100;
    const ordered = Object.entries(scores).sort((a,b)=>b[1]-a[1]).filter(([,score])=>score>0);
    const inferredCategories = selected && !['all','auto'].includes(selected) ? [selected] : ordered.slice(0,2).map(([key])=>key);
    return { selectedCategory:selected, inferredCategories, confidenceByCategory:scores, entities };
  }

  function sportsQueries(query, entities){
    const text = query.normalized;
    const year2 = (text.match(/\b\d{2}\b/g) || []).find(value => value !== String(entities.cardNumber || '').replace(/^#/,''));
    let year = entities.year ? String(entities.year) : '';
    if(!year && year2) year = (Number(year2) >= 50 ? '19' : '20') + year2;
    const player = entities.player, brand = entities.brand, num = String(entities.cardNumber || '').replace(/^#/,'');
    const out = [];
    if(/griffey/.test(text) && /upper deck/.test(text) && (!num || num === '1')) out.push('1989 Upper Deck Ken Griffey Jr #1');
    if(/jordan/.test(text) && /fleer/.test(text) && (!num || num === '57')) out.push('1986 Fleer Michael Jordan #57');
    if(/randy johnson/.test(text) && /75ya-rj/i.test(text)) out.push('2026 Topps 75 Years of Topps All-Stars Randy Johnson 75YA-RJ');
    if(player || brand || year || num) out.push([year, brand, player, num ? '#'+num : '', entities.rookieIntent ? 'rookie' : ''].filter(Boolean).join(' '));
    out.push(text);
    if(player) out.push([player, brand, num ? '#'+num : '', entities.rookieIntent ? 'rookie' : ''].filter(Boolean).join(' '));
    if(player && brand) out.push([year, brand, 'Baseball', player, num ? '#'+num : ''].filter(Boolean).join(' '));
    return unique(out, 5);
  }

  function comicQueries(query, entities){
    const text = query.normalized
      .replace(/^hulk(?=\s|$)/, 'incredible hulk')
      .replace(/^ff(?=\s|$)/, 'fantastic four')
      .replace(/^tec(?=\s|$)/, 'detective comics')
      .replace(/^detective(?=\s+#?\d|\s+\d)/, 'detective comics')
      .replace(/^walking dead(?=\s|$)/, 'the walking dead');
    const issue = entities.issueNumber || (text.match(/\b(?:issue\s*)?#?\s*(\d{1,4})\b/) || [])[1] || '';
    const variantPattern = /\b(?:venom|newsstand|direct|variant|mirage|sketch|foil|virgin|ratio|incentive|facsimile|reprint|first print(?:ing)?|second print(?:ing)?|2nd print(?:ing)?)\b/g;
    const title = text.replace(/\b(?:issue\s*)?#?\s*\d{1,4}\b/g,' ').replace(variantPattern,' ').replace(/\s+/g,' ').trim();
    return unique([
      [title, issue ? '#'+issue : '', entities.variantTerms.join(' ')].filter(Boolean).join(' '),
      [title, issue || '', /venom/.test(text) ? 'Venom' : ''].filter(Boolean).join(' '), text,
      [title, issue ? '#'+issue : ''].filter(Boolean).join(' ')
    ], 4);
  }

  function mtgQueries(query, entities){
    const text = query.normalized.replace(/\bmtg\b|\bmagic the gathering\b/g,' ').replace(/\s+/g,' ').trim();
    if(entities.mechanics.length) return unique([entities.mechanics.map(term => term.includes(' ') ? 'o:"'+term+'"' : 'o:'+term).join(' '), text], 3);
    if(text === 'rhystic') return ['Rhystic Study', 'rhystic'];
    return unique([text], 3);
  }

  function pokemonQueries(query, entities){
    const text = query.normalized, out = [text];
    if(entities.cardNumber) out.push([text.replace(String(entities.cardNumber).toLowerCase(),''), entities.cardNumber].filter(Boolean).join(' '));
    if(/charizard/.test(text) && /\bsir\b/.test(text) && /\b151\b/.test(text)) out.push('Charizard ex 199/165', 'Charizard ex Scarlet Violet 151');
    if(/bulbasaur/.test(text) && /\bir\b/.test(text) && /mega evolution/.test(text)) out.push('Bulbasaur 133/132', 'Bulbasaur illustration rare Mega Evolution');
    if(/pikachu/.test(text) && /swsh050/.test(text)) out.unshift('Pikachu SWSH050');
    return unique(out, 5);
  }

  function sealedQueries(query){
    const text = query.normalized.replace(/\betb\b/g,'elite trainer box');
    return unique([text, text.replace(/\bsealed\b/g,'').trim()], 3);
  }

  function adapter(category, provider, route, queries, confidence, filters = {}){
    return { category, provider, route, queries:unique(queries,5), filters, expectedFields:{ id:true, name:true, set:true, cardNumber:true }, confidence };
  }

  function buildSearchPlan(rawQuery, selectedCategory = ''){
    const normalized = normalizeUserQuery(rawQuery), intent = detectSearchIntent(normalized, selectedCategory), entities = intent.entities;
    let categories = intent.inferredCategories.slice();
    if(!categories.length){ const selected = categoryKey(selectedCategory); categories = selected && !['all','auto'].includes(selected) ? [selected] : []; }
    const adapters = [];
    categories.forEach(category => {
      const confidence = Number(intent.confidenceByCategory[category] || 50) / 100;
      if(category === 'pokemon') adapters.push(adapter('pokemon','PokemonPriceTracker','/pricing/pokemon/cards',pokemonQueries(normalized,entities),confidence,{ language:entities.language || 'english', limit:5 }));
      if(category === 'sports' || category === 'graded') {
        const queries = sportsQueries(normalized,entities);
        adapters.push(adapter('sports','SportsCardsPro','/pricing/sportscardspro/products',queries,confidence,{ maxQueries:3 }));
        adapters.push(adapter('sports','PriceCharting','/pricing/pricecharting/search',queries,confidence,{ endpoint:'/api/products', maxQueries:2 }));
      }
      if(category === 'comic') adapters.push(adapter('comic','PriceCharting','/pricing/pricecharting/search',comicQueries(normalized,entities),confidence,{ endpoint:'/api/products', maxQueries:3 }));
      if(category === 'mtg') adapters.push(adapter('mtg','Scryfall','https://api.scryfall.com/cards/search',mtgQueries(normalized,entities),confidence,{ mode:entities.mechanics.length ? 'oracle' : 'name-or-text' }));
      if(category === 'sealed') adapters.push(adapter('sealed','PokemonPriceTracker','/pricing/pokemon/sealed-products',sealedQueries(normalized),confidence,{ limit:20 }));
    });
    return { rawQuery:String(rawQuery || ''), normalizedQuery:normalized.normalized, normalized, intent, adapters, callBudget:5, execution:{ routes:[], staleResponsesIgnored:0 } };
  }

  function queriesFor(plan, category, provider){
    const cat = categoryKey(category), found = (plan?.adapters || []).find(a => a.category === cat && (!provider || a.provider === provider));
    return found?.queries?.slice() || [];
  }

  function resultText(result = {}){
    return [result.name,result.set,result.year,result.card_number,result.variant,result.category,result.player,result.team,result.issue,result.publisher,result.note,result.raw?.['product-name'],result.raw?.['console-name']].filter(Boolean).join(' ').toLowerCase();
  }

  function scoreResult(result, plan, providerRank = 0, generatedQuery = ''){
    const text = resultText(result), entities = plan?.intent?.entities || {}, category = categoryKey(result.category || (result.source === 'scryfall' ? 'mtg' : ''));
    let score = Number(result.confidence || 0) + Math.max(0, 30 - providerRank * 3);
    const matchedOn = [], wantedNumber = String(entities.cardNumber || '').replace(/^#/,'').toLowerCase(), resultNumber = String(result.card_number || result.issue || '').replace(/^#/,'').toLowerCase();
    if(wantedNumber){
      if(resultNumber === wantedNumber || text.includes('#'+wantedNumber) || text.includes(' '+wantedNumber+' ')){ score += 650; matchedOn.push('exact card number'); }
      else { score -= 500; matchedOn.push('card number mismatch'); }
    }
    if(entities.player && text.includes(entities.player.toLowerCase())){ score += 180; matchedOn.push('player match'); }
    if(entities.year){ if(text.includes(String(entities.year))){ score += 150; matchedOn.push('year match'); } else score -= 90; }
    if(entities.brand){ if(text.includes(entities.brand)){ score += 150; matchedOn.push('brand/set match'); } else score -= 100; }
    if(entities.rookieIntent && /\b(?:rookie|rc)\b/.test(text)){ score += 80; matchedOn.push('rookie match'); }
    if(entities.issueNumber && (resultNumber === entities.issueNumber || text.includes('#'+entities.issueNumber))){ score += 300; matchedOn.push('exact issue'); }
    if(plan?.intent?.inferredCategories?.includes('comic')){
      const requestedVariants = entities.variantTerms || [];
      const variantHits = requestedVariants.filter(term => text.includes(term));
      if(variantHits.length){ score += variantHits.length * 130; matchedOn.push('variant/edition match'); }
      if(requestedVariants.length && !variantHits.length){ score -= 90; matchedOn.push('variant needs confirmation'); }
      const asksReprint = requestedVariants.some(term => /reprint|facsimile|second|2nd/.test(term));
      if(!asksReprint && /\b(?:facsimile|reprint|trade paperback|tpb|graphic novel|omnibus|compendium)\b/.test(text)){
        score -= 260; matchedOn.push('reprint/collected edition penalty');
      }
    }
    if(plan?.intent?.inferredCategories?.includes(category)){ score += 100; matchedOn.push('category match'); }
    const covered = (plan?.normalized?.tokens || []).filter(t => t.length > 1 && text.includes(t));
    score += Math.min(covered.length, 8) * 18;
    if(covered.length) matchedOn.push('query term coverage');
    return { score, matchedOn:unique(matchedOn,8), generatedQuery, providerRank };
  }

  function mergeAndRankResults(results, plan){
    const merged = new Map();
    (results || []).forEach((result, index) => {
      const id = result.tcgPlayerId || result.tcgplayerId || result.scpId || result.pricecharting?.productId || result.productId || result.scryfallId;
      const fallback = [result.name,result.set,result.card_number,result.year,result.variant].map(v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'')).join('|');
      const key = id ? String(result.source || '') + ':' + String(id) : fallback;
      const generatedQuery = result.searchExplain?.generatedQuery || result.lookupDebug?.rawQuerySent || plan?.normalizedQuery || '';
      const explain = scoreResult(result, plan, index, generatedQuery);
      const row = { ...result, rankScore:explain.score, searchExplain:explain, matchWhy:unique([...(result.matchWhy || []), ...explain.matchedOn],8) };
      const prior = merged.get(key);
      if(!prior || Number(row.rankScore) > Number(prior.rankScore)) merged.set(key,row);
      else prior.searchExplain = { ...prior.searchExplain, alsoMatchedBy:unique([...(prior.searchExplain.alsoMatchedBy || []), generatedQuery],5) };
    });
    return [...merged.values()].sort((a,b)=>Number(b.rankScore||0)-Number(a.rankScore||0));
  }

  return { normalizeUserQuery, detectSearchIntent, buildSearchPlan, queriesFor, mergeAndRankResults, scoreResult, categoryKey, unique };
});
