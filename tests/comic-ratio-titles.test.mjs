import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withRatioWord } from '../scripts/foc-preorders.mjs';

// Store request: every ratio comic's title says "ratio" -- "1:25 Ratio".
const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const service = fs.readFileSync('scripts/foc-preorders.mjs', 'utf8');
const start = app.indexOf('function withRatioWord(');
const end = app.indexOf('\n}\n', start) + 2;
const dashWithRatioWord = new Function(app.slice(start, end) + '\nreturn withRatioWord;')();

const cases = [
  ['MIDNIGHT SPIDER-MAN #1 COVER E JEEHYUNG LEE MIDNIGHT GALLERY 1:25 VARIANT', 'MIDNIGHT SPIDER-MAN #1 COVER E JEEHYUNG LEE MIDNIGHT GALLERY 1:25 RATIO VARIANT'],
  ['Venom #1 Cover G 1:100 Adi Granov Virgin', 'Venom #1 Cover G 1:100 Ratio Adi Granov Virgin'],
  ['ARCHIE #2 CVR E INC 1:20 DAN PARENT LEGACY VAR - PRESALE', 'ARCHIE #2 CVR E INC 1:20 RATIO DAN PARENT LEGACY VAR - PRESALE'],
  ['12-Foot Skeleton #1 Cover C Tim Seeley 1:10 -- Cover C Tim Seeley 1:10', '12-Foot Skeleton #1 Cover C Tim Seeley 1:10 Ratio -- Cover C Tim Seeley 1:10 Ratio'],
  ['Hellraiser #1 D 1:10 INCV (Full Art)', 'Hellraiser #1 D 1:10 Ratio INCV (Full Art)'],
  ['Thing #1 1 : 50 var', 'Thing #1 1:50 Ratio var'],
  ['Already 1:25 Ratio Variant', 'Already 1:25 Ratio Variant'],
  ['Already 1:25 ratio', 'Already 1:25 ratio'],
  ['JEAN GREY #1 COVER F ITO VIRGIN 1:100 VARIANT Marvel - PRESALE', 'JEAN GREY #1 COVER F ITO VIRGIN 1:100 RATIO VARIANT Marvel - PRESALE'],
  ['Archie #2 CVR G INC 1:100 STUART IMMONEN B&W VAR', 'Archie #2 CVR G INC 1:100 RATIO STUART IMMONEN B&W VAR'],
  ['Cover A', 'Cover A'],
  ['', ''],
];
for (const [input, want] of cases) {
  assert.equal(withRatioWord(input), want, input);
  assert.equal(dashWithRatioWord(input), want, 'dashboard copy must match: ' + input);
  assert.equal(withRatioWord(withRatioWord(input)), want, 'running it twice changes nothing');
}

// Where titles are built.
assert.match(service, /variantLabel:withRatioWord\(text\(row\.variant_label, 300\)\) \|\| 'Cover A'/, 'website + cover wall');
assert.match(service, /name:withRatioWord\(\[sku\.title,sku\.variant_label/, 'received books');
assert.match(worker, /const titleBase = withRatioWord\(\[baseTitle, variantLabel\]/, 'eBay presale titles');
assert.match(worker, /label: withRatioWord\(cover\.variantLabel\)/, 'eBay group listing cover choices');
assert.match(worker, /name: v\.skuId \? withRatioWord\(\[family\.title, v\.label\]/);
assert.match(app, /name:\(typeof comicName === 'function' \? comicName\(updates\.name \?\? item\.name \?\? '', updates\.category \?\? item\.category\)/, 'saving any comic');
assert.match(app, /if\(data\.name\) data\.name = comicName\(data\.name, data\.category\);/, 'adding a comic');
assert.match(app, /isComic \? withRatioWord\(item\.name\) : item\.name,/, 'eBay titles from inventory');
assert.match(app, /function comicName\(name, category\)\{ return category === 'Comic' \? withRatioWord\(name\) : name; \}/, 'only comics');

console.log('Comic ratio titles checks passed');
