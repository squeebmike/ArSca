import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');

assert.match(
  source,
  /async fetch\(request, env, ctx\)/,
  'The module Worker fetch handler must accept Cloudflare ExecutionContext.',
);

const mobileStart = source.indexOf("if (url.pathname === '/card-lens/mobile/identify')");
const mobileEnd = source.indexOf("if (url.pathname === '/cardsight/identify')", mobileStart);
assert.ok(mobileStart >= 0 && mobileEnd > mobileStart, 'Card Lens mobile routes must exist.');

const mobileRoutes = source.slice(mobileStart, mobileEnd);
assert.doesNotMatch(
  mobileRoutes,
  /ctx\.waitUntil/,
  'Mobile cache writes must not make successful card results depend on ctx.',
);

console.log('Card Lens Worker context regression checks passed.');
