import { ORIGIN, catalogURL, parsePage } from './parser.mjs';
export const freshState = () => ({ version: 1, queue: [{ url: ORIGIN + '/', kind: 'category' }], visited: [], sources: {}, products: {}, failures: [], pages: 0, started_at: new Date().toISOString(), finished_at: '', message: 'Ready to collect every category.' });
export function enqueue(state, job) {
  const url = catalogURL(job.url);
  if (!url) return;
  if (job.category && job.kind === 'product') state.sources[url] = [...new Set([...(state.sources[url] || []), job.category])];
  if (!state.visited.includes(url) && !state.queue.some(j => j.url === url)) state.queue.push({ ...job, url });
}
export function acceptPage(state, job, page) {
  if (page.product) {
    const p = page.product;
    const old = Object.hasOwn(state.products,p.sku) ? state.products[p.sku] : null;
    if (old && old.product_url !== p.product_url) {
      state.failures.push({ url: job.url, error: 'Same SKU found at multiple product URLs: ' + p.sku });
    }
    p.category_paths = [...new Set([...(old?.category_paths || []), ...(state.sources[job.url] || [])])];
    Object.defineProperty(state.products,p.sku,{value:p,enumerable:true,writable:true,configurable:true});
  } else {
    for (const url of page.categories) enqueue(state, { url, kind: 'category' });
    for (const url of page.next) enqueue(state, { url, kind: 'category' });
    for (const url of page.productLinks) enqueue(state, { url, kind: 'product', category: page.category });
  }
  state.visited.push(job.url); state.pages++;
  state.queue = state.queue.filter(j => j.url !== job.url);
}
export function collectedProducts(state) {
  return Object.values(state.products).map(p => ({ ...p,
    review_notes: [p.review_notes, state.failures.some(f => f.url === p.product_url) ? 'Refresh failed; this is the last saved snapshot' : ''].filter(Boolean).join('; '),
    category_paths: [...new Set([...(p.category_paths || []), ...(state.sources[p.product_url] || [])])] })).sort((a,b) => a.sku.localeCompare(b.sku));
}
export async function fetchHTML(url, { fetcher = fetch, signal } = {}) {
  const response = await fetcher(url, { credentials: 'include', cache: 'no-store', signal: signal || AbortSignal.timeout(30000) });
  if (!response.ok) {
    const error = new Error('BCW returned HTTP ' + response.status);
    error.pause = [401,403,429].includes(response.status); throw error;
  }
  if (new URL(response.url || url).origin !== ORIGIN) throw new Error('BCW redirected outside its catalog.');
  if (/\/customer\/account\/login/.test(response.url || '')) { const e = new Error('Sign in to BCW in this Chrome profile, then resume.'); e.pause = true; throw e; }
  if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('BCW page is unexpectedly large.');
  const html = await response.text();
  if (html.length > 8 * 1024 * 1024) throw new Error('BCW page is unexpectedly large.');
  return html;
}
export async function verifySession(fetcher = fetch) {
  const html = await fetchHTML(ORIGIN + '/customer/account/', { fetcher });
  if (/id=["']login-form["']/.test(html) || !/block-dashboard-info|customer-account-index|customer-account-logout/.test(html)) {
    const e = new Error('Sign in to your BCW wholesale account in this Chrome profile, then resume.'); e.pause = true; throw e;
  }
  // Account HTML contains personal information; intentionally discard it.
}
export async function runQueue(state, { save, notify, shouldStop, fetcher = fetch, parser = parsePage, verify = verifySession, delay = ms => new Promise(r => setTimeout(r, ms)) }) {
  await verify(fetcher);
  let sinceAuth = 0;
  while (state.queue.length && !shouldStop()) {
    if (++sinceAuth > 25) { await verify(fetcher); sinceAuth = 0; }
    const job = state.queue[0];
    state.message = 'Collecting ' + job.url.replace(ORIGIN, ''); notify(state);
    try {
      const html = await fetchHTML(job.url, { fetcher });
      const page = parser(html, job.url);
      acceptPage(state, job, page);
    } catch (error) {
      if (error.pause || /verification/.test(error.message)) throw error;
      job.attempts = (job.attempts || 0) + 1;
      if (job.attempts >= 3) {
        state.failures.push({ ...job, error: error.message }); state.queue.shift();
      } else state.message = 'Retry ' + job.attempts + '/3: ' + error.message;
    }
    await save(state); notify(state);
    if (!shouldStop()) await delay(1500 + (job.attempts || 0) * 2000);
  }
  if (!state.queue.length) {
    state.finished_at = new Date().toISOString();
    state.message = state.failures.length ? 'Collection finished with exceptions. Review the report or retry failed pages.' : 'Collection finished. Review your prices and export.';
  } else state.message = 'Paused. Your progress is saved.';
  await save(state); notify(state);
}
