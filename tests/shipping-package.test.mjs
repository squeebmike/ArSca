import assert from 'node:assert/strict';
import fs from 'node:fs';
import { packageFor, PACKAGES, PWE_MAX_PRICE } from '../scripts/shipping-package.mjs';
import { whatnotDesired, WHATNOT_PROFILES } from '../scripts/whatnot-sync.mjs';

// Store, 2026-11-05: "Some singles go in the small bubble mailer. Is it over
// 20 dollars? Those aren't the pwe ... Fix the shipping issues for all items."
const k = (name, extra = {}, price = 0) => packageFor({ name, category: 'Pokemon TCG', ...extra }, price).kind;

// Singles: under $20 a plain envelope, $20 and up a bubble mailer.
assert.equal(PWE_MAX_PRICE, 20);
assert.equal(k('Giratina (Team Plasma)', {}, 8), 'pwe');
assert.equal(k('Giratina (Team Plasma)', {}, 19.99), 'pwe');
assert.equal(k('Charizard ex - 199/165 SV: Scarlet & Violet 151 Special Illustration Rare', {}, 397), 'bubble');
assert.equal(k('Pikachu', {}, 20), 'bubble');
assert.equal(k('Charizard - Celebrations Classic Collection', { cardNumber: '4/102' }, 30), 'bubble', 'a numbered card from a "Collection" set is a single');
// Slabs.
assert.equal(k('Pikachu ex - 219/191 PSA 10', {}, 150), 'slab');
assert.equal(k('Lucario V', { grader: 'CGC', grade: '9.5' }, 40), 'slab');
// Sealed Pokemon, told apart by name even with no sealed flag (the store's
// own imports: blank or "Single" product types).
assert.equal(k('Black Bolt Elite Trainer Box'), 'etb');
assert.equal(k('White Flare Elite Trainer Box', { productType: 'Single' }), 'etb');
assert.equal(k('Surging Sparks Booster Box'), 'booster_box');
assert.equal(k('Destined Rivals Booster Bundle', { productType: 'Single' }), 'bundle');
assert.equal(k('Perfect Order Build & Battle Box'), 'bundle');
assert.equal(k('Sleeved Booster Pack', { productType: 'sealed' }), 'pack');
assert.equal(k('Chaos Rising Booster Pack'), 'pack');
assert.equal(k('30th Celebration Mini Tin [Espeon]', { productType: 'sealed' }), 'small_sealed');
assert.equal(k('Pitch Black 3-Pack Blister [Binacle]', { productType: 'sealed' }), 'small_sealed');
assert.equal(k('Paradox Clash Tin [Iron Leaves ex]', { productType: 'sealed' }), 'tin');
assert.equal(k('Mega Greninja ex Premium Collection', { productType: 'sealed' }), 'premium');
// Magic: a set Bundle is ETB-sized; displays are boxes.
assert.equal(packageFor({ name: 'Tarkir: Dragonstorm - Bundle', category: 'Magic: The Gathering', productType: 'sealed' }).kind, 'etb');
assert.equal(packageFor({ name: 'Teenage Mutant Ninja Turtles - Play Booster Display', category: 'Magic: The Gathering', productType: 'sealed' }).kind, 'booster_box');
// Supplies by what they are, not sealed-product words.
const sup = n => packageFor({ name: n, category: 'Supplies' }).kind;
assert.equal(sup('Prism Deck Case - Matrix - Green'), 'small_sealed', 'a deck case is not a 12 lb case');
assert.equal(sup('LaserWeld 9-Pocket Page (50 CT. Pack)'), 'box', 'a 50-count pack of pages is not a booster pack');
assert.equal(sup('Acrylic Helmet Display'), 'large_supply', 'a display stand is not a booster box');
// Comics keep the Gemini mailer.
assert.equal(packageFor({ name: 'X-Force #4', category: 'Comic' }).kind, 'comic');
// A weight typed on the item wins (and its size, when given).
const c = packageFor({ name: 'Black Bolt Elite Trainer Box', shipWeightOz: 36, shipDims: '11 x 9 x 4' });
assert.deepEqual([c.kind, c.weightOz, c.length, c.width, c.height], ['custom', 36, 11, 9, 4]);
// Every package has a sensible weight and size.
for (const [kind, p] of Object.entries(PACKAGES)) assert.ok(p.weightOz > p.contentsOz && p.length >= p.width && p.height > 0, kind);

// Whatnot gets the right profile, from the item's details.
const row = (data) => ({ id: '00000000-0000-4000-8000-000000000009', status: 'in_stock', data: { sellOnWhatnot: true, quantity: 1, ...data } });
const want = (data, item) => whatnotDesired(row(data), { photos: [], categorySlug: 'pokemon', ...item });
assert.equal(want({ name: 'Black Bolt Elite Trainer Box' }, { name: 'Black Bolt Elite Trainer Box', price: 60 }).profileKind, 'v2-etb');
assert.deepEqual(want({ name: 'Black Bolt Elite Trainer Box' }, { name: 'Black Bolt Elite Trainer Box', price: 60 }).profile, WHATNOT_PROFILES['v2-etb']);
assert.deepEqual(WHATNOT_PROFILES['v2-etb'].weight, { value: 40, unit: 'ounce' }, 'ETB: 40 oz packed');
assert.equal(want({ name: 'Charmander' }, { name: 'Charmander', price: 5 }).profileKind, 'v2-pwe');
assert.equal(want({ name: 'Charizard ex' }, { name: 'Charizard ex', price: 397 }).profileKind, 'v2-bubble');
assert.equal(want({ name: 'Charizard ex', grade: '10' }, { name: 'Charizard ex', price: 397, gradingCompany: 'PSA' }).profileKind, 'v2-slab');
assert.equal(want({ name: 'X-Force #4' }, { name: 'X-Force #4', price: 5, categorySlug: 'comics' }).profileKind, 'comic', 'comics keep their saved profile');
const custom = want({ name: 'Odd box', shipWeightOz: 20 }, { name: 'Odd box', price: 30, isSealed: true });
assert.equal(custom.profileKind, '', 'a typed weight is never saved as a shared profile');
assert.deepEqual(custom.profile.weight, { value: 20, unit: 'ounce' });

// The website's shipping quote uses the same chart.
const w = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
assert.match(w, /const pkg = packageFor\(d, unitPrice\);/);
assert.match(w, /totalWeightOz \+= pkg\.contentsOz \* qty;/);
assert.match(fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8'), /scripts\/shipping-package\.mjs/);
console.log('Shipping packages: singles by price, sealed by what it is, supplies, slabs, comics, custom weights passed');
