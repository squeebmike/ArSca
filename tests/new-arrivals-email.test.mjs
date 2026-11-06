import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newArrivalsEmail } from '../scripts/new-arrivals-email.mjs';

// Store, 2026-11-06: "email blast new releases when I scan the slip ...
// right now I only want Sean VanO to get one".
const items = [{ name: 'Amazing Spider-Man #1003 Momoko', price: 4.99, image: 'https://img/x.jpg', url: 'https://www.themanapocket.com/item/a/asm' }, { name: 'Black Cat #16 <Workout>', price: 4.99, image: '', url: 'https://www.themanapocket.com/item/b/bc' }];
const m = newArrivalsEmail(items, { firstName: 'Sean', location: '123 Main St' });
assert.equal(m.subject, 'New this week at The Mana Pocket: 2 new comics');
assert.match(m.text, /^Hi Sean,/); assert.match(m.text, /- Amazing Spider-Man #1003 Momoko -- \$4\.99\n  Buy now: https:\/\/www\.themanapocket\.com\/item\/a\/asm\?buy=1/);
assert.match(m.html, /href="https:\/\/www\.themanapocket\.com\/item\/a\/asm\?buy=1"[^>]*>BUY NOW<\/a>/, 'BUY NOW: one tap to the cart');
assert.match(m.text, /Reply "stop" and we'll take you off\./, 'a way off the list');
assert.match(m.html, /Black Cat #16 &lt;Workout&gt;/, 'titles are escaped');
assert.match(m.html, /<img src="https:\/\/img\/x\.jpg"/); assert.match(m.html, /123 Main St/, 'the store address in the footer');
assert.equal(newArrivalsEmail([items[0]]).subject, 'New this week at The Mana Pocket: 1 new comic');

const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(w, /content: \{ subject, html: opts\.html \|\| emailTextToHtml\(text\), text \},/);
assert.match(w, /customers\?store_id=eq\.\$\{s\}&new_arrivals_email=eq\.true&select=id,name,email/, 'only customers on the list');
assert.match(w, /if \(!body\.force && await env\.LBA_KV\.get\(sentKey\)\) return json\(\{ ok: false, error: 'This batch was already emailed', alreadySent: true \}, 409\);/, 'never twice by accident');
assert.match(w, /filter\(\(\{ it \}\) => it && isStorefrontItemAvailable\(it\)\)/, 'only books in the shop');
assert.match(fs.readFileSync('supabase-migrations/2026-11-06-customers-new-arrivals-email.sql', 'utf8'), /add column if not exists new_arrivals_email boolean not null default false/);
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.match(app, /async function offerNewArrivalsEmail\(ids\)\{/); assert.match(app, /SEND TO ' \+ list\.length/, 'nothing sends until SEND is pressed');
const foc = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');
assert.match(foc, /window\.openWhatnotShowPicker\(ids,[^\n]*,thenEmail\);/, 'after the show picker');
assert.match(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8'), /scripts\/new-arrivals-email\.mjs/);
assert.match(w, /list\.push\(\{ name: 'Store copy', email: storeEmail \}\)/, 'a copy to the store email (hintline)');
const shop = fs.readFileSync('scripts/product-shopping.mjs', 'utf8');
assert.match(shop, /if\(typeof location!=='undefined'&&\/\[\?&\]buy=1\\b\/\.test\(location\.search\|\|''\)\)\{/, 'the item page adds it and opens the cart');
console.log('New arrivals email: list, covers, links, opt-out, no double sends passed');
