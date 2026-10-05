import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const d = fs.readFileSync('dashboard.html', 'utf8');
const grab = re => { const m = d.match(re); assert.ok(m, 'missing ' + re); return m[0]; };

// ── Unused trade-in notice on the register ──
// A trade accepted but never checked out left the customer unpaid with their
// cards already in inventory. The register now flags it (30+ min old, or
// right away with an empty cart) with FINISH / PAY IN CASH / CANCEL.
assert.match(d, /createdAt: new Date\(\)\.toISOString\(\),\n    \};\n    logOpsEvent\('trade_credit_same_visit'/, 'a trade records when it was accepted');
assert.match(d, /const trade = pendingTradeAmounts\(total, cartData\);\n  renderPendingTradeNotice\(trade, items\.length\);/);
assert.match(d, /const PENDING_TRADE_STALE_MS = 30 \* 60 \* 1000;/);
assert.match(d, /onclick="payOutPendingTradeInCash\(\)"/);
assert.match(d, /onclick="cancelPendingTrade\(\)"/);
assert.match(d, /if\(!drawerState\) return toast_dash\('Open or join the Cash Bag first/, 'a cash payout needs the bag so it is recorded');
assert.match(d, /payTradeInLeftoverAsCash\(amount, \{ customerName:pending\.credit\.customerName \|\| '' \}\);/);
{
  const ctx = { Date, Number };
  vm.createContext(ctx);
  vm.runInContext(grab(/function pendingTradeAgeMs\(pending\)\{[\s\S]*?\n\}/) + ';this.age=pendingTradeAgeMs;', ctx);
  const ago = m => new Date(Date.now() - m * 60000).toISOString();
  assert.ok(Math.abs(ctx.age({ credit:{ createdAt:ago(45) } }) - 45 * 60000) < 2000);
  assert.ok(Math.abs(ctx.age({ credit:{}, handoff:{ createdAt:ago(5) } }) - 5 * 60000) < 2000);
  assert.equal(ctx.age({ credit:{} }), Infinity, 'an old trade with no time on it counts as stale');
}

// ── Quick Add duplicate check ──
{
  const ctx = {
    String, Number,
    inventoryItemIsSellable: i => i.status === 'in_stock',
    all: [
      { id:'a', name:'Pokemon 151 Booster Bundle', category:'Pokemon TCG', condition:'', upc:'0820650853517', status:'in_stock' },
      { id:'b', name:'Spider-Woman #1', category:'Comics', condition:'', language:'English', status:'in_stock' },
      { id:'c', name:'Charizard ex', category:'Pokemon TCG', condition:'NM', grade:'10', cert_number:'123', status:'in_stock' },
      { id:'d', name:'Old Sold Box', category:'Pokemon TCG', upc:'111122223333', status:'sold' },
    ],
  };
  vm.createContext(ctx);
  vm.runInContext(grab(/function findQuickAddDuplicate\(item\)\{[\s\S]*?\n\}/) + ';this.f=findQuickAddDuplicate;', ctx);
  assert.equal(ctx.f({ name:'Anything', upc:'0820650853517' })?.id, 'a', 'same barcode');
  assert.equal(ctx.f({ name:'spider-woman  #1', category:'Comics', condition:'' })?.id, 'b', 'same name, category, condition');
  assert.equal(ctx.f({ name:'Spider-Woman #1', category:'Comics', condition:'', language:'Japanese' }), null, 'different language is a different item');
  assert.equal(ctx.f({ name:'Charizard ex', category:'Pokemon TCG', condition:'NM' }), null, 'graded slabs never match');
  assert.equal(ctx.f({ name:'X', upc:'111122223333' }), null, 'sold items do not count');
  assert.equal(ctx.f({ name:'Spider-Woman #1', category:'Comics', grade:'9.8' }), null, 'a slab being added never merges');
}
assert.match(d, /const dupe = findQuickAddDuplicate\(item\);/);
assert.match(d, /const updates = \{ qty:total, quantity:total, cost \};/);
assert.match(d, /Math\.round\(\(\(oldCost \* have\) \+ \(newCost \* item\.qty\)\) \/ total \* 100\) \/ 100/, 'per-copy cost is averaged');

// ── Language badge ──
{
  const ctx = { inventoryCardName:i => i.name || '', inventorySetName:i => i.set || '', escHtml:v => String(v) };
  vm.createContext(ctx);
  vm.runInContext(grab(/function inventoryLanguageCode\(item = \{\}\)\{[\s\S]*?\n\}/) + grab(/function inventoryLanguageBadgeHtml\(item\)\{[\s\S]*?\n\}/) + ';this.code=inventoryLanguageCode;this.badge=inventoryLanguageBadgeHtml;', ctx);
  assert.equal(ctx.code({ language:'Japanese' }), 'JP');
  assert.equal(ctx.code({ language:'Chinese (Simplified)' }), 'CN');
  assert.equal(ctx.code({ language:'Chinese (Traditional)' }), 'TW');
  assert.equal(ctx.code({ language:'Korean' }), 'KR');
  assert.equal(ctx.code({ language:'English' }), '');
  assert.equal(ctx.code({ name:'Terastal Festival Japanese Booster Box' }), 'JP', 'name fallback');
  assert.equal(ctx.code({ language:'English', name:'Japanese Garden playmat' }), '', 'a saved language wins over the name');
  assert.equal(ctx.code({ language:'German' }), 'DE');
  assert.match(ctx.badge({ language:'Korean' }), />KR<\/span>$/);
  assert.equal(ctx.badge({}), '');
}
assert.match(d, /🎁 BUNDLE<\/span>':''\}\$\{inventoryLanguageBadgeHtml\(i\)\}/);

// ── Login labels ──
assert.match(d, /\.auth-row>label\{display:grid;gap:4px;\}/);
console.log('Trade notice, Quick Add duplicates and language badge checks passed');
