/**
 * LBA Proxy Worker - Cloudflare Worker
 * Worker URL: https://still-resonance-4f87.swarnerauto.workers.dev
 *
 * Secrets / bindings expected:
 *   ANTHROPIC_API_KEY
 *   WEBFLOW_TOKEN
 *   PSA_TOKEN
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   EBAY_USER_TOKEN
 *   EBAY_APP_ID
 *   COMICVINE_API_KEY
 *   SOLDCOMPS_API_KEY
 *   LBA_KV
 */

const WEBFLOW_BASE = 'https://api.webflow.com/v2';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const SITE_ID = '65b15ee0228d06647ca7e4ce';
const WF_PRODUCTS = '65eb45a28ff6bf3fe4f17b14';
const WF_STATUS_SOLD = 'e6b42f14fcb99aa2168a5f5672226f68';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
].join(' ');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, accept, x-store-id, X-Store-Id',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, ...extraHeaders, 'Content-Type': 'application/json' },
  });
}

function pokemonQuotaHeaders(headers) {
  const out = {};
  for (const [from, to] of [
    ['X-RateLimit-Remaining', 'X-PokemonPriceTracker-RateLimit-Remaining'],
    ['X-RateLimit-Daily-Remaining', 'X-PokemonPriceTracker-Daily-Remaining'],
    ['X-RateLimit-Reset', 'X-PokemonPriceTracker-RateLimit-Reset'],
    ['X-API-Calls-Consumed', 'X-PokemonPriceTracker-Calls-Consumed'],
    ['X-API-Calls-Breakdown', 'X-PokemonPriceTracker-Calls-Breakdown'],
  ]) {
    const value = headers.get(from);
    if (value != null) out[to] = value;
  }
  return out;
}

function errorMessageFromApi(data, fallback = 'API error') {
  return data?.msg
    || data?.message
    || data?.error?.message
    || data?.errors?.[0]?.longMessage
    || data?.errors?.[0]?.message
    || fallback;
}

function normalizeWebflowItemId(item) {
  return item?.shopId || item?.wfId || item?.webflowId || null;
}

function safeStoreKey(s) {
  return String(s || 'main').replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 80);
}

function cartKeyFromUrl(url) {
  const store = safeStoreKey(url.searchParams.get('store') || 'main');
  const register = safeStoreKey(url.searchParams.get('register') || 'front');
  return `pos_cart:${store}:${register}`;
}

function legacyCartKey(url) {
  const hasScopedKey = url.searchParams.has('store') || url.searchParams.has('register');
  return hasScopedKey ? cartKeyFromUrl(url) : 'pos_cart';
}

async function getStoredSecret(env, key) {
  if (env[key]) return env[key];
  try {
    const val = env.LBA_KV ? await env.LBA_KV.get('secret:' + key) : null;
    return val || '';
  } catch (_) {
    return '';
  }
}

async function putStoredSecret(env, key, value) {
  if (!env.LBA_KV || !value) return false;
  await env.LBA_KV.put('secret:' + key, value);
  return true;
}

