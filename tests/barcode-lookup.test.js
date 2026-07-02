const assert=require('assert');
const fs=require('fs');
const path=require('path');
const barcode=require('../scripts/barcode-lookup');
const root=path.resolve(__dirname,'..');
const dashboard=fs.readFileSync(path.join(root,'dashboard.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'cloudflare-worker-full.js'),'utf8');

const ean=barcode.normalizeBarcode('0759606017720');
assert.equal(ean.ean13,'0759606017720');
assert.equal(ean.upcA,'759606017720');
assert.equal(ean.primary,'0759606017720');
assert.equal(ean.isValidLikely,true);

const upc=barcode.normalizeBarcode('759606017720');
assert.equal(upc.upcA,'759606017720');
assert.ok(upc.candidates.includes('0759606017720'));

const comic=barcode.normalizeBarcode('0 759606 017720 00111');
assert.equal(comic.primary,'0759606017720');
assert.equal(comic.supplement,'00111');

assert.equal(barcode.normalizeBarcode('12-345').isValidLikely,false);
assert.match(worker,/url\.pathname === '\/barcode\/lookup'/);
assert.match(worker,/pcFetch\('\/api\/product', \{ upc:code \}\)/);
assert.match(worker,/pcFetch\('\/api\/products', \{ q:fallbackQuery \}\)/);
assert.match(worker,/needsCoverConfirmation:isComic/);
assert.match(dashboard,/id="research-barcode-btn"/);
assert.match(dashboard,/BarcodeDetector/);
assert.match(dashboard,/arsca_barcode_links_v1/);
assert.match(dashboard,/2026\.07\.01\.06-comic-issue-hub/);
assert.doesNotMatch(dashboard,/PRICECHARTING_TOKEN\s*=|PRICECHARTING_API_KEY\s*=/);

console.log('Barcode lookup contract checks passed');
