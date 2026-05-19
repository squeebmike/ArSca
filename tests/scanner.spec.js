const { test, expect } = require('@playwright/test');
const { openDashboard, openScanner } = require('./helpers');

test('scanner page loads without fatal console errors', async ({ page }) => {
  const guard = await openScanner(page);
  await expect(page.locator('body')).toContainText(/SCAN|READY|Walk-Off/i);
  await expect(page.locator('#app-version')).toContainText('2026.05.19.07');
  await expect(page.locator('#hud')).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  guard.assertClean();
});

test('scanner progress card shows card sorter states and timeout actions', async ({ page }) => {
  const guard = await openScanner(page);
  await page.evaluate(() => window.beginScannerProgress('reading_text', { retry:() => {}, sendAnyway:() => {} }));
  await expect(page.locator('#scanner-progress-card')).toBeVisible();
  await expect(page.locator('#scanner-progress-copy')).toContainText('Reading name, set, and number');
  await expect(page.locator('.card-sorter')).toBeVisible();
  await page.evaluate(() => window.updateScannerProgress('checking_prices'));
  await expect(page.locator('#scanner-progress-copy')).toContainText('Checking prices');
  await page.evaluate(() => window.updateScannerProgress('timeout'));
  await expect(page.locator('#scanner-progress-copy')).toContainText('Lookup is taking too long');
  await expect(page.locator('#scanner-progress-retry')).toBeVisible();
  await expect(page.locator('#scanner-progress-send')).toBeVisible();
  await page.evaluate(() => window.cancelScannerProgress());
  await expect(page.locator('#scanner-progress-card')).toBeHidden();
  guard.assertClean();
});

test('scanner Pokemon search can return cached rows offline', async ({ page }) => {
  const guard = await openScanner(page);
  await page.evaluate(async () => {
    await window.scannerSavePokemonCache('pikachu 151', [{
      source: 'justtcg',
      name: 'Pikachu',
      category: 'Pokemon TCG',
      set: 'Scarlet & Violet 151',
      card_number: '025/165',
      marketPrice: 11.11,
      priceSource: 'JustTCG Exact Variant',
      confidenceScore: 95,
      availableVariantCount: 1
    }]);
  });
  await page.context().setOffline(true);
  const rows = await page.evaluate(() => window.scannerUnifiedSearch('pikachu 151', 'Pokemon TCG'));
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0].name).toContain('Pikachu');
  expect(rows[0].cache.state).toBe('offline');
  await page.context().setOffline(false);
  guard.assertClean();
});

test('scanner handoff appears in dashboard Research Queue', async ({ page }) => {
  const guard = await openDashboard(page);
  await page.locator('[data-tab="research"]').click();
  await expect(page.locator('#research-queue-panel')).toContainText(/Pikachu 151/i);
  await page.getByRole('button', { name: 'Open' }).first().click();
  await expect(page.locator('#qpl-result')).toContainText(/Pikachu/i);
  await expect(page.locator('#qpl-result')).toContainText(/JustTCG|QA fixture/i);
  guard.assertClean();
});
