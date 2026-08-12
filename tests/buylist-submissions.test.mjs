import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');
const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');
const buylistPage = fs.readFileSync('buylist.html', 'utf8');
const migration = fs.readFileSync('supabase-migrations/2026-08-16-buylist-submissions.sql', 'utf8');

// ── Migration ────────────────────────────────────────────────────────
assert.match(migration, /create table if not exists public\.buylist_submissions/, 'missing buylist_submissions table');
assert.match(migration, /buylist_submissions_select_member/, 'missing select RLS policy');
assert.match(migration, /buylist_submissions_update_employee/, 'missing update RLS policy');
assert.match(migration, /alter table public\.buylist_submissions enable row level security/, 'RLS must be enabled');
assert.doesNotMatch(migration, /buylist_submissions_insert/, 'must not grant a public/authenticated insert policy -- inserts go through the Worker service role only, from an unauthenticated public page');

console.log('Buylist migration checks passed');

// ── Worker: public routes ───────────────────────────────────────────
assert.match(worker, /if \(url\.pathname === '\/public\/buylist\/info' && request\.method === 'GET'\) \{/, 'missing GET /public/buylist/info');
assert.match(worker, /if \(url\.pathname === '\/public\/buylist\/submit' && request\.method === 'POST'\) \{/, 'missing POST /public/buylist/submit');
// Independently toggleable from the storefront catalog -- its own opt-in flag.
assert.match(worker, /if \(cfg\.buylistEnabled !== true\) return json\(\{ ok:false, error:'This store is not accepting buylist submissions' \}, 404\);/, 'buylist info route must gate on its own buylistEnabled flag, not storefrontEnabled');
assert.match(worker, /if \(settings\?\.\[0\]\?\.receipt_settings\?\.buylistEnabled !== true\) return json\(\{ ok:false, error:'This store is not accepting buylist submissions' \}, 404\);/, 'submit route must also gate on buylistEnabled (a disabled toggle must reject writes too, not just hide the read side)');
// Rate limiting -- this is an unauthenticated public write endpoint.
assert.match(worker, /const rateError = await enforceUsageLimit\(env, `buylist-submit:\$\{storeId\}:\$\{ip\}`, 5, 3600\);/, 'submissions must be rate-limited per store+IP to prevent spam');
// Validation: name required, contact method required, at least one item required.
assert.match(worker, /if \(!contactName\) return json\(\{ ok:false, error:'Your name is required' \}, 400\);/, 'must require a contact name');
assert.match(worker, /if \(!contactEmail && !contactPhone\) return json\(\{ ok:false, error:'An email or phone number is required so the store can reach you' \}, 400\);/, 'must require at least one contact method');
assert.match(worker, /if \(!items\.length\) return json\(\{ ok:false, error:'Add at least one item you want to sell' \}, 400\);/, 'must require at least one item');
assert.match(worker, /const requestedItems = Array\.isArray\(body\.items\) \? body\.items\.slice\(0, 50\) : \[\];/, 'item count must be capped to prevent abuse');

console.log('Buylist public route checks passed');

// ── Worker: staff routes are authenticated, not public ─────────────
assert.match(worker, /if \(url\.pathname === '\/buylist\/submissions'\) \{/, 'missing staff GET /buylist/submissions');
assert.match(worker, /if \(url\.pathname === '\/buylist\/submissions\/status'\) \{/, 'missing staff POST /buylist/submissions/status');
assert.match(worker, /if \(url\.pathname === '\/buylist\/submissions'\) \{\s*\n\s*if \(request\.method !== 'GET'\) return json\(\{ error: 'GET only' \}, 405\);\s*\n\s*const storeId = requestStoreId\(request, url\);\s*\n\s*const auth = await requireStoreUser\(request, env, storeId, \['owner','admin','manager','employee'\]\);/, 'listing submissions must require an authenticated store user');
assert.match(worker, /if \(url\.pathname === '\/buylist\/submissions\/status'\) \{\s*\n\s*if \(request\.method !== 'POST'\) return json\(\{ error: 'POST only' \}, 405\);\s*\n\s*const storeId = requestStoreId\(request, url\);\s*\n\s*const auth = await requireStoreUser\(request, env, storeId, \['owner','admin','manager','employee'\]\);/, 'updating submission status must require an authenticated store user');
assert.match(worker, /const status = \['new','contacted','closed'\]\.includes\(body\.status\) \? body\.status : null;/, 'status updates must be restricted to a known allowlist');

console.log('Buylist staff route checks passed');

// ── Dashboard: settings + staff panel wiring ─────────────────────────
assert.match(dashboard, /id="vp-buylistEnabled" type="checkbox"/, 'missing the buylist-enabled settings checkbox');
assert.match(dashboard, /function saveBuylistSettings\(\)\{/, 'missing saveBuylistSettings');
const buylistWhitelistCount = (dashboard.match(/buylistEnabled:next\.buylistEnabled === true,\s*\n\s*buylistMessage:next\.buylistMessage \|\| '',/g) || []).length;
assert.equal(buylistWhitelistCount, 2, 'buylistEnabled/buylistMessage must be carried in both receipt_settings whitelists (saveVendorProfile and savePaymentSettings), or one write will erase the other');

for (const fn of ['ensureBuylistSubmissionsPanel', 'loadBuylistSubmissions', 'renderBuylistSubmissionsPanel', 'setBuylistSubmissionStatus']) {
  assert.match(dashboard, new RegExp(`function ${fn}\\(`), `missing ${fn}`);
}
assert.match(dashboard, /if\(name === 'intake'\) setTimeout\(\(\)=>\{ fetchBuyListFromWorker\(\); fetchBuyTrayIndex\(\); ensureBuylistSubmissionsPanel\(\); \}, 0\);/, 'switching to the Buy/Intake tab must render the buylist submissions panel');

console.log('Buylist dashboard wiring checks passed');

// ── Public page (buylist.html) ────────────────────────────────────────
assert.match(buylistPage, /<input id="contact-name"/, 'missing contact name field');
assert.match(buylistPage, /function addBuylistItemRow\(\)\{/, 'missing addBuylistItemRow');
assert.match(buylistPage, /async function submitBuylist\(\)\{/, 'missing submitBuylist');
assert.match(buylistPage, /fetch\(`\$\{WORKER\}\/public\/buylist\/submit`/, 'must post to /public/buylist/submit');
assert.match(buylistPage, /fetch\(`\$\{WORKER\}\/public\/buylist\/info\?store_id=/, 'must fetch store info from /public/buylist/info');

console.log('Buylist public page contract checks passed');

// ── Functional check: collectBuylistItems (client-side item collection) ──
{
  const src = buylistPage.match(/function collectBuylistItems\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(src, 'could not extract collectBuylistItems for functional testing');

  class FakeInput { constructor(value = '') { this.value = value; } }
  function makeRow(desc, category, condition, value) {
    const fields = {
      '.bl-desc': new FakeInput(desc),
      '.bl-category': new FakeInput(category),
      '.bl-condition': new FakeInput(condition),
      '.bl-value': new FakeInput(value),
    };
    return { querySelector: (sel) => fields[sel] };
  }
  const rows = [
    makeRow('Charizard VMAX', 'Pokemon TCG', 'Near mint', '150'),
    makeRow('', 'Sports Card', '', ''), // blank description must be dropped
  ];
  const document = { querySelectorAll: (sel) => (sel === '.item-row' ? rows : []) };

  const { collectBuylistItems } = new Function('document', `${src}\nreturn { collectBuylistItems };`)(document);
  const items = collectBuylistItems();
  assert.equal(items.length, 1, 'a row with no description must be dropped, not submitted as a blank item');
  assert.equal(items[0].description, 'Charizard VMAX');
  assert.equal(items[0].estimatedValue, 150);
}

console.log('collectBuylistItems functional checks passed');
