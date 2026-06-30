import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const browser = fs.readFileSync('scripts/mtg/mtg-offline-browser.js', 'utf8');
const workflow = fs.readFileSync('.github/workflows/mtg-offline-daily.yml', 'utf8');
const wrangler = JSON.parse(fs.readFileSync('wrangler.deploy.jsonc', 'utf8'));

assert.match(worker, /\/catalog\/mtg\/manifest/);
assert.match(worker, /\/catalog\/mtg\/download/);
assert.match(worker, /MTG_CATALOG_R2/);
assert.ok(wrangler.r2_buckets?.some(binding => binding.binding === 'MTG_CATALOG_R2'));

for(const store of ['mtg_cards','mtg_sets','mtg_prices','mtg_price_links','mtg_meta','mtg_images']) {
  assert.match(browser, new RegExp(store));
}
assert.match(browser, /active\?\.catalogVersion===manifest\.version/);
assert.match(browser, /checksum mismatch/);
assert.match(browser, /mtg-image:\$\{scryfallId\}:\$\{faceIndex\}:\$\{size\}:\$\{hash\}/);

assert.match(dashboard, /Offline first, online backup/);
assert.match(dashboard, /PriceCharting offline snapshot/);
assert.match(dashboard, /Scryfall offline catalog/);
assert.match(dashboard, /2026\.06\.30\.01-mtg-offline-r2/);
assert.match(dashboard, /const branchName = 'main'/);
assert.doesNotMatch(dashboard, /fetch\(['"]https:\/\/api\.scryfall\.com\/bulk-data/);

assert.match(workflow, /schedule:/);
assert.match(workflow, /PRICECHARTING_MTG_CSV_URL/);
assert.ok(workflow.indexOf('build-report.json') < workflow.indexOf('Publish manifest last'));

console.log('MTG offline integration contract tests passed');
