import assert from 'node:assert/strict';
import fs from 'node:fs';
import { coverLabelFromTitle, uniqueCoverLabels, normalizeLunarRow } from '../scripts/foc-preorders.mjs';

// Store report: a Lunar multi-cover eBay listing (Robin Hood #1) failed with
// "AddFixedPriceItem failed: Duplicate VariationSpecifics trait value in the
// VariationSpecificsSet container." Lunar covers were labeled by artist only,
// and Nakayama drew B, G and M -- three identical "Cover" choices.
assert.equal(coverLabelFromTitle('ROBIN HOOD (2026) #1 CVR K INC 1:10 PHIL HESTER VIRGIN VAR'), 'Cvr K 1:10 Phil Hester Virgin');
assert.equal(coverLabelFromTitle('ROBIN HOOD (2026) #1 CVR A JOSHUA MIDDLETON'), 'Cvr A Joshua Middleton');
assert.equal(coverLabelFromTitle('ROBIN HOOD (2026) #1 CVR G DAVID NAKAYAMA METAL PREMIUM VAR'), 'Cvr G David Nakayama Metal Premium');
assert.equal(coverLabelFromTitle('JUDGE DREDD BIKER MICE #1 CVR H DAVID FINCH B&W VAR'), 'Cvr H David Finch B&W');
assert.equal(coverLabelFromTitle('Batwoman #8 Cvr D David Nakayama Card Stock Var'), 'Cvr D David Nakayama Card Stock', 'mixed case is left as written');
assert.equal(coverLabelFromTitle('Some Book #1'), '', 'no cover part');

const robinHood = [
  ['Joshua Middleton', 'ROBIN HOOD (2026) #1 CVR A JOSHUA MIDDLETON'],
  ['David Nakayama', 'ROBIN HOOD (2026) #1 CVR B DAVID NAKAYAMA VAR'],
  ['David Aja', 'ROBIN HOOD (2026) #1 CVR C DAVID AJA VAR'],
  ['Blank Authentix', 'ROBIN HOOD (2026) #1 CVR F BLANK AUTHENTIX VAR'],
  ['David Nakayama', 'ROBIN HOOD (2026) #1 CVR G DAVID NAKAYAMA METAL PREMIUM VAR'],
  ['Phil Hester', 'ROBIN HOOD (2026) #1 CVR K INC 1:10 PHIL HESTER VIRGIN VAR'],
  ['David Aja', 'ROBIN HOOD (2026) #1 CVR L INC 1:15 DAVID AJA VIRGIN VAR'],
  ['David Nakayama', 'ROBIN HOOD (2026) #1 CVR M INC 1:20 DAVID NAKAYAMA VIRGIN VAR'],
].map(([label, title]) => ({ label, title }));
const labels = uniqueCoverLabels(robinHood);
assert.equal(new Set(labels.map(l => l.toLowerCase())).size, labels.length, 'every Cover choice is different');
assert.deepEqual(labels, ['Joshua Middleton', 'Cvr B David Nakayama', 'Cvr C David Aja', 'Blank Authentix', 'Cvr G David Nakayama Metal Premium', 'Phil Hester', 'Cvr L 1:15 David Aja Virgin', 'Cvr M 1:20 David Nakayama Virgin'],
  'only the shared labels change');
// Shared labels with no cover part in the title still come out different.
assert.deepEqual(uniqueCoverLabels([{ label: 'Cover', title: 'X' }, { label: 'Cover', title: 'Y' }, { label: 'cover', title: 'Z' }]), ['Cover', 'Cover (2)', 'cover (3)']);

// New Lunar imports are labeled from the title's cover part.
const lunar = normalizeLunarRow({ Title: 'ROBIN HOOD (2026) #1 CVR M INC 1:20 DAVID NAKAYAMA VIRGIN VAR', CoverArtist: 'David Nakayama', ItemCode: '0926DE0746', UPC: '72513036855301131', RetailCost: '3.99', FinalOrderCutoff: '2026-09-22', InstoreDate: '2026-10-21', Publisher: 'Dynamite' });
assert.equal(lunar.variantLabel, 'Cvr M 1:20 David Nakayama Virgin');

// The group listing builds its covers with unique labels, and a single-cover
// title doesn't repeat its own cover part.
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(worker, /const coverLabels = uniqueCoverLabels\(skuRows\.map\(sku => \(\{ label: sku\.variant_label \|\| 'Cover', title: sku\.title \}\)\)\);/);
assert.match(worker, /skuId: sku\.id, variantLabel: coverLabels\[i\],/);
assert.match(worker, /&& coverLabelFromTitle\(baseTitle\) !== sku\.variant_label/);
console.log('Lunar unique cover label checks passed');
