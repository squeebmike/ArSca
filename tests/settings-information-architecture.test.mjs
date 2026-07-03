import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync('dashboard.html','utf8');
const requiredSections = ['overview','profile','payments','sync','catalogs','inventory','users','devices','theme','subscription','advanced'];
for (const section of requiredSections) assert.ok(html.includes(`id:'${section}'`), `missing Settings section ${section}`);
for (const fn of ['ensureSettingsShell','selectSettingsSection','searchSettings','renderSettingsOverview','openSettingsSection']) assert.ok(html.includes(`function ${fn}`), `missing ${fn}`);
for (const panel of ['vendor-profile-panel','payment-settings-panel','inventory-sync-panel','sync-queue-panel','offline-cache-panel','offline-catalog-manager-panel','pricecharting-data-panel','spreadsheet-panel','store-members-panel','branding-theme-panel','subscription-panel','legacy-tools-panel']) assert.ok(html.includes(panel), `existing panel lost: ${panel}`);
assert.ok(html.includes('@media(max-width:760px)'), 'mobile Settings breakpoint missing');
assert.ok(html.includes('settings-mobile-select'), 'mobile section selector missing');
assert.ok(html.includes('settings_active_section_v1'), 'section state persistence missing');
assert.ok(html.includes('MTG offline protected'), 'MTG protection status missing');
assert.ok(html.includes('PPT offline planned'), 'Pokémon planned-next label missing');
assert.ok(!html.includes('function rebuildStripe'), 'Settings pass must not rebuild Stripe');
console.log('Settings information architecture contract checks passed');

