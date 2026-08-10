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

assert.match(source, /\/card-lens\/mobile\/access\/redeem/, 'S-rank redemption route must exist.');
assert.match(source, /CARD_LENS_S_RANK_CODE/, 'S-rank code must come from a Worker secret.');
assert.match(source, /card-lens:session:/, 'Mobile sessions must be stored server-side.');
assert.match(source, /crypto\.getRandomValues/, 'Mobile bearer tokens must use cryptographic randomness.');
assert.match(source, /\/card-lens\/mobile\/billing\/google-play\/verify/, 'Google Play verification route must exist.');
assert.match(source, /purchases\/subscriptionsv2\/tokens/, 'Subscriptions must be verified against the Google Play Developer API.');
assert.match(source, /GOOGLE_PLAY_PRIVATE_KEY/, 'Google Play signing credentials must come from Worker secrets.');
assert.doesNotMatch(source, /purchaseToken\s*[,}]\s*\)/, 'Raw purchase tokens must not be stored in KV records.');
const accessStart = source.indexOf("if (url.pathname === '/card-lens/mobile/access/redeem')");
assert.ok(accessStart >= 0 && accessStart < mobileStart, 'S-rank access routes must be declared before protected mobile routes.');
assert.doesNotMatch(
  source.slice(accessStart, mobileStart),
  /const\s+\w*code\w*\s*=\s*['"][^'"]+['"]/i,
  'The S-rank redemption code must never be hardcoded.',
);

console.log('Card Lens Worker context regression checks passed.');
