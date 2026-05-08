const { test, expect } = require('@playwright/test');
const { openDashboard } = require('./helpers');

test('fullscreen button remains enabled after blocked or repeated attempts', async ({ page }) => {
  await openDashboard(page);
  const btn = page.locator('#fullscreen-btn');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(btn).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(btn).toBeEnabled();
});
