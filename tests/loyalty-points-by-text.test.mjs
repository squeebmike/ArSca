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

assert.equal(pointsReplyText(sean), 'The Mana Pocket: Hi Sean! You have 558 points ($5.58) to use at the register or online. Your account: https://www.themanapocket.com/account');
assert.equal(pointsReplyText(walkin), 'The Mana Pocket: You have 456 points ($4.56) saved to this number -- use them at the register. To see them online, finish your account: https://www.themanapocket.com/account', 'a placeholder name never gets a "Hi"');
assert.match(pointsReplyText({ ...walkin, loyalty_points_balance:1 }), /You have 1 point \(\$0\.01\)/);
assert.match(pointsReplyText(null), /^The Mana Pocket: we don't have points saved for this number yet\. Ask for a text receipt at checkout .* Your account: https:\/\/www\.themanapocket\.com\/account$/);

// The lookup narrows on the last 4 digits, then matches on the full number.
{
  const calls = [];
  const fetch = async (env, path) => { calls.push(path); return { data:[dup, sean] }; };
  assert.match(await pointsSmsReply({}, fetch, 'store-1', '+13605350308'), /Hi Sean! You have 558 points/);
  assert.match(calls[0], /^customers\?store_id=eq\.store-1&phone=like\.\*0308&select=id,name,phone,loyalty_points_balance,linked_user_id&limit=50$/);
  assert.match(await pointsSmsReply({}, fetch, 'store-1', ''), /don't have points saved/);
}

// The worker's SMS webhook answers POINTS directly, before forwarding to staff phones.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const sms = worker.slice(worker.indexOf("if (url.pathname === '/twilio/sms') {"), worker.indexOf("return new Response('Not found', { status: 404 });", worker.indexOf("if (url.pathname === '/twilio/sms') {")));
const pointsAt = sms.indexOf('if (isPointsKeyword(text))'), forwardAt = sms.indexOf('for (const num of numbers)'), stopAt = sms.indexOf('STOP_KEYWORDS.includes(keyword)');
assert.ok(stopAt > 0 && pointsAt > stopAt && forwardAt > pointsAt, 'STOP first, then POINTS, then the staff forward');
assert.match(sms, /pointsSmsReply\(env, supabaseAdminFetch, storeId, from\)/);
assert.match(sms, /<Message>\$\{escapeXmlText\(reply\)\}<\/Message>/);

// Receipt text: earned, balance, how to check, and the account link.
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const extractFn = (name, prefix = 'function ') => { const s = dashboard.indexOf(prefix + name + '('); assert.ok(s >= 0, name); return dashboard.slice(s, dashboard.indexOf('\n}\n', s) + 2); };
const receiptTextMessage = new Function('LOYALTY_POINTS_PER_DOLLAR', "const CUSTOMER_ACCOUNT_URL = 'https://www.themanapocket.com/account';\n" + extractFn('receiptTextMessage') + '\nreturn receiptTextMessage;')(100);
assert.equal(receiptTextMessage({ storeName:'The Mana Pocket', total:152, earned:456, balance:558 }),
  'Thanks for shopping at The Mana Pocket! Total: $152.00. You earned 456 points -- you have 558 points ($5.58) saved to this number. Reply POINTS anytime for your balance. Your account: https://www.themanapocket.com/account Msg & data rates may apply. Reply STOP to opt out.');
assert.equal(receiptTextMessage({ storeName:'The Mana Pocket', total:4, earned:12, balance:null }),
  'Thanks for shopping at The Mana Pocket! Total: $4.00. You earned 12 points, saved to this number. Reply POINTS anytime for your balance. Your account: https://www.themanapocket.com/account Msg & data rates may apply. Reply STOP to opt out.', 'points still queued');
assert.doesNotMatch(receiptTextMessage({ storeName:'X', total:5, earned:0, balance:0 }), /POINTS|point/, 'loyalty off: no points line');
assert.match(receiptTextMessage({ storeName:'X', total:5, earned:0, balance:0 }), /Your account: https:\/\/www\.themanapocket\.com\/account Msg & data rates may apply\. Reply STOP to opt out\.$/);

// The receipt waits for the points, and the accrual reports what happened.
const save = extractFn('saveReceiptCapture', 'async function ');
assert.ok(save.indexOf('const accrual = accrueLoyaltyForContact(') < save.indexOf("storeWorkerFetch('/notify/send'"));
assert.match(save, /accrual\.catch\(\(\) => null\)\s*\.then\(result => storeWorkerFetch\('\/notify\/send'/);
assert.match(save, /receiptTextMessage\(\{ storeName, total, earned:result\?\.points, balance:result\?\.balance \}\)/);
const accrue = extractFn('accrueLoyaltyForContact', 'async function ');
assert.match(accrue, /const \{ data:newBalance, error \} = await sb\.rpc\('accrue_loyalty_points'/);
assert.match(accrue, /return \{ points, balance, customerId:customer\.id \};/);
assert.match(accrue, /return \{ points, balance:null \};/);
console.log('Loyalty points by text checks passed');