async function ebayTokenRequest(env, params) {
  const clientId = await getStoredSecret(env, 'EBAY_CLIENT_ID');
  const clientSecret = await getStoredSecret(env, 'EBAY_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are required');
  const res = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(clientId + ':' + clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  if (!res.ok) throw new Error(errorMessageFromApi(data, 'eBay OAuth ' + res.status));
  return data;
}

async function getEbayUserAccessToken(env) {
  const refreshToken = await getStoredSecret(env, 'EBAY_REFRESH_TOKEN');
  if (!refreshToken) return '';

  const cached = env.LBA_KV ? await env.LBA_KV.get('secret:EBAY_ACCESS_TOKEN') : null;
  const exp = env.LBA_KV ? Number(await env.LBA_KV.get('secret:EBAY_ACCESS_EXPIRES') || 0) : 0;
  if (cached && exp > Date.now() + 120000) return cached;

  const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const data = await ebayTokenRequest(env, params);
  const accessToken = data.access_token;
  if (accessToken && env.LBA_KV) {
    await env.LBA_KV.put('secret:EBAY_ACCESS_TOKEN', accessToken, { expirationTtl: Math.max(300, Number(data.expires_in || 7200)) });
    await env.LBA_KV.put('secret:EBAY_ACCESS_EXPIRES', String(Date.now() + Number(data.expires_in || 7200) * 1000));
  }
  return accessToken || '';
}

function leftRotate(x, c) {
  return (x << c) | (x >>> (32 - c));
}

function md5Hex(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const originalLength = bytes.length;
  const withOne = originalLength + 1;
  const paddedLength = (((withOne + 8 + 63) >> 6) << 6);
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[originalLength] = 0x80;
  const bitLength = originalLength * 8;
  for (let i = 0; i < 8; i++) {
    buffer[paddedLength - 8 + i] = Math.floor(bitLength / (2 ** (8 * i))) & 0xff;
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const k = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

  for (let chunk = 0; chunk < buffer.length; chunk += 64) {
    const m = new Array(16);
    for (let i = 0; i < 16; i++) {
      const j = chunk + i * 4;
      m[i] = (buffer[j] | (buffer[j + 1] << 8) | (buffer[j + 2] << 16) | (buffer[j + 3] << 24)) >>> 0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      b = (b + leftRotate((a + f + k[i] + m[g]) >>> 0, s[i])) >>> 0;
      a = tmp;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map(n =>
    [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
      .map(b => b.toString(16).padStart(2, '0')).join('')
  ).join('');
}

async function readApiJson(res) {
  const text = await res.text();
  try {
    return { text, data: JSON.parse(text) };
  } catch (_) {
    return { text, data: { raw: text } };
  }
}

function compMoneyValue(v) {
  if (typeof v === 'number') return v > 0 ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$,]/g, '').trim());
    return n > 0 ? n : 0;
  }
  if (!v || typeof v !== 'object') return 0;
  for (const key of ['total', 'price', 'value', 'amount', 'soldPrice', 'sold_price', 'salePrice', 'currentPrice']) {
    const n = compMoneyValue(v[key]);
    if (n) return n;
  }
  return 0;
}

function normalizeSoldComp(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  const price = compMoneyValue(raw.price || raw.soldPrice || raw.sold_price || raw.salePrice || raw.amount || raw.currentPrice || raw.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__']);
  const shipping = compMoneyValue(raw.shipping || raw.shippingPrice || raw.shippingCost || raw.shipping_cost || raw.shippingInfo?.[0]?.shippingServiceCost?.[0]?.['__value__']);
  const total = compMoneyValue(raw.total || raw.totalPrice || raw.total_price) || price + shipping;
  if (!price && !total) return null;
  const soldAt = raw.soldAt || raw.sold_at || raw.endedAt || raw.endTime || raw.end_time || raw.date || raw.timestamp || raw.listingEndedAt || raw.listingInfo?.[0]?.endTime?.[0] || null;
  return {
    title: String(raw.title || raw.name || raw.itemTitle || raw.item_title || 'Sold comp').trim(),
    price: Math.round(price * 100) / 100,
    shipping: Math.round(shipping * 100) / 100,
    total: Math.round((total || price) * 100) / 100,
    soldAt,
    currency: raw.soldCurrency || raw.currency || 'USD',
    condition: raw.condition || raw.conditionDisplayName || raw.condition_name || null,
    url: raw.url || raw.itemUrl || raw.item_url || raw.viewItemURL?.[0] || raw.webUrl || null,
    imageUrl: raw.imageUrl || raw.image_url || raw.thumbnail || raw.galleryURL?.[0] || raw.image?.imageUrl || null,
    source,
  };
}

function soldCompStats(comps) {
  const values = comps.map(c => Number(c.total || c.price || 0)).filter(v => v > 0).sort((a, b) => a - b);
  if (!values.length) return { count: 0, avg: 0, median: 0, min: 0, max: 0, trendPct: 0, trendLabel: 'no data' };
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  const dated = comps
    .map(c => ({ ...c, time: c.soldAt ? Date.parse(c.soldAt) : 0 }))
    .filter(c => c.time && Number(c.total || c.price || 0) > 0)
    .sort((a, b) => a.time - b.time);
  let trendPct = 0;
  if (dated.length >= 6) {
    const slice = Math.max(3, Math.floor(dated.length / 3));
    const oldAvg = dated.slice(0, slice).reduce((a, c) => a + Number(c.total || c.price || 0), 0) / slice;
    const newAvg = dated.slice(-slice).reduce((a, c) => a + Number(c.total || c.price || 0), 0) / slice;
    trendPct = oldAvg > 0 ? ((newAvg - oldAvg) / oldAvg) * 100 : 0;
  }
  return {
    count: values.length,
    avg: Math.round(avg * 100) / 100,
    median: Math.round(median * 100) / 100,
    min: Math.round(values[0] * 100) / 100,
    max: Math.round(values[values.length - 1] * 100) / 100,
    trendPct: Math.round(trendPct * 10) / 10,
    trendLabel: Math.abs(trendPct) < 4 ? 'flat' : (trendPct > 0 ? 'up' : 'down'),
  };
}

function soldCompBuckets(comps) {
  const byDay = new Map();
  for (const c of comps) {
    const t = c.soldAt ? Date.parse(c.soldAt) : 0;
    const val = Number(c.total || c.price || 0);
    if (!t || !val) continue;
    const key = new Date(t).toISOString().slice(0, 10);
    const row = byDay.get(key) || { date: key, count: 0, sum: 0, avg: 0 };
    row.count += 1;
    row.sum += val;
    byDay.set(key, row);
  }
  return [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({ date: r.date, count: r.count, avg: Math.round((r.sum / r.count) * 100) / 100 }));
}

function compTokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w#/. -]+/g, ' ')
    .split(/\s+/)
    .filter(t => t && t.length > 1 && !['the', 'and', 'for', 'with', 'card', 'cards', 'tcg'].includes(t));
}

function compQualityScore(comp, query, mode = '') {
  const title = String(comp.title || '').toLowerCase();
  const q = String(query || '').toLowerCase();
  const isSealedQuery = /\b(sealed|pack|box|booster|case|tin|etb|elite trainer|bundle|blaster|mega|hobby)\b/i.test(q) || mode === 'sealed';
  const bad = /\b(lot|bundle|pick|choose|custom|proxy|orica|reprint|replica|facsimile|digital|box|booster|pack|packs|break|case|empty|wrapper|label|stand|display)\b/i;
  let score = 0;
  if (bad.test(title) && !isSealedQuery) return -999;
  if (!isSealedQuery && /\b(unopened|factory sealed|wax|hobby box|blaster box|booster box|booster pack|mega box|etb)\b/i.test(title)) return -999;
  const queryYear = q.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  if (queryYear && !title.includes(queryYear)) return -999;
  const wanted = compTokens(q)
    .filter(t => !['raw', 'sold', 'psa', 'bgs', 'cgc', 'sgc', 'ungraded'].includes(t));
  for (const t of wanted) if (title.includes(t)) score += 8;
  if (wanted.length && wanted.every(t => title.includes(t))) score += 18;
  const wantsGrade = (q.match(/\b(psa|bgs|cgc|sgc)\s*(10|9\.5|9|8|8\.5|7|6|5|4|3|2|1|a)\b/i) || [])[0];
  if (wantsGrade) {
    const normalizedTitle = title.replace(/\s+/g, ' ');
    const normalizedGrade = wantsGrade.toLowerCase().replace(/\s+/, ' ');
    if (normalizedTitle.includes(normalizedGrade)) score += 32;
    else score -= 18;
    const wantedCompany = (wantsGrade.match(/\b(psa|bgs|cgc|sgc)\b/i) || [])[1]?.toLowerCase();
    const wantedGrade = (wantsGrade.match(/\b(10|9\.5|9|8|8\.5|7|6|5|4|3|2|1|a)\b/i) || [])[1];
    const actualGrade = normalizedTitle.match(new RegExp('\\b' + wantedCompany + '\\s*(10|9\\.5|9|8\\.5|8|7|6|5|4|3|2|1|a)\\b', 'i'))?.[1];
    if (wantedCompany && wantedGrade && actualGrade && actualGrade !== wantedGrade) score -= 70;
    if (wantedCompany && wantedGrade && !actualGrade) return -999;
  }
  if (mode === 'raw') {
    if (/\b(psa|bgs|cgc|sgc)\b/i.test(title)) score -= 35;
    else score += 10;
  }
  if (mode === 'graded' && /\b(psa|bgs|cgc|sgc)\b/i.test(title)) score += 12;
  return score;
}

function filterSoldComps(comps, query, mode = '') {
  const scored = comps
    .map(c => ({ ...c, qualityScore: compQualityScore(c, query, mode) }))
    .filter(c => c.qualityScore > 0);
  const deduped = [];
  const seen = new Set();
  for (const c of scored) {
    const key = [
      String(c.url || '').split('?')[0],
      String(c.title || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 120),
      Number(c.total || c.price || 0).toFixed(2),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }
  const values = deduped.map(c => Number(c.total || c.price || 0)).filter(v => v > 0).sort((a, b) => a - b);
  if (values.length >= 5) {
    const q1 = values[Math.floor(values.length * 0.25)];
    const q3 = values[Math.floor(values.length * 0.75)];
    const iqr = Math.max(1, q3 - q1);
    const low = Math.max(0, q1 - iqr * 1.75);
    const high = q3 + iqr * 1.75;
    return deduped.filter(c => Number(c.total || c.price || 0) >= low && Number(c.total || c.price || 0) <= high);
  }
  return deduped;
}

async function fetchEbaySoldComps(env, query, limit = 40) {
  const appId = env.EBAY_APP_ID || await getStoredSecret(env, 'EBAY_CLIENT_ID');
  if (!appId) return { source: 'none', comps: [], warning: 'EBAY_APP_ID not set' };
  const findRes = await fetch(
    `https://svcs.ebay.com/services/search/FindingService/v1` +
    `?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.0.0` +
    `&SECURITY-APPNAME=${appId}&RESPONSE-DATA-FORMAT=JSON&REST-PAYLOAD` +
    `&GLOBAL-ID=EBAY-US` +
    `&keywords=${encodeURIComponent(query)}` +
    `&itemFilter%280%29.name=SoldItemsOnly&itemFilter%280%29.value=true` +
    `&sortOrder=EndTimeSoonest&paginationInput.entriesPerPage=${Math.min(100, Math.max(10, limit))}`
  );
  const { data } = await readApiJson(findRes);
  if (!findRes.ok) return { source: 'ebay_sold', comps: [], warning: 'Finding API ' + findRes.status };
  const root = data.findCompletedItemsResponse?.[0] || {};
  const ack = root.ack?.[0] || '';
  const errMsg = root.errorMessage?.[0]?.error?.[0]?.message?.[0] || '';
  if (ack && !['Success', 'Warning'].includes(ack)) return { source: 'ebay_sold', comps: [], warning: errMsg || ack };
  const items = root.searchResult?.[0]?.item || [];
  return {
    source: 'ebay_sold',
    comps: items.map(i => normalizeSoldComp(i, 'ebay_sold')).filter(Boolean),
    warning: errMsg || null,
  };
}

async function fetchSoldCompsProvider(env, query, limit = 40) {
  if (!env.SOLDCOMPS_API_KEY) return { source: 'none', comps: [], warning: 'SOLDCOMPS_API_KEY not set' };
  const base = (env.SOLDCOMPS_BASE || 'https://api.sold-comps.com').replace(/\/+$/, '');
  const maxResults = Math.min(240, Math.max(10, limit));
  const keyword = encodeURIComponent(query);
  const qs = `q=${keyword}&query=${keyword}&keyword=${keyword}&limit=${maxResults}&count=${maxResults}`;
  const urls = [
    `${base}/v1/scrape?keyword=${keyword}&count=${maxResults}`,
    `${base}/v1/scrape?keyword=${keyword}&limit=${maxResults}`,
    `${base}/v1/search?${qs}`,
    `${base}/search?${qs}`,
    `${base}/api/search?${qs}`,
    `${base}/v1/sales?${qs}`,
  ];
  let lastWarning = '';
  for (const apiUrl of urls) {
    try {
      const res = await fetch(apiUrl, {
        headers: {
          'Authorization': 'Bearer ' + env.SOLDCOMPS_API_KEY,
          'x-api-key': env.SOLDCOMPS_API_KEY,
          'X-API-Key': env.SOLDCOMPS_API_KEY,
          'api-key': env.SOLDCOMPS_API_KEY,
          'Accept': 'application/json',
        },
      });
      const { data, text } = await readApiJson(res);
      if (!res.ok) {
        lastWarning = 'SoldComps ' + res.status + ': ' + errorMessageFromApi(data, text.slice(0, 80));
        continue;
      }
      const rows = Array.isArray(data) ? data
        : (data.results || data.items || data.sales || data.comps || data.data || []);
      const comps = (Array.isArray(rows) ? rows : []).map(r => normalizeSoldComp(r, 'soldcomps')).filter(Boolean);
      if (comps.length) return { source: 'soldcomps', comps, warning: null };
      lastWarning = 'SoldComps returned no comps';
    } catch (e) {
      lastWarning = e.message;
    }
  }
  return { source: 'soldcomps', comps: [], warning: lastWarning || 'SoldComps unavailable' };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        ok: true,
        ts: Date.now(),
        webflow: !!env.WEBFLOW_TOKEN,
        anthropic: !!env.ANTHROPIC_API_KEY,
        psa: !!env.PSA_TOKEN,
        stripe: !!env.STRIPE_SECRET_KEY,
        ebay: !!env.EBAY_USER_TOKEN,
        ebayClient: !!(env.EBAY_CLIENT_ID || (env.LBA_KV && await env.LBA_KV.get('secret:EBAY_CLIENT_ID'))),
        ebayRefresh: !!(env.EBAY_REFRESH_TOKEN || (env.LBA_KV && await env.LBA_KV.get('secret:EBAY_REFRESH_TOKEN'))),
        comicvine: !!env.COMICVINE_API_KEY,
        justtcg: !!env.JUSTTCG_API_KEY,
        pricecharting: !!(env.PRICECHARTING_TOKEN || env.PRICECHARTING_API_KEY),
        tcgapi: !!env.TCGAPI_KEY,
        pokemontcg: !!env.POKEMONTCG_API_KEY,
        pokemonprice: !!(env.POKEMONPRICE_API_KEY || env.POKEMON_PRICE_TRACKER_API_KEY),
        soldcomps: !!env.SOLDCOMPS_API_KEY,
        kv: !!env.LBA_KV,
      });
    }

    if (url.pathname === '/cart') {
      const key = legacyCartKey(url);

      if (request.method === 'GET') {
        const cartData = env.LBA_KV
          ? await env.LBA_KV.get(key)
          : (globalThis[`_lbaCart_${key}`] || globalThis._lbaCart || null);

        return new Response(cartData || '{"items":[],"discount":0}', {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'POST') {
        const body = await request.text();
        JSON.parse(body || '{}');
        if (env.LBA_KV) {
          await env.LBA_KV.put(key, body, { expirationTtl: 86400 });
        } else {
          globalThis[`_lbaCart_${key}`] = body;
          if (key === 'pos_cart') globalThis._lbaCart = body;
        }
        return json({ ok: true, key });
      }

      return json({ error: 'GET or POST only' }, 405);
    }

    if (url.pathname.startsWith('/kv/')) {
      const key = url.pathname.slice(4).replace(/[^a-zA-Z0-9:_-]/g, '-');

      if (request.method === 'GET') {
        const val = env.LBA_KV
          ? await env.LBA_KV.get('lba_' + key)
          : (globalThis['_lba_' + key] || null);
        return json({ value: val });
      }

      if (request.method === 'POST') {
        const body = await request.text();
        if (env.LBA_KV) {
          await env.LBA_KV.put('lba_' + key, body, { expirationTtl: 604800 });
        } else {
          globalThis['_lba_' + key] = body;
        }
        return json({ ok: true });
      }

      return json({ error: 'GET or POST only' }, 405);
    }

    if (url.pathname === '/offline/cache/manifest') {
      if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for offline cache manifest' }, 501);
      const categories = ['Pokemon Cards', 'Magic Cards', 'YuGiOh Cards', 'One Piece Cards', 'Lorcana Cards', 'Digimon Cards', 'Dragon Ball Cards', 'Sports Cards'];
      const pcCategoryKey = c => {
        const raw = String(c || 'General').trim();
        const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const alias = {
          'pokemon-card':'Pokemon Cards',
          'pokemon-cards':'Pokemon Cards',
          'magic-card':'Magic Cards',
          'magic-cards':'Magic Cards',
          'mtg':'Magic Cards',
          'yugioh-cards':'YuGiOh Cards',
          'yu-gi-oh-cards':'YuGiOh Cards',
          'sport-cards':'Sports Cards',
          'sports-cards':'Sports Cards',
        }[slug];
        return alias || raw;
      };
      const kvKey = (kind, category) => `pc_csv_${kind}:${pcCategoryKey(category)}`;
      const priceCharting = {};
      for (const category of categories) {
        const meta = await env.LBA_KV.get(kvKey('meta', category), 'json');
        const manifest = await env.LBA_KV.get(kvKey('manifest', category), 'json');
        const rows = await env.LBA_KV.get(kvKey('rows', category), 'json');
        const savedUrl = await env.LBA_KV.get(kvKey('url', category));
        const configured = !!(meta?.configured || savedUrl);
        const chunkRowCount = Number(manifest?.cachedRowCount || 0);
        const legacyRowCount = Array.isArray(rows) ? rows.length : 0;
        priceCharting[category] = {
          configured,
          state: manifest?.syncStatus || meta?.state || (legacyRowCount ? 'synced' : configured ? 'ready' : 'not_configured'),
          rowCount: chunkRowCount || legacyRowCount || Number(meta?.rowCount || 0),
          lastSyncedAt: manifest?.lastSuccessfulSync || meta?.lastSyncedAt || meta?.lastSuccessAt || null,
          cacheKey: manifest?.cacheKey || kvKey('rows', category),
          manifest: manifest || null,
        };
      }
      return json({
        ok: true,
        source: 'walkoff-worker',
        kv: true,
        generatedAt: new Date().toISOString(),
        priceCharting,
      });
    }

    if (url.pathname === '/anthropic/messages') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not set' }, 500);

      const body = await request.text();
      const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body,
      });

      const data = await res.text();
      return new Response(data, {
        status: res.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/upload-image') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      if (!env.WEBFLOW_TOKEN) return json({ error: 'WEBFLOW_TOKEN not set' }, 500);

      try {
        const { base64, fileName, mimeType } = await request.json();
        if (!base64 || !fileName) return json({ error: 'base64 and fileName required' }, 400);

        const mime = mimeType || 'image/jpeg';
        const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-').substring(0, 100);
        const rawBase64 = String(base64).includes(',') ? String(base64).split(',').pop() : String(base64);

        const binaryStr = atob(rawBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        const fileHash = md5Hex(bytes);

        const metaRes = await fetch(`${WEBFLOW_BASE}/sites/${SITE_ID}/assets`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + env.WEBFLOW_TOKEN,
            'Content-Type': 'application/json',
            'accept': 'application/json',
          },
          body: JSON.stringify({ fileName: cleanName, fileHash }),
        });

        const { text: metaText, data: meta } = await readApiJson(metaRes);
        if (!metaRes.ok) {
          console.error('Webflow asset pre-sign failed:', metaRes.status, metaText.substring(0, 300));
          return json({
            error: 'Asset pre-sign failed: ' + metaRes.status,
            detail: errorMessageFromApi(meta, metaText.substring(0, 300)),
          }, metaRes.status);
        }

        const uploadDetails = meta.uploadDetails || {};
        const uploadUrl = uploadDetails.uploadUrl || meta.uploadUrl || meta.upload_url;
        const assetId = meta.id || meta.asset?.id;
        let finalUrl = meta.hostedUrl || meta.hosted_url || meta.asset?.hostedUrl || meta.asset?.hosted_url || null;

        if (!uploadUrl) {
          console.error('No uploadUrl. Meta:', JSON.stringify(meta).substring(0, 500));
          return json({ error: 'No uploadUrl in Webflow response', detail: meta }, 500);
        }

        const form = new FormData();
        for (const [k, v] of Object.entries(uploadDetails)) {
          if (k === 'uploadUrl' || v == null) continue;
          form.append(k, String(v));
        }
        form.append('Content-Type', mime);
        form.append('file', new Blob([bytes], { type: mime }), cleanName);

        const s3Res = await fetch(uploadUrl, { method: 'POST', body: form });
        if (!s3Res.ok) {
          const s3Err = await s3Res.text();
          console.error('S3 upload error:', s3Res.status, s3Err.substring(0, 300));
          return json({
            error: 'Upload failed: S3 POST ' + s3Res.status,
            detail: s3Err.substring(0, 300),
          }, 500);
        }

        if (!finalUrl && assetId) {
          try {
            const assetRes = await fetch(`${WEBFLOW_BASE}/assets/${assetId}`, {
              headers: {
                'Authorization': 'Bearer ' + env.WEBFLOW_TOKEN,
                'accept': 'application/json',
              },
            });
            if (assetRes.ok) {
              const ad = await assetRes.json();
              finalUrl = ad.hostedUrl || ad.hosted_url || ad.asset?.hostedUrl || null;
            }
          } catch (ae) {
            console.warn('Asset refetch failed:', ae.message);
          }
        }

        return json({ ok: true, url: finalUrl, assetId, fileName: cleanName, fileHash });
      } catch (e) {
        console.error('Image upload error:', e);
        return json({ error: e.message }, 500);
      }
    }

    if (url.pathname === '/pos/checkout') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      if (!env.WEBFLOW_TOKEN) return json({ error: 'WEBFLOW_TOKEN not set' }, 500);

      try {
        const body = await request.json();
        const items = Array.isArray(body.items) ? body.items : [];
        const method = body.method || body.paymentMethod || 'Unknown';
        const soldAt = body.soldAt || new Date().toISOString();
        const txId = body.txId || ('tx_' + Date.now());

        if (!items.length) return json({ error: 'No checkout items supplied' }, 400);

        const results = [];

        for (const item of items) {
          const itemId = normalizeWebflowItemId(item);
          if (!itemId) {
            results.push({ ok: false, name: item.name || 'Unknown item', error: 'Missing Webflow item id' });
            continue;
          }

          const itemCost = Number(item.cost || 0);
          const salePrice = Number(item.price || 0);
          const collectionId = item.collectionId || WF_PRODUCTS;

          const wfRes = await fetch(`${WEBFLOW_BASE}/collections/${collectionId}/items/${itemId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': 'Bearer ' + env.WEBFLOW_TOKEN,
              'Content-Type': 'application/json',
              'accept': 'application/json',
            },
            body: JSON.stringify({
              fieldData: {
                'sold-out': true,
                'inventory-count': 0,
                'status': WF_STATUS_SOLD,
                'sale-price': salePrice,
                'profit': salePrice - itemCost,
                'sale-channel': method,
                'date-sold': soldAt,
              },
            }),
          });

          const { text, data } = await readApiJson(wfRes);
          if (!wfRes.ok) {
            results.push({
              ok: false,
              id: itemId,
              name: item.name || 'Unknown item',
              status: wfRes.status,
              error: errorMessageFromApi(data, text.substring(0, 200)),
            });
          } else {
            results.push({ ok: true, id: itemId, name: item.name || 'Unknown item' });
          }
        }

        const failed = results.filter(r => !r.ok);
        const txRecord = { ...body, txId, soldAt, syncResults: results };

        if (env.LBA_KV) {
          await env.LBA_KV.put(`pos_tx:${txId}`, JSON.stringify(txRecord), { expirationTtl: 60 * 60 * 24 * 180 });
          if (!failed.length) {
            await env.LBA_KV.put(legacyCartKey(url), JSON.stringify({
              items: [],
              discount: 0,
              total: 0,
              clearedAt: soldAt,
              lastTxId: txId,
            }), { expirationTtl: 86400 });
          }
        } else if (!failed.length) {
          globalThis[`_lbaCart_${legacyCartKey(url)}`] = JSON.stringify({
            items: [],
            discount: 0,
            total: 0,
            clearedAt: soldAt,
            lastTxId: txId,
          });
        }

        return json({ ok: failed.length === 0, txId, soldAt, results, failed }, failed.length ? 207 : 200);
      } catch (e) {
        console.error('POS checkout error:', e);
        return json({ error: e.message }, 500);
      }
    }

    // ── SportsCardsPro: card image lookup ─────────────────────────────────────
    // GET /pricing/sportscardspro/image?console=CONSOLE_NAME&name=PRODUCT_NAME
    // Fetches the PriceCharting product page with a browser UA and extracts the
    // first storage.googleapis.com image URL. Cached 2 hours at the edge.
    if (url.pathname === '/pricing/sportscardspro/image') {
      const consoleName = url.searchParams.get('console') || '';
      const productName = url.searchParams.get('name') || '';
      if (!consoleName || !productName) return json({ ok: false, error: 'console and name required' }, 400);

      const toSlug = s => String(s).toLowerCase()
        .replace(/['']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const pageUrl = `https://www.pricecharting.com/game/${toSlug(consoleName)}/${toSlug(productName)}`;

      const pageRes = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        cf: { cacheTtl: 7200, cacheEverything: true },
      });

      if (!pageRes.ok) return json({ ok: false, imageUrl: null, status: pageRes.status });

      const html = await pageRes.text();
      const m = html.match(/storage\.googleapis\.com\/images\.pricecharting\.com\/([^/"']+)\/(?:240|300|400|1600)\.jpg/);
      if (!m) return json({ ok: false, imageUrl: null });

      const imageUrl = `https://storage.googleapis.com/images.pricecharting.com/${m[1]}/240.jpg`;
      return json({ ok: true, imageUrl });
    }

    // ── SportsCardsPro: candidate list ───────────────────────────────────────
    // dashboard.html calls: GET /pricing/sportscardspro/products?q=QUERY
    // Requires SCP_ACCESS_TOKEN worker secret (set via: wrangler secret put SCP_ACCESS_TOKEN)
    if (url.pathname === '/pricing/sportscardspro/products') {
      const q = url.searchParams.get('q') || '';
      if (!q) return json({ ok: false, error: 'q required' }, 400);

      const scpToken = await getStoredSecret(env, 'SCP_ACCESS_TOKEN');
      if (!scpToken) return json({ ok: false, needsKey: true, source: 'sportscardspro', error: 'SCP_ACCESS_TOKEN not set in Worker secrets. Set it with: wrangler secret put SCP_ACCESS_TOKEN' }, 501);

      // SportsCardsPro/PriceCharting uses "t" as the token param (same as PC download URLs)
      const upstreamParams = new URLSearchParams({ q, t: scpToken });
      const upstream = 'https://www.sportscardspro.com/api/products?' + upstreamParams;

      const res = await fetch(upstream, {
        headers: {
          'User-Agent': 'Walk-Off Sports Cards Dealer App/2026',
          'Accept': 'application/json',
        },
        // Cloudflare edge cache — 5 min for searches
        cf: { cacheTtl: 300, cacheEverything: false },
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }

      // Normalise to a consistent shape: always { ok, products: [] }
      const products = data.products || data.matches || data.data || data.results || (Array.isArray(data) ? data : []);
      return json({ ok: res.ok && !data.error, status: res.status, products, _raw: data.error ? data : undefined });
    }

    // ── SportsCardsPro: single-product hydration ──────────────────────────────
    // dashboard.html calls: GET /pricing/sportscardspro/product?id=ID
    if (url.pathname === '/pricing/sportscardspro/product') {
      const id = url.searchParams.get('id') || '';
      if (!id) return json({ ok: false, error: 'id required' }, 400);

      const scpToken = await getStoredSecret(env, 'SCP_ACCESS_TOKEN');
      if (!scpToken) return json({ ok: false, needsKey: true, source: 'sportscardspro', error: 'SCP_ACCESS_TOKEN not set in Worker secrets.' }, 501);

      const upstreamParams = new URLSearchParams({ id, t: scpToken });
      const upstream = 'https://www.sportscardspro.com/api/product?' + upstreamParams;

      const res = await fetch(upstream, {
        headers: {
          'User-Agent': 'Walk-Off Sports Cards Dealer App/2026',
          'Accept': 'application/json',
        },
        // Longer cache for exact-product data — 15 min
        cf: { cacheTtl: 900, cacheEverything: false },
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }

      // Normalise: always return { ok, product: {...} }
      const product = data.product || data.data || (!data.error && data.id ? data : null);
      return json({ ok: res.ok && !data.error, status: res.status, product, _raw: data.error ? data : undefined });
    }

    if (url.pathname.startsWith('/proxy/')) {
      if (!env.WEBFLOW_TOKEN) return json({ error: 'WEBFLOW_TOKEN not set' }, 500);

      const wfPath = url.pathname.replace(/^\/proxy/, '');
      const wfUrl = WEBFLOW_BASE + wfPath + (url.search || '');

      let body;
      if (!['GET', 'HEAD'].includes(request.method)) body = await request.text();

      try {
        const wfRes = await fetch(wfUrl, {
          method: request.method,
          headers: {
            'Authorization': 'Bearer ' + env.WEBFLOW_TOKEN,
            'Content-Type': 'application/json',
            'accept': 'application/json',
          },
          body,
        });

        const data = await wfRes.text();
        return new Response(data, {
          status: wfRes.status,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    if (url.pathname === '/ebay/status') {
      const hasClient = !!(await getStoredSecret(env, 'EBAY_CLIENT_ID')) && !!(await getStoredSecret(env, 'EBAY_CLIENT_SECRET'));
      const hasRefresh = !!(await getStoredSecret(env, 'EBAY_REFRESH_TOKEN'));
      const ruName = await getStoredSecret(env, 'EBAY_RU_NAME');
      return json({
        ok: true,
        clientConfigured: hasClient,
        refreshConfigured: hasRefresh,
        legacyUserToken: !!(await getStoredSecret(env, 'EBAY_USER_TOKEN')),
        ruNameConfigured: !!ruName,
        readyToList: hasClient && hasRefresh,
      });
    }

    if (url.pathname === '/ebay/auth-url') {
      const clientId = await getStoredSecret(env, 'EBAY_CLIENT_ID');
      const ruName = await getStoredSecret(env, 'EBAY_RU_NAME');
      if (!clientId) return json({ error: 'EBAY_CLIENT_ID not configured' }, 500);
      if (!ruName) return json({ error: 'EBAY_RU_NAME not configured', hint: 'Set the RuName/redirect_uri value from eBay User Tokens page as EBAY_RU_NAME.' }, 500);
      const state = crypto.randomUUID();
      if (env.LBA_KV) await env.LBA_KV.put('ebay_oauth_state:' + state, '1', { expirationTtl: 900 });
      const auth = new URL(EBAY_AUTH_URL);
      auth.searchParams.set('client_id', clientId);
      auth.searchParams.set('redirect_uri', ruName);
      auth.searchParams.set('response_type', 'code');
      auth.searchParams.set('scope', EBAY_SCOPES);
      auth.searchParams.set('state', state);
      return json({ ok: true, url: auth.toString(), state, scopes: EBAY_SCOPES.split(' ') });
    }

    if (url.pathname === '/ebay/oauth/callback') {
      const code = url.searchParams.get('code') || '';
      const state = url.searchParams.get('state') || '';
      const ruName = await getStoredSecret(env, 'EBAY_RU_NAME');
      if (!code) return json({ error: 'Missing eBay code' }, 400);
      if (env.LBA_KV && state) {
        const okState = await env.LBA_KV.get('ebay_oauth_state:' + state);
        if (!okState) return json({ error: 'Invalid or expired OAuth state' }, 400);
        await env.LBA_KV.delete('ebay_oauth_state:' + state);
      }
      const data = await ebayTokenRequest(env, new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: ruName,
      }));
      if (data.refresh_token) await putStoredSecret(env, 'EBAY_REFRESH_TOKEN', data.refresh_token);
      if (data.access_token && env.LBA_KV) {
        await env.LBA_KV.put('secret:EBAY_ACCESS_TOKEN', data.access_token, { expirationTtl: Math.max(300, Number(data.expires_in || 7200)) });
        await env.LBA_KV.put('secret:EBAY_ACCESS_EXPIRES', String(Date.now() + Number(data.expires_in || 7200) * 1000));
      }
      return new Response('<html><body style="font-family:system-ui;background:#0d0f14;color:#e4e4e8;padding:32px"><h2>eBay connected</h2><p>You can close this tab and return to Walk-Off.</p></body></html>', {
        headers: { ...CORS, 'Content-Type': 'text/html' },
      });
    }

    if (url.pathname === '/ebay/list') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      let ebayToken = '';
      try { ebayToken = await getEbayUserAccessToken(env); }
      catch (tokenErr) { return json({ needsToken: true, error: tokenErr.message }, 401); }
      if (!ebayToken) return json({ needsToken: true, error: 'Connect eBay first: missing user access/refresh token' }, 401);

      try {
        const b = await request.json();
        const {
          title, description, price, shippingCost = '0.00',
          format = 'FIXED_PRICE', conditionId = '3000',
          conditionDescription = '', duration = 'GTC',
          quantity = 1, categoryId = '261328',
          imageUrl = null, imageUrls = [],
          sport = '', year = '', manufacturer = '',
          set = '', parallel = '', cardNumber = '',
          player = '', team = '', grade = '', grader = '',
          isRookie = false, serialNumber = '',
          upc = '', features = '', productType = '', configuration = '',
          league = '', season = '', customAspects = {},
        } = b;

        if (!title || !price) return json({ error: 'title and price required' }, 400);

        const locationKey = env.EBAY_LOCATION_KEY || 'walkoff-main';
        await fetch(`https://api.ebay.com/sell/inventory/v1/location/${locationKey}`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + ebayToken,
            'Content-Type': 'application/json',
            'Content-Language': 'en-US',
          },
          body: JSON.stringify({
            location: { address: { addressLine1: '26059 Miller Bay Rd NE', city: 'Kingston', stateOrProvince: 'WA', postalCode: '98346', country: 'US' } },
            name: 'Walk-Off Sports Cards',
            merchantLocationStatus: 'ENABLED',
            locationTypes: ['STORE'],
          }),
        }).catch(() => {});

        const sku = 'lba-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5);
        const aspects = {};
        if (sport) aspects['Sport'] = [sport];
        if (year) aspects['Year'] = [String(year)];
        if (manufacturer) aspects['Manufacturer'] = [manufacturer];
        if (set) aspects['Set'] = [set];
        if (parallel && parallel !== 'Base') aspects['Parallel/Variety'] = [parallel];
        if (cardNumber) aspects['Card Number'] = [String(cardNumber)];
        if (player) aspects['Player/Athlete'] = [player];
        if (team) aspects['Team'] = [team];
        if (isRookie) aspects['Rookie'] = ['Yes'];
        if (serialNumber) aspects['Serial Numbered'] = [serialNumber];
        if (grader) aspects['Professional Grader'] = [grader];
        if (grade) aspects['Grade'] = [String(grade)];
        if (upc) aspects['UPC'] = [String(upc)];
        if (league) aspects['League'] = [league];
        if (season) aspects['Season'] = [String(season)];
        if (productType) aspects['Type'] = [productType === 'sealed' ? 'Sports Trading Card Box' : productType];
        if (configuration) aspects['Configuration'] = [configuration];
        if (features) {
          const featureList = String(features).split(',').map(s => s.trim()).filter(Boolean);
          if (featureList.length) aspects['Features'] = featureList;
        }
        for (const [k, v] of Object.entries(customAspects || {})) {
          if (!k || v == null || v === '') continue;
          const values = Array.isArray(v) ? v.map(x => String(x || '').trim()).filter(Boolean) : [String(v || '').trim()].filter(Boolean);
          if (values.length) aspects[k] = values;
        }
        aspects['Sport'] = aspects['Sport'] || ['Trading Cards'];
        for (const [k, v] of Object.entries({ ...aspects })) {
          if (!Array.isArray(v) || !v.length || v.some(x => x == null || String(x).trim() === '')) delete aspects[k];
        }

        const allImgUrls = [];
        if (imageUrl) allImgUrls.push(imageUrl);
        (imageUrls || []).forEach(u => { if (u && !allImgUrls.includes(u)) allImgUrls.push(u); });

        const itemBody = {
          product: {
            title: title.substring(0, 80),
            description: description || title,
            aspects,
            imageUrls: allImgUrls.slice(0, 12),
          },
          conditionId: String(conditionId),
          conditionDescription: conditionDescription || undefined,
          availability: { shipToLocationAvailability: { quantity: parseInt(quantity) || 1 } },
          packageWeightAndSize: {
            dimensions: { height: 0.1, length: 6.5, width: 4, unit: 'INCH' },
            weight: { value: 0.1, unit: 'POUND' },
          },
        };

        const itemRes = await fetch(`https://api.ebay.com/sell/inventory/v1/inventory_item/${sku}`, {
          method: 'PUT',
          headers: {
            'Authorization': 'Bearer ' + ebayToken,
            'Content-Type': 'application/json',
            'Content-Language': 'en-US',
          },
          body: JSON.stringify(itemBody),
        });

        if (!itemRes.ok && itemRes.status !== 204) {
          const errTxt = await itemRes.text();
          let errData; try { errData = JSON.parse(errTxt); } catch (_) { errData = errTxt; }
          const msg = errData?.errors?.[0]?.longMessage || errData?.errors?.[0]?.message || errTxt.substring(0, 200);
          return json({ error: 'Item creation failed (' + itemRes.status + '): ' + msg, detail: errData }, itemRes.status);
        }

        const listingPolicies = {};
        if (env.EBAY_FULFILLMENT_POLICY_ID) listingPolicies.fulfillmentPolicyId = env.EBAY_FULFILLMENT_POLICY_ID;
        if (env.EBAY_PAYMENT_POLICY_ID) listingPolicies.paymentPolicyId = env.EBAY_PAYMENT_POLICY_ID;
        if (env.EBAY_RETURN_POLICY_ID) listingPolicies.returnPolicyId = env.EBAY_RETURN_POLICY_ID;

        const offerBody = {
          sku,
          marketplaceId: 'EBAY_US',
          format,
          availableQuantity: parseInt(quantity) || 1,
          categoryId: String(categoryId),
          listingDescription: description || title,
          listingPolicies,
          merchantLocationKey: locationKey,
          pricingSummary: { price: { value: parseFloat(price).toFixed(2), currency: 'USD' } },
          ...(parseFloat(shippingCost) > 0 ? {} : {}),
        };

        const offerRes = await fetch('https://api.ebay.com/sell/inventory/v1/offer', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + ebayToken,
            'Content-Type': 'application/json',
            'Content-Language': 'en-US',
          },
          body: JSON.stringify(offerBody),
        });

        const offerTxt = await offerRes.text();
        let offerData; try { offerData = JSON.parse(offerTxt); } catch (_) { offerData = { raw: offerTxt }; }
        if (!offerRes.ok) {
          const msg = offerData?.errors?.[0]?.longMessage || offerData?.errors?.[0]?.message || offerTxt.substring(0, 300);
          return json({ error: 'Offer failed (' + offerRes.status + '): ' + msg, detail: offerData }, offerRes.status);
        }

        const offerId = offerData.offerId;
        const pubRes = await fetch(`https://api.ebay.com/sell/inventory/v1/offer/${offerId}/publish`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + ebayToken, 'Content-Type': 'application/json' },
        });

        const pubTxt = await pubRes.text();
        let pubData; try { pubData = JSON.parse(pubTxt); } catch (_) { pubData = { raw: pubTxt }; }
        if (!pubRes.ok) {
          const msg = pubData?.errors?.[0]?.longMessage || pubData?.errors?.[0]?.message || pubTxt.substring(0, 300);
          return json({ error: 'Publish failed (' + pubRes.status + '): ' + msg, detail: pubData }, pubRes.status);
        }

        return json({ ok: true, listingId: pubData.listingId, offerId, sku });
      } catch (e) {
        console.error('eBay listing error:', e);
        return json({ error: e.message }, 500);
      }
    }

    // ── Stripe QR Checkout v1 ────────────────────────────────────────────────

    // POST /stripe/create-checkout
    // Creates a Stripe Checkout Session (hosted page) for QR-code payment flow.
    // Returns { session_id, checkout_url }.
    if (url.pathname === '/stripe/create-checkout' && request.method === 'POST') {
      if (!env.STRIPE_SECRET_KEY) return json({ error: 'STRIPE_SECRET_KEY not configured in Worker secrets' }, 500);
      try {
        const body = await request.json();
        const { amount_cents, description, store_name } = body;
        if (!amount_cents || amount_cents < 50) return json({ error: 'Minimum amount is $0.50' }, 400);
        const origin = url.origin;
        const params = new URLSearchParams({
          mode: 'payment',
          'payment_method_types[]': 'card',
          success_url: `${origin}/stripe/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/stripe/checkout-cancel`,
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][product_data][name]': description || (store_name ? `${store_name} — Card Purchase` : 'Card Show Purchase'),
          'line_items[0][price_data][unit_amount]': String(Math.round(amount_cents)),
          'line_items[0][quantity]': '1',
          'metadata[source]': 'walkoff-pos',
          'metadata[store]': store_name || '',
        });
        const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        const data = await r.json();
        if (!r.ok) return json({ error: data.error?.message || 'Stripe error', code: data.error?.code }, r.status);
        // Cache pending status in KV (TTL 1 hour)
        if (env.LBA_KV) {
          await env.LBA_KV.put(`stripe_checkout:${data.id}`, JSON.stringify({ status: 'pending', amount: amount_cents, created: Date.now() }), { expirationTtl: 3600 });
        }
        return json({ session_id: data.id, checkout_url: data.url });
      } catch (e) { return json({ error: e.message }, 500); }
    }

    // GET /stripe/session-status?id=cs_xxx
    // Checks payment status — first checks KV cache (webhook may have updated it),
    // then falls back to polling Stripe directly.
    if (url.pathname === '/stripe/session-status' && request.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'session id required' }, 400);
      try {
        // Check KV cache first
        if (env.LBA_KV) {
          const cached = await env.LBA_KV.get(`stripe_checkout:${id}`);
          if (cached) {
            const d = JSON.parse(cached);
            if (d.status === 'paid') return json({ status: 'complete', payment_status: 'paid', paid: true, amount_total: d.amount });
          }
        }
        // Poll Stripe API
        if (!env.STRIPE_SECRET_KEY) return json({ error: 'STRIPE_SECRET_KEY not configured' }, 500);
        const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
          headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY },
        });
        const data = await r.json();
        if (!r.ok) return json({ error: data.error?.message || 'Stripe error' }, r.status);
        const paid = data.payment_status === 'paid';
        // Update KV if paid
        if (paid && env.LBA_KV) {
          await env.LBA_KV.put(`stripe_checkout:${id}`, JSON.stringify({ status: 'paid', amount: data.amount_total, created: Date.now() }), { expirationTtl: 86400 });
        }
        return json({ status: data.status, payment_status: data.payment_status, paid, amount_total: data.amount_total });
      } catch (e) { return json({ error: e.message }, 500); }
    }

    // POST /stripe/webhook
    // Receives Stripe events with HMAC-SHA256 signature verification.
    // Requires STRIPE_WEBHOOK_SECRET in Worker secrets (whsec_...).
    if (url.pathname === '/stripe/webhook' && request.method === 'POST') {
      const body = await request.text();
      const sigHeader = request.headers.get('stripe-signature') || '';

      // Verify Stripe signature using Web Crypto API
      if (env.STRIPE_WEBHOOK_SECRET && sigHeader) {
        try {
          const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
          const t = parts.t;
          const v1 = parts.v1;
          if (!t || !v1) return new Response('Invalid signature header', { status: 400 });

          // Reject events older than 5 minutes (replay protection)
          if (Math.abs(Date.now() / 1000 - Number(t)) > 300) {
            return new Response('Webhook timestamp too old', { status: 400 });
          }

          const signedPayload = `${t}.${body}`;
          const secret = env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')
            ? env.STRIPE_WEBHOOK_SECRET.slice(6)
            : env.STRIPE_WEBHOOK_SECRET;

          // Decode base64 secret
          const secretBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
          const key = await crypto.subtle.importKey(
            'raw', secretBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false, ['sign']
          );
          const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
          const computed = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, '0')).join('');

          if (computed !== v1) return new Response('Signature mismatch', { status: 401 });
        } catch (e) {
          console.error('Webhook signature error:', e.message);
          return new Response('Signature verification failed', { status: 401 });
        }
      }
      // (If STRIPE_WEBHOOK_SECRET not yet set, accept without verification — remove after key is confirmed working)

      let event;
      try { event = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400 }); }

      // Helper: read/write subscription KV record
      const subKvKey = id => `sub:store:${id}`;
      const custKvKey = id => `sub:cust:${id}`;
      const getSubRec = async id => { try { const r = await env.LBA_KV?.get(subKvKey(id)); return r ? JSON.parse(r) : null; } catch { return null; } };
      const putSubRec = async (id, rec) => env.LBA_KV?.put(subKvKey(id), JSON.stringify({ ...rec, updatedAt: Date.now() }), { expirationTtl: 400 * 24 * 3600 }).catch(() => {});
      const storeFromCust = async custId => { try { const r = await env.LBA_KV?.get(custKvKey(custId)); return r ? JSON.parse(r).store_id : null; } catch { return null; } };

      // checkout.session.completed — POS payment AND subscription checkout
      if (event.type === 'checkout.session.completed') {
        const session = event.data?.object;
        if (session?.id && env.LBA_KV) {
          if (session.metadata?.source === 'walkoff-subscription' || session.mode === 'subscription') {
            // Subscription checkout completed — activate the store
            const storeId = session.metadata?.store_id
              || await storeFromCust(session.customer)
              || (await env.LBA_KV.get(`sub:session:${session.id}`).then(r => r ? JSON.parse(r).store_id : null).catch(() => null));
            if (storeId) {
              const existing = await getSubRec(storeId) || {};
              await putSubRec(storeId, { ...existing, status: 'active', stripe_customer_id: session.customer, stripe_subscription_id: session.subscription });
              if (session.customer) await env.LBA_KV.put(custKvKey(session.customer), JSON.stringify({ store_id: storeId }), { expirationTtl: 400 * 24 * 3600 }).catch(() => {});
              await env.LBA_KV.delete(`sub:session:${session.id}`).catch(() => {});
            }
          } else {
            // POS one-time payment — update checkout cache (existing behavior)
            await env.LBA_KV.put(`stripe_checkout:${session.id}`, JSON.stringify({ status: 'paid', amount: session.amount_total, created: Date.now() }), { expirationTtl: 86400 }).catch(() => {});
          }
        }
      }

      // customer.subscription.created / .updated — sync status + period
      if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
        const sub = event.data?.object;
        if (sub && env.LBA_KV) {
          const storeId = await storeFromCust(sub.customer);
          if (storeId) {
            const existing = await getSubRec(storeId) || {};
            await putSubRec(storeId, { ...existing, status: sub.status, stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, current_period_end: sub.current_period_end ? sub.current_period_end * 1000 : existing.current_period_end, cancel_at_period_end: sub.cancel_at_period_end || false });
          }
        }
      }

      // customer.subscription.deleted — canceled
      if (event.type === 'customer.subscription.deleted') {
        const sub = event.data?.object;
        if (sub && env.LBA_KV) {
          const storeId = await storeFromCust(sub.customer);
          if (storeId) {
            const existing = await getSubRec(storeId) || {};
            await putSubRec(storeId, { ...existing, status: 'canceled' });
          }
        }
      }

      // invoice.payment_succeeded — refresh period end
      if (event.type === 'invoice.payment_succeeded') {
        const inv = event.data?.object;
        if (inv?.customer && env.LBA_KV) {
          const storeId = await storeFromCust(inv.customer);
          if (storeId) {
            const existing = await getSubRec(storeId) || {};
            const periodEnd = inv.lines?.data?.[0]?.period?.end;
            await putSubRec(storeId, { ...existing, status: 'active', current_period_end: periodEnd ? periodEnd * 1000 : existing.current_period_end });
          }
        }
      }

      // invoice.payment_failed — mark past_due
      if (event.type === 'invoice.payment_failed') {
        const inv = event.data?.object;
        if (inv?.customer && env.LBA_KV) {
          const storeId = await storeFromCust(inv.customer);
          if (storeId) {
            const existing = await getSubRec(storeId) || {};
            await putSubRec(storeId, { ...existing, status: 'past_due' });
          }
        }
      }

      return new Response('ok', { status: 200 });
    }

    // ── Subscription Management ───────────────────────────────────────────────

    // POST /subscription/init-trial
    // Idempotent — writes a 14-day trial record if no subscription exists yet.
    if (url.pathname === '/subscription/init-trial' && request.method === 'POST') {
      if (!env.LBA_KV) return json({ ok: false, error: 'KV not configured' }, 500);
      try {
        const { store_id } = await request.json().catch(() => ({}));
        if (!store_id) return json({ ok: false, error: 'store_id required' }, 400);
        const existing = await env.LBA_KV.get(`sub:store:${store_id}`);
        if (existing) return json({ ok: true, new: false, status: JSON.parse(existing).status });
        const trial_end = Date.now() + 14 * 24 * 60 * 60 * 1000;
        await env.LBA_KV.put(`sub:store:${store_id}`, JSON.stringify({ status: 'trialing', trial_end, created_at: Date.now(), updatedAt: Date.now() }), { expirationTtl: 400 * 24 * 3600 });
        return json({ ok: true, new: true, status: 'trialing', trial_end });
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }

    // GET /subscription/status?store_id=X
    if (url.pathname === '/subscription/status' && request.method === 'GET') {
      const storeId = (url.searchParams.get('store_id') || '').trim();
      if (!storeId) return json({ ok: false, error: 'store_id required' }, 400);
      if (!env.LBA_KV) return json({ ok: true, status: 'none', active: false, daysRemaining: 0 });
      const raw = await env.LBA_KV.get(`sub:store:${storeId}`);
      if (!raw) return json({ ok: true, status: 'none', active: false, daysRemaining: 0 });
      const rec = JSON.parse(raw);
      const now = Date.now();
      let status = rec.status || 'none';
      const endMs = status === 'trialing' ? rec.trial_end : rec.current_period_end;
      if ((status === 'trialing' || status === 'active') && endMs && endMs < now) {
        status = status === 'trialing' ? 'trialing_expired' : 'expired';
        await env.LBA_KV.put(`sub:store:${storeId}`, JSON.stringify({ ...rec, status, updatedAt: now }), { expirationTtl: 400 * 24 * 3600 }).catch(() => {});
      }
      const active = status === 'active' || status === 'trialing';
      const daysRemaining = endMs && endMs > now ? Math.ceil((endMs - now) / 86400000) : 0;
      return json({ ok: true, status, active, daysRemaining, trial_end: rec.trial_end || null, current_period_end: rec.current_period_end || null, stripe_customer_id: rec.stripe_customer_id || null, cancel_at_period_end: rec.cancel_at_period_end || false });
    }

    // POST /subscription/checkout
    // Body: { store_id, store_name, email }
    // Creates a Stripe subscription checkout session.
    // Requires STRIPE_SECRET_KEY + STRIPE_SUBSCRIPTION_PRICE_ID in Worker secrets.
    if (url.pathname === '/subscription/checkout' && request.method === 'POST') {
      if (!env.STRIPE_SECRET_KEY) return json({ ok: false, error: 'STRIPE_SECRET_KEY not configured' }, 500);
      if (!env.STRIPE_SUBSCRIPTION_PRICE_ID) return json({ ok: false, error: 'STRIPE_SUBSCRIPTION_PRICE_ID not configured — add recurring Stripe price ID to Worker secrets' }, 500);
      try {
        const { store_id, store_name, email } = await request.json().catch(() => ({}));
        if (!store_id) return json({ ok: false, error: 'store_id required' }, 400);
        const origin = url.origin;
        const params = new URLSearchParams({
          mode: 'subscription',
          'payment_method_types[]': 'card',
          'line_items[0][price]': env.STRIPE_SUBSCRIPTION_PRICE_ID,
          'line_items[0][quantity]': '1',
          success_url: `${origin}/subscription/success?store_id=${encodeURIComponent(store_id)}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/subscription/cancel`,
          'metadata[store_id]': store_id,
          'metadata[source]': 'walkoff-subscription',
          allow_promotion_codes: 'true',
        });
        if (email) params.set('customer_email', email);
        if (store_name) params.set('metadata[store_name]', store_name);
        const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        const data = await r.json();
        if (!r.ok) return json({ ok: false, error: data.error?.message || 'Stripe error' }, r.status);
        if (env.LBA_KV) await env.LBA_KV.put(`sub:session:${data.id}`, JSON.stringify({ store_id }), { expirationTtl: 86400 });
        return json({ ok: true, checkout_url: data.url, session_id: data.id });
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }

    // POST /subscription/customer-portal
    // Body: { store_id } — opens Stripe billing portal for the store's customer
    if (url.pathname === '/subscription/customer-portal' && request.method === 'POST') {
      if (!env.STRIPE_SECRET_KEY) return json({ ok: false, error: 'STRIPE_SECRET_KEY not configured' }, 500);
      try {
        const { store_id } = await request.json().catch(() => ({}));
        if (!store_id || !env.LBA_KV) return json({ ok: false, error: 'store_id required' }, 400);
        const raw = await env.LBA_KV.get(`sub:store:${store_id}`);
        if (!raw) return json({ ok: false, error: 'No subscription found' }, 404);
        const { stripe_customer_id } = JSON.parse(raw);
        if (!stripe_customer_id) return json({ ok: false, error: 'No Stripe customer — subscribe first' }, 400);
        const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ customer: stripe_customer_id, return_url: url.origin + '/dashboard.html' }).toString(),
        });
        const data = await r.json();
        if (!r.ok) return json({ ok: false, error: data.error?.message || 'Stripe error' }, r.status);
        return json({ ok: true, url: data.url });
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }

    // GET /subscription/success — redirect page shown after subscription checkout
    if (url.pathname === '/subscription/success') {
      const html = `<!DOCTYPE html><html><head><meta charset=utf-8><title>Subscribed</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#050709;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.c{background:#0d1117;border:1px solid rgba(0,255,179,.25);border-radius:20px;padding:40px 32px;max-width:420px;width:100%;text-align:center}.ic{font-size:64px;margin-bottom:20px}.ti{font-size:24px;font-weight:900;color:#00ffb3;margin-bottom:12px}.su{color:#8892a4;font-size:13px;line-height:1.7;margin-bottom:24px}.btn{display:inline-block;background:#00ffb3;color:#000;font-weight:900;padding:13px 28px;border-radius:10px;text-decoration:none;font-size:13px;letter-spacing:.08em}</style></head><body><div class="c"><div class="ic">🎉</div><div class="ti">You're Subscribed!</div><div class="su">Your store subscription is now active.<br>Return to the dashboard to get started.</div><a href="dashboard.html" class="btn">OPEN DASHBOARD →</a></div></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // GET /subscription/cancel — redirect page shown after cancelled checkout
    if (url.pathname === '/subscription/cancel') {
      const html = `<!DOCTYPE html><html><head><meta charset=utf-8><title>Checkout Cancelled</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#050709;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.c{background:#0d1117;border:1px solid rgba(255,100,50,.25);border-radius:20px;padding:40px 32px;max-width:420px;width:100%;text-align:center}.ic{font-size:64px;margin-bottom:20px}.ti{font-size:24px;font-weight:900;color:#ff6432;margin-bottom:12px}.su{color:#8892a4;font-size:13px;line-height:1.7;margin-bottom:24px}.btn{display:inline-block;background:#00ffb3;color:#000;font-weight:900;padding:13px 28px;border-radius:10px;text-decoration:none;font-size:13px;letter-spacing:.08em}</style></head><body><div class="c"><div class="ic">✕</div><div class="ti">Checkout Cancelled</div><div class="su">No charge was made. You can subscribe when ready.</div><a href="dashboard.html" class="btn">RETURN TO DASHBOARD →</a></div></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // GET /stripe/checkout-success  (Stripe redirects customer here after payment)
    if (url.pathname === '/stripe/checkout-success') {
      const html = `<!DOCTYPE html><html><head><meta charset=utf-8><title>Payment Complete</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#050709;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.c{background:#0d1117;border:1px solid rgba(0,255,179,.25);border-radius:20px;padding:40px 32px;max-width:380px;width:100%;text-align:center}.ic{font-size:72px;margin-bottom:20px}.ti{font-size:26px;font-weight:900;color:#00ffb3;margin-bottom:12px}.su{color:#657080;font-size:14px;line-height:1.6}</style></head><body><div class="c"><div class="ic">✓</div><div class="ti">Payment Complete!</div><div class="su">Thank you. The dealer has been notified.<br>You may now close this window.</div></div></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // GET /stripe/checkout-cancel  (Stripe redirects customer here if they cancel)
    if (url.pathname === '/stripe/checkout-cancel') {
      const html = `<!DOCTYPE html><html><head><meta charset=utf-8><title>Payment Cancelled</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#050709;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.c{background:#0d1117;border:1px solid rgba(255,77,109,.25);border-radius:20px;padding:40px 32px;max-width:380px;width:100%;text-align:center}.ic{font-size:72px;margin-bottom:20px}.ti{font-size:26px;font-weight:900;color:#ff4d6d;margin-bottom:12px}.su{color:#657080;font-size:14px;line-height:1.6}</style></head><body><div class="c"><div class="ic">✗</div><div class="ti">Payment Cancelled</div><div class="su">Please return to the dealer to try again or choose a different payment method.</div></div></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }

    // ── END Stripe QR Checkout v1 ─────────────────────────────────────────────

    if (url.pathname === '/stripe/create-payment-intent') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      if (!env.STRIPE_SECRET_KEY) return json({ error: 'STRIPE_SECRET_KEY not set in Worker secrets' }, 500);

      try {
        const { amount, currency = 'usd', description = 'Walk-Off Sports Cards' } = await request.json();
        if (!amount || amount < 50) return json({ error: 'Amount must be at least $0.50' }, 400);

        const params = new URLSearchParams({
          amount: String(Math.round(amount)),
          currency,
          description,
          'payment_method_types[]': 'card',
          'metadata[source]': 'LBA Scanner POS',
        });

        const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        const data = await stripeRes.json();
        if (!stripeRes.ok) return json({ error: data.error?.message || 'Stripe error' }, stripeRes.status);
        return json({ clientSecret: data.client_secret, paymentIntentId: data.id });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // JustTCG pricing proxy. Keep JUSTTCG_API_KEY in Worker secrets only.
    if (url.pathname.startsWith('/pricing/justtcg')) {
      const key = env.JUSTTCG_API_KEY;
      if (!key) return json({ ok: false, needsKey: true, source: 'justtcg', error: 'JUSTTCG_API_KEY not set in Worker secrets' }, 501);

      const conditionCode = s => {
        const v = String(s || '').toLowerCase();
        if (/light/.test(v) || v === 'lp') return 'LP';
        if (/moderate/.test(v) || v === 'mp') return 'MP';
        if (/heavy/.test(v) || v === 'hp') return 'HP';
        if (/damage/.test(v) || v === 'dmg') return 'DMG';
        return 'NM';
      };
      const finishCode = s => {
        const v = String(s || 'normal').toLowerCase();
        if (/reverse/.test(v)) return 'reverse_holo';
        if (/etched/.test(v)) return 'etched_foil';
        if (/surge/.test(v)) return 'surge_foil';
        if (/textured/.test(v)) return 'textured_foil';
        if (/holo/.test(v)) return 'holofoil';
        if (/foil/.test(v)) return 'foil';
        if (/first|1st/.test(v)) return 'first_edition';
        if (/unlimited/.test(v)) return 'unlimited';
        return v.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'normal';
      };
      const justGame = s => {
        const v = String(s || '').toLowerCase();
        if (/magic|mtg/.test(v)) return 'Magic: The Gathering';
        if (/pokemon|pokémon/.test(v)) return 'Pokemon';
        if (/yu|yugioh|yu-gi-oh/.test(v)) return 'Yu-Gi-Oh!';
        if (/lorcana/.test(v)) return 'Lorcana';
        if (/one piece/.test(v)) return 'One Piece';
        return s || '';
      };
      const money = v => Number(String(v ?? '').replace(/[$,]/g, '')) || 0;
      const priceFrom = v => money(v?.price || v?.marketPrice || v?.market_price || v?.averagePrice || v?.avgPrice || v?.tcgplayerMarketPrice || v?.lowPrice || v?.low);
      const normalizeJustVariant = (v, card = {}, i = 0) => {
        const conditionName = v.condition || v.conditionName || v.name || 'Near Mint';
        const finishName = v.printing || v.printingName || v.variant || v.variantName || v.finish || v.finishName || 'Normal';
        const market = priceFrom(v);
        return {
          justtcgVariantId: v.id || v.variantId || v.cardVariantId || '',
          skuId: v.tcgplayerSkuId || v.skuId || v.tcgplayer_sku_id || v.id || `${card.id || card.cardId || 'just'}-${i}`,
          tcgplayerSkuId: v.tcgplayerSkuId || v.skuId || v.tcgplayer_sku_id || '',
          productConditionId: v.productConditionId || v.tcgplayerProductConditionId || '',
          conditionId: Number(v.conditionId || 0) || null,
          condition: conditionCode(conditionName),
          conditionName,
          variantId: Number(v.variantId || 0) || null,
          finish: finishCode(finishName),
          finishName,
          languageId: Number(v.languageId || 0) || null,
          language: v.language || v.languageName || 'English',
          languageName: v.language || v.languageName || 'English',
          printing: finishName,
          marketPrice: market || null,
          lowPrice: money(v.lowPrice || v.minPrice || v.min || v.low) || null,
          midPrice: money(v.midPrice || v.averagePrice || v.avgPrice) || null,
          highPrice: money(v.highPrice || v.maxPrice || v.max) || null,
          recentSoldPrice: money(v.lastSoldPrice || v.recentSoldPrice) || null,
          priceChange7d: Number(v.priceChange7d || v.change7d || v.change_7d || 0) || 0,
          priceChange30d: Number(v.priceChange30d || v.change30d || v.change_30d || 0) || 0,
          priceChange90d: Number(v.priceChange90d || v.change90d || v.change_90d || 0) || 0,
          priceHistory: v.priceHistory || v.history || [],
          lastUpdated: v.lastUpdated || v.updatedAt || v.priceUpdatedAt || null,
          priceSource: market ? 'JustTCG Variant Market' : 'JustTCG Product Estimate',
          priceConfidence: market ? 'high' : 'medium',
        };
      };
      const normalizeJustCard = card => {
        const rawVariants = card.variants || card.printings || card.skus || card.prices || card.conditions || [];
        const variants = Array.isArray(rawVariants)
          ? rawVariants.map((v, i) => normalizeJustVariant(v, card, i)).filter(v => v.finish && v.condition)
          : Object.entries(rawVariants || {}).flatMap(([finish, p], i) => normalizeJustVariant({ ...p, printing: finish }, card, i));
        const selectedVariant = variants.find(v => v.condition === 'NM') || variants[0] || null;
        return {
          productId: card.id || card.cardId || card.justtcgCardId || '',
          justtcgCardId: card.id || card.cardId || '',
          tcgplayerId: card.tcgplayerId || card.tcgplayerProductId || '',
          name: card.name || card.title || '',
          setName: card.setName || card.set || card.groupName || '',
          cardNumber: card.cardNumber || card.number || card.collectorNumber || '',
          category: card.game || card.gameName || card.category || '',
          game: card.game || card.gameName || card.category || '',
          rarity: card.rarity || '',
          imageUrl: card.imageUrl || card.image || card.image_url || card.images?.small || card.images?.large || '',
          productUrl: card.url || card.productUrl || '',
          releaseDate: card.releaseDate || card.releasedAt || '',
          confidenceScore: 86,
          matchReasons: ['JustTCG match'],
          availableVariants: variants,
          selectedVariant,
          priceChange7d: selectedVariant?.priceChange7d || 0,
          priceChange30d: selectedVariant?.priceChange30d || 0,
          priceChange90d: selectedVariant?.priceChange90d || 0,
          priceHistory: selectedVariant?.priceHistory || [],
          raw: card,
        };
      };
      async function justFetch(path, params = {}) {
        const qs = new URLSearchParams(params);
        const res = await fetch('https://api.justtcg.com/v1' + path + (qs.toString() ? '?' + qs.toString() : ''), {
          headers: { 'x-api-key': key, 'Accept': 'application/json' },
        });
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
        if (!res.ok) throw new Error(errorMessageFromApi(data, 'JustTCG ' + res.status));
        return data;
      }
      try {
        const searchMatch = url.pathname === '/pricing/justtcg/search';
        const cardMatch = url.pathname.match(/^\/pricing\/justtcg\/card\/([^/]+)$/);
        const productVariantMatch = url.pathname.match(/^\/pricing\/justtcg\/product\/([^/]+)\/(?:variants|sku-prices)$/);
        const tcgplayerMatch = url.pathname.match(/^\/pricing\/justtcg\/tcgplayer\/([^/]+)$/);
        const skuMatch = url.pathname.match(/^\/pricing\/justtcg\/sku\/([^/]+)$/);
        const batchVariantMatch = url.pathname === '/pricing/justtcg/variants/batch';
        let cards = [];
        if (batchVariantMatch) {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          const body = await request.json().catch(() => ({}));
          const ids = Array.isArray(body.cardIds) ? body.cardIds : [];
          const duration = body.priceHistoryDuration || url.searchParams.get('priceHistoryDuration') || '90d';
          const out = [];
          for (const id of ids.slice(0, 10)) {
            const data = await justFetch('/cards/' + encodeURIComponent(id), { priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' })
              .catch(() => justFetch('/cards', { id, cardId: id, limit: 1, priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' }));
            const card = Array.isArray(data) ? data[0] : (data.card || data.data?.[0] || data.data || data);
            if (card) out.push(normalizeJustCard(card));
          }
          return json({ ok: true, success: true, source: 'justtcg', matches: out });
        }
        if (searchMatch) {
          const q = (url.searchParams.get('q') || '').trim();
          const category = justGame(url.searchParams.get('category') || url.searchParams.get('game') || '');
          if (!q) return json({ ok: false, error: 'q required' }, 400);
          const duration = url.searchParams.get('priceHistoryDuration') || '90d';
          const data = await justFetch('/cards', { q, name: q, search: q, game: category, limit: 24, priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' });
          cards = Array.isArray(data) ? data : (data.data || data.cards || data.results || []);
        } else if (cardMatch || productVariantMatch) {
          const id = decodeURIComponent(cardMatch?.[1] || productVariantMatch?.[1]);
          const duration = url.searchParams.get('priceHistoryDuration') || '90d';
          const data = await justFetch('/cards/' + encodeURIComponent(id), { priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' }).catch(() => justFetch('/cards', { id, cardId: id, limit: 1, priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' }));
          cards = Array.isArray(data) ? data : [data.card || data.data?.[0] || data.data || data].filter(Boolean);
        } else if (tcgplayerMatch) {
          const tcgplayerId = decodeURIComponent(tcgplayerMatch[1]);
          const duration = url.searchParams.get('priceHistoryDuration') || '90d';
          const data = await justFetch('/cards', { tcgplayerId, tcgplayerProductId: tcgplayerId, limit: 1, priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' });
          cards = Array.isArray(data) ? data : (data.data || data.cards || data.results || []);
        } else if (skuMatch) {
          const sku = decodeURIComponent(skuMatch[1]);
          const duration = url.searchParams.get('priceHistoryDuration') || '90d';
          const data = await justFetch('/cards', { tcgplayerSkuId: sku, skuId: sku, limit: 1, priceHistory: 'true', priceHistoryDuration: duration, includeVariants: 'true' });
          cards = Array.isArray(data) ? data : (data.data || data.cards || data.results || []);
        } else {
          return json({ ok: false, error: 'Unknown JustTCG route' }, 404);
        }
        const matches = cards.map(normalizeJustCard).filter(c => c.name);
        if (!matches.length) return json({ ok: false, source: 'justtcg', error: 'No match', matches: [] }, 404);
        if (skuMatch) {
          const sku = decodeURIComponent(skuMatch[1]);
          const card = matches[0];
          const selectedVariant = card.availableVariants.find(v => String(v.skuId) === sku || String(v.tcgplayerSkuId) === sku) || card.selectedVariant;
          return json({ ok: true, success: true, source: 'justtcg', card, selectedVariant, price: selectedVariant?.marketPrice || 0 });
        }
        return json({ ok: true, success: true, source: 'justtcg', matches, selectedVariant: matches[0]?.selectedVariant || null });
      } catch (e) {
        return json({ ok: false, source: 'justtcg', error: e.message }, 500);
      }
    }

    // PriceCharting guide proxy. Token and CSV URLs stay in Worker/KV only.
    if (url.pathname.startsWith('/pricing/pricecharting')) {
      const token = env.PRICECHARTING_TOKEN || env.PRICECHARTING_API_KEY;

      const pennies = v => {
        const n = Number(v);
        return n > 0 ? Math.round(n) / 100 : null;
      };
      const PC_CSV_CATEGORIES = ['Pokemon Cards', 'Magic Cards', 'YuGiOh Cards', 'One Piece Cards', 'Lorcana Cards', 'Digimon Cards', 'Dragon Ball Cards', 'Garbage Pail Cards', 'Marvel Cards', 'Star Wars Cards', 'Other TCG Cards', 'Comics', 'Video Games', 'Funko Pops', 'LEGO Sets', 'Coins', 'Amiibo', 'Strategy Guides', 'Gaming Magazines', 'Sports Cards'];
      const pcCategoryKey = c => {
        const raw = String(c || 'General').trim();
        const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const alias = {
          'pokemon-card':'Pokemon Cards',
          'pokemon-cards':'Pokemon Cards',
          'magic-card':'Magic Cards',
          'magic-cards':'Magic Cards',
          'mtg':'Magic Cards',
          'yugioh-cards':'YuGiOh Cards',
          'yu-gi-oh-cards':'YuGiOh Cards',
          'video-game':'Video Games',
          'video-games':'Video Games',
          'sport-cards':'Sports Cards',
          'sports-cards':'Sports Cards'
        }[slug];
        if (alias) return alias;
        const exact = PC_CSV_CATEGORIES.find(x => x.toLowerCase() === raw.toLowerCase());
        return exact || raw.replace(/[^a-zA-Z0-9._ -]/g, '').trim().slice(0, 80) || 'General';
      };
      const kvKey = (kind, category) => `pc_csv_${kind}:${pcCategoryKey(category)}`;
      const chunkKey = (category, cacheVersion, chunkIndex) => `pc_csv_chunk:${pcCategoryKey(category)}:${String(cacheVersion || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80)}:${Number(chunkIndex) || 0}`;
      const manifestKey = category => kvKey('manifest', category);
      const maskPcUrl = raw => {
        try {
          const u = new URL(String(raw || ''));
          ['t','token','api_key','apikey','key'].forEach(k => { if (u.searchParams.has(k)) u.searchParams.set(k, '***'); });
          return u.toString();
        } catch (_) {
          return String(raw || '').replace(/([?&](?:t|token|api_key|apikey|key)=)[^&]+/ig, '$1***');
        }
      };
      const csvState = (category, patch = {}) => ({ category, state: patch.state || 'ready', configured: !!patch.configured, urlMasked: patch.url ? maskPcUrl(patch.url) : undefined, ...patch, url: undefined });
      const mergeCsvMeta = (prior = {}, category, patch = {}) => csvState(category, {
        ...prior,
        ...patch,
        lastSuccessAt: patch.lastSuccessAt || prior?.lastSuccessAt || null,
        lastSyncedAt: patch.lastSyncedAt || prior?.lastSyncedAt || null,
        lastSuccessfulRowCount: patch.lastSuccessfulRowCount ?? prior?.lastSuccessfulRowCount ?? prior?.rowCount ?? 0,
      });
      const csvFetchOptions = () => ({
        headers: { 'Accept': 'text/csv,*/*' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
      });
      const pcUrl = path => 'https://www.pricecharting.com' + path;
      const pcImageUrl = p => {
        const raw = p['image-url'] || p.imageUrl || p.image || p.coverUrl || p.thumbnail || p['box-art-url'] || p['image'] || '';
        if (raw) {
          if (/^\/\//.test(raw)) return 'https:' + raw;
          if (/^\//.test(raw)) return 'https://www.pricecharting.com' + raw;
          return raw;
        }
        return '';
      };
      const pcMoney = (p, key, normalizedPath = '') => {
        const fromCsv = pennies(p[key]);
        if (fromCsv !== null && fromCsv !== undefined) return fromCsv;
        const parts = String(normalizedPath || '').split('.').filter(Boolean);
        let cur = p;
        for (const part of parts) cur = cur?.[part];
        const n = Number(cur);
        return n > 0 ? n : null;
      };
      const matchReasonsFor = (p, q) => {
        const reasons = [];
        const hay = [p['product-name'], p['console-name'], p.genre].filter(Boolean).join(' ').toLowerCase();
        String(q || '').toLowerCase().split(/\s+/).filter(Boolean).forEach(t => { if (hay.includes(t)) reasons.push(t); });
        return reasons.length ? reasons.slice(0, 6) : ['PriceCharting search match'];
      };
      const normalizePcProduct = (p, q = '') => ({
        source: 'PriceCharting',
        productId: String(p.id || p.productId || ''),
        productName: p['product-name'] || p.productName || '',
        consoleName: p['console-name'] || p.consoleName || '',
        genre: p.genre || '',
        releaseDate: p['release-date'] || p.releaseDate || null,
        url: p['product-url'] || p.url || (p.id ? `https://www.pricecharting.com/game/${p.id}` : null),
        imageUrl: pcImageUrl(p),
        prices: {
          ungraded: pcMoney(p, 'loose-price', 'prices.ungraded'),
          grade7: pcMoney(p, 'cib-price', 'prices.grade7'),
          grade8: pcMoney(p, 'new-price', 'prices.grade8'),
          grade9: pcMoney(p, 'graded-price', 'prices.grade9'),
          grade9_5: pcMoney(p, 'box-only-price', 'prices.grade9_5'),
          psa10: pcMoney(p, 'manual-only-price', 'prices.psa10'),
          bgs10: pcMoney(p, 'bgs-10-price', 'prices.bgs10'),
          cgc10: pcMoney(p, 'condition-17-price', 'prices.cgc10'),
          sgc10: pcMoney(p, 'condition-18-price', 'prices.sgc10'),
        },
        comicPrices: {
          ungraded: pcMoney(p, 'loose-price', 'comicPrices.ungraded'),
          grade4: pcMoney(p, 'cib-price', 'comicPrices.grade4'),
          grade6: pcMoney(p, 'new-price', 'comicPrices.grade6'),
          grade8: pcMoney(p, 'graded-price', 'comicPrices.grade8'),
          grade9_2: pcMoney(p, 'box-only-price', 'comicPrices.grade9_2'),
          grade9_4: pcMoney(p, 'condition-17-price', 'comicPrices.grade9_4'),
          grade9_8: pcMoney(p, 'manual-only-price', 'comicPrices.grade9_8'),
          grade10: pcMoney(p, 'bgs-10-price', 'comicPrices.grade10'),
        },
        retail: {
          looseBuy: pcMoney(p, 'retail-loose-buy', 'retail.looseBuy'),
          looseSell: pcMoney(p, 'retail-loose-sell', 'retail.looseSell'),
          cibBuy: pcMoney(p, 'retail-cib-buy', 'retail.cibBuy'),
          cibSell: pcMoney(p, 'retail-cib-sell', 'retail.cibSell'),
          newBuy: pcMoney(p, 'retail-new-buy', 'retail.newBuy'),
          newSell: pcMoney(p, 'retail-new-sell', 'retail.newSell'),
        },
        demand: {
          salesVolume: Number(p['sales-volume'] || p.salesVolume || 0) || null,
          genre: p.genre || '',
          consoleName: p['console-name'] || p.consoleName || '',
          releaseDate: p['release-date'] || p.releaseDate || null,
          upc: p.upc || p.UPC || '',
          asin: p.asin || p.ASIN || '',
          epid: p.epid || p.ePID || p.EPID || '',
        },
        videoGame: {
          productName: p['product-name'] || p.productName || '',
          consoleName: p['console-name'] || p.consoleName || '',
          loosePrice: pennies(p['loose-price']),
          cibPrice: pennies(p['cib-price']),
          newPrice: pennies(p['new-price']),
          gradedPrice: pennies(p['graded-price']),
          boxOnlyPrice: pennies(p['box-only-price']),
          manualOnlyPrice: pennies(p['manual-only-price']),
          retailLooseBuy: pennies(p['retail-loose-buy']),
          retailLooseSell: pennies(p['retail-loose-sell']),
          retailCibBuy: pennies(p['retail-cib-buy']),
          retailCibSell: pennies(p['retail-cib-sell']),
          retailNewBuy: pennies(p['retail-new-buy']),
          retailNewSell: pennies(p['retail-new-sell']),
          salesVolume: Number(p['sales-volume'] || p.salesVolume || 0) || null,
          upc: p.upc || p.UPC || '',
          asin: p.asin || p.ASIN || '',
          epid: p.epid || p.ePID || p.EPID || '',
        },
        rawApiPricesPennies: {
          'loose-price': p['loose-price'] ?? null,
          'cib-price': p['cib-price'] ?? null,
          'new-price': p['new-price'] ?? null,
          'graded-price': p['graded-price'] ?? null,
          'box-only-price': p['box-only-price'] ?? null,
          'manual-only-price': p['manual-only-price'] ?? null,
          'bgs-10-price': p['bgs-10-price'] ?? null,
          'condition-17-price': p['condition-17-price'] ?? null,
          'condition-18-price': p['condition-18-price'] ?? null,
          'retail-loose-buy': p['retail-loose-buy'] ?? null,
          'retail-loose-sell': p['retail-loose-sell'] ?? null,
          'retail-cib-buy': p['retail-cib-buy'] ?? null,
          'retail-cib-sell': p['retail-cib-sell'] ?? null,
          'retail-new-buy': p['retail-new-buy'] ?? null,
          'retail-new-sell': p['retail-new-sell'] ?? null,
        },
        lastUpdated: p['updated-at'] || p.updatedAt || null,
        confidence: matchReasonsFor(p, q).length >= 3 ? 'high' : matchReasonsFor(p, q).length >= 1 ? 'medium' : 'low',
        matchReasons: matchReasonsFor(p, q),
        raw: p,
      });
      const gradeKey = (company = 'PSA', grade = '') => {
        const g = String(grade || '').toLowerCase().replace(/^psa|^bgs|^cgc|^sgc/g, '').trim();
        const c = String(company || '').toLowerCase();
        if (c.includes('bgs') && g === '10') return 'bgs10';
        if (c.includes('cgc') && g === '10') return 'cgc10';
        if (c.includes('sgc') && g === '10') return 'sgc10';
        if (g === '10') return 'psa10';
        if (g === '9.5') return 'grade9_5';
        if (g.startsWith('9')) return 'grade9';
        if (g.startsWith('8')) return 'grade8';
        if (g.startsWith('7')) return 'grade7';
        return 'ungraded';
      };
      async function pcFetch(path, params = {}) {
        const qs = new URLSearchParams({ t: token, ...params });
        const publicQs = new URLSearchParams(params);
        const cacheKey = 'pc_api_cache:' + btoa(path + '?' + publicQs.toString()).replace(/=+$/,'').slice(0, 180);
        const ttl = path.includes('/api/products') ? 60 * 60 * 6 : 60 * 60 * 24;
        if (env.LBA_KV) {
          const cached = await env.LBA_KV.get(cacheKey, 'json');
          if (cached) return { ...cached, _cacheHit: true };
        }
        if (env.LBA_KV) {
          const last = Number(await env.LBA_KV.get('pc_live_last_call') || 0);
          const now = Date.now();
          const wait = last ? Math.max(0, 1100 - (now - last)) : 0;
          if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
          await env.LBA_KV.put('pc_live_last_call', String(Date.now()), { expirationTtl: 60 });
        }
        const res = await fetch(pcUrl(path) + '?' + qs.toString(), { headers: { 'Accept': 'application/json' } });
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
        if (!res.ok || data.status === 'error') throw new Error(data['error-message'] || data.error || 'PriceCharting ' + res.status);
        if (env.LBA_KV) await env.LBA_KV.put(cacheKey, JSON.stringify(data), { expirationTtl: ttl });
        return data;
      }
      function parseCsvLine(line) {
        const out = [];
        let cur = '', quoted = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
            else quoted = !quoted;
          } else if (ch === ',' && !quoted) {
            out.push(cur);
            cur = '';
          } else cur += ch;
        }
        out.push(cur);
        return out;
      }
      function parsePcCsv(text) {
        const src = String(text || '').replace(/^\uFEFF/, '');
        const lines = [];
        let cur = '', quoted = false;
        for (let i = 0; i < src.length; i++) {
          const ch = src[i], next = src[i + 1];
          if (ch === '"' && quoted && next === '"') { cur += '"'; i++; continue; }
          if (ch === '"') { quoted = !quoted; cur += ch; continue; }
          if ((ch === '\n' || ch === '\r') && !quoted) {
            if (cur.trim()) lines.push(cur);
            cur = '';
            if (ch === '\r' && next === '\n') i++;
            continue;
          }
          cur += ch;
        }
        if (cur.trim()) lines.push(cur);
        if (quoted) throw new Error('parse_error: unterminated quoted CSV field');
        if (lines.length < 2) return [];
        const headersRaw = parseCsvLine(lines[0]).map(h => h.trim());
        const canonical = h => String(h || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
        const alias = {
          'product-name':'product-name',
          'product name':'product-name',
          'console-name':'console-name',
          'console name':'console-name',
          'loose-price':'loose-price',
          'loose price':'loose-price',
          'cib-price':'cib-price',
          'cib price':'cib-price',
          'new-price':'new-price',
          'new price':'new-price',
          'graded-price':'graded-price',
          'graded price':'graded-price',
          'image-url':'image-url',
          'image url':'image-url',
          'product-url':'product-url',
          'product url':'product-url'
        };
        const headers = headersRaw.map(h => alias[canonical(h)] || canonical(h));
        if (!headers.includes('product-name') && !headers.includes('id')) throw new Error('parse_error: missing expected PriceCharting headers. Saw: ' + headersRaw.slice(0, 8).join(', '));
        return lines.slice(1).map(line => {
          const vals = parseCsvLine(line);
          const row = {};
          headers.forEach((h, i) => row[h] = vals[i] ?? '');
          return row;
        }).filter(row => row['product-name'] || row.id);
      }
      function csvMatches(rows, q) {
        const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
        return (rows || []).map(row => {
          const hay = [
            row['product-name'], row.productName,
            row['console-name'], row.consoleName,
            row.genre, row.upc, row.UPC, row.epid, row.ePID,
            row.productId, row.id
          ].filter(Boolean).join(' ').toLowerCase();
          const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
          return { row, score };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 25).map(x => normalizePcProduct(x.row, q));
      }
      async function chunkedCsvMatches(category, q) {
        if (!env.LBA_KV) return [];
        const manifest = await env.LBA_KV.get(manifestKey(category), 'json');
        if (!manifest || manifest.syncStatus !== 'complete' || !manifest.cacheVersion || !Number(manifest.totalChunks || 0)) return [];
        const matches = [];
        for (let i = 0; i < Number(manifest.totalChunks || 0); i++) {
          const rows = await env.LBA_KV.get(chunkKey(category, manifest.cacheVersion, i), 'json');
          if (Array.isArray(rows) && rows.length) {
            matches.push(...csvMatches(rows, q).map(m => ({ ...m, csvCategory: pcCategoryKey(category), cacheVersion: manifest.cacheVersion, cachedAt: manifest.lastSuccessfulSync })));
          }
          matches.sort((a, b) => (b.confidence === 'high') - (a.confidence === 'high'));
          if (matches.length >= 75) break;
        }
        return matches.slice(0, 25);
      }
      try {
        if (url.pathname === '/pricing/pricecharting/csv/status') {
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const categories = PC_CSV_CATEGORIES;
          const status = {};
          for (const cat of categories) {
            const meta = await env.LBA_KV.get(kvKey('meta', cat), 'json');
            const manifest = await env.LBA_KV.get(manifestKey(cat), 'json');
            const savedUrl = await env.LBA_KV.get(kvKey('url', cat));
            const rows = await env.LBA_KV.get(kvKey('rows', cat), 'json');
            const legacyRowCount = Array.isArray(rows) ? rows.length : 0;
            const chunkRowCount = Number(manifest?.cachedRowCount || 0);
            const cacheRowCount = chunkRowCount || legacyRowCount;
            status[cat] = meta ? { ...meta, manifest: manifest || null, cacheRowCount, rowCount: Number(meta.rowCount || cacheRowCount || 0), chunkRowCount, legacyRowCount, cacheKey: manifest?.cacheKey || kvKey('rows', cat) } : { category: cat, state: savedUrl ? (cacheRowCount ? 'synced' : 'ready') : 'not_configured', configured: !!savedUrl, urlPresent: !!savedUrl, urlMasked: savedUrl ? maskPcUrl(savedUrl) : '', rowCount: cacheRowCount, cacheRowCount, chunkRowCount, legacyRowCount, lastAttemptedAt: null, lastSuccessAt: manifest?.lastSuccessfulSync || null, lastSyncedAt: manifest?.lastSuccessfulSync || null, lastError: manifest?.lastError || '', cacheKey: manifest?.cacheKey || kvKey('rows', cat), manifest: manifest || null };
          }
          return json({ ok: true, source: 'PriceCharting CSV', categories: status });
        }
        if (url.pathname === '/pricing/pricecharting/csv/test-url') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const csvUrl = String(body.fullUrl || body.url || '').trim();
          if (!csvUrl) return json({ ok: false, state: 'not_configured', error: 'fullUrl required in POST JSON body' }, 400);
          let parsedUrl;
          try {
            parsedUrl = new URL(csvUrl);
            if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error('invalid protocol');
          } catch (_) {
            return json({ ok: false, state: 'invalid_url', error: 'Invalid CSV URL' }, 400);
          }
          let res;
          try {
            res = await fetch(csvUrl, csvFetchOptions());
          } catch (e) {
            return json({ ok: false, state: 'worker_error', responseType: 'FETCH_FAILED', error: e.name === 'TimeoutError' || /abort/i.test(e.message || '') ? 'CSV fetch timed out before import could start' : (e.message || 'CSV fetch failed'), urlMasked: maskPcUrl(csvUrl) }, 502);
          }
          const contentType = res.headers.get('content-type') || '';
          const text = await res.text();
          const responsePreview = text.slice(0, 200).replace(/([?&](?:t|token|api_key|apikey|key)=)[^&\\s"']+/ig, '$1***');
          if (!res.ok) return json({ ok: false, state: 'fetch_failed', responseStatus: res.status, responseContentType: contentType, error: 'CSV fetch failed ' + res.status + ': ' + responsePreview, urlMasked: maskPcUrl(csvUrl) }, res.status);
          if (/text\/html/i.test(contentType) || /<!doctype html|<html/i.test(text.slice(0, 500))) {
            return json({ ok: false, state: 'HTML_RETURNED', responseType: 'HTML_RETURNED', responseStatus: res.status, responseContentType: contentType, responsePreview, urlMasked: maskPcUrl(csvUrl) }, 422);
          }
          const rows = parsePcCsv(text);
          const normalized = rows.map(r => normalizePcProduct(r)).filter(r => r.productName || r.productId);
          return json({
            ok: true,
            state: 'CSV_RETURNED',
            responseType: 'CSV_RETURNED',
            responseStatus: res.status,
            responseContentType: contentType,
            urlMasked: maskPcUrl(csvUrl),
            detectedCategory: category,
            headers: rows[0] ? Object.keys(rows[0]) : [],
            firstParsedRows: rows.slice(0, 3),
            parsedRowCount: rows.length,
            normalizedRowCount: normalized.length,
            cacheWriteSuccess: false,
            cacheKey: kvKey('rows', category),
          });
        }
        if (url.pathname === '/pricing/pricecharting/csv/chunk/start') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const cacheVersion = String(body.cacheVersion || ('browser-' + Date.now())).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
          const startedAt = new Date().toISOString();
          const incomingUrl = String(body.fullUrl || body.url || '').trim();
          if (incomingUrl) await env.LBA_KV.put(kvKey('url', category), incomingUrl);
          const prior = await env.LBA_KV.get(kvKey('meta', category), 'json');
          const priorManifest = await env.LBA_KV.get(manifestKey(category), 'json');
          const manifest = {
            ...(priorManifest || {}),
            category,
            cacheVersion,
            syncStatus: 'uploading_chunks',
            sourceType: 'browser_chunked_pricecharting_csv',
            lastAttemptedSync: startedAt,
            lastAttemptedAt: startedAt,
            lastSuccessfulSync: priorManifest?.lastSuccessfulSync || prior?.lastSyncedAt || null,
            cachedRowCount: Number(priorManifest?.cachedRowCount || prior?.rowCount || 0),
            expectedRowCount: Number(body.totalRows || 0),
            rowsPerChunk: Number(body.rowsPerChunk || body.chunkSize || 500),
            totalChunks: Number(body.totalChunks || 0),
            uploadedChunks: [],
            failedChunks: [],
            lastError: '',
            urlMasked: incomingUrl ? maskPcUrl(incomingUrl) : prior?.urlMasked || '',
            cacheKey: `pc_csv_chunk:${category}:${cacheVersion}:*`
          };
          const meta = mergeCsvMeta(prior, category, {
            state: 'uploading_chunks',
            configured: true,
            url: incomingUrl || undefined,
            urlPresent: true,
            rowCount: manifest.cachedRowCount,
            cacheRowCount: manifest.cachedRowCount,
            lastAttemptedAt: startedAt,
            lastError: '',
            source: 'PriceCharting CSV browser chunks',
            cacheKey: manifest.cacheKey,
          });
          await env.LBA_KV.put(manifestKey(category), JSON.stringify(manifest), { expirationTtl: 60 * 60 * 24 * 45 });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 45 });
          return json({ ok: true, state: 'uploading_chunks', manifest, meta });
        }
        if (url.pathname === '/pricing/pricecharting/csv/chunk/upload') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const cacheVersion = String(body.cacheVersion || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
          const chunkIndex = Number(body.chunkIndex);
          const rows = Array.isArray(body.rows) ? body.rows : [];
          if (!cacheVersion) return json({ ok: false, error: 'cacheVersion required' }, 400);
          if (!Number.isFinite(chunkIndex) || chunkIndex < 0) return json({ ok: false, error: 'valid chunkIndex required' }, 400);
          if (!rows.length) return json({ ok: false, error: 'rows required' }, 400);
          const manifest = await env.LBA_KV.get(manifestKey(category), 'json') || { category, cacheVersion, uploadedChunks: [] };
          if (manifest.cacheVersion && manifest.cacheVersion !== cacheVersion) return json({ ok: false, error: 'cacheVersion mismatch', activeCacheVersion: manifest.cacheVersion }, 409);
          await env.LBA_KV.put(chunkKey(category, cacheVersion, chunkIndex), JSON.stringify(rows), { expirationTtl: 60 * 60 * 24 * 45 });
          const uploaded = new Set(Array.isArray(manifest.uploadedChunks) ? manifest.uploadedChunks : []);
          uploaded.add(chunkIndex);
          const next = {
            ...manifest,
            category,
            cacheVersion,
            syncStatus: 'uploading_chunks',
            uploadedChunks: [...uploaded].sort((a, b) => a - b),
            uploadedRowCount: Number(manifest.uploadedRowCount || 0) + rows.length,
            totalChunks: Math.max(Number(manifest.totalChunks || 0), Number(body.totalChunks || 0), chunkIndex + 1),
            updatedAt: new Date().toISOString(),
            lastError: ''
          };
          await env.LBA_KV.put(manifestKey(category), JSON.stringify(next), { expirationTtl: 60 * 60 * 24 * 45 });
          return json({ ok: true, state: 'chunk_uploaded', category, cacheVersion, chunkIndex, rowCount: rows.length, uploadedChunks: next.uploadedChunks.length, manifest: next });
        }
        if (url.pathname === '/pricing/pricecharting/csv/chunk/complete') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const cacheVersion = String(body.cacheVersion || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
          const totalChunks = Number(body.totalChunks || 0);
          const totalRows = Number(body.totalRows || 0);
          const manifest = await env.LBA_KV.get(manifestKey(category), 'json');
          if (!manifest || manifest.cacheVersion !== cacheVersion) return json({ ok: false, error: 'No active chunk upload for cacheVersion' }, 404);
          const uploaded = new Set(Array.isArray(manifest.uploadedChunks) ? manifest.uploadedChunks : []);
          const missing = [];
          for (let i = 0; i < totalChunks; i++) if (!uploaded.has(i)) missing.push(i);
          if (missing.length) return json({ ok: false, state: 'missing_chunks', error: 'Missing chunk uploads', missingChunks: missing.slice(0, 50), manifest }, 409);
          const completedAt = new Date().toISOString();
          const nextManifest = {
            ...manifest,
            syncStatus: 'complete',
            state: 'complete',
            lastSuccessfulSync: completedAt,
            lastSuccessfulSyncAt: completedAt,
            lastSuccessfulRowCount: totalRows,
            cachedRowCount: totalRows,
            totalRows,
            totalChunks,
            priceAgeHours: 0,
            lastError: '',
            cacheKey: `pc_csv_chunk:${category}:${cacheVersion}:*`
          };
          const prior = await env.LBA_KV.get(kvKey('meta', category), 'json');
          const meta = mergeCsvMeta(prior, category, {
            state: 'complete',
            configured: true,
            urlPresent: true,
            rowCount: totalRows,
            normalizedRowCount: totalRows,
            cacheRowCount: totalRows,
            lastAttemptedAt: manifest.lastAttemptedAt || manifest.lastAttemptedSync || completedAt,
            lastSuccessAt: completedAt,
            lastSyncedAt: completedAt,
            lastSuccessfulRowCount: totalRows,
            lastError: '',
            source: 'PriceCharting CSV browser chunks',
            cacheKey: nextManifest.cacheKey
          });
          await env.LBA_KV.put(manifestKey(category), JSON.stringify(nextManifest), { expirationTtl: 60 * 60 * 24 * 45 });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 45 });
          return json({ ok: true, state: 'complete', manifest: nextManifest, meta });
        }
        if (url.pathname === '/pricing/pricecharting/csv/chunk/fail') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const failedAt = new Date().toISOString();
          const priorManifest = await env.LBA_KV.get(manifestKey(category), 'json') || {};
          const prior = await env.LBA_KV.get(kvKey('meta', category), 'json');
          const error = String(body.error || 'Browser chunk sync failed').slice(0, 500);
          const manifest = { ...priorManifest, syncStatus: 'failed', state: 'failed', lastFailedSync: failedAt, lastError: error, failedChunks: Array.isArray(body.failedChunkIndexes) ? body.failedChunkIndexes.slice(0, 200) : [] };
          const meta = mergeCsvMeta(prior, category, { state: 'failed', configured: true, lastAttemptedAt: failedAt, lastFailedAt: failedAt, lastFailedError: error, lastError: error, rowCount: Number(prior?.rowCount || priorManifest.cachedRowCount || 0), cacheRowCount: Number(prior?.cacheRowCount || priorManifest.cachedRowCount || 0) });
          await env.LBA_KV.put(manifestKey(category), JSON.stringify(manifest), { expirationTtl: 60 * 60 * 24 * 45 });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 45 });
          return json({ ok: true, state: 'failed', cachePreserved: true, manifest, meta });
        }
        if (url.pathname === '/pricing/pricecharting/csv/chunk/clear') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const manifest = await env.LBA_KV.get(manifestKey(category), 'json');
          let deletedChunks = 0;
          if (manifest?.cacheVersion && Number(manifest.totalChunks || 0)) {
            for (let i = 0; i < Number(manifest.totalChunks || 0); i++) {
              await env.LBA_KV.delete(chunkKey(category, manifest.cacheVersion, i));
              deletedChunks++;
            }
          }
          await env.LBA_KV.delete(kvKey('rows', category));
          await env.LBA_KV.delete(manifestKey(category));
          const savedUrl = await env.LBA_KV.get(kvKey('url', category));
          const meta = csvState(category, { state: savedUrl ? 'ready' : 'not_configured', configured: !!savedUrl, url: savedUrl || '', urlPresent: !!savedUrl, rowCount: 0, cacheRowCount: 0, lastAttemptedAt: new Date().toISOString(), lastError: '', cacheKey: kvKey('rows', category) });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 45 });
          return json({ ok: true, state: 'cleared', category, deletedChunks, meta });
        }
        if (url.pathname === '/pricing/pricecharting/csv/sync') {
          if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const body = await request.json().catch(() => ({}));
          const category = pcCategoryKey(body.categoryKey || body.category || 'General');
          const attemptAt = new Date().toISOString();
          const incomingUrl = String(body.fullUrl || body.url || '').trim();
          if (incomingUrl) {
            try {
              const parsed = new URL(incomingUrl);
              if (!/^https?:$/.test(parsed.protocol)) throw new Error('invalid protocol');
              await env.LBA_KV.put(kvKey('url', category), incomingUrl);
            } catch (_) {
              const meta = csvState(category, { state: 'invalid_url', configured: false, lastAttemptedAt: attemptAt, lastError: 'Invalid CSV URL' });
              await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
              return json({ ok: false, state: 'invalid_url', error: 'Invalid CSV URL', meta }, 400);
            }
          }
          const csvUrl = incomingUrl || await env.LBA_KV.get(kvKey('url', category));
          if (!csvUrl) {
            const meta = csvState(category, { state: 'not_configured', configured: false, lastAttemptedAt: attemptAt, lastError: 'CSV URL required first sync' });
            return json({ ok: false, state: 'not_configured', error: 'CSV URL required first sync', meta }, 400);
          }
          const prior = await env.LBA_KV.get(kvKey('meta', category), 'json');
          const looksLikeHugeDownload = /price-guide\/download-custom/i.test(csvUrl);
          if (looksLikeHugeDownload && body.blockingImport !== true) {
            const rows = await env.LBA_KV.get(kvKey('rows', category), 'json');
            const preservedRows = Array.isArray(rows) ? rows.length : Number(prior?.rowCount || 0);
            const meta = mergeCsvMeta(prior, category, {
              state: 'TIMEOUT_TOO_LARGE',
              configured: true,
              url: csvUrl,
              urlPresent: true,
              rowCount: preservedRows,
              cacheRowCount: preservedRows,
              lastAttemptedAt: attemptAt,
              lastFailedAt: attemptAt,
              lastFailedError: 'TIMEOUT_TOO_LARGE: PriceCharting download-custom CSV is too large for one Worker request. Existing cache was preserved. Use Test URL for validation and a future chunk/background importer for full refresh.',
              lastError: 'TIMEOUT_TOO_LARGE: PriceCharting download-custom CSV is too large for one Worker request. Existing cache was preserved.',
              cacheKey: kvKey('rows', category)
            });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({
              ok: false,
              state: 'TIMEOUT_TOO_LARGE',
              error: meta.lastError,
              cachePreserved: true,
              preservedRowCount: preservedRows,
              meta
            }, 413);
          }
          const now = Date.now();
          if (prior?.lastSyncedAt && now - Date.parse(prior.lastSyncedAt) < 10 * 60 * 1000) {
            const retryAt = new Date(Date.parse(prior.lastSyncedAt) + 10 * 60 * 1000).toISOString();
            const meta = { ...prior, state: 'rate_limited', lastAttemptedAt: attemptAt, retryAt };
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({ ok: true, skipped: true, state: 'rate_limited', reason: 'PriceCharting CSV limit: wait 10 minutes between CSV calls', retryAt, meta });
          }
          if (!body.force && prior?.lastSyncedAt && new Date(prior.lastSyncedAt).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10)) {
            return json({ ok: true, skipped: true, reason: 'Already synced today', meta: prior });
          }
          let res, text = '';
          const fetchStartedMeta = mergeCsvMeta(prior, category, { state: 'fetch_started', configured: true, url: csvUrl, lastAttemptedAt: attemptAt, lastError: '' });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(fetchStartedMeta), { expirationTtl: 60 * 60 * 24 * 30 });
          try {
            res = await fetch(csvUrl, csvFetchOptions());
            const downloadedMeta = mergeCsvMeta(fetchStartedMeta, category, { state: 'downloaded', configured: true, url: csvUrl, lastAttemptedAt: attemptAt });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(downloadedMeta), { expirationTtl: 60 * 60 * 24 * 30 });
            text = await res.text();
          } catch (e) {
            const timeout = e.name === 'TimeoutError' || /abort|timeout/i.test(e.message || '');
            const meta = mergeCsvMeta(prior, category, {
              state: timeout ? 'TIMEOUT_TOO_LARGE' : 'failed',
              configured: true,
              url: csvUrl,
              lastAttemptedAt: attemptAt,
              lastFailedAt: attemptAt,
              lastFailedError: timeout ? 'TIMEOUT_TOO_LARGE: CSV is too large to download/import in one Worker request. Existing cache was preserved.' : (e.message || 'Worker fetch failed'),
              lastError: timeout ? 'TIMEOUT_TOO_LARGE: CSV is too large to download/import in one Worker request. Existing cache was preserved.' : (e.message || 'Worker fetch failed')
            });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({ ok: false, state: meta.state, error: meta.lastError, cachePreserved: true, meta }, timeout ? 413 : 502);
          }
          if (!res.ok) {
            const state = res.status === 401 || res.status === 403 ? 'auth_error' : res.status === 429 ? 'rate_limited' : 'worker_error';
            const meta = mergeCsvMeta(prior, category, { state, configured: true, url: csvUrl, lastAttemptedAt: attemptAt, lastFailedAt: attemptAt, lastFailedError: 'CSV fetch failed ' + res.status + ': ' + text.slice(0, 120), lastError: 'CSV fetch failed ' + res.status + ': ' + text.slice(0, 120) });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({ ok: false, state, error: meta.lastError, cachePreserved: true, meta }, res.status);
          }
          const contentType = res.headers.get('content-type') || '';
          const responsePreview = text.slice(0, 200).replace(/([?&](?:t|token|api_key|apikey|key)=)[^&\\s"']+/ig, '$1***');
          if (/text\/html/i.test(contentType) || /<!doctype html|<html/i.test(text.slice(0, 500))) {
            const meta = mergeCsvMeta(prior, category, { state: 'HTML_RETURNED', configured: true, url: csvUrl, lastAttemptedAt: attemptAt, lastFailedAt: attemptAt, lastFailedError: 'HTML_RETURNED: PriceCharting returned an HTML page instead of CSV', lastError: 'HTML_RETURNED: PriceCharting returned an HTML page instead of CSV', responseStatus: res.status, responseContentType: contentType, responsePreview });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({ ok: false, state: 'HTML_RETURNED', responseType: 'HTML_RETURNED', responseStatus: res.status, responseContentType: contentType, responsePreview, error: meta.lastError, cachePreserved: true, meta }, 422);
          }
          let rows;
          try {
            const parsingMeta = mergeCsvMeta(prior, category, { state: 'parsing', configured: true, url: csvUrl, lastAttemptedAt: attemptAt, responseStatus: res.status, responseContentType: contentType });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(parsingMeta), { expirationTtl: 60 * 60 * 24 * 30 });
            rows = parsePcCsv(text).slice(0, 50000);
          } catch (e) {
            const meta = mergeCsvMeta(prior, category, { state: 'parse_error', configured: true, url: csvUrl, lastAttemptedAt: attemptAt, lastFailedAt: attemptAt, lastFailedError: e.message || 'Malformed CSV', lastError: e.message || 'Malformed CSV' });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({ ok: false, state: 'parse_error', error: meta.lastError, cachePreserved: true, meta }, 422);
          }
          if (!rows.length) {
            const meta = mergeCsvMeta(prior, category, { state: 'empty_csv', configured: true, url: csvUrl, rowCount: 0, lastAttemptedAt: attemptAt, lastFailedAt: attemptAt, lastFailedError: 'CSV parsed but contained no product rows', lastError: 'CSV parsed but contained no product rows' });
            await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
            return json({ ok: false, state: 'empty_csv', error: meta.lastError, cachePreserved: true, meta }, 422);
          }
          const normalizedRowCount = rows.map(r => normalizePcProduct(r)).filter(r => r.productName || r.productId).length;
          const writingMeta = mergeCsvMeta(prior, category, { state: 'writing_cache', configured: true, url: csvUrl, urlPresent: true, rowCount: rows.length, normalizedRowCount, lastAttemptedAt: attemptAt, responseStatus: res.status, responseContentType: contentType });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(writingMeta), { expirationTtl: 60 * 60 * 24 * 30 });
          const meta = csvState(category, { state: 'complete', configured: true, url: csvUrl, urlPresent: true, rowCount: rows.length, normalizedRowCount, cacheRowCount: rows.length, lastAttemptedAt: attemptAt, lastSuccessAt: new Date(now).toISOString(), lastSyncedAt: new Date(now).toISOString(), lastSuccessfulRowCount: rows.length, lastError: '', lastFailedAt: prior?.lastFailedAt || null, lastFailedError: prior?.lastFailedError || '', source: 'PriceCharting CSV', sample: rows[0], responseStatus: res.status, responseContentType: contentType, cacheKey: kvKey('rows', category) });
          await env.LBA_KV.put(kvKey('rows', category), JSON.stringify(rows), { expirationTtl: 60 * 60 * 24 * 14 });
          await env.LBA_KV.put(kvKey('meta', category), JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
          return json({ ok: true, state: 'synced', responseType: 'CSV_RETURNED', responseStatus: res.status, responseContentType: contentType, parsedRowCount: rows.length, normalizedRowCount, cacheWriteSuccess: true, cacheKey: kvKey('rows', category), headers: rows[0] ? Object.keys(rows[0]) : [], firstParsedRows: rows.slice(0, 3), meta, sample: rows[0] });
        }
        if (url.pathname === '/pricing/pricecharting/csv/search') {
          if (!env.LBA_KV) return json({ ok: false, error: 'LBA_KV binding required for CSV cache' }, 501);
          const q = (url.searchParams.get('q') || '').trim();
          const category = url.searchParams.get('category') || '';
          if (!q) return json({ ok: false, error: 'q required' }, 400);
          const cats = category ? [pcCategoryKey(category)] : PC_CSV_CATEGORIES;
          const matches = [];
          for (const cat of cats) {
            const rows = await env.LBA_KV.get(kvKey('rows', cat), 'json');
            if (Array.isArray(rows)) matches.push(...csvMatches(rows, q).map(m => ({ ...m, csvCategory: cat })));
            matches.push(...await chunkedCsvMatches(cat, q));
          }
          return json({ ok: true, source: 'PriceCharting CSV', query: q, matches: matches.slice(0, 25), products: matches.slice(0, 25) });
        }
        if (!token) return json({ ok: false, needsKey: true, source: 'PriceCharting', error: 'PRICECHARTING_TOKEN not set in Worker secrets' }, 501);
        if (url.pathname === '/pricing/pricecharting/search') {
          const q = (url.searchParams.get('q') || '').trim();
          if (!q) return json({ ok: false, error: 'q required' }, 400);
          if (env.LBA_KV && url.searchParams.get('live') !== 'true') {
            const category = url.searchParams.get('category') || '';
            const cats = category ? [pcCategoryKey(category)] : PC_CSV_CATEGORIES;
            let cached = [];
            for (const cat of cats) {
              const rows = await env.LBA_KV.get(kvKey('rows', cat), 'json');
              if (Array.isArray(rows)) cached.push(...csvMatches(rows, q).map(m => ({ ...m, csvCategory: cat })));
              cached.push(...await chunkedCsvMatches(cat, q));
            }
            if (cached.length) return json({ ok: true, source: 'PriceCharting CSV', query: q, products: cached.slice(0, 25), matches: cached.slice(0, 25), cached: true });
          }
          // Forward console filter to PriceCharting so category-specific searches work
          const consoleFilter = url.searchParams.get('console') || '';
          const apiParams = { q };
          if (consoleFilter) apiParams['console'] = consoleFilter;
          const data = await pcFetch('/api/products', apiParams);
          const products = (data.products || []).map(p => normalizePcProduct(p, q));
          return json({ ok: true, source: 'PriceCharting', query: q, products, matches: products });
        }
        const productMatch = url.pathname.match(/^\/pricing\/pricecharting\/product\/([^/]+)$/);
        if (productMatch) {
          const data = await pcFetch('/api/product', { id: decodeURIComponent(productMatch[1]) });
          const product = normalizePcProduct(data, data['product-name'] || '');
          return json({ ok: true, source: 'PriceCharting', product, ...product });
        }
        if (url.pathname === '/pricing/pricecharting/slab-prices') {
          const q = [url.searchParams.get('q'), url.searchParams.get('setName'), url.searchParams.get('cardNumber') ? '#' + url.searchParams.get('cardNumber') : ''].filter(Boolean).join(' ').trim();
          const company = url.searchParams.get('company') || 'PSA';
          const grade = url.searchParams.get('grade') || '10';
          if (!q) return json({ ok: false, error: 'q required' }, 400);
          const data = await pcFetch('/api/products', { q });
          const first = (data.products || [])[0];
          if (!first) return json({ ok: false, source: 'PriceCharting', error: 'No match', matches: [] }, 404);
          const productData = await pcFetch('/api/product', { id: first.id });
          const product = normalizePcProduct(productData, q);
          const selectedKey = gradeKey(company, grade);
          return json({
            ok: true,
            source: 'PriceCharting',
            query: q,
            company,
            grade,
            selectedKey,
            selectedValue: product.prices[selectedKey] || null,
            product,
            matches: [product],
            note: 'PriceCharting values are grade-bucket guide values, not exact sold comps.',
          });
        }
        return json({ ok: false, error: 'Unknown PriceCharting route' }, 404);
      } catch (e) {
        return json({ ok: false, source: 'PriceCharting', error: e.message }, 500);
      }
    }

    if (url.pathname === '/pricing/tcg/resolve-product') {
      const params = new URLSearchParams({
        q: url.searchParams.get('query') || url.searchParams.get('q') || '',
        category: url.searchParams.get('category') || '',
        include_variants: 'true',
        include_price_history: 'true'
      });
      const upstream = await fetch(new URL('/pricing/justtcg/search?' + params.toString(), url.origin), { headers: request.headers });
      return new Response(upstream.body, upstream);
    }
    if (url.pathname === '/pricing/tcg/product-variants') {
      const productId = url.searchParams.get('productId') || '';
      if (!productId) return json({ ok: false, error: 'productId required' }, 400);
      const params = new URLSearchParams({ include_variants: 'true', include_price_history: 'true', priceHistoryDuration: url.searchParams.get('priceHistoryDuration') || '90d' });
      const upstream = await fetch(new URL('/pricing/justtcg/card/' + encodeURIComponent(productId) + '?' + params.toString(), url.origin), { headers: request.headers });
      const data = await upstream.json().catch(() => ({}));
      const card = data.card || data.matches?.[0] || null;
      return json({ ok: upstream.ok && !!card, source: 'JustTCG', productId, variantMatrix: card ? { productId: card.productId || productId, source: 'JustTCG', name: card.name || '', setName: card.setName || '', cardNumber: card.cardNumber || '', variants: card.availableVariants || [] } : null, card, error: data.error || '' }, upstream.status);
    }
    if (url.pathname === '/pricing/tcg/sku-price') {
      const skuId = url.searchParams.get('skuId') || '';
      if (!skuId) return json({ ok: false, error: 'skuId required' }, 400);
      const upstream = await fetch(new URL('/pricing/justtcg/sku/' + encodeURIComponent(skuId), url.origin), { headers: request.headers });
      return new Response(upstream.body, upstream);
    }

    // GET /pricing/pokemon/export?type=cards|sealed|ebay|population
    // Business-tier bulk export — decompresses gzip, returns CSV text
    if (url.pathname === '/pricing/pokemon/export' && request.method === 'GET') {
      const type = url.searchParams.get('type') || 'cards';
      const validTypes = ['cards', 'sealed', 'ebay', 'population'];
      if (!validTypes.includes(type)) {
        return json({ ok: false, error: 'Invalid type. Use: ' + validTypes.join(', ') }, 400);
      }
      const apiKey = env.POKEMONPRICE_API_KEY || env.POKEMON_PRICE_TRACKER_API_KEY;
      if (!apiKey) return json({ ok: false, error: 'POKEMONPRICE_API_KEY not configured' }, 501);

      // Pass E bypass still applies — check subscription unless demo/bypass
      const pptStoreId2 = request.headers.get('X-Store-Id') || '';
      const isDemo2 = !pptStoreId2 || pptStoreId2.startsWith('demo');
      const bypassIds2 = (env.BYPASS_STORE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      const ownerIds2 = (env.OWNER_STORE_IDS || env.OWNER_STORE_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!isDemo2 && !bypassIds2.includes(pptStoreId2) && !ownerIds2.includes(pptStoreId2) && env.LBA_KV) {
        const subRaw2 = await env.LBA_KV.get(`sub:store:${pptStoreId2}`);
        const sub2 = subRaw2 ? JSON.parse(subRaw2) : null;
        const s2 = sub2?.status || 'none';
        const endMs2 = s2 === 'trialing' ? sub2?.trial_end : sub2?.current_period_end;
        if (!((s2 === 'active' || s2 === 'trialing') && (!endMs2 || endMs2 > Date.now()))) {
          return json({ ok: false, error: 'Subscription required.', subscriptionRequired: true, status: s2 }, 402);
        }
      }

      let upRes;
      try {
        upRes = await fetch(`https://www.pokemonpricetracker.com/api/v2/export?type=${type}`, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'text/csv, application/gzip, */*' },
          redirect: 'follow',
        });
      } catch (e) {
        return json({ ok: false, error: 'Export request failed: ' + e.message }, 502);
      }

      if (upRes.status === 403) return json({ ok: false, error: 'Business plan required for bulk exports. Upgrade at pokemonpricetracker.com', businessRequired: true }, 403);
      if (upRes.status === 429) return json({ ok: false, error: 'Daily export limit reached (2 per day). Resets at 6:00 AM UTC.', limitReached: true }, 429);
      if (upRes.status === 503 || upRes.status === 404) return json({ ok: false, error: 'Export not yet available — dumps regenerate daily at 6:00 AM UTC.', notReady: true }, 503);
      if (!upRes.ok) return json({ ok: false, error: 'Export failed: HTTP ' + upRes.status }, upRes.status);

      const generatedAt = upRes.headers.get('x-generated-at') || upRes.headers.get('last-modified') || '';
      const downloadsRemaining = upRes.headers.get('x-downloads-remaining') || '';
      const resetAt = upRes.headers.get('x-reset-at') || '';
      const contentType = upRes.headers.get('content-type') || '';
      const contentEncoding = upRes.headers.get('content-encoding') || '';
      const isGzip = contentEncoding.includes('gzip') || contentType.includes('gzip') || upRes.url.endsWith('.gz');

      let csvText;
      try {
        if (isGzip) {
          const ds = new DecompressionStream('gzip');
          const decompressed = upRes.body.pipeThrough(ds);
          csvText = await new Response(decompressed).text();
        } else {
          csvText = await upRes.text();
        }
      } catch (e) {
        return json({ ok: false, error: 'Decompression failed: ' + e.message }, 500);
      }

      const rowCount = Math.max(0, csvText.split('\n').length - 2); // minus header + trailing newline
      return new Response(csvText, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'X-Generated-At': generatedAt,
          'X-Downloads-Remaining': downloadsRemaining,
          'X-Reset-At': resetAt,
          'X-Row-Count': String(rowCount),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-Generated-At,X-Downloads-Remaining,X-Reset-At,X-Row-Count',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (url.pathname.startsWith('/pricing/pokemonpricetracker/') || url.pathname.startsWith('/pricing/pokemon/')) {
      // Docs: docs/api/pokemon-price-tracker-openapi.json
      // Clean aliases: /pricing/pokemon/* → canonical /pricing/pokemonpricetracker/*
      const pptPath = url.pathname.startsWith('/pricing/pokemon/') && !url.pathname.startsWith('/pricing/pokemonpricetracker/')
        ? url.pathname.replace('/pricing/pokemon/', '/pricing/pokemonpricetracker/')
        : url.pathname;
      const key = env.POKEMONPRICE_API_KEY || env.POKEMON_PRICE_TRACKER_API_KEY;
      if (!key) return json({ ok: false, source: 'pokemonpricetracker', error: 'POKEMONPRICE_API_KEY not configured' }, 501);

      // Pass E: subscription gate + daily usage counter
      const pptStoreId = request.headers.get('X-Store-Id') || '';
      const isDemo = !pptStoreId || pptStoreId.startsWith('demo');
      const bypassIds = (env.BYPASS_STORE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
      const ownerIds = (env.OWNER_STORE_IDS || env.OWNER_STORE_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      const isBypassed = bypassIds.includes(pptStoreId) || ownerIds.includes(pptStoreId);
      if (!isDemo && !isBypassed && env.LBA_KV) {
        const subRaw = await env.LBA_KV.get(`sub:store:${pptStoreId}`);
        const sub = subRaw ? JSON.parse(subRaw) : null;
        const subStatus = sub?.status || 'none';
        const endMs = subStatus === 'trialing' ? sub?.trial_end : sub?.current_period_end;
        const subActive = (subStatus === 'active' || subStatus === 'trialing') && (!endMs || endMs > Date.now());
        if (!subActive) {
          return json({
            ok: false,
            source: 'pokemonpricetracker',
            error: 'Subscription required — start your free trial or subscribe to use Pokemon price lookups.',
            subscriptionRequired: true,
            status: subStatus,
          }, 402);
        }
        // Track daily PPT usage (non-blocking, best-effort)
        const day = new Date().toISOString().slice(0, 10);
        const usageKey = `usage:ppt:${pptStoreId}:${day}`;
        try {
          const prev = Number(await env.LBA_KV.get(usageKey) || '0');
          await env.LBA_KV.put(usageKey, String(prev + 1), { expirationTtl: 172800 }); // 48h TTL
        } catch (_) {}
      }

      const routeMap = {
        '/pricing/pokemonpricetracker/cards': { upstream:'/cards', method:'GET', requiredAny:['tcgPlayerId','cardId','search','setId','set','setName'] },
        '/pricing/pokemonpricetracker/sets': { upstream:'/sets', method:'GET', requiredAny:[] },
        '/pricing/pokemonpricetracker/sealed-products': { upstream:'/sealed-products', method:'GET', requiredAny:[] },
        '/pricing/pokemonpricetracker/parse-title': { upstream:'/parse-title', method:'POST', requiredAny:[] },
        '/pricing/pokemonpricetracker/population': { upstream:'/population', method:'GET', requiredAny:[] },
      };
      const spec = routeMap[pptPath];
      if (!spec) return json({ ok: false, source: 'pokemonpricetracker', error: 'Unknown PokemonPriceTracker route' }, 404);
      if (request.method !== spec.method) return json({ ok: false, source: 'pokemonpricetracker', error: spec.method + ' only' }, 405);
      const params = new URLSearchParams();
      const allowed = ['language', 'tcgPlayerId', 'cardId', 'setId', 'set', 'setName', 'search', 'rarity', 'cardType', 'artist', 'minPrice', 'maxPrice', 'printing', 'condition', 'includeHistory', 'includeEbay', 'includeBoth', 'includePopulation', 'days', 'maxDataPoints', 'fetchAllInSet', 'sortBy', 'sortOrder', 'limit', 'offset', 'name'];
      for (const name of allowed) {
        const value = url.searchParams.get(name);
        if (value != null && value !== '') params.set(name, value);
      }
      if (spec.requiredAny?.length && !spec.requiredAny.some(name => params.get(name))) {
        return json({ ok: false, source: 'pokemonpricetracker', error: spec.requiredAny.join(', ') + ' required' }, 400);
      }
      if (!params.get('language')) params.set('language', 'english');
      if (pptPath === '/pricing/pokemonpricetracker/cards') {
        const exactLookup = !!(params.get('tcgPlayerId') || params.get('cardId'));
        const isFetchAll = String(params.get('fetchAllInSet') || '').toLowerCase() === 'true';
        const isNameSearch = !!params.get('search') && !exactLookup && !isFetchAll;
        const requestedLimit = Number(params.get('limit') || (exactLookup ? 1 : isFetchAll ? 300 : isNameSearch ? 50 : 20));
        params.set('limit', String(exactLookup ? 1 : isFetchAll ? Math.min(500, requestedLimit || 300) : isNameSearch ? Math.min(50, Math.max(1, requestedLimit || 50)) : Math.min(20, Math.max(1, requestedLimit || 20))));
        if (String(params.get('fetchAllInSet') || '').toLowerCase() === 'true') {
          const hasSetFilter = !!(params.get('set') || params.get('setName') || params.get('setId'));
          if (!hasSetFilter) return json({ ok: false, source: 'pokemonpricetracker', error: 'fetchAllInSet requires set, setName, or setId param.' }, 400);
        }
      }
      const bodyText = spec.method === 'POST' ? await request.text() : '';
      const stableKeySource = spec.method + ':' + spec.upstream + '?' + [...params.entries()].sort((a,b) => a[0].localeCompare(b[0]) || String(a[1]).localeCompare(String(b[1]))).map(([k,v]) => k + '=' + v).join('&') + ':' + bodyText;
      const cacheKey = pptPath === '/pricing/pokemonpricetracker/cards' && (params.get('tcgPlayerId') || params.get('cardId'))
        ? 'pokemon:' + (params.get('tcgPlayerId') || params.get('cardId'))
        : pptPath === '/pricing/pokemonpricetracker/cards' && params.get('search')
        ? 'ppt_search:' + md5Hex(new TextEncoder().encode(String(params.get('language') || 'english').toLowerCase() + ':' + String(params.get('search') || '').trim().toLowerCase().replace(/\s+/g, ' ')))
        : pptPath === '/pricing/pokemonpricetracker/parse-title'
        ? 'ppt_parse:' + md5Hex(new TextEncoder().encode(String(bodyText || '').trim().toLowerCase().replace(/\s+/g, ' ')))
        : 'ppt_api_cache:' + btoa(stableKeySource).replace(/=+$/,'').slice(0, 180);
      if (env.LBA_KV && (spec.method === 'GET' || pptPath === '/pricing/pokemonpricetracker/parse-title') && url.searchParams.get('fresh') !== 'true') {
        const cached = await env.LBA_KV.get(cacheKey, 'json');
        if (cached) return json({ ...cached, cache:{ state:'hit', source:'worker-kv', cacheKey, cachedAt:cached.cache?.cachedAt || null } });
      }
      if (env.LBA_KV) {
        const quotaUntil = Number(await env.LBA_KV.get('ppt_quota_exhausted_until') || 0);
        if (quotaUntil && Date.now() < quotaUntil) {
          const stale = await env.LBA_KV.get(cacheKey, 'json').catch(() => null);
          if (stale) return json({ ...stale, providerQuotaState:'exhausted', retryAt:new Date(quotaUntil).toISOString(), cache:{ state:'stale', source:'worker-kv', cacheKey, cachedAt:stale.cache?.cachedAt || null } });
          return json({ ok: false, source: 'pokemonpricetracker', error: 'PokemonPriceTracker quota exhausted', providerStatus: 429, providerQuotaState: 'exhausted', retryAt: new Date(quotaUntil).toISOString() }, 429);
        }
      }
      const upstreamUrl = 'https://www.pokemonpricetracker.com/api/v2' + spec.upstream + (params.toString() ? '?' + params.toString() : '');
      const upstream = await fetch(upstreamUrl, {
        method: spec.method,
        headers: {
          'Authorization': 'Bearer ' + key,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: spec.method === 'POST' ? bodyText : undefined,
      });
      const text = await upstream.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; }
      const cards = Array.isArray(data?.data) ? data.data
        : (data?.data && typeof data.data === 'object') ? [data.data]
        : Array.isArray(data?.cards) ? data.cards
        : Array.isArray(data?.results) ? data.results
        : data?.card ? [data.card]
        : [];
      if (!upstream.ok) {
        const providerMessage = errorMessageFromApi(data, 'PokemonPriceTracker API ' + upstream.status);
        const quotaBlocked = upstream.status === 429 || (upstream.status === 403 && /429|quota|rate|blocked/i.test(providerMessage));
        if (quotaBlocked && env.LBA_KV) await env.LBA_KV.put('ppt_quota_exhausted_until', String(Date.now() + 60 * 60 * 1000), { expirationTtl: 60 * 60 });
        const stale = env.LBA_KV ? await env.LBA_KV.get(cacheKey, 'json').catch(() => null) : null;
        if (quotaBlocked && stale) {
          return json({ ...stale, providerQuotaState: 'exhausted', providerStatus: upstream.status, warning: providerMessage, cache:{ state:'stale', source:'worker-kv', cacheKey, cachedAt:stale.cache?.cachedAt || null } }, 200, pokemonQuotaHeaders(upstream.headers));
        }
        return json({
          ok: false,
          source: 'pokemonpricetracker',
          error: providerMessage,
          providerStatus: upstream.status,
          providerQuotaState: quotaBlocked ? 'exhausted' : 'available',
          detail: data,
          usage: {
            remaining: upstream.headers.get('X-RateLimit-Remaining') || upstream.headers.get('X-RateLimit-Daily-Remaining') || null,
            consumed: upstream.headers.get('X-API-Calls-Consumed') || null,
            breakdown: upstream.headers.get('X-API-Calls-Breakdown') || null,
          },
        }, [401, 403, 429].includes(upstream.status) ? upstream.status : 500, pokemonQuotaHeaders(upstream.headers));
      }
      const payload = {
        ok: true,
        source: 'pokemonpricetracker',
        route: spec.upstream,
        data: data?.data ?? data,
        cards,
        card: cards[0] || null,
        count: cards.length,
        usage: {
          remaining: upstream.headers.get('X-RateLimit-Remaining') || upstream.headers.get('X-RateLimit-Daily-Remaining') || null,
          consumed: upstream.headers.get('X-API-Calls-Consumed') || null,
          breakdown: upstream.headers.get('X-API-Calls-Breakdown') || null,
        },
        cache:{ state:'miss', source:'live', cacheKey, cachedAt:new Date().toISOString() },
      };
      if (env.LBA_KV && upstream.ok) await env.LBA_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 });
      return json(payload, 200, pokemonQuotaHeaders(upstream.headers));
    }

    // Universal TCG pricing proxy.
    // Optional secret: TCGAPI_KEY from https://tcgapi.dev
    // GET /pricing/tcg?q=&game=&set=&condition=&finish=&language=&sealed=true
    if (url.pathname === '/pricing/tcg') {
      const q = (url.searchParams.get('q') || '').trim();
      const game = (url.searchParams.get('game') || '').trim().toLowerCase();
      const setName = (url.searchParams.get('set') || '').trim().toLowerCase();
      const condition = (url.searchParams.get('condition') || 'NM').toUpperCase();
      const finishFilter = (url.searchParams.get('finish') || '').trim().toLowerCase();
      const languageFilter = (url.searchParams.get('language') || 'English').trim();
      const sealed = /^(1|true|yes)$/i.test(url.searchParams.get('sealed') || '');
      if (q.length < 2) return json({ ok: false, error: 'q required' }, 400);

      const condMult = { NM: 1, LP: 0.8, MP: 0.64, HP: 0.4, DMG: 0.25 };
      const conditions = ['NM', 'LP', 'MP', 'HP', 'DMG'];
      const conditionNames = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged' };
      const normalizeFinish = value => {
        const raw = String(value || 'normal').toLowerCase();
        if (/reverse/.test(raw)) return 'reverse_holo';
        if (/holo/.test(raw)) return 'holofoil';
        if (/etched/.test(raw)) return 'etched_foil';
        if (/surge/.test(raw)) return 'surge_foil';
        if (/textured/.test(raw)) return 'textured_foil';
        if (/serial/.test(raw)) return 'serialized';
        if (/foil/.test(raw)) return 'foil';
        if (/1st|first/.test(raw)) return 'first_edition';
        if (/unlimited/.test(raw)) return 'unlimited';
        return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'normal';
      };
      const pickPrice = p => Number(p?.marketPrice ?? p?.market_price ?? p?.market ?? p?.price ?? p?.midPrice ?? p?.median_price ?? p?.mid ?? p?.lowPrice ?? p?.low_price ?? p?.low ?? 0);
      const makeVariants = (priceMap, productId = '', productConditionIdPrefix = '') => {
        const entries = Array.isArray(priceMap)
          ? priceMap.map((p, i) => [p.printing || p.finish || p.sub_type || 'normal', p, i])
          : Object.entries(priceMap || {}).map(([k, p], i) => [k, p, i]);
        const variants = [];
        entries.forEach(([finishRaw, p, i]) => {
          const finish = normalizeFinish(finishRaw);
          const baseMarket = pickPrice(p);
          const low = Number(p?.lowPrice ?? p?.low_price ?? p?.low ?? p?.directLowPrice ?? p?.direct_low_price ?? 0) || null;
          const mid = Number(p?.midPrice ?? p?.median_price ?? p?.mid ?? p?.price ?? 0) || null;
          const high = Number(p?.highPrice ?? p?.high_price ?? p?.high ?? 0) || null;
          conditions.forEach(cond => {
            const skuId = p?.skuId || p?.sku_id || p?.id || `${productId || 'product'}-${finish}-${cond}`;
            const hasSkuMarket = Number(p?.[cond]?.marketPrice || p?.[cond]?.market || 0) > 0;
            const condMarket = hasSkuMarket ? Number(p[cond].marketPrice || p[cond].market) : null;
            const fallback = cond === 'NM' ? baseMarket : Math.round(baseMarket * (condMult[cond] || 1) * 100) / 100;
            variants.push({
              skuId: `${skuId}-${cond}`,
              productConditionId: p?.productConditionId || p?.product_condition_id || `${productConditionIdPrefix || productId || 'pc'}-${i}-${cond}`,
              condition: cond,
              conditionName: conditionNames[cond],
              finish,
              foilType: finish,
              language: languageFilter || 'English',
              printing: String(finishRaw || finish),
              marketPrice: condMarket,
              productLevelMarketPrice: baseMarket || null,
              estimatedMarketPrice: condMarket || (baseMarket ? fallback : null),
              lowPrice: low,
              midPrice: mid,
              highPrice: high,
              directLowPrice: Number(p?.directLowPrice ?? p?.direct_low_price ?? 0) || null,
              lowestListingPrice: Number(p?.lowestListingPrice ?? p?.lowest_listing_price ?? p?.low ?? 0) || null,
              lowestShipping: Number(p?.lowestShipping ?? p?.lowest_shipping ?? 0) || null,
              recentSoldPrice: Number(p?.recentSoldPrice ?? p?.recent_sold_price ?? 0) || null,
              lastUpdated: p?.lastUpdated || p?.last_updated || null,
              priceConfidence: condMarket ? 'high' : baseMarket ? (cond === 'NM' ? 'medium' : 'low') : 'unknown',
              priceSource: condMarket ? 'TCGplayer SKU Market' : baseMarket ? (cond === 'NM' ? 'Product-Level Estimate' : 'Estimated fallback') : 'Needs Research',
            });
          });
        });
        return variants.filter(v => !finishFilter || v.finish === finishFilter || String(v.printing || '').toLowerCase().includes(finishFilter));
      };
      const matchResponse = (match, variants, source, selectedVariant) => ({
        success: true,
        query: q,
        source,
        matches: [{
          productId: match.id || match.productId || match.tcgplayer_id || '',
          name: match.name || q,
          cleanName: match.clean_name || match.cleanName || match.name || q,
          groupId: match.group_id || match.groupId || '',
          groupName: match.group_name || match.set_name || match.set?.name || '',
          setName: match.set_name || match.set?.name || '',
          setCode: match.set_code || match.set?.id || '',
          cardNumber: match.number || match.cardNumber || '',
          rarity: match.rarity || '',
          productLine: match.product_line || match.supertype || game || '',
          categoryName: match.category_name || game || '',
          imageUrl: match.image_url || match.images?.small || match.images?.large || '',
          productUrl: match.url || match.tcgplayer?.url || '',
          confidenceScore: 80,
          matchReasons: ['pricing proxy match'],
          availableVariants: variants,
          extraInfo: {
            productLine: match.product_line || match.supertype || '',
            categoryName: match.category_name || game || '',
            manaCost: match.mana_cost || '',
            typeLine: match.type_line || '',
            oracleText: match.oracle_text || '',
            artist: match.artist || '',
            releaseDate: match.releaseDate || match.set?.releaseDate || '',
          }
        }],
        selectedVariant,
        errors: []
      });
      const gameSlug = (() => {
        if (/magic|mtg/.test(game)) return 'magic-the-gathering';
        if (/yu|yugioh|yu-gi-oh/.test(game)) return 'yu-gi-oh';
        if (/pokemon|pokémon/.test(game)) return 'pokemon';
        if (/one piece/.test(game)) return 'one-piece-card-game';
        if (/lorcana/.test(game)) return 'lorcana';
        return game.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      })();

      if (env.TCGAPI_KEY) {
        try {
          const params = new URLSearchParams({ q, per_page: '20', sort: 'relevance' });
          if (gameSlug) params.set('game', gameSlug);
          if (sealed) params.set('type', 'Sealed Products');
          const apiRes = await fetch(`https://api.tcgapi.dev/v1/search?${params.toString()}`, {
            headers: { 'X-API-Key': env.TCGAPI_KEY, 'Accept': 'application/json' },
          });
          const data = await apiRes.json().catch(() => ({}));
          if (!apiRes.ok) return json({ ok: false, source: 'tcgapi', error: errorMessageFromApi(data, 'TCG API error'), detail: data }, apiRes.status);
          const rows = data.data || [];
          const best = rows
            .map(card => {
              let score = 0;
              const hay = [card.name, card.clean_name, card.set_name, card.number].filter(Boolean).join(' ').toLowerCase();
              const qq = q.toLowerCase();
              if (hay.includes(qq)) score += 20;
              if (setName && String(card.set_name || '').toLowerCase().includes(setName)) score += 20;
              if (sealed && /sealed/i.test(card.product_type || '')) score += 20;
              if (card.market_price || card.price || card.low_price) score += 10;
              return { card, score };
            })
            .sort((a, b) => b.score - a.score)[0]?.card;
          if (!best) return json({ ok: false, source: 'tcgapi', error: 'No match', matches: [] }, 404);
          const priceRows = Array.isArray(best.prices) ? best.prices : [];
          const normalPrice = priceRows.find(p => /normal|regular|standard/i.test(p.printing || '')) || priceRows[0] || {};
          const nm = Number(
            best.market_price ||
            best.price ||
            best.median_price ||
            best.low_price ||
            normalPrice.market_price ||
            normalPrice.price ||
            normalPrice.median_price ||
            normalPrice.low_price ||
            0
          );
          const variants = makeVariants(priceRows.length ? priceRows : [{ printing:'normal', market_price:nm }], best.id || best.productId || '', best.product_condition_id || '');
          const selectedVariant = variants.find(v => v.condition === condition && (!finishFilter || v.finish === finishFilter)) || variants.find(v => v.condition === condition) || variants[0] || null;
          const price = Number(selectedVariant?.marketPrice || selectedVariant?.estimatedMarketPrice || selectedVariant?.productLevelMarketPrice || 0);
          return json({
            ok: true,
            ...matchResponse(best, variants, 'tcgapi', selectedVariant),
            source: 'tcgapi',
            match: best,
            price,
            condition,
            nmMarket: nm,
            rawMatches: rows.slice(0, 8),
          });
        } catch (e) {
          return json({ ok: false, source: 'tcgapi', error: e.message }, 500);
        }
      }

      if (/pokemon|pokémon/.test(game)) {
        try {
          const pokemonHeaders = env.POKEMONTCG_API_KEY ? { 'X-Api-Key': env.POKEMONTCG_API_KEY } : {};
          const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent('name:"' + q + '"')}&pageSize=10`, {
            headers: pokemonHeaders,
          });
          if (!r.ok) {
            const err = await r.text();
            return json({ ok: false, source: 'pokemontcg', error: 'PokemonTCG API ' + r.status, detail: err.slice(0, 200) }, r.status);
          }
          const d = await r.json();
          const card = d.data?.[0];
          const prices = card?.tcgplayer?.prices || {};
          const nm = Object.values(prices).find(p => p?.market > 0 || p?.mid > 0)?.market || Object.values(prices).find(p => p?.mid > 0)?.mid || 0;
          if (!card || !nm) return json({ ok: false, source: 'pokemontcg', error: 'No price match' }, 404);
          const variants = makeVariants(prices, card.id || '', card.id || '');
          const selectedVariant = variants.find(v => v.condition === condition && (!finishFilter || v.finish === finishFilter)) || variants.find(v => v.condition === condition) || variants[0] || null;
          return json({
            ok: true,
            ...matchResponse(card, variants, 'pokemontcg', selectedVariant),
            source: 'pokemontcg',
            match: card,
            price: Number(selectedVariant?.marketPrice || selectedVariant?.estimatedMarketPrice || selectedVariant?.productLevelMarketPrice || 0),
            condition,
            nmMarket: nm,
            rawMatches: d.data || []
          });
        } catch (e) {
          return json({ ok: false, source: 'pokemontcg', error: e.message }, 500);
        }
      }

      return json({
        ok: false,
        needsKey: true,
        source: 'none',
        error: 'TCGAPI_KEY not set. Add a free key from https://tcgapi.dev for MTG, Yu-Gi-Oh, Lorcana, One Piece, sealed products, and other TCG prices.',
      }, 501);
    }

    const PSA_BASE = 'https://api.psacard.com/publicapi';

    if (url.pathname.startsWith('/psa/')) {
      if (!env.PSA_TOKEN) return json({ error: 'PSA_TOKEN not set in Worker secrets', hint: 'Add it in Cloudflare Worker variables' }, 500);

      const certMatch = url.pathname.match(/^\/psa\/cert\/(\d+)$/);
      if (certMatch) {
        const certNumber = certMatch[1];
        try {
          const psaRes = await fetch(`${PSA_BASE}/cert/GetByCertNumber/${certNumber}`, {
            headers: { 'Authorization': 'Bearer ' + env.PSA_TOKEN, 'Accept': 'application/json' },
          });

          if (!psaRes.ok) {
            const errText = await psaRes.text();
            return json({ error: 'PSA API error ' + psaRes.status, detail: errText.substring(0, 200) }, psaRes.status);
          }

          const data = await psaRes.json();
          const cert = data?.PSACert || data;

          return json({
            ok: true,
            cert: {
              certNumber: cert.CertNumber || certNumber,
              subject: cert.Subject || null,
              year: cert.Year || null,
              brand: cert.Brand || null,
              series: cert.Series || null,
              cardNumber: cert.CardNumber || cert.SpecNumber || null,
              variety: cert.Variety || null,
              grade: cert.Grade || null,
              gradeDesc: cert.GradeDescription || null,
              totalPop: cert.TotalPopulation || 0,
              popHigher: cert.PopHigher || 0,
              isDualCert: cert.IsDualCert || false,
              isAuthentic: cert.IsAuthentic || false,
              psaSetId: cert.PSASetID || null,
              specId: cert.SpecID || null,
              photoUrl: cert.PhotoURL || null,
              labelType: cert.LabelType || null,
            },
          });
        } catch (e) {
          return json({ error: e.message }, 500);
        }
      }

      const popMatch = url.pathname.match(/^\/psa\/pop\/(\d+)$/);
      if (popMatch) {
        const specSetId = popMatch[1];
        try {
          const psaRes = await fetch(`${PSA_BASE}/pop/GetPopulationReport/${specSetId}`, {
            headers: { 'Authorization': 'Bearer ' + env.PSA_TOKEN, 'Accept': 'application/json' },
          });
          if (!psaRes.ok) return json({ error: 'PSA pop error ' + psaRes.status }, psaRes.status);
          const data = await psaRes.json();
          return json({ ok: true, pop: data });
        } catch (e) {
          return json({ error: e.message }, 500);
        }
      }

      return json({ error: 'Unknown PSA route. Use /psa/cert/:certNumber or /psa/pop/:specSetId' }, 404);
    }

    if (url.pathname === '/comic/variants') {
      const title = url.searchParams.get('title') || '';
      const issue = url.searchParams.get('issue') || '';
      const year = url.searchParams.get('year') || '';
      if (!title) return json({ variants: [] });
      if (!env.COMICVINE_API_KEY) return json({ variants: [], error: 'COMICVINE_API_KEY not configured' });

      try {
        const volRes = await fetch(
          `https://comicvine.gamespot.com/api/volumes/?api_key=${env.COMICVINE_API_KEY}&format=json` +
          `&filter=name:${encodeURIComponent(title)}&field_list=id,name,publisher,image,start_year&limit=10`,
          { headers: { 'User-Agent': 'LBAScanner/1.0' } }
        );
        if (!volRes.ok) return json({ variants: [], error: 'CV volumes ' + volRes.status });
        const volData = await volRes.json();
        let volumes = volData.results || [];
        if (!volumes.length) return json({ variants: [] });

        if (year) {
          const targetYear = parseInt(year, 10);
          volumes = volumes.sort((a, b) => {
            const da = Math.abs((parseInt(a.start_year, 10) || 0) - targetYear);
            const db = Math.abs((parseInt(b.start_year, 10) || 0) - targetYear);
            return da - db;
          });
        }

        const variants = [];
        for (const vol of volumes.slice(0, 5)) {
          const issFilter = issue ? `,issue_number:${issue}` : '';
          const issRes = await fetch(
            `https://comicvine.gamespot.com/api/issues/?api_key=${env.COMICVINE_API_KEY}&format=json` +
            `&filter=volume:${vol.id}${issFilter}` +
            `&field_list=id,name,issue_number,image,cover_date,volume,description&limit=20`,
            { headers: { 'User-Agent': 'LBAScanner/1.0' } }
          );
          if (!issRes.ok) continue;
          const issData = await issRes.json();
          for (const iss of (issData.results || [])) {
            const issYear = iss.cover_date ? iss.cover_date.slice(0, 4) : (vol.start_year || '');
            variants.push({
              id: iss.id,
              title: iss.name || title,
              issue_number: iss.issue_number,
              volume: iss.volume?.name || vol.name,
              volume_id: vol.id,
              publisher: vol.publisher?.name || '',
              cover_image: iss.image?.super_url || iss.image?.medium_url || null,
              cover_date: iss.cover_date || null,
              year: issYear,
              description: iss.description ? iss.description.replace(/<[^>]+>/g, '').slice(0, 200) : null,
            });
          }
        }

        if (year) {
          variants.sort((a, b) => {
            const da = Math.abs((parseInt(a.year, 10) || 0) - parseInt(year, 10));
            const db = Math.abs((parseInt(b.year, 10) || 0) - parseInt(year, 10));
            return da - db;
          });
        }

        return json({ ok: true, variants });
      } catch (e) {
        return json({ variants: [], error: e.message });
      }
    }

    if (url.pathname === '/comps/sold') {
      const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim();
      const limit = Number(url.searchParams.get('limit') || 40);
      const mode = (url.searchParams.get('mode') || '').toLowerCase();
      if (!q) return json({ ok: false, error: 'q required' }, 400);
      try {
        let result = await fetchSoldCompsProvider(env, q, Math.max(limit * 2, 40));
        const warnings = [];
        if (result.warning) warnings.push(result.warning);
        if (!result.comps.length) {
          const ebay = await fetchEbaySoldComps(env, q, Math.max(limit * 2, 40));
          if (ebay.warning) warnings.push(ebay.warning);
          if (ebay.comps.length) result = ebay;
        }
        const filtered = filterSoldComps(result.comps, q, mode);
        const comps = filtered
          .filter(c => Number(c.total || c.price || 0) > 0)
          .sort((a, b) => (Date.parse(b.soldAt || '') || 0) - (Date.parse(a.soldAt || '') || 0))
          .slice(0, Math.min(100, Math.max(10, limit)));
        const ebayAppAvailable = !!(env.EBAY_APP_ID || await getStoredSecret(env, 'EBAY_CLIENT_ID'));
        return json({
          ok: true,
          query: q,
          mode,
          source: comps.length ? result.source : 'none',
          comps,
          stats: soldCompStats(comps),
          buckets: soldCompBuckets(comps),
          filteredOut: Math.max(0, result.comps.length - filtered.length),
          warnings: [...new Set(warnings.filter(Boolean))].slice(0, 3),
          needsProvider: !env.SOLDCOMPS_API_KEY && !ebayAppAvailable,
        });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === '/graded/pricing') {
      const q = (url.searchParams.get('q') || '').trim();
      const category = (url.searchParams.get('category') || '').toLowerCase();
      const tcgPlayerId = (url.searchParams.get('tcgPlayerId') || '').trim();
      if (!q) return json({ ok: false, error: 'q required' }, 400);

      const median = values => {
        const a = values.filter(v => Number(v) > 0).sort((x, y) => x - y);
        if (!a.length) return 0;
        const mid = Math.floor(a.length / 2);
        return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
      };

      const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
      const searches = [
        { key: 'raw', label: 'Raw sold', query: clean(`${q} ungraded raw`) },
        { key: 'psa9', label: 'PSA 9 sold', query: clean(`${q} PSA 9`) },
        { key: 'psa10', label: 'PSA 10 sold', query: clean(`${q} PSA 10`) },
        { key: 'bgs95', label: 'BGS 9.5 sold', query: clean(`${q} BGS 9.5`) },
        { key: 'cgc10', label: 'CGC 10 sold', query: clean(`${q} CGC 10`) },
      ];

      function moneyValue(v) {
        if (typeof v === 'number') return v > 0 ? v : 0;
        if (typeof v === 'string') {
          const n = Number(v.replace(/[$,]/g, ''));
          return n > 0 ? n : 0;
        }
        if (!v || typeof v !== 'object') return 0;
        for (const key of ['market', 'marketPrice', 'price', 'value', 'avg', 'average', 'median', 'lastSold', 'last_sale', 'lastSale']) {
          const n = moneyValue(v[key]);
          if (n) return n;
        }
        return 0;
      }

      function recursivePrice(obj, company, grade) {
        if (!obj || typeof obj !== 'object') return 0;
        const targetGrade = String(grade).replace('.', '');
        const descriptor = [
          obj.grade,
          obj.condition,
          obj.grader,
          obj.gradingCompany,
          obj.company,
          obj.title,
          obj.label,
        ].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9.]/g, '');
        if (descriptor.includes(company.toLowerCase()) && descriptor.includes(targetGrade)) {
          const direct = moneyValue(obj);
          if (direct) return direct;
        }
        const companyKeys = [company, company.toUpperCase(), company.toLowerCase()];
        for (const ck of companyKeys) {
          const branch = obj[ck];
          if (branch && typeof branch === 'object') {
            const direct = moneyValue(branch[String(grade)] || branch['grade_' + String(grade).replace('.', '_')]);
            if (direct) return direct;
          }
        }
        for (const [key, value] of Object.entries(obj)) {
          const normalized = key.toLowerCase().replace(/[^a-z0-9.]/g, '');
          if (normalized.includes(company.toLowerCase()) && normalized.includes(targetGrade)) {
            const direct = moneyValue(value);
            if (direct) return direct;
          }
          if (value && typeof value === 'object') {
            const nested = recursivePrice(value, company, grade);
            if (nested) return nested;
          }
        }
        return 0;
      }

      function recursivePopulation(obj, company, grade) {
        if (!obj || typeof obj !== 'object') return 0;
        const targetGrade = String(grade).replace('.', '');
        const descriptor = [
          obj.grade,
          obj.condition,
          obj.grader,
          obj.gradingCompany,
          obj.company,
          obj.title,
          obj.label,
        ].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9.]/g, '');
        if (descriptor.includes(company.toLowerCase()) && descriptor.includes(targetGrade)) {
          const n = Number(obj.population || obj.pop || obj.totalPop || obj.count);
          if (n > 0) return n;
        }
        for (const [key, value] of Object.entries(obj)) {
          const normalized = key.toLowerCase().replace(/[^a-z0-9.]/g, '');
          if (normalized.includes(company.toLowerCase()) && normalized.includes(targetGrade) && /pop|population/.test(normalized)) {
            const n = Number(value);
            if (n > 0) return n;
          }
          if (value && typeof value === 'object') {
            const nested = recursivePopulation(value, company, grade);
            if (nested) return nested;
          }
        }
        return 0;
      }

      async function pokemonPriceTracker() {
        const key = env.POKEMONPRICE_API_KEY || env.POKEMON_PRICE_TRACKER_API_KEY;
        const isPokemon = !category || /pokemon|tcg/.test(category) || /pokemon/i.test(q) || tcgPlayerId;
        if (!key || !isPokemon) return null;

        const params = new URLSearchParams({
          limit: /^\d+$/.test(tcgPlayerId) ? '1' : '5',
          includeEbay: 'true',
          days: '7',
        });
        if (/^\d+$/.test(tcgPlayerId)) params.set('tcgPlayerId', tcgPlayerId);
        else params.set('search', q);

        async function callPpt(requestParams) {
          const res = await fetch(new URL('/pricing/pokemonpricetracker/cards?' + requestParams.toString(), url.origin), { headers: request.headers });
          const raw = await res.text();
          let data;
          try { data = JSON.parse(raw); } catch (e) { data = { raw: raw.slice(0, 300) }; }
          return {
            res,
            data,
            remaining: res.headers.get('X-RateLimit-Daily-Remaining') || null,
            consumed: res.headers.get('X-API-Calls-Consumed') || null,
          };
        }

        let { res: pptRes, data, remaining, consumed } = await callPpt(params);
        const providerWarnings = [];
        if (!pptRes.ok && [400, 402, 403].includes(pptRes.status) && params.get('includeEbay') === 'true') {
          providerWarnings.push('PokemonPriceTracker graded/eBay data unavailable on this key or request; showing basic card data if available');
          params.delete('includeEbay');
          params.delete('days');
          ({ res: pptRes, data, remaining, consumed } = await callPpt(params));
        }
        if (!pptRes.ok) {
          const msg = errorMessageFromApi(data, 'PokemonPriceTracker API ' + pptRes.status);
          return { ok: false, source: 'pokemonpricetracker', warnings: ['PokemonPriceTracker API ' + pptRes.status + ': ' + msg], providerDetail: data, remaining, consumed };
        }

        const cards = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.cards) ? data.cards : []);
        const card = cards[0] || data?.data || data?.card || null;
        if (!card || Array.isArray(card)) {
          return { ok: false, source: 'pokemonpricetracker', warnings: ['PokemonPriceTracker found no matching Pokemon card'], remaining, consumed };
        }

        const rawPrice = moneyValue(card.prices?.market || card.prices || card.tcgplayer || card.rawPrice || card.marketPrice);
        const mapped = [
          { key: 'raw', label: 'Raw market', value: rawPrice, pop: 0 },
          { key: 'psa8', label: 'PSA 8 value', value: recursivePrice(card, 'psa', 8), pop: recursivePopulation(card, 'psa', 8) },
          { key: 'psa9', label: 'PSA 9 value', value: recursivePrice(card, 'psa', 9), pop: recursivePopulation(card, 'psa', 9) },
          { key: 'psa10', label: 'PSA 10 value', value: recursivePrice(card, 'psa', 10), pop: recursivePopulation(card, 'psa', 10) },
          { key: 'bgs95', label: 'BGS 9.5 value', value: recursivePrice(card, 'bgs', 9.5), pop: recursivePopulation(card, 'bgs', 9.5) },
          { key: 'cgc10', label: 'CGC 10 value', value: recursivePrice(card, 'cgc', 10), pop: recursivePopulation(card, 'cgc', 10) },
        ];
        const comps = mapped.map(c => ({
          key: c.key,
          label: c.label,
          query: q,
          source: 'pokemonpricetracker',
          count: c.pop || 0,
          averagePrice: Math.round((c.value || 0) * 100) / 100,
          medianPrice: Math.round((c.value || 0) * 100) / 100,
          population: c.pop || 0,
          recentPrices: [],
          error: null,
        }));
        const hasAnyPrice = comps.some(c => c.medianPrice > 0);
        const hasGradedPrice = comps.some(c => c.key !== 'raw' && c.medianPrice > 0);
        return {
          ok: hasAnyPrice,
          source: 'pokemonpricetracker',
          comps,
          card: {
            name: card.name || card.card || q,
            setName: card.setName || card.set?.name || card.set || null,
            cardNumber: card.cardNumber || card.number || null,
            image: card.image?.large || card.image?.small || card.images?.large || card.images?.small || null,
          },
          warnings: providerWarnings.concat(hasGradedPrice ? [] : ['PokemonPriceTracker returned raw pricing but no graded values for this card/key']),
          remaining,
          consumed,
        };
      }

      const pokemonResult = await pokemonPriceTracker();
      if (pokemonResult) {
        return json({
          ok: true,
          query: q,
          source: 'pokemonpricetracker',
          comps: pokemonResult.comps || [],
          card: pokemonResult.card || null,
          warnings: pokemonResult.warnings || [],
          needsEbayAuth: false,
          needsEbay: false,
          usage: { remaining: pokemonResult.remaining || null, consumed: pokemonResult.consumed || null },
        });
      }

      async function completedPrices(query) {
        const sc = await fetchSoldCompsProvider(env, query, 50);
        if (sc.comps?.length) {
          const mode = /\b(raw|ungraded)\b/i.test(query) ? 'raw' : 'graded';
          const filtered = filterSoldComps(sc.comps, query, mode);
          const prices = filtered.map(c => Number(c.total || c.price || 0)).filter(p => p > 0);
          return { source: 'soldcomps', prices, filteredOut: Math.max(0, sc.comps.length - filtered.length) };
        }
        if (!env.EBAY_APP_ID) return { source: 'none', prices: [] };
        const findRes = await fetch(
          `https://svcs.ebay.com/services/search/FindingService/v1` +
          `?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.0.0` +
          `&SECURITY-APPNAME=${env.EBAY_APP_ID}&RESPONSE-DATA-FORMAT=JSON&REST-PAYLOAD` +
          `&GLOBAL-ID=EBAY-US` +
          `&keywords=${encodeURIComponent(query)}` +
          `&itemFilter%280%29.name=SoldItemsOnly&itemFilter%280%29.value=true` +
          `&sortOrder=EndTimeSoonest&paginationInput.entriesPerPage=25`
        );
        if (!findRes.ok) return { source: 'ebay_sold', prices: [], error: 'Finding API ' + findRes.status };
        const fd = await findRes.json();
        const root = fd.findCompletedItemsResponse?.[0] || {};
        const ack = root.ack?.[0] || '';
        const errMsg = root.errorMessage?.[0]?.error?.[0]?.message?.[0] || '';
        if (ack && !['Success', 'Warning'].includes(ack)) {
          return { source: 'ebay_sold', prices: [], error: 'Finding API ' + (errMsg || ack) };
        }
        const items = fd.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
        const prices = items
          .map(i => Number(i.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || 0))
          .filter(p => p > 0);
        return { source: 'ebay_sold', prices: filterSoldComps(items.map(i => normalizeSoldComp(i, 'ebay_sold')).filter(Boolean), query, /\b(raw|ungraded)\b/i.test(query) ? 'raw' : 'graded').map(c => Number(c.total || c.price || 0)).filter(p => p > 0) };
      }

      async function activePrices(query) {
        if (!env.EBAY_USER_TOKEN) return { source: 'none', prices: [] };
        const browseRes = await fetch(
          `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=25&sort=price`,
          { headers: {
            'Authorization': 'Bearer ' + env.EBAY_USER_TOKEN,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            'Content-Type': 'application/json',
          } }
        );
        if (!browseRes.ok) return { source: 'ebay_active', prices: [], error: 'Browse API ' + browseRes.status };
        const bd = await browseRes.json();
        const prices = (bd.itemSummaries || [])
          .map(i => Number(i.price?.value || 0))
          .filter(p => p > 0);
        return { source: 'ebay_active', prices };
      }

      const comps = [];
      for (const s of searches) {
        let result = await completedPrices(s.query);
        if (!result.prices.length) result = await activePrices(s.query);
        const avg = result.prices.length ? result.prices.reduce((a, b) => a + b, 0) / result.prices.length : 0;
        comps.push({
          ...s,
          source: result.source,
          count: result.prices.length,
          averagePrice: Math.round(avg * 100) / 100,
          medianPrice: Math.round(median(result.prices) * 100) / 100,
          recentPrices: result.prices.slice(0, 8),
          error: result.error || null,
        });
      }

      const warnings = [...new Set(comps.map(c => c.error).filter(Boolean))];
      return json({
        ok: true,
        query: q,
        source: env.EBAY_APP_ID ? 'ebay_sold' : (env.EBAY_USER_TOKEN ? 'ebay_active' : 'none'),
        comps,
        warnings,
        needsEbayAuth: warnings.some(w => /401|authorization|access token|invalid/i.test(w)),
        needsEbay: !env.EBAY_APP_ID && !env.EBAY_USER_TOKEN,
      });
    }

    if (url.pathname === '/comic/pricing') {
      const title = url.searchParams.get('title') || '';
      const issue = url.searchParams.get('issue') || '';
      if (!title) return json({ averagePrice: 0, recentPrices: [] });

      const q = encodeURIComponent(`${title}${issue ? ' #' + issue : ''} comic`);

      try {
        if (env.EBAY_APP_ID) {
          const findRes = await fetch(
            `https://svcs.ebay.com/services/search/FindingService/v1` +
            `?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.0.0` +
            `&SECURITY-APPNAME=${env.EBAY_APP_ID}&RESPONSE-DATA-FORMAT=JSON&REST-PAYLOAD` +
            `&keywords=${q}` +
            `&itemFilter%280%29.name=SoldItemsOnly&itemFilter%280%29.value=true` +
            `&categoryId=63&sortOrder=EndTimeSoonest&paginationInput.entriesPerPage=20`
          );
          if (findRes.ok) {
            const fd = await findRes.json();
            const items = fd.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
            const prices = items
              .map(i => parseFloat(i.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || '0'))
              .filter(p => p > 0);
            if (prices.length) {
              const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
              return json({ ok: true, averagePrice: Math.round(avg * 100) / 100, recentPrices: prices.slice(0, 10), source: 'ebay_sold' });
            }
          }
        }

        if (env.EBAY_USER_TOKEN) {
          const browseRes = await fetch(
            `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${q}&limit=20&sort=PRICE_ASC`,
            { headers: {
              'Authorization': 'Bearer ' + env.EBAY_USER_TOKEN,
              'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
              'Content-Type': 'application/json',
            } }
          );
          if (browseRes.ok) {
            const bd = await browseRes.json();
            const prices = (bd.itemSummaries || [])
              .map(i => parseFloat(i.price?.value || '0'))
              .filter(p => p > 0);
            if (prices.length) {
              const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
              return json({ ok: true, averagePrice: Math.round(avg * 100) / 100, recentPrices: prices.slice(0, 10), source: 'ebay_active' });
            }
          }
        }

        return json({ averagePrice: 0, recentPrices: [], source: 'none' });
      } catch (e) {
        return json({ averagePrice: 0, recentPrices: [], error: e.message });
      }
    }

    // ── TOPPS ROUTES ──────────────────────────────────────────────────────────
    if (url.pathname.startsWith('/topps/')) {
      const kv = env.LBA_KV;

      // GET /topps/catalog — hardcoded catalog merged with import status
      if (url.pathname === '/topps/catalog' && request.method === 'GET') {
        const idxRaw = kv ? await kv.get('sets_index') : null;
        const importedMap = {};
        (idxRaw ? JSON.parse(idxRaw) : []).forEach(s => { importedMap[s.slug] = s; });
        const catalog = TOPPS_CATALOG.map(s => ({
          ...s,
          imported: !!importedMap[s.slug],
          _meta: importedMap[s.slug] || null,
        }));
        return json({ ok: true, catalog });
      }

      // GET /topps/test-import?n=5 — dry-run import N sets, return quality report (no KV writes)
      if (url.pathname === '/topps/test-import' && request.method === 'GET') {
        const n = Math.min(parseInt(url.searchParams.get('n') || '5', 10), 10);
        const slugFilter = url.searchParams.get('slug'); // test a specific slug
        const TEST_SETS = slugFilter
          ? TOPPS_CATALOG.filter(s => s.slug === slugFilter)
          : [
              TOPPS_CATALOG.find(s => s.slug === '2025-topps-chrome-baseball'),
              TOPPS_CATALOG.find(s => s.slug === '2025-topps-series-1-baseball'),
              TOPPS_CATALOG.find(s => s.slug === '2025-bowman-baseball'),
              TOPPS_CATALOG.find(s => s.slug === '2025-26-topps-chrome-basketball'),
              TOPPS_CATALOG.find(s => s.slug === '2025-topps-chrome-football'),
            ].filter(Boolean).slice(0, n);

        const results = [];
        for (const entry of TEST_SETS) {
          const urlsToTry = [
            entry.beckettUrl,
            `https://www.beckett.com/news/${entry.slug}-cards/`,
            `https://www.beckett.com/news/${entry.slug}-checklist/`,
          ].filter(Boolean);

          let parsed = null;
          let usedUrl = null;
          let fetchError = null;
          for (const tryUrl of urlsToTry) {
            const fetchRes = await fetch(tryUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.beckett.com/',
              },
              redirect: 'follow',
            }).catch(e => { fetchError = e.message; return null; });

            if (!fetchRes || !fetchRes.ok) {
              fetchError = fetchRes ? `HTTP ${fetchRes.status}` : fetchError;
              continue;
            }
            const html = await fetchRes.text();
            parsed = parseBeckettChecklist(html, entry.slug, entry.name, entry.sport, entry.year);
            if (parsed && (parsed.base_set?.cards?.length > 0 || parsed.insert_sets?.length > 0)) {
              usedUrl = tryUrl;
              break;
            }
          }

          const baseCards = parsed?.base_set?.cards || [];
          const insertSets = parsed?.insert_sets || [];
          const autoSets = parsed?.autograph_sets || [];
          const memSets = parsed?.memorabilia_sets || [];

          results.push({
            slug: entry.slug,
            name: entry.name,
            sport: entry.sport,
            year: entry.year,
            ok: !!usedUrl,
            source: usedUrl,
            error: usedUrl ? null : (fetchError || 'Parser found 0 cards'),
            counts: {
              base: baseCards.length,
              insertSets: insertSets.length,
              autoSets: autoSets.length,
              memSets: memSets.length,
              parallels: parsed?.parallels?.length || 0,
            },
            // Sample data for quality check
            sampleBase: baseCards.slice(0, 5).map(c => `#${c.number} ${c.player} (${c.team || '?'})${c.rc ? ' RC' : ''}`),
            insertSetNames: insertSets.map(s => `${s.name} (${s.cards?.length || 0} cards)`),
            autoSetNames: autoSets.map(s => `${s.name} (${s.cards?.length || 0} cards)`),
            parallels: parsed?.parallels?.slice(0, 8) || [],
          });
        }

        const passing = results.filter(r => r.ok && (r.counts.base > 0 || r.counts.insertSets > 0 || r.counts.autoSets > 0));
        return json({
          ok: true,
          tested: results.length,
          passing: passing.length,
          failing: results.length - passing.length,
          readyToScale: passing.length === results.length,
          results,
        });
      }


      if (url.pathname === '/topps/debug-pdf' && request.method === 'GET') {
        const pdfUrl = url.searchParams.get('url');
        if (!pdfUrl) return json({ error: 'url param required' }, 400);
        const res = await fetch(pdfUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.topps.com/',
            'Accept': 'application/pdf,*/*',
          },
        }).catch(e => null);
        if (!res) return json({ error: 'Fetch failed' }, 502);
        const ct = res.headers.get('content-type') || '';
        const finalUrl = res.url;
        const status = res.status;
        if (!ct.includes('pdf') && !pdfUrl.toLowerCase().includes('.pdf')) {
          const html = await res.text();
          // Look for PDF links
          const pdfLinks = [];
          const linkRe = /href="([^"]*\.pdf[^"]*)"/gi;
          let m;
          while ((m = linkRe.exec(html)) !== null) pdfLinks.push(m[1]);
          return json({ ok: false, status, contentType: ct, finalUrl, htmlLength: html.length, pdfLinks, htmlSnippet: html.slice(0, 2000) });
        }
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        // Check PDF header
        let header = '';
        for (let i = 0; i < Math.min(20, bytes.length); i++) header += String.fromCharCode(bytes[i]);
        // Try text extraction
        let extractedText = '';
        try { extractedText = await extractPdfText(buf); } catch(e) { extractedText = 'ERROR: ' + e.message; }
        return json({
          ok: true, status, contentType: ct, finalUrl,
          pdfSize: buf.byteLength,
          pdfHeader: header,
          extractedLength: extractedText.length,
          extractedSample: extractedText.slice(0, 3000),
        });
      }

      // GET /topps/fetch-catalog — scrape topps.com/pages/checklists for live set list
      if (url.pathname === '/topps/fetch-catalog' && request.method === 'GET') {
        const idxRaw = kv ? await kv.get('sets_index') : null;
        const importedMap = {};
        (idxRaw ? JSON.parse(idxRaw) : []).forEach(s => { importedMap[s.slug] = s; });

        // Try live scrape first
        let liveSets = await fetchToppsChecklistCatalog();

        // Merge with hardcoded catalog (hardcoded has better metadata)
        const hardcodedMap = {};
        TOPPS_CATALOG.forEach(s => { hardcodedMap[s.slug] = s; });

        // Build unified list: live sets + hardcoded sets not in live list
        const merged = [];
        const seenSlugs = new Set();

        if (liveSets && liveSets.length > 0) {
          for (const ls of liveSets) {
            const hc = hardcodedMap[ls.slug];
            const entry = hc ? { ...hc, url: ls.url } : ls;
            entry.imported = !!importedMap[ls.slug];
            entry._meta = importedMap[ls.slug] || null;
            merged.push(entry);
            seenSlugs.add(ls.slug);
          }
        }
        // Add hardcoded sets not found in live page
        for (const hc of TOPPS_CATALOG) {
          if (!seenSlugs.has(hc.slug)) {
            merged.push({ ...hc, imported: !!importedMap[hc.slug], _meta: importedMap[hc.slug] || null });
          }
        }

        return json({ ok: true, catalog: merged, source: liveSets ? 'live' : 'hardcoded' });
      }

      // POST /topps/import-checklist — import a set using Beckett HTML (preferred) or PDF
      if (url.pathname === '/topps/import-checklist' && request.method === 'POST') {
        if (!kv) return json({ ok: false, error: 'KV not configured' }, 503);
        const body = await request.json().catch(() => ({}));
        const { slug, name, sport = 'baseball', year = '', brand = '' } = body;
        if (!slug || !name) return json({ ok: false, error: 'slug and name required' }, 400);

        // Find the catalog entry to get beckettUrl
        const catEntry = TOPPS_CATALOG.find(s => s.slug === slug) || {};
        let beckettUrl = body.beckettUrl || catEntry.beckettUrl;

        // Auto-construct Beckett URL if not provided
        if (!beckettUrl) {
          beckettUrl = `https://www.beckett.com/news/${slug}-cards/`;
        }

        // Try up to 3 Beckett URL patterns
        const urlsToTry = [
          beckettUrl,
          `https://www.beckett.com/news/${slug}-checklist/`,
          `https://www.beckett.com/news/${slug}/`,
        ];

        let parsed = null;
        let usedUrl = null;
        for (const tryUrl of urlsToTry) {
          const fetchRes = await fetch(tryUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': 'https://www.beckett.com/',
              'Cache-Control': 'no-cache',
            },
            redirect: 'follow',
          }).catch(() => null);

          if (!fetchRes || !fetchRes.ok) continue;
          const html = await fetchRes.text();
          parsed = parseBeckettChecklist(html, slug, name, sport, year);
          if (parsed && (parsed.base_set?.cards?.length > 0 || parsed.insert_sets?.length > 0)) {
            usedUrl = tryUrl;
            break;
          }
        }

        if (!parsed || (parsed.base_set?.cards?.length === 0 && parsed.insert_sets?.length === 0)) {
          return json({ ok: false, error: `Checklist not found on Beckett. Tried: ${urlsToTry.join(', ')}` }, 404);
        }

        await kv.put(`set:${slug}`, JSON.stringify(parsed));
        const idxRaw = await kv.get('sets_index');
        const index = idxRaw ? JSON.parse(idxRaw) : [];
        const existing = index.findIndex(s => s.slug === slug);
        const meta = {
          slug, name, sport, year, brand,
          setSize: parsed.base_set?.cards?.length || 0,
          releaseDate: parsed.release_date || year,
          importedAt: new Date().toISOString(),
          beckettUrl: usedUrl,
          baseCount: parsed.base_set?.cards?.length || 0,
          insertSetCount: parsed.insert_sets?.length || 0,
          autoSetCount: parsed.autograph_sets?.length || 0,
        };
        if (existing >= 0) index[existing] = meta; else index.push(meta);
        index.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
        await kv.put('sets_index', JSON.stringify(index));

        return json({ ok: true, slug, name, baseCount: meta.baseCount, insertSetCount: meta.insertSetCount, autoSetCount: meta.autoSetCount, source: usedUrl });
      }

      // GET /topps/proxy-pdf?url=URL — proxy a Topps PDF to the browser (bypasses CORS)
      if (url.pathname === '/topps/proxy-pdf' && request.method === 'GET') {
        const pdfUrl = url.searchParams.get('url');
        if (!pdfUrl) return json({ ok: false, error: 'url param required' }, 400);
        const pdfRes = await fetch(pdfUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.topps.com/',
            'Accept': 'application/pdf,*/*',
          },
        }).catch(() => null);
        if (!pdfRes || !pdfRes.ok) return json({ ok: false, error: `PDF fetch failed: ${pdfRes?.status || 'network error'}` }, 502);
        const ct = pdfRes.headers.get('content-type') || 'application/octet-stream';
        if (ct.includes('html')) {
          const html = await pdfRes.text();
          const m = html.match(/href="([^"]*\.pdf[^"]*)"/i) || html.match(/src="([^"]*\.pdf[^"]*)"/i);
          if (m) {
            const realUrl = m[1].startsWith('http') ? m[1] : 'https://www.topps.com' + m[1];
            return new Response(JSON.stringify({ redirect: realUrl }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
          }
          return json({ ok: false, error: 'URL returned HTML, no PDF link found' }, 422);
        }
        const buf = await pdfRes.arrayBuffer();
        return new Response(buf, { headers: { ...CORS, 'Content-Type': 'application/pdf', 'Content-Length': String(buf.byteLength) } });
      }

      // POST /topps/import-pdf — fetch a PDF URL, extract text, parse, store in KV
      if (url.pathname === '/topps/import-pdf' && request.method === 'POST') {
        if (!kv) return json({ ok: false, error: 'KV not configured' }, 503);
        const body = await request.json().catch(() => ({}));
        const { url: pdfUrl, slug, name, sport = 'baseball', year = '', brand = '' } = body;
        if (!pdfUrl || !slug || !name) return json({ ok: false, error: 'url, slug, name required' }, 400);

        // Fetch the PDF
        const pdfRes = await fetch(pdfUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.topps.com/',
            'Accept': 'application/pdf,*/*',
          },
        }).catch(e => null);

        if (!pdfRes || !pdfRes.ok) {
          return json({ ok: false, error: `PDF fetch failed: ${pdfRes?.status || 'network error'} — ${pdfUrl}` }, 502);
        }

        const ct = pdfRes.headers.get('content-type') || '';
        if (!ct.includes('pdf') && !pdfUrl.toLowerCase().includes('.pdf')) {
          // Might be an HTML page wrapping the PDF link — try to find PDF URL in the response
          const html = await pdfRes.text();
          const pdfLinkM = html.match(/href="([^"]*\.pdf[^"]*)"/i);
          if (pdfLinkM) {
            return json({ ok: false, redirect: pdfLinkM[1], error: 'Redirected to PDF URL, retry with redirect URL' }, 200);
          }
          return json({ ok: false, error: 'URL did not return a PDF' }, 422);
        }

        const arrayBuffer = await pdfRes.arrayBuffer();
        let text = '';
        try {
          text = await extractPdfText(arrayBuffer);
        } catch (e) {
          return json({ ok: false, error: 'PDF text extraction failed: ' + e.message }, 422);
        }

        if (!text || text.trim().length < 50) {
          return json({ ok: false, error: 'Could not extract readable text from PDF (length=' + text.length + ')', textSample: text.slice(0, 500) }, 422);
        }

        // Parse the extracted text
        const parsed = parseToppsChecklistText(text, { slug, name, sport, year, brand });

        // If 0 cards, return the text sample for debugging instead of storing empty data
        if (parsed.base_set.cards.length === 0 && parsed.insert_sets.length === 0 && parsed.autograph_sets.length === 0) {
          return json({ ok: false, error: 'Parser found 0 cards — text format may not match expected Topps checklist format', textSample: text.slice(0, 2000), textLength: text.length }, 422);
        }

        // Store in KV
        await kv.put(`set:${slug}`, JSON.stringify(parsed));
        const idxRaw = await kv.get('sets_index');
        const index = idxRaw ? JSON.parse(idxRaw) : [];
        const existing = index.findIndex(s => s.slug === slug);
        const meta = {
          slug, name, sport, year, brand,
          setSize: parsed.base_set?.cards?.length || 0,
          releaseDate: year,
          importedAt: new Date().toISOString(),
          baseCount: parsed.base_set?.cards?.length || 0,
          insertSetCount: parsed.insert_sets?.length || 0,
          autoSetCount: parsed.autograph_sets?.length || 0,
        };
        if (existing >= 0) index[existing] = meta; else index.push(meta);
        index.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
        await kv.put('sets_index', JSON.stringify(index));

        return json({ ok: true, slug, name, baseCount: meta.baseCount, insertSetCount: meta.insertSetCount, autoSetCount: meta.autoSetCount });
      }

      return json({ error: 'Not found' }, 404);
    }

    // Topps Checklist Browser API. Stores parsed PDF checklist data in KV as
    // sets, source records, and chunked card rows so full-batch imports can be
    // safely re-run as new Topps PDFs are released.
    if (url.pathname.startsWith('/topps-checklists')) {
      const kv = env.LBA_KV;
      if (!kv) return json({ ok: false, error: 'KV not configured' }, 503);
      const TOPPS_CARD_CHUNK_SIZE = 5000;
      const readJsonKv = async (key, fallback) => {
        const raw = await kv.get(key);
        if (!raw) return fallback;
        try { return JSON.parse(raw); } catch (_) { return fallback; }
      };
      const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const cardMatches = (card, filters) => {
        if (filters.setId && card.setId !== filters.setId) return false;
        if (filters.year && String(card.year || '') !== String(filters.year)) return false;
        if (filters.sport && String(card.sport || '').toLowerCase() !== String(filters.sport).toLowerCase()) return false;
        if (filters.product && !norm(card.product).includes(norm(filters.product))) return false;
        if (filters.team && !norm(card.team).includes(norm(filters.team))) return false;
        if (filters.number && String(card.cardNumber || '').toLowerCase() !== String(filters.number).toLowerCase()) return false;
        if (filters.flag && !card.flags?.[filters.flag]) return false;
        if (filters.q) {
          const hay = card.searchText || [card.year, card.brand, card.product, card.sport, card.section, card.cardNumber, card.player, card.subject, card.team, card.notes].join(' ').toLowerCase();
          if (!norm(filters.q).split(/\s+/).every(t => hay.includes(t))) return false;
        }
        return true;
      };
      const hasToppsFilters = filters => Object.values(filters).some(Boolean);
      const scanToppsCards = async ({ filters = {}, limit = 100, offset = 0, id = '' } = {}) => {
        const meta = await readJsonKv('topps_import_meta', {});
        const count = Number(await kv.get('topps_cards_chunk_count') || meta.chunkCount || 0);
        const out = [];
        let seen = 0;
        let scannedChunks = 0;
        const need = offset + limit;
        for (let i = 0; i < count; i++) {
          const chunk = await readJsonKv(`topps_cards_chunk:${i}`, []);
          scannedChunks++;
          for (const card of chunk) {
            const match = id ? card.id === id : cardMatches(card, filters);
            if (!match) continue;
            if (id) return { cards: [card], total: 1, scannedChunks, complete: true, meta };
            if (seen >= offset && out.length < limit) out.push(card);
            seen++;
            if (out.length >= limit) return { cards: out, total: hasToppsFilters(filters) ? seen : Number(meta.cardCount || seen), scannedChunks, complete: false, meta };
          }
        }
        return { cards: out, total: seen, scannedChunks, complete: true, meta };
      };

      if (url.pathname === '/topps-checklists/import-start' && request.method === 'PUT') {
        const body = await request.json().catch(() => null);
        if (!body || !Array.isArray(body.sets)) return json({ ok: false, error: 'sets[] required' }, 400);
        const now = new Date().toISOString();
        const sets = body.sets.map(s => ({ ...s, updatedAt: now }));
        const sources = (body.sources || []).map(s => {
          const source = { ...s };
          delete source.rawText;
          return { ...source, updatedAt: now };
        });
        const priorCount = Number(await kv.get('topps_cards_chunk_count') || 0);
        for (let i = 0; i < priorCount; i++) await kv.delete(`topps_cards_chunk:${i}`);
        await kv.put('topps_cards_chunk_count', '0');
        await kv.put('topps_sets_index', JSON.stringify(sets));
        await kv.put('topps_source_index', JSON.stringify(sources));
        await kv.put('topps_import_meta', JSON.stringify({
          importedAt: now,
          status: 'importing',
          schemaVersion: body.schemaVersion || 1,
          setCount: sets.length,
          cardCount: 0,
          expectedCardCount: body.expectedCardCount || 0,
          sourceCount: sources.length,
          chunkCount: 0,
        }));
        return json({ ok: true, setCount: sets.length, sourceCount: sources.length, clearedChunks: priorCount });
      }

      if (url.pathname === '/topps-checklists/import-cards-chunk' && request.method === 'PUT') {
        const body = await request.json().catch(() => null);
        const chunkIndex = Number(body?.chunkIndex);
        if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !Array.isArray(body.cards)) return json({ ok: false, error: 'chunkIndex and cards[] required' }, 400);
        const now = new Date().toISOString();
        const cards = body.cards.map(c => ({ ...c, updatedAt: now }));
        await kv.put(`topps_cards_chunk:${chunkIndex}`, JSON.stringify(cards));
        return json({ ok: true, chunkIndex, cardCount: cards.length });
      }

      if (url.pathname === '/topps-checklists/import-source' && request.method === 'PUT') {
        const body = await request.json().catch(() => null);
        if (!body?.source?.sourceId) return json({ ok: false, error: 'source.sourceId required' }, 400);
        await kv.put(`topps_source:${body.source.sourceId}`, JSON.stringify({ ...body.source, updatedAt: new Date().toISOString() }));
        return json({ ok: true, sourceId: body.source.sourceId });
      }

      if (url.pathname === '/topps-checklists/import-complete' && request.method === 'PUT') {
        const body = await request.json().catch(() => null);
        const chunkCount = Number(body?.chunkCount);
        if (!Number.isInteger(chunkCount) || chunkCount < 0) return json({ ok: false, error: 'chunkCount required' }, 400);
        const now = new Date().toISOString();
        await kv.put('topps_cards_chunk_count', String(chunkCount));
        await kv.put('topps_import_meta', JSON.stringify({
          importedAt: now,
          status: 'ready',
          schemaVersion: body.schemaVersion || 1,
          setCount: Number(body.setCount || 0),
          cardCount: Number(body.cardCount || 0),
          sourceCount: Number(body.sourceCount || 0),
          chunkCount,
        }));
        return json({ ok: true, setCount: Number(body.setCount || 0), cardCount: Number(body.cardCount || 0), sourceCount: Number(body.sourceCount || 0), chunkCount });
      }

      if (url.pathname === '/topps-checklists/import-json' && request.method === 'PUT') {
        const body = await request.json().catch(() => null);
        if (!body || !Array.isArray(body.sets) || !Array.isArray(body.cards)) return json({ ok: false, error: 'sets[] and cards[] required' }, 400);
        const now = new Date().toISOString();
        const sets = body.sets.map(s => ({ ...s, updatedAt: now }));
        const cards = body.cards.map(c => ({ ...c, updatedAt: now }));
        const sources = (body.sources || []).map(s => {
          const source = { ...s };
          delete source.rawText;
          return { ...source, updatedAt: now };
        });

        await kv.put('topps_sets_index', JSON.stringify(sets));
        await kv.put('topps_source_index', JSON.stringify(sources));
        for (const source of body.sources || []) await kv.put(`topps_source:${source.sourceId}`, JSON.stringify(source));
        const priorCount = Number(await kv.get('topps_cards_chunk_count') || 0);
        for (let i = 0; i < priorCount; i++) await kv.delete(`topps_cards_chunk:${i}`);
        const chunkCount = Math.ceil(cards.length / TOPPS_CARD_CHUNK_SIZE);
        for (let i = 0; i < chunkCount; i++) {
          await kv.put(`topps_cards_chunk:${i}`, JSON.stringify(cards.slice(i * TOPPS_CARD_CHUNK_SIZE, (i + 1) * TOPPS_CARD_CHUNK_SIZE)));
        }
        await kv.put('topps_cards_chunk_count', String(chunkCount));
        await kv.put('topps_import_meta', JSON.stringify({ importedAt: now, schemaVersion: body.schemaVersion || 1, setCount: sets.length, cardCount: cards.length, sourceCount: sources.length, chunkCount }));
        return json({ ok: true, setCount: sets.length, cardCount: cards.length, sourceCount: sources.length, chunkCount });
      }

      if (url.pathname === '/topps-checklists/meta' && request.method === 'GET') {
        const meta = await readJsonKv('topps_import_meta', {});
        return json({ ok: true, meta });
      }

      if (url.pathname === '/topps-checklists/sets' && request.method === 'GET') {
        const sets = await readJsonKv('topps_sets_index', []);
        const q = url.searchParams.get('q') || '';
        const sport = url.searchParams.get('sport') || '';
        const year = url.searchParams.get('year') || '';
        const filtered = sets.filter(s =>
          (!q || norm([s.year, s.brand, s.product, s.setName, s.releaseName, s.sport].join(' ')).includes(norm(q))) &&
          (!sport || String(s.sport || '').toLowerCase() === sport.toLowerCase()) &&
          (!year || String(s.year || '') === String(year))
        );
        return json({ ok: true, total: filtered.length, sets: filtered.slice(0, 500) });
      }

      if (url.pathname === '/topps-checklists/cards' && request.method === 'GET') {
        const filters = {
          q: url.searchParams.get('q') || '',
          setId: url.searchParams.get('setId') || '',
          year: url.searchParams.get('year') || '',
          sport: url.searchParams.get('sport') || '',
          product: url.searchParams.get('product') || '',
          team: url.searchParams.get('team') || '',
          number: url.searchParams.get('number') || '',
          flag: url.searchParams.get('flag') || '',
        };
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));
        const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
        const page = await scanToppsCards({ filters, limit, offset });
        return json({ ok: true, total: page.total, cards: page.cards, limit, offset, complete: page.complete, scannedChunks: page.scannedChunks });
      }

      const cardMatch = url.pathname.match(/^\/topps-checklists\/cards\/([^/]+)$/);
      if (cardMatch && request.method === 'GET') {
        const page = await scanToppsCards({ id: decodeURIComponent(cardMatch[1]), limit: 1 });
        const card = page.cards[0];
        if (!card) return json({ ok: false, error: 'Card not found' }, 404);
        const source = card.sourceId ? await readJsonKv(`topps_source:${card.sourceId}`, null) : null;
        return json({ ok: true, card, source });
      }

      const pcMatch = url.pathname.match(/^\/topps-checklists\/cards\/([^/]+)\/pricecharting$/);
      if (pcMatch && request.method === 'GET') {
        const cardId = decodeURIComponent(pcMatch[1]);
        const cacheKey = `topps_pc_match:${cardId}`;
        const fresh = url.searchParams.get('fresh') === 'true';
        const cached = !fresh ? await readJsonKv(cacheKey, null) : null;
        if (cached && Date.now() - new Date(cached.cachedAt || 0).getTime() < 86400000) return json({ ok: true, cached: true, ...cached });

        const page = await scanToppsCards({ id: cardId, limit: 1 });
        const card = page.cards[0];
        if (!card) return json({ ok: false, error: 'Card not found' }, 404);
        const q = [card.year, 'Topps', card.product, card.player || card.subject, card.cardNumber ? '#' + card.cardNumber : '', card.flags?.rc ? 'RC' : '', card.flags?.auto ? 'auto' : '', card.flags?.relic ? 'relic' : ''].filter(Boolean).join(' ');
        const params = new URLSearchParams({ q, category: 'Sports Cards' });
        const upstream = await fetch(new URL('/pricing/pricecharting/search?' + params.toString(), url.origin), { headers: request.headers });
        const data = await upstream.json().catch(() => ({}));
        const matches = data.matches || data.products || [];
        const payload = { cardId, query: q, matches: matches.slice(0, 8), best: matches[0] || null, cachedAt: new Date().toISOString() };
        await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: 86400 * 14 });
        return json({ ok: true, cached: false, ...payload });
      }

      return json({ ok: false, error: 'Unknown Topps checklist route' }, 404);
    }

    // ── SET BROWSER API ──────────────────────────────────────────────────────
    if (url.pathname.startsWith('/sets')) {
      const kv = env.LBA_KV;
      if (!kv) return json({ ok: false, error: 'KV not configured' }, 503);

      // Admin check for mutations
      const requireAdmin = () => {
        const token = env.ADMIN_TOKEN;
        if (!token) return false; // no token configured = open (backward compat)
        const auth = request.headers.get('Authorization') || '';
        return auth === `Bearer ${token}`;
      };

      // GET /sets — list all imported sets
      if (url.pathname === '/sets' && request.method === 'GET') {
        const raw = await kv.get('sets_index');
        const index = raw ? JSON.parse(raw) : [];
        return json({ ok: true, sets: index });
      }

      // POST /sets/import-topps-text — paste raw text from a Topps PDF checklist
      if (url.pathname === '/sets/import-topps-text' && request.method === 'POST') {
        if (!kv) return json({ ok: false, error: 'KV not configured' }, 503);
        const body = await request.json().catch(() => ({}));
        const { text, slug, name, sport = 'baseball', year, brand = '' } = body;
        if (!text || !slug || !name) return json({ ok: false, error: 'text, slug, name required' }, 400);
        const parsed = parseToppsChecklistText(text, { slug, name, sport, year, brand });
        await kv.put(`set:${slug}`, JSON.stringify(parsed));
        const idxRaw = await kv.get('sets_index');
        const index = idxRaw ? JSON.parse(idxRaw) : [];
        const existing = index.findIndex(s => s.slug === slug);
        const meta = {
          slug, name, sport, year: year || '', brand: brand || '',
          setSize: parsed.set_size || 0, releaseDate: year || '',
          importedAt: new Date().toISOString(),
          baseCount: parsed.base_set?.cards?.length || 0,
          insertSetCount: parsed.insert_sets?.length || 0,
          autoSetCount: parsed.autograph_sets?.length || 0,
        };
        if (existing >= 0) index[existing] = meta; else index.push(meta);
        index.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
        await kv.put('sets_index', JSON.stringify(index));
        return json({ ok: true, slug, name, baseCount: meta.baseCount, insertSetCount: meta.insertSetCount, autoSetCount: meta.autoSetCount });
      }

      // POST /sets/import — fetch a Beckett checklist URL and parse it into KV
      if (url.pathname === '/sets/import' && request.method === 'POST') {
        if (!requireAdmin()) return json({ ok: false, error: 'Admin token required' }, 403);
        const body = await request.json().catch(() => ({}));
        const { url: beckettUrl, slug, name, sport = 'baseball', year } = body;
        if (!beckettUrl || !slug || !name) {
          return json({ ok: false, error: 'url, slug, name required' }, 400);
        }

        // Fetch with browser-like headers to bypass bot detection
        const fetchRes = await fetch(beckettUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xhtml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.beckett.com/news/',
            'Cache-Control': 'no-cache',
          },
          redirect: 'follow',
        }).catch(e => null);

        if (!fetchRes || !fetchRes.ok) {
          return json({ ok: false, error: `Fetch failed: ${fetchRes?.status || 'network error'}` }, 502);
        }

        const html = await fetchRes.text();
        const parsed = parseBeckettChecklist(html, slug, name, sport, year);
        if (!parsed) return json({ ok: false, error: 'Could not parse checklist from page' }, 422);

        // Store full set data
        await kv.put(`set:${slug}`, JSON.stringify(parsed));

        // Update index
        const idxRaw = await kv.get('sets_index');
        const index = idxRaw ? JSON.parse(idxRaw) : [];
        const existing = index.findIndex(s => s.slug === slug);
        const meta = {
          slug, name, sport, year: year || parsed.release_date || '',
          setSize: parsed.set_size || 0,
          releaseDate: parsed.release_date || '',
          importedAt: new Date().toISOString(),
          baseCount: parsed.base_set?.count || 0,
          insertSetCount: parsed.insert_sets?.length || 0,
          autoSetCount: parsed.autograph_sets?.length || 0,
        };
        if (existing >= 0) index[existing] = meta;
        else index.push(meta);
        index.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
        await kv.put('sets_index', JSON.stringify(index));

        return json({ ok: true, slug, name, baseCount: meta.baseCount, insertSetCount: meta.insertSetCount });
      }

      // POST /sets/import-raw-url — fetch pre-parsed JSON from a URL (e.g. raw GitHub) and seed it
      if (url.pathname === '/sets/import-raw-url' && request.method === 'POST') {
        if (!requireAdmin()) return json({ ok: false, error: 'Admin token required' }, 403);
        const body = await request.json().catch(() => null);
        if (!body?.url || !body?.slug || !body?.name) return json({ ok: false, error: 'url, slug, name required' }, 400);
        const res = await fetch(body.url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return json({ ok: false, error: `Fetch failed: ${res.status}` }, 502);
        const data = await res.json().catch(() => null);
        if (!data) return json({ ok: false, error: 'Invalid JSON at URL' }, 422);
        const payload = { ...data, slug: body.slug, name: body.name, sport: body.sport || data.sport || 'baseball', year: body.year || data.release_date || '' };
        await kv.put(`set:${body.slug}`, JSON.stringify(payload));
        const idxRaw = await kv.get('sets_index');
        const index = idxRaw ? JSON.parse(idxRaw) : [];
        const existing = index.findIndex(s => s.slug === body.slug);
        const meta = { slug: body.slug, name: body.name, sport: payload.sport, year: payload.year, setSize: data.set_size || 0, releaseDate: data.release_date || '', importedAt: new Date().toISOString(), baseCount: data.base_set?.count || data.base_set?.cards?.length || 0, insertSetCount: data.insert_sets?.length || 0, autoSetCount: data.autograph_sets?.length || 0 };
        if (existing >= 0) index[existing] = meta; else index.push(meta);
        index.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
        await kv.put('sets_index', JSON.stringify(index));
        return json({ ok: true, slug: body.slug, baseCount: meta.baseCount, insertSetCount: meta.insertSetCount });
      }

      // PUT /sets/import-json — store pre-parsed JSON (for seeding)
      if (url.pathname === '/sets/import-json' && request.method === 'PUT') {
        if (!requireAdmin()) return json({ ok: false, error: 'Admin token required' }, 403);
        const body = await request.json().catch(() => null);
        if (!body?.slug || !body?.name) return json({ ok: false, error: 'slug and name required' }, 400);
        const { slug, name, sport = 'baseball', year } = body;

        await kv.put(`set:${slug}`, JSON.stringify(body));

        const idxRaw = await kv.get('sets_index');
        const index = idxRaw ? JSON.parse(idxRaw) : [];
        const existing = index.findIndex(s => s.slug === slug);
        const meta = {
          slug, name, sport, year: year || body.release_date || '',
          setSize: body.set_size || 0, releaseDate: body.release_date || '',
          importedAt: new Date().toISOString(),
          baseCount: body.base_set?.count || 0,
          insertSetCount: body.insert_sets?.length || 0,
          autoSetCount: body.autograph_sets?.length || 0,
        };
        if (existing >= 0) index[existing] = meta;
        else index.push(meta);
        index.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
        await kv.put('sets_index', JSON.stringify(index));

        return json({ ok: true, slug, seeded: true, baseCount: meta.baseCount });
      }

      // GET /sets/:slug — full set data
      const slugMatch = url.pathname.match(/^\/sets\/([^/]+)$/);
      if (slugMatch && request.method === 'GET') {
        const raw = await kv.get(`set:${slugMatch[1]}`);
        if (!raw) return json({ ok: false, error: 'Set not found' }, 404);
        return new Response(raw, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }

      // GET /sets/:slug/cards?q=QUERY&number=N&team=TEAM&section=base|inserts|autos
      const cardsMatch = url.pathname.match(/^\/sets\/([^/]+)\/cards$/);
      if (cardsMatch && request.method === 'GET') {
        const raw = await kv.get(`set:${cardsMatch[1]}`);
        if (!raw) return json({ ok: false, error: 'Set not found' }, 404);
        const setData = JSON.parse(raw);
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const numFilter = url.searchParams.get('number') || '';
        const teamFilter = (url.searchParams.get('team') || '').toLowerCase();
        const section = url.searchParams.get('section') || 'base';

        let cards = [];
        if (section === 'base') {
          cards = setData.base_set?.cards || [];
        } else if (section === 'inserts') {
          cards = (setData.insert_sets || []).flatMap(s =>
            s.cards.map(c => ({ ...c, setName: s.name }))
          );
        } else if (section === 'autos') {
          cards = (setData.autograph_sets || []).flatMap(s =>
            s.cards.map(c => ({ ...c, setName: s.name }))
          );
        } else if (section === 'mem') {
          cards = (setData.memorabilia_sets || []).flatMap(s =>
            s.cards.map(c => ({ ...c, setName: s.name }))
          );
        }

        if (q) cards = cards.filter(c =>
          String(c.player || '').toLowerCase().includes(q) ||
          String(c.team || '').toLowerCase().includes(q) ||
          String(c.number || '').toLowerCase().includes(q) ||
          String(c.setName || '').toLowerCase().includes(q)
        );
        if (numFilter) cards = cards.filter(c => String(c.number) === numFilter);
        if (teamFilter) cards = cards.filter(c => (c.team || '').toLowerCase().includes(teamFilter));

        return json({ ok: true, section, total: cards.length, cards: cards.slice(0, 200) });
      }

      // GET /sets/:slug/card/:number/price — price lookup via PriceCharting
      const priceMatch = url.pathname.match(/^\/sets\/([^/]+)\/card\/([^/]+)\/price$/);
      if (priceMatch && request.method === 'GET') {
        const [, setSlug, cardNum] = priceMatch;
        const raw = await kv.get(`set:${setSlug}`);
        if (!raw) return json({ ok: false, error: 'Set not found' }, 404);
        const setData = JSON.parse(raw);
        const card = (setData.base_set?.cards || []).find(c => String(c.number) === cardNum);
        if (!card) return json({ ok: false, error: 'Card not found' }, 404);

        const token = env.PRICECHARTING_TOKEN || env.PRICECHARTING_API_KEY;
        if (!token) return json({ ok: false, error: 'PRICECHARTING_TOKEN not set' }, 501);

        const q = encodeURIComponent(`${card.player} ${setData.set}`);
        const pcRes = await fetch(`https://www.pricecharting.com/api/products?q=${q}&status=price&token=${token}`);
        if (!pcRes.ok) return json({ ok: false, error: 'PriceCharting error' }, 502);
        const pcData = await pcRes.json();
        const products = (pcData.products || []).slice(0, 5);

        return json({ ok: true, card, products });
      }

      // DELETE /sets/:slug — remove a set
      const delMatch = url.pathname.match(/^\/sets\/([^/]+)$/);
      if (delMatch && request.method === 'DELETE') {
        if (!requireAdmin()) return json({ ok: false, error: 'Admin token required' }, 403);
        const s = delMatch[1];
        await kv.delete(`set:${s}`);
        const idxRaw = await kv.get('sets_index');
        const index = (idxRaw ? JSON.parse(idxRaw) : []).filter(x => x.slug !== s);
        await kv.put('sets_index', JSON.stringify(index));
        return json({ ok: true, deleted: s });
      }
    }

    return json({ error: 'Not found' }, 404);
  },
};

