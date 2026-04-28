/**
 * LBA Proxy Worker - Cloudflare Worker
 * Worker URL: https://still-resonance-4f87.swarnerauto.workers.dev
 *
 * Secrets / bindings expected:
 *   ANTHROPIC_API_KEY
 *   WEBFLOW_TOKEN
 *   PSA_TOKEN
 *   STRIPE_SECRET_KEY
 *   EBAY_USER_TOKEN
 *   EBAY_APP_ID
 *   COMICVINE_API_KEY
 *   LBA_KV
 */

const WEBFLOW_BASE = 'https://api.webflow.com/v2';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const SITE_ID = '65b15ee0228d06647ca7e4ce';
const WF_PRODUCTS = '65eb45a28ff6bf3fe4f17b14';
const WF_STATUS_SOLD = 'e6b42f14fcb99aa2168a5f5672226f68';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, accept',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
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
        comicvine: !!env.COMICVINE_API_KEY,
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

    if (url.pathname === '/ebay/list') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      if (!env.EBAY_USER_TOKEN) return json({ needsToken: true, error: 'EBAY_USER_TOKEN not set' }, 401);

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
            'Authorization': 'Bearer ' + env.EBAY_USER_TOKEN,
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
        if (features) aspects['Features'] = String(features).split(',').map(s => s.trim()).filter(Boolean);
        for (const [k, v] of Object.entries(customAspects || {})) {
          if (!k || v == null || v === '') continue;
          aspects[k] = Array.isArray(v) ? v.map(String) : [String(v)];
        }
        aspects['Sport'] = aspects['Sport'] || ['Trading Cards'];

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
            'Authorization': 'Bearer ' + env.EBAY_USER_TOKEN,
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
            'Authorization': 'Bearer ' + env.EBAY_USER_TOKEN,
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
          headers: { 'Authorization': 'Bearer ' + env.EBAY_USER_TOKEN, 'Content-Type': 'application/json' },
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

    return json({ error: 'Not found' }, 404);
  },
};
