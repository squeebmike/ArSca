const { test, expect } = require('@playwright/test');
const { openDashboard, openScanner } = require('./helpers');

test('scanner page loads without fatal console errors', async ({ page }) => {
  const guard = await openScanner(page);
  await expect(page.locator('body')).toContainText(/SCAN|READY|Walk-Off/i);
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
