import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: on the PRICE MOVERS re-sticker list, "I should be able to see
// the item's image and click it to get to the item edit screen."
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = name => { const s = dashboard.indexOf('function ' + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };
const host = { innerHTML:'' };
const opened = [], toasts = [];
const all = [{ id:'inv-1', name:'MIDNIGHT X-MEN #1 COVER D', image:'https://img/x.jpg' }, { id:'inv-2', name:'Pikachu - 027' }];
const api = new Function('document', 'all', 'getPriceChangeAlerts', 'inventoryImageUrl', 'escHtml', 'pokemonCacheAgeLabel', 'openEditModal', 'toast_dash', 'loadStockHealth',
  extractFn('openPriceAlertItem') + extractFn('renderPriceChangeAlerts') + 'return { openPriceAlertItem, renderPriceChangeAlerts };')(
  { getElementById:() => host }, all,
  () => [{ id:'a1', itemId:'inv-1', name:'MIDNIGHT X-MEN #1 COVER D', oldPrice:5.99, newPrice:8.6, dollarChange:2.61, pctChange:.44, status:'open' },
         { id:'a2', itemId:'inv-2', name:'Pikachu - 027', oldPrice:21.5, newPrice:18.17, dollarChange:-3.33, pctChange:-.15, status:'open' },
         { id:'a3', itemId:'gone', name:'Sold thing', oldPrice:10, newPrice:20, dollarChange:10, pctChange:1, status:'open' }],
  i => i.image || '', v => String(v), () => '2d ago', id => opened.push(id), m => toasts.push(m), () => {});
api.renderPriceChangeAlerts();
assert.match(host.innerHTML, /<button type="button" class="price-alert-thumb" title="Edit this item" onclick="openPriceAlertItem\('inv-1'\)"><img src="https:\/\/img\/x\.jpg"/);
assert.match(host.innerHTML, /onclick="openPriceAlertItem\('inv-2'\)"><span>NO IMAGE<\/span><\/button>/, 'no photo: a placeholder that still opens the item');
assert.match(host.innerHTML, /title="Edit this item" onclick="openPriceAlertItem\('inv-1'\)">MIDNIGHT X-MEN #1 COVER D up \$2\.61/, 'the name opens it too');
assert.match(host.innerHTML, /onclick="dismissPriceChangeAlert\('a1'\)">✓ STICKER UPDATED<\/button>/);
api.openPriceAlertItem('inv-1');
assert.deepEqual(opened, ['inv-1']);
api.openPriceAlertItem('gone');
assert.deepEqual(toasts, ['That item is no longer in inventory (sold or removed)']);
assert.match(dashboard, /\.price-alert-thumb\{flex:0 0 56px;width:56px;height:78px;/);
console.log('Price mover image + edit link checks passed');
