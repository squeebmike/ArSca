const DEMO_STORE_ID = 'walkoff-main';
const REGISTER_ID = 'main';

const demoAuthSession = {
  user: {
    id: 'qa-demo-owner',
    email: 'qa-owner@walkoff.local',
    displayName: 'QA Demo Owner',
    role: 'owner',
    defaultStoreId: DEMO_STORE_ID,
  },
  stores: [
    {
      id: DEMO_STORE_ID,
      ownerUserId: 'qa-demo-owner',
      name: 'walkoff-main',
      displayName: 'QA Demo Store',
      logoUrl: '',
      location: 'Test Bench',
      timezone: 'America/Los_Angeles',
      currency: 'USD',
      status: 'active',
      createdAt: '2026-05-08T00:00:00.000Z',
    },
  ],
  activeStoreId: DEMO_STORE_ID,
  demoMode: true,
  createdAt: '2026-05-08T00:00:00.000Z',
};

const localFixtures = {
  inventory: [
    {
      id: 'qa-inv-wolverine-1',
      name: 'Wolverine #1',
      category: 'Comic',
      set: 'Wolverine',
      issue: '1',
      market: 45,
      cost: 20,
      status: 'in_stock',
      lifecycle: 'in_stock',
      priceSource: 'QA fixture',
    },
    {
      id: 'qa-inv-pikachu-151',
      name: 'Pikachu',
      category: 'TCG',
      set: 'Scarlet & Violet 151',
      card_number: '173/165',
      variant: 'Illustration Rare',
      condition: 'NM',
      market: 22,
      cost: 8,
      status: 'in_stock',
      lifecycle: 'in_stock',
      priceSource: 'QA fixture',
    },
    {
      id: 'qa-inv-151-booster-bundle',
      name: 'Pokemon 151 Booster Bundle',
      category: 'Sealed Product',
      set: 'Scarlet & Violet 151',
      condition: 'Factory Sealed',
      market: 58,
      cost: 36,
      status: 'in_stock',
      lifecycle: 'in_stock',
      priceSource: 'QA fixture',
    },
    {
      id: 'qa-inv-surging-sparks-booster-box',
      name: 'Surging Sparks Booster Box',
      category: 'Sealed Product',
      set: 'Surging Sparks',
      condition: 'Factory Sealed',
      market: 210,
      cost: 135,
      status: 'in_stock',
      lifecycle: 'in_stock',
      priceSource: 'QA fixture',
    },
  ],
  scanQueue: [
    {
      id: 'qa-scan-pikachu-151',
      scanId: 'qa-scan-pikachu-151',
      storeId: DEMO_STORE_ID,
      registerId: REGISTER_ID,
      source: 'qa-fixture-scanner',
      target: 'research',
      name: 'Pikachu 151',
      category: 'Pokemon TCG',
      categoryIntent: 'Pokemon TCG',
      rawExtractedText: 'pikachu 151',
      queryUsed: 'pikachu 151',
      price: 22,
      priceUsed: 22,
      priceSource: 'QA fixture',
      confidenceScore: 92,
      possibleMatches: [
        {
          source: 'JustTCG',
          name: 'Pikachu',
          category: 'Pokemon TCG',
          setName: 'Scarlet & Violet 151',
          cardNumber: '173/165',
          marketPrice: 22,
          confidenceScore: 92,
          priceSource: 'JustTCG Exact Variant',
          matchReasons: ['name', 'set alias'],
          selectedVariant: {
            variantId: 'qa-var-nm-normal',
            tcgplayerSkuId: 'qa-sku-nm-normal',
            condition: 'NM',
            finish: 'Normal',
            language: 'English',
            marketPrice: 22,
            priceHistory: [
              { date: '2026-04-08', price: 18 },
              { date: '2026-05-08', price: 22 }
            ]
          }
        }
      ],
    },
  ],
};

const researchQueries = [
  'pikachu sir',
  'pikachu ex',
  'pikachu 151',
  'umbreon vmax evolving skies',
  'charizard 199/165',
  'wolverine 1',
  'asm 300',
  'zelda ocarina n64',
];

