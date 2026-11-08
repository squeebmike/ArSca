import assert from 'node:assert/strict';
import fs from 'node:fs';
// Store, 2026-11-08: "I need to be able to copy and paste a pricecharting link
// for pokemon cards. Ie chinese". A pasted PriceCharting link is looked up
// exactly (name, set, photo, price) for every category, not only sports.
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
assert.doesNotMatch(app, /priceChartingProduct && row\.category === 'Sports Card'/, 'no sports-only gate');
assert.match(app, /if\(!tcgProduct && priceChartingProduct\)\{\n\s*await applyPastedPriceChartingUrl\(row, priceChartingProduct\);/);
assert.match(app, /if\(!tcgProduct\) await applyPastedPriceChartingUrl\(row, pcProduct\);/, 'the barcode/link box too');
assert.match(app, /async function applyPastedPriceChartingUrl\(row, product\)\{[\s\S]{0,400}resolveSportsPriceChartingUrl\(product\?\.canonicalUrl\)/);
assert.match(app, /row\.market = Number\(pc\.prices\?\.ungraded \|\| 0\) \|\| Number\(pc\.prices\?\.grade8 \|\| 0\);/);
// Selecting it never swaps the exact link for an English TCGplayer search match.
assert.match(app, /qplResultCategoryKey\(r\) === 'pokemon' && !r\.pricecharting\?\.savedExactLink && r\.source !== 'pricecharting_url' &&/);
// If the page lookup fails, the catalog search is used, but only for the exact same link.
assert.match(app, /async function priceChartingProductByExactLink\(product\)\{/);
assert.match(app, /\.find\(p => path\(p\.url\) === want\) \|\| null;/);
assert.match(app, /\.\.\.\(lang \? \{ language:lang, selectedLanguage:lang \} : \{\}\),/);
// Chinese Pokemon sets are PriceCharting "pokemon-chinese-..." consoles: Pokemon TCG.
assert.match(app, /if\(\/pokemon\|pok\[eé\]mon\/\.test\(s\)\) return 'Pokemon TCG';/);
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(w, /if \(url\.pathname === '\/pricing\/pricecharting\/resolve-url'\) \{/);
console.log('Pasted PriceCharting links resolve for every category passed');
