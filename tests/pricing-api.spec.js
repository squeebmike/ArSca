const { test, expect, request } = require('@playwright/test');

test.skip(!process.env.RUN_LIVE_API, 'Set RUN_LIVE_API=1 to exercise live Cloudflare Worker pricing endpoints.');

test('PriceCharting CSV status returns valid JSON when worker is reachable', async ({ baseURL }) => {
  const api = await request.newContext({ baseURL: 'https://still-resonance-4f87.swarnerauto.workers.dev' });
  const response = await api.get('/pricing/pricecharting/csv/status');
  expect(response.status(), 'worker should return JSON, not crash HTML').toBeLessThan(500);
  const text = await response.text();
  expect(() => JSON.parse(text || '{}')).not.toThrow();
  await api.dispose();
});

test('JustTCG search endpoint does not expose secrets and returns JSON', async () => {
  const api = await request.newContext({ baseURL: 'https://still-resonance-4f87.swarnerauto.workers.dev' });
  const response = await api.get('/pricing/justtcg/search?q=pikachu%20151&category=Pokemon');
  expect([200, 400, 401, 404, 501]).toContain(response.status());
  const text = await response.text();
  expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}|sk_[A-Za-z0-9._-]{20,}|cfut_[A-Za-z0-9._-]{20,}/);
  expect(() => JSON.parse(text || '{}')).not.toThrow();
  await api.dispose();
});