async function seedDemoStore(page) {
  await page.addInitScript(({ demoAuthSession, localFixtures, DEMO_STORE_ID, REGISTER_ID }) => {
    const scoped = key => `walkoff:${DEMO_STORE_ID}:${key}`;
    localStorage.setItem('walkoff_auth_session_v1', JSON.stringify(demoAuthSession));
    localStorage.setItem('walkoff_active_store_id', DEMO_STORE_ID);
    localStorage.setItem(scoped('walkoff_universal_inventory'), JSON.stringify(localFixtures.inventory));
    localStorage.setItem(scoped('lba_inventory'), JSON.stringify(localFixtures.inventory));
    localStorage.setItem(scoped('pos_cart_v2'), JSON.stringify({ items: [], discount: 0, storeId: DEMO_STORE_ID, registerId: REGISTER_ID }));
    localStorage.setItem(scoped('pos_buy_list'), JSON.stringify([]));
    localStorage.setItem(`scan_handoff_${DEMO_STORE_ID}_${REGISTER_ID}`, JSON.stringify(localFixtures.scanQueue));
    localStorage.setItem(scoped('vendor_config_v1'), JSON.stringify({
      inventorySource: 'built_in',
      modules: { show: true, cash: true, quick: true, scanner: true, buy: true, closeout: true, ebay: true, backup: true, ops: true, pricingSync: true },
      categories: ['TCG', 'Sports', 'Comic', 'Graded', 'Video Games', 'Collectibles']
    }));
  }, { demoAuthSession, localFixtures, DEMO_STORE_ID, REGISTER_ID });
}

