import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: both panels are collapsed-by-default <details>, not always-expanded grids ──
assert.match(dashboard, /el\.innerHTML = `<details class="inv-health-details" \$\{wasOpen \? 'open' : ''\}>\s*\n\s*<summary>INVENTORY HEALTH <span class="inv-health-details-hint">\$\{flagged\} flagged<\/span><\/summary>/, 'renderInventoryHealthPanel must wrap its cards in a collapsed-by-default <details> so mobile users are not forced to scroll past 9 full-width cards before reaching the inventory list');
assert.match(dashboard, /el\.innerHTML = `<details class="inv-health-details" \$\{wasOpen \? 'open' : ''\}>\s*\n\s*<summary>INVENTORY AGING <span class="inv-health-details-hint">\$\{aged\} item\$\{aged===1\?'':'s'\} 91\+ days<\/span><\/summary>/, 'renderInventoryAgingPanel must wrap its cards in a collapsed-by-default <details> too');

// ── Contract: open/closed state survives re-render (filterTable runs on every keystroke) ──
const wasOpenOccurrences = dashboard.match(/const wasOpen = el\.querySelector\('details'\)\?\.open;/g) || [];
assert.ok(wasOpenOccurrences.length >= 2, 'both panels must preserve their open/closed state across re-renders, or expanding one would immediately collapse itself again on the next keystroke in the search box');

// ── Contract: CSS exists to style the disclosure widget (native marker hidden, matches app convention) ──
assert.match(dashboard, /\.inv-health-details summary::-webkit-details-marker \{ display:none; \}/, 'the details/summary CSS must hide the native marker, matching the existing .research-secondary-actions convention elsewhere in the app');

console.log('Inventory health/aging collapsible-panel contract checks passed');
