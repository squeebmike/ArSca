import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store report: a Whatnot sale of the Starship Godzilla 1:10 was recorded on
// the Variant C row next to it -- the covers' long titles only differ near
// the end. Recording a sale now shows the cover big, and lists the other
// in-stock covers of the same book with a SWITCH button.
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const bridge = fs.readFileSync('scripts/whatnot-bridge.js', 'utf8');
const fn = (src, name) => { const s = src.indexOf('function ' + name + '('); assert.ok(s >= 0, name); return src.slice(s, src.indexOf('\n}\n', s) + 2); };

const ctx = {};
vm.runInNewContext([fn(app, 'saleTitleBase'), fn(app, 'saleLookAlikes'), 'this.api = { saleTitleBase, saleLookAlikes };'].join('\n'), ctx);
const { saleTitleBase, saleLookAlikes } = ctx.api;
const ri = { id:'ri', status:'in_stock', qty:1, name:'Starship Godzilla: Invasion X [Kai-Sei Era] #1 Variant RI (10) 1:10 RATIO (Joyce Movie Homage Cover) -- Variant RI (10) (Joyce Movie Homage Cover)' };
const vc = { id:'vc', status:'in_stock', qty:3, name:'Starship Godzilla: Invasion X [Kai-Sei Era] #1 Variant C (Fullerton IDW Goes Dark Variant) -- Variant C (Fullerton IDW Goes Dark Variant)' };
const ca = { id:'ca', status:'in_stock', qty:4, name:'Starship Godzilla: Invasion X [Kai-Sei Era] #1 Cover A (Ono) -- Cover A (Ono)' };
const soldOut = { id:'so', status:'sold', qty:0, name:'Starship Godzilla: Invasion X [Kai-Sei Era] #1 Variant B (Jones)' };
const other = { id:'x', status:'in_stock', qty:2, name:'Batwoman #8 CVR D DAVID NAKAYAMA' };
const issue2 = { id:'i2', status:'in_stock', qty:2, name:'Starship Godzilla: Invasion X [Kai-Sei Era] #2 Cover A (Ono)' };
assert.equal(saleTitleBase(ri.name), saleTitleBase(vc.name), 'same book, different covers');
assert.notEqual(saleTitleBase(ca.name), saleTitleBase(issue2.name), 'a different issue is a different book');
assert.deepEqual(Array.from(saleLookAlikes(vc, [ri, vc, ca, soldOut, other, issue2]), i => i.id), ['ri', 'ca'], 'the other in-stock covers of this issue -- not itself, sold-out copies, other books or other issues');
assert.equal(saleLookAlikes(other, [ri, vc, other]).length, 0);

// The sale box: the cover big, the look-alikes with SWITCH.
const modal = fn(app, 'openExternalSaleModal');
assert.match(modal, /saleItemCard\(item, true\)/, 'the cover being sold, shown big');
assert.match(modal, /⚠ CHECK THE COVER -- \$\{alikes\.length\} other cover/);
assert.match(modal, /onclick="openExternalSaleModal\('\$\{escHtml\(a\.id\)\}'/, 'SWITCH reopens the box on that cover');
assert.match(fn(app, 'saleItemCard'), /inventoryImageUrl\(i\)/);

// Whatnot show import and show entry rows show each cover.
assert.match(fn(bridge, 'rowHtml'), /coverThumb\(x\.item\)/);
assert.match(bridge, /'<span style="color:var\(--text\);min-width:0;display:flex;gap:6px;align-items:center">' \+ coverThumb\(i\)/);
console.log('Sale cover confirmation checks passed');
