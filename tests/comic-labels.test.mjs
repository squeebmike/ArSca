import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store ask: comic labels should show the book, the ratio and the cover
// artist or variant name -- no condition. A received FOC book's name is the
// whole solicitation, so the part that tells covers apart was cut off.
const d = fs.readFileSync('dashboard.html', 'utf8');
const a = d.indexOf('function isComicLabelItem('), b = d.indexOf('\nfunction openLabelPrintModal', a);
const ctx = { qplCategoryKey: c => /comic/i.test(c) ? 'comic' : 'other' };
vm.createContext(ctx);
vm.runInContext(d.slice(a, b) + ';this.c=comicLabelParts;this.isComic=isComicLabelItem;', ctx);
const c = x => JSON.parse(JSON.stringify(ctx.c(x)));

assert.deepEqual(c({ category:'Comic', name:'SPIDER-WOMAN #1 -- COVER F MARK BROOKS VIRGIN 1:100 VARIANT', variant:'COVER F MARK BROOKS VIRGIN 1:100 VARIANT', publisher:'Marvel', year:'2026', raw:{ series:'Spider-Woman', issue:'1', focComicDetail:{ coverArtists:['Mark Brooks'] } } }),
  { name:'Spider-Woman #1', badge:'1:100 · CVR F MARK BROOKS VIRGIN', meta:'Marvel · 2026', condition:'' });
assert.deepEqual(c({ category:'Comic', name:'MIDNIGHT X-MEN #1 COVER F CLAYTON CRAIN 3-PART CONNECTING VARIANT -- COVER F CLAYTON CRAIN 3-PART CONNECTING VARIANT', variant:'COVER F CLAYTON CRAIN 3-PART CONNECTING VARIANT', raw:{ focComicDetail:{ coverArtists:['Clayton Crain'], seriesName:'Midnight X-Men', number:'1', publisher:'Marvel', storeDate:'2026-10-07' } } }),
  { name:'Midnight X-Men #1', badge:'CVR F CLAYTON CRAIN 3-PART CONNECTING', meta:'Marvel · 2026', condition:'' }, 'publisher and year from the FOC details');
assert.equal(c({ category:'Comic', name:'SABRINA THE TEENAGE WITCH #1 CVR I INC 1:20 DAN PARENT CLASSIC VAR -- Variant Title', variant:'Variant Title', raw:{ focComicDetail:{ coverArtists:['Dan Parent'] } } }).badge, '1:20 · CVR I DAN PARENT CLASSIC', 'the "Variant Title" placeholder is dropped');
const godzilla = c({ category:'Comic', name:'Godzilla’s Monsterpiece Theatre Presents: The Kaiju of Oz Variant RI (10) (Beals) -- Variant Title', variant:'Variant Title', raw:{ series:'Godzilla’s Monsterpiece Theatre Presents: The Kaiju of Oz', issue:'1' } });
assert.equal(godzilla.badge, '1:10 · Beals', '"RI (10)" is a 1:10 ratio');
assert.equal(c({ category:'Comic', name:'SPIDER-WOMAN #1 COVER A', variant:'COVER A', raw:{ focComicDetail:{ coverArtists:['Pete Woods'] } } }).badge, 'CVR A Pete Woods', 'the cover artist when the variant names none');
assert.equal(c({ category:'Comic', name:'Amazing Spider-Man #300', is_key:true, publisher:'Marvel', year:'1988' }).badge, 'KEY');
assert.equal(c({ category:'Comic', name:'Saga #1', serial_number:'/500', variant:'Cover B 1:25' }).badge, '/500 · 1:25 · CVR B');
assert.equal(c({ category:'Comic', name:'X' }).condition, '', 'no condition on comics');
assert.equal(ctx.isComic({ category:'Comic' }), true);
assert.equal(ctx.isComic({ category:'Pokemon TCG' }), false);

// Wiring: comics use these parts, other items are unchanged; the thermal
// (canvas) label fits a long badge and shows publisher · year instead of condition.
assert.match(d, /return isComicLabelItem\(item\) \? \{ \.\.\.entry, \.\.\.comicLabelParts\(item\) \} : entry;/);
assert.match(d, /const badgeLines = labelFitLines\(t, String\(b\.badge\)\.toUpperCase\(\), contentW, 2\);/, 'a long badge wraps to 2 lines and ends in "…" past that, like the PC label');
assert.match(d, /drawLines\(\[fdLabelPrice\$\(b\.price\)\.slice\(1\)\], cx, Math\.max\(y \+ gap, rowTop - gap - 24\)/, 'the price never overlaps a 2-line name plus a 2-line badge');
assert.match(d, /if\(b\.meta\)\{\s*\n\s*setFont\(6, false\);/, 'publisher · year shows in the bottom row (comics carry no condition)');
// The browser-print label keeps "#issue" on a long name too.
const kn = d.match(/function labelNameKeepNumber\(name, max\)\{[\s\S]*?\n\}/)[0];
const keep = new Function(kn + ';return labelNameKeepNumber;')();
assert.equal(keep('Spider-Woman #1', 24), 'Spider-Woman #1');
assert.equal(keep('SABRINA THE TEENAGE WITCH #1', 24), 'SABRINA THE TEENAGE… #1');
assert.equal(keep('A very long trading card name without a number', 24), 'A very long trading card name without a number', 'unnumbered names are left to the CSS clamp');
console.log('Comic label checks passed');
