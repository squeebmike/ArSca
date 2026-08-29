import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Live repro: every FOC eBay listing showed a full page of unchecked
// "Suggested item specifics -- powered by eBay.ai" (Tradition, Era,
// Language, Signed, Type, Unit of Sale, Personalized, Inscribed, Vintage,
// Style, Issue Number, Publication Year) that had to be manually reviewed
// and applied on every single listing after publish -- eBay only offers
// those as AI suggestions when it has no real value for that aspect from
// what was actually submitted. customAspects previously only ever sent
// Publisher/Writer/Artist/Cover Artist/Release Date, none of which overlap
// the fields eBay was left to guess at.

assert.match(worker, /function buildFocPresaleDefaults\(sku, priceCents, onSaleDate, issueNumber = ''\) \{/,
  'buildFocPresaleDefaults must accept an issueNumber parameter');

{
  const fnStart = worker.indexOf("function buildFocPresaleDefaults(sku, priceCents, onSaleDate, issueNumber = '') {");
  const fnEnd = worker.indexOf('\n    }', fnStart) + 6;
  const fn = worker.slice(fnStart, fnEnd);
  assert.match(fn, /'Issue Number': issueNumber \|\| '', 'Publication Year': String\(onSaleDate\.getUTCFullYear\(\)\),/,
    'must send Issue Number and Publication Year derived from real data instead of leaving them for eBay to guess');
  assert.match(fn, /Tradition: 'US Comics', Era: 'Modern Age \(1992-Now\)', Language: 'English',/,
    'must send the safe universal defaults (Tradition/Era/Language) every FOC presale comic actually has');
  assert.match(fn, /Type: 'Comic Book', 'Unit of Sale': 'Single Unit', Style: 'Color',/,
    'must send Type/Unit of Sale/Style defaults');
  assert.match(fn, /Signed: 'No', Personalized: 'No', Inscribed: 'No', Vintage: 'No',/,
    'must send the No-by-default aspects for a brand-new, unsigned, non-vintage presale comic');
}

console.log('buildFocPresaleDefaults aspects contract checks passed');

// ── The issue number must actually be fetched (from the title family, not
// the SKU itself -- every variant cover of one issue shares one family row)
// and threaded through into the defaults call ──
assert.match(worker, /const \{ data: familyRows \} = await supabaseAdminFetch\(env, `comic_title_families\?id=eq\.\$\{encodeURIComponent\(sku\.family_id\)\}&select=issue_number`\);/,
  'must fetch the issue_number from comic_title_families by the sku\'s family_id');
assert.match(worker, /issueNumber = familyRows\?\.\[0\]\?\.issue_number \|\| '';/, 'must actually capture the fetched issue_number');
assert.match(worker, /const defaults = buildFocPresaleDefaults\(sku, priceCents, onSaleDate, issueNumber\);/,
  'the fetched issueNumber must actually be passed into buildFocPresaleDefaults, or fetching it was pointless');

console.log('Issue number fetch-and-thread contract checks passed');

// ── Functional: buildFocPresaleDefaults' aspect-building logic in isolation ──
{
  const fnStart = worker.indexOf("function buildFocPresaleDefaults(sku, priceCents, onSaleDate, issueNumber = '') {");
  const fnEnd = worker.indexOf('\n    }', fnStart) + 6;
  const src = worker.slice(fnStart, fnEnd).replace(/^\s*function/, 'function');
  // truncateAtWordBoundary is referenced but irrelevant to the aspects this
  // test checks -- stub it so the function can run standalone.
  const buildFocPresaleDefaults = new Function('truncateAtWordBoundary', src + '\nreturn buildFocPresaleDefaults;')(s => s);
  const sku = { title: 'Amazing Spider-Man #3', publisher: 'Marvel', writer: 'Zeb Wells', interior_artist: 'John Romita Jr.', cover_artist: 'John Romita Jr.' };
  const onSaleDate = new Date('2026-09-23T00:00:00Z');
  const result = buildFocPresaleDefaults(sku, 499, onSaleDate, '3');
  assert.equal(result.customAspects['Issue Number'], '3', 'issue number must flow through into the actual aspects sent');
  assert.equal(result.customAspects['Publication Year'], '2026', 'publication year must be derived from the on-sale date');
  assert.equal(result.customAspects.Tradition, 'US Comics');
  assert.equal(result.customAspects.Signed, 'No');
  assert.equal(result.customAspects.Publisher, 'Marvel', 'the pre-existing Publisher/Writer/Artist aspects must be unaffected');
}

console.log('buildFocPresaleDefaults aspects functional checks passed');
