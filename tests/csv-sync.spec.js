const { test, expect } = require('@playwright/test');
const { openDashboard } = require('./helpers');

test('admin PriceCharting panel exposes CSV sync diagnostics', async ({ page }) => {
  await openDashboard(page);
  await page.locator('#more-tab-btn').click();
  await page.locator('.more-item[data-tab="backoffice"]').click();
  await page.evaluate(() => window.selectSettingsSection?.('advanced'));
  await expect(page.locator('#pricing-qa-panel')).toBeVisible();
  await expect(page.locator('body')).toContainText(/PriceCharting|QA TESTS/i);
});
