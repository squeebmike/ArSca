import assert from 'node:assert/strict';
import fs from 'node:fs';
import { askByteRider } from '../scripts/byterider-ask.mjs';
// Store, 2026-11-09: "add to your cart by telling it what you want", links
// inside his message, comic synopses, alerts, points, his phone number, a
// 90s-attitude personality and a better (free) voice.
const items = [
  { id: 'c1', name: 'Charizard ex', set: 'Obsidian Flames', category: 'Pokemon TCG', price: 38.05, quantity: 2, image: 'https://img/c.jpg', url: '/item/c1/charizard-ex', cost: 20 },
  { id: 'p1', name: 'Pikachu', set: 'Base Set', category: 'Pokemon TCG', price: 4, quantity: 1, url: '/item/p1/pikachu' },
];
const comics = [{ title: 'Absolute Batman #26', onSale: '2099-01-06', publisher: 'DC', price: 4.99, url: '/preorder/sku1', about: 'Bruce faces the Ark M fallout.', alertUrl: '/book-alerts?book=Absolute%20Batman' }];
let prompt = '';
const ask = (question, answer, extra = {}) => askByteRider({ question, today: '2026-11-09' }, { items: async () => items, facts: async () => 'facts\nPhone/text: 253-973-0509.', upcoming: async () => comics, claude: async sys => (prompt = sys, answer), ...extra });

// In-sentence links: only the L numbers he was shown; anything else is plain text.
let out = await ask('do you have charizard?', 'Yep! {{L1|Charizard ex}} is in stock. {{L9|fake}} {{CART|L1}}');
assert.match(prompt, /- Charizard ex \[L1\]/);
assert.equal(out.answer, 'Yep! {{L1|Charizard ex}} is in stock. fake ');
assert.deepEqual(out.inline, { 1: '/item/c1/charizard-ex' });
assert.equal(out.items[0].cart, '/item/c1/charizard-ex?buy=1', 'a + CART button for in-stock items');
assert.deepEqual(out.items[0].cartData, { id: 'c1', name: 'Charizard ex', category: 'Pokemon TCG', price: 38.05, image: 'https://img/c.jpg', available: 2 });
assert.ok(!JSON.stringify(out).includes('"cost"'), 'never the cost');

// "Add the Charizard to my cart": only in-stock items he was given, no duplicates, at most 5.
out = await ask('add the charizard to my cart', 'Loot acquired! {{CART|L1}}{{CART|L1}} {{CART|L7}}');
assert.deepEqual(out.cartAdds.map(c => c.id), ['c1']);
assert.equal(out.answer.trim(), 'Loot acquired!');
assert.match(prompt, /Cart: when the visitor clearly asks you to add or put something in their cart/);

// Comics: synopsis and the email alert link in what he knows.
out = await ask('what is absolute batman 26 about', 'Bruce vs the fallout -- {{L2|get an alert}}');
assert.match(prompt, /Absolute Batman #26 -- on sale 2099-01-06, DC, \$4\.99 \[L1\] -- about: Bruce faces the Ark M fallout\. -- email alert \[L2\]/);
assert.deepEqual(out.inline, { 2: '/book-alerts?book=Absolute%20Batman' });

// Points: only asked for when the question is about points; shown only to them.
let asked = 0;
const account = async () => (asked++, { points: 1250, credit: 5 });
await ask('do you have charizard?', 'ok', { account });
assert.equal(asked, 0, 'no account lookup for a stock question');
await ask('how many points do I have?', 'ok', { account });
assert.equal(asked, 1);
assert.match(prompt, /YOUR ACCOUNT \(the signed-in visitor's own; share only with them\): 1250 loyalty points \(worth \$12\.50 off/);
assert.match(prompt, /\$5\.00 store credit/);

// Personality and trade-ins.
assert.match(prompt, /90s video-game mascot attitude/);
assert.match(prompt, /never promise an amount or a percentage unless STORE FACTS gives one/);

// Worker wiring: contact from store settings, points from the signed-in customer, preorder pages, voice.
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(w, /contact = \[rs\.phone && 'Phone\/text: '/);
assert.match(w, /customers\?store_id=eq\.\$\{s\}&linked_user_id=eq\.\$\{encodeURIComponent\(auth\.user\.id\)\}&select=loyalty_points_balance,trade_credit_balance/);
assert.match(w, /url: r\.id && r\.on_sale_date > new Date\(\)\.toISOString\(\)\.slice\(0, 10\) \? '\/preorder\/' \+ encodeURIComponent\(r\.id\)/);
assert.match(w, /url\.pathname === '\/public\/byterider\/voice' && request\.method === 'POST'/);
assert.match(w, /await env\.AI\.run\('@cf\/myshell-ai\/melotts', \{ prompt: text, lang: 'en' \}\)/);
assert.match(w, /if \(ipCount >= 40 \|\| dayCount >= 1500\) return json/);
assert.match(fs.readFileSync('wrangler.deploy.jsonc', 'utf8'), /"ai": \{ "binding": "AI" \}/);

// Site: links built as DOM nodes, cart added on the page, arcade-speaker voice with a browser fallback.
const site = fs.readFileSync('scripts/byterider-site.mjs', 'utf8');
assert.ok(site.includes("const re = /\\{\\{L(\\d{1,2})\\|([^{}|]{1,80})\\}\\}/g;"));
assert.ok(site.includes('export function addToSiteCart(list = []) {'));
assert.ok(site.includes('if (r.cartAdds?.length && !addToSiteCart(r.cartAdds)'));
assert.ok(site.includes("export const VOICE_URL = WORKER + '/public/byterider/voice';"));
assert.ok(site.includes('} catch { browserSpeak(text); }'));
console.log('ByteRider: in-sentence links, add to cart, synopses, alerts, points, contact, personality, voice passed');
