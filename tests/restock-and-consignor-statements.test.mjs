import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isRestockable, restockKey, buildRestockList } from '../scripts/restock.mjs';

// Store asks: "restock what sells out" and a statement per consignor.

// ── Restock ──
assert.equal(isRestockable({ name: 'White Flare Booster Bundle', category: 'Pokemon TCG', variant: 'Sealed' }), true);
assert.equal(isRestockable({ name: 'Mystery Booster 2 Booster Pack', category: 'Magic: The Gathering' }), true);
assert.equal(isRestockable({ name: 'Cardboard Gold Hard Top Loader', category: 'Supplies', productType: 'single' }), true, 'supplies are always restockable');
assert.equal(isRestockable({ name: 'Zacian - 100/094', category: 'Pokemon TCG', variant: 'Illustration Rare' }), false, 'a single card is not');
assert.equal(isRestockable({ name: 'Charizard Booster Box Promo', productType: 'single' }), false, 'marked single wins over the words');
assert.equal(isRestockable({ name: 'Elite Trainer Box', grader: 'PSA' }), false, 'graded is one of a kind');
assert.equal(isRestockable({ name: 'Absolute Batman #1 Box', source: 'foc_receive' }), false, 'comics have the FOC wall');
assert.equal(restockKey({ name: 'White Flare Booster Bundle - PRESALE', category: 'Pokemon TCG' }), restockKey({ name: 'White  Flare Booster Bundle', category: 'Pokemon TCG' }));

const now = Date.parse('2026-10-22T12:00:00Z'), ago = d => new Date(now - d * 864e5).toISOString();
const row = (id, status, data) => ({ id, status, data });
{
  const items = [
    row('wf1', 'sold', { name: 'White Flare Booster Bundle', category: 'Pokemon TCG', variant: 'Sealed', qty: 0, cost: 30, salePrice: 49.99 }),
    row('wf2', 'sold', { name: 'White Flare Booster Bundle', category: 'Pokemon TCG', variant: 'Sealed', qty: 0, cost: 32 }),
    row('mb', 'in_stock', { name: 'Mystery Booster 2 Booster Pack', category: 'Magic: The Gathering', qty: 4, cost: 12 }),
    row('sl', 'in_stock', { name: 'Sleeved Booster Pack', category: 'Pokemon TCG', productType: 'sealed', qty: 23 }),
    row('zac', 'sold', { name: 'Zacian - 100/094', category: 'Pokemon TCG', qty: 0 }),
    row('one', 'sold', { name: 'Strixhaven Collector Booster Display', category: 'Magic: The Gathering', productType: 'sealed', qty: 0 }),
  ];
  const lines = [
    { item_id: 'wf1', quantity: 1, created_at: ago(60) }, { item_id: 'wf1', quantity: 1, created_at: ago(20) }, { item_id: 'wf2', quantity: 1, created_at: ago(5) },
    ...Array.from({ length: 16 }, (_, i) => ({ item_id: 'mb', quantity: 1, created_at: ago(80 - i * 5) })),
    { item_id: 'sl', quantity: 2, created_at: ago(40) }, { item_id: 'sl', quantity: 2, created_at: ago(10) },
    { item_id: 'zac', quantity: 1, created_at: ago(3) }, { item_id: 'zac', quantity: 1, created_at: ago(2) },
    { item_id: 'one', quantity: 1, created_at: ago(30) },
    { item_id: 'wf1', quantity: 5, created_at: ago(200) },
  ];
  const list = buildRestockList({ lines, items, stock: items, now });
  assert.deepEqual(list.map(r => r.name), ['White Flare Booster Bundle', 'Mystery Booster 2 Booster Pack'], 'sold out first, then low; plenty on hand, singles and one-off sales left out');
  const [wf, mb] = list;
  assert.equal(wf.status, 'out'); assert.equal(wf.sold90, 3, 'both rows of the same product count together; older than 90 days ignored'); assert.equal(wf.sold30, 2);
  assert.equal(wf.onHand, 0); assert.equal(wf.cost, 32, 'the last price paid');
  assert.equal(wf.suggest, Math.ceil(3 / 60 * 45), 'about 6 weeks at its selling rate');
  assert.equal(mb.status, 'low'); assert.equal(mb.onHand, 4); assert.ok(mb.daysLeft < 21);
  assert.equal(mb.suggest, Math.ceil(16 / 80 * 45) - 4);
}

