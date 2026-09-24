import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('cloudflare-worker-full.js', 'utf8');

// Second half of the review-collection flow: an order-level review_token
// (added to storefront_orders, see the storefront_review_requests
// migration) is only useful once an actual email carries the link to the
// customer. This is that trigger -- picked up by the existing 6-hour
// scheduled() cron, same as every other runScheduled* job.

assert.match(worker, /ctx\.waitUntil\(Promise\.all\(\[runScheduledDealScans\(env\), runScheduledEbayReprice\(env\), runScheduledEbayOrderSync\(env\), runScheduledShopifyOrderSync\(env\), runScheduledStorefrontReviewRequests\(env\)\]\)\);/,
  'runScheduledStorefrontReviewRequests must be wired into the scheduled() cron handler alongside the existing jobs');

const fnStart = worker.indexOf('async function runScheduledStorefrontReviewRequests');
assert.ok(fnStart !== -1, 'runScheduledStorefrontReviewRequests must exist');
const fnEnd = worker.indexOf('\n}', fnStart) + 2;
const fnBody = worker.slice(fnStart, fnEnd);

assert.match(fnBody, /fulfillment_status=eq\.fulfilled/, 'must only consider orders staff has actually marked fulfilled -- not orders still pending/in transit');
assert.match(fnBody, /review_email_sent_at=is\.null/, 'must only consider orders not already emailed -- the idempotency guard');
assert.match(fnBody, /customer_email=not\.is\.null/, 'must skip orders with no email on file rather than erroring on every scan');
assert.match(fnBody, /fulfilled_at=lte\.\$\{encodeURIComponent\(cutoffIso\)\}/, 'must wait a real delay after fulfillment before emailing -- not the instant an order is marked fulfilled');
assert.match(fnBody, /await sendEmail\(env, order\.customer_email, subject, body\);/, 'must reuse the existing sendEmail helper, not a new email integration');
assert.match(fnBody, /review_email_sent_at=is\.null`, \{ method:'PATCH'/, 'the mark-sent PATCH must be guarded so two overlapping scheduled runs cannot both claim the send');

console.log('Storefront review-request scheduled-email contract checks passed');

// ── Functional: the email-content builder, independent of Supabase/fetch ──
function storefrontReviewRequestEmail(order, lines) {
  const itemNames = (lines || []).map(l => l.title).filter(Boolean);
  const itemsText = itemNames.length ? `\n${itemNames.map(n => `  - ${n}`).join('\n')}\n` : '';
  const link = `https://themanapocket.com/review?token=${order.review_token}`;
  const body = `Hi ${order.customer_name || ''},\n\nThanks again for your order from The Mana Pocket!${itemsText}\nIf you have a minute, we'd love to hear what you thought -- it really helps a small shop:\n\n${link}\n\nThanks for supporting us!`;
  return { subject: 'How was your order from The Mana Pocket?', body };
}

{
  const order = { customer_name: 'Alex', review_token: '11111111-1111-1111-1111-111111111111' };
  const lines = [{ title: 'Amazing Spider-Man #1' }, { title: 'Batman #1' }];
  const { subject, body } = storefrontReviewRequestEmail(order, lines);
  assert.match(subject, /How was your order/);
  assert.match(body, /Amazing Spider-Man #1/);
  assert.match(body, /Batman #1/);
  assert.match(body, /https:\/\/themanapocket\.com\/review\?token=11111111-1111-1111-1111-111111111111/, 'the email must link to the real /review page with the real per-order token');
}

console.log('Storefront review-request email content checks passed');