// ── BECKETT HTML PARSER ───────────────────────────────────────────────────────
function parseBeckettChecklist(html, slug, name, sport, year) {
  // Extract article content div
  const contentMatch = html.match(/class="[^"]*article-content[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+id="comments|<\/main|<footer)/i);
  if (!contentMatch) return null;
  const content = contentMatch[1];

  // ── Extract box contents from HTML <li> items under "What to expect" headings ──
  const box_contents = {};
  const boxSectionRe = /What to expect in (?:a |an )?([^:<]+?)(?:\s+box)?[:<]/gi;
  let bm;
  while ((bm = boxSectionRe.exec(content)) !== null) {
    const boxType = bm[1].trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    // grab the <ul> or <ol> that follows this heading
    const after = content.slice(bm.index + bm[0].length, bm.index + bm[0].length + 3000);
    const listMatch = after.match(/<[uo]l[^>]*>([\s\S]*?)<\/[uo]l>/i);
    if (listMatch) {
      const items = [];
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let li;
      while ((li = liRe.exec(listMatch[1])) !== null) {
        const txt = li[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').trim();
        if (txt) items.push(txt);
      }
      if (items.length) box_contents[boxType] = items;
    }
  }

  // ── Strip HTML and build line array ──
  const decodeEntities = s => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&[a-z]+;/g, ' ');

  const text = content
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(li|p|h[1-6]|div|ul|ol)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n').map(l => decodeEntities(l).trim()).filter(Boolean);

  const lines = text;

  // ── Product info (cards/packs/boxes per format) ──
  const product_info = { cards_per_pack: {}, packs_per_box: {}, boxes_per_case: {} };
  const infoLine = lines.find(l => /cards per pack/i.test(l));
  if (infoLine) {
    const parseFormatLine = (label) => {
      const re = new RegExp(label + '[:\\s]+([^\\n]+)', 'i');
      const m = infoLine.match(re) || lines.join('\n').match(re);
      if (!m) return {};
      const obj = {};
      m[1].split(/[;,]/).forEach(part => {
        const pm = part.trim().match(/^(.+?)\s*[–\-:]\s*(\d+)/);
        if (pm) obj[pm[1].trim()] = parseInt(pm[2]);
      });
      return obj;
    };
    product_info.cards_per_pack = parseFormatLine('Cards per pack');
    product_info.packs_per_box  = parseFormatLine('Packs per box');
    product_info.boxes_per_case = parseFormatLine('Boxes per case');
  }

  // ── Release date & set size ──
  const fullText = lines.join(' ');
  const releaseDateMatch = fullText.match(/[Rr]elease date[:\s]+([A-Za-z]+ \d+,?\s*\d{4})/);
  const releaseDate = releaseDateMatch ? releaseDateMatch[1].replace(/\s+/g, ' ').trim() : (year ? String(year) : '');
  const setSizeMatch = fullText.match(/[Ss]et size[:\s]+(\d+)/);
  const setSize = setSizeMatch ? parseInt(setSizeMatch[1]) : 0;

  // ── Card parsing helpers ──
  const TEAMS = new Set([
    'New York Yankees','Toronto Blue Jays','Minnesota Twins','New York Mets','Chicago Cubs',
    'Arizona Diamondbacks','San Francisco Giants','San Diego Padres','Milwaukee Brewers',
    'Colorado Rockies','Detroit Tigers','Boston Red Sox','Tampa Bay Rays','Baltimore Orioles',
    'Washington Nationals','Cleveland Guardians','St. Louis Cardinals','Houston Astros',
    'Kansas City Royals','Miami Marlins','Los Angeles Dodgers','Athletics','Angels',
    'Chicago White Sox','Seattle Mariners','Atlanta Braves','Philadelphia Phillies',
    'Cincinnati Reds','Pittsburgh Pirates','Texas Rangers','Los Angeles Angels',
    'Oakland Athletics','Tampa Bay Devil Rays','Montreal Expos','Other',
  ]);
  const MONTHS = new Set(['January','February','March','April','May','June','July','August','September','October','November','December']);
  const CARD_RE   = /^(\d+)\s+(.+?),\s+(.+?)(?:\s+\((.+?)\))?$/;
  // Prefix cards: e.g. "75YA-RC Roger Clemens, Boston Red Sox" or "BSA-AB Alec Burleson, St. Louis Cardinals"
  const PREFIX_RE = /^([A-Z0-9]{1,6}-[A-Z0-9]{1,6}[a-z]?)\s+(.+?),\s+(.+?)$/;
  const BASE_NO_TEAM_RE = /^(\d+)\s+(.+?)(?:\s+(RC))?$/;

  function tryBase(line, maxNum = 400) {
    const m = line.match(CARD_RE);
    if (!m) return null;
    const num = parseInt(m[1]);
    if (num > maxNum || num < 1) return null;
    const player = m[2].trim(), team = m[3].trim(), note = (m[4] || '').trim();
    if (!TEAMS.has(team) && ![...TEAMS].some(t => team.includes(t))) return null;
    if (MONTHS.has(player) || /^\d{4}$/.test(player)) return null;
    return { number: num, player, team, note };
  }

  function tryPrefixed(line) {
    const m = line.match(PREFIX_RE);
    if (!m) return null;
    const team = m[3].trim();
    if (MONTHS.has(m[2].trim())) return null;
    return { number: m[1], player: m[2].trim(), team };
  }

  function tryBaseNoTeam(line, maxNum = 400) {
    const m = line.match(BASE_NO_TEAM_RE);
    if (!m) return null;
    const num = parseInt(m[1]);
    if (num > maxNum || num < 1) return null;
    const player = m[2].trim();
    if (MONTHS.has(player) || /^\d{4}$/.test(player) || player.length < 3) return null;
    return { number: num, player, rc: m[3] === 'RC' };
  }

  // ── Find section boundaries ──
  let baseStart = -1, varsStart = lines.length, autoStart = lines.length;
  let memStart = lines.length, insStart = lines.length, teamStart = lines.length;

  const SEC = { base: /^base set checklist$/i, vars: /[–\-]\s*variations/i, auto: /[–\-]\s*autographs/i, mem: /[–\-]\s*memorabilia/i, ins: /[–\-]\s*inserts/i, team: /^team sets$/i };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (SEC.base.test(l) && baseStart < 0) baseStart = i;
    if (SEC.vars.test(l) && i > baseStart && baseStart >= 0) varsStart = Math.min(varsStart, i);
    if (SEC.auto.test(l)) autoStart = Math.min(autoStart, i);
    if (SEC.mem.test(l)) memStart = Math.min(memStart, i);
    if (SEC.ins.test(l)) insStart = Math.min(insStart, i);
    if (SEC.team.test(l)) teamStart = Math.min(teamStart, i);
  }

  if (baseStart < 0) return null;

  // If sections are out of the expected order, reorder them
  // (Beckett sometimes puts inserts before autos)
  const sectionOrder = [
    ['auto', autoStart], ['mem', memStart], ['ins', insStart], ['team', teamStart]
  ].filter(s => s[1] < lines.length).sort((a, b) => a[1] - b[1]);

  // ── Parse parallels (with odds) ──
  const parallels = [];
  let inPar = false;
  for (let i = baseStart; i < varsStart; i++) {
    const l = lines[i];
    if (/^parallels$/i.test(l)) { inPar = true; continue; }
    if (inPar) {
      if (/^\d+ /.test(l) && CARD_RE.test(l)) break;
      if (l && !/^shop/i.test(l) && !/^download/i.test(l)) parallels.push(l);
    }
  }

  // ── Split lines where Beckett concatenates multiple cards without separators ──
  // e.g. "1 Aaron Judge, New York Yankees2 Shohei Ohtani, Los Angeles Dodgers"
  function splitConcatenated(line) {
    if (line.length < 40) return [line];
    // Split where a letter is immediately followed by 1-3 digits + space + capital letter
    const parts = line.split(/(?<=[A-Za-z])(?=\d{1,3}\s+[A-Z])/);
    return parts.map(s => s.trim()).filter(Boolean);
  }

  // ── Parse base cards ──
  const baseSeen = new Set();
  const baseCards = [];
  for (let i = baseStart; i < varsStart; i++) {
    for (const sl of splitConcatenated(lines[i])) {
      const c = tryBase(sl, setSize || 400);
      if (c) {
        const key = `${c.number}:${c.player}`;
        if (!baseSeen.has(key)) { baseSeen.add(key); baseCards.push(c); }
      }
    }
  }
  baseCards.sort((a, b) => a.number - b.number || a.player.localeCompare(b.player));

  // ── Generic insert/auto/mem section parser ──
  function parseSets(start, end) {
    const sets = [];
    let cur = null;
    const skip = /^(shop|download|on ebay|checklist)/i;
    for (let i = start; i < end; i++) {
      for (const l of splitConcatenated(lines[i])) {
      if (skip.test(l)) continue;
      // Section headers on Beckett look like "Set Name\nN cards"
      const nxt = lines[i + 1] || '';
      const isHeader = /^\d+ cards?$/.test(nxt) && l.length > 2 && !/^[A-Z0-9]{1,6}-[A-Z0-9]/.test(l) && !SEC.base.test(l) && !SEC.auto.test(l) && !SEC.mem.test(l) && !SEC.ins.test(l) && !SEC.team.test(l);
      if (isHeader) {
        if (cur) sets.push(cur);
        cur = { name: l, count: parseInt(nxt), parallels: [], cards: [] };
        i++;
        // Collect parallels between header and first card
        while (i + 1 < end) {
          i++;
          const pl = lines[i];
          if (!pl || skip.test(pl)) continue;
          if (tryPrefixed(pl) || tryBase(pl, 9999)) { i--; break; }
          if (/^\d+ cards?$/.test(lines[i + 1] || '')) { i--; break; }
          if (!/^parallels$/i.test(pl)) cur.parallels.push(pl);
        }
        continue;
      }
      if (!cur) continue;
      const pc = tryPrefixed(l);
      if (pc) { cur.cards.push(pc); continue; }
      const bc = tryBase(l, 9999);
      if (bc) { cur.cards.push({ number: String(bc.number), player: bc.player, team: bc.team, note: bc.note }); continue; }
      } // end splitConcatenated loop
    }
    if (cur) sets.push(cur);
    return sets.filter(s => s.cards.length > 0);
  }

  // Determine section order to correctly assign auto/mem/ins boundaries
  const secMap = { auto: autoStart, mem: memStart, ins: insStart, team: teamStart };
  const ordered = Object.entries(secMap).sort((a, b) => a[1] - b[1]);
  const nextBoundary = (key) => {
    const idx = ordered.findIndex(e => e[0] === key);
    return idx >= 0 && idx + 1 < ordered.length ? ordered[idx + 1][1] : lines.length;
  };

  const autoSets = parseSets(autoStart, nextBoundary('auto'));
  const memSets  = parseSets(memStart,  nextBoundary('mem'));
  const insSets  = parseSets(insStart,  nextBoundary('ins'));

  // ── Parse team sets (object keyed by team name) ──
  const team_sets = {};
  if (teamStart < lines.length) {
    let curTeam = null;
    for (let i = teamStart + 1; i < lines.length; i++) {
      const l = lines[i];
      // Team header line — usually matches "<Set> Checklist – <Team Name>"
      const teamHeader = l.match(/–\s+(.+)$/) || (TEAMS.has(l) ? [null, l] : null);
      if (teamHeader && TEAMS.has(teamHeader[1].trim())) {
        curTeam = teamHeader[1].trim();
        if (!team_sets[curTeam]) team_sets[curTeam] = { base: [] };
        continue;
      }
      if (!curTeam) continue;
      const c = tryBaseNoTeam(l);
      if (c) team_sets[curTeam].base.push(c);
    }
  }

  return {
    slug, set: name, sport,
    release_date: releaseDate,
    set_size: setSize || (baseCards.length > 0 ? Math.max(...baseCards.map(c => c.number)) : 0),
    product_info,
    box_contents,
    parallels,
    base_set: { count: baseCards.length, cards: baseCards },
    insert_sets: insSets,
    autograph_sets: autoSets,
    memorabilia_sets: memSets,
    team_sets,
  };
}

