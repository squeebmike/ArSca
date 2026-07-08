import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../cloudflare-worker-full.js', import.meta.url), 'utf8');

for (const code of ['research','register','store','pro']) {
  assert.match(dashboard, new RegExp(`${code}:\\s*\\{`), `dashboard plan ${code}`);
  assert.match(worker, new RegExp(`${code}: \\{`), `worker plan ${code}`);
}
assert.match(worker, /metadata\[plan_code\]/, 'Stripe Checkout records selected plan');
assert.match(worker, /Legacy active\/trial subscriptions are grandfathered to Store/, 'legacy subscriptions are grandfathered');
assert.doesNotMatch(dashboard, />PHONE SCANNER CHECKOUT</, 'legacy phone scanner checkout button removed');
assert.match(dashboard, /customer-method-icon/, 'payment method icon tiles exist');
assert.match(dashboard, /2026\.07\.08\.04-mtg-printing-picker-fix/, 'visible build stamp updated');
console.log('subscription plan gates contract passed');