// The route: completed sales only, store staff only.
{
  const { default: api } = await import('../cloudflare-worker-full.js');
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  const ok = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const ID = 'aaaaaaaa-0000-4000-8000-0000000000aa';
  let stockSelect = '';
  globalThis.fetch = async (input) => {
    const url = decodeURIComponent(String(input.url || input));
    if (url.includes('/auth/v1/user')) return ok({ id: 'u1', email: 'staff@example.com' });
    if (url.includes('store_members')) return ok([{ role: 'employee' }]);
    if (url.includes('/rest/v1/pos_sale_lines')) return ok([{ item_id: ID, sale_id: 's1', quantity: 1, created_at: ago(5) }, { item_id: ID, sale_id: 's2', quantity: 1, created_at: ago(4) }, { item_id: ID, sale_id: 'void', quantity: 3, created_at: ago(3) }]);
    if (url.includes('/rest/v1/pos_sales')) return ok([{ id: 's1' }, { id: 's2' }]);
    if (url.includes('/rest/v1/inventory_items') && url.includes('status=eq.in_stock')) { stockSelect = url; return ok([]); }
    if (url.includes('/rest/v1/inventory_items')) return ok([{ id: ID, status: 'sold', data: { name: 'White Flare Booster Bundle', category: 'Pokemon TCG', variant: 'Sealed', qty: 0, cost: 30 } }]);
    return ok([]);
  };
  try {
    const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    const res = await api.fetch(new Request('https://api.example/inventory/restock', { headers: { Authorization: 'Bearer t', 'X-Store-Id': 'store-1' } }), env, { waitUntil() {} });
    const d = await res.json();
    assert.equal(res.status, 200, JSON.stringify(d));
    assert.equal(d.restock.length, 1);
    assert.equal(d.restock[0].sold90, 2, 'the voided sale is not counted');
    assert.match(stockSelect, /select=id,status,name:data->>name,category:data->>category/, 'only the fields it needs from the shelf');
    const anon = await api.fetch(new Request('https://api.example/inventory/restock', { headers: { 'X-Store-Id': 'store-1' } }), env, { waitUntil() {} });
    assert.notEqual(anon.status, 200);
  } finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
}
const worker = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');
assert.ok(worker.includes("import { buildRestockList } from './scripts/restock.mjs';"));
assert.match(readFileSync(new URL('../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8'), /- scripts\/restock\.mjs/, 'deploys with the Worker');

// The screen.
const ui = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
const grab = (head) => { const start = ui.indexOf(head); assert.ok(start >= 0, head); const body = /\)\s*\{/.exec(ui.slice(start)); let depth = 0, i = start + body.index + body[0].length - 1; for (; i < ui.length; i++) { if (ui[i] === '{') depth++; else if (ui[i] === '}' && --depth === 0) break; } return ui.slice(start, i + 1); };
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
assert.ok(ui.includes('<details class="wtb-cat" open><summary><b>🔁 RESTOCK</b>'));
assert.ok(ui.includes('  renderWhatToBuyGrading();\n  renderWhatToBuyRestock();'));
{
  const fns = new Function('escHtml', grab('function restockListHtml(') + '\n' + grab('function restockOrderText(') + '; return { restockListHtml, restockOrderText };')(esc);
  const list = [{ name: 'White Flare Booster Bundle', category: 'Pokemon TCG', status: 'out', sold90: 3, sold30: 2, perMonth: 1.5, onHand: 0, daysLeft: 0, suggest: 3, cost: 32, lastSoldAt: ago(5) },
    { name: 'Mystery <Booster> 2', category: 'Magic', status: 'low', sold90: 16, sold30: 6, perMonth: 5.6, onHand: 4, daysLeft: 21, suggest: 5, cost: 0, lastSoldAt: ago(1) }];
  const html = fns.restockListHtml(list);
  assert.match(html, /SOLD OUT/); assert.match(html, /LOW · about 21 days left/);
  assert.match(html, /Mystery &lt;Booster&gt; 2/, 'escaped');
  assert.match(html, /About \$96\.00 for the whole list/);
  assert.equal(fns.restockOrderText(list), '3 x White Flare Booster Bundle (last paid $32.00)\n5 x Mystery <Booster> 2');
  assert.match(fns.restockListHtml([]), /Nothing sealed or supplies sold out/);
}

// ── Consignor statements ──
assert.ok(ui.includes(`onclick="openConsignorStatement('\${encodeURIComponent(p.name)}')"`), 'a STATEMENT button per person');
{
  const pick = name => { const start = ui.indexOf('function ' + name + '('); return ui.slice(start, ui.indexOf('\n', start)); };
  const helpers = ['consignMoney', 'consignSaleValue', 'consignFee', 'consignSplitBase', 'consignStoreCut', 'consignOwnerCut'].map(pick).join('\n');
  const consignItems = [
    { id: 'g', owner: 'Sean C', item: 'Goblin Storm', status: 'sold', price: 453, salePrice: 445.5, marketplaceFee: 60.78, split: 20, soldAt: '2026-10-22T00:09:00Z', paidOut: false, contact: '555-123-4567' },
    { id: 'w', owner: 'Sean C', item: 'White Flare ETB', status: 'sold', price: 153, salePrice: 140, split: 33, soldAt: '2026-09-05T22:46:00Z', paidOut: true, paidOutAt: '2026-09-10T00:00:00Z' },
    { id: 'b', owner: 'Sean C', item: 'Bulbasaur', status: 'active', price: 23, split: 30, addedAt: '2026-07-11T00:00:00Z' },
    { id: 'x', owner: 'Someone Else', item: 'Other', status: 'sold', salePrice: 10, split: 25, paidOut: false },
  ];
  const fns = new Function('consignItems', 'escHtml', 'consignmentOwnerDirectory', helpers + '\n' + grab('function consignorStatementData(') + '\n' + pick('consignDay') + '\n' + grab('function consignorStatementText(') + '\n' + grab('function consignorStatementHtml(') + '; return { consignorStatementData, consignorStatementText, consignorStatementHtml };')(consignItems, esc, () => []);
  const st = fns.consignorStatementData('Sean C');
  assert.deepEqual(st.owed.map(c => c.id), ['g']); assert.deepEqual(st.paid.map(c => c.id), ['w']); assert.deepEqual(st.active.map(c => c.id), ['b']);
  assert.equal(st.owedTotal, 307.78, 'Goblin Storm: 80% of $445.50 - $60.78');
  assert.equal(st.paidTotal, 93.8);
  assert.equal(st.contact, '555-123-4567');
  const text = fns.consignorStatementText(st, 'The Mana Pocket');
  assert.match(text, /consignment statement for Sean C/);
  assert.match(text, /OWED TO YOU: \$307\.78/);
  assert.match(text, /- Goblin Storm -- sold \$445\.50, \$60\.78 marketplace fees, store 20% \(\$76\.94\), you get \$307\.78/);
  assert.match(text, /ALREADY PAID \(\$93\.80\):\n- White Flare ETB -- sold \$140\.00, store 33% \(\$46\.20\), you get \$93\.80/);
  assert.match(text, /STILL FOR SALE:\n- Bulbasaur -- asking \$23\.00, store keeps 30%/);
  assert.ok(!text.includes('Someone Else') && !text.includes('Other'), "only this consignor's items");
  const html = fns.consignorStatementHtml(st);
  assert.match(html, /OWED NOW · \$307\.78/); assert.match(html, /PAID · \$93\.80/); assert.match(html, /STILL FOR SALE · 1 item/);
}
// Text/email go out from the store's own phone; marking paid uses the normal path.
assert.ok(ui.includes('href="sms:${escHtml(phone)}?&body=${encodeURIComponent(text)}"'));
assert.ok(ui.includes('href="mailto:${escHtml(email)}?subject='));
assert.ok(ui.includes('st.owed.forEach(c => markPaidOut(c.id));'));
console.log('Restock and consignor statement checks passed');
