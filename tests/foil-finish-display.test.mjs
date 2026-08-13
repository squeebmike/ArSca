import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// ── Dashboard: implied-variant computation exists and feeds the one field
// (variant) that the table, edit modal, and storefront all already display ──
assert.match(dashboard, /const impliedFinishKey = String\(r\.selectedFinish \|\| r\.finish \|\| ''\)\.toLowerCase\(\);/, 'missing impliedFinishKey computation');
assert.match(dashboard, /const impliedFinishLabel = \(!isComic && impliedFinishKey && !\['normal','nonfoil'\]\.includes\(impliedFinishKey\)\) \? qplFinishLabel\(impliedFinishKey\) : '';/, 'MTG/Pokemon/TCG items must default to the finish label, but only when non-comic and not a normal/nonfoil finish');
assert.match(dashboard, /const impliedComicFoilVariant = \(isComic && r\.selectedComicCover\?\.isFoil && !\/\\bfoil\\b\/i\.test\(r\.variant \|\| ''\)\) \? \(\(r\.variant \? r\.variant \+ ' ' : ''\) \+ '\(Foil\)'\) : '';/, 'comics with a manually-flagged foil cover must append "(Foil)" to the variant, without duplicating an already-foil-named cover');
assert.match(dashboard, /variant:impliedComicFoilVariant \|\| r\.variant \|\| impliedFinishLabel \|\| '',/, 'the final variant field must prefer the comic foil note, then whatever staff/source already set, then the implied finish label');

console.log('Dashboard foil/finish implied-variant checks passed');

// ── Worker: comic detail popup's selectedCover must also reflect isFoil,
// not just the top-level variant field, and must not double-append "(Foil)"
// when the cover name already says so ──
assert.match(worker, /selectedCover: storefrontCleanText\(\(m\.selectedCover\?\.issueName \|\| m\.selectedCover\?\.name \|\| d\.variant \|\| ''\) \+ \(m\.selectedCover\?\.isFoil && !\/\\bfoil\\b\/i\.test\(m\.selectedCover\?\.issueName \|\| m\.selectedCover\?\.name \|\| ''\) \? ' \(Foil\)' : ''\), 120\),/, 'storefrontComicDetailFor must append (Foil) to selectedCover when the cover is flagged foil and the name does not already say so');

console.log('Worker storefront comic-detail foil checks passed');

// ── Functional: the implied-variant logic itself ─────────────────────────
function computeVariant(r, isComic){
  const impliedFinishKey = String(r.selectedFinish || r.finish || '').toLowerCase();
  const qplFinishLabel = (value) => ({ foil:'Foil', holofoil:'Holofoil', etched_foil:'Etched Foil' })[value] || String(value || 'Other').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const impliedFinishLabel = (!isComic && impliedFinishKey && !['normal','nonfoil'].includes(impliedFinishKey)) ? qplFinishLabel(impliedFinishKey) : '';
  const impliedComicFoilVariant = (isComic && r.selectedComicCover?.isFoil && !/\bfoil\b/i.test(r.variant || '')) ? ((r.variant ? r.variant + ' ' : '') + '(Foil)') : '';
  return impliedComicFoilVariant || r.variant || impliedFinishLabel || '';
}

assert.equal(computeVariant({ selectedFinish:'foil' }, false), 'Foil', 'a foil MTG card with no manual variant must default to "Foil"');
assert.equal(computeVariant({ selectedFinish:'holofoil' }, false), 'Holofoil', 'a holofoil Pokemon card must default to "Holofoil"');
assert.equal(computeVariant({ selectedFinish:'normal' }, false), '', 'a normal-finish card must not get a fabricated variant note');
assert.equal(computeVariant({ selectedFinish:'foil', variant:'Borderless' }, false), 'Borderless', 'a staff-entered variant must never be overwritten by the implied finish label');
assert.equal(computeVariant({ variant:'Cover A', selectedComicCover:{ isFoil:true } }, true), 'Cover A (Foil)', 'a foil comic cover must append (Foil) to the existing cover name');
assert.equal(computeVariant({ variant:'Foil Variant Cover', selectedComicCover:{ isFoil:true } }, true), 'Foil Variant Cover', 'must not double-append (Foil) when the cover name already mentions foil');
assert.equal(computeVariant({ selectedComicCover:{ isFoil:false } }, true), '', 'a non-foil comic cover must get no note');

console.log('Implied-variant functional checks passed');
