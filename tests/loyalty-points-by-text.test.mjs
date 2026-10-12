import fs from 'node:fs';
import assert from 'node:assert/strict';

// Store ask: customers should be able to text back to their receipt -- a
// simple word like POINTS -- and get the points they can redeem; points
// are kept on the phone number from the receipt (no email needed); and the
// receipt text links to the website account page so they can finish an
// account from there.
const { isPointsKeyword, pickPointsCustomer, pointsReplyText, pointsSmsReply, CUSTOMER_ACCOUNT_URL } = await import('../scripts/web-loyalty.mjs');
assert.equal(CUSTOMER_ACCOUNT_URL, 'https://www.themanapocket.com/account');

for (const t of ['POINTS', 'points', ' Points! ', 'pts', 'Balance', 'my points', 'Rewards', 'point']) assert.equal(isPointsKeyword(t), true, t);
for (const t of ['STOP', 'how many points do i have left on my account', 'HELP', '', 'pointless']) assert.equal(isPointsKeyword(t), false, t);

const sean = { id:'web', name:'Sean Van Overbeke', phone:'13605350308', loyalty_points_balance:558, linked_user_id:'u1' };
const dup = { id:'dup', name:'Customer', phone:'3605350308', loyalty_points_balance:0, linked_user_id:null };
const walkin = { id:'w', name:'Customer', phone:'(253) 555-0101', loyalty_points_balance:456, linked_user_id:null };
assert.equal(pickPointsCustomer([dup, sean], '+13605350308').id, 'web', 'the website account wins over an empty duplicate');
assert.equal(pickPointsCustomer([walkin], '+12535550101').id, 'w');
assert.equal(pickPointsCustomer([walkin], '+12535550199'), null);

