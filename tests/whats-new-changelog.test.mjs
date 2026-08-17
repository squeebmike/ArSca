import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: a dedicated, discoverable settings section exists ──
assert.match(dashboard, /\{id:'whatsnew',label:"What's New",subtitle:'Every feature in ArSca, grouped by area/, 'SETTINGS_SECTIONS must include a What\'s New section so it shows up in the sidebar and the settings search');

// ── Contract: the FEATURE_LOG data structure exists and is well-formed ──
assert.match(dashboard, /const FEATURE_LOG = \[/, 'FEATURE_LOG data must exist');
assert.match(dashboard, /\{ title:'Scan To Cart', status:'new',/, 'the just-shipped Scan To Cart feature must be documented, per the user\'s explicit example');
assert.match(dashboard, /\{ title:'One consolidated Reports screen', status:'planned',/, 'the known not-yet-built reporting consolidation must be explicitly flagged as planned, not omitted or claimed as done');
assert.match(dashboard, /\{ title:'Multi-quantity sell \+ fixed discount math', status:'new',/, 'this session\'s cart quantity/discount fixes must be documented');
assert.match(dashboard, /\{ title:'Print shelf\/price labels', status:'new',/, 'the roll/thermal label printing update must be documented');

// ── Contract: rendering is wired up (search box, list container, generated-panel insertion) ──
assert.match(dashboard, /const whatsnew=document\.getElementById\('settings-panels-whatsnew'\);if\(whatsnew&&!document\.getElementById\('feature-log-search'\)\)whatsnew\.innerHTML=`<input id="feature-log-search"/, 'renderSettingsGeneratedPanels must inject the search box and list container into the whatsnew section exactly once');
assert.match(dashboard, /function renderWhatsNewPanel\(\)\{/, 'renderWhatsNewPanel must exist');
assert.match(dashboard, /oninput="renderWhatsNewPanel\(\)"/, 'typing in the search box must re-render the filtered list');

console.log('Whats New changelog contract checks passed');

// ── Functional: extract the real FEATURE_LOG and verify data integrity + search filtering ──
const dataSrc = dashboard.match(/const FEATURE_LOG = \[[\s\S]*?\n\];/)[0];
const { FEATURE_LOG } = new Function(`${dataSrc}\nreturn { FEATURE_LOG };`)();

assert.ok(Array.isArray(FEATURE_LOG) && FEATURE_LOG.length >= 15, 'FEATURE_LOG must cover a broad number of feature areas, not just a token handful');
const VALID_STATUSES = new Set(['new', 'working', 'planned']);
let totalItems = 0;
for(const group of FEATURE_LOG){
  assert.ok(group.area && typeof group.area === 'string', 'every group must have an area name');
  assert.ok(Array.isArray(group.items) && group.items.length > 0, `group "${group.area}" must have at least one item`);
  for(const item of group.items){
    assert.ok(item.title && typeof item.title === 'string', `every item in "${group.area}" must have a title`);
    assert.ok(VALID_STATUSES.has(item.status), `item "${item.title}" has an invalid status "${item.status}"`);
    assert.ok(item.desc && item.desc.length >= 15, `item "${item.title}" must have a real, non-trivial description`);
    totalItems++;
  }
}
assert.ok(totalItems >= 50, `FEATURE_LOG should document a substantial share of the app's real feature history (got ${totalItems} items)`);

// Reimplement the search-filter logic and verify it matches on title, description, or area.
function filterFeatureLog(query){
  const q = query.trim().toLowerCase();
  return FEATURE_LOG.map(g => ({
    area: g.area,
    items: g.items.filter(i => !q || (i.title + ' ' + i.desc + ' ' + g.area).toLowerCase().includes(q)),
  })).filter(g => g.items.length);
}
const scanResults = filterFeatureLog('scan to cart');
assert.ok(scanResults.some(g => g.items.some(i => i.title === 'Scan To Cart')), 'searching "scan to cart" must find the Scan To Cart entry');
const noResults = filterFeatureLog('nonexistent feature xyz123');
assert.equal(noResults.length, 0, 'a query matching nothing must return no groups, so the UI can show an empty state instead of a blank page');
const emptyQuery = filterFeatureLog('');
assert.deepEqual(emptyQuery.map(g => g.area), FEATURE_LOG.map(g => g.area), 'an empty search must show every group unfiltered');

console.log('Whats New changelog functional checks passed');
