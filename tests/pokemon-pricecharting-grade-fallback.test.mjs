import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html', 'utf8');

// Store report: PokemonPriceTracker's own eBay graded-sales data is often
// empty for less-popular/older cards, so the PSA 10/PSA 9 chips shown on
// every Pokemon result -- and the same grade data reused by the selected-
// card panel and price table -- stayed permanently dashed with no way to
// see a real number short of manually using the separate SLAB/CERT flow.
// This wires PriceCharting's graded-slab guide value in as an automatic
// fallback, sourced through the single shared pokemonPptGradeRows() so
// every consumer benefits, capped well below PPT's own hydration batch
// size since PriceCharting is a separate, metered, globally-throttled
// provider shared by every store on the Worker.

const gradeRowsStart = html.indexOf('function pokemonPptGradeRows(row = {}){');
const gradeRowsEnd = html.indexOf('\n// Fetches PriceCharting', gradeRowsStart);
const gradeRowsBody = html.slice(gradeRowsStart, gradeRowsEnd);

assert.ok(gradeRowsStart !== -1, 'pokemonPptGradeRows must exist');
assert.match(gradeRowsBody, /\['10','9'\]\.forEach\(gradeNum => \{/, 'must fold in a PriceCharting fallback for PSA 10 and PSA 9 specifically');
assert.match(gradeRowsBody, /if\(rows\.some\(r => r\.gradeLabel === label && r\.price > 0\)\) return;/, 'must never override a real PPT grade price PPT already has');
assert.match(gradeRowsBody, /const pc = row\.priceChartingGrades\?\.\[gradeNum\];/, 'must read the cached PriceCharting fallback off the row, not refetch inside a render function');
assert.match(gradeRowsBody, /source:'PriceCharting Guide',/, 'the fallback row must be tagged with a distinct source so it is never confused with a real PPT sold-comp average');

const ensureStart = html.indexOf('async function ensurePokemonPriceChartingGradeFallback(row){');
const ensureEnd = html.indexOf('\nasync function retryPokemonGradeFallback', ensureStart);
const ensureBody = html.slice(ensureStart, ensureEnd);

assert.ok(ensureStart !== -1, 'ensurePokemonPriceChartingGradeFallback must exist');
assert.match(ensureBody, /if\(row\._pcGradeFallbackTried\) return false;/, 'must try at most once automatically per row -- never hammer PriceCharting on every re-render');
assert.match(ensureBody, /const needed = \['10','9'\]\.filter\(gradeNum => !have\.some\(g => g\.gradeLabel === 'PSA ' \+ gradeNum && g\.price > 0\)\);/, 'must only request the specific grades PPT is actually missing, not always both');
assert.match(ensureBody, /if\(!needed\.length\) return false;/, 'must skip the PriceCharting call entirely when PPT already has both grades');
assert.match(ensureBody, /fetchGradedSlabPriceForItem\(\{ grader:'PSA', grade:gradeNum, name:row\.name, set:row\.set, card_number:row\.card_number \}\)/, 'must reuse the same PriceCharting helper the inventory repricing sync already uses, not a duplicate implementation');

const hydrateFallbacksStart = html.indexOf('async function hydratePokemonGradeFallbacks(indexes){');
const hydrateFallbacksEnd = html.indexOf('\nfunction qplChartModalHtml', hydrateFallbacksStart);
const hydrateFallbacksBody = html.slice(hydrateFallbacksStart, hydrateFallbacksEnd);

assert.ok(hydrateFallbacksStart !== -1, 'hydratePokemonGradeFallbacks must exist');
assert.match(hydrateFallbacksBody, /const GRADE_FALLBACK_LIMIT = 8;/, 'must cap the automatic background pass well below PPT\'s own 40-row batch -- PriceCharting is a separate metered, globally-throttled provider');
assert.match(hydrateFallbacksBody, /if\(!r\.pokemonPriceTracker\?\.lookupDebug\?\.exactHydrated\) return false;/, 'must only run after PPT hydration has actually landed for a row, so it is a real fallback and not a race with PPT itself');

// The background PPT hydration pass must actually trigger the grade fallback afterward.
const hydrateVisibleStart = html.indexOf('function hydrateVisiblePokemonPriceTrackerResults(indexes = []){');
const hydrateVisibleEnd = html.indexOf('\nfunction qplChartModalHtml', hydrateVisibleStart);
const hydrateVisibleBody = html.slice(hydrateVisibleStart, hydrateVisibleEnd);
assert.match(hydrateVisibleBody, /setTimeout\(\(\) => \{ hydratePokemonGradeFallbacks\(candidates\); \}, unhandled\.length \* HYDRATE_STAGGER_MS \+ 2000\);/,
  'the background pass must schedule the grade fallback after giving PPT hydration time to land, not run concurrently with it');

// The chip itself must fall through to the PriceCharting retry once PPT is
// confirmed to have nothing, instead of endlessly re-requesting PPT.
const chipsStart = html.indexOf('function qplGradedQuickChips(r, idx){');
const chipsEnd = html.indexOf('\nfunction quickLookupResultCard', chipsStart);
const chipsBody = html.slice(chipsStart, chipsEnd);
assert.ok(chipsStart !== -1, 'qplGradedQuickChips must exist');
assert.match(chipsBody, /const emptyAction = r\.pokemonPriceTracker\?\.lookupDebug\?\.exactHydrated\s*\n\s*\? `await retryPokemonGradeFallback\(\$\{idx\}\);`\s*\n\s*: `await loadPricesForResultCard\(\$\{idx\}\);`;/,
  'tapping an empty chip must go straight to the PriceCharting retry once PPT is already confirmed hydrated with nothing, not repeat the same PPT call');

// selectQuickLookupResult must await the fallback so the selected-card panel
// shows real grade data on first render, not just after a background pass.
const selectStart = html.indexOf('async function selectQuickLookupResult(idx){');
const selectSnippet = html.slice(selectStart, selectStart + 2500);
assert.match(selectSnippet, /await ensurePokemonPriceChartingGradeFallback\(r\)\.catch\(\(\) => false\);/,
  'selecting a card must await the PriceCharting grade fallback so the detail panel is not left showing dashes it could have filled in');

// Functional check: the actual merge logic, not just the source pattern.
// A subtle bug here (wrong grade key, overriding real PPT data, wrong price
// field) would silently show a dealer the wrong number on real money.
const gradeRowsFn = new Function('return ' + html.slice(gradeRowsStart, gradeRowsEnd))();

// PPT has real PSA 10 data, nothing for PSA 9 -- the PriceCharting fallback
// must fill in only PSA 9, and must never touch the real PSA 10 number.
const rowPartialPpt = {
  pokemonPriceTracker: { ebay: { salesByGrade: { psa10: { smartMarketPrice: { price: 500 } } } } },
  priceChartingGrades: { 10: { price: 999, lastUpdated: '2026-01-01' }, 9: { price: 120, lastUpdated: '2026-01-01' } },
};
const rowsPartial = gradeRowsFn(rowPartialPpt);
const psa10Partial = rowsPartial.find(r => r.gradeLabel === 'PSA 10');
const psa9Partial = rowsPartial.find(r => r.gradeLabel === 'PSA 9');
assert.equal(psa10Partial.price, 500, 'a real PPT PSA 10 price must never be overridden by the PriceCharting fallback');
assert.equal(psa10Partial.source, 'Graded eBay Market', 'PSA 10 must stay tagged as real PPT data, not silently relabeled');
assert.equal(psa9Partial.price, 120, 'PSA 9 must be filled in from the PriceCharting fallback since PPT had nothing for it');
assert.equal(psa9Partial.source, 'PriceCharting Guide', 'the fallback price must be tagged distinctly from real PPT sold-comp data');

// PPT has nothing at all -- both grades should come from the fallback.
const rowNoPpt = {
  pokemonPriceTracker: { ebay: { salesByGrade: {} } },
  priceChartingGrades: { 10: { price: 800 }, 9: { price: 300 } },
};
const rowsNone = gradeRowsFn(rowNoPpt);
assert.equal(rowsNone.find(r => r.gradeLabel === 'PSA 10')?.price, 800, 'PSA 10 must come from the PriceCharting fallback when PPT has nothing');
assert.equal(rowsNone.find(r => r.gradeLabel === 'PSA 9')?.price, 300, 'PSA 9 must come from the PriceCharting fallback when PPT has nothing');

// No fallback cached yet on the row -- must not fabricate a price or throw.
const rowNoFallback = { pokemonPriceTracker: { ebay: { salesByGrade: {} } } };
const rowsMissing = gradeRowsFn(rowNoFallback);
assert.ok(!rowsMissing.some(r => r.gradeLabel === 'PSA 10' || r.gradeLabel === 'PSA 9'), 'must not invent a grade row when there is no PPT data and no PriceCharting fallback cached yet');

// A zero/invalid cached fallback price must not produce a $0.00 row.
const rowZeroFallback = { pokemonPriceTracker: { ebay: { salesByGrade: {} } }, priceChartingGrades: { 10: { price: 0 }, 9: { price: null } } };
const rowsZero = gradeRowsFn(rowZeroFallback);
assert.ok(!rowsZero.some(r => r.gradeLabel === 'PSA 10' || r.gradeLabel === 'PSA 9'), 'a zero or missing cached fallback price must not render as a real $0.00 grade row');

console.log('Pokemon PriceCharting graded fallback contract checks passed');
