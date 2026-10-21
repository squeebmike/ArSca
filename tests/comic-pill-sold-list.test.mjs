import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Store ask (cover wall screenshot, "🎨 Nogi San · sold 2"): "Can't I hover
// over this and see the different covers we sold?" The pill's hover now
// lists the sales behind the count, newest first, with price and date.
const require = createRequire(import.meta.url);
const D = require('../scripts/comic-demand.js');
const DAY = 86400000, NOW = Date.UTC(2026, 9, 21);
const ago = d => new Date(NOW - d * DAY).toISOString();
const sold = [
  { title:'Sonic the Hedgehog #4 Cover B Nogi San Variant', artist:'Nogi San', qty:1, price:4.99, at:ago(40), saleId:'s1' },
  { title:'Sonic the Hedgehog #5 Cover B Nogi San Variant', artist:'Nogi San', qty:1, price:5.99, at:ago(3), saleId:'s2', ebay:true },
];
const demand = D.buildComicDemand({ sold, stock:[], artists:['Nogi San'], now:NOW });
const g = demand.byKey.get('artist|nogi san');
assert.equal(g.sold, 2);
assert.deepEqual(g.recent.map(r => r.title), ['Sonic the Hedgehog #5 Cover B Nogi San Variant', 'Sonic the Hedgehog #4 Cover B Nogi San Variant'], 'newest first');
const intel = D.familyIntel({ id:'f', title:'SONIC THE HEDGEHOG #6', seriesName:'Sonic the Hedgehog', issueNumber:'6', variants:[{ id:'b', variantLabel:'COVER B NOGI SAN VARIANT', coverArtist:'Nogi San' }] }, demand);
const pill = intel.variants.b.find(p => p.kind === 'artist');
assert.match(pill.text, /Nogi San · sold 2/);
const lines = pill.title.split('\n');
assert.match(lines[0], /^You've sold 2 Nogi San variant covers/);
assert.match(lines[1], /^• Sonic the Hedgehog #5 Cover B Nogi San Variant — \$5\.99 \([A-Z][a-z]{2} \d{1,2}, eBay\)$/);
assert.match(lines[2], /^• Sonic the Hedgehog #4 Cover B Nogi San Variant — \$4\.99 \([A-Z][a-z]{2} \d{1,2}\)$/);
// The series pill lists its sales too.
const series = intel.pills.find(p => p.kind === 'series');
if(series) assert.match(series.title, /\n• Sonic the Hedgehog #5/);
// Long histories stop at 10 with a count of the rest.
const many = Array.from({ length:13 }, (_, i) => ({ title:'Book #' + (i + 1) + ' Cover B Nogi San Variant', artist:'Nogi San', qty:1, price:5, at:ago(i + 1), saleId:'m' + i }));
const big = D.buildComicDemand({ sold:many, stock:[], artists:['Nogi San'], now:NOW }).byKey.get('artist|nogi san');
assert.equal(big.recent.length, 10); assert.equal(big.recentMore, 3);
const bigPill = D.familyIntel({ id:'f', title:'BOOK #14', seriesName:'Book', issueNumber:'14', variants:[{ id:'b', variantLabel:'COVER B', coverArtist:'Nogi San' }] }, D.buildComicDemand({ sold:many, stock:[], artists:['Nogi San'], now:NOW })).variants.b.find(p => p.kind === 'artist');
assert.match(bigPill.title, /\n\+ 3 more$/);
console.log('Comic pill sold-list hover checks passed');
