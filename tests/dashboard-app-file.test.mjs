import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inlinedDashboard } from './helpers/dashboard-source-hook.mjs';

// The app code is its own file so browsers keep a compiled copy between
// visits. Under npm test, reading dashboard.html goes through the preload
// (app inlined); the real file on disk is read with `cat` below.
const tagRe = /<script src="scripts\/dashboard-app\.js\?v=([^"]+)"><\/script>/;

const { readFileSync } = await import('node:fs');
const page = readFileSync('dashboard.html', 'utf8'); // inlined by the preload when run under npm test
const app = readFileSync('scripts/dashboard-app.js', 'utf8');
const version = (app.match(/const APP_VERSION = '([^']+)'/) || [])[1];
assert.ok(version, 'APP_VERSION lives in scripts/dashboard-app.js');
assert.ok(app.length > 1_000_000, 'the app code is in its own file');

// Under the preload the page reads back with the app inline (old shape).
assert.ok(page.includes("const APP_VERSION = '" + version + "'"), 'tests see the app code through dashboard.html');

// The real file on disk: one tag, versioned with APP_VERSION (cache-bust), sync (no defer/async).
const real = (await import('node:child_process')).execFileSync('cat', ['dashboard.html'], { encoding:'utf8', maxBuffer:64 * 1024 * 1024 });
const m = real.match(tagRe);
assert.ok(m, 'dashboard.html loads scripts/dashboard-app.js');
assert.equal(m[1], version, 'the ?v= on the app tag must match APP_VERSION, or phones keep a stale copy');
assert.equal((real.match(/scripts\/dashboard-app\.js/g) || []).length, 1);
assert.ok(real.length < 600_000, 'the page itself stays small');
assert.equal(inlinedDashboard(real, app), page, 'inlining the file back gives exactly what tests read');
console.log('Dashboard app file checks passed');
