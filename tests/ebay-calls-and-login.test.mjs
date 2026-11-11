import assert from 'node:assert/strict';
import fs from 'node:fs';
// Store, 2026-11-10: "scrolling through 1 checklist can use them all" (eBay
// calls), plus the login screen showing the owner's email to everyone.
const market = fs.readFileSync('scripts/sports-card-marketplace.mjs', 'utf8');
assert.match(market, /const FRESH=24\*60\*60\*1000;/, 'an eBay search is good for a day');
assert.match(market, /if\(deps\?\.priceRefresh===false\)wait=false;/, 'crawlers never spend an eBay call');
assert.ok(market.includes("lookup(b,true)"), 'rows scrolling into view are automatic lookups');
assert.ok(market.includes("url+=(url.indexOf('?')<0?'?':'&')+'auto=1'"), 'automatic checklist lookups use the section search only');
const section = fs.readFileSync('scripts/baseball-section-pages.mjs', 'utf8');
assert.ok(section.includes("let listing=section.find(l=>sportsListingMatches(l,card,set,cardGroup))||null;"), 'one section search serves every card');
assert.ok(section.includes("if(!listing&&!auto)listing=(await sportsListings(env,deps.ctx,set,cardGroup,deps,{card,wait:true}))"), 'a card search only when someone opens or taps the card');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.ok(worker.includes('freshMs=24*3600000,retainMs=30*3600000'));

const page = fs.readFileSync('dashboard.html', 'utf8'), app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.doesNotMatch(page, /swarnerauto1@yahoo\.com/, 'no email filled in for everyone');
assert.ok(page.includes('<div class="auth-title" id="auth-title">STORE LOGIN</div>'));
assert.doesNotMatch(page + app, /WALK-OFF LOGIN/);
console.log('eBay calls: section search, day-long cache, no crawler calls; login screen without a saved email passed');
