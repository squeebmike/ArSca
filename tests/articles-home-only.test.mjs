// Sean's articles are The Mana Pocket's own (2026-11-12: "articles tab shouldn't be available for other stores").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../scripts/dashboard-app.js', import.meta.url), 'utf8');
assert.match(app, /tab === 'articles' && getActiveStoreId\(\) !== HOME_STORE_ID\) return false/);
console.log('articles tab: home store only passed');
