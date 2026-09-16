import { freshState, collectedProducts, runQueue } from './engine.mjs';
import { exportCSV } from './csv.mjs';
const $ = id => document.getElementById(id);
const KEY = 'bcw-catalog-v1';
let state = (await chrome.storage.local.get(KEY))[KEY] || freshState();
let running = false, stop = false;
const save = async () => chrome.storage.local.set({ [KEY]: state });
const fmt = n => n == null || n === '' ? '—' : '$' + Number(n).toFixed(2);
function render() {
  const products = collectedProducts(state);
  $('status').textContent = state.message;
  $('products').textContent = products.length;
  $('pages').textContent = state.pages;
  $('remaining').textContent = state.queue.length;
  $('issues').textContent = state.failures.length + products.filter(p => p.review_notes).length;
  $('start').disabled = running || !state.queue.length;
  $('start').textContent = state.pages ? 'Resume collection' : 'Collect entire catalog';
  $('pause').disabled = !running;
  $('retry').disabled = running || !state.failures.length;
  $('refresh').disabled = running || !products.length || !!state.queue.length;
  $('rescan').disabled = running || !!state.queue.length || !products.length;
  $('export').disabled = running || !products.length;
  $('report').disabled = running || (!products.length && !state.failures.length);
  $('export-summary').textContent = `${products.filter(p => !p.requires_options).length} products eligible for CSV; ${products.filter(p => p.requires_options).length} option-based products held for review. ${state.queue.length ? 'Collection is incomplete.' : ''}`;
  const filter = $('search').value.toLowerCase();
  $('rows').replaceChildren();
  for (const p of products.filter(p => [p.name,p.sku,...p.category_paths].join(' ').toLowerCase().includes(filter)).slice(0,100)) {
    const tr = document.createElement('tr');
    for (const value of [p.name, fmt(p.cost), fmt(p.msrp), p.availability.replaceAll('_',' '), p.review_notes || '—']) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    const small = document.createElement('small'); small.textContent = p.sku + ' · ' + p.selling_unit; tr.firstChild.append(small);
    if (p.review_notes) tr.lastChild.className = 'warning';
    $('rows').append(tr);
  }
}
async function start(prepare) {
  if (running) return;
  if (!$('wholesale').checked) { state.message = 'Sign in and confirm your wholesale account above first.'; render(); return; }
  await navigator.locks.request('bcw-catalog-collection', { ifAvailable: true }, async lock => {
    if (!lock) { state.message = 'Another collector tab is running. Use that tab or pause it first.'; render(); return; }
    state = (await chrome.storage.local.get(KEY))[KEY] || state;
    if (typeof prepare === 'function') { prepare(); await save(); }
    running = true; stop = false; render();
    try { await runQueue(state, { save, notify: render, shouldStop: () => stop }); }
    catch (e) { state.message = e.message + ' Progress saved; resume when ready.'; await save(); }
    finally { running = false; render(); }
  });
}
$('start').addEventListener('click', start);
$('pause').addEventListener('click', () => { stop = true; state.message = 'Pausing after the current page…'; render(); });
$('retry').addEventListener('click', () => start(() => {
  const urls = new Set(state.queue.map(j => j.url));
  for (const {url,kind,category} of state.failures) if (!urls.has(url)) { state.queue.push({url,kind:kind || 'product',category}); urls.add(url); }
  state.failures = []; state.finished_at = '';
}));
$('refresh').addEventListener('click', () => start(() => {
  state.queue = collectedProducts(state).map(p => ({url:p.product_url,kind:'product'}));
  state.visited = []; state.failures = []; state.pages = 0; state.finished_at = ''; state.started_at = new Date().toISOString();
}));
$('search').addEventListener('input', render);
$('rescan').addEventListener('click',() => start(() => {
  const previous = state.products;
  state = freshState(); state.products = previous;
}));
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], {type})); const a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('export').addEventListener('click', () => {
  const markup = Number($('markup').value);
  if (!Number.isFinite(markup) || markup < 0 || markup > 1000) { state.message = 'Enter a markup from 0 to 1000%.'; render(); return; }
  download('bcw-catalog-' + new Date().toISOString().slice(0,10) + '.csv', exportCSV(collectedProducts(state).filter(p => !p.requires_options), $('pricing').value, markup), 'text/csv;charset=utf-8');
});
$('report').addEventListener('click', () => download('bcw-catalog-report.json', JSON.stringify({ ...state, products:collectedProducts(state), wholesale_cost_note:'Account display price; verify your wholesale account. Shipping excluded.' },null,2), 'application/json'));
render();
