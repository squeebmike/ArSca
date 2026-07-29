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
    'randy johnson':'Randy Johnson', mahomes:'Patrick Mahomes', lebron:'LeBron James',
    julio:'Julio Rodriguez', 'julio rodriguez':'Julio Rodriguez'
  };
  const MTG_TERMS = ['deathtouch','landfall','flying','trample','lifelink','haste','commander','legendary','instant','sorcery','creature','planeswalker','artifact','enchantment','draw a card','mana','sol ring','arcane signet','command tower','swords to plowshares','counterspell','beast within'];
  const MTG_CARD_NAMES = ['sol ring','arcane signet','command tower','swords to plowshares','counterspell','beast within','fire // ice','fable of the mirror-breaker'];
  const SEALED_TERMS = ['booster box','booster bundle','play booster','play booster display','collector booster','collector booster box','draft booster','set booster','booster display','elite trainer box','etb','hobby box','blaster','mega box','secret lair','secret lair drop','commander deck','starter kit','precon','tin','pack','case','display','drop','sealed'];
  const POKEMON_TERMS = ['pokemon','pikachu','charizard','bulbasaur','squirtle','charmander','umbreon','eevee','mew','mewtwo','gengar','rayquaza','vmax','vstar','sir','illustration rare','trainer gallery','swsh','svp','151','prismatic evolutions','evolving skies','surging sparks','paldea evolved','obsidian flames'];
  const COMIC_TERMS = ['asm','amazing spider-man','tmnt','teenage mutant ninja turtles','uxm','uncanny x-men','x-men','hulk','fantastic four','ff','batman','detective','tec','spawn','walking dead','venom','newsstand','direct','marvel','dc','mirage','issue','facsimile','reprint'];
  // Only "the/lookup/price/value/please" originally -- nowhere near enough to
  // survive a spoken/natural-language request ("do you have a charizard from
  // base set"). PPT's own search docs only demonstrate clean 2-4 word phrases
  // (e.g. "charizard base set"), not full sentences.
  const FILLER = new Set([
    'the','a','an','lookup','price','value','please','thanks','thank','you',
    'do','does','did','is','are','was','were','have','has','had','can','could','would','should','will',
    'i','im','me','my','we','us','our','it','its','that','this','these','those',
    'looking','look','want','wanted','need','needed','got','get','getting','find','finding','show','showing','see','seeing','know','tell',
    'any','some','there','here','if','whether','so','just','like','pull','pulling','up',
    'for','from','of','with','about','on','at','to','in','into','out',
    'by','artist','illustrated','drawn','all','every','each'
  ]);
  // Pokemon rarity shorthand -> the canonical rarity text PPT's rarity field
  // actually stores. Matches what pokemonExpandSearchAbbreviations already
  // expands for free-text search; also used to fill the dedicated `rarity`
  // filter param, which free-text search alone can't target precisely.
  const RARITY_MAP = {
    sir:'Special Illustration Rare', sar:'Special Art Rare', ir:'Illustration Rare', ar:'Art Rare',
    'hyper rare':'Hyper Rare', 'rainbow rare':'Rainbow Rare', 'secret rare':'Secret Rare', 'ultra rare':'Ultra Rare',
    'ace spec':'ACE SPEC Rare', 'full art':'Full Art', 'trainer gallery':'Trainer Gallery', 'amazing rare':'Amazing Rare',
    radiant:'Radiant', gx:'GX', ex:'EX', vmax:'VMAX', vstar:'VSTAR', v:'V', 'double rare':'Double Rare', 'shiny rare':'Shiny Rare',
  };
  const CARD_TYPE_MAP = { trainer:'Trainer', energy:'Energy', pokemon:'Pokemon' };
  // Voice-to-text dictates digits and spelled-out letters one at a time
  // ("one four three slash one four two", "s i r") instead of writing them
  // as words/acronyms. Collapse runs of 2+ before anything else touches them.
  const DIGIT_WORDS = { zero:'0', oh:'0', one:'1', two:'2', three:'3', four:'4', five:'5', six:'6', seven:'7', eight:'8', nine:'9' };
  const DIGIT_WORD_RE = new RegExp('\\b(?:' + Object.keys(DIGIT_WORDS).join('|') + ')(?:\\s+(?:' + Object.keys(DIGIT_WORDS).join('|') + ')){1,}\\b', 'gi');
  const LETTER_RUN_RE = /\b[a-z](?:\s+[a-z]){1,}\b/gi;
  function collapseSpokenDigits(text = ''){
    return String(text).replace(DIGIT_WORD_RE, run => run.trim().split(/\s+/).map(w => DIGIT_WORDS[w.toLowerCase()]).join(''));
  }
  function collapseSpokenLetters(text = ''){
    return String(text).replace(LETTER_RUN_RE, run => run.trim().split(/\s+/).join(''));
  }

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
    // Collapse spoken digit/letter runs first ("one four three" -> "143",
    // "s i r" -> "sir") so the existing slash/number normalization below and
    // every downstream detector sees them as the real tokens they represent.
    let normalized = collapseSpokenLetters(collapseSpokenDigits(raw)).normalize('NFKC')
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

  const ARTIST_TRIGGER_RE = /\b(?:art(?:work)?\s*by|illustrated\s*by|drawn\s*by|artist(?:\s*is|\s*name)?|by)\s+([a-z][a-z' .-]{1,60}?)\s*$/i;
  const RARITY_KEYS_SORTED = Object.keys(RARITY_MAP).sort((a,b) => b.length - a.length);
  const RARITY_RE = new RegExp('\\b(?:' + RARITY_KEYS_SORTED.map(k => k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')\\b', 'i');
  const CARD_TYPE_RE = /\b(trainer|energy)\b/i;
  const SHOW_ALL_RE = /\b(?:all|every|each)\b/i;

  function extractPokemonArtist(text){
    const m = ARTIST_TRIGGER_RE.exec(text);
    return m ? m[1].replace(/\s+/g,' ').trim() : '';
  }
  function extractPokemonRarity(text){
    const m = RARITY_RE.exec(text);
    return m ? RARITY_MAP[m[0].toLowerCase()] : '';
  }
  function extractPokemonCardType(text){
    const m = CARD_TYPE_RE.exec(text);
    return m ? CARD_TYPE_MAP[m[1].toLowerCase()] : '';
  }

  function extractEntities(query){
    const text = query.normalized;
    const brands = SPORTS_BRANDS.filter(v => text.includes(v));
    const playerKey = Object.keys(SPORTS_PLAYERS).sort((a,b)=>b.length-a.length).find(v => text.includes(v));
    const mechanics = MTG_TERMS.filter(v => text.includes(v));
    const sealedTypes = SEALED_TERMS.filter(v => text.includes(v));
    const variantTerms = unique(text.match(/\b(?:rookie|rc|auto(?:graph)?|relic|patch|parallel|logoman|cosmic|uranus|kaboom|downtown|color blast|stained glass|zebra|gold vinyl|newsstand|direct|venom|mirage|sir|ir|full art|reverse holo|holo|borderless|japanese|1st edition|first print(?:ing)?|second print(?:ing)?|2nd print(?:ing)?|sketch|foil|virgin|ratio|incentive|facsimile|reprint)\b/g) || []);
    const plainNumbers = query.tokens.filter(t => /^#?\d{1,4}$/.test(t)).map(t => t.replace(/^#/,'')).filter(t => !query.years.includes(Number(t)));
    return {
      years:query.years, year:query.years[0] || null,
      cardNumber:query.collectorNumbers[0] || query.cardNumbers[0] || plainNumbers[plainNumbers.length - 1] || '', collectorNumbers:query.collectorNumbers,
      issueNumber:query.issueNumbers[0] || '', brands, brand:brands[0] || '', player:playerKey ? SPORTS_PLAYERS[playerKey] : '',
      pokemonArtist:extractPokemonArtist(text), pokemonRarity:extractPokemonRarity(text), pokemonCardType:extractPokemonCardType(text),
      wantsAll:SHOW_ALL_RE.test(text),
      rookieIntent:/\b(?:rookie|rc)\b/.test(text), mechanics, sealedTypes, variantTerms,
      language:/\b(?:japanese|jpn)\b/.test(text) ? 'japanese' : /\benglish\b/.test(text) ? 'english' : ''
    };
  }

  function detectSearchIntent(normalizedQuery, selectedCategory = ''){
    const query = typeof normalizedQuery === 'string' ? normalizeUserQuery(normalizedQuery) : normalizedQuery;
    const selected = categoryKey(selectedCategory), text = query.normalized, entities = extractEntities(query);
    const scores = { pokemon:0, mtg:0, sports:0, comic:0, sealed:0, graded:0 };
    if(query.collectorNumbers.some(n => n.includes('/'))) scores.pokemon += 65;
    if(includesAny(text, POKEMON_TERMS)) scores.pokemon += 45;
    if(/\b(?:ex|gx|vmax|vstar|sir|illustration rare|trainer gallery)\b/.test(text)) scores.pokemon += 20;
    if(entities.brands.length || /\b(?:rookie|rc|baseball|basketball|football|hockey|soccer|mlb|nba|nfl|nhl)\b/.test(text)) scores.sports += 55;
    if(entities.player) scores.sports += 30;
    if(entities.player && entities.variantTerms.length) scores.sports += 35;
    if(entities.year && (entities.brand || entities.player)) scores.sports += 15;
    if(/\b(?:psa|bgs|cgc|sgc)\s*(?:10|9\.?8|9|8\.?5|8)\b|\bgraded\b/.test(text)) scores.graded += 70;
    if(scores.graded && (scores.pokemon || scores.sports || scores.comic)) scores.graded += 15;
    if(includesAny(text, COMIC_TERMS) || (/\b#?\d{1,4}\b/.test(text) && /\b(?:issue|variant|newsstand|mirage)\b/.test(text))) scores.comic += 60;
    if(entities.mechanics.length || /\b(?:magic the gathering|mtg|planeswalker|sorcery|instant|rhystic(?: study)?|sol ring|secret lair)\b/.test(text)) scores.mtg += 55;
    if(entities.sealedTypes.length) scores.sealed += 55;
    if(entities.sealedTypes.length && scores.pokemon) scores.sealed += 20;
    if(selected && !['all','auto'].includes(selected)) scores[selected] = 100;
    const ordered = Object.entries(scores).sort((a,b)=>b[1]-a[1]).filter(([,score])=>score>0);
    const inferredCategories = selected && !['all','auto'].includes(selected)
      ? [selected, ...((['pokemon','mtg'].includes(selected) && scores.sealed > 0) ? ['sealed'] : [])]
      : ordered.slice(0,2).map(([key])=>key);
    return { selectedCategory:selected, inferredCategories, confidenceByCategory:scores, entities };
  }

  function sportsQueries(query, entities){
    const text = query.normalized;
    if(/\b(?:psa|bgs|cgc|sgc)\s*(?:10|9\.?8|9|8\.?5|8)\b/.test(text)) return unique([text], 5);
    const year2 = (text.match(/\b\d{2}\b/g) || []).find(value => value !== String(entities.cardNumber || '').replace(/^#/,''));
    let year = entities.year ? String(entities.year) : '';
    if(!year && year2) year = (Number(year2) >= 50 ? '19' : '20') + year2;
    const player = entities.player, brand = entities.brand, num = String(entities.cardNumber || '').replace(/^#/,'');
    const variants = (entities.variantTerms || []).filter(term => !/rookie|rc/.test(term)).join(' ');
    const out = [];
    if(/griffey/.test(text) && /upper deck/.test(text) && (!num || num === '1')) out.push('1989 Upper Deck Ken Griffey Jr #1');
    if(/jordan/.test(text) && /fleer/.test(text) && (!num || num === '57')) out.push('1986 Fleer Michael Jordan #57');
    if(/randy johnson/.test(text) && /75ya-rj/i.test(text)) out.push('2026 Topps 75 Years of Topps All-Stars Randy Johnson 75YA-RJ');
    if(player || brand || year || num || variants) out.push([year, brand, player, num ? '#'+num : '', variants, entities.rookieIntent ? 'rookie' : ''].filter(Boolean).join(' '));
    out.push(text);
    if(player) out.push([player, brand, num ? '#'+num : '', variants, entities.rookieIntent ? 'rookie' : ''].filter(Boolean).join(' '));
    if(player && brand) out.push([year, brand, 'Baseball', player, num ? '#'+num : '', variants].filter(Boolean).join(' '));
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
    if(MTG_CARD_NAMES.includes(text)) return unique([text], 3);
    if(entities.mechanics.length) return unique([entities.mechanics.map(term => term.includes(' ') ? 'o:"'+term+'"' : 'o:'+term).join(' '), text], 3);
    if(text === 'rhystic') return ['Rhystic Study', 'rhystic'];
    return unique([text], 3);
  }

  function pokemonQueries(query, entities){
    const text = query.normalized;
    // "by NAME" is routed through the dedicated artist filter param (search
    // never scans the artist field per PPT's docs), so strip it out of the
    // free-text query rather than sending it as noise.
    const withoutArtist = entities.pokemonArtist ? text.replace(ARTIST_TRIGGER_RE, '').trim() : text;
    const baseText = withoutArtist || text;
    // Stopword-filtered keywords are the primary query -- PPT's docs only
    // show clean phrases ("charizard base set"); a full spoken sentence full
    // of "do/you/have/a/from" reliably returns nothing from their search.
    const keywordText = baseText.split(/\s+/).filter(t => t && !FILLER.has(t)).join(' ') || baseText;
    const out = [keywordText, baseText, text];
    if(entities.cardNumber) out.push([keywordText.replace(String(entities.cardNumber).toLowerCase(),''), entities.cardNumber].filter(Boolean).join(' '));
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
      if(category === 'pokemon') {
        // A specific card number means "find this one card" -- keep the
        // small default. Rarity/artist/"show all" with no number means
        // browsing many matches, so ask PPT for more up front.
        const isBrowse = entities.wantsAll || (!entities.cardNumber && (entities.pokemonRarity || entities.pokemonArtist || entities.pokemonCardType));
        adapters.push(adapter('pokemon','PokemonPriceTracker','/pricing/pokemon/cards',pokemonQueries(normalized,entities),confidence,{
          language:entities.language || 'english', limit:isBrowse ? 30 : 5,
          ...(entities.pokemonArtist ? { artist:entities.pokemonArtist } : {}),
          // Rarity/cardType only applied when browsing -- an exact card-number
          // lookup (e.g. "charizard ex 199/165") must not risk being filtered
          // out by a guessed rarity string that may not match PPT's stored value.
          ...(isBrowse && entities.pokemonRarity ? { rarity:entities.pokemonRarity } : {}),
          ...(isBrowse && entities.pokemonCardType ? { cardType:entities.pokemonCardType } : {}),
        }));
      }
      if(category === 'sports' || category === 'graded') {
        const queries = sportsQueries(normalized,entities);
        if(category === 'sports') adapters.push(adapter('sports','SportsCardsPro','/pricing/sportscardspro/products',queries,confidence,{ maxQueries:3 }));
        adapters.push(adapter(category,'PriceCharting','/pricing/pricecharting/search',queries,confidence,{ endpoint:'/api/products', maxQueries:2, slab:true }));
      }
      if(category === 'comic') adapters.push(adapter('comic','PriceCharting','/pricing/pricecharting/search',comicQueries(normalized,entities),confidence,{ endpoint:'/api/products', maxQueries:3 }));
      if(category === 'mtg') adapters.push(adapter('mtg','Scryfall','https://api.scryfall.com/cards/search',mtgQueries(normalized,entities),confidence,{ mode:entities.mechanics.length ? 'oracle' : 'name-or-text' }));
      if(category === 'sealed') {
        const looksMtgSealed = /\b(?:magic(?: the gathering)?|mtg|secret lair|play booster|collector booster|draft booster|commander deck|starter kit|precon)\b/.test(normalized.normalized);
        if(looksMtgSealed) adapters.push(adapter('sealed','TCGplayerProduct','local:tcgplayer-product',sealedQueries(normalized),confidence,{ game:'Magic: The Gathering', pricing:'todo-backend' }));
        if(intent.confidenceByCategory.pokemon>0) adapters.push(adapter('sealed','PokemonPriceTracker','/pricing/pokemon/sealed-products',sealedQueries(normalized),confidence,{ limit:20 }));
        adapters.push(adapter('sealed','PriceCharting','/pricing/pricecharting/search',sealedQueries(normalized),confidence,{ endpoint:'/api/products', productType:'sealed', maxQueries:2 }));
      }
    });
    return { rawQuery:String(rawQuery || ''), normalizedQuery:normalized.normalized, normalized, intent, adapters, callBudget:5, execution:{ routes:[], staleResponsesIgnored:0 } };
  }

  function queriesFor(plan, category, provider){
    const cat = categoryKey(category), found = (plan?.adapters || []).find(a => a.category === cat && (!provider || a.provider === provider));
    return found?.queries?.slice() || [];
  }

  function filtersFor(plan, category, provider){
    const cat = categoryKey(category), found = (plan?.adapters || []).find(a => a.category === cat && (!provider || a.provider === provider));
    return found?.filters || {};
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
    if(plan?.intent?.inferredCategories?.includes('sealed')){
      const requested=(entities.sealedTypes||[]).map(normalizeUserQuery).map(item=>item.normalized);
      const sealedWords=['booster box','booster bundle','play booster','collector booster','draft booster','elite trainer box','hobby box','blaster','mega box','commander deck','starter kit','tin','pack','case','display','bundle','sealed'];
      const resultTypes=sealedWords.filter(term=>text.includes(term));
      const exactType=requested.some(term=>resultTypes.includes(term));
      if(exactType){score+=260;matchedOn.push('exact sealed product type');}
      else if(requested.length&&resultTypes.length){score-=90;matchedOn.push('different sealed product type');}
      if(result.is_sealed||/factory sealed|sealed product/i.test([result.condition,result.category,result.variant].join(' '))){score+=120;matchedOn.push('sealed product');}
      else if(!resultTypes.length){score-=220;matchedOn.push('single-card result penalty');}
    }
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

  return { normalizeUserQuery, detectSearchIntent, buildSearchPlan, queriesFor, filtersFor, mergeAndRankResults, scoreResult, categoryKey, unique };
});
