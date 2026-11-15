// TCGPLAYER PARTNER LINKS (store, 2026-11-15: Dave's Edit Item VERIFY said a TCGplayer link "was a partner link and not
// valid"). Magic cards added from the Scryfall search carried Scryfall's partner (affiliate) link, which wraps the real
// product page; the dashboard reads the product page out of it, and new cards save the plain product page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8'), html = fs.readFileSync('dashboard.html', 'utf8');
const grab = sig => { const i = app.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = app.indexOf('{', i); for (; j < app.length; j++) { if (app[j] === '{') d++; else if (app[j] === '}' && !--d) break; } return app.slice(i, j + 1); };
const { unwrapTcgplayerLink, tcgPlayerProductIdFromUrl, plainTcgplayerUrl } = new Function([grab('function unwrapTcgplayerLink('), grab('function tcgPlayerProductIdFromUrl('), grab('function plainTcgplayerUrl('), 'return { unwrapTcgplayerLink, tcgPlayerProductIdFromUrl, plainTcgplayerUrl };'].join('\n'))();
const scryfall = 'https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F12345%3Fpage%3D1';
assert.equal(tcgPlayerProductIdFromUrl(scryfall), '12345', "Scryfall's partner link");
assert.equal(tcgPlayerProductIdFromUrl('https://partner.tcgplayer.com/k443Ov?u=' + encodeURIComponent('https://www.tcgplayer.com/product/654135/pokemon-x')), '654135', 'our own partner link');
assert.equal(tcgPlayerProductIdFromUrl('https://tcgplayer.pxf.io/c/1/2/3?u=' + encodeURIComponent('https://www.tcgplayer.com/product/777777')), '777777', 'an Impact (pxf.io) link');
assert.equal(tcgPlayerProductIdFromUrl('https://www.tcgplayer.com/product/88888/magic-x?Language=English'), '88888', 'a plain link still works');
assert.equal(tcgPlayerProductIdFromUrl('https://www.tcgplayer.com/search/magic/product?q=bolt'), '', 'a search page is not a product');
assert.equal(unwrapTcgplayerLink('https://www.tcgplayer.com/product/1?u=x'), 'https://www.tcgplayer.com/product/1?u=x', 'a real tcgplayer.com page is left alone');
assert.equal(plainTcgplayerUrl(scryfall), 'https://www.tcgplayer.com/product/12345'); assert.equal(plainTcgplayerUrl('', '4321'), 'https://www.tcgplayer.com/product/4321');
// Edit Item shows the plain product page; Research reads partner links; new Scryfall cards save the plain page.
assert.ok(app.includes("const url = plainTcgplayerUrl(item.tcgPlayerUrl || item.tcgUrl || '', id);"));
assert.ok(app.includes("const text = unwrapTcgplayerLink(raw); // a partner/affiliate link reads as the product page inside it"));
assert.ok(!/tcgPlayerUrl:c\.purchase_uris\?\.tcgplayer \|\|/.test(app) && !/exactTcgUrl = c\.purchase_uris\?\.tcgplayer \|\|/.test(app), 'the partner link is never saved first');
assert.ok(html.includes('<label style="display:block">TCGplayer Product ID or URL</label>'), 'not labelled Pokemon-only');
console.log('TCGplayer partner links: passed');
