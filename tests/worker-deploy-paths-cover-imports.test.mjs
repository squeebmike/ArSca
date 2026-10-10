import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Store report: the Orders board fix shipped but the board still showed the
// old error -- the fix only touched scripts/orders-board.mjs, which wasn't in
// the Worker deploy's path list, so merging it never redeployed the Worker.
// Every file the Worker loads, directly or through another module, has to be
// on that list.
const workflow = fs.readFileSync('.github/workflows/deploy-worker.yml', 'utf8');
const paths = new Set([...workflow.matchAll(/^\s+- (\S+)$/gm)].map(m => m[1]));
const seen = new Set();
const walk = file => {
  if (seen.has(file)) return;
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^\s*import\s[^;]*?from\s+'(\.{1,2}\/[^']+)'/gm)) {
    walk(path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
  }
};
walk('cloudflare-worker-full.js');
const missing = [...seen].filter(f => !paths.has(f));
assert.deepEqual(missing, [], 'every module the Worker loads redeploys it when changed: missing ' + missing.join(', '));
assert.ok(seen.has('scripts/orders-board.mjs') && seen.size > 20, 'the import walk found the Worker\'s modules');
console.log('Worker deploy paths cover all ' + seen.size + ' Worker modules');
