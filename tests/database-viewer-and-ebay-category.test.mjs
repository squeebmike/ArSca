import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const fnSource = name => { const s = worker.indexOf(`function ${name}(`); assert.notEqual(s, -1, `missing ${name}`); return worker.slice(s, worker.indexOf('\n}\n', s) + 2); };

// --- Database viewer: fixed allowlist, store-scoped, owner/admin ---------------
const route = worker.slice(worker.indexOf("url.pathname === '/store/db/table'"), worker.indexOf("url.pathname === '/store/customers'"));
assert.match(route, /requireStoreUser\(request, env, storeId, \['owner','admin'\]\)/);
assert.match(route, /const spec = DATABASE_VIEWER_TABLES\[url\.searchParams\.get\('table'\) \|\| ''\];\s*\n\s*if \(!spec\) return json\(\{ ok: false, error: 'Unknown table' \}, 400\);/, 'unknown table names must be rejected, never passed through');
assert.match(route, /\$\{spec\.table\}\?store_id=eq\.\$\{encodeURIComponent\(storeId\)\}&select=\$\{spec\.select\}/, 'every query is scoped to the caller\'s store and uses the fixed select');
assert.match(route, /Math\.min\(200,/, 'page size is capped');
const tablesSrc = worker.slice(worker.indexOf('const DATABASE_VIEWER_GROUPS'), worker.indexOf('// Presale items built from FOC data'));
const TABLES = new Function(`${tablesSrc}; return DATABASE_VIEWER_TABLES;`)();
assert.ok(Object.keys(TABLES).length >= 60, 'the viewer should cover (nearly) every store-scoped table');
for (const secret of ['store_stripe_accounts', 'phone_verifications', 'store_invites', 'phone_settings', 'phone_endpoints', 'scanner_workstations', 'store_settings']) {
  assert.equal(TABLES[secret], undefined, `${secret} holds secrets and must never be browsable`);
}
assert.equal(TABLES.loyalty_ledger.select, '*,customer:customers(name,phone,email)');
const viewer = fs.readFileSync('scripts/database-viewer.js', 'utf8');
assert.match(viewer, /api\('\/store\/db\/tables\?'/, 'the table picker must come from the server allowlist, not a copied list');
assert.match(viewer, /PTS \('\+money\(c\.loyaltyPoints\)/, 'customer cards show their points balance');
console.log('Database viewer checks passed');

// --- eBay sales not linked to inventory get a real category -------------------
const guess = new Function(`${fnSource('guessSaleCategoryFromTitle')}; return guessSaleCategoryFromTitle;`)();
assert.equal(guess('Care Bears Good Luck Bear Plush with Bonus DVD Green Shamrock Bear NEW IN BOX'), 'Collectibles');
assert.equal(guess('Sonic the Hedgehog x Godzilla #3 Variant RI (15) (Haines) - PRESALE'), 'Comic');
assert.equal(guess('2023 Bowman Lazaro Montes #BPA-LM Auto'), 'Sports', 'sports titles carry "#" too -- must not become Comic');
assert.equal(guess('Secret Lair Drop Brain Dead'), 'Magic: The Gathering');
assert.equal(guess('Random thing'), '');
assert.match(worker, /title: itemName, category: d\.category \|\| guessSaleCategoryFromTitle\(itemName\)/, 'eBay order sync must fall back to the title guess');
console.log('eBay sale category checks passed');

// --- FOC presale items carry the FOC synopsis for the shop popup --------------
const detail = new Function(`${fnSource('focPresaleComicDetail')}; return focPresaleComicDetail;`)();
const d = detail({ description:'A synopsis.', cover_artist:'Sean Dove', publisher:'Oni', upc:'1', on_sale_date:'2026-10-01' }, { writer:'Jeremy Melloul & Adam Seats', series_name:'Adventure Time', issue_number:'1' });
assert.equal(d.description, 'A synopsis.');
assert.deepEqual(d.writers, ['Jeremy Melloul', 'Adam Seats']);
assert.deepEqual(d.coverArtists, ['Sean Dove']);
assert.equal(detail({}, {}), undefined, 'nothing to show -> no field at all');
assert.match(fnSource('storefrontComicDetailFor'), /const m = d\.comicMetadata \|\| d\.focComicDetail;/);
assert.equal((worker.match(/focComicDetail: focPresaleComicDetail\(/g) || []).length, 2, 'both presale creation paths must store it');
console.log('FOC presale synopsis checks passed');
