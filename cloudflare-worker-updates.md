# Cloudflare Worker Updates

Use this file to update the existing Cloudflare Worker in the Cloudflare dashboard.

Worker URL currently used by the HTML apps:

```txt
https://still-resonance-4f87.swarnerauto.workers.dev
```

## 1. Add These Helper Functions Near The Top

Place these after `json(...)` and before `export default`.

```js
function errorMessageFromWebflow(data, fallback = 'Webflow error') {
  return data?.msg
    || data?.message
    || data?.errors?.[0]?.message
    || data?.errors?.[0]?.longMessage
    || fallback;
}

async function md5Hex(bytes) {
  const digest = await crypto.subtle.digest('MD5', bytes);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeWebflowItemId(item) {
  return item?.shopId || item?.wfId || item?.id || null;
}
```

## 2. Replace The Existing `/upload-image` Route With This

Replace the whole current block:

```js
if (url.pathname === '/upload-image') {
  ...
}
```

with:

```js
if (url.pathname === '/upload-image') {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!env.WEBFLOW_TOKEN) return json({ error: 'WEBFLOW_TOKEN not set' }, 500);

  try {
    const { base64, fileName, mimeType } = await request.json();
    if (!base64 || !fileName) return json({ error: 'base64 and fileName required' }, 400);

    const mime = mimeType || 'image/jpeg';
    const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-').substring(0, 100);

    const rawBase64 = String(base64).includes(',')
      ? String(base64).split(',').pop()
      : String(base64);

    const binaryStr = atob(rawBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const fileHash = await md5Hex(bytes);

    const metaRes = await fetch(`${WEBFLOW_BASE}/sites/${SITE_ID}/assets`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.WEBFLOW_TOKEN,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({ fileName: cleanName, fileHash }),
    });

    const metaText = await metaRes.text();
    let meta;
    try { meta = JSON.parse(metaText); } catch (_) { meta = { raw: metaText }; }

    if (!metaRes.ok) {
      console.error('Webflow asset pre-sign failed:', metaRes.status, metaText.substring(0, 300));
      return json({
        error: 'Asset pre-sign failed: ' + metaRes.status,
        detail: errorMessageFromWebflow(meta, metaText.substring(0, 300)),
      }, metaRes.status);
    }

    const uploadDetails = meta.uploadDetails || {};
    const uploadUrl = uploadDetails.uploadUrl || meta.uploadUrl || meta.upload_url;
    const assetId = meta.id || meta.asset?.id;
    let finalUrl = meta.hostedUrl || meta.asset?.hostedUrl || meta.asset?.hosted_url || null;

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

    return json({
      ok: true,
      url: finalUrl,
      assetId,
      fileName: cleanName,
      fileHash,
    });

  } catch (e) {
    console.error('Image upload error:', e);
    return json({ error: e.message }, 500);
  }
}
```

## 3. Add This New `/pos/checkout` Route

Place this before the generic `/proxy/...` route.

```js
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
        results.push({
          ok: false,
          name: item.name || 'Unknown item',
          error: 'Missing Webflow item id',
        });
        continue;
      }

      const itemCost = Number(item.cost || 0);
      const salePrice = Number(item.price || 0);

      const wfRes = await fetch(`${WEBFLOW_BASE}/collections/${item.collectionId || '65eb45a28ff6bf3fe4f17b14'}/items/${itemId}`, {
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
            'status': 'e6b42f14fcb99aa2168a5f5672226f68',
            'sale-price': salePrice,
            'profit': salePrice - itemCost,
            'sale-channel': method,
            'date-sold': soldAt,
          },
        }),
      });

      const txt = await wfRes.text();
      let data;
      try { data = JSON.parse(txt); } catch (_) { data = { raw: txt }; }

      if (!wfRes.ok) {
        results.push({
          ok: false,
          id: itemId,
          name: item.name || 'Unknown item',
          status: wfRes.status,
          error: errorMessageFromWebflow(data, txt.substring(0, 200)),
        });
      } else {
        results.push({
          ok: true,
          id: itemId,
          name: item.name || 'Unknown item',
        });
      }
    }

    const failed = results.filter(r => !r.ok);

    if (env.LBA_KV) {
      await env.LBA_KV.put(`pos_tx:${txId}`, JSON.stringify({
        ...body,
        txId,
        soldAt,
        syncResults: results,
      }), { expirationTtl: 60 * 60 * 24 * 180 });

      if (!failed.length) {
        await env.LBA_KV.put('pos_cart', JSON.stringify({
          items: [],
          discount: 0,
          total: 0,
          clearedAt: soldAt,
          lastTxId: txId,
        }), { expirationTtl: 86400 });
      }
    } else if (!failed.length) {
      globalThis._lbaCart = JSON.stringify({
        items: [],
        discount: 0,
        total: 0,
        clearedAt: soldAt,
        lastTxId: txId,
      });
    }

    return json({
      ok: failed.length === 0,
      txId,
      soldAt,
      results,
      failed,
    }, failed.length ? 207 : 200);

  } catch (e) {
    console.error('POS checkout error:', e);
    return json({ error: e.message }, 500);
  }
}
```

## 4. Optional Scanner Change Later

The current scanner now waits for browser-side Webflow updates. After this Worker route is live, the scanner can be simplified to call:

```js
await fetch(WORKER_URL + '/pos/checkout', {
  method: 'POST',
  headers: {'Content-Type':'application/json'},
  body: JSON.stringify({
    txId: tx.id,
    method,
    soldAt,
    items: cartSnapshot,
    totals: getCartTotals(),
  }),
});
```

That can replace the per-item browser PATCH loop in `recordTransaction(...)`.

---

## 5. Add SportsCardsPro Proxy Routes

Place **both blocks** before the generic `/proxy/...` catch-all route.  These are read-only GET proxies — no API key needed, Cloudflare edge cache keeps traffic low.

```js
// ── SportsCardsPro: candidate list ────────────────────────────────────────
// dashboard.html calls: GET /pricing/sportscardspro/products?q=QUERY
if (url.pathname === '/pricing/sportscardspro/products') {
  const q = url.searchParams.get('q') || '';
  if (!q) return json({ ok: false, error: 'q required' }, 400);

  const upstream = 'https://www.sportscardspro.com/api/products?' +
    new URLSearchParams({ q });

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

  return json({ ok: res.ok, status: res.status, ...data });
}

// ── SportsCardsPro: single-product hydration ──────────────────────────────
// dashboard.html calls: GET /pricing/sportscardspro/product?id=ID
if (url.pathname === '/pricing/sportscardspro/product') {
  const id = url.searchParams.get('id') || '';
  if (!id) return json({ ok: false, error: 'id required' }, 400);

  const upstream = 'https://www.sportscardspro.com/api/product?' +
    new URLSearchParams({ id });

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

  return json({ ok: res.ok, status: res.status, ...data });
}
```