// ── TOPPS CATALOG ─────────────────────────────────────────────────────────────
// beckettUrl: Beckett checklist HTML page — parsed with existing parseBeckettChecklist()
// These are structured HTML pages, far more reliable than PDFs
const TOPPS_CATALOG = [
  // ── Baseball 2026 ──
  { name: '2026 Topps Chrome Baseball', sport: 'baseball', year: '2026', brand: 'Chrome', slug: '2026-topps-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-topps-chrome-baseball-cards/' },
  { name: '2026 Topps Series 1 Baseball', sport: 'baseball', year: '2026', brand: 'Topps', slug: '2026-topps-series-1-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-topps-series-1-baseball-cards/' },
  { name: '2026 Topps Series 2 Baseball', sport: 'baseball', year: '2026', brand: 'Topps', slug: '2026-topps-series-2-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-topps-series-2-baseball-cards/' },
  { name: '2026 Topps Heritage Baseball', sport: 'baseball', year: '2026', brand: 'Heritage', slug: '2026-topps-heritage-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-topps-heritage-baseball-cards/' },
  { name: '2026 Topps Finest Baseball', sport: 'baseball', year: '2026', brand: 'Finest', slug: '2026-topps-finest-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-topps-finest-baseball-cards/' },
  { name: '2026 Bowman Baseball', sport: 'baseball', year: '2026', brand: 'Bowman', slug: '2026-bowman-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-bowman-baseball-cards/' },
  { name: '2026 Bowman Chrome Baseball', sport: 'baseball', year: '2026', brand: 'Bowman Chrome', slug: '2026-bowman-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2026-bowman-chrome-baseball-cards/' },
  // ── Baseball 2025 ──
  { name: '2025 Topps Chrome Baseball', sport: 'baseball', year: '2025', brand: 'Chrome', slug: '2025-topps-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-chrome-baseball-cards/' },
  { name: '2025 Topps Series 1 Baseball', sport: 'baseball', year: '2025', brand: 'Topps', slug: '2025-topps-series-1-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-series-1-baseball-cards/' },
  { name: '2025 Topps Series 2 Baseball', sport: 'baseball', year: '2025', brand: 'Topps', slug: '2025-topps-series-2-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-series-2-baseball-cards/' },
  { name: '2025 Topps Heritage Baseball', sport: 'baseball', year: '2025', brand: 'Heritage', slug: '2025-topps-heritage-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-heritage-baseball-cards/' },
  { name: '2025 Topps Finest Baseball', sport: 'baseball', year: '2025', brand: 'Finest', slug: '2025-topps-finest-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-finest-baseball-cards/' },
  { name: '2025 Topps Allen & Ginter Baseball', sport: 'baseball', year: '2025', brand: 'Allen & Ginter', slug: '2025-topps-allen-ginter-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-allen-ginter-baseball-cards/' },
  { name: '2025 Topps Stadium Club Baseball', sport: 'baseball', year: '2025', brand: 'Stadium Club', slug: '2025-topps-stadium-club-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-stadium-club-baseball-cards/' },
  { name: '2025 Topps Update Baseball', sport: 'baseball', year: '2025', brand: 'Topps', slug: '2025-topps-update-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-update-series-baseball-cards/' },
  { name: '2025 Topps Archives Baseball', sport: 'baseball', year: '2025', brand: 'Archives', slug: '2025-topps-archives-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-archives-baseball-cards/' },
  { name: '2025 Bowman Baseball', sport: 'baseball', year: '2025', brand: 'Bowman', slug: '2025-bowman-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-bowman-baseball-cards/' },
  { name: "2025 Bowman's Best Baseball", sport: 'baseball', year: '2025', brand: "Bowman's Best", slug: '2025-bowmans-best-baseball',
    beckettUrl: "https://www.beckett.com/news/2025-bowmans-best-baseball-cards/" },
  { name: '2025 Bowman Chrome Baseball', sport: 'baseball', year: '2025', brand: 'Bowman Chrome', slug: '2025-bowman-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-bowman-chrome-baseball-cards/' },
  { name: '2025 Bowman Draft Baseball', sport: 'baseball', year: '2025', brand: 'Bowman Draft', slug: '2025-bowman-draft-baseball',
    beckettUrl: 'https://www.beckett.com/news/2025-bowman-draft-baseball-cards/' },
  // ── Baseball 2024 ──
  { name: '2024 Topps Chrome Baseball', sport: 'baseball', year: '2024', brand: 'Chrome', slug: '2024-topps-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-chrome-baseball-cards/' },
  { name: '2024 Topps Series 1 Baseball', sport: 'baseball', year: '2024', brand: 'Topps', slug: '2024-topps-series-1-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-series-1-baseball-cards/' },
  { name: '2024 Topps Series 2 Baseball', sport: 'baseball', year: '2024', brand: 'Topps', slug: '2024-topps-series-2-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-series-2-baseball-cards/' },
  { name: '2024 Topps Update Baseball', sport: 'baseball', year: '2024', brand: 'Topps', slug: '2024-topps-update-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-update-series-baseball-cards/' },
  { name: '2024 Topps Heritage Baseball', sport: 'baseball', year: '2024', brand: 'Heritage', slug: '2024-topps-heritage-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-heritage-baseball-cards/' },
  { name: '2024 Topps Finest Baseball', sport: 'baseball', year: '2024', brand: 'Finest', slug: '2024-topps-finest-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-finest-baseball-cards/' },
  { name: '2024 Topps Allen & Ginter Baseball', sport: 'baseball', year: '2024', brand: 'Allen & Ginter', slug: '2024-topps-allen-ginter-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-allen-ginter-baseball-cards/' },
  { name: '2024 Topps Stadium Club Baseball', sport: 'baseball', year: '2024', brand: 'Stadium Club', slug: '2024-topps-stadium-club-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-stadium-club-baseball-cards/' },
  { name: '2024 Topps Archives Baseball', sport: 'baseball', year: '2024', brand: 'Archives', slug: '2024-topps-archives-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-archives-baseball-cards/' },
  { name: '2024 Bowman Baseball', sport: 'baseball', year: '2024', brand: 'Bowman', slug: '2024-bowman-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-bowman-baseball-cards/' },
  { name: '2024 Bowman Chrome Baseball', sport: 'baseball', year: '2024', brand: 'Bowman Chrome', slug: '2024-bowman-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-bowman-chrome-baseball-cards/' },
  { name: '2024 Bowman Draft Baseball', sport: 'baseball', year: '2024', brand: 'Bowman Draft', slug: '2024-bowman-draft-baseball',
    beckettUrl: 'https://www.beckett.com/news/2024-bowman-draft-baseball-cards/' },
  // ── Baseball 2023 ──
  { name: '2023 Topps Chrome Baseball', sport: 'baseball', year: '2023', brand: 'Chrome', slug: '2023-topps-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-chrome-baseball-cards/' },
  { name: '2023 Topps Series 1 Baseball', sport: 'baseball', year: '2023', brand: 'Topps', slug: '2023-topps-series-1-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-series-1-baseball-cards/' },
  { name: '2023 Topps Series 2 Baseball', sport: 'baseball', year: '2023', brand: 'Topps', slug: '2023-topps-series-2-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-series-2-baseball-cards/' },
  { name: '2023 Topps Update Baseball', sport: 'baseball', year: '2023', brand: 'Topps', slug: '2023-topps-update-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-update-series-baseball-cards/' },
  { name: '2023 Topps Heritage Baseball', sport: 'baseball', year: '2023', brand: 'Heritage', slug: '2023-topps-heritage-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-topps-heritage-baseball-cards/' },
  { name: '2023 Bowman Baseball', sport: 'baseball', year: '2023', brand: 'Bowman', slug: '2023-bowman-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-bowman-baseball-cards/' },
  { name: '2023 Bowman Chrome Baseball', sport: 'baseball', year: '2023', brand: 'Bowman Chrome', slug: '2023-bowman-chrome-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-bowman-chrome-baseball-cards/' },
  { name: '2023 Bowman Draft Baseball', sport: 'baseball', year: '2023', brand: 'Bowman Draft', slug: '2023-bowman-draft-baseball',
    beckettUrl: 'https://www.beckett.com/news/2023-bowman-draft-baseball-cards/' },
  // ── Basketball ──
  { name: '2025-26 Topps Chrome Basketball', sport: 'basketball', year: '2025', brand: 'Chrome', slug: '2025-26-topps-chrome-basketball',
    beckettUrl: 'https://www.beckett.com/news/2025-26-topps-chrome-basketball-cards/' },
  { name: '2024-25 Topps Chrome Basketball', sport: 'basketball', year: '2024', brand: 'Chrome', slug: '2024-25-topps-chrome-basketball',
    beckettUrl: 'https://www.beckett.com/news/2024-25-topps-chrome-basketball-cards/' },
  { name: '2023-24 Topps Chrome Basketball', sport: 'basketball', year: '2023', brand: 'Chrome', slug: '2023-24-topps-chrome-basketball',
    beckettUrl: 'https://www.beckett.com/news/2023-24-topps-chrome-basketball-cards/' },
  // ── Football ──
  { name: '2025 Topps Chrome Football', sport: 'football', year: '2025', brand: 'Chrome', slug: '2025-topps-chrome-football',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-chrome-football-cards/' },
  { name: '2024 Topps Chrome Football', sport: 'football', year: '2024', brand: 'Chrome', slug: '2024-topps-chrome-football',
    beckettUrl: 'https://www.beckett.com/news/2024-topps-chrome-football-cards/' },
  { name: '2025 Topps Chrome Black Football', sport: 'football', year: '2025', brand: 'Chrome Black', slug: '2025-topps-chrome-black-football',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-chrome-black-football-cards/' },
  { name: '2025 Bowman Chrome University Football', sport: 'football', year: '2025', brand: 'Bowman Chrome', slug: '2025-bowman-chrome-university-football',
    beckettUrl: 'https://www.beckett.com/news/2025-bowman-chrome-university-football-cards/' },
  // ── Soccer ──
  { name: '2025-26 Topps Chrome UEFA Champions League', sport: 'soccer', year: '2025', brand: 'Chrome', slug: '2025-26-topps-chrome-ucl',
    beckettUrl: 'https://www.beckett.com/news/2025-26-topps-chrome-uefa-champions-league-cards/' },
  { name: '2025 Topps Chrome MLS', sport: 'soccer', year: '2025', brand: 'Chrome', slug: '2025-topps-chrome-mls',
    beckettUrl: 'https://www.beckett.com/news/2025-topps-chrome-mls-cards/' },
  { name: '2024-25 Topps Chrome UEFA Club Competitions', sport: 'soccer', year: '2024', brand: 'Chrome', slug: '2024-25-topps-chrome-ucc',
    beckettUrl: 'https://www.beckett.com/news/2024-25-topps-chrome-uefa-club-competitions-cards/' },
  // ── Hockey ──
  { name: '2025-26 Topps Chrome Hockey', sport: 'hockey', year: '2025', brand: 'Chrome', slug: '2025-26-topps-chrome-hockey',
    beckettUrl: 'https://www.beckett.com/news/2025-26-topps-chrome-hockey-cards/' },
  { name: '2024-25 Topps Chrome Hockey', sport: 'hockey', year: '2024', brand: 'Chrome', slug: '2024-25-topps-chrome-hockey',
    beckettUrl: 'https://www.beckett.com/news/2024-25-topps-chrome-hockey-cards/' },
];

// ── TOPPS PDF TEXT PARSER ─────────────────────────────────────────────────────
function parseToppsChecklistText(text, meta) {
  const { slug, name, sport = 'baseball', year = '', brand = '' } = meta;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const result = {
    slug, set: name, name, sport, year, brand,
    release_date: year,
    set_size: 0,
    parallels: [],
    base_set: { count: 0, cards: [] },
    insert_sets: [],
    autograph_sets: [],
    memorabilia_sets: [],
  };

  // Section detection
  const SEC_BASE = /^BASE\s*(CARDS?|SET)?$/i;
  const SEC_INSERT = /^INSERTS?(\s+CARDS?|\s+SETS?)?$/i;
  const SEC_AUTO = /^AUTOGRAPH(S|ED)?(\s+CARDS?|\s+SETS?)?$/i;
  const SEC_RELIC = /^(RELIC|RELICS|MEMORABILIA|MEM)(\s+CARDS?|\s+SETS?)?$/i;
  const SEC_AUTO_RELIC = /^(AUTOGRAPH(ED)?|AUTO)\s+(RELIC|MEM)(S|ORABI[LA]+)?(\s+CARDS?)?$/i;

  // Skip sections (variations, short prints etc.)
  const SKIP_SECTION = /^(LIGHTBOARD|IMAGE VARIATION|SUPER SHORT PRINT|SHORT PRINT|PARALLEL|CHROME REFRACTOR VARIATION)/i;

  // Card line: optional prefix, then number, then name, then team (separated by 2+ spaces)
  // Examples: "1  Shohei Ohtani  Los Angeles Dodgers®"
  //           "RA-SS  Roki Sasaki  Seattle Mariners®  [Rookie]"
  //           "UV-1  Player Name  Team Name"
  const cardLine = (l) => {
    // Split on 2+ spaces or tabs
    const parts = l.split(/\s{2,}|\t+/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    // First part: number (pure digits) or prefixed (XX-N or XX-XX)
    const numPart = parts[0];
    const isNum = /^\d+$/.test(numPart);
    const isPrefixed = /^[A-Z0-9]+-[A-Z0-9]+$/i.test(numPart);
    if (!isNum && !isPrefixed) return null;
    // Second part should look like a name (not all-caps multi-word → that's a header)
    const player = parts[1];
    if (!player || /^[A-Z\s&]{4,}$/.test(player)) return null; // all-caps = probably a header
    const team = parts[2] ? parts[2].replace(/[®™]/g, '').trim() : '';
    const rc = parts.some(p => /^\[?rookie\]?$/i.test(p));
    const note = parts.slice(3).filter(p => !/^\[?rookie\]?$/i.test(p)).join(' ') || '';
    return { number: numPart, player, team, rc, note: note || undefined };
  };

  let section = 'base';
  let inSkip = false;
  let currentSubset = null;  // { name, cards[] } in insert_sets or autograph_sets
  let currentCollection = null; // 'inserts' | 'autos' | 'mem' | 'auto_mem'

  const pushSubset = () => {
    if (!currentSubset) return;
    if (currentSubset.cards.length === 0) return;
    if (currentCollection === 'inserts') result.insert_sets.push(currentSubset);
    else if (currentCollection === 'autos') result.autograph_sets.push(currentSubset);
    else if (currentCollection === 'mem' || currentCollection === 'auto_mem') result.memorabilia_sets.push(currentSubset);
    currentSubset = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    // Major section headers
    if (SEC_BASE.test(l)) { pushSubset(); section = 'base'; inSkip = false; continue; }
    if (SEC_AUTO_RELIC.test(l)) { pushSubset(); section = 'auto_mem'; currentCollection = 'auto_mem'; inSkip = false; continue; }
    if (SEC_AUTO.test(l)) { pushSubset(); section = 'auto'; currentCollection = 'autos'; inSkip = false; continue; }
    if (SEC_RELIC.test(l)) { pushSubset(); section = 'mem'; currentCollection = 'mem'; inSkip = false; continue; }
    if (SEC_INSERT.test(l)) { pushSubset(); section = 'insert'; currentCollection = 'inserts'; inSkip = false; continue; }

    // Skip variation sub-sections
    if (SKIP_SECTION.test(l)) { inSkip = true; continue; }
    if (inSkip) {
      // Exit skip when we hit a card line or a new major section
      const c = cardLine(l);
      if (c) { inSkip = false; } else continue;
    }

    // Sub-section header in non-base sections (all-caps, no number prefix)
    if (section !== 'base' && /^[A-Z][A-Z\s\-&'/]{3,}$/.test(l) && !cardLine(l)) {
      pushSubset();
      currentSubset = { name: l, cards: [] };
      continue;
    }

    const card = cardLine(l);
    if (!card) continue;

    if (section === 'base') {
      const num = parseInt(card.number, 10);
      result.base_set.cards.push({ number: isNaN(num) ? card.number : num, player: card.player, team: card.team, rc: card.rc || undefined, note: card.note || undefined });
    } else {
      if (!currentSubset) {
        // Cards before any named subset — create a generic subset
        const defaultName = section === 'auto' ? 'Autographs' : section === 'mem' ? 'Relics' : section === 'auto_mem' ? 'Autograph Relics' : 'Inserts';
        currentSubset = { name: defaultName, cards: [] };
      }
      currentSubset.cards.push({ number: card.number, player: card.player, team: card.team, rc: card.rc || undefined, note: card.note || undefined });
    }
  }
  pushSubset();

  result.base_set.count = result.base_set.cards.length;
  result.set_size = result.base_set.cards.length;
  return result;
}

// ── TOPPS CHECKLISTS PAGE SCRAPER ─────────────────────────────────────────────
async function fetchToppsChecklistCatalog() {
  const res = await fetch('https://www.topps.com/pages/checklists', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    },
  }).catch(() => null);

  if (!res || !res.ok) return null;
  const html = await res.text();
  return parseToppsChecklistsHtml(html);
}

function parseToppsChecklistsHtml(html) {
  const sets = [];
  // Remove script/style blocks
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

  // Look for <a href="..."> tags — Topps links to PDFs (their CDN) or product pages
  const linkRe = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(clean)) !== null) {
    let url = m[1].trim();
    const rawName = m[2].replace(/<[^>]+>/g, '').replace(/[®™]/g, '').trim();
    if (!rawName || rawName.length < 8) continue;
    // Only take links that look like checklists (PDF, or Shopify files, or have year in name)
    const looksLikeChecklist = url.includes('.pdf') || url.includes('/files/') ||
      url.includes('checklist') || (/\d{4}/.test(rawName) && rawName.length > 10);
    if (!looksLikeChecklist) continue;
    // Skip nav/footer links
    if (/^(help|account|sign|cart|search|all-products|explore)/i.test(rawName)) continue;

    if (url.startsWith('/')) url = 'https://www.topps.com' + url;
    if (!url.startsWith('http')) continue;

    const { year, sport, brand } = guessSetMeta(rawName);
    const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    sets.push({ name: rawName, url, slug, sport, year, brand });
  }

  // Deduplicate by slug
  const seen = new Set();
  return sets.filter(s => { if (seen.has(s.slug)) return false; seen.add(s.slug); return true; });
}

