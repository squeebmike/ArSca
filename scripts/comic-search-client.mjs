export const COMIC_SEARCH_CSS = `
#mp-comic-search{box-sizing:border-box;width:100%;max-width:1500px;margin:22px auto;padding:20px;background:#151720;color:#f5f5f2;border:1px solid #4e385f;border-radius:12px;font:16px/1.5 system-ui,sans-serif}
#mp-comic-search *{box-sizing:border-box}#mp-comic-search label{font-size:24px;font-weight:800}#mp-comic-search p{margin:6px 0 14px;color:#d0ccd5}.mp-cs-input{display:flex;gap:8px;flex-wrap:wrap}.mp-cs-input input{flex:1;min-width:180px;margin:0;background:#fff;color:#17131c;border:2px solid #a56ccd;border-radius:7px;padding:12px;font-size:16px;height:auto}
#mp-comic-search button{cursor:pointer;min-height:44px;padding:10px 16px;border:1px solid #ac7bcc;border-radius:7px;background:#53366b;color:white;font:700 14px system-ui}#mp-comic-search button:disabled{opacity:.6;cursor:wait}#mp-comic-search [hidden]{display:none!important}
.mp-cs-section{margin-top:24px}.mp-cs-section h2{font:800 22px system-ui;color:#f5f5f2;margin:0 0 14px}.mp-cs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:14px}.mp-cs-card{display:flex;flex-direction:column;border:1px solid #44364e;padding:12px;border-radius:8px;background:#20212b;min-width:0}.mp-cs-card a{color:#fff;text-decoration:none}.mp-cs-card img{width:100%;height:220px;object-fit:contain;background:#12131a;border-radius:4px}.mp-cs-card h3{font:700 16px/1.35 system-ui;margin:10px 0;overflow-wrap:anywhere}.mp-cs-card p{font-size:13px}.mp-cs-price{font-weight:800;color:#fff!important}.mp-cs-card .mp-cs-action{margin-top:auto;padding-top:10px;text-decoration:underline;color:#d7b5f0}.mp-cs-section>button{margin-top:14px}
body.mp-comic-searching [data-bl-dynamic],body.mp-comic-searching [data-foc-dynamic],body.mp-comic-searching [data-cnr-dynamic],body.mp-comic-searching #wo-live-shop{display:none!important}
body.mp-comic-search-ready .mp-bl-searchbar{display:none!important}
@media(max-width:520px){#mp-comic-search{padding:14px;margin:16px auto}.mp-cs-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.mp-cs-card{padding:9px}.mp-cs-card img{height:170px}.mp-cs-input input{flex-basis:100%}}
`;

