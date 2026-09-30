import { comicSearchClient, COMIC_SEARCH_CSS } from './comic-search-client.mjs';

export const SEARCH_KINDS = ['stock', 'preorder', 'backorder'];
export function searchTerms(value) {
  return String(value || '').normalize('NFKC').toLowerCase().slice(0, 160).match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) || [];
}
function searchFilter(terms, fields) {
  return '(' + terms.map(term => 'or(' + fields.map(field => `${field}.ilike.*${term}*`).join(',') + ')').join(',') + ')';
}
function page(rows, offset, limit) {
  return { results: rows.slice(0, limit), offset, nextOffset: offset + Math.min(rows.length, limit), hasMore: rows.length > limit };
}
async function query(db, table, params) {
  const result = await db(table + '?' + new URLSearchParams(params));
  if (result.response && !result.response.ok) throw new Error('Catalog unavailable');
  if (!Array.isArray(result.data)) throw new Error('Catalog unavailable');
  return result.data;
}

// Read-only public fields, fixed store, bounded pages. Each source can fail
// independently without disguising an unavailable catalog as zero matches.
export async function searchComics(url, deps) {
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 160);
  const terms = searchTerms(q);
  const kind = url.searchParams.get('kind');
  const kinds = SEARCH_KINDS.includes(kind) ? [kind] : SEARCH_KINDS;
  const offset = Math.min(100000, Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0));
  const limit = Math.min(48, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 12));
  if (!terms.length) return { q, sections: {}, emptyQuery: true };
  const sections = {};
  await Promise.all(kinds.map(async key => {
    try {
      let rows;
      if (key === 'stock') {
        rows = (await deps.listItems()).filter(item => item.categorySlug === 'comics' && deps.isAvailable(item))
          .filter(item => { const text = [item.name, item.set, item.brand, item.cardNumber].join(' ').normalize('NFKC').toLowerCase(); return terms.every(term => text.includes(term)); })
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          .slice(offset, offset + limit + 1)
          .map(item => ({ id: item.id, title: item.name, image: item.image, priceCents: Math.round(item.price * 100), detail: item.condition || 'Ready to ship', href: item.linkUrl || '/item/' + encodeURIComponent(item.id) + '/' + deps.itemSlug(item) }));
      } else if (key === 'preorder') {
        rows = await query(deps.db, 'comic_skus', {
          store_id: 'eq.' + deps.storeId, customer_enabled: 'eq.true',
          select: 'id,title,variant_label,cover_image_url,customer_price_cents,is_incentive,on_sale_date,publisher,foc_cycles!inner(status,customer_cutoff_at)',
          'foc_cycles.status': 'eq.open', 'foc_cycles.customer_cutoff_at': 'gt.' + new Date().toISOString(),
          and: searchFilter(terms, ['title', 'writer', 'publisher', 'upc']), order: 'title.asc,id.asc', limit: limit + 1, offset,
        });
        rows = rows.map(row => ({ id: row.id, title: row.title, image: row.cover_image_url, priceCents: Number(row.customer_price_cents) || null,
          detail: [row.variant_label, row.publisher, row.is_incentive ? 'Limited cover — check availability' : '', row.on_sale_date ? 'Releases ' + row.on_sale_date : ''].filter(Boolean).join(' · '), href: '/preorder/' + encodeURIComponent(row.id) }));
      } else {
        rows = await query(deps.db, 'backlist_titles', {
          store_id: 'eq.' + deps.storeId, is_published: 'eq.true',
          select: 'id,title,publisher,format_name,cover_image_url,backlist_skus!inner(id,customer_price_cents,msrp_cents)',
          'backlist_skus.is_published': 'eq.true', 'backlist_skus.is_orderable': 'eq.true',
          'backlist_skus.or': '(customer_enabled.eq.true,customer_enabled.is.null)',
          'backlist_skus.and': '(or(customer_price_cents.gt.0,and(or(customer_price_cents.eq.0,customer_price_cents.is.null),msrp_cents.gt.0)))',
          and: searchFilter(terms, ['title', 'writer', 'series_name']), order: 'title.asc,id.asc', limit: limit + 1, offset,
        });
        rows = rows.map(row => ({ id: row.id, title: row.title, image: row.cover_image_url,
          priceCents: Math.min(...row.backlist_skus.map(s => Number(s.customer_price_cents || s.msrp_cents))),
          detail: [row.format_name, row.publisher, 'Ordered from publisher'].filter(Boolean).join(' · '), href: '/book/' + encodeURIComponent(row.id) }));
      }
      sections[key] = page(rows, offset, limit);
    } catch (error) {
      console.warn('Comic search source unavailable:', key, error.message);
      sections[key] = { results: [], offset, nextOffset: offset, hasMore: false, error: 'Temporarily unavailable. Please retry.' };
    }
  }));
  return { q, sections };
}

export function comicSearchShell() {
  return `<section id="mp-comic-search" aria-label="Search all comics"><form action="/comics/search" role="search"><label for="mp-comic-query">Find your next comic</label><p>One search. In stock, preorders, and publisher backorders.</p><div class="mp-cs-input"><input id="mp-comic-query" name="q" type="search" maxlength="160" placeholder="Search a title, series, or creator…" autocomplete="off"><button type="submit">Search</button><button type="button" data-cs-clear hidden>Clear</button></div></form><p data-cs-status role="status" aria-live="polite"></p><div data-cs-results></div></section>`;
}

export function comicSearchScriptResponse() {
  // Wrangler's keepNames transform inserts __name calls inside serialized functions.
  // Supply the helper in the browser closure as well as the Worker bundle.
  return new Response('(()=>{const __name=(fn,name)=>Object.defineProperty(fn,"name",{value:name,configurable:true});(' + comicSearchClient.toString() + ')(' + JSON.stringify(COMIC_SEARCH_CSS) + ',' + JSON.stringify(comicSearchShell()) + ');})();', { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}

export function injectComicSearch(response, request) {
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  if (request.method !== 'GET' || !['/books', '/preorders', '/shop', '/comic-new-releases-the-mana-pocket', '/category/comics', '/comics/search'].includes(path) || !response.headers.get('Content-Type')?.includes('text/html')) return response;
  return new HTMLRewriter().on('body', { element(el) { el.append('<script defer src="/comics/search.js"></script>', { html: true }); } }).transform(response);
}
