import fs from 'node:fs';
import assert from 'node:assert/strict';

const preorders = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const focDash = fs.readFileSync('scripts/foc-dashboard.js', 'utf8');

// Store idea (FOC Intelligence 2.0): when a new PRH FOC file comes in,
// compare it against prior submitted orders, current presales, and recent
// comic sales to suggest ORDER / REDUCE / SKIP / SPEC per title, and flag
// a book that had real secured interest in an earlier import but silently
// vanished from a more recent one (the "He-Man situation"). Deliberately
// does NOT fabricate an "upcoming movies/events/signings" signal -- no
// real data source for that exists in this app.

assert.match(preorders, /if\(path==='\/foc\/admin\/intelligence'&&request\.method==='GET'\)return focIntelligence\(request,env,deps,url\);/, 'the /foc/admin/intelligence route must be wired up');
assert.match(preorders, /async function focIntelligence\(request,env,deps,url\)\{/, 'missing focIntelligence');

const fnStart = preorders.indexOf('async function focIntelligence(request,env,deps,url){');
const fnEnd = preorders.indexOf('\nasync function', fnStart + 10);
const fn = preorders.slice(fnStart, fnEnd);
assert.doesNotMatch(fn, /movie|box office|signing event/i, 'must not claim a movie/event/signing signal that has no real data source backing it');
assert.match(fn, /const qty=await orderedQtyBySku\(db,cycleId\);/, 'must reuse the existing website-presold helper, not reimplement it');
assert.match(fn, /const ebayPresold=await ebayPresoldBySku\(db,storeId\);/, 'must reuse the existing eBay-presold helper, not reimplement it');
assert.match(fn, /category=eq\.Comic&created_at=gte\.\$\{cutoff\}/, 'must pull real POS comic sales for the recent-sales signal');
assert.match(fn, /if\(sub\.cycle_id===cycleId\)return;/, 'prior-order history must exclude the current cycle\'s own (not-yet-submitted or in-progress) data');
assert.match(fn, /if\(currentDemand>0\)\{ action='ORDER';/, 'existing real demand this cycle must always win -> ORDER');
assert.match(fn, /else if\(hasOrderHistory&&recentSalesQty>0\)\{ action='ORDER';/, 'habitual + still selling -> ORDER');
assert.match(fn, /else if\(hasOrderHistory&&recentSalesQty===0\)\{ action='REDUCE';/, 'habitual but cooling -> REDUCE, not blind reorder');
assert.match(fn, /else if\(!hasOrderHistory&&recentSalesQty>0\)\{ action='SPEC';/, 'real sales signal with no order history -> SPEC (speculative), distinct from routine ORDER');
assert.match(fn, /else \{ action='SKIP';/, 'no signal at all -> SKIP');

// Disappeared-book check
assert.match(fn, /id=neq\.\$\{encodeURIComponent\(cycleId\)\}&select=id,imported_at&order=imported_at\.desc&limit=2/, 'must compare the two most recently IMPORTED prior cycles, not just by FOC date (a store can import out of chronological order)');
assert.match(fn, /if\(s\.on_sale_date&&new Date\(s\.on_sale_date\)\.getTime\(\)<=new Date\(older\.imported_at\)\.getTime\(\)\)return;/, 'a book already past its on-sale date at import time must NOT be flagged as disappeared -- that\'s normal roll-off');
assert.match(fn, /\.filter\(f=>!newerIds\.has\(f\.distributor_family_id\)&&securedByFamily\.has\(f\.id\)\)/, 'only a distributor_family_id both absent from the newer import AND with real secured interest counts as disappeared -- zero-interest titles rolling off isn\'t news');

console.log('FOC Intelligence 2.0 backend contract checks passed');

// ── Dashboard UI wiring ──
assert.match(focDash, /onclick="openFocIntelligence\(\)">🧠 FOC INTELLIGENCE<\/button>/, 'Cover Wall toolbar must have an entry point');
assert.match(focDash, /function openFocIntelligence\(\)\{/, 'missing openFocIntelligence');
assert.match(focDash, /function loadFocIntelligence\(cycleId\)\{/, 'missing loadFocIntelligence');
const renderStart = focDash.indexOf('function renderFocIntelligence(recommendations,disappeared){');
assert.ok(renderStart !== -1, 'missing renderFocIntelligence');
const renderEnd = focDash.indexOf('\nwindow.', renderStart);
const renderFn = focDash.slice(renderStart, renderEnd);
assert.match(renderFn, /DISAPPEARED FROM A NEWER FOC/, 'must render the disappeared-books warning distinctly');
assert.match(renderFn, /Sorted ORDER → SPEC → REDUCE → SKIP/, 'must communicate the sort order to the reader');
assert.match(focDash, /window\.openFocIntelligence=openFocIntelligence;/, 'openFocIntelligence must be exposed on window for its onclick attribute to find it (this whole file is IIFE-wrapped)');

console.log('FOC Intelligence 2.0 dashboard wiring contract checks passed');

// ── Functional: reimplement the recommendation + disappeared-book logic ──
const STOPWORDS = new Set(['the','and','of','vol','volume','tpb','hc','presents','annual','special','one','shot','issue','cover']);
function significantWords(text){ return String(text||'').toLowerCase().replace(/#\d+.*/,'').replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>=4&&!STOPWORDS.has(w)); }
function titlesRelated(a,b){ const wa=new Set(significantWords(a)); return significantWords(b).some(w=>wa.has(w)); }
function recommend({ currentDemand, hasOrderHistory, recentSalesQty }){
  if(currentDemand>0) return 'ORDER';
  if(hasOrderHistory&&recentSalesQty>0) return 'ORDER';
  if(hasOrderHistory&&recentSalesQty===0) return 'REDUCE';
  if(!hasOrderHistory&&recentSalesQty>0) return 'SPEC';
  return 'SKIP';
}

assert.equal(recommend({ currentDemand:3, hasOrderHistory:false, recentSalesQty:0 }), 'ORDER', 'real presales this cycle always wins, regardless of history');
assert.equal(recommend({ currentDemand:0, hasOrderHistory:true, recentSalesQty:5 }), 'ORDER', 'habitual title still selling -> ORDER');
assert.equal(recommend({ currentDemand:0, hasOrderHistory:true, recentSalesQty:0 }), 'REDUCE', 'habitual title gone cold -> REDUCE');
assert.equal(recommend({ currentDemand:0, hasOrderHistory:false, recentSalesQty:2 }), 'SPEC', 'real sales with no order history -> SPEC');
assert.equal(recommend({ currentDemand:0, hasOrderHistory:false, recentSalesQty:0 }), 'SKIP', 'nothing at all -> SKIP');

assert.ok(titlesRelated('Amazing Spider-Man #47 Cover A', 'Spider-Man 2099: Exodus #1'));
assert.ok(!titlesRelated('Amazing Spider-Man #47', 'Batman: The Long Halloween'));

console.log('FOC Intelligence 2.0 functional checks passed');