export function comicSearchClient(css, shell) {
  'use strict';
  if (window.__mpComicSearch) return;
  window.__mpComicSearch = true;
  var labels = { stock: 'In stock', preorder: 'Preorder', backorder: 'Backorder' };
  var actions = { stock: 'View in-stock item →', preorder: 'View cover & preorder →', backorder: 'View book & order →' };
  var host, input, output, status, clear, timer, controller, revision = 0, current = '', sections = {};
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  function safeUrl(value) { try { var u = new URL(value, location.origin); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch (_) { return ''; } }
  function node(tag, text, cls) { var el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; }
  function card(item, kind) {
    var el = node('article', '', 'mp-cs-card'), link = node('a'), href = safeUrl(item.href);
    link.href = href;
    if (item.image && safeUrl(item.image)) { var img = node('img'); img.src = safeUrl(item.image); img.alt = item.title; img.loading = 'lazy'; link.appendChild(img); }
    link.appendChild(node('h3', item.title)); el.appendChild(link);
    el.appendChild(node('p', item.priceCents > 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.priceCents / 100) : 'Price coming soon', 'mp-cs-price'));
    el.appendChild(node('p', item.detail));
    var action = node('a', actions[kind], 'mp-cs-action'); action.href = href; el.appendChild(action); return el;
  }
  function render() {
    output.replaceChildren();
    Object.keys(labels).forEach(function (kind) {
      var data = sections[kind]; if (!data) return;
      var section = node('section', '', 'mp-cs-section');
      section.appendChild(node('h2', labels[kind] + (data.results.length ? ' · ' + data.results.length + (data.hasMore ? '+' : '') : '')));
      if (data.error) section.appendChild(node('p', labels[kind] + ' is temporarily unavailable. Other results are still shown.'));
      if (!data.results.length && !data.error) section.appendChild(node('p', 'No matching ' + labels[kind].toLowerCase() + ' titles.'));
      var grid = node('div', '', 'mp-cs-grid'); data.results.forEach(function (item) { grid.appendChild(card(item, kind)); }); section.appendChild(grid);
      if (data.hasMore || data.error) {
        var more = node('button', data.error ? 'Retry ' + labels[kind].toLowerCase() : 'Show more ' + labels[kind].toLowerCase());
        more.type = 'button'; more.onclick = function () { more.disabled = true; more.textContent = 'Loading…'; run(kind); }; section.appendChild(more);
      }
      output.appendChild(section);
    });
  }
  async function run(kind) {
    var q = input.value.trim(), id = revision;
    if (!q) return;
    if (!kind) { current = q; sections = {}; output.replaceChildren(); status.textContent = 'Searching all three catalogs…'; }
    var offset = kind && sections[kind] ? sections[kind].nextOffset : 0;
    var params = new URLSearchParams({ q: q, limit: '12' }); if (kind) { params.set('kind', kind); params.set('offset', offset); }
    try {
      var response = await fetch('/comics/search.json?' + params, { signal: controller.signal });
      if (!response.ok) throw new Error('Search unavailable');
      var data = await response.json(); if (id !== revision || q !== input.value.trim()) return;
      Object.keys(data.sections).forEach(function (key) { var next = data.sections[key]; if (kind && sections[key]) next.results = sections[key].results.concat(next.results); sections[key] = next; });
      render();
      var count = Object.values(sections).reduce(function (n, s) { return n + s.results.length; }, 0);
      status.textContent = data.emptyQuery ? 'Enter a title, series, or creator.' : count + ' matches shown for “' + q + '”.' + (Object.values(sections).some(function (s) { return s.error; }) ? ' Some catalogs need a retry.' : '');
    } catch (error) {
      if (error.name === 'AbortError' || id !== revision) return;
      if (kind) { sections[kind].error = true; render(); }
      else { status.textContent = 'Search could not load. Please try again.'; var retry = node('button', 'Retry search'); retry.type = 'button'; retry.onclick = function () { run(); }; output.replaceChildren(retry); }
    }
  }
  function changed(immediate) {
    clearTimeout(timer); revision++; if (controller) controller.abort(); controller = new AbortController();
    var q = input.value.trim(); clear.hidden = !q; document.body.classList.toggle('mp-comic-searching', !!q);
    var u = new URL(location.href); if (q) u.searchParams.set('comic_q', q); else u.searchParams.delete('comic_q'); history.replaceState(history.state, '', u);
    if (!q) { current = ''; sections = {}; output.replaceChildren(); status.textContent = ''; return; }
    status.textContent = 'Searching all three catalogs…'; output.replaceChildren();
    if (immediate) run(); else timer = setTimeout(run, 300);
  }
  function mount() {
    host = document.getElementById('mp-comic-search');
    if (!host) {
      var target = document.querySelector('[data-bl-dynamic], [data-foc-dynamic], [data-cnr-dynamic], #wo-live-shop');
      if (!target && location.pathname === '/category/comics') target = document.querySelector('main');
      if (!target) return false;
      var wrapper = document.createElement('div'); wrapper.innerHTML = shell; host = wrapper.firstElementChild; target.before(host);
    }
    input = host.querySelector('input'); output = host.querySelector('[data-cs-results]'); status = host.querySelector('[data-cs-status]'); clear = host.querySelector('[data-cs-clear]');
    host.querySelector('form').onsubmit = function (event) { event.preventDefault(); changed(true); };
    input.addEventListener('input', function () { changed(false); });
    clear.onclick = function () { input.value = ''; changed(true); input.focus(); };
    document.body.classList.add('mp-comic-search-ready');
    var params = new URLSearchParams(location.search);
    input.value = params.get('comic_q') || ((location.pathname === '/comics/search' || location.pathname === '/books') ? params.get('q') || '' : '');
    if (input.value) changed(true); return true;
  }
  if (!mount()) { var observer = new MutationObserver(function () { if (mount()) observer.disconnect(); }); observer.observe(document.body, { childList: true, subtree: true }); setTimeout(function () { observer.disconnect(); }, 15000); }
}