function guessSetMeta(name) {
  const n = name.toLowerCase();
  const yearM = name.match(/(\d{4})/);
  const year = yearM ? yearM[1] : '';

  let sport = 'baseball';
  if (/basketball|nba/i.test(n)) sport = 'basketball';
  else if (/football|nfl|gridiron/i.test(n)) sport = 'football';
  else if (/soccer|mls|ucl|uefa|laliga|bundesliga|premier/i.test(n)) sport = 'soccer';
  else if (/hockey|nhl/i.test(n)) sport = 'hockey';
  else if (/star wars|marvel|disney|entertainment|non-sport/i.test(n)) sport = 'non-sport';

  let brand = 'Topps';
  if (/bowman chrome/i.test(n)) brand = 'Bowman Chrome';
  else if (/bowman's best/i.test(n)) brand = "Bowman's Best";
  else if (/bowman draft/i.test(n)) brand = 'Bowman Draft';
  else if (/bowman/i.test(n)) brand = 'Bowman';
  else if (/chrome.*black|black.*chrome/i.test(n)) brand = 'Chrome Black';
  else if (/cosmic chrome/i.test(n)) brand = 'Cosmic Chrome';
  else if (/chrome/i.test(n)) brand = 'Chrome';
  else if (/heritage/i.test(n)) brand = 'Heritage';
  else if (/finest/i.test(n)) brand = 'Finest';
  else if (/allen.*ginter|ginter/i.test(n)) brand = 'Allen & Ginter';
  else if (/stadium club/i.test(n)) brand = 'Stadium Club';
  else if (/archives/i.test(n)) brand = 'Archives';
  else if (/update/i.test(n)) brand = 'Topps Update';
  else if (/brooklyn/i.test(n)) brand = 'Brooklyn Collection';
  else if (/star wars|marvel/i.test(n)) brand = 'Entertainment';

  return { year, sport, brand };
}

// ── PDF TEXT EXTRACTOR ────────────────────────────────────────────────────────
async function decompressRaw(data) {
  try {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(data);
    writer.close();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  } catch (_) {
    // Try with zlib wrapper (2-byte zlib header)
    try {
      const ds2 = new DecompressionStream('deflate');
      const writer2 = ds2.writable.getWriter();
      const reader2 = ds2.readable.getReader();
      writer2.write(data);
      writer2.close();
      const chunks2 = [];
      while (true) {
        const { done, value } = await reader2.read();
        if (done) break;
        chunks2.push(value);
      }
      const total2 = chunks2.reduce((a, c) => a + c.length, 0);
      const out2 = new Uint8Array(total2);
      let off2 = 0;
      for (const c of chunks2) { out2.set(c, off2); off2 += c.length; }
      return out2;
    } catch (_2) { return null; }
  }
}

function pdfUnescapeStr(s) {
  return s
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
    .replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

function pdfHexToStr(hex) {
  let s = '';
  // Handle UTF-16BE (common in PDFs with BOM FEFF)
  if (hex.startsWith('feff') || hex.startsWith('FEFF')) {
    for (let i = 4; i < hex.length; i += 4) {
      s += String.fromCodePoint(parseInt(hex.slice(i, i + 4), 16));
    }
    return s;
  }
  for (let i = 0; i < hex.length; i += 2) {
    s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return s;
}

function extractTextFromContentStream(content) {
  const lines = [];
  const btEtRe = /BT([\s\S]*?)ET/g;
  let m;
  while ((m = btEtRe.exec(content)) !== null) {
    const block = m[1];
    const partRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|TJ)|\[([\s\S]*?)\]\s*TJ/g;
    let pm;
    while ((pm = partRe.exec(block)) !== null) {
      if (pm[1] !== undefined) {
        lines.push(pdfUnescapeStr(pm[1]));
      } else if (pm[2]) {
        const arr = pm[2];
        const parts = [];
        const innerRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)|<([0-9a-fA-F]+)>/g;
        let im;
        while ((im = innerRe.exec(arr)) !== null) {
          if (im[1] !== undefined) parts.push(pdfUnescapeStr(im[1]));
          else if (im[2]) parts.push(pdfHexToStr(im[2]));
        }
        if (parts.length) lines.push(parts.join(''));
      }
    }
    lines.push(''); // paragraph break between BT/ET blocks
  }
  return lines.filter(Boolean).join('\n');
}

async function extractPdfText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  // Build latin-1 string for regex parsing
  let raw = '';
  for (let i = 0; i < Math.min(bytes.length, 20 * 1024 * 1024); i++) {
    raw += String.fromCharCode(bytes[i]);
  }

  const allText = [];

  // Find all objects to check for streams
  const objRe = /(\d+\s+\d+\s+obj[\s\S]*?)endobj/g;
  let om;
  while ((om = objRe.exec(raw)) !== null) {
    const obj = om[1];
    const streamMatch = obj.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    if (!streamMatch) continue;

    const isFlate = /FlateDecode/i.test(obj) || /\/Fl\b/.test(obj);
    const isText = !/\/Subtype\s*\/Image/i.test(obj) && !/\/XObject/i.test(obj);
    if (!isText) continue;

    let content;
    if (isFlate) {
      const streamStr = streamMatch[1];
      const streamBytes = new Uint8Array(streamStr.length);
      for (let i = 0; i < streamStr.length; i++) streamBytes[i] = streamStr.charCodeAt(i) & 0xff;
      const decompressed = await decompressRaw(streamBytes);
      if (!decompressed) continue;
      content = new TextDecoder('latin1').decode(decompressed);
    } else {
      content = streamMatch[1];
    }

    const text = extractTextFromContentStream(content);
    if (text && text.trim().length > 10) allText.push(text);
  }

  // Also try direct BT/ET extraction on raw (for uncompressed PDFs)
  if (allText.length === 0) {
    const directText = extractTextFromContentStream(raw);
    if (directText.trim()) allText.push(directText);
  }

  return allText.join('\n');
}
