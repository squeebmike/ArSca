// Research tab: paste a Magic list, review every card (finish, printing, condition, qty, price), then add to Buy.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as mod from '../scripts/pricecharting-buy-import.mjs';
const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
assert.ok(html.includes('onclick="openMtgListReview()"') && html.includes('id="research-list-review"'), 'Research tab has the PASTE MTG LIST button and review box');
assert.ok(app.includes("id=\"mtg-paste-review\"") && app.includes('openMtgListReview(t)'), 'the Buy paste box can send the list to Research');
assert.ok(app.includes("identifiers:retry.slice(i, i + 75).map(name => ({ name }))"), 'unknown set codes get a name lookup');
// Run the review helpers with a stub DOM.
const a = app.indexOf('let mtgReview = null;'), b = app.indexOf('Object.assign(window, { openMtgListReview');
const src = app.slice(app.indexOf('function mtgLineToBuyRow('), app.indexOf('async function importMtgListToBuyList(')) + app.slice(a, b) + ';globalThis.T={get r(){return mtgReview},set r(v){mtgReview=v},renderMtgListReview,mtgReviewRow,mtgReviewFlags,mtgReviewPrice,mtgReviewPick,mtgReviewAddToBuy};';
const host = { innerHTML:'' }, added = [];
const ctx = { document:{ getElementById:id => id === 'mtg-review-table' ? host : null, querySelectorAll:() => [] }, escHtml:v => String(v ?? ''), fd$:n => '$' + Number(n || 0).toFixed(2),
  addImportedRowsToBuyList:(rows, f) => added.push(...rows), switchTab:() => {}, closeMtgListReview:() => {} };
vm.createContext(ctx); vm.runInContext(src, ctx); const T = ctx.T;
const card = { id:'a', name:'Sol Ring', set:'c21', set_name:'Commander 2021', collector_number:'263', finishes:['nonfoil','foil'], prices:{ usd:'1.50', usd_foil:'4.00' } };
const foilOnly = { id:'b', name:'Duress', set:'sta', set_name:'Strixhaven Mystical Archive', collector_number:'29', finishes:['etched'], prices:{ usd_etched:'3.00' } };
T.r = { mod, skipped:[], filter:'all', rows:[
  { i:0, it:{ quantity:2, name:'Sol Ring', extras:[], set:'C21', number:'263', finish:'' }, card, how:'exact', finish:'', condition:'NM', quantity:2, price:null, checked:true },
  { i:1, it:{ quantity:1, name:'Duress', extras:[], set:'STA', number:'29', finish:'' }, card:foilOnly, how:'name', finish:'', condition:'NM', quantity:1, price:null, checked:true },
  { i:2, it:{ quantity:1, name:'Nope', extras:[], set:'PRE', number:'1', finish:'' }, card:null, how:'none', finish:'', condition:'NM', quantity:1, price:null, checked:true },
] };
T.renderMtgListReview();
assert.match(host.innerHTML, /\$6\.00/, 'total = 2 x $1.50 + $3.00 etched-only');
assert.match(host.innerHTML, /2 to check/);
assert.deepEqual([...T.mtgReviewFlags(T.r.rows[1])], ['Printing guessed by name', 'Regular not made -- priced as Etched']);
assert.deepEqual([...T.mtgReviewFlags(T.r.rows[2])], ['Not found', 'No price']);
T.mtgReviewRow(0, 'finish', 'foil'); assert.equal(T.mtgReviewPrice(T.r.rows[0]), 4, 'Foil toggle switches to the foil price');
T.mtgReviewRow(2, 'price', '2.5'); assert.equal(T.mtgReviewPrice(T.r.rows[2]), 2.5, 'typed price');
T.mtgReviewRow(1, 'checked', false);
T.mtgReviewAddToBuy();
assert.equal(added.length, 2, 'only checked rows go to Buy');
assert.deepEqual([added[0].name, added[0].market, added[0].quantity], ['Sol Ring (Foil)', 4, 2]);
assert.deepEqual([added[1].market, added[1].source], [2.5, 'Manual price (reviewed list)']);
console.log('Paste a Magic list into Research and review it: passed');