function justTcgMatch(name, overrides = {}) {
  const condition = overrides.condition || 'NM';
  const finish = overrides.finish || 'Normal';
  const variantId = `${name}-${condition}-${finish}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    productId: overrides.productId || variantId,
    id: overrides.productId || variantId,
    name,
    game: overrides.game || 'Pokemon',
    category: 'Pokemon TCG',
    setName: overrides.setName || 'Scarlet & Violet 151',
    cardNumber: overrides.cardNumber || '',
    rarity: overrides.rarity || '',
    imageUrl: overrides.imageUrl || '',
    confidenceScore: overrides.confidenceScore || 94,
    matchReasons: overrides.matchReasons || ['QA mock match'],
    selectedVariant: {
      variantId,
      tcgplayerSkuId: `${variantId}-sku`,
      condition,
      finish,
      language: 'English',
      marketPrice: overrides.marketPrice ?? 20,
      price: overrides.marketPrice ?? 20,
      lowPrice: overrides.lowPrice ?? 18,
      highPrice: overrides.highPrice ?? 26,
      priceSource: 'JustTCG Exact Variant',
      lastUpdated: '2026-05-08T00:00:00.000Z',
      priceHistory: overrides.priceHistory || [
        { date: '2026-04-08', price: 16 },
        { date: '2026-05-08', price: overrides.marketPrice ?? 20 },
      ],
    },
    availableVariants: overrides.availableVariants || [
      { variantId: `${variantId}-nm-normal`, tcgplayerSkuId: `${variantId}-nm-normal-sku`, condition: 'NM', finish: 'Normal', language: 'English', marketPrice: overrides.marketPrice ?? 20, priceHistory: [{ date: '2026-04-08', price: 16 }, { date: '2026-05-08', price: overrides.marketPrice ?? 20 }] },
      { variantId: `${variantId}-lp-normal`, tcgplayerSkuId: `${variantId}-lp-normal-sku`, condition: 'LP', finish: 'Normal', language: 'English', marketPrice: Math.round((overrides.marketPrice ?? 20) * 0.82 * 100) / 100, priceHistory: [{ date: '2026-04-08', price: 14 }, { date: '2026-05-08', price: Math.round((overrides.marketPrice ?? 20) * 0.82 * 100) / 100 }] },
      { variantId: `${variantId}-nm-foil`, tcgplayerSkuId: `${variantId}-nm-foil-sku`, condition: 'NM', finish: 'Foil', language: 'English', marketPrice: Math.round((overrides.marketPrice ?? 20) * 1.4 * 100) / 100, priceHistory: [{ date: '2026-04-08', price: 20 }, { date: '2026-05-08', price: Math.round((overrides.marketPrice ?? 20) * 1.4 * 100) / 100 }] },
    ],
  };
}

function pptCard(name, overrides = {}) {
  const market = Number(overrides.marketPrice || 22);
  const id = String(overrides.tcgPlayerId || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  return {
    tcgPlayerId:id,
    name,
    setName:overrides.setName || 'Scarlet & Violet 151',
    cardNumber:overrides.cardNumber || '',
    rarity:overrides.rarity || 'Illustration Rare',
    language:'English',
    imageUrl:'',
    prices:{
      market,
      primaryCondition:'Near Mint',
      primaryPrinting:'Normal',
      conditions:{ 'Near Mint':{price:market}, 'Lightly Played':{price:Number((market*.82).toFixed(2))} },
      variants:{ Normal:{ 'Near Mint':{price:market}, 'Lightly Played':{price:Number((market*.82).toFixed(2))} }, Foil:{ 'Near Mint':{price:Number((market*1.4).toFixed(2))} } },
      lastUpdated:'2026-07-15T00:00:00.000Z',
    },
  };
}

function priceChartingProduct(productName, overrides = {}) {
  return {
    productId: overrides.productId || productName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    productName,
    csvCategory: overrides.csvCategory || overrides.consoleName || 'Comics',
    consoleName: overrides.consoleName || 'Comics',
    genre: overrides.genre || '',
    releaseDate: overrides.releaseDate || '',
    imageUrl: overrides.imageUrl || '',
    url: 'https://www.pricecharting.com/',
    confidence: 'high',
    matchReasons: overrides.matchReasons || ['QA mock PriceCharting'],
    prices: {
      ungraded: overrides.ungraded ?? 45,
      grade9: overrides.grade9 ?? 120,
      psa10: overrides.psa10 ?? 250,
      loose: overrides.loose ?? overrides.ungraded ?? 45,
      cib: overrides.cib ?? 80,
      new: overrides.new ?? 140,
      graded: overrides.graded ?? 120,
    },
    retail: {
      looseBuy: overrides.retailLooseBuy ?? 20,
      looseSell: overrides.retailLooseSell ?? 45,
    },
    demand: { salesVolume: overrides.salesVolume ?? 12 },
  };
}

function scryfallCard(name, overrides = {}) {
  return {
    id: overrides.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    set: overrides.set || 'cmm',
    set_name: overrides.setName || 'Commander Masters',
    collector_number: overrides.collectorNumber || '',
    type_line: overrides.typeLine || 'Artifact',
    oracle_text: overrides.oracleText || '',
    cmc: overrides.cmc ?? 2,
    color_identity: overrides.colorIdentity || [],
    prices: { usd: overrides.usd ?? '1.00', usd_foil: null, eur: null, tix: null },
    image_uris: { small: overrides.imageUrl || '' },
  };
}

async function mockWalkoffApis(page) {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 204, body: '' }));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**', route => route.fulfill({ contentType: 'application/javascript', body: 'window.supabase = window.supabase || {};' }));
  await page.route('**/collections/**', route => route.fulfill({ json: { items: [], pagination: { total: 0 } } }));
  await page.route('**/kv/**', route => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: { value: JSON.stringify(localFixtures.scanQueue) } });
  });
  await page.route(/still-resonance-4f87\.swarnerauto\.workers\.dev\/cart(\?|$)/, route => route.fulfill({ json: { ok: true, items: [] } }));
  await page.route(/still-resonance-4f87\.swarnerauto\.workers\.dev\/ebay\/status/, route => route.fulfill({ json: { ok: true, connected: false } }));
  await page.route(/still-resonance-4f87\.swarnerauto\.workers\.dev\/sync/, route => route.fulfill({ json: { ok: true } }));
  await page.route('**/pricing/pricecharting/csv/status**', route => route.fulfill({
    json: { ok: true, categories: { Comics: { category: 'Comics', state: 'synced', configured: true, rowCount: 2, cacheRowCount: 2, lastSyncedAt: '2026-05-19T00:00:00.000Z' }, 'Video Games': { category: 'Video Games', state: 'synced', configured: true, rowCount: 1, cacheRowCount: 1, lastSyncedAt: '2026-05-19T00:00:00.000Z' } } }
  }));
  await page.route('**/pricing/pricecharting/csv/test-url**', route => route.fulfill({
    json: { ok: true, state: 'CSV_RETURNED', responseType: 'CSV_RETURNED', parsedRowCount: 2, normalizedRowCount: 2, cacheWriteSuccess: false, cacheKey: 'pc_csv_rows:Pokemon Cards', headers: ['id', 'product-name', 'console-name', 'loose-price'], firstParsedRows: [{ id: '1', 'product-name': 'Pikachu 151', 'console-name': 'Pokemon Cards', 'loose-price': '1234' }] }
  }));
  await page.route('**/pricing/pricecharting/csv/search**', route => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const category = (url.searchParams.get('category') || '').toLowerCase();
    const matches = [];
    if (/julio|logoman/.test(q) || /ohtani|cosmic|uranus/.test(q) || category.includes('sport')) {
      matches.push(priceChartingProduct(/ohtani/.test(q) ? 'Shohei Ohtani Cosmic Uranus' : 'Julio Rodriguez Logoman', { csvCategory: 'Sports Cards', consoleName: 'Sports Cards', ungraded: /ohtani/.test(q) ? 75 : 350 }));
    }
    if (/psa\s*10|graded|charmander/.test(q) || category.includes('graded')) {
      matches.push(priceChartingProduct('PSA 10 Charmander', { csvCategory: 'Pokemon Cards', consoleName: 'Pokemon Cards', ungraded: 12, psa10: 140, graded: 140 }));
    }
    if (/wolverine|asm|spider/.test(q) || category.includes('comic')) {
      matches.push(priceChartingProduct(/asm|spider/.test(q) ? 'Amazing Spider-Man #300' : 'Wolverine #1', { csvCategory: 'Comics', consoleName: 'Comics', ungraded: /asm|spider/.test(q) ? 900 : 45 }));
    }
    if (/zelda|ocarina|n64/.test(q) || category.includes('video')) {
      matches.push(priceChartingProduct('The Legend of Zelda: Ocarina of Time', { csvCategory: 'Video Games', consoleName: 'Nintendo 64', loose: 42, cib: 130, new: 420, ungraded: 42 }));
    }
    return route.fulfill({ json: { ok: true, matches } });
  });
  await page.route('**/pricing/pricecharting/search**', route => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const products = /julio|logoman/.test(q)
      ? [priceChartingProduct('Julio Rodriguez Logoman', { consoleName: 'Sports Cards', ungraded: 350 })]
      : /ohtani|cosmic|uranus/.test(q)
        ? [priceChartingProduct('Shohei Ohtani Cosmic Uranus', { consoleName: 'Sports Cards', ungraded: 75 })]
        : /psa\s*10|graded|charmander/.test(q)
          ? [priceChartingProduct('PSA 10 Charmander', { consoleName: 'Pokemon Cards', ungraded: 12, psa10: 140, graded: 140 })]
          : /zelda|ocarina|n64/.test(q)
            ? [priceChartingProduct('The Legend of Zelda: Ocarina of Time', { consoleName: 'Nintendo 64', ungraded: 42 })]
            : /asm|spider/.test(q)
              ? [priceChartingProduct('Amazing Spider-Man #300')]
              : /wolverine/.test(q)
                ? [priceChartingProduct('Wolverine #1')]
                : [];
    return route.fulfill({ json: { ok: true, matches: products, products } });
  });
  await page.route('**/pricing/pricecharting/slab-prices**', route => route.fulfill({ json: { ok: true, product: priceChartingProduct('Wolverine #1'), prices: { ungraded: 45, grade9: 120, psa10: 250 } } }));
  await page.route('**/pricing/justtcg/search**', route => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') || '').toLowerCase();
    let matches = [];
    if (q.includes('pikachu') && q.includes('sir')) matches = [justTcgMatch('Pikachu SIR', { rarity: 'Special Illustration Rare', cardNumber: '238/191', marketPrice: 125 })];
    else if (q.includes('pikachu') && q.includes('ex')) matches = [justTcgMatch('Pikachu ex', { rarity: 'Double Rare', cardNumber: '057/191', marketPrice: 18 })];
    else if (q.includes('pikachu')) matches = [justTcgMatch('Pikachu', { rarity: 'Illustration Rare', cardNumber: '173/165', setName: 'Scarlet & Violet 151', marketPrice: 22 })];
    else if (q.includes('umbreon')) matches = [justTcgMatch('Umbreon VMAX', { setName: 'Evolving Skies', rarity: 'Ultra Rare', cardNumber: '095/203', marketPrice: 38 })];
    else if (q.includes('charizard')) matches = [justTcgMatch('Charizard', { setName: 'Base Set', rarity: 'Rare Holo', cardNumber: '4/102', marketPrice: 300 })];
    else if (q.includes('greninja')) matches = [justTcgMatch('Greninja ex', { setName: 'Twilight Masquerade', rarity: 'Special Illustration Rare', cardNumber: '214/167', marketPrice: 280 })];
    else if (q.includes('151') && q.includes('booster')) matches = [justTcgMatch('Pokemon 151 Booster Bundle', { setName: 'Scarlet & Violet 151', rarity: 'Sealed Product', cardNumber: '', marketPrice: 58 })];
    else if (q.includes('surging sparks') && q.includes('booster')) matches = [justTcgMatch('Surging Sparks Booster Box', { setName: 'Surging Sparks', rarity: 'Sealed Product', cardNumber: '', marketPrice: 210 })];
    else if (q.includes('charmander')) matches = [justTcgMatch('Charmander', { setName: 'Obsidian Flames', rarity: 'Illustration Rare', cardNumber: '168/197', marketPrice: 22 })];
    else if (q.includes('wolverine')) matches = [justTcgMatch('Wolverine', { game: 'Magic', setName: 'Marvel', rarity: 'Rare', marketPrice: 5, confidenceScore: 40 })];
    return route.fulfill({ json: { ok: true, success: true, matches } });
  });
  await page.route('**/pricing/pokemon/cards**', route => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('search') || '').toLowerCase();
    const exactId = url.searchParams.get('tcgPlayerId') || '';
    let cards = [];
    if (exactId) {
      if (exactId.includes('sir')) cards = [pptCard('Pikachu SIR', { tcgPlayerId:exactId, rarity:'Special Illustration Rare', cardNumber:'238/191', marketPrice:125 })];
      else if (exactId.includes('greninja')) cards = [pptCard('Greninja ex', { tcgPlayerId:exactId, setName:'Twilight Masquerade', cardNumber:'214/167', marketPrice:280 })];
      else if (exactId.includes('charizard')) cards = [pptCard('Charizard', { tcgPlayerId:exactId, setName:'Base Set', cardNumber:'4/102', marketPrice:300 })];
      else if (exactId.includes('bulbasaur')) cards = [pptCard('Bulbasaur', { tcgPlayerId:exactId, setName:'Stellar Crown', cardNumber:'143/142', marketPrice:35 })];
      else cards = [pptCard('Pikachu', { tcgPlayerId:exactId, cardNumber:'173/165', marketPrice:22 })];
    }
    else if (q.includes('pikachu') && q.includes('special illustration rare')) cards = [pptCard('Pikachu SIR', { rarity:'Special Illustration Rare', cardNumber:'238/191', marketPrice:125 })];
    else if (q.includes('pikachu') && q.includes('ex')) cards = [pptCard('Pikachu ex', { rarity:'Double Rare', cardNumber:'057/191', marketPrice:18 })];
    else if (q.includes('pikachu')) cards = [pptCard('Pikachu', { cardNumber:'173/165', marketPrice:22 })];
    else if (q.includes('umbreon')) cards = [pptCard('Umbreon VMAX', { setName:'Evolving Skies', cardNumber:'095/203', marketPrice:38 })];
    else if (q.includes('charizard')) cards = [pptCard('Charizard', { setName:'Base Set', cardNumber:'4/102', marketPrice:300 })];
    else if (q.includes('greninja')) cards = [pptCard('Greninja ex', { setName:'Twilight Masquerade', cardNumber:'214/167', marketPrice:280 })];
    else if (q.includes('143/142')) cards = [pptCard('Bulbasaur', { setName:'Stellar Crown', cardNumber:'143/142', marketPrice:35 })];
    else if (q.includes('charmander')) cards = [pptCard('Charmander', { setName:'Obsidian Flames', cardNumber:'168/197', marketPrice:22 })];
    return route.fulfill({ json:{ ok:true, cards, usage:{remaining:999,consumed:1} } });
  });
  await page.route('**/pricing/pokemon/sealed-products**', route => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('search') || url.searchParams.get('q') || '').toLowerCase();
    const products = [];
    if (q.includes('151') && q.includes('booster')) {
      products.push({
        id: 'qa-sealed-151-bundle',
        tcgPlayerId: 'qa-sealed-151-bundle',
        name: 'Pokemon 151 Booster Bundle',
        setName: 'Scarlet & Violet 151',
        unopenedPrice: 58,
        language: 'English',
        imageUrl: '',
        lastScrapedAt: '2026-05-08T00:00:00.000Z',
      });
    } else if (q.includes('surging sparks') && q.includes('elite trainer box')) {
      products.push({
        id: 'qa-sealed-surging-etb',
        tcgPlayerId: '565630',
        name: 'Surging Sparks Elite Trainer Box',
        setName: 'SV08: Surging Sparks',
        unopenedPrice: 134.47,
        language: 'English',
        imageUrl: '',
        lastScrapedAt: '2026-07-13T00:00:00.000Z',
      });
    } else if (q.includes('surging sparks') && q.includes('booster')) {
      products.push({
        id: 'qa-sealed-surging-box',
        tcgPlayerId: 'qa-sealed-surging-box',
        name: 'Surging Sparks Booster Box',
        setName: 'Surging Sparks',
        unopenedPrice: 210,
        language: 'English',
        imageUrl: '',
        lastScrapedAt: '2026-05-08T00:00:00.000Z',
      });
    }
    return route.fulfill({ json: { ok: true, products } });
  });
  await page.route('**/pricing/justtcg/card/**', route => route.fulfill({ json: { ok: true, ...justTcgMatch('Pikachu', { marketPrice: 22 }) } }));
  await page.route('**/pricing/justtcg/sku/**', route => route.fulfill({ json: { ok: true, skuId: 'qa-sku', marketPrice: 22, priceHistory: [{ date: '2026-04-08', price: 18 }, { date: '2026-05-08', price: 22 }] } }));
  await page.route('**/pricing/tcg**', route => route.fulfill({ json: { ok: true, success: true, matches: [] } }));
  await page.route('https://api.pokemontcg.io/**', route => route.fulfill({ json: { data: [] } }));
  await page.route('https://api.scryfall.com/**', route => {
    const url = new URL(route.request().url());
    const q = `${url.searchParams.get('q') || ''} ${url.searchParams.get('exact') || ''} ${url.searchParams.get('fuzzy') || ''}`.toLowerCase();
    const cards = [
      scryfallCard('Sol Ring', { collectorNumber: '400', cmc: 1, usd: '1.25', oracleText: 'Add two colorless mana.' }),
      scryfallCard('Arcane Signet', { collectorNumber: '300', cmc: 2, usd: '0.75', oracleText: 'Add one mana of any color in your commander color identity.' }),
      scryfallCard('Command Tower', { collectorNumber: '401', typeLine: 'Land', cmc: 0, usd: '0.50', oracleText: 'Add one mana of any color in your commander color identity.' }),
    ].filter(card => q.includes(card.name.toLowerCase()));
    return route.fulfill({ json: { object: 'list', data: cards } });
  });
}

module.exports = {
  DEMO_STORE_ID,
  REGISTER_ID,
  demoAuthSession,
  localFixtures,
  researchQueries,
  seedDemoStore,
  mockWalkoffApis,
};
