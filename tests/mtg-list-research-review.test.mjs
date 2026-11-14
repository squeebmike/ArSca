// Research tab: a pasted Magic list shows as Research result cards -- only the printings on the list.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
assert.ok(html.includes('onclick="openMtgListReview()"') && html.includes('id="research-list-review"'), 'Research tab has the PASTE MTG LIST button');
assert.ok(app.includes('id="mtg-paste-review"') && app.includes('openMtgListReview(t)'), 'the Buy paste box can send the list to Research');
assert.ok(app.includes('identifiers:retry.slice(i, i + 75).map(name => ({ name }))'), 'unknown set codes get a name lookup');
const a = app.indexOf('let mtgListResults = null;'), b = app.indexOf('Object.assign(window, { openMtgListReview');
const src = app.slice(a, b) + ';globalThis.T={showMtgListInResearch,mtgListAddAllToBuy,get m(){return mtgListResults}};';
const rendered = [], added = [], banner = { innerHTML:'' };
const ctx = {
  document:{ getElementById:id => id === 'mtg-list-banner' ? banner : null, querySelectorAll:() => [] }, setTimeout:() => {}, confirm:() => true,
  escHtml:v => String(v ?? ''), fd$:n => '$' + Number(n || 0).toFixed(2), switchTab:() => {},
  qplMasterResults:[], qplResults:[], qplLastSearch:'', _qplRenderedResultsRef:null, _qplRenderLimit:20,
  renderQuickLookupResults:r => rendered.push(r), addImportedRowsToBuyList:rows => added.push(...rows),
  normalizeQplFinish:v => v, qplFinishLabel:v => ({ foil:'Foil', etched_foil:'Etched Foil' })[v] || v,
  mtgFinishPriceFamily:f => f === 'normal' ? 'normal' : f === 'etched_foil' ? 'etched_foil' : 'foil',
  applyQplSelectedVariant:r => { const v = r.availableVariants.find(x => x.finish === r.selectedFinish); r.market = v ? v.market : 0; return r; },
  scryfallCardToQplRow:c => { const vs = [['normal', c.prices.usd], ['foil', c.prices.usd_foil], ['etched_foil', c.prices.usd_etched], ['extended_art', c.prices.usd_foil]].filter(x => x[1]).map(([finish, m]) => ({ finish, market:Number(m) }));
    const auto = c.treat && vs.some(v => v.finish === c.treat) ? c.treat : vs[0].finish; return ctx.applyQplSelectedVariant({ name:c.name, set:c.set_name, card_number:c.collector_number, availableVariants:vs, selectedFinish:auto, finish:auto }); },
};
vm.createContext(ctx); vm.runInContext(src, ctx);
const line = (q, name, finish, card, how = 'exact') => ({ it:{ quantity:q, name, extras:[], set:'X', number:'1', finish }, card, how });
ctx.T.showMtgListInResearch({ skipped:[], lines:[
  line(2, 'Sol Ring', '', { name:'Sol Ring', set_name:'C21', collector_number:'263', prices:{ usd:'1.50', usd_foil:'4.00' } }),
  line(1, 'Duress', 'etched', { name:'Duress', set_name:'STA', collector_number:'29', prices:{ usd:'0.50', usd_etched:'3.00' } }),
  line(1, 'Inspiring Refrain', '', { name:'Inspiring Refrain', set_name:'C21', collector_number:'354', treat:'extended_art', prices:{ usd:'0.66', usd_foil:'2.00' } }, 'name'),
  line(1, 'Breya', '', null, 'none'),
] });
const res = rendered[0];
assert.equal(res.length, 3, 'one Research card per found printing');
assert.deepEqual(JSON.parse(JSON.stringify(res.map(r => [r.selectedFinish, r.market, r.qty]))), [['normal', 1.5, 2], ['etched_foil', 3, 1], ['normal', 0.66, 1]], 'list finish wins; a plain extended-art line is NOT priced as foil');
assert.match(res[2].matchWhy.join(' '), /guessed by name/);
assert.match(banner.innerHTML, /\$6\.66/); assert.match(banner.innerHTML, /Not found on Scryfall \(1\): 1 Breya/);
ctx.qplResults = res; ctx.T.mtgListAddAllToBuy();
assert.deepEqual(JSON.parse(JSON.stringify(added.map(r => [r.name, r.quantity, r.market]))), [['Sol Ring', 2, 1.5], ['Duress (Etched Foil)', 1, 3], ['Inspiring Refrain', 1, 0.66]]);
console.log('Pasted Magic list as Research cards: passed');
