import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Store, 2026-10-27: "Re organize all the settings to make it make more
// sense. And have the search work better for finding settings."
const ui = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const cut = (from, to) => { const a = ui.indexOf(from), b = ui.indexOf(to, a); assert.ok(a >= 0 && b > a, 'missing ' + from); return ui.slice(a, b); };
const ctx = { storeFeatureEnabled: f => ctx.features[f] !== false, features: {} };
vm.createContext(ctx);
vm.runInContext([cut('const SETTINGS_GROUPS = [', '\n// A running record'), cut('function settingsSectionVisible(', '\nfunction refreshSettingsSectionVisibility('),
  cut('const SETTINGS_SEARCH_SYNONYMS', '\nfunction settingsOwnText(')].join('\n')
  + '\n;this.S={SETTINGS_GROUPS,SETTINGS_SECTIONS,SETTINGS_PANEL_MAP,SETTINGS_SECTION_ALIASES,SETTINGS_BLOCK_TITLES,resolveSettingsSectionId,settingsSearchWords,settingsWordMatches,SETTINGS_SEARCH_SYNONYMS};', ctx);
const S = ctx.S;

// ── Structure ──
const groups = new Set(S.SETTINGS_GROUPS.map(g => g.id));
const sections = new Set(S.SETTINGS_SECTIONS.map(s => s.id));
for (const s of S.SETTINGS_SECTIONS) assert.ok(groups.has(s.group), s.id + ' is in a sidebar group');
for (const key of Object.keys(S.SETTINGS_PANEL_MAP)) assert.ok(sections.has(key), 'panel map section ' + key + ' exists');
const placed = Object.values(S.SETTINGS_PANEL_MAP).flat();
assert.equal(placed.length, new Set(placed).size, 'every panel has one home');
// Every Settings panel the dashboard builds has a home (none left loose below Settings).
const built = [...ui.matchAll(/function (ensure\w+Panel)\(backoffice\)\{\s*\n\s*if\(document\.getElementById\('([\w-]+)'\)\) return;/g)]
  .filter(m => ui.includes('  ' + m[1] + '(backoffice);')).map(m => m[2]);
assert.ok(built.length >= 10, 'found the panels the dashboard builds');
for (const id of built) assert.ok(placed.includes(id), id + ' has a Settings section');
// Every block the profile and vendor config renders is placed.
const blocks = new Set([...ui.matchAll(/data-settings-block="([\w-]+)"/g)].map(m => m[1]));
for (const name of blocks) assert.ok(placed.includes('settings-block-' + name), 'block ' + name + ' has a Settings section');
assert.ok(ui.includes('distributeSettingsBlocks(body);\n  loadEbayRepriceStatus();'), 'the store profile hands its blocks out after each render');
assert.ok(/distributeSettingsBlocks\(body\);\n\}\n\nfunction setInventorySource/.test(ui), 'so does the vendor config');
// Where things live now.
const home = id => Object.keys(S.SETTINGS_PANEL_MAP).find(k => S.SETTINGS_PANEL_MAP[k].includes(id));
assert.equal(home('settings-block-checkout'), 'payments', 'tax, receipt and payment handles sit with checkout');
assert.equal(home('settings-block-pricing-rules'), 'buying', 'price rules and the floor sit with buying & pricing');
assert.equal(home('customer-panel'), 'customers', 'the customer list is not under Advanced');
assert.equal(home('webflow-integration-panel'), 'website', 'Webflow is a website setting, not Data Sync');
assert.equal(home('pricing-apis-panel'), 'catalogs', 'pricing API keys and credit use are reachable');
assert.equal(home('customer-reviews-panel'), 'website', 'reviews no longer sit loose below Settings');
assert.ok(ui.includes('  ensurePricingApisPanel(backoffice);\n'), 'and the panel is built');

// ── Old names and per-store hiding ──
ctx.features = {};
assert.equal(S.resolveSettingsSectionId('devices'), 'device');
assert.equal(S.resolveSettingsSectionId('store'), 'profile');
assert.equal(S.resolveSettingsSectionId('nonsense'), 'overview');
assert.equal(S.resolveSettingsSectionId('ebay'), 'ebay');
ctx.features = { ebay:false, website:false, sms:false };
assert.equal(S.resolveSettingsSectionId('ebay'), 'overview', 'a store without eBay never lands on eBay settings');
assert.equal(S.resolveSettingsSectionId('website'), 'overview');
assert.equal(S.resolveSettingsSectionId('phone'), 'overview');
assert.equal((ui.match(/^function openSettingsSection\(/gm) || []).length, 1, 'one openSettingsSection (a second one used to override it and never open the section)');
assert.ok(ui.includes("const home = target?.closest?.('.settings-section')?.dataset.settingsSection;"), 'it opens wherever the target panel lives now');

// ── Search ──
const words = S.settingsSearchWords('VENMO HANDLE · Tax % (Pokémon)');
assert.equal(JSON.stringify(words), JSON.stringify(['venmo', 'handle', 'tax', '%', 'pokemon']));
assert.ok(S.settingsWordMatches(['shipping', 'origin'], 'ship'), 'a word start matches');
assert.ok(S.settingsWordMatches(['category', 'price', 'rules'], 'rule'), 'singular finds plural');
assert.ok(!S.settingsWordMatches(['tax'], 'taxonomy'));
for (const [word, finds] of [['password', 'members'], ['staff', 'members'], ['markup', 'rules'], ['twilio', 'forwarding'], ['keys', 'api'], ['points', 'loyalty']])
  assert.ok(S.SETTINGS_SEARCH_SYNONYMS[word].includes(finds), word + ' -> ' + finds);
const index = cut('function buildSettingsSearchIndex(', '\nfunction searchSettings(');
assert.ok(index.includes(".ph,[style*=\"Orbitron\"],label,button,summary,th"), 'the index covers panel titles, field labels, buttons and table headers');
assert.ok(index.includes('SETTINGS_SECTIONS.filter(settingsSectionVisible)'), 'hidden sections are not searched');
assert.ok(ui.includes(`onkeydown="if(event.key==='Enter'){event.preventDefault();openSettingsSearchHit(0);}"`), 'Enter opens the top result');
console.log('settings reorganized checks passed');
