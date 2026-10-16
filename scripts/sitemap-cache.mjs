const PATHS = new Set(['/sitemap-books.xml', '/sitemap-preorders.xml']);

// Only these public, parameter-independent XML documents may share a cache key.
export async function cachedCatalogSitemap(request, ctx, generate, cache = globalThis.caches?.default) {
  const url = new URL(request.url);
  if (url.hostname !== 'www.themanapocket.com' || !PATHS.has(url.pathname) || !['GET', 'HEAD'].includes(request.method)) return null;
  url.search = '';
  const key = new Request(url.toString());
  const cacheUrl = new URL(url);
  if (url.pathname === '/sitemap-preorders.xml') cacheUrl.searchParams.set('_catalog_version','coverage-20261015-ratio');
  const cacheKey = new Request(cacheUrl.toString());
  let response;
  try { response = await cache?.match(cacheKey); } catch { /* Cache failures must not break discovery. */ }
  const hit = !!response;
  if (!response) {
    response = await generate(key);
    if (response.status === 200 && response.headers.get('content-type')?.includes('application/xml') && cache) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
    }
  }
  const headers = new Headers(response.headers);
  headers.set('X-Mana-Sitemap-Cache', hit ? 'HIT' : 'MISS');
  return new Response(request.method === 'HEAD' ? null : response.body, {status: response.status, headers});
}
