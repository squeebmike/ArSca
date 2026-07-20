import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const browser = fs.readFileSync('scripts/mtg/mtg-offline-browser.js', 'utf8');
const workflow = fs.readFileSync('.github/workflows/mtg-offline-daily.yml', 'utf8');
const wrangler = JSON.parse(fs.readFileSync('wrangler.deploy.jsonc', 'utf8'));

assert.match(worker, /\/catalog\/mtg\/manifest/);
assert.match(worker, /\/catalog\/mtg\/download/);
assert.match(worker, /MTG_CATALOG_R2/);
assert.ok(wrangler.r2_buckets?.some(binding => binding.binding === 'MTG_CATALOG_R2'));

for(const store of ['mtg_cards','mtg_market_prices','mtg_sets','mtg_prices','mtg_price_links','mtg_search_tokens','mtg_price_search_tokens','mtg_meta','mtg_images']) {
  assert.match(browser, new RegExp(store));
}
assert.match(browser, /activeManifestVersion===manifest\.version/);
assert.match(browser, /checksum mismatch/);
assert.match(browser, /mtg-image:\$\{scryfallId\}:\$\{faceIndex\}:\$\{size\}:\$\{hash\}/);
assert.match(browser, /replace\(\/\\bmtg\\b\/ig/);
assert.match(browser, /normalize,queryParts,DB_NAME/);
const browserSandbox = {};
browserSandbox.globalThis = browserSandbox;
vm.runInNewContext(browser, browserSandbox);
assert.equal(browserSandbox.ArsCaMtgOffline.queryParts('mtg Black Lotus').tokens.join('|'), 'black|lotus');
assert.equal(browserSandbox.ArsCaMtgOffline.queryParts('Magic: The Gathering Sol Ring').tokens.join('|'), 'sol|ring');
assert.equal(browserSandbox.ArsCaMtgOffline.queryParts('https://www.tcgplayer.com/product/592073/example').tcgplayerId, '592073');

assert.match(dashboard, /Offline first, online backup/);
assert.match(dashboard, /PriceCharting offline snapshot/);
assert.match(dashboard, /Scryfall offline catalog/);
assert.match(dashboard, /let _mtgBulkSyncActive = false/);
assert.match(dashboard, /finally \{\s*_mtgBulkSyncActive = false/);
assert.match(dashboard, /CACHE SET IMAGES/);
assert.match(dashboard, /<meta name="version" content="2026\./);
assert.match(dashboard, /Scryfall market \(offline catalog\)/);
assert.match(dashboard, /!hasScryfallPrice && Number\(link\?\.confidence/);
assert.match(dashboard, /Remote R2 bundle:/);
assert.match(dashboard, /remoteSourceVersions/);
assert.match(dashboard, /updateAvailable/);
assert.match(dashboard, /IMPORT LATEST MTG DATA/);
assert.match(dashboard, /mtg\.meta\?\.updateAvailable \|\| mtgAge > MS_24H/);
assert.match(dashboard, /mtgsbNormalizeCardRecord/);
assert.match(dashboard, /mtgsbToggleMobileFilters/);
assert.match(browser, /const DB_VERSION = 4/);
assert.match(browser, /Downloading compact market prices/);
assert.match(browser, /marketPricesVersion/);
assert.match(browser, /searchIndexReady/);
assert.match(browser, /searchPrices/);
assert.match(browser, /findExact/);
assert.match(browser, /sourceVersions:manifest\.sourceVersions\|\|\{\}/);
assert.match(browser, /sourceVersions:active\?\.sourceVersions\|\|\{\}/);
assert.match(browser, /catalogSet/);
assert.match(browser, /cardTx=db\.transaction\('mtg_cards','readonly'\)/,'indexed MTG candidates should share one read transaction');
assert.match(browser, /linkTx=db\.transaction\('mtg_price_links','readonly'\)/,'MTG price links should be read in one transaction');
assert.match(dashboard, /result\.skipped \? progress\.skipped\+\+/);
assert.match(dashboard, /const branchName = 'main'/);
assert.doesNotMatch(dashboard, /fetch\(['"]https:\/\/api\.scryfall\.com\/bulk-data/);

assert.match(workflow, /schedule:/);
assert.match(workflow, /PRICECHARTING_MTG_CSV_URL/);
assert.match(workflow, /r2 object put[^\n]+--remote/);
assert.match(workflow, /market-prices-scryfall\.jsonl\.gz/);
assert.match(workflow, /Verify production manifest/);
assert.ok(workflow.indexOf('build-report.json') < workflow.indexOf('Publish manifest last'));

console.log('MTG offline integration contract tests passed');
