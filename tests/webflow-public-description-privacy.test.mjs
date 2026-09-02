import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const start = dashboard.indexOf('function publicInventoryDescription(');
const end = dashboard.indexOf('\nasync function createWebflowProduct(', start);
assert.ok(start >= 0 && end > start, 'public Webflow description helper must exist');

const helper = dashboard.slice(start, end);
for (const privateField of ['key_notes', 'notes', 'cost', 'buy_session', 'customer']) {
  assert.equal(helper.includes(privateField), false, `${privateField} must not enter the public Webflow description`);
}

assert.doesNotMatch(dashboard, /'card-description':\s*desc\s*\|\|\s*updates\.key_notes/, 'card description must never fall back to private notes');
assert.doesNotMatch(dashboard, /'cost-basis'\s*:/, 'inventory sync must not write private cost basis to Webflow');
assert.match(dashboard, /'card-description':\s*publicInventoryDescription\(i,u\)/, 'Webflow updates must use the public description helper');

console.log('webflow public description privacy tests passed');