assert.equal(pointsReplyText(sean), 'The Mana Pocket: Hi Sean! You have 558 Pocket Points ($5.58) to use at the register or online. Your account: https://www.themanapocket.com/account');
assert.equal(pointsReplyText(walkin), 'The Mana Pocket: You have 456 Pocket Points ($4.56) saved to this number -- use them at the register. To see them online, finish your account: https://www.themanapocket.com/account', 'a placeholder name never gets a "Hi"');
assert.match(pointsReplyText(null), /^The Mana Pocket: we don't have Pocket Points saved for this number yet\. Ask for a text receipt at checkout .* Your account: https:\/\/www\.themanapocket\.com\/account$/);

// The lookup narrows on the last 4 digits, then matches on the full number.
{
  const calls = [];
  const fetch = async (env, path) => { calls.push(path); return { data:[dup, sean] }; };
  assert.match(await pointsSmsReply({}, fetch, 'store-1', '+13605350308'), /Hi Sean! You have 558 Pocket Points/);
  assert.match(calls[0], /^customers\?store_id=eq\.store-1&phone=like\.\*0308&select=id,name,phone,loyalty_points_balance,linked_user_id&limit=50$/);
  assert.match(await pointsSmsReply({}, fetch, 'store-1', ''), /don't have Pocket Points saved/);
}

// The worker's SMS webhook answers POINTS directly, before forwarding to staff phones.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const sms = worker.slice(worker.indexOf("if (url.pathname === '/twilio/sms') {"), worker.indexOf("return new Response('Not found', { status: 404 });", worker.indexOf("if (url.pathname === '/twilio/sms') {")));
const pointsAt = sms.indexOf('if (isPointsKeyword(text))'), forwardAt = sms.indexOf('for (const num of numbers)'), stopAt = sms.indexOf('STOP_KEYWORDS.includes(keyword)');
assert.ok(stopAt > 0 && pointsAt > stopAt && forwardAt > pointsAt, 'STOP first, then POINTS, then the staff forward');
assert.match(sms, /pointsSmsReply\(env, supabaseAdminFetch, storeId, from\)/);
assert.match(sms, /<Message>\$\{escapeXmlText\(reply\)\}<\/Message>/);

// Receipt text: itemized (label short names + what was paid), totals,
// Pocket Points earned and balance, how to check, and the account link.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };
assert.match(dashboard, /const POINTS_NAME = 'Pocket Points';/);
const receiptTextMessage = new Function('LOYALTY_POINTS_PER_DOLLAR', "const POINTS_NAME = 'Pocket Points', CUSTOMER_ACCOUNT_URL = 'https://www.themanapocket.com/account', RECEIPT_MAX_LINES = 12;\n" + extractFn('receiptTextMessage') + '\nreturn receiptTextMessage;')(100);
process.env.TZ = 'UTC';
assert.equal(receiptTextMessage({ storeName:'The Mana Pocket', total:152, earned:456, balance:558, paidWith:'Cash',
  when:'2026-10-12T19:02:00Z', subtotal:152, lines:[{ name:'Spider-Woman #1 1:100 · CVR F Mark Brooks', qty:1, price:140 }, { name:'Pikachu', qty:2, price:12 }] }),
  ['The Mana Pocket receipt · Oct 12, 7:02 PM', 'Spider-Woman #1 1:100 · CVR F Mark Brooks $140.00', '2x Pikachu $12.00', 'TOTAL $152.00 · Cash', '',
   '★ Pocket Points: +456 earned · 558 total ($5.58 to spend)', 'Reply POINTS anytime for your balance.', '',
   'Your account: https://www.themanapocket.com/account', 'Thanks for shopping with us! Msg & data rates may apply. Reply STOP to opt out.'].join('\n'));
{
  const t = receiptTextMessage({ storeName:'X', total:9.36, earned:28, balance:null, subtotal:10, discount:1, tax:0.36, lines:[{ name:'A', qty:1, price:9 }] });
  assert.match(t, /\nSubtotal \$10\.00\nDiscount -\$1\.00\nTax \$0\.36\nTOTAL \$9\.36\n/);
  assert.match(t, /★ Pocket Points: \+28 earned\n/, 'points still queued: earned only');
  const many = receiptTextMessage({ total:1, lines:Array.from({ length:15 }, (_, i) => ({ name:'Card ' + i, qty:1, price:1 })) });
  assert.match(many, /Card 11 \$1\.00\n\+3 more items\n/);
  assert.ok(many.length < 1000, 'fits the send route');
  const off = receiptTextMessage({ storeName:'X', total:5, earned:0, balance:0 });
  assert.doesNotMatch(off, /POINTS|Pocket Points/, 'loyalty off: no points lines');
  assert.match(off, /Your account: https:\/\/www\.themanapocket\.com\/account\nThanks for shopping with us! Msg & data rates may apply\. Reply STOP to opt out\.$/);
}
// Item names use the label's short form.
{
  const comicLabelParts = item => ({ name:'Spider-Woman #1', badge:'1:100 · CVR F Mark Brooks' });
  const isComicLabelItem = item => /comic/i.test(item.category || '');
  const receiptLineName = new Function('all', 'isComicLabelItem', 'comicLabelParts', extractFn('receiptLineName') + '\nreturn receiptLineName;')(
    [{ id:'inv-1', name:'SPIDER-WOMAN #1 -- COVER F MARK BROOKS VIRGIN 1:100 VARIANT', category:'Comic' }], isComicLabelItem, comicLabelParts);
  assert.equal(receiptLineName({ item_id:'inv-1', title:'SPIDER-WOMAN #1 -- COVER F MARK BROOKS VIRGIN 1:100 VARIANT' }), 'Spider-Woman #1 1:100 · CVR F Mark Brooks');
  assert.equal(receiptLineName({ item_id:'gone', title:'X-Men #1 Cover A', category:'Comic' }), 'Spider-Woman #1 1:100 · CVR F Mark Brooks', 'a comic not in inventory still gets the label treatment');
  assert.equal(receiptLineName({ title:'Charizard ex 199/165 Special Illustration Rare Pokemon 151 NM', category:'Pokemon' }), 'Charizard ex 199/165 Special Illustration Rare…');
}
assert.match(extractFn('receiptSaleDetails'), /lines = \(bundle\.saleLines \|\| \[\]\)\.map\(l => \(\{ name:receiptLineName\(l\), qty:Math\.max\(1, Number\(l\.quantity \|\| 1\)\), price:Number\(l\.unit_price \|\| 0\) \}\)\)/);

// The receipt waits for the points, and the accrual reports what happened.
const save = extractFn('saveReceiptCapture', 'async function ');
assert.ok(save.indexOf('const accrual = accrueLoyaltyForContact(') < save.indexOf("storeWorkerFetch('/notify/send'"));
assert.match(save, /accrual\.catch\(\(\) => null\)\s*\.then\(result => storeWorkerFetch\('\/notify\/send'/);
assert.match(save, /const receiptSale = receiptSaleDetails\(confirmedSaleContext\);/);
assert.match(save, /receiptTextMessage\(\{ storeName, total, earned:result\?\.points, balance:result\?\.balance, \.\.\.receiptSale \}\)/);
const accrue = extractFn('accrueLoyaltyForContact', 'async function ');
assert.match(accrue, /const \{ data:newBalance, error \} = await sb\.rpc\('accrue_loyalty_points'/);
assert.match(accrue, /return \{ points, balance, customerId:customer\.id \};/);
assert.match(accrue, /return \{ points, balance:null \};/);
console.log('Loyalty points by text checks passed');
